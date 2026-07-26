#!/usr/bin/env node
// greenhouse_apply_driver.mjs — submit-error-driven Greenhouse driver.
//
// Greenhouse-specific quirks (learned 2026-05-26):
//   - Resume input has id="resume" with class="visually-hidden". Files lost on
//     React re-render → MUST dispatch change event immediately after upload AND
//     verify .files.length > 0 before proceeding.
//   - Country field uses react-select. [role=option] queries are polluted by
//     intl-tel-input phone country dropdown. Must scope to the country's own
//     .select__menu container.
//   - Location (City) is a third react-select instance — same scoping issue.
//   - Phone field uses intl-tel-input; the visible "+1" flag chip is NOT the
//     Country selector — they are separate widgets.
//   - Custom questions (How did you hear / RTO / sponsorship / school enrollment)
//     are id="question_<numeric>" with react-select or text inputs.
//   - Submit error messages don't tell you the field id; they show the LABEL.
//     Match label → field id via label[for=id] association.
//
// LESSON 2026-05-26 (react-select sync vs async):
//   - Location uses AsyncSelect (Google Places). Opens with a synthetic
//     MouseEvent("mousedown", {button:0, buttons:1}) on .select__control.
//   - Country uses SYNC Select (static country list). The async-style mousedown
//     does NOT open it (count:0 options, aria-expanded stays false). For the
//     sync Select we click the .select__indicators button (the chevron) and
//     fall through to keydown ArrowDown on the input as a backup. See
//     reactSelectSync below.

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atsHome } from './paths.mjs';
import { renderAnswerTemplate } from './answer_templates.mjs';
import { currentResidenceYesNoAnswer, deriveWorkAuthAnswers, workAuthGapFor } from './answer_routing.mjs';
import {
  availabilityCommitmentAnswer,
  bachelorProgressCandidates,
  gpaValue,
  graduationSelectValues as graduationSelectValueCandidates,
  isGraduateDegree,
  hoursPerWeekAnswer as resolveHoursPerWeekAnswer,
  monthYear,
} from './greenhouse_value_rules.mjs';

const HOME = atsHome();
const REPO = process.env.MRWEIRDO_REPO_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const PROFILE = JSON.parse(readFileSync(join(HOME, 'profile.json'), 'utf8'));
const RESUME = PROFILE.resume_path || join(HOME, 'resume.pdf');
const DEFAULT_COVER_LETTER = join(HOME, 'cover_letter.pdf');
const STATIC_COVER_LETTER_ALLOWED = process.env.MRWEIRDO_DISABLE_STATIC_COVER_LETTER !== '1';
const COVER_LETTER = process.env.MRWEIRDO_COVER_LETTER_PATH ||
  (STATIC_COVER_LETTER_ALLOWED ? (PROFILE.cover_letter_path || (existsSync(DEFAULT_COVER_LETTER) ? DEFAULT_COVER_LETTER : '')) : '');
const CDP = join(REPO, 'shared/cdp.mjs');
const ANSWER_BANK_PATH = join(REPO, 'shared/answer_bank.json');
const ESSAY_PENDING_LOG = join(HOME, 'essay_pending.jsonl');
const SEARCH_INTENT_PATH = join(HOME, 'search_intent.json');

const APPLY_URL = process.argv[2];
const JOB_ID = process.argv[3] || null;
if (!APPLY_URL) { console.error('usage: greenhouse_apply_driver.mjs <url> [<job_id>]'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error('[gh-driver]', ...a);
function readJsonOptional(path, fallback = {}) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}
const SEARCH_INTENT = readJsonOptional(SEARCH_INTENT_PATH, {});
let companyFamiliarityAnswer = null;
let coverLetterUploaded = false;
const latestExperience = Array.isArray(PROFILE.experience_summary) ? PROFILE.experience_summary[0] : null;
const profilePortfolio =
  PROFILE.personal?.portfolio ||
  PROFILE.personal?.website ||
  PROFILE.personal?.github ||
  PROFILE.personal?.linkedin ||
  '';
const profileSchool = PROFILE.education?.school || 'Your School';
const profileMajor = PROFILE.education?.major || 'Your Major';
const profileDegree = PROFILE.education?.degree || "Bachelor's degree";
const profileGraduationDate = PROFILE.education?.graduation_date || '';
function resolveCdpHost() {
  if (process.env.CDP_HOST) return process.env.CDP_HOST.replace(/^https?:\/\//, '');
  if (process.env.ATS_CDP_PORT) return `localhost:${process.env.ATS_CDP_PORT}`;
  try {
    const fromFile = readFileSync(join(HOME, 'cdp_host'), 'utf8').trim();
    if (fromFile) return fromFile.replace(/^https?:\/\//, '');
  } catch {
    // no persisted host yet
  }
  return 'localhost:9222';
}
function cdp(...args) {
  const r = spawnSync('node', [CDP, ...args], { encoding: 'utf8' });
  return { stdout: r.stdout.trim(), stderr: r.stderr.trim(), code: r.status };
}
async function evalInTab(tab, js) {
  const r = cdp('eval', tab, js);
  try { return JSON.parse(r.stdout); } catch { return { _raw: r.stdout, _err: r.stderr }; }
}

// Close a tab via Chrome's debug HTTP endpoint. Safe to call when tab is gone.
async function closeTab(tab) {
  if (!tab) return { ok: false, note: 'no_tab' };
  const host = resolveCdpHost();
  try {
    const res = await fetch(`http://${host}/json/close/${tab}`, { method: 'GET' });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============================================================
// Answer bank loader
// ============================================================
const FALLBACK_BANK = {
  essay_templates: [],
  yes_no_defaults: {
    work_authorization: 'Yes', sponsorship_future: 'Yes', willing_to_relocate: 'Yes',
    enrolled_in_university: 'Yes', rto_office_in_person: 'Yes',
    veteran: "I don't wish to answer", disability: 'I do not want to answer',
    gender: 'I prefer not to answer', race: 'I prefer not to answer',
  },
  multichoice_preferences: {
    how_did_you_hear: ['LinkedIn', 'Online', 'Other', 'Google'],
    years_of_experience: ['< 1', '<1', '0-1', '1', '0', 'Less than 1'],
  },
  location_preferences: { city: '', city_full_match: [] },
  fallback_text: { linkedin: '', graduation_date: '', start_date_summer_2026: '' },
};

function loadAnswerBank() {
  if (!existsSync(ANSWER_BANK_PATH)) {
    console.error('[gh-driver] WARN: answer_bank.json not found at', ANSWER_BANK_PATH, '— using minimal in-memory fallback.');
    return { ...FALLBACK_BANK, essay_templates_compiled: [] };
  }
  try {
    const raw = JSON.parse(readFileSync(ANSWER_BANK_PATH, 'utf8'));
    const compiled = (raw.essay_templates || []).map((t) => ({
      regex: new RegExp(t.match, 'i'),
      template: t.answer_template,
      tags: t.tags || [],
    }));
    return { ...FALLBACK_BANK, ...raw, essay_templates_compiled: compiled };
  } catch (e) {
    console.error('[gh-driver] WARN: answer_bank.json failed to parse:', e.message, '— using minimal in-memory fallback.');
    return { ...FALLBACK_BANK, essay_templates_compiled: [] };
  }
}

const BANK = loadAnswerBank();

function degreeSelectValue() {
  const d = String(profileDegree || '').toLowerCase();
  if (/master|mba|m\.?s\.?|m\.?a\.?/.test(d)) return 'Master';
  if (/doctor|ph\.?d/.test(d)) return 'Doctorate';
  if (/associate/.test(d)) return 'Associate';
  if (/bachelor|b\.?s\.?|b\.?a\.?/.test(d)) return 'Bachelor';
  return profileDegree || 'Bachelor';
}

function isGraduateDegreeProfile() {
  return isGraduateDegree(profileDegree);
}

function graduationSelectValues() {
  return graduationSelectValueCandidates(profileGraduationDate, '');
}

function dateParts(value) {
  const text = monthYear(value, '').trim();
  const m = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b\s+(20\d{2})/i);
  if (!m) return null;
  const month = m[1].replace(/\b\w/g, (c) => c.toUpperCase());
  return { month, year: m[2] };
}

function educationEndParts() {
  return dateParts(profileGraduationDate) || { month: 'May', year: '' };
}

function educationStartParts() {
  const explicit = PROFILE.education?.start_date || PROFILE.education?.start || PROFILE.education?.start_month_year;
  const parsed = dateParts(explicit);
  if (parsed) return parsed;
  const end = educationEndParts();
  const gradYear = Number(end.year);
  const degree = String(profileDegree || '').toLowerCase();
  if (!Number.isFinite(gradYear)) return { month: 'September', year: '' };
  const years = /master|mba|m\.?s\.?|m\.?a\.?/.test(degree) ? 2 : 4;
  return { month: 'September', year: String(gradYear - years) };
}

function monthCandidates(month) {
  const m = String(month || '').trim();
  if (!m) return [];
  return [m, m.slice(0, 3)];
}

function dateValueForLabel(labelText) {
  const lt = String(labelText || '').toLowerCase();
  if (!/(?:start|end|graduat|date|complete)/.test(lt)) return null;
  const parts = /end date|graduat|complete/.test(lt) ? educationEndParts() : educationStartParts();
  if (/\bmonth\b/.test(lt)) return { kind: 'month', candidates: monthCandidates(parts.month) };
  if (/\byear\b/.test(lt)) return { kind: 'year', candidates: [parts.year].filter(Boolean) };
  return null;
}

function hoursPerWeekAnswer() {
  return resolveHoursPerWeekAnswer({ searchIntent: SEARCH_INTENT, profile: PROFILE, bank: BANK });
}

function earliestStartDate() {
  return PROFILE.standard_qa?.earliest_start_date ||
    BANK.fallback_text?.start_date_summer_2026 ||
    'May 2026';
}

function languageProficiencyForLabel(labelText) {
  const lt = String(labelText || '').toLowerCase();
  const langs = PROFILE.standard_qa?.language_proficiency || {};
  for (const [name, level] of Object.entries(langs)) {
    if (!level) continue;
    if (lt.includes(String(name).toLowerCase())) return String(level);
  }
  return '';
}

function companyRelationshipValueForLabel(labelText) {
  const lt = String(labelText || '').toLowerCase();
  const rel = PROFILE.standard_qa?.company_relationships || {};
  if (/alarm\.?com|dealer|partner|supplier/.test(lt)) {
    if (typeof rel.alarm_com_dealer_partner_supplier_last_year === 'boolean') {
      return rel.alarm_com_dealer_partner_supplier_last_year;
    }
    if (typeof rel.any_supplier_partner_dealer_relationship === 'boolean') {
      return rel.any_supplier_partner_dealer_relationship;
    }
  }
  if (/pebl|affiliate partners?|clients?|supported employee|engagement type/.test(lt)) {
    if (typeof rel.pebl_employee_or_affiliate_partner_client_relationship === 'boolean') {
      return rel.pebl_employee_or_affiliate_partner_client_relationship;
    }
  }
  if (/currently.*work|previously.*work|employed|employee|contractor/.test(lt)) {
    if (typeof rel.currently_working_for_other_company === 'boolean') {
      return rel.currently_working_for_other_company;
    }
  }
  return null;
}

function manualExternalFormsAllowed() {
  const prefs = PROFILE.standard_qa?.external_form_confirmations || {};
  if (prefs.manual_external_forms === false || prefs.auto_only === true) return false;
  return true;
}

function preferredCandidateCity() {
  const city = PROFILE.personal?.address_city || SEARCH_INTENT.user_summary?.school_location?.city || '';
  const state = PROFILE.personal?.address_state || SEARCH_INTENT.user_summary?.school_location?.state || '';
  return BANK.location_preferences?.city ||
    PROFILE.personal?.city ||
    (city && state ? `${city}, ${state}` : city) ||
    '';
}

function preferredCandidateLocationFull() {
  const city = PROFILE.personal?.address_city || SEARCH_INTENT.user_summary?.school_location?.city || '';
  const state = PROFILE.personal?.address_state || SEARCH_INTENT.user_summary?.school_location?.state || '';
  const country = PROFILE.personal?.address_country || SEARCH_INTENT.user_summary?.school_location?.country || 'United States';
  return PROFILE.standard_qa?.current_location_for_ats ||
    (city && state ? `${city}, ${state}, ${country}` : preferredCandidateCity());
}

function preferredCandidateCityFullMatchKeywords() {
  const configured = BANK.location_preferences?.city_full_match || [];
  const raw = [
    ...configured,
    PROFILE.personal?.address_state,
    SEARCH_INTENT.user_summary?.school_location?.state,
    PROFILE.personal?.address_country,
    SEARCH_INTENT.user_summary?.school_location?.country,
  ].filter(Boolean);
  const out = new Set();
  for (const item of raw) {
    const s = String(item).trim();
    if (!s) continue;
    out.add(s);
    if (/^MA$/i.test(s)) out.add('Massachusetts');
    if (/^NY$/i.test(s)) out.add('New York');
    if (/^CA$/i.test(s)) out.add('California');
    if (/^WA$/i.test(s)) out.add('Washington');
    if (/^TX$/i.test(s)) out.add('Texas');
    if (/^US$/i.test(s)) out.add('United States');
  }
  return [...out];
}

function preferredLocationAliases() {
  const geo = SEARCH_INTENT.search_intent?.geographic_preference || {};
  const metros = Array.isArray(geo.preferred_metros) ? geo.preferred_metros : [];
  const policy = geo.relocation_policy || PROFILE.target_filters?.relocation_policy || '';
  const countries = countriesOpenTo();
  const raw = [
    ...metros,
    PROFILE.standard_qa?.willing_to_relocate_scope,
    PROFILE.personal?.address?.city,
    PROFILE.personal?.address?.state,
    SEARCH_INTENT.user_summary?.school_location?.city,
    SEARCH_INTENT.user_summary?.school_location?.state,
  ].filter(Boolean).map((s) => String(s).toLowerCase());

  const aliases = new Set(raw);
  for (const item of raw) {
    if (/new york|nyc/.test(item)) aliases.add('nyc'), aliases.add('new york'), aliases.add('ny');
    if (/san francisco|bay area|sf/.test(item)) aliases.add('san francisco'), aliases.add('bay area'), aliases.add('sf');
    if (/boston|massachusetts|\bma\b/.test(item)) aliases.add('boston'), aliases.add('massachusetts'), aliases.add('ma');
    if (/china|beijing|shanghai|shenzhen|hong kong|guangzhou/.test(item)) aliases.add('anywhere_china');
    if (/anywhere|nationwide|all\s+(?:over\s+)?(?:the\s+)?(?:us|usa|united states)|open to.*(?:us|usa|united states)/.test(item)) aliases.add('anywhere_us');
  }
  if (/anywhere_primary_country|anywhere_legal_work/.test(policy) && countries.has('US')) aliases.add('anywhere_us');
  if (policy === 'anywhere_legal_work' && countries.has('CN')) aliases.add('anywhere_china');
  return aliases;
}

function countriesOpenTo() {
  const geo = SEARCH_INTENT.search_intent?.geographic_preference || {};
  const raw = geo.countries_open_to ||
    PROFILE.standard_qa?.countries_open_to ||
    PROFILE.target_filters?.countries_open_to ||
    [geo.primary_country || 'US'];
  const vals = Array.isArray(raw) ? raw : [raw];
  const out = new Set();
  for (const v of vals) {
    const s = String(v || '').trim().toLowerCase();
    if (!s) continue;
    if (/^(us|usa|united states|u\.s\.)$/.test(s)) out.add('US');
    else if (/^(cn|china|prc|中国)$/.test(s)) out.add('CN');
    else out.add(s.toUpperCase());
  }
  return out.size ? out : new Set(['US']);
}

function locationDecisionForLabel(labelText) {
  const lt = String(labelText || '').toLowerCase();
  const commitments = PROFILE.standard_qa?.work_location_commitments || {};
  for (const [place, ok] of Object.entries(commitments)) {
    if (!place) continue;
    const placeLower = String(place).toLowerCase();
    const aliases = [
      placeLower,
      placeLower === 'bay area' ? 'sf bay' : '',
      placeLower === 'san francisco' ? 'sf' : '',
      placeLower === 'united states' ? 'us' : '',
    ].filter(Boolean);
    if (aliases.some((alias) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lt))) {
      return ok === true
        ? { ok: true, note: 'profile_work_location_commitment', mentioned: [place] }
        : { ok: false, note: 'profile_work_location_declined', mentioned: [place] };
    }
  }
  const aliases = preferredLocationAliases();

  const usLocationWords = [
    'austin', 'texas', 'tx', 'new york', 'nyc', 'ny', 'cincinnati', 'ohio', 'oh',
    'menlo park', 'palo alto', 'san francisco', 'bay area', 'california', 'ca',
    'boston', 'cambridge', 'massachusetts', 'ma', 'seattle', 'washington', 'wa',
    'chicago', 'illinois', 'il', 'los angeles', 'la', 'denver', 'colorado', 'co',
  ];
  const chinaLocationWords = ['china', 'beijing', 'shanghai', 'shenzhen', 'hong kong', 'guangzhou', 'hangzhou'];
  const otherCountryWords = ['australia', 'canada', 'united kingdom', 'uk', 'singapore', 'india', 'germany', 'france', 'japan'];
  const commonLocationWords = [...usLocationWords, ...chinaLocationWords, ...otherCountryWords];
  const mentioned = commonLocationWords.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lt));
  const mentionsUs = mentioned.some((w) => usLocationWords.includes(w)) || /\b(us|usa|u\.s\.|united states)\b/.test(lt);
  const mentionsChina = mentioned.some((w) => chinaLocationWords.includes(w)) || /\b(cn|china|prc)\b|中国/.test(lt);
  const mentionsOtherCountry = mentioned.some((w) => otherCountryWords.includes(w));

  if (aliases.has('anywhere_us') && mentionsUs) return { ok: true, note: 'anywhere_us', mentioned };
  if (aliases.has('anywhere_china') && mentionsChina) return { ok: true, note: 'anywhere_china', mentioned };
  if (mentionsOtherCountry) return { ok: false, note: 'country_not_in_profile_preferences', mentioned };
  if (mentioned.length === 0) return { ok: true, note: 'no_specific_location_in_label' };
  const preferred = mentioned.some((w) => aliases.has(w));
  return preferred
    ? { ok: true, note: 'preferred_location_match', mentioned }
    : { ok: false, note: 'unsupported_specific_location', mentioned };
}

function currentResidenceAnswerForLabel(labelText) {
  const lt = String(labelText || '').toLowerCase();
  const profileCountry = String(
    PROFILE.personal?.address_country ||
    PROFILE.personal?.address?.country ||
    SEARCH_INTENT.user_summary?.school_location?.country ||
    ''
  ).toLowerCase();
  if (/continental united states|united states|\bu\.?s\.?\b|\busa\b/.test(lt)) {
    return {
      ok: true,
      value: /united states|\bus\b|usa/.test(profileCountry) ? 'Yes' : 'No',
      mentioned: ['united states'],
      note: 'current_country_from_profile',
    };
  }
  const currentRaw = [
    PROFILE.personal?.city,
    PROFILE.personal?.address_city,
    PROFILE.personal?.address_state,
    PROFILE.personal?.address?.city,
    PROFILE.personal?.address?.state,
    SEARCH_INTENT.user_summary?.school_location?.city,
    SEARCH_INTENT.user_summary?.school_location?.state,
  ].filter(Boolean).map((s) => String(s).toLowerCase());
  const current = new Set(currentRaw);
  for (const item of currentRaw) {
    if (/boston|babson|massachusetts|\bma\b/.test(item)) current.add('boston'), current.add('massachusetts'), current.add('ma');
    if (/new york|nyc|\bny\b/.test(item)) current.add('new york'), current.add('nyc'), current.add('ny');
    if (/san francisco|bay area|\bsf\b|california|\bca\b/.test(item)) current.add('san francisco'), current.add('bay area'), current.add('ca');
    if (/seattle|washington|\bwa\b/.test(item)) current.add('seattle'), current.add('washington'), current.add('wa');
  }
  const mentioned = ['seattle', 'washington', 'wa', 'boston', 'massachusetts', 'ma', 'new york', 'nyc', 'ny', 'san francisco', 'bay area', 'ca']
    .filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lt));
  if (mentioned.length === 0) return { ok: true, value: 'No', note: 'no_specific_current_location' };
  return {
    ok: true,
    value: mentioned.some((w) => current.has(w)) ? 'Yes' : 'No',
    mentioned,
  };
}

