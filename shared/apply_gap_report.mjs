#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './local_db.mjs';
import { buildMissingFieldRanking, condenseMissingQuestions } from './missing_field_questions.mjs';
import { atsHome } from './paths.mjs';

const HOME = atsHome();
const TMP = '/tmp/mrweirdo-onboard';
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

  for (const b of obj.blockers || []) push(b.question || b, 'blocker');
  for (const item of obj.remaining || []) push(item, 'remaining');
  for (const item of obj.missing || []) push(item, 'missing');
  for (const item of obj.last_missing || []) push(item, 'last_missing');
  for (const item of obj.still_missing || []) push(item, 'still_missing');
  for (const item of obj.pending || []) push(item.question || item, 'agent_pending');

  for (const pass of [obj.answer_pass?.first_pass, obj.answer_pass?.second_pass, obj.answer_pass]) {
    if (!pass) continue;
    for (const item of pass.unresolved || []) push(item, 'unresolved');
    for (const item of pass.still_missing || []) push(item, 'still_missing');
  }

  return fields;
}

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

  if (/captcha/.test(note) || /captcha/.test(lower)) return 'manual_captcha';
  if (/record|interview.*record|privacy|consent|data|gdpr|arbitration|certification|true and complete/.test(lower)) return 'agent_attestation';
  if (/confirm.{0,80}(information|application|resume).{0,80}(true|correct|accurate)|false statements|material omissions|acknowledge.{0,80}(true|correct|accurate)/.test(lower)) return 'agent_attestation';
  if (/preferred name|primary phone|phone number|\bphone\b|^location$|where do you reside|where do you currently live|do you live in|do you reside in|currently live|currently reside|current location|where are you located|where.*located|where.*based|unlimited and unrestricted authorization|legally authorized|authorized to work|require.{0,40}sponsor|sponsor.{0,40}immigration|maintain that authorization|previously applied|previously interviewed|applied or interviewed|interviewed with|compensation|salary|pay|paid|expected.*paid|expect.*pay|background check|bachelor|gender|race|ethnic|hispanic|latino|veteran|disability|attach|upload|resume|cv|cover letter file|expected graduation|graduation month|graduation year|what is your major|major \(and minor|which work style|work style\(s\)|notice period|if .*employee.*selected|provide the employee name|^company name$|^company$|^title$|^job title$|^(start|end) date (month|year)$|^end date year$/.test(lower)) return 'agent_profile_backed';
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
  return 'unknown_user_fact';
}

const QUESTION_TEMPLATES = {
  user_full_address: {
    priority: 1,
    profile_paths: ['personal.address_street', 'personal.address_city', 'personal.address_state', 'personal.address_zip', 'personal.address_country'],
    question: '请提供你的完整永久/邮寄地址：街道、城市、州、ZIP、国家。这个只保存在本地 profile，用来填写 ATS 地址题。',
    answer_type: 'short_text',
  },
  user_earliest_start_date: {
    priority: 2,
    profile_paths: ['standard_qa.earliest_start_date'],
    question: '你最早可以开始实习/part-time 的日期是什么？请给一个具体日期或月份，例如 2026-05-15 / May 2026。',
    answer_type: 'short_text',
  },
  user_high_school_location: {
    priority: 3,
    profile_paths: ['standard_qa.high_school_location'],
    question: '你的高中所在城市和州/国家是什么？例如 Beijing, China 或 Seattle, WA。',
    answer_type: 'short_text',
  },
  user_government_relative_compliance: {
    priority: 4,
    profile_paths: ['legal_attestations.relatives_in_federal_government_or_contractors'],
    question: '你是否有亲属目前在美国联邦政府、HHS/CDC、DoD/军方、相关政府 contractor，或政治任命岗位工作？请回答 Yes/No；如果 Yes，请简短说明。',
    answer_type: 'yes_no_plus_detail',
  },
  user_language_or_skill_level: {
    priority: 5,
    profile_paths: ['standard_qa.language_proficiency'],
    question: '表单问到了语言或技能水平。请列出你的真实水平，例如 Spanish: none/beginner/intermediate/fluent；或按题目说明回答。',
    answer_type: 'short_text',
  },
  user_compliance_relationship_or_restriction: {
    priority: 6,
    profile_paths: ['legal_attestations.conflicting_obligations', 'standard_qa.company_relationships'],
    question: '表单问到了 non-compete、供应商/合作伙伴/经销商关系或其他可能限制工作的合规事实。请按真实情况回答 Yes/No；如果 Yes，请简短说明。',
    answer_type: 'yes_no_plus_detail',
  },
  user_gpa: {
    priority: 7,
    profile_paths: ['education.gpa'],
    question: '你的本科 cumulative GPA 是多少？如果不想自动填写 GPA，也可以说“不填 GPA”。',
    answer_type: 'short_text',
  },
  user_logistics_fact: {
    priority: 8,
    profile_paths: ['standard_qa.location_logistics'],
    question: '表单问到了具体通勤/驾照/交通事实。请按真实情况回答该题；这类事实不能由系统猜。',
    answer_type: 'short_text',
  },
  user_work_location_commitment: {
    priority: 9,
    profile_paths: ['standard_qa.work_location_commitments'],
    question: '你是否愿意/能够按岗位要求到指定城市 onsite/hybrid 工作？请按城市回答 Yes/No，例如 Bay Area: Yes。',
    answer_type: 'short_text',
  },
  user_external_form_completion: {
    priority: 10,
    profile_paths: ['standard_qa.external_form_confirmations'],
    question: '有些岗位要求先完成一个外部表单，然后在 ATS 里确认。请打开对应岗位页面完成外部表单后告诉我 Yes；如果你不想做这个额外表单，我会跳过该岗位。',
    answer_type: 'yes_no',
  },
  unknown_user_fact: {
    priority: 20,
    profile_paths: ['standard_qa.custom_facts'],
    question: '有表单问到了系统无法安全推断的事实。请看下面原题，逐题给真实答案。',
    answer_type: 'short_text',
  },
};

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

const RETRYABLE_CATEGORIES = new Set([
  'agent_attestation',
  'agent_open_text',
  'agent_profile_backed',
  'user_compliance_relationship_or_restriction',
  'user_external_form_completion',
  'user_full_address',
  'user_government_relative_compliance',
  'user_gpa',
  'user_high_school_location',
  'user_language_or_skill_level',
  'user_logistics_fact',
  'user_earliest_start_date',
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
  examples: grouped[category].slice(0, 5).map(exampleFor),
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
  .filter((q) => q.count >= 2 || ['user_full_address', 'user_earliest_start_date', 'user_government_relative_compliance'].includes(q.category))
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
