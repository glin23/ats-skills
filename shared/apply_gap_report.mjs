#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './local_db.mjs';
import {
  QUESTION_TEMPLATES,
  buildMissingFieldRanking,
  condenseMissingQuestions,
  customFactAnswered,
  customFactKey,
} from './missing_field_questions.mjs';
import { atsHome } from './paths.mjs';
import { onboardTmpDir } from './onboard_tmp.mjs';

const HOME = atsHome();
const TMP = onboardTmpDir();
const PROFILE = readJson(path.join(HOME, 'profile.json'), {});

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function parseJsonLines(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const start = line.indexOf('{');
    const end = line.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      out.push(JSON.parse(line.slice(start, end + 1)));
    } catch {
      // Ignore human log lines.
    }
  }
  return out;
}

function newestSummary() {
  if (!fs.existsSync(TMP)) return null;
  const files = fs.readdirSync(TMP)
    .filter((name) => /^apply-batch-summary-.*\.json$/.test(name))
    .map((name) => path.join(TMP, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || null;
}

function resultFilesFromSummary(summaryPath) {
  const summary = readJson(summaryPath, {});
  return (summary.rows || [])
    .map((row) => row.result_file)
    .filter(Boolean);
}

function resultFilesFromDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /^apply-result-.*\.jsonl$/.test(name))
    .map((name) => path.join(dir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function fieldLabel(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  return compact(field.label || field.question || field.name || field.id || '');
}

function collectFields(obj) {
  const fields = [];
  const push = (value, source) => {
    const label = fieldLabel(value);
    if (!label) return;
    fields.push({
      label,
      source,
      note: typeof value === 'object' && value ? value.note || value.reason || value.type || null : null,
      options: typeof value === 'object' && value && Array.isArray(value.options) ? value.options : null,
    });
  };

  // Push the whole blocker object, not `b.question`. fieldLabel() already falls
  // back to `.question` for the label, and passing the object is the only way
  // `note` survives — that note is the driver's precise reason for stopping and
  // it is what turns a blocked row into a question the user can actually answer.
  // Plain strings still work, so old result files keep parsing.
  for (const b of obj.blockers || []) push(b, 'blocker');
  for (const item of obj.remaining || []) push(item, 'remaining');
  for (const item of obj.missing || []) push(item, 'missing');
  for (const item of obj.last_missing || []) push(item, 'last_missing');
  for (const item of obj.still_missing || []) push(item, 'still_missing');
  for (const item of obj.pending || []) push(item, 'agent_pending');

  for (const pass of [obj.answer_pass?.first_pass, obj.answer_pass?.second_pass, obj.answer_pass]) {
    if (!pass) continue;
    for (const item of pass.unresolved || []) push(item, 'unresolved');
    for (const item of pass.still_missing || []) push(item, 'still_missing');
  }

  return fields;
}

// Note -> category. The driver already knows exactly why it stopped; matching
// that note beats re-deriving intent from a form label written by whoever built
// that particular application form.
//
// Every key here is emitted by a driver ONLY when the profile has no value for
// the fact (verified line by line in greenhouse_apply_driver.mjs / answer_routing.mjs
// on 2026-07-25), so a note match always means "nobody ever told us this".
// A renamed note is caught by the grep guard in test/apply_gap_report.test.mjs.
const NOTE_CATEGORY = {
  work_authorization_required: 'user_work_authorization',
  sponsorship_future_required: 'user_work_authorization',
  legal_attestation_required: 'user_legal_attestation',
  export_control_answer_required: 'user_legal_attestation',
  current_residence_required: 'user_full_address',
  profile_full_address_required: 'user_full_address',
  specific_city_fact_unconfirmed: 'user_logistics_fact',
  external_form_completion_required: 'user_external_form_completion',
  contractual_obligations_answer_required: 'user_compliance_relationship_or_restriction',
  company_relationship_answer_required: 'user_compliance_relationship_or_restriction',
  government_related_relative_answer_required: 'user_government_relative_compliance',
  english_fluency_answer_required: 'user_language_or_skill_level',
  language_proficiency_not_in_profile: 'user_language_or_skill_level',
  availability_commitment_answer_required: 'user_earliest_start_date',
  part_time_availability_answer_required: 'user_earliest_start_date',
  location_not_in_profile_preferences: 'user_work_location_commitment',
  relocation_commitment_policy_unset: 'user_work_location_commitment',
};

// Dynamic notes. When a driver stops on one specific field it appends that
// form's own label to the note (`value_empty_for:what is your gpa?`,
// `no_bucket_for:preferred name`), so an exact-match table can never hold them:
// the suffix is unbounded. Every one of them therefore fell through to the
// label rules below — the same guessing that filed a blocked residence question
// under "the agent fills this from the profile" while the profile held nothing.
//
// The prefix carries one fact, and only one: at the moment the driver ran, it
// had nothing to type here. That is not enough to name the fact (the label
// rules still pick the bucket, so a GPA stays user_gpa with its own question and
// its own write path), but it is exactly enough to rule out the one verdict the
// driver's own state contradicts — `agent_profile_backed`, which is the only
// label rule that never looks at the profile before claiming it holds the value.
const EMPTY_VALUE_NOTE_PREFIXES = ['value_empty_for:', 'no_bucket_for:'];

function classifyField(field, outcome = {}) {
  const label = compact(field.label);
  const lower = label.toLowerCase();
  const note = String(field.note || outcome.reason || '').toLowerCase();
  const source = String(field.source || '');
  const personal = PROFILE.personal || {};
  const standard = PROFILE.standard_qa || {};
  const legal = PROFILE.legal_attestations || {};
  const relationships = standard.company_relationships || {};
  const externalForms = standard.external_form_confirmations || {};
  const fullAddressKnown = !!(personal.address_street && personal.address_city && personal.address_state && personal.address_zip);
  const locationCommitment = (() => {
    const commitments = standard.work_location_commitments || {};
    for (const [place, ok] of Object.entries(commitments)) {
      const aliases = [
        String(place).toLowerCase(),
        String(place).toLowerCase() === 'bay area' ? 'sf bay' : '',
        String(place).toLowerCase() === 'san francisco' ? 'sf' : '',
        String(place).toLowerCase() === 'united states' ? 'us' : '',
      ].filter(Boolean);
      if (aliases.some((alias) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower))) {
        return ok === true ? 'accepted' : 'declined';
      }
    }
    return null;
  })();

  const demographics = PROFILE.demographics || {};
  const auth = PROFILE.work_authorization || {};
  // Three-state: only a real boolean counts as answered. A stale `"true"` string
  // is treated as never-asked rather than coerced into a claim about visa status.
  const workAuthKnown = () => typeof auth.authorized_to_work_us === 'boolean'
    && typeof auth.requires_sponsorship_future === 'boolean';
  const eeoValueKnown = (text) => {
    const keys = [];
    if (/hispanic|latino|ethnic/.test(text)) keys.push('hispanic_or_latino');
    if (/race/.test(text)) keys.push('race');
    if (/gender/.test(text)) keys.push('gender');
    if (/veteran/.test(text)) keys.push('veteran_status');
    if (/disability/.test(text)) keys.push('disability_status');
    if (!keys.length) return false;
    return keys.every((key) => demographics[key] != null && demographics[key] !== '');
  };

  // "Does the profile already hold the answer this category asks for?" — one
  // entry per category the note table can produce, each mirroring the label-path
  // rule for the same fact. A category with no entry here is never treated as
  // answered, i.e. we ask rather than assume.
  const nonEmpty = (obj) => Object.keys(obj || {}).length > 0;
  const CATEGORY_ANSWERED = {
    user_work_authorization: () => workAuthKnown(),
    user_demographics_eeo: () => eeoValueKnown(lower),
    user_full_address: () => fullAddressKnown,
    user_legal_attestation: () => typeof legal.no_prohibited_possessor_status === 'boolean',
    user_government_relative_compliance: () => typeof legal.relatives_in_federal_government_or_contractors === 'boolean',
    user_compliance_relationship_or_restriction: () => typeof legal.conflicting_obligations === 'boolean' || nonEmpty(relationships),
    user_earliest_start_date: () => !!standard.earliest_start_date,
    user_language_or_skill_level: () => nonEmpty(standard.language_proficiency),
    user_logistics_fact: () => nonEmpty(standard.location_logistics),
    user_external_form_completion: () => nonEmpty(externalForms),
    // Not `nonEmpty(commitments)`: "he agreed to the Bay Area" says nothing
    // about Denver, and treating it as an answer is how a question about a city
    // he never named turns into "fill it from the profile" — asked of nobody,
    // answered by nobody, row stuck. Mirrors the label rule for the same fact.
    user_work_location_commitment: () => locationCommitment !== null,
    // Not `nonEmpty(custom_facts)`: that bucket holds every fact with no bucket
    // of its own, so "it has something in it" answers no particular question —
    // the real profile's 11 entries made this rule say "the profile holds it"
    // for every question the user has never been asked. Same shape as the
    // per-city location rule right above: ask about THIS fact, not the bucket.
    unknown_user_fact: () => customFactAnswered(label, standard.custom_facts),
  };
  const categoryAnswered = (category) => Boolean(CATEGORY_ANSWERED[category]?.());

  if (/captcha/.test(note) || /captcha/.test(lower)) return 'manual_captcha';

  // The field's OWN note, with no `outcome.reason` fallback. Three row-level
  // reasons (profile_full_address_required / company_relationship_answer_required
  // / legal_attestation_required) are spelled exactly like field-level notes, so
  // reusing the `note` variable above would stamp the row's reason onto every
  // unrelated field in that row — a report that looks right and asks nonsense.
  const ownNote = String(field.note || '').toLowerCase();
  // Same source of truth, same trap: read the field's OWN note only. A row-level
  // reason is spelled the same way (`outcome.reason` is `value_empty_for:...`
  // whenever one field ran dry), so reading the fallback variable would mark
  // every other field in that row as never-answered.
  const driverFoundNoValue = EMPTY_VALUE_NOTE_PREFIXES.some((prefix) => ownNote.startsWith(prefix));
  // Whatever the driver saw, the profile has the final say — otherwise a result
  // file re-read after the user answers keeps asking the same question forever.
  const noValueCategory = () => (categoryAnswered('unknown_user_fact') ? 'agent_profile_backed' : 'unknown_user_fact');
  const noteCategory = NOTE_CATEGORY[ownNote];
  if (noteCategory) {
    // A note only tells us why the driver stopped at the time it ran. Result
    // files are re-read after the user answers, so the profile gets the final
    // say — otherwise the report keeps asking a question that has been answered
    // and the loop never closes. Mirrors the label-path rules further down.
    return categoryAnswered(noteCategory) ? 'agent_profile_backed' : noteCategory;
  }

  if (/record|interview.*record|privacy|consent|data|gdpr|arbitration|certification|true and complete/.test(lower)) return 'agent_attestation';
  if (/confirm.{0,80}(information|application|resume).{0,80}(true|correct|accurate)|false statements|material omissions|acknowledge.{0,80}(true|correct|accurate)/.test(lower)) return 'agent_attestation';
  // Work authorisation and EEO used to sit inside the catch-all regex below and
  // were therefore always "the agent fills this from the profile" — even for a
  // profile that had never been told. Same shape as the GPA and language rules
  // further down: profile-backed only when the profile actually holds the value.
  if (/unlimited and unrestricted authorization|legally authorized|authorized to work|require.{0,40}sponsor|sponsor.{0,40}immigration|maintain that authorization/.test(lower)) {
    return workAuthKnown() ? 'agent_profile_backed' : 'user_work_authorization';
  }
  if (/gender|race|ethnic|hispanic|latino|veteran|disability/.test(lower)) {
    return eeoValueKnown(lower) ? 'agent_profile_backed' : 'user_demographics_eeo';
  }
  if (/preferred name|primary phone|phone number|\bphone\b|^location$|where do you reside|where do you currently live|do you live in|do you reside in|currently live|currently reside|current location|where are you located|where.*located|where.*based|previously applied|previously interviewed|applied or interviewed|interviewed with|compensation|salary|pay|paid|expected.*paid|expect.*pay|background check|bachelor|attach|upload|resume|cv|cover letter file|expected graduation|graduation month|graduation year|what is your major|major \(and minor|which work style|work style\(s\)|notice period|if .*employee.*selected|provide the employee name|^company name$|^company$|^title$|^job title$|^(start|end) date (month|year)$|^end date year$/.test(lower)) return driverFoundNoValue ? noValueCategory() : 'agent_profile_backed';
  if (/did you .*complete.*form|successfully complete.*form|complete the form below/.test(lower)) {
    if (externalForms.manual_external_forms === false || externalForms.auto_only === true) return 'system_external_form_auto_required';
    return 'user_external_form_completion';
  }
  if (/non[- ]?compete|non[- ]?solicit|restrictive covenant|supplier|partner|dealer|confidentiality agreement|conflict of interest/.test(lower)) {
    if (legal.conflicting_obligations === false ||
        relationships.non_compete === false ||
        relationships.any_supplier_partner_dealer_relationship === false ||
        relationships.alarm_com_dealer_partner_supplier_last_year === false ||
        relationships.pebl_employee_or_affiliate_partner_client_relationship === false) {
      return 'agent_profile_backed';
    }
    return 'user_compliance_relationship_or_restriction';
  }
  if (/full.{0,20}address|primary mailing address|mailing address|permanent address|street, city, state, zip|street address|address line|postal code|zip code|\bzip\b|home state/.test(lower)) return fullAddressKnown ? 'agent_profile_backed' : 'user_full_address';
  if (/profile_full_address_required/.test(note) && !/record|interview|privacy|consent|data/.test(lower)) return fullAddressKnown ? 'agent_profile_backed' : 'user_full_address';
  if (/hybrid|in office|in-office|onsite|on-site|commute|work out of|comfortable working remote|from which city\/state.*planning to work|bay area|san francisco|new york|boston|seattle|austin|los angeles|confirmed plans/.test(lower)) {
    if (locationCommitment === 'accepted') return 'agent_profile_backed';
    if (locationCommitment === 'declined') return 'system_profile_declined_location';
    return 'user_work_location_commitment';
  }
  if (/earliest.*start|start date|when can you start|availability date|available.{0,80}(internship|part-time|part time).{0,80}(from|through)|duration of (the )?internship/.test(lower)) return standard.earliest_start_date ? 'agent_profile_backed' : 'user_earliest_start_date';
  if (/high school/.test(lower)) return 'user_high_school_location';
  if (/relatives?.{0,140}(federal|government|contractor|department|hhs|health and human services|defense|dod|military|political)|family member.{0,140}(federal|government|contractor|military|political)|political appointee/.test(lower)) {
    return typeof legal.relatives_in_federal_government_or_contractors === 'boolean'
      ? 'agent_profile_backed'
      : 'user_government_relative_compliance';
  }
  if (/spanish|mandarin|french|german|language|proficiency level|fluen/.test(lower)) {
    const langs = standard.language_proficiency || {};
    const known = Object.keys(langs).some((name) => lower.includes(String(name).toLowerCase()) && langs[name]);
    return known ? 'agent_profile_backed' : 'user_language_or_skill_level';
  }
  if (/gpa/.test(lower)) return PROFILE.education?.gpa ? 'agent_profile_backed' : 'user_gpa';
  if (/specific_city_fact_unconfirmed|transportation|driver'?s license/.test(note) || /reliable transportation|driver'?s license/.test(lower)) return 'user_logistics_fact';
  if (/work environment|previously employed|previously worked at|ever worked at/.test(lower)) return 'agent_profile_backed';
  if (source === 'agent_pending'
      || /essay_answer_required/.test(note)
      || /why|explain|describe|tell us|share|interested|experience|gap|cover letter|writing sample/.test(lower)) return 'agent_open_text';
  // The bucket's main entrance, not its edge case: it holds the facts with no
  // bucket of their own, which is exactly what reaches this line. Returning the
  // bucket flat used to ask every such fact again on every run no matter what
  // the user had already written — eight of ten probes against the real
  // profile's answered facts, `us_citizen` among them, which he answered
  // `false`. Same predicate as the two paths above, so all three entrances
  // agree on what "he already told us" means.
  return noValueCategory();
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function maybeJob(rowId, db) {
  if (!rowId || !db) return {};
  try {
    return db.prepare('SELECT id, company, title, ats_platform FROM jobs WHERE id = ?').get(Number(rowId)) || {};
  } catch {
    return {};
  }
}

// Missing from this set means the row is never re-queued, so a user who answers
// the question sees nothing change. Any new user_* category must be listed here.
const RETRYABLE_CATEGORIES = new Set([
  'agent_attestation',
  'agent_open_text',
  'agent_profile_backed',
  'user_compliance_relationship_or_restriction',
  'user_demographics_eeo',
  'user_external_form_completion',
  'user_full_address',
  'user_government_relative_compliance',
  'user_gpa',
  'user_high_school_location',
  'user_language_or_skill_level',
  'user_legal_attestation',
  'user_logistics_fact',
  'user_earliest_start_date',
  'user_work_authorization',
  'user_work_location_commitment',
  'unknown_user_fact',
]);

function exampleFor(item) {
  return {
    row_id: item.row_id,
    company: item.company,
    title: item.title,
    ats_platform: item.ats_platform,
    label: item.label,
  };
}

// The generic bucket is the one category with no named field to write into, so
// the report names one per question. Left to whoever writes the answer, the key
// would be invented fresh each time, the next run would not recognise it, and
// the same question would come back forever — the loop this rule exists to close.
function exampleForCustomFact(item) {
  return { ...exampleFor(item), profile_key: customFactKey(item.label) };
}

const explicitSummaryPath = argValue('--summary', null);
const explicitResultDir = argValue('--result-dir', null);
const summaryPath = explicitSummaryPath || (explicitResultDir ? null : newestSummary());
const resultDir = explicitResultDir || TMP;
const outputJson = argValue('--json-output', path.join(TMP, 'apply-gap-report.json'));
const outputMd = argValue('--md-output', path.join(TMP, 'apply-gap-report.md'));

const files = summaryPath
  ? resultFilesFromSummary(summaryPath)
  : resultFilesFromDir(resultDir);

const db = fs.existsSync(dbPath()) ? new DatabaseSync(dbPath()) : null;
const entries = [];
for (const file of files) {
  if (!file || !fs.existsSync(file)) continue;
  const parsed = parseJsonLines(fs.readFileSync(file, 'utf8'));
  const outcome = [...parsed].reverse().find((obj) => typeof obj.outcome === 'string') || null;
  if (!outcome || outcome.outcome === 'submitted') continue;
  const rowId = Number(outcome.job_id || path.basename(file).match(/apply-result-(\d+)/)?.[1] || 0);
  const job = maybeJob(rowId, db);
  const fields = collectFields(outcome);
  if (outcome.reason === 'captcha_detected') fields.push({ label: 'Captcha / human verification', source: 'system', note: 'captcha_detected' });
  for (const field of fields) {
    const category = classifyField(field, outcome);
    entries.push({
      category,
      row_id: rowId || null,
      company: job.company || outcome.company || null,
      title: job.title || null,
      ats_platform: job.ats_platform || null,
      label: field.label,
      source: field.source,
      reason: outcome.reason || outcome.outcome,
      options: field.options,
    });
  }
}

const grouped = {};
for (const entry of entries) {
  grouped[entry.category] ||= [];
  grouped[entry.category].push(entry);
}
for (const key of Object.keys(grouped)) {
  grouped[key] = uniqBy(grouped[key], (item) => `${item.label}::${item.company || ''}`);
}

const userQuestionCategories = Object.keys(grouped)
  .filter((key) => key.startsWith('user_') || key === 'unknown_user_fact')
  .sort((a, b) => (QUESTION_TEMPLATES[a]?.priority || 99) - (QUESTION_TEMPLATES[b]?.priority || 99));

const user_questions = userQuestionCategories.map((category) => ({
  category,
  count: grouped[category].length,
  ...QUESTION_TEMPLATES[category],
  examples: grouped[category].slice(0, 5)
    .map(category === 'unknown_user_fact' ? exampleForCustomFact : exampleFor),
}));

const missing_field_ranking = buildMissingFieldRanking(entries, QUESTION_TEMPLATES);
const condensed_missing_questions = condenseMissingQuestions(entries, QUESTION_TEMPLATES);
const singleton_missing_categories = condensed_missing_questions
  .filter((item) => item.singleton)
  .flatMap((item) => item.covers_categories);

const agent_actions = Object.entries(grouped)
  .filter(([category]) => category === 'agent_open_text' || category === 'agent_attestation' || category === 'agent_profile_backed')
  .map(([category, items]) => ({
    category,
    count: items.length,
    action: category === 'agent_open_text'
      ? 'Do not ask the user first. Draft from resume/profile/self-introduction, add an answer-bank template if recurring, then retry the rows.'
      : 'Do not ask the user first. Fill from existing profile, local history, or normal application consent rules; add driver coverage if recurring.',
    examples: items.slice(0, 8).map(exampleFor),
  }));

const system_blockers = Object.entries(grouped)
  .filter(([category]) => category === 'manual_captcha' || category === 'system_external_form_auto_required' || category === 'system_profile_declined_location')
  .map(([category, items]) => ({
    category,
    count: items.length,
    action: category === 'manual_captcha'
      ? 'Captcha or human verification. Skip or ask the user to complete manually in browser.'
      : category === 'system_external_form_auto_required'
        ? 'External form is required, but the user chose auto-only. Build/dispatch external-form automation or skip this row; do not ask the user to complete it manually.'
        : 'The profile explicitly declines this location. Skip this row instead of asking again.',
    examples: items.slice(0, 5).map(exampleFor),
  }));

const retryMap = new Map();
for (const entry of entries) {
  if (!entry.row_id || !RETRYABLE_CATEGORIES.has(entry.category)) continue;
  const existing = retryMap.get(entry.row_id) || {
    row_id: entry.row_id,
    company: entry.company,
    title: entry.title,
    ats_platform: entry.ats_platform,
    categories: [],
    labels: [],
    requires_user_answer: false,
    agent_can_handle: false,
  };
  if (!existing.categories.includes(entry.category)) existing.categories.push(entry.category);
  if (!existing.labels.includes(entry.label)) existing.labels.push(entry.label);
  if (entry.category.startsWith('user_') || entry.category === 'unknown_user_fact') existing.requires_user_answer = true;
  if (entry.category.startsWith('agent_')) existing.agent_can_handle = true;
  retryMap.set(entry.row_id, existing);
}
const retry_candidates = [...retryMap.values()]
  .sort((a, b) => Number(a.row_id) - Number(b.row_id));

const onboarding_candidates = user_questions
  .filter((q) => q.category !== 'unknown_user_fact')
  .filter((q) => q.count >= 2 || ['user_full_address', 'user_earliest_start_date', 'user_government_relative_compliance', 'user_work_authorization'].includes(q.category))
  .map((q) => ({
    category: q.category,
    count: q.count,
    recommendation: q.count >= 2
      ? 'Recurring in this batch; discuss adding to onboarding.'
      : 'High-impact application fact; consider asking during onboarding if it appears again.',
    question: q.question,
  }));

const report = {
  ok: true,
  generated_at: new Date().toISOString(),
  summary_path: summaryPath || null,
  scanned_result_files: files.length,
  gap_count: entries.length,
  user_questions,
  missing_field_ranking,
  condensed_missing_questions,
  singleton_missing_categories,
  agent_actions,
  system_blockers,
  onboarding_candidates,
  retry_candidates,
  grouped_counts: Object.fromEntries(Object.entries(grouped).map(([key, items]) => [key, items.length])),
};

function mdList(items) {
  return items.map((item) => `- ${item.company || 'Unknown'} — ${item.title || 'Unknown'}: ${item.label}`).join('\n');
}

const md = [
  '# Mr. Weirdo Jobs Missing Info Follow-up',
  '',
  `Generated: ${report.generated_at}`,
  `Scanned result files: ${report.scanned_result_files}`,
  '',
  '## Ask User Before Continuing',
  '',
  user_questions.length
    ? user_questions.map((q, idx) => [
        `### ${idx + 1}. ${q.category}`,
        '',
        `Question: ${q.question}`,
        `Profile paths: ${(q.profile_paths || []).join(', ')}`,
        `Observed: ${q.count}`,
        '',
        mdList(q.examples),
      ].join('\n')).join('\n\n')
    : 'No user factual gaps detected.',
  '',
  '## Condensed Questions For User',
  '',
  condensed_missing_questions.length
    ? condensed_missing_questions.map((item, idx) => [
        `### ${idx + 1}. ${item.group_id}`,
        '',
        `Question: ${item.question}`,
        `Unlocks: ${item.unblocks_n_jobs} distinct job(s)`,
        `Covers categories: ${item.covers_categories.join(', ')}`,
        `Profile paths: ${(item.profile_paths || []).join(', ')}`,
        `Mode: ${item.singleton ? 'singleton' : 'grouped'}`,
      ].join('\n')).join('\n\n')
    : 'No condensed user questions detected.',
  '',
  '## Missing Field Ranking',
  '',
  missing_field_ranking.length
    ? missing_field_ranking
        .map((item) => `- ${item.category}: unlocks ${item.unblocks_n_jobs} distinct job(s); profile paths: ${item.profile_paths.join(', ')}`)
        .join('\n')
    : 'No ranked user-fillable missing fields detected.',
  '',
  '## Agent Should Handle',
  '',
  agent_actions.length
    ? agent_actions.map((a) => [
        `### ${a.category}`,
        '',
        a.action,
        '',
        mdList(a.examples),
      ].join('\n')).join('\n\n')
    : 'No open-text agent actions detected.',
  '',
  '## System / Manual Blockers',
  '',
  system_blockers.length
    ? system_blockers.map((b) => [
        `### ${b.category}`,
        '',
        b.action,
        '',
        mdList(b.examples),
      ].join('\n')).join('\n\n')
    : 'No system blockers detected.',
  '',
  '## Onboarding Discussion Candidates',
  '',
  onboarding_candidates.length
    ? onboarding_candidates.map((o) => `- ${o.category}: ${o.count} occurrence(s). ${o.recommendation}`).join('\n')
    : 'No recurring onboarding candidates detected.',
  '',
  '## Retry Candidates After Answers',
  '',
  retry_candidates.length
    ? retry_candidates.map((r) => `- row ${r.row_id}: ${r.company || 'Unknown'} — ${r.title || 'Unknown'} (${r.categories.join(', ')})`).join('\n')
    : 'No retryable rows detected.',
  '',
].join('\n');

fs.mkdirSync(path.dirname(outputJson), { recursive: true });
fs.writeFileSync(outputJson, JSON.stringify(report, null, 2));
fs.writeFileSync(outputMd, md);

console.log(JSON.stringify({
  ok: true,
  json: outputJson,
  markdown: outputMd,
  user_question_count: user_questions.length,
  condensed_question_count: condensed_missing_questions.length,
  agent_action_count: agent_actions.length,
  system_blocker_count: system_blockers.length,
  onboarding_candidate_count: onboarding_candidates.length,
}, null, 2));