function educationEnrollmentAnswerForLabel(labelText) {
  const lt = String(labelText || '').toLowerCase();
  const schoolLoc = SEARCH_INTENT.user_summary?.school_location || {};
  const schoolCity = String(PROFILE.education?.school_city || schoolLoc.city || '').toLowerCase();
  const schoolState = String(PROFILE.education?.school_state || schoolLoc.state || '').toLowerCase();
  const schoolCountry = String(PROFILE.education?.school_country || schoolLoc.country || 'United States').toLowerCase();
  const enrolled = PROFILE.education?.currently_enrolled === true;
  if (!enrolled) return { value: 'No', note: 'not_currently_enrolled_from_profile' };
  if (/new york|\bny\b|nyc/.test(lt)) {
    return {
      value: /new york|\bny\b|nyc/.test(`${schoolCity} ${schoolState}`) ? 'Yes' : 'No',
      note: 'school_location_from_profile',
    };
  }
  if (/massachusetts|\bma\b|boston|babson/.test(lt)) {
    return {
      value: /massachusetts|\bma\b|boston|babson/.test(`${schoolCity} ${schoolState}`) ? 'Yes' : 'No',
      note: 'school_location_from_profile',
    };
  }
  if (/united states|\bus\b|usa|u\.s\./.test(lt)) {
    return {
      value: /united states|\bus\b|usa/.test(schoolCountry) ? 'Yes' : 'No',
      note: 'school_country_from_profile',
    };
  }
  return { value: 'Yes', note: 'currently_enrolled_from_profile' };
}

function profileAddressValueForLabel(labelText) {
  const lt = String(labelText || '').toLowerCase();
  if (/\b(?:e-?mail|email)\s+address\b/.test(lt) || /\b(?:institutional|academic|work|professional)\s+e?mail\b/.test(lt)) {
    return null;
  }
  const addr = PROFILE.personal?.address || {};
  const city = PROFILE.personal?.address_city || addr.city || PROFILE.personal?.city || SEARCH_INTENT.user_summary?.school_location?.city || '';
  const state = PROFILE.personal?.address_state || addr.state || SEARCH_INTENT.user_summary?.school_location?.state || '';
  const zip = PROFILE.personal?.address_zip || PROFILE.personal?.zip || addr.zip || addr.postal_code || '';
  const line1 = PROFILE.personal?.address_line1 || PROFILE.personal?.address_street || addr.line1 || addr.street || addr.street1 || '';
  const country = PROFILE.personal?.address_country || addr.country || 'United States';
  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const fullAddress = [line1, cityStateZip, country].filter(Boolean).join(', ');

  if (/current location|where are you located|where.*currently located|where.*located|where.*based/.test(lt)) {
    return null;
  }
  if (/full.{0,20}address|primary mailing address|mailing address|permanent address/.test(lt)) {
    return line1 && city && state && zip
      ? { value: fullAddress, note: 'profile_full_address' }
      : { needs_user_answer: true, note: 'profile_full_address_required' };
  }
  if (/address line 1|street address|street line 1|\baddress\b/.test(lt)) {
    return line1
      ? { value: line1, note: 'profile_address_line1' }
      : { needs_user_answer: true, note: 'profile_full_address_required' };
  }
  if (/postal code|zip code|\bzip\b|\bpostal\b/.test(lt)) {
    return zip
      ? { value: zip, note: 'profile_postal_code' }
      : { needs_user_answer: true, note: 'profile_full_address_required' };
  }
  if (/^state$|state\/province|province|region|state of residence|residence state|home state|current state/.test(lt)) {
    return state
      ? { value: state, candidates: stateValueCandidates(state), note: 'profile_state' }
      : { needs_user_answer: true, note: 'profile_full_address_required' };
  }
  if (/^city$|^town$/.test(lt)) {
    return city
      ? { value: city, note: 'profile_city' }
      : { needs_user_answer: true, note: 'profile_full_address_required' };
  }
  return null;
}

function profileSpecificTextAnswerForLabel(labelText) {
  const lt = String(labelText || '').toLowerCase();
  if (/(?:reference|referee|recommender|faculty|professor|advisor|academic contact|supervisor).{0,80}(?:name|title|email|phone|contact)|(?:academic title|institutional email|academic email|professional email)|(?:full name).{0,80}(?:institutional|academic|reference|email)/.test(lt)) {
    return { needs_user_answer: true, note: 'reference_contact_answer_required' };
  }
  if (/(?:certif(?:y|ication)|attest|signature|all answers.{0,40}(?:true|correct)|true and correct|accurate and complete)/.test(lt)) {
    return { needs_user_answer: true, note: 'attestation_answer_required' };
  }
  return null;
}

function currentLocationFactAnswerForLabel(labelText) {
  const lt = String(labelText || '').toLowerCase();
  if (!/\b(?:are you|do you).{0,80}\b(?:located|based|reside|residing|live|living)\b.{0,50}\b(?:area|office|location|region|city|state|country|this role|this position)\b/.test(lt)) {
    return null;
  }
  const residence = currentResidenceAnswerForLabel(labelText);
  return { value: residence.value || 'No', note: residence.note || 'current_location_fact_from_profile' };
}

function stateValueCandidates(state) {
  const s = String(state || '').trim();
  const map = {
    MA: 'Massachusetts',
    NY: 'New York',
    CA: 'California',
    WA: 'Washington',
    TX: 'Texas',
    OH: 'Ohio',
    FL: 'Florida',
    IL: 'Illinois',
    DC: 'District of Columbia',
  };
  if (!s) return [];
  const upper = s.toUpperCase();
  return [...new Set([map[upper], s, upper].filter(Boolean))];
}

function hasEnglishFluency() {
  const langs = Array.isArray(PROFILE.languages) ? PROFILE.languages : [];
  return langs.some((lang) => /english/i.test(String(lang || '')));
}

function hasWorkedForCompany() {
  if (!COMPANY) return false;
  const target = COMPANY.replace(/-/g, ' ').toLowerCase();
  const experiences = Array.isArray(PROFILE.experience_summary) ? PROFILE.experience_summary : [];
  return experiences.some((exp) => String(exp?.company || '').toLowerCase().includes(target));
}

function hasPriorApplicationToCompany() {
  if (!COMPANY) return false;
  const dbPath = join(HOME, 'jobs.db');
  if (!existsSync(dbPath)) return false;
  const companySql = COMPANY.replace(/'/g, "''").toLowerCase();
  const idClause = JOB_ID ? `AND id != ${Number(JOB_ID) || -1}` : '';
  const sql = `
    SELECT COUNT(*)
    FROM jobs
    WHERE lower(company) = '${companySql}'
      ${idClause}
      AND (
        status LIKE '✅%'
        OR submitted_at IS NOT NULL
        OR auto_submitted_at IS NOT NULL
        OR confirmation_url IS NOT NULL
        OR confirmed_at IS NOT NULL
      );
  `;
  const r = spawnSync('sqlite3', [dbPath, sql], { encoding: 'utf8' });
  return Number((r.stdout || '').trim()) > 0;
}

function needsFutureSponsorship() {
  return PROFILE.work_authorization?.requires_sponsorship_future ??
    PROFILE.work_authorization?.needs_sponsor;
}

function workAuthWithoutRestrictionAnswer() {
  const visa = String(PROFILE.work_authorization?.visa_status || '').toLowerCase();
  const requiresNow = PROFILE.work_authorization?.requires_sponsorship_now;
  const requiresFuture = needsFutureSponsorship();
  if (/citizen|green card|permanent resident|authorized without restriction/.test(visa)) return 'Yes';
  if (requiresNow === false && requiresFuture === false && !/f-?1|opt|cpt|h-?1b|visa|sponsor/.test(visa)) return 'Yes';
  return 'No';
}

function standardYesNoAnswerForLabel(labelText) {
  const lt = String(labelText || '').toLowerCase();
  if (/did you .*complete.*form|successfully complete.*form|complete the form below|form listed below/.test(lt)) {
    if (!manualExternalFormsAllowed()) {
      return { value: 'No', note: 'external_form_not_manually_completed_auto_only' };
    }
    return { needs_user_answer: true, note: 'external_form_completion_required' };
  }
  if (/deemed export license|ear[- ]controlled technology|export control|\bitar\b/.test(lt)) {
    return { needs_user_answer: true, note: 'export_control_answer_required' };
  }
  if (/unlimited and unrestricted authorization|unrestricted authorization.{0,80}work|authorization.{0,40}unrestricted/.test(lt)) {
    const value = workAuthWithoutRestrictionAnswer();
    return { value, candidates: [value, value === 'Yes' ? 'I have unrestricted authorization' : 'No'], note: 'profile_unrestricted_work_authorization' };
  }
  if (/permanent.{0,60}work authorization|work authorization.{0,60}permanent/.test(lt)) {
    const value = workAuthWithoutRestrictionAnswer();
    return { value, candidates: [value, value === 'Yes' ? 'I have permanent work authorization' : 'No'], note: 'profile_permanent_work_authorization' };
  }
  if (/currently enrolled.{0,80}(?:masters?|ph\.?d|doctor|graduate)|(?:masters?|ph\.?d).{0,80}program|graduate degree program/.test(lt)) {
    return { value: isGraduateDegreeProfile() ? 'Yes' : 'No', note: isGraduateDegreeProfile() ? 'graduate_degree_from_profile' : 'not_graduate_degree_from_profile' };
  }
  if (/enrolled.*university|currently enrolled|student at/.test(lt)) {
    return educationEnrollmentAnswerForLabel(labelText);
  }
  if (/contractual obligations|agreements.{0,40}relationships.{0,40}commitments|impede or interfere.{0,80}ability to join|non[- ]?compete/.test(lt)) {
    const explicit = PROFILE.legal_attestations?.conflicting_obligations;
    if (explicit === true) return { value: 'Yes', note: 'profile_conflicting_obligations' };
    if (explicit === false) return { value: 'No', note: 'profile_no_conflicting_obligations' };
    return { needs_user_answer: true, note: 'contractual_obligations_answer_required' };
  }
  if (/acknowledg(?:e|ment).*receipt.*review|read it, understood it|answered the questions truthfully/.test(lt)) {
    return { value: 'I acknowledge', candidates: ['I acknowledge', 'Acknowledge', 'Yes'], note: 'acknowledgment_attestation' };
  }
  if (/by submitting.*privacy policy|agree.*privacy policy|consent.*privacy policy|candidate privacy|privacy notice/.test(lt)) {
    return { value: 'I agree', candidates: ['I agree', 'Agree', 'Yes', 'I acknowledge', 'Acknowledge'], note: 'privacy_policy_attestation' };
  }
  if (/interview.{0,80}record|recorded.{0,80}interview|audio.{0,30}video.{0,30}transcript/.test(lt)) {
    return { value: 'Yes', candidates: ['Yes', 'I agree', 'Agree', 'I acknowledge', 'Acknowledge'], note: 'interview_recording_attestation' };
  }
  if (/authorize.{0,80}(?:use|process|share).{0,80}(?:information|personal details|personal data).{0,120}(?:evaluate|confirm|eligibility|suitability|qualifications)/.test(lt)) {
    return { value: 'Yes', candidates: ['Yes', 'I agree', 'Agree', 'I authorize'], note: 'application_data_use_authorization' };
  }
  const residence = currentResidenceYesNoAnswer(labelText, PROFILE);
  if (residence) return residence;
  if (/have you ever been employed by|previously (?:been )?employed by|previously worked at|ever worked at|worked at .* or any affiliated company|worked for .* or any affiliated company/.test(lt)) {
    return { value: hasWorkedForCompany() ? 'Yes' : 'No', note: hasWorkedForCompany() ? 'prior_employment_from_profile' : 'no_prior_employment_in_profile' };
  }
  if (/dealer|partner|supplier|pebl|affiliate partners?|clients?|supported employee|engagement type/.test(lt)) {
    const explicit = companyRelationshipValueForLabel(labelText);
    if (explicit === true) return { value: 'Yes', note: 'profile_company_relationship' };
    if (explicit === false) return { value: 'No', note: 'profile_no_company_relationship' };
    return { needs_user_answer: true, note: 'company_relationship_answer_required' };
  }
  if (/relatives?.{0,80}(?:currently )?working|family member.{0,80}(?:currently )?working/.test(lt)) {
    if (/federal government|department of health|human services|cdc|department of defense|\bdod\b|military|political appointee|contractor/.test(lt)) {
      const explicit = PROFILE.legal_attestations?.relatives_in_federal_government_or_contractors;
      if (explicit === true) return { value: 'Yes', note: 'profile_government_related_relative' };
      if (explicit === false) return { value: 'No', note: 'profile_no_government_related_relative' };
      return { needs_user_answer: true, note: 'government_related_relative_answer_required' };
    }
    const explicit = PROFILE.standard_qa?.relatives_at_target_company;
    if (explicit === true) return { value: 'Yes', note: 'profile_relatives_at_target_company' };
    if (explicit === false) return { value: 'No', note: 'profile_no_relatives_at_target_company' };
    return { needs_user_answer: true, note: 'company_relationship_answer_required' };
  }
  if (/did someone .* refer|were you referred|employee referral|referred you to this opportunity/.test(lt)) {
    const explicit = PROFILE.standard_qa?.employee_referral_name || '';
    return { value: explicit ? 'Yes' : 'No', note: explicit ? 'employee_referral_from_profile' : 'no_employee_referral_in_profile' };
  }
  if (/full[- ]?time,\s*12[- ]?week internship commitment|12[- ]?week internship commitment|full[- ]?time.{0,40}internship commitment/.test(lt)) {
    return {
      value: 'Yes',
      candidates: ['Yes', 'Yes, I am available', 'I am available', 'I can commit', 'Available for full-time 12-week internship', 'Available'],
      note: 'internship_availability_commitment',
    };
  }
  const availability = availabilityCommitmentAnswer(labelText, { searchIntent: SEARCH_INTENT, profile: PROFILE, bank: BANK });
  if (availability) return availability;
  if (/confirm.{0,80}available.{0,80}(part[- ]?time|internship|25h|25\s*hours?|40\s*hours?)|available.{0,80}(july|august).{0,80}(december|january)/.test(lt)) {
    const available = PROFILE.standard_qa?.part_time_internship_25h_2026_through_jan_2027 === true ||
      String(PROFILE.standard_qa?.hours_per_week || '').includes('25');
    if (available) {
      return { value: 'Yes', candidates: ['Yes', 'I confirm', 'Confirm', 'I am available', 'Available'], note: 'profile_part_time_internship_availability' };
    }
    return { needs_user_answer: true, note: 'part_time_availability_answer_required' };
  }
  if (/complete fluency in english|english.*(?:c1|advanced|fluen)/.test(lt)) {
    if (!hasEnglishFluency()) return { needs_user_answer: true, note: 'english_fluency_answer_required' };
    return { value: 'Yes', candidates: ['Yes', 'Fluent', 'C1', 'Advanced'], note: 'english_fluency_from_profile' };
  }
  if (/have you applied to .* within the last|previously applied|applied.{0,40}(?:last|past).{0,20}(?:months|years)|applied or interviewed|previously interviewed|interviewed with .*company/.test(lt)) {
    const prior = hasPriorApplicationToCompany();
    return { value: prior ? 'Yes' : 'No', note: prior ? 'prior_application_found_in_db' : 'no_prior_application_in_db' };
  }
  if (/background check|background screening/.test(lt)) {
    return { value: 'Yes', note: 'background_check_willingness' };
  }
  if (/able to work.{0,80}(?:office|location)|come into the office|in[- ]person|on[- ]site|onsite/.test(lt)) {
    const loc = locationDecisionForLabel(labelText);
    if (!loc.ok) return { needs_user_answer: true, note: 'location_not_in_profile_preferences', detail: loc };
    return { value: 'Yes', note: 'work_location_commitment' };
  }
  if (/able to work.{0,80}(?:bay area|san francisco|new york|boston|seattle|austin|los angeles|u\.?s\.?|united states)/.test(lt)) {
    const loc = locationDecisionForLabel(labelText);
    if (!loc.ok) return { needs_user_answer: true, note: 'location_not_in_profile_preferences', detail: loc };
    return { value: 'Yes', note: 'work_location_commitment' };
  }
  if (/without restriction|not tied to a specific employer|not dependent on.*government filing/.test(lt)) {
    return { value: workAuthWithoutRestrictionAnswer(), note: 'work_auth_without_restriction' };
  }
  if (/(?:will you|do you).{0,80}(?:now|future).{0,160}(?:file|transfer|extend|support|sponsor|immigration|employment authorization|government application|approval|renewal)/.test(lt)
      || /future.{0,80}(?:sponsor|immigration|employment authorization|government application|approval|renewal)/.test(lt)) {
    const requiresFuture = needsFutureSponsorship();
    const visa = String(PROFILE.work_authorization?.visa_status || '').toLowerCase();
    const value = requiresFuture === false ? 'No' : (requiresFuture === true || /f-?1|opt|cpt|h-?1b|j-?1|visa|sponsor/.test(visa) ? 'Yes' : null);
    return value ? { value, note: 'future_immigration_support' } : { needs_user_answer: true, note: 'sponsorship_future_required' };
  }
  if (/verification of both.*identity.*authorization to work|provide verification.*authorization to work|i-?9/.test(lt)) {
    return { value: 'Yes', note: 'i9_verification' };
  }
  if (/at least 18|18 years of age|over 18/.test(lt)) return { value: 'Yes', note: 'age_over_18' };
  if (/fugitive from justice/.test(lt)) return { value: 'No', note: 'legal_disqualifier_default_no' };
  if (/alien illegally|alien.*unlawfully/.test(lt)) return { value: 'No', note: 'lawful_presence' };
  if (/nonimmigrant visa|admitted.*nonimmigrant/.test(lt)) {
    const visa = String(PROFILE.work_authorization?.visa_status || '').toLowerCase();
    return { value: /f-?1|opt|cpt|h-?1b|j-?1|nonimmigrant|visa/.test(visa) ? 'Yes' : 'No', note: 'nonimmigrant_visa_status' };
  }
  if (/unlawful user.*controlled substance|addicted to.*controlled substance|marijuana|narcotic drug/.test(lt)) {
    return { value: 'No', note: 'legal_disqualifier_default_no' };
  }
  if (/court order.*restraining|under indictment|convicted.*misdemeanor crime of domestic violence|convicted.*felony/.test(lt)) {
    const explicit = PROFILE.legal_attestations?.no_prohibited_possessor_status;
    if (explicit === true) return { value: 'No', note: 'profile_no_prohibited_possessor_status' };
    return { needs_user_answer: true, note: 'legal_attestation_required' };
  }
  if (/mental defective|mental institution|committed to a mental/.test(lt)) return { value: 'No', note: 'legal_disqualifier_default_no' };
  if (/dishonorable/.test(lt) && /armed forces|military/.test(lt)) return { value: 'No', note: 'legal_disqualifier_default_no' };
  if (/renounced.*united states citizenship/.test(lt)) return { value: 'No', note: 'legal_disqualifier_default_no' };
  return null;
}

function sourceCheckboxDecision(labelText) {
  const lt = String(labelText || '').toLowerCase();
  if (/answered.*unaware/.test(lt)) return companyFamiliarityAnswer === 'unaware' ? 'check' : 'skip';
  const isSourceOption = /company website|employee|relative|family member|handshake|job board|agency|recruiter|linkedin|other/.test(lt);
  if (!isSourceOption) return 'not_source';
  if (companyFamiliarityAnswer === 'unaware') return 'skip';
  if (/linkedin|other job board|job board|online/.test(lt)) return 'check';
  return 'skip';
}

function isAckCheckboxLabel(labelText) {
  return /acknowledge|confirm|privacy|policy|review|consent|agree|certify|certification|truthfully|data collection|process my data|candidate privacy/i
    .test(String(labelText || ''));
}

function companyFromUrl(url) {
  return greenhouseSlugFromContext(url) || 'this team';
}
const COMPANY = companyFromUrl(APPLY_URL);
const COMPANY_PRETTY = COMPANY.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function rowCompanyFromDb() {
  if (!JOB_ID) return '';
  const id = Number(JOB_ID);
  if (!Number.isFinite(id) || id <= 0) return '';
  const dbFile = join(HOME, 'jobs.db');
  if (!existsSync(dbFile)) return '';
  const r = spawnSync('sqlite3', [dbFile, `SELECT company FROM jobs WHERE id = ${id} LIMIT 1;`], { encoding: 'utf8' });
  return (r.stdout || '').trim();
}

function slugifyGreenhouseCompany(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || '';
}

function greenhouseSlugFromContext(url) {
  try {
    const u = new URL(url);
    const forParam = u.searchParams.get('for');
    if (forParam) return slugifyGreenhouseCompany(forParam);
    const pathMatch = u.hostname.match(/(?:boards|job-boards)\.greenhouse\.io$/i) && u.pathname.match(/^\/(?:embed\/)?([^/]+)/);
    if (pathMatch && pathMatch[1] !== 'embed') return slugifyGreenhouseCompany(pathMatch[1]);
    const dbCompany = rowCompanyFromDb();
    if (dbCompany) return slugifyGreenhouseCompany(dbCompany);
    const hostParts = u.hostname.toLowerCase().split('.').filter((p) => !['www', 'jobs', 'careers'].includes(p));
    if (hostParts.length) return slugifyGreenhouseCompany(hostParts[0]);
  } catch {
    // Fall through to regex fallback.
  }
  const m = String(url || '').match(/(?:boards|job-boards)\.greenhouse\.io\/([^/?#]+)/);
  return m ? slugifyGreenhouseCompany(m[1]) : '';
}

function canonicalGreenhouseApplyUrls(url) {
  const out = [];
  try {
    const u = new URL(url);
    const token = u.searchParams.get('gh_jid') || u.searchParams.get('token');
    const slug = greenhouseSlugFromContext(url);
    if (token && slug && !/(?:boards|job-boards)\.greenhouse\.io$/i.test(u.hostname)) {
      out.push(`https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(slug)}&token=${encodeURIComponent(token)}`);
    }
  } catch {
    // Keep original only.
  }
  out.push(url);
  return [...new Set(out)];
}

function essayAnswerFor(questionText) {
  for (const t of BANK.essay_templates_compiled || []) {
    if (t.regex.test(questionText)) {
      return renderAnswerTemplate(t.template, { profile: PROFILE, companyPretty: COMPANY_PRETTY, searchIntent: SEARCH_INTENT });
    }
  }
  return null;
}

function shouldQueueForMainClaude(labelText) {
  return /\?$|describe|tell us|explain|why|projects|experience|submit.*(?:post|sample|writing)|social post|writing sample|work sample|original.*(?:post|content)/i
    .test(String(labelText || ''));
}

// ---------- nav + resume ----------
async function open() {
  const urls = canonicalGreenhouseApplyUrls(APPLY_URL);
  let lastTab = null;
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    if (url !== APPLY_URL) log('Canonical Greenhouse apply URL:', url);
    const r = cdp('goto', url);
    const parsed = JSON.parse(r.stdout);
    const tab = parsed.id;
    lastTab = tab;
    await sleep(2500);
    const state = await evalInTab(tab, `
      (() => ({
        url: location.href,
        has_file_input: !!document.querySelector('input[type=file]'),
        has_submit: [...document.querySelectorAll('button[type=submit], input[type=submit], button')]
          .some((b) => /submit|apply/i.test(b.innerText || b.value || '')),
        has_form: !!document.querySelector('form')
      }))()
    `);
    if (state.has_file_input || state.has_submit || state.has_form) return tab;
    if (i < urls.length - 1) await closeTab(tab);
  }
  return lastTab;
}

async function navigateGreenhouseIframeIfPresent(tab) {
  const found = await evalInTab(tab, `
    (() => {
      const frames = [...document.querySelectorAll('iframe')]
        .map((iframe) => {
          const raw = iframe.getAttribute('src') || '';
          let href = '';
          try { href = raw ? new URL(raw, location.href).href : ''; } catch { href = raw; }
          return { id: iframe.id || '', href };
        })
        .filter((f) => f.href);
      const real = frames.find((f) => {
        if (/content\\.googleapis\\.com\\/static\\/proxy\\.html/i.test(f.href)) return false;
        try {
          const u = new URL(f.href);
          const greenhouseHost = /(^|\\.)greenhouse\\.io$/i.test(u.hostname);
          return f.id === 'grnhse_iframe' || (greenhouseHost && /\\/embed\\/job_app|\\/jobs\\//i.test(u.pathname));
        } catch {
          return /(^|\\/)(?:job-boards|boards)\\.greenhouse\\.io\\//i.test(f.href) && !/proxy\\.html/i.test(f.href);
        }
      });
      if (!real) return { ok:false, frames };
      return { ok:true, src: real.href, frames };
    })()
  `);
  if (!found.ok || !found.src) return { ok: false };
  log('Navigate into Greenhouse iframe:', found.src);
  cdp('goto', found.src, tab);
  await sleep(3500);
  return { ok: true, src: found.src };
}

async function detectJobUnavailable(tab) {
  const state = await evalInTab(tab, `
    (() => {
      const body = document.body?.innerText || '';
      const submit = [...document.querySelectorAll('button[type=submit], input[type=submit]')]
        .some((b) => /submit/i.test(b.innerText || b.value || ''));
      return {
        url: location.href,
        has_file_input: !!document.querySelector('input[type=file]'),
        has_submit: submit,
        has_form: !!document.querySelector('form'),
        body_snippet: body.slice(0, 500),
      };
    })()
  `);
  if (state.has_file_input || state.has_submit) return { ok: false, state };

  const startHost = (() => {
    try { return new URL(APPLY_URL).hostname; } catch { return ''; }
  })();
  const finalHost = (() => {
    try { return new URL(state.url).hostname; } catch { return ''; }
  })();
  const redirectedAwayFromGreenhouse =
    /greenhouse\.io$/i.test(startHost) &&
    finalHost &&
    !/greenhouse\.io$/i.test(finalHost) &&
    !/[?&]gh_jid=/.test(state.url);
  const closedText = /job.*(?:not found|no longer open)|position.*(?:closed|filled)|no longer accepting|not currently accepting applications|page not found|404/i
    .test(state.body_snippet || '');
  const greenhouseNoForm =
    /greenhouse\.io$/i.test(finalHost) &&
    !state.has_file_input &&
    !state.has_submit &&
    !state.has_form &&
    /job you are looking for is no longer open|no longer open|not accepting applications|create a job alert/i.test(state.body_snippet || '');

  if (redirectedAwayFromGreenhouse || closedText || greenhouseNoForm) {
    return {
      ok: true,
      reason: redirectedAwayFromGreenhouse ? 'greenhouse_redirected_to_careers_index' : 'greenhouse_job_closed_text',
      state,
    };
  }
  return { ok: false, state };
}

async function uploadResume(tab) {
  // GH React form: after setFileInputFiles, React often UNMOUNTS the #resume input
  // and shows "resume.pdf attached" in place. So we don't try to re-access #resume.
  // Instead: dispatch change in the SAME eval as the upload check (to catch the
  // pre-unmount moment), then verify success by checking body text or upload widget.
  const selectors = ['#resume', '#resume_input', 'input[type=file][name=resume]', 'input[type=file]'];
  let usedSelector = null;
  let lastUpload = null;
  for (const sel of selectors) {
    const u = cdp('upload', tab, sel, RESUME);
    lastUpload = u;
    if (u.stdout.includes('"ok":true')) {
      usedSelector = sel;
      break;
    }
  }
  if (!usedSelector) return { ok: false, note: 'cdp_upload_failed', detail: lastUpload?.stdout || lastUpload?.stderr || '' };
  // Try to dispatch change but don't fail if element is already gone
  const immediate = await evalInTab(tab, `
    (() => {
      const r = document.querySelector(${JSON.stringify(usedSelector)});
      if (r) {
        const files = r.files ? r.files.length : 0;
        const name = r.files?.[0]?.name || '';
        r.dispatchEvent(new Event('change', { bubbles: true }));
        return { dispatched: true, files, name };
      }
      return { dispatched: false, note: 'element_already_unmounted' };
    })()
  `);
  // Wait + verify by body text (GH shows "resume.pdf" or similar on success)
  await sleep(1200);
  const verify = await evalInTab(tab, `
    (() => {
      const txt = document.body.innerText;
      // Look for the actual filename appearing in the form (success indicator)
      return {
        has_resume_text: /resume\\.pdf|resume[_\\s-]?[\\w-]*\\.pdf/i.test(txt),
        has_replace_btn: /\\bReplace\\b/.test(txt),
      };
    })()
  `);
  return {
    ok: immediate.files > 0 || immediate.note === 'element_already_unmounted' || verify.has_resume_text || verify.has_replace_btn,
    selector: usedSelector,
    immediate,
    ...verify,
  };
}

// ---------- fill basic text fields ----------
async function fillBasic(tab) {
  cdp('typetext', tab, '#first_name', PROFILE.personal.first_name);
  cdp('typetext', tab, '#last_name', PROFILE.personal.last_name);
  cdp('typetext', tab, '#email', PROFILE.personal.email);
  // Phone: digits only — intl-tel-input formats it
  const digits = (PROFILE.personal.phone || '').replace(/\D/g, '').replace(/^1/, '');
  if (digits) cdp('typetext', tab, '#phone', digits);
  return { ok: true };
}

// ============================================================
// react-select handlers (sync vs async branches)
// ============================================================
// LESSON 2026-05-26: react-select REQUIRES a full MouseEvent with button:0, buttons:1
// on the .select__control. A plain .click() or generic mousedown does NOT open the menu.
// After typing, options arrive ASYNC (Google Places autocomplete for location) — wait 3-4s.
// Match by exact innerText OR by city prefix + region; do NOT match partial 'Boston' to
// 'East Boston'.

// AsyncSelect variant — works for Location (Google Places). Pattern: mousedown on
// .select__control → type → wait for async options → mousedown the matching option.
async function reactSelectAsync(tab, fieldId, optionText, opts = {}) {
  const fullMatchKeywords = opts.fullMatchKeywords || [];
  // 1. Click + focus the control with real MouseEvent
  const openRes = await evalInTab(tab, `
    (() => {
      const input = document.getElementById(${JSON.stringify(fieldId)});
      if (!input) return { ok:false, note:'no_input' };
      const ctl = input.closest('.select__control');
      if (!ctl) return { ok:false, note:'no_control' };
      ctl.scrollIntoView({block:'center'});
      const r = ctl.getBoundingClientRect();
      ctl.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true, clientX:r.left+5, clientY:r.top+5, button:0, buttons:1 }));
      ctl.dispatchEvent(new MouseEvent('mouseup',   { bubbles:true, cancelable:true, clientX:r.left+5, clientY:r.top+5, button:0, buttons:0 }));
      input.focus();
      return { ok:true };
    })()
  `);
  if (!openRes.ok) return openRes;
  await sleep(500);
  // 2. Type
  cdp('typetext', tab, '#' + fieldId, optionText);
  // 3. Wait for async options (Google Places needs longer)
  await sleep(3500);
  // 4. Pick matching option with full MouseEvent
  const pickRes = await evalInTab(tab, `
    (() => {
      const target = ${JSON.stringify(optionText.toLowerCase())};
      const fullKeywords = ${JSON.stringify(fullMatchKeywords.map(s => s.toLowerCase()))};
      const opts = [...document.querySelectorAll('.select__option, [role=option]')].filter(o => o.offsetParent !== null && !/\\+\\d{1,4}$/.test(o.innerText.trim()));
      if (opts.length === 0) return { ok:false, note:'no_options', target };
      // Match strategy: prefer option that contains target AND all fullMatchKeywords
      let match = opts.find(o => {
        const txt = o.innerText.trim().toLowerCase();
        if (!txt.includes(target)) return false;
        return fullKeywords.every(k => txt.includes(k));
      });
      if (!match) match = opts.find(o => o.innerText.trim().toLowerCase() === target);
      if (!match) match = opts.find(o => o.innerText.trim().toLowerCase().includes(target));
      if (!match) return { ok:false, note:'no_option_match', sample: opts.slice(0,5).map(o => o.innerText.trim()) };
      match.scrollIntoView({block:'center'});
      const r = match.getBoundingClientRect();
      match.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true, clientX:r.left+5, clientY:r.top+5, button:0, buttons:1 }));
      match.dispatchEvent(new MouseEvent('mouseup',   { bubbles:true, cancelable:true, clientX:r.left+5, clientY:r.top+5, button:0, buttons:0 }));
      match.click();
      return { ok:true, picked: match.innerText.trim() };
    })()
  `);
  return pickRes;
}

// Sync Select variant — works for Country (static country list). The AsyncSelect
// mousedown-on-control trick does NOT open the sync Select (count:0 options,
// aria-expanded stays false). Try in order:
//   (a) Mousedown on the chevron button (.select__indicators button), THEN type
//   (b) Focus the input and dispatch keydown ArrowDown (sync Select opens on this)
//   (c) Mousedown on the control as a last-resort retry
// TODO(handoff): not verified against a live GH tenant in this refactor session
// (no CDP available). If Country still won't open, also try:
//   - InputEvent with `nativeInputValueSetter` (Object.getOwnPropertyDescriptor
//     on HTMLInputElement.prototype.value).set.call(input, optionText))
//   - .select__control 'click' event after mousedown/mouseup
//   - Click the visible "Country" label to focus the combobox
async function reactSelectSync(tab, fieldId, optionText, opts = {}) {
  const fullMatchKeywords = opts.fullMatchKeywords || [];
  // 1. Try opening via chevron button OR keydown ArrowDown
  const openRes = await evalInTab(tab, `
    (() => {
      const input = document.getElementById(${JSON.stringify(fieldId)});
      if (!input) return { ok:false, note:'no_input' };
      const ctl = input.closest('.select__control');
      if (!ctl) return { ok:false, note:'no_control' };
      const container = input.closest('.select__container') || input.closest('.select-shell') || input.closest('.select');
      ctl.scrollIntoView({block:'center'});
      input.focus();

      // (a) Try chevron — .select__indicators button or .select__dropdown-indicator
      const chevron = (container || ctl).querySelector('.select__indicators button, .select__dropdown-indicator, [class*=indicator] button, [class*=dropdown-indicator]');
      if (chevron) {
        const r = chevron.getBoundingClientRect();
        chevron.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true, clientX:r.left+3, clientY:r.top+3, button:0, buttons:1 }));
        chevron.dispatchEvent(new MouseEvent('mouseup',   { bubbles:true, cancelable:true, clientX:r.left+3, clientY:r.top+3, button:0, buttons:0 }));
        chevron.click();
      }

      // (b) Synthesize ArrowDown keydown on input — sync Select opens on this
      const evInit = { bubbles:true, cancelable:true, key:'ArrowDown', code:'ArrowDown', keyCode:40, which:40 };
      input.dispatchEvent(new KeyboardEvent('keydown', evInit));
      input.dispatchEvent(new KeyboardEvent('keyup', evInit));

      const expanded = input.getAttribute('aria-expanded') === 'true';
      return { ok:true, expanded, chevron_found: !!chevron };
    })()
  `);
  if (!openRes.ok) return openRes;
  await sleep(400);

  // 2. Type the option (sync Select filters in-memory)
  await evalInTab(tab, `
    (() => {
      const input = document.getElementById(${JSON.stringify(fieldId)});
      if (!input) return { ok:false, note:'no_input' };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(input, '');
      else input.value = '';
      input.dispatchEvent(new Event('input', { bubbles:true }));
      return { ok:true };
    })()
  `);
  cdp('typetext', tab, '#' + fieldId, optionText);
  // Static list — much faster than async, but give React a beat.
  await sleep(800);

  // 3. Pick the matching option. SCOPE to the field's own .select__menu so we
  //    don't pick up intl-tel-input phone-country options.
  const pickRes = await evalInTab(tab, `
    (() => {
      const target = ${JSON.stringify(optionText.toLowerCase())};
      const fullKeywords = ${JSON.stringify(fullMatchKeywords.map(s => s.toLowerCase()))};
      const input = document.getElementById(${JSON.stringify(fieldId)});
      if (!input) return { ok:false, note:'no_input' };
      const container = input.closest('.select__container') || input.closest('.select-shell') || input.closest('.select') || document.body;
      // Restrict to options visible inside this field's container/menu.
      const menu = container.querySelector('.select__menu') || container;
      let opts = [...menu.querySelectorAll('.select__option, [role=option]')].filter(o => o.offsetParent !== null);
      // If that came up empty (e.g. menu portal'd to body), fall back to global
      // but still filter out the phone country '+1' style entries.
      if (opts.length === 0) {
        opts = [...document.querySelectorAll('.select__option, [role=option]')]
          .filter(o => o.offsetParent !== null && !/\\+\\d{1,4}$/.test(o.innerText.trim()));
      }
      if (opts.length === 0) return { ok:false, note:'no_options_in_menu', target, aria_expanded: input.getAttribute('aria-expanded') };

      let match = opts.find(o => {
        const txt = o.innerText.trim().toLowerCase();
        if (!txt.includes(target)) return false;
        return fullKeywords.every(k => txt.includes(k));
      });
      if (!match) match = opts.find(o => o.innerText.trim().toLowerCase() === target);
      if (!match) match = opts.find(o => o.innerText.trim().toLowerCase().includes(target));
      if (!match) return { ok:false, note:'no_option_match', sample: opts.slice(0,5).map(o => o.innerText.trim()) };
      match.scrollIntoView({block:'center'});
      const r = match.getBoundingClientRect();
      match.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true, clientX:r.left+5, clientY:r.top+5, button:0, buttons:1 }));
      match.dispatchEvent(new MouseEvent('mouseup',   { bubbles:true, cancelable:true, clientX:r.left+5, clientY:r.top+5, button:0, buttons:0 }));
      match.click();
      return { ok:true, picked: match.innerText.trim() };
    })()
  `);
  return pickRes;
}

// Dispatcher: detect-and-branch wrapper.
// Heuristic: if fieldId is 'country' (well-known static list), use sync.
// Otherwise default to async (Location, etc.). Caller can force a mode via
// opts.mode = 'sync' | 'async'.
async function reactSelect(tab, fieldId, optionText, opts = {}) {
  const mode = opts.mode || (/country/i.test(fieldId) ? 'sync' : 'async');
  const first = mode === 'sync' ? reactSelectSync : reactSelectAsync;
  const r = await first(tab, fieldId, optionText, opts);
  if (r.ok) return r;
  // Fallback: try the other strategy. Cheap belt-and-suspenders since both
  // heuristics can be wrong on tenant-customized GH forms.
  log(`reactSelect ${mode} failed (${r.note || 'unknown'}) — trying other variant`);
  const other = mode === 'sync' ? reactSelectAsync : reactSelectSync;
  const r2 = await other(tab, fieldId, optionText, opts);
  return r2.ok ? { ...r2, fallback_mode: mode === 'sync' ? 'async' : 'sync' } : r;
}

async function reactSelectOneOf(tab, fieldId, optionTexts, opts = {}) {
  const candidates = [...new Set(optionTexts.filter(Boolean))];
  let last = null;
  for (const optionText of candidates) {
    const r = await reactSelect(tab, fieldId, optionText, opts);
    if (r.ok) return { ...r, requested: optionText };
    last = { ...r, requested: optionText };
    log(`reactSelect candidate failed for #${fieldId}: ${optionText} (${r.note || 'unknown'})`);
  }
  return last || { ok: false, note: 'no_candidates' };
}

async function selectNativeOneOf(tab, fieldId, optionTexts) {
  const candidates = [...new Set(optionTexts.filter(Boolean).map(String))];
  if (candidates.length === 0) return { ok: false, note: 'no_candidates' };
  return await evalInTab(tab, `
    (() => {
      const el = document.getElementById(${JSON.stringify(fieldId)});
      const candidates = ${JSON.stringify(candidates.map((s) => s.toLowerCase()))};
      if (!el) return { ok:false, note:'no_input' };
      if (el.tagName !== 'SELECT') return { ok:false, note:'not_native_select', tag: el.tagName, type: el.type };
      const options = [...el.options];
      let match = null;
      for (const candidate of candidates) {
        match = options.find((o) => (o.textContent || '').trim().toLowerCase() === candidate)
          || options.find((o) => String(o.value || '').trim().toLowerCase() === candidate)
          || options.find((o) => (o.textContent || '').trim().toLowerCase().includes(candidate));
        if (match) break;
      }
      if (!match) return { ok:false, note:'no_option_match', sample: options.slice(0, 12).map((o) => o.textContent.trim()) };
      el.value = match.value;
      el.dispatchEvent(new Event('input', { bubbles:true }));
      el.dispatchEvent(new Event('change', { bubbles:true }));
      return { ok:true, picked: match.textContent.trim(), value: match.value };
    })()
  `);
}

async function clickVisibleConsentCheckboxes(tab) {
  const r = await evalInTab(tab, `
    (() => {
      const keywords = /acknowledge|confirm|candidate privacy|privacy policy|certify|certification|review/i;
      const avoid = /gender|race|ethnic|veteran|disability|hispanic|pronoun|newsletter|marketing|sms|text message|email|phone|contact|communication|updates?/i;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
      const clicked = [];
      const cbs = [...document.querySelectorAll('input[type=checkbox]')];
      for (const cb of cbs) {
        let txt = '';
        const label = cb.id ? document.querySelector('label[for="' + CSS.escape(cb.id) + '"]') : null;
        if (label) txt += ' ' + (label.innerText || '');
        const wrap = cb.closest('label, .input-wrapper, .application--question, fieldset, div');
        let node = wrap || cb.parentElement;
        for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
          const part = (node.innerText || '').replace(/\\s+/g, ' ').trim();
          if (part) txt += ' ' + part;
          if (keywords.test(txt) || txt.length > 500) break;
        }
        txt = txt.replace(/\\s+/g, ' ').trim();
        if (!txt || !keywords.test(txt) || avoid.test(txt)) continue;
        const visible = cb.offsetParent !== null || label?.offsetParent !== null || wrap?.offsetParent !== null;
        if (!visible) continue;
        const target = label || cb;
        try { target.scrollIntoView({ block:'center', behavior:'instant' }); } catch (_) { target.scrollIntoView({ block:'center' }); }
        if (!cb.checked) {
          const box = target.getBoundingClientRect();
          target.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true, clientX:box.left+5, clientY:box.top+5, button:0, buttons:1 }));
          target.dispatchEvent(new MouseEvent('mouseup', { bubbles:true, cancelable:true, clientX:box.left+5, clientY:box.top+5, button:0, buttons:0 }));
          target.click();
        }
        if (!cb.checked && setter) setter.call(cb, true);
        cb.dispatchEvent(new Event('input', { bubbles:true }));
        cb.dispatchEvent(new Event('change', { bubbles:true }));
        clicked.push({ id: cb.id || null, text: txt.slice(0, 100), checked: cb.checked });
      }
      return { ok:true, clicked };
    })()
  `);
  if (r.clicked?.length) log('Clicked consent checkboxes:', JSON.stringify(r.clicked).slice(0, 240));
  return r;
}

// ---------- submit + read errors ----------
async function submitAndCheck(tab) {
  await evalInTab(tab, `
    (() => {
      // Look for the actual application submit button (type=submit + "Submit application" text)
      const btn = [...document.querySelectorAll('button[type=submit], input[type=submit]')]
        .find(b => /submit application/i.test(b.innerText || b.value || ''))
        || [...document.querySelectorAll('button')].find(b => /submit application/i.test(b.innerText || ''))
        || [...document.querySelectorAll('button[type=submit]')].find(b => /submit/i.test(b.innerText || ''));
      if (!btn) return { ok:false, note: 'no_submit_btn' };
      btn.scrollIntoView({block:'center'});
      const r = btn.getBoundingClientRect();
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true, clientX:r.left+5, clientY:r.top+5, button:0, buttons:1 }));
      btn.dispatchEvent(new MouseEvent('mouseup',   { bubbles:true, cancelable:true, clientX:r.left+5, clientY:r.top+5, button:0, buttons:0 }));
      btn.click();
      return { ok:true, text: btn.innerText || btn.value };
    })()
  `);
  await sleep(5000);
  return await evalInTab(tab, `
    (() => {
      const body = document.body.innerText;
      const strictSuccess = /successfully submitted|application[\\s\\S]{0,30}(received|success)|thanks? for (applying|submitting)|thank you for (applying|submitting|your application)/i.test(body);
      const greenhouseConfirmation =
        /\\/confirmation(?:[?#]|$)/i.test(location.href) &&
        /thank you for your interest|receiv(?:e|ing)[\\s\\S]{0,80}email|next steps in the hiring process|track your status/i.test(body);
      const success = strictSuccess || greenhouseConfirmation;
      // GH-style: error helper text is inside .input-wrapper--error or .select__control--error containers
      // The label sits in a sibling/parent. Walk back from each .helper-text--error to the field label.
      const missing = [];
      const seen = new Set();
      function addMissing(labelTxt) {
        labelTxt = String(labelTxt || '')
          .replace(/This field is required\.?/gi, '')
          .replace(/Missing entry for required field:?/gi, '')
          .split('\\n')
          .map(s => s.trim())
          .filter(Boolean)[0] || '';
        labelTxt = labelTxt.replace(/\\*+$/, '').trim();
        if (labelTxt && !seen.has(labelTxt) && labelTxt.length < 1000) {
          seen.add(labelTxt);
          missing.push(labelTxt);
        }
      }
      function labelNear(el) {
        for (let node = el; node && node !== document.body; node = node.parentElement) {
          const lbl = node.querySelector?.('label, legend, [class*=label]:not([class*=error])');
          if (lbl?.innerText?.trim()) return lbl.innerText.trim();
        }
        return '';
      }
      const errHelpers = [...document.querySelectorAll('.helper-text--error, .field-error, .error')].filter(e => e.offsetParent !== null);
      for (const eh of errHelpers) {
        let wrap = eh.closest('.field-wrapper, .input-wrapper, .select__container, .application--question, fieldset, [class*=field]');
        if (!wrap) {
          for (let node = eh.parentElement; node; node = node.parentElement) {
            const lbl = node.querySelector?.('label, legend, [class*=label]:not([class*=error])');
            if (lbl) { wrap = node; break; }
            if (node === document.body) break;
          }
        }
        if (!wrap) continue;
        let labelTxt = labelNear(eh);
        if (!labelTxt) labelTxt = labelNear(wrap);
        if (!labelTxt) labelTxt = wrap.innerText || eh.innerText || '';
        addMissing(labelTxt);
      }
      // Also legacy parse: "Missing entry for required field: X"
      const errBlocks = [...document.querySelectorAll('#application_form_errors, [role=alert], [aria-live]')]
        .map(e => (e.innerText || '').trim()).filter(s => s.length > 0 && s.length < 800);
      for (const e of errBlocks) {
        const matches = e.matchAll(/Missing entry for required field:?\\s*([^\\n]+)/gi);
        for (const m of matches) {
          addMissing(m[1]);
        }
      }
      const invalids = [...document.querySelectorAll('[aria-invalid="true"], input[required][aria-invalid="true"], select[required][aria-invalid="true"], textarea[required][aria-invalid="true"]')]
        .filter(el => el.offsetParent !== null || el.id);
      for (const el of invalids) {
        const lbl = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
        addMissing(lbl?.innerText || labelNear(el));
      }
      return { success, missing, url: location.href, body_snippet: body.slice(0, 250) };
    })()
  `);
}

// ---------- find field by label, fill it ----------
async function findFieldByLabel(tab, labelText) {
  return await evalInTab(tab, `
    (() => {
      const target = ${JSON.stringify(labelText.toLowerCase().slice(0, 50))};
      const labels = [...document.querySelectorAll('label')];
      const lbl = labels.find(l => l.innerText.trim().toLowerCase().includes(target));
      if (!lbl) return { ok:false, note:'no_label' };
      const id = lbl.getAttribute('for');
      if (id) {
        const inp = document.getElementById(id);
        if (inp) return { ok:true, id, type: inp.type || inp.tagName.toLowerCase(), is_react_select: !!inp.closest('.select__control') };
      }
      // Sibling input
    const wrap = lbl.closest('.field-wrapper, .input-wrapper, .select__container, .application--question, fieldset, div');
    const inp = wrap?.querySelector('input, textarea, select');
      if (inp) {
        if (!inp.id) inp.id = 'mrw_field_' + Math.random().toString(36).slice(2, 8);
        return { ok:true, id: inp.id, type: inp.type || inp.tagName.toLowerCase(), is_react_select: !!inp.closest('.select__control') };
      }
      return { ok:false, note:'no_input_for_label' };
    })()
  `);
}

async function answerMissing(tab, labelText) {
  const lt = labelText.toLowerCase();

  if (/privacy policy|candidate privacy/i.test(lt)) {
    const privacyCheckbox = await evalInTab(tab, `
      (() => {
        const target = ${JSON.stringify(lt.slice(0, 60))};
        const cbs = [...document.querySelectorAll('input[type=checkbox]')];
        for (const cb of cbs) {
          let wrap = cb.parentElement;
          let txt = '';
          for (let i = 0; i < 8 && wrap; i++, wrap = wrap.parentElement) {
            txt = (wrap.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase();
            if (txt.includes(target) || /privacy policy|candidate privacy/.test(txt)) break;
          }
          if (txt.includes(target) || /privacy policy|candidate privacy/.test(txt)) {
            try { cb.scrollIntoView({ block:'center', behavior:'instant' }); } catch (_) { cb.scrollIntoView({ block:'center' }); }
            if (!cb.checked) cb.click();
            cb.dispatchEvent(new Event('input', { bubbles:true }));
            cb.dispatchEvent(new Event('change', { bubbles:true }));
            return { ok: cb.checked, mode:'privacy_checkbox' };
          }
        }
        return { ok:false, note:'privacy_checkbox_not_found' };
      })()
    `);
    if (privacyCheckbox.ok) return privacyCheckbox;
    // Some Greenhouse tenants render privacy consent as a required select, not a checkbox.
    // Fall through to label-based field handling and standardYesNoAnswerForLabel().
  }

  // PHASE 0: essay templates (long-text Qs) — try first
  if (essayAnswerFor(labelText)) {
    const ans = essayAnswerFor(labelText);
    const fEssay = await evalInTab(tab, `
      (() => {
        const targetQ = ${JSON.stringify(lt.slice(0, 40))};
        const cands = [...document.querySelectorAll("textarea, input[type=text]")].filter(el => el.offsetParent !== null);
        for (const inp of cands) {
          const wrap = inp.closest("fieldset, div, .field");
          const txt = wrap ? (wrap.innerText || '').toLowerCase() : '';
          if (txt.includes(targetQ)) {
            if (!inp.id) inp.id = 'mrw_essay_' + Math.random().toString(36).slice(2,8);
            const sel = /^[0-9]/.test(inp.id) ? '[id="' + inp.id + '"]' : '#' + inp.id;
            return { ok:true, sel };
          }
        }
        return { ok:false };
      })()
    `);
    if (fEssay.ok) {
      cdp('typetext', tab, fEssay.sel, ans);
      return { ok: true, mode: 'essay_template' };
    }
  }

  const f = await findFieldByLabel(tab, labelText);
  if (!f.ok) return { ok: false, note: 'find_failed', detail: f, pending_for_main_claude: shouldQueueForMainClaude(labelText), question: labelText };

  const profileSpecificText = profileSpecificTextAnswerForLabel(labelText);
  if (profileSpecificText && (f.type === 'text' || f.type === 'textarea')) {
    return { ok: false, ...profileSpecificText };
  }

  if (f.type === 'file') {
    const isCoverLetter = /cover/i.test(lt) || /cover/i.test(f.id || '');
    const isResume = /resume|cv\b|curriculum vitae/i.test(lt) || /resume|cv\b/i.test(f.id || '');
    if (!isCoverLetter && !isResume) {
      return { ok: false, note: 'supplemental_file_required', needs_user_answer: true };
    }
    if (isCoverLetter && (!COVER_LETTER || !existsSync(COVER_LETTER))) {
      return {
        ok: false,
        note: 'cover_letter_required_not_generated',
        manual_required: true,
        needs_user_answer: true,
        detail: process.env.MRWEIRDO_COVER_LETTER_GENERATION_REASON || 'no_d1_cover_letter_path',
      };
    }
    const filePath = isCoverLetter ? COVER_LETTER : RESUME;
    const sel = /^[0-9]/.test(f.id) ? `[id="${f.id}"]` : '#' + f.id;
    const upload = cdp('upload', tab, sel, filePath);
    if (!upload.stdout.includes('"ok":true')) return { ok: false, note: 'file_upload_failed', detail: upload.stdout || upload.stderr };
    await evalInTab(tab, `
      (() => {
        const input = document.getElementById(${JSON.stringify(f.id)});
        if (!input) return { ok:false, note:'input_unmounted_after_upload' };
        input.dispatchEvent(new Event('input', { bubbles:true }));
        input.dispatchEvent(new Event('change', { bubbles:true }));
        return { ok:true, files: input.files?.length || 0 };
      })()
    `);
    if (isCoverLetter) coverLetterUploaded = true;
    return { ok: true, mode: isCoverLetter ? 'cover_letter_upload' : 'file_upload' };
  }

  const profileAddress = profileAddressValueForLabel(labelText);
  if (profileAddress?.needs_user_answer) {
    return { ok: false, note: profileAddress.note, needs_user_answer: true };
  }
  const availability = availabilityCommitmentAnswer(labelText, { searchIntent: SEARCH_INTENT, profile: PROFILE, bank: BANK });
  if (availability?.needs_user_answer) {
    return { ok: false, note: availability.note, needs_user_answer: true };
  }

  if (/which .{0,80}(?:masters?|ph\.?d|doctor|graduate).{0,80}program|(?:masters?|ph\.?d).{0,80}program.*currently/.test(lt)) {
    const value = isGraduateDegreeProfile()
      ? [profileSchool, profileDegree, profileMajor].filter(Boolean).join(' - ')
      : 'N/A';
    const fGrad = await findFieldByLabel(tab, labelText);
    if (fGrad.ok && (fGrad.type === 'text' || fGrad.type === 'textarea')) {
      const sel = /^[0-9]/.test(fGrad.id) ? `[id="${fGrad.id}"]` : '#' + fGrad.id;
      cdp('typetext', tab, sel, value);
      return { ok: true, mode: 'graduate_program_text_fill', value };
    }
  }

  const dateValue = dateValueForLabel(labelText);
  if (dateValue) {
    if (f.is_react_select) return await reactSelectOneOf(tab, f.id, dateValue.candidates, { mode: 'sync' });
    if (f.type === 'select-one' || f.type === 'select') return await selectNativeOneOf(tab, f.id, dateValue.candidates);
    const value = dateValue.candidates[0] || '';
    if (!value) return { ok: false, note: 'date_value_missing' };
    const sel = /^[0-9]/.test(f.id) ? `[id="${f.id}"]` : '#' + f.id;
    cdp('typetext', tab, sel, value);
    return { ok: true, mode: 'date_text_fill', value };
  }

  const currentLocationFact = currentLocationFactAnswerForLabel(labelText);
  if (currentLocationFact?.value) {
    if (f.is_react_select) {
      return await reactSelectOneOf(tab, f.id, [currentLocationFact.value], { mode: 'sync' });
    }
    if (f.type === 'select-one' || f.type === 'select') {
      return await selectNativeOneOf(tab, f.id, [currentLocationFact.value]);
    }
    if (f.type === 'text' || f.type === 'textarea') {
      const sel = /^[0-9]/.test(f.id) ? `[id="${f.id}"]` : '#' + f.id;
      cdp('typetext', tab, sel, currentLocationFact.value);
      return { ok: true, mode: 'current_location_fact_text', value: currentLocationFact.value, note: currentLocationFact.note };
    }
    return { ok: false, note: 'current_location_fact_unhandled_field', detail: { ...currentLocationFact, field: f } };
  }

  const workAuthGap = workAuthGapFor(labelText, PROFILE); // 3-state personal fact: never asked -> ask, never invent
  if (workAuthGap) return { ok: false, note: workAuthGap.note, needs_user_answer: true, question: labelText };
  const standardYesNo = standardYesNoAnswerForLabel(labelText);
  if (standardYesNo?.needs_user_answer) return { ok: false, note: standardYesNo.note, needs_user_answer: true };
  if (standardYesNo?.value) {
    const standardCandidates = standardYesNo.candidates || [standardYesNo.value];
    if (f.is_react_select) {
      return await reactSelectOneOf(tab, f.id, standardCandidates, { mode: 'sync' });
    }
    if (f.type === 'select-one' || f.type === 'select') {
      return await selectNativeOneOf(tab, f.id, standardCandidates);
    }
    if (f.type === 'text' || f.type === 'textarea') {
      const sel = /^[0-9]/.test(f.id) ? `[id="${f.id}"]` : '#' + f.id;
      cdp('typetext', tab, sel, standardYesNo.value);
      return { ok: true, mode: 'standard_yes_no_text', value: standardYesNo.value, note: standardYesNo.note };
    }
    return { ok: false, note: 'standard_yes_no_unhandled_field', detail: { ...standardYesNo, field: f } };
  }

  if (/work environment|work arrangement|work style|work setting|work mode/i.test(lt) && f.is_react_select) {
    return await reactSelectOneOf(tab, f.id, ['Any of these', 'Hybrid', 'Fully remote', 'On-site', 'Onsite'], { mode: 'sync' });
  }

  const templatedAnswer = essayAnswerFor(labelText);
  if (templatedAnswer && (f.type === 'text' || f.type === 'textarea' || f.is_react_select)) {
    const sel = /^[0-9]/.test(f.id) ? `[id="${f.id}"]` : '#' + f.id;
    cdp('typetext', tab, sel, templatedAnswer);
    await evalInTab(tab, `
      (() => {
        const el = document.getElementById(${JSON.stringify(f.id)});
        if (!el) return { ok:false };
        el.dispatchEvent(new Event('input', { bubbles:true }));
        el.dispatchEvent(new Event('change', { bubbles:true }));
        return { ok:true, value: el.value || '' };
      })()
    `);
    return { ok: true, mode: 'essay_template_direct_field_fill', answer_len: templatedAnswer.length };
  }

  // Work-auth facts: profile only, three-state. null = never asked (blocked at the top of answerMissing).
  const { sponsorAns, authorizedAns } = deriveWorkAuthAnswers(PROFILE);

  // City / Location / Country
  if (/\b(?:location|city|country|state|province)\b/i.test(lt) || f.is_react_select) {
    let value;
    let mode = 'async';
    if (profileAddress?.value && /^state$|state\/province|province|region|state of residence|residence state|home state|current state/.test(lt)) {
      value = profileAddress.value;
      mode = 'sync';
    }
    else if (profileAddress?.value && /^city$|^town$/.test(lt)) {
      value = profileAddress.value;
      mode = 'async';
    }
    else if (/master'?s|masters|graduate degree/i.test(lt)) { value = isGraduateDegreeProfile() ? 'Yes' : 'No'; mode = 'sync'; }
    else if (/legally authorized|authorized to work|work authorization|work authorised/i.test(lt)) { if (!authorizedAns) return { ok: false, note: 'work_authorization_required', needs_user_answer: true }; value = authorizedAns; mode = 'sync'; }
    else if (/school|college|university/i.test(lt) && !/confirm|enrolled/i.test(lt)) { value = profileSchool; mode = 'async'; }
    else if (/completed.*bachelor|bachelor.*(?:completed|progress|working towards)|currently working towards.*bachelor/i.test(lt)) {
      return await reactSelectOneOf(tab, f.id, bachelorProgressCandidates(PROFILE), { mode: 'sync' });
    }
    else if (/based on the team descriptions|which team|team preference|preferred team/i.test(lt)) {
      return await reactSelectOneOf(tab, f.id, ['Search and Recommendations', 'Search & Recommendations', 'Risk Management', 'Data Science', 'Product Analytics'], { mode: 'sync' });
    }
    else if (/before seeing.*job posting|how familiar|familiar.*faire|familiar.*company/i.test(lt)) {
      const r = await reactSelectOneOf(tab, f.id, ['Unaware', 'Not familiar', 'Not at all familiar', 'I was not familiar', 'Somewhat familiar'], { mode: 'sync' });
      companyFamiliarityAnswer = r.ok && /unaware/i.test(`${r.picked || ''} ${r.requested || ''}`) ? 'unaware' : 'not_unaware';
      return r;
    }
    else if (/do you consider yourself a member of|which categories describe you|community.*member|underrepresented/i.test(lt)) {
      return await reactSelectOneOf(tab, f.id, ["I don't wish to answer", 'I prefer not to answer', 'Prefer not to answer', 'Decline to answer', 'None of the above'], { mode: 'sync' });
    }
    else if (/degree/i.test(lt)) { value = degreeSelectValue(); mode = 'sync'; }
    else if (/discipline|major|field of study/i.test(lt)) { value = profileMajor; mode = 'sync'; }
    else if (/current location|where are you located|where.*located|where.*based/i.test(lt)) {
      value = preferredCandidateLocationFull();
      if (!f.is_react_select && f.type !== 'select-one' && f.type !== 'select') {
        const sel = /^[0-9]/.test(f.id) ? `[id="${f.id}"]` : '#' + f.id;
        if (!value) return { ok: false, note: 'candidate_location_empty' };
        cdp('typetext', tab, sel, value);
        return { ok: true, mode: 'candidate_location_text_fill', value };
      }
    }
    else if (/country/i.test(lt)) { value = 'United States'; mode = 'sync'; }
    else if (/spanish|mandarin|french|german|language|proficiency|fluen/i.test(lt)) {
      value = languageProficiencyForLabel(labelText);
      if (!value) return { ok: false, note: 'language_proficiency_not_in_profile', needs_user_answer: true };
      mode = 'sync';
    }
    else if (availability?.value) {
      return await reactSelectOneOf(tab, f.id, availability.candidates || [availability.value], { mode: 'sync' });
    }
    else if (/what city.*currently reside|city.*currently reside|currently reside.*city/i.test(lt)) {
      value = preferredCandidateCity();
      if (!f.is_react_select && f.type !== 'select-one' && f.type !== 'select') {
        const sel = /^[0-9]/.test(f.id) ? `[id="${f.id}"]` : '#' + f.id;
        if (!value) return { ok: false, note: 'candidate_city_empty' };
        cdp('typetext', tab, sel, value);
        return { ok: true, mode: 'current_city_text_fill', value };
      }
    }
    else if (/currently\s+(?:reside|live)|do you currently reside|currently based|are you based/i.test(lt)) {
      const cur = currentResidenceAnswerForLabel(labelText);
      value = cur.value || 'No';
      mode = 'sync';
    }
    else if (/relocate|willing.*location|currently live|reside|resident|residency|based (?:in|there)|confirmed plans|located in|on-?site|office|commute/i.test(lt)) {
      const loc = locationDecisionForLabel(labelText);
      if (!loc.ok) return { ok: false, note: 'location_not_in_profile_preferences', detail: loc, needs_user_answer: true };
      value = 'Yes';
      mode = 'sync';
    }
    else if (/expect(?:ed)? to graduate|graduation date|graduation year|graduate.*program|when do you expect|complete your program/i.test(lt)) {
      return await reactSelectOneOf(tab, f.id, graduationSelectValues(), { mode: 'sync' });
    }
    else if (/\b(?:location|city)\b/i.test(lt)) value = preferredCandidateCity();
    else if (/sponsor|work auth|visa/i.test(lt)) { if (!sponsorAns) return { ok: false, note: 'sponsorship_future_required', needs_user_answer: true }; value = sponsorAns; }
    else if (/enrolled.*university|currently enrolled/i.test(lt)) {
      value = educationEnrollmentAnswerForLabel(labelText).value;
      mode = 'sync';
    }
    else if (/full.?time|consider.*ft|consideration for|full.?time offer/i.test(lt)) { value = 'Need to return to school and available upon graduation'; mode = 'sync'; }
    else if (/available to start|earliest.*start|start date|when can you start/i.test(lt)) { value = earliestStartDate(); mode = 'sync'; }
    else if (/gender/i.test(lt)) {
      return await reactSelectOneOf(tab, f.id, ["I don't wish to answer", 'I prefer not to answer', 'Prefer not to answer', "Don't want to answer", BANK.yes_no_defaults?.gender], { mode: 'sync' });
    }
    else if (/race|ethnic|hispanic|latino/i.test(lt)) {
      return await reactSelectOneOf(tab, f.id, ["I don't wish to answer", 'I prefer not to answer', 'Prefer not to answer', "Don't want to answer", BANK.yes_no_defaults?.race], { mode: 'sync' });
    }
    else if (/veteran|military/i.test(lt)) {
      return await reactSelectOneOf(tab, f.id, ['No', "I don't wish to answer", 'I prefer not to answer', 'Prefer not to answer', BANK.yes_no_defaults?.veteran], { mode: 'sync' });
    }
    else if (/disab/i.test(lt)) value = BANK.yes_no_defaults?.disability || "I don't wish to answer";
    else if (/(how|where).{0,12}did.{0,8}you.{0,8}hear|hear about|job opening|source/i.test(lt)) value = (BANK.multichoice_preferences?.how_did_you_hear || ['LinkedIn'])[0];
    else if (/hours?.{0,12}per week|weekly hours|available.{0,20}hours/i.test(lt)) value = hoursPerWeekAnswer();
    else return { ok: false, note: 'no_value_rule_for_label:' + labelText.slice(0, 40) };

    if ((f.type === 'select-one' || f.type === 'select') && !f.is_react_select) {
      return await selectNativeOneOf(tab, f.id, profileAddress?.candidates || [value]);
    }
    const r = profileAddress?.candidates
      ? await reactSelectOneOf(tab, f.id, profileAddress.candidates, { mode })
      : await reactSelect(tab, f.id, value, { mode });
    if (!r.ok && /city.*currently reside|currently reside.*city/i.test(lt) && (r.note === 'no_control' || r.note === 'no_options' || r.note === 'no_options_in_menu')) {
      const sel = /^[0-9]/.test(f.id) ? `[id="${f.id}"]` : '#' + f.id;
      cdp('typetext', tab, sel, value);
      return { ok: true, mode: 'current_city_text_fallback', value, react_select_note: r.note };
    }
    return r;
  }

  // Text fields
  if (f.type === 'text' || f.type === 'textarea') {
    let value;
    if (profileAddress?.value) value = profileAddress.value;
    else if (/linkedin/i.test(lt)) value = PROFILE.personal.linkedin || BANK.fallback_text?.linkedin;
    else if (/project|portfolio|github|live url|website|shipped/i.test(lt)) value = profilePortfolio;
    else if (/preferred name/i.test(lt)) value = PROFILE.personal?.preferred_name || PROFILE.personal?.first_name || '';
    else if (/legal name/i.test(lt)) value = `${PROFILE.personal.first_name} ${PROFILE.personal.last_name}`;
    else if (/current location|where are you located|where.*currently located|where.*located|where.*based/i.test(lt)) value = preferredCandidateLocationFull();
    else if (/school|college|university/i.test(lt)) value = profileSchool;
    else if (/which .{0,40}(?:masters?|ph\.?d|doctor|graduate).{0,40}program|(?:masters?|ph\.?d).{0,40}program.*currently/i.test(lt)) {
      value = isGraduateDegreeProfile()
        ? [profileSchool, profileDegree, profileMajor].filter(Boolean).join(' - ')
        : 'N/A';
    }
    else if (/degree/i.test(lt)) value = profileDegree;
    else if (/discipline|major|field of study/i.test(lt)) value = profileMajor;
    else if (/spanish|mandarin|french|german|language|proficiency|fluen/i.test(lt)) {
      value = languageProficiencyForLabel(labelText);
      if (!value) return { ok: false, note: 'language_proficiency_not_in_profile', needs_user_answer: true };
    }
    else if (availability?.value) value = availability.value;
    else if (/(how|where).{0,12}did.{0,8}you.{0,8}hear|hear about|job opening|source/i.test(lt)) value = (BANK.multichoice_preferences?.how_did_you_hear || ['LinkedIn'])[0];
    else if (/before seeing.*job posting|how familiar|familiar.*faire|familiar.*company/i.test(lt)) {
      companyFamiliarityAnswer = 'unaware';
      value = 'Unaware';
    }
    else if (/do you consider yourself a member of|which categories describe you|community.*member|underrepresented/i.test(lt)) value = 'I prefer not to answer';
    else if (/hours?.{0,12}per week|weekly hours|available.{0,20}hours/i.test(lt)) value = hoursPerWeekAnswer();
    else if (/expect(?:ed)? to graduate|graduation date|graduation year|when do you expect|complete your program/i.test(lt)) value = monthYear(profileGraduationDate, '');
    else if (/available to start|earliest.*start|start date|when can you start/i.test(lt)) value = earliestStartDate();
    else if (/what city.*currently reside|city.*currently reside|currently reside.*city/i.test(lt)) value = preferredCandidateCity();
    else if (/currently\s+(?:reside|live)|do you currently reside|currently based|are you based/i.test(lt)) value = currentResidenceAnswerForLabel(labelText).value || 'No';
    else if (/salary|compensation|expected.*pay|expect.*paid|hourly.*rate/i.test(lt)) value = PROFILE.work_authorization?.salary_expectation_usd || BANK.fallback_text?.compensation_expectations || 'Negotiable';
    else if (/if .*employee.*selected|provide the employee name|if yes.*company|if yes.*explain|please.*explain.*yes/i.test(lt)) value = 'N/A';
    else if (/most recent employer|current employer|latest employer|^company name$|^company$/i.test(lt)) value = latestExperience?.company || '';
    else if (/most recent job title|current title|latest title|^title$|^job title$/i.test(lt)) value = latestExperience?.title || '';
    else if (/gpa/i.test(lt)) value = gpaValue(PROFILE);
    else if (essayAnswerFor(labelText)) value = essayAnswerFor(labelText);
    else if (shouldQueueForMainClaude(labelText)) return { ok: false, note: 'essay_answer_required', pending_for_main_claude: true, question: labelText };
    else return { ok: false, note: 'no_value_rule_text:' + labelText.slice(0, 40) };
    if (!value) return { ok: false, note: 'value_empty_for:' + lt.slice(0, 30) };
    // Leading-digit-safe selector
    const sel = /^[0-9]/.test(f.id) ? `[id="${f.id}"]` : '#' + f.id;
    cdp('typetext', tab, sel, value);
    return { ok: true, mode: 'text_fill', value };
  }

  // Checkbox: acknowledge / privacy / confirm, plus one safe source option.
  const sourceCheckbox = sourceCheckboxDecision(labelText);
  if (f.type === 'checkbox' && sourceCheckbox === 'skip') {
    return { ok: false, note: 'source_checkbox_option_not_selected' };
  }
  if (f.type === 'checkbox' && sourceCheckbox !== 'check' && !isAckCheckboxLabel(labelText)) {
    return { ok: false, note: 'checkbox_answer_required' };
  }
  if (f.type === 'checkbox' || isAckCheckboxLabel(labelText)) {
    const r = await evalInTab(tab, `
      (() => {
        // Find checkbox by label text — GH renders these as <input type=checkbox> with sibling label
        const target = ${JSON.stringify(labelText.toLowerCase().slice(0, 40))};
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
        const cbs = [...document.querySelectorAll('input[type=checkbox]')];
        for (const cb of cbs) {
          const wrap = cb.closest('.input-wrapper, .application--question, fieldset, div');
          const label = cb.id ? document.querySelector('label[for="' + CSS.escape(cb.id) + '"]') : null;
          const txt = ((label?.innerText || '') + ' ' + (wrap?.innerText || '')).toLowerCase();
          if (txt.includes(target)) {
            if (!cb.checked) {
              const clickTarget = label || cb;
              clickTarget.scrollIntoView({block:'center'});
              clickTarget.click();
            }
            if (!cb.checked && setter) setter.call(cb, true);
            cb.dispatchEvent(new Event('input',{bubbles:true}));
            cb.dispatchEvent(new Event('change',{bubbles:true}));
            return { ok:true, checked: cb.checked };
          }
        }
        return { ok:false, note:'no_checkbox_found' };
      })()
    `);
    return r;
  }

  return { ok: false, note: 'unhandled_field_type', f };
}

// Append essay_pending records to the central log so the Ashby driver's
// --list-pending-essays mode can surface them as well. (Greenhouse forms also
// generate essay_pending outcomes from time to time.)
function logEssayPending(rec) {
  try {
    appendFileSync(ESSAY_PENDING_LOG, JSON.stringify(rec) + '\n');
  } catch (e) {
    log('WARN: failed to append essay_pending log:', e.message);
  }
}

function classifyUnsubmitted(missing = [], blockers = []) {
  const labels = missing.map((m) => String(m || '').toLowerCase());
  const notes = blockers.map((b) => String(b?.note || '').toLowerCase());

	  if (notes.includes('cover_letter_required_not_generated') || notes.includes('cover_letter_file_required')) return 'cover_letter_required_not_generated';
  if (notes.includes('supplemental_file_required')) return 'supplemental_file_required';
  if (notes.includes('profile_full_address_required') || labels.some((l) => /address line|street address|postal code|zip code/.test(l))) {
    return 'profile_full_address_required';
  }
  if (notes.includes('company_relationship_answer_required') || labels.some((l) => /relatives?.{0,80}working|family member/.test(l))) {
    return 'company_relationship_answer_required';
  }
  if (notes.some((n) => /legal|contractual|export_control/.test(n))) return 'legal_attestation_required';
  if (notes.some((n) => /location_not|school_location/.test(n))) return 'location_not_in_profile_preferences';
  if (blockers.length > 0) return 'profile_specific_answer_required';
  return 'stuck_on_same_missing';
}

// ---------- main ----------
async function main() {
  log('Open:', APPLY_URL);
  const tab = await open();
  await sleep(4500);
  await navigateGreenhouseIframeIfPresent(tab);

  const unavailable = await detectJobUnavailable(tab);
  if (unavailable.ok) {
    console.log(JSON.stringify({ outcome: 'skip', reason: 'job_unavailable', detail: unavailable, job_id: JOB_ID }));
    await closeTab(tab);
    return;
  }

  log('Upload resume…');
  const u = await uploadResume(tab);
  if (!u.ok) {
    const unavailableAfterUpload = await detectJobUnavailable(tab);
    if (unavailableAfterUpload.ok) {
      console.log(JSON.stringify({ outcome: 'skip', reason: 'job_unavailable', detail: unavailableAfterUpload, job_id: JOB_ID }));
      await closeTab(tab);
      return;
    }
    console.log(JSON.stringify({ outcome: 'skip', reason: 'resume_upload_failed', detail: u, job_id: JOB_ID }));
    await closeTab(tab);
    return;
  }

  log('Fill basic fields…');
  await fillBasic(tab);

  // Pre-emptively handle Country (always required, react-select SYNC variant)
  log('Pre-fill Country = US (sync Select)…');
  await reactSelect(tab, 'country', 'United States', { mode: 'sync', fullMatchKeywords: [] });
  await sleep(500);

  // Pre-emptively handle Location (City) if present — AsyncSelect (Google Places)
  const candidateCity = preferredCandidateCity();
  if (candidateCity) {
    log(`Pre-fill Location = ${candidateCity} (async Select)…`);
    await reactSelect(tab, 'candidate-location', candidateCity, {
      mode: 'async',
      fullMatchKeywords: preferredCandidateCityFullMatchKeywords(),
    });
    await sleep(500);
  }

  let lastMissing = [];
  let pendingForMainClaude = [];
  let unanswerable = [];
  for (let attempt = 1; attempt <= 5; attempt++) {
    await clickVisibleConsentCheckboxes(tab);
    log(`Submit attempt ${attempt}…`);
    const res = await submitAndCheck(tab);
    if (res.success) {
      cdp('screenshot', tab, `/tmp/mrw_gh_post_${JOB_ID || 'job'}.png`);
	      console.log(JSON.stringify({ outcome: 'submitted', attempt, job_id: JOB_ID, url: APPLY_URL, post_url: res.url, cover_letter_uploaded: coverLetterUploaded }));
      await closeTab(tab);
      return;
    }
    res.missing = [...new Set(res.missing)];
    log('  missing:', res.missing.join(' | ').slice(0, 200));
    if (res.missing.length === 0) {
      if (attempt < 5) { await sleep(3000); continue; }
      console.log(JSON.stringify({ outcome: 'skip', reason: 'no_errors_no_success', snippet: res.body_snippet, tab_id: tab, job_id: JOB_ID }));
      return;
    }
    if (JSON.stringify(res.missing) === JSON.stringify(lastMissing)) {
      if (unanswerable.length > 0) {
        console.log(JSON.stringify({
          outcome: 'skip',
          reason: classifyUnsubmitted(res.missing, unanswerable),
          blockers: unanswerable,
          missing: res.missing,
          job_id: JOB_ID,
        }));
        await closeTab(tab);
        return;
      }
      if (pendingForMainClaude.length > 0) {
        const rec = { outcome: 'essay_pending', tab_id: tab, job_id: JOB_ID, pending: pendingForMainClaude, still_missing: res.missing, company: COMPANY, url: APPLY_URL };
        logEssayPending(rec);
        console.log(JSON.stringify(rec));
        // KEEP tab open — user/main-Claude needs to follow up.
        return;
      }
      console.log(JSON.stringify({ outcome: 'skip', reason: classifyUnsubmitted(res.missing, []), missing: res.missing, job_id: JOB_ID }));
      await closeTab(tab);
      return;
    }
    lastMissing = res.missing;
    for (const m of res.missing) {
      const a = await answerMissing(tab, m);
      if (a?.pending_for_main_claude) {
        const sel = await evalInTab(tab, `
          (() => {
            const targetQ = ${JSON.stringify(m.toLowerCase().slice(0, 40))};
            const cands = [...document.querySelectorAll("textarea, input[type=text]")].filter(el => el.offsetParent !== null);
            for (const inp of cands) {
              const wrap = inp.closest("fieldset, div, .field");
              const txt = wrap ? (wrap.innerText || '').toLowerCase() : '';
              if (txt.includes(targetQ)) {
                if (!inp.id) inp.id = 'mrw_pending_' + Math.random().toString(36).slice(2,8);
                const sel = /^[0-9]/.test(inp.id) ? '[id="' + inp.id + '"]' : '#' + inp.id;
                return { sel, tag: inp.tagName.toLowerCase() };
              }
            }
            return null;
          })()
        `);
        if (sel) pendingForMainClaude.push({ question: m, selector: sel.sel, tag: sel.tag });
      }
      if (a?.needs_user_answer) {
        unanswerable.push({ question: m, note: a.note, detail: a.detail || null });
        unanswerable = unanswerable.filter((v, i, arr) => arr.findIndex((x) => x.question === v.question && x.note === v.note) === i);
      }
      log('  →', m.slice(0, 40), JSON.stringify(a).slice(0, 80));
    }
    await sleep(1500);
  }
  if (pendingForMainClaude.length > 0) {
    const rec = { outcome: 'essay_pending', tab_id: tab, job_id: JOB_ID, pending: pendingForMainClaude, still_missing: lastMissing, company: COMPANY, url: APPLY_URL };
    logEssayPending(rec);
    console.log(JSON.stringify(rec));
    // KEEP tab open.
    return;
  }
  console.log(JSON.stringify({ outcome: 'skip', reason: 'max_attempts_exceeded', last_missing: lastMissing, job_id: JOB_ID }));
  await closeTab(tab);
}

main().catch(async (e) => {
  // DO NOT close tab on error — keep it open for debugging.
  console.log(JSON.stringify({ outcome: 'error', error: e.message, job_id: JOB_ID }));
  process.exit(1);
});
