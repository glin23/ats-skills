#!/usr/bin/env node
// ashby_apply_driver.mjs — submit-error-driven Ashby application driver.
//
// Usage:
//   node shared/ashby_apply_driver.mjs <apply_url> [<job_id>]
//   node shared/ashby_apply_driver.mjs --list-pending-essays
//
// What it does (in order):
//   1. Navigate (new tab) → wait for hydrate
//   2. Upload resume + dispatch React change event (today's lesson)
//   3. Fill _systemfield_name, _systemfield_email from profile.json
//   4. Click Submit
//   5. Read validation errors. For each "Missing entry for required field: X",
//      match a keyword bucket (work-auth, RTO, gender, race, veteran, disability,
//      sponsorship, location combobox, LinkedIn) → answer from profile.
//   6. Click Submit again. Up to 5 attempts.
//   7. On success page → return {outcome:'submitted', screenshot}, close tab.
//   8. On unresolved errors → return {outcome:'skip', reason, remaining}, close tab.
//   9. On essay-pending → return {outcome:'essay_pending'}, KEEP tab open.
//
// Notes for the new maintainer:
//   - Essay templates + radio defaults live in shared/answer_bank.json.
//   - Ashby uses uuid ids for many fields (e.g. "72b55bca-..."). A bare "#72b55..."
//     selector is INVALID CSS (leading digit). Use [id="..."] form instead. The
//     /^[0-9]/.test(id) guard is the rule.
//   - Ashby triplicates error messages — always dedupe missing[] before iterating.

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atsHome } from './paths.mjs';
import { renderAnswerTemplate } from './answer_templates.mjs';
import {
  isSpecificCityLogisticsFact as routingIsSpecificCityFact,
  isOpenEndedResidenceQuestion as routingIsOpenEndedResidence,
  relocationPolicyOpen as routingRelocationPolicyOpen,
  confirmedCitiesFrom as routingConfirmedCities,
  mentionsConfirmedCity as routingMentionsConfirmedCity,
  deriveWorkAuthAnswers,
} from './answer_routing.mjs';
import { matchAnswerBucket } from './answer_buckets.mjs';

// ============================================================
// CLI dispatcher — handle --list-pending-essays before anything else.
// ============================================================
const HOME = atsHome();
const REPO = process.env.MRWEIRDO_REPO_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const CDP = join(REPO, 'shared/cdp.mjs');
const ANSWER_BANK_PATH = join(REPO, 'shared/answer_bank.json');
const ESSAY_PENDING_LOG = join(HOME, 'essay_pending.jsonl');
const SEARCH_INTENT_PATH = join(HOME, 'search_intent.json');

if (process.argv[2] === '--list-pending-essays') {
  listPendingEssays();
  process.exit(0);
}

// ============================================================
// Normal apply-mode setup
// ============================================================
const PROFILE = JSON.parse(readFileSync(join(HOME, 'profile.json'), 'utf8'));
const RESUME = PROFILE.resume_path || join(HOME, 'resume.pdf');
const SEARCH_INTENT = readJsonOptional(SEARCH_INTENT_PATH, {});

const APPLY_URL = process.argv[2];
const JOB_ID = process.argv[3] || null;
if (!APPLY_URL) {
  console.error('usage: ashby_apply_driver.mjs <url> [<job_id>]');
  console.error('       ashby_apply_driver.mjs --list-pending-essays');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error('[driver]', ...a);
function readJsonOptional(path, fallback = {}) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

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

// Close a tab via Chrome's debug HTTP endpoint. Safe to call even if the tab
// is already gone (e.g. user closed it manually). Node 24+ global fetch.
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

async function activateTab(tab) {
  if (!tab) return { ok: false, note: 'no_tab' };
  const host = resolveCdpHost();
  try {
    const res = await fetch(`http://${host}/json/activate/${tab}`, { method: 'GET' });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============================================================
// Answer bank loader — externalized essay templates + defaults.
// ============================================================

// Fallback used when answer_bank.json is missing/malformed. Keeps the happy
// path working (resume + name/email + basic radios) on a fresh checkout.
const FALLBACK_BANK = {
  essay_templates: [],
  yes_no_defaults: {
    work_authorization: 'Yes',
    sponsorship_future: 'Yes',
    willing_to_relocate: 'Yes',
    enrolled_in_university: 'Yes',
    rto_office_in_person: 'Yes',
    veteran: 'I am not a protected veteran',
    disability: 'I do not want to answer',
    gender: 'I prefer not to answer',
    race: 'I prefer not to answer',
  },
  multichoice_preferences: {
    how_did_you_hear: ['LinkedIn', 'Online', 'Other', 'Google'],
    years_of_experience: ['< 1', '<1', '0-1', '1', '0', 'Less than 1'],
    seniority_level: ['Intern', 'Student', 'Entry', 'Junior'],
  },
  location_preferences: { city: '', city_full_match: [] },
  fallback_text: { linkedin: '', graduation_date: '', start_date_summer_2026: '' },
};

function loadAnswerBank() {
  if (!existsSync(ANSWER_BANK_PATH)) {
    console.error('[driver] WARN: answer_bank.json not found at', ANSWER_BANK_PATH, '— using minimal in-memory fallback.');
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
    console.error('[driver] WARN: answer_bank.json failed to parse:', e.message, '— using minimal in-memory fallback.');
    return { ...FALLBACK_BANK, essay_templates_compiled: [] };
  }
}

const BANK = loadAnswerBank();

// ============================================================
// Company name extracted from URL path: jobs.ashbyhq.com/<company>/...
// ============================================================
function companyFromUrl(url) {
  const m = (url || '').match(/ashbyhq\.com\/([^/]+)/);
  return m ? m[1] : 'this team';
}

const COMPANY = companyFromUrl(APPLY_URL);
const COMPANY_PRETTY = COMPANY.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function stateFullName(state) {
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
  return map[s.toUpperCase()] || s;
}

function essayAnswerFor(questionText) {
  for (const t of BANK.essay_templates_compiled || []) {
    if (t.regex.test(questionText)) {
      return renderAnswerTemplate(t.template, { profile: PROFILE, companyPretty: COMPANY_PRETTY, searchIntent: SEARCH_INTENT });
    }
  }
  return null;
}

function workAuthWithoutSponsorshipAnswer() {
  const auth = PROFILE.work_authorization || {};
  const visa = String(auth.visa_status || '').toLowerCase();
  if (/citizen|green card|permanent resident|authorized without restriction/.test(visa)) return 'Yes';
  if (auth.requires_sponsorship_now === false &&
      auth.requires_sponsorship_future === false &&
      !/f-?1|opt|cpt|h-?1b|j-?1|visa|sponsor/.test(visa)) {
    return 'Yes';
  }
  return 'No';
}

async function pickComboboxInQuestion(tab, questionText, value) {
  const searchTerms = Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
  const found = await evalInTab(tab, `
    (() => {
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const targetQ = ${JSON.stringify(questionText.toLowerCase().replace(/\s+/g, ' ').slice(0, 60))};
      const containers = [...document.querySelectorAll("fieldset, div")].filter(c => {
        const t = norm(c.innerText);
        if (!t.includes(targetQ)) return false;
        return !!c.querySelector("input[role=combobox], input[aria-autocomplete=list]");
      });
      if (containers.length === 0) return { ok:false, note:'no_combobox_in_question', target: targetQ };
      containers.sort((a, b) => norm(a.innerText).length - norm(b.innerText).length);
      const inp = containers[0].querySelector("input[role=combobox], input[aria-autocomplete=list]");
      if (!inp) return { ok:false, note:'combobox_disappeared' };
      if (!inp.id) inp.id = 'mrw_combo_' + Math.random().toString(36).slice(2,8);
      inp.focus();
      const sel = /^[0-9]/.test(inp.id) ? '[id="' + inp.id + '"]' : '#' + inp.id;
      return { ok:true, sel };
    })()
  `);
  if (!found.ok) return found;
  let last = { ok: false, note: 'no_search_terms' };
  for (const term of searchTerms) {
    await evalInTab(tab, `
      (() => {
        const inp = document.querySelector(${JSON.stringify(found.sel)});
        if (!inp) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(inp, '');
        else inp.value = '';
        inp.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.focus();
        return true;
      })()
    `);
    cdp('typetext', tab, found.sel, term);
    await sleep(1000);
    last = await evalInTab(tab, `
      (() => {
        const wanted = ${JSON.stringify(term.toLowerCase())};
        const opts = [...document.querySelectorAll("[role=option]")];
        const match = opts.find(o => (o.innerText || '').trim().toLowerCase() === wanted)
          || (wanted.length >= 5 ? opts.find(o => (o.innerText || '').toLowerCase().includes(wanted)) : null);
        if (match) {
          ['mousedown', 'mouseup', 'click'].forEach(t => match.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 })));
          return { ok:true, picked: (match.innerText || '').trim().slice(0,120), mode:'combobox_in_question', term: wanted };
        }
        return { ok:false, note:'no_option_match', wanted, sample: opts.slice(0,6).map(o => (o.innerText || '').trim()) };
      })()
    `);
    if (last.ok) return last;
  }
  return last;
}

// ---------- step: navigate + ensure tab ----------
async function open() {
  const r = cdp('goto', APPLY_URL);
  const j = JSON.parse(r.stdout);
  await activateTab(j.id);
  return j.id;
}

async function waitForAshbyForm(tab, timeoutMs = 25000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await evalInTab(tab, `
      (() => ({
        ready: document.readyState,
        url: location.href,
        title: document.title,
        has_resume: !!document.querySelector('#_systemfield_resume'),
        input_count: document.querySelectorAll('input, textarea, select').length,
        body_text: (document.body?.innerText || '').slice(0, 240)
      }))()
    `);
    if (last.has_resume || last.input_count > 5) return { ok: true, state: last };
    await sleep(1000);
  }
  return { ok: false, note: 'ashby_form_not_loaded', state: last };
}

// ---------- step: upload resume + dispatch React change ----------
async function uploadResume(tab) {
  const u = cdp('upload', tab, '#_systemfield_resume', RESUME);
  if (!u.stdout.includes('"ok":true')) {
    return { ok: false, note: 'upload_failed', detail: u.stdout || u.stderr || `exit_code=${u.code}` };
  }
  // After CDP setFileInputFiles, React may UNMOUNT the resume input — don't
  // hard-fail if the element is gone; assume the upload widget swapped to a
  // "resume.pdf attached" view. We surface what we can observe.
  const r = await evalInTab(tab, `
    (() => {
      const r = document.querySelector("#_systemfield_resume");
      if (!r) {
        const body = document.body.innerText;
        const looks_attached = /resume\\.pdf|resume[_\\s-]?[\\w-]*\\.pdf|\\bReplace\\b/i.test(body);
        return { ok: looks_attached, note: looks_attached ? 'react_unmounted_but_attached' : 'react_unmounted_no_confirmation', files: 0 };
      }
      r.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: r.files.length > 0, files: r.files.length, name: r.files[0]?.name };
    })()
  `);
  return r;
}

// ---------- step: fill standard fields ----------
async function fillStandard(tab) {
  const name = `${PROFILE.personal.first_name} ${PROFILE.personal.last_name}`;
  const email = PROFILE.personal.email;
  cdp('typetext', tab, '#_systemfield_name', name);
  cdp('typetext', tab, '#_systemfield_email', email);
  // Phone — Ashby uses uuid ids for phone fields. Find any visible tel input.
  const phoneRes = await evalInTab(tab, `
    (() => {
      const inp = [...document.querySelectorAll("input[type=tel]")].find(el => el.offsetParent !== null);
      if (!inp) return { found: false };
      if (!inp.id) inp.id = 'mrw_phone_temp';
      // Leading-digit-safe selector
      const sel = /^[0-9]/.test(inp.id) ? '[id="' + inp.id + '"]' : '#' + inp.id;
      return { found: true, sel };
    })()
  `);
  if (phoneRes.found) {
    const digits = (PROFILE.personal.phone || '').replace(/\D/g, '').replace(/^1/, '');
    if (digits) cdp('typetext', tab, phoneRes.sel, digits);
  }
  return { name, email, phone_filled: phoneRes.found };
}

// ---------- step: submit + read errors ----------
async function submitAndCheck(tab) {
  await evalInTab(tab, `
    (() => {
      const btn = [...document.querySelectorAll("button")].find(b => /submit/i.test(b.innerText));
      if (btn) btn.click();
      return !!btn;
    })()
  `);
  await sleep(7000);
  return await evalInTab(tab, `
    (() => {
      const bodyText = document.body.innerText;
      const success = /successfully submitted|application[\\s\\S]{0,30}(received|success)|thanks? for (applying|submitting)|thank you for submitting|already applied[\\s\\S]{0,160}(reviewed|application)/i.test(bodyText);
      const errors = [...document.querySelectorAll(".error, [class*=error i], [role=alert], [aria-live]")]
        .map(e => (e.innerText||'').trim())
        .filter(s => s.length > 0 && s.length < 400);
      // Dedup + filter signal
      const seen = new Set();
      const missing = [];
      for (const e of errors) {
        if (seen.has(e)) continue; seen.add(e);
        const m = e.match(/Missing entry for required field:?\\s*([^\\n]+)/i);
        if (m) missing.push(m[1].trim());
      }
      return { success, missing, error_count: errors.length, url: location.href, snippet: document.body.innerText.slice(0, 200) };
    })()
  `);
}

async function fillTextInQuestion(tab, question, value) {
  const r = await evalInTab(tab, `
    (() => {
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const targetQ = ${JSON.stringify(question.toLowerCase().replace(/\s+/g, ' ').slice(0, 60))};
      const selector = "input[type=text], input[type=url], input[type=email], textarea";

      // First prefer explicit label[for=id] matches.
      for (const inp of [...document.querySelectorAll(selector)]) {
        const lbl = inp.id ? document.querySelector('label[for="' + CSS.escape(inp.id) + '"]') : null;
        if (lbl && norm(lbl.innerText).includes(targetQ)) {
          const sel = /^[0-9]/.test(inp.id) ? '[id="' + inp.id + '"]' : '#' + inp.id;
          return { ok:true, sel, via:'label_for' };
        }
      }

      // Then find the smallest non-body container that contains the question
      // and exactly the field belonging to that question.
      const containers = [...document.querySelectorAll("fieldset, div")].filter(c => {
        const t = norm(c.innerText);
        if (!t.includes(targetQ)) return false;
        return !![...c.querySelectorAll(selector)].find(inp => inp.offsetParent !== null);
      });
      containers.sort((a, b) => norm(a.innerText).length - norm(b.innerText).length);
      for (const c of containers.slice(0, 8)) {
        const inp = [...c.querySelectorAll(selector)].find(el => el.offsetParent !== null);
        if (!inp) continue;
        if (!inp.id) inp.id = 'mrw_txt_' + Math.random().toString(36).slice(2,8);
        const sel = /^[0-9]/.test(inp.id) ? '[id="' + inp.id + '"]' : '#' + inp.id;
        return { ok:true, sel, via:'smallest_container', container_size: norm(c.innerText).length };
      }
      return { ok:false };
    })()
  `);
  if (!r.ok) return r;
  cdp('typetext', tab, r.sel, value);
  return { ok: true, mode: 'text_fill' };
}

// ---------- step: answer a missing field by keyword ----------
async function answerMissing(tab, missingLabel) {
  const ml = missingLabel.toLowerCase();
  const PNA = 'I prefer not to answer';

  // Profile-derived defaults (profile overrides bank where present)
  const { sponsorAns, authorizedAns } = deriveWorkAuthAnswers(PROFILE, BANK);
  const atsLocation = PROFILE.standard_qa?.current_location_for_ats || PROFILE.target_filters?.current_location_for_ats || '';
  const locationCity = BANK.location_preferences?.city || PROFILE.personal.address_city || PROFILE.personal.city || SEARCH_INTENT.user_summary?.school_location?.city || '';
  const locationState = PROFILE.personal.address_state || SEARCH_INTENT.user_summary?.school_location?.state || '';
  const locationStateFull = stateFullName(locationState);
  const cityFull = atsLocation || [locationCity, locationStateFull, PROFILE.personal.address_country || SEARCH_INTENT.user_summary?.school_location?.country || 'United States']
    .filter(Boolean)
    .join(', ');
  const linkedin = PROFILE.personal.linkedin || BANK.fallback_text?.linkedin || '';
  const genderAns = BANK.yes_no_defaults?.gender || PNA;
  const raceAns = BANK.yes_no_defaults?.race || PNA;
  const veteranAns = BANK.yes_no_defaults?.veteran || 'I am not a protected veteran';
  const disabilityAns = BANK.yes_no_defaults?.disability || 'I do not want to answer';
  const rtoAns = BANK.yes_no_defaults?.rto_office_in_person || 'Yes';

  // --- Relocation policy (from search_intent geographic_preference) ---------
  // RULE (do not auto-commit the user to a SPECIFIC-CITY FACT they never confirmed):
  //  * A GENERAL willingness-to-relocate / general remote-hybrid RTO question is
  //    POLICY-covered when relocation_policy === 'anywhere_legal_work' AND
  //    willing_to_relocate_for_internship === true  → auto-answer Yes (rtoAns).
  //  * A SPECIFIC-CITY LOGISTICS FACT — i.e. something the tool cannot know about
  //    the user's real life — must NEVER be auto-answered. These are:
  //      - "do you have reliable transportation to our <City> office?" (a capability fact)
  //      - "do you currently live in / near <City>?" / "are you currently located in <metro>?" (a residence fact)
  //    Unless the user has explicitly confirmed that named city, surface as a gap
  //    (pending_for_main_claude) so the row is asked/skipped, not silently committed.
  //  * "willing/able to work onsite at <City> N days/week" is in-between: the
  //    "willing" part is policy-covered, so when the policy allows we answer Yes;
  //    but if the phrasing asserts a residence/transport FACT (handled by the
  //    specific-city-fact guard below, which runs first), we ask-or-skip instead.
  // Decisions extracted to shared/answer_routing.mjs (pure, unit-tested).
  const relocationPolicyOpen = routingRelocationPolicyOpen(SEARCH_INTENT);
  const confirmedCities = routingConfirmedCities(PROFILE);
  const mentionsConfirmedCity = routingMentionsConfirmedCity(ml, confirmedCities);
  const isSpecificCityLogisticsFact = routingIsSpecificCityFact(ml);
  // Open-ended "Where do you live?" is answerable from the profile city; only a
  // named/yes-no specific-city or transport fact stays guarded.
  const isOpenEndedResidence = routingIsOpenEndedResidence(ml);
  if (isSpecificCityLogisticsFact && !mentionsConfirmedCity && !isOpenEndedResidence) {
    return {
      ok: false,
      note: 'specific_city_fact_unconfirmed',
      pending_for_main_claude: true,
      question: missingLabel
    };
  }

  const compensationExpectation = BANK.fallback_text?.compensation_expectations
    || "Open to discussion based on the role, location, and the company's standard internship or entry-level range.";

  if (/(?:authorized|eligible|right|legally).{0,80}work.{0,80}without.{0,50}sponsor|without.{0,50}sponsor.{0,80}(?:work|employment|authorization)|unrestricted.{0,50}(?:work|employment|authorization)/i.test(ml)) {
    const withoutSponsorshipAns = workAuthWithoutSponsorshipAnswer();
    const combo = await pickComboboxInQuestion(tab, missingLabel, [withoutSponsorshipAns]);
    if (combo.ok) return combo;
  }

  if (/authorized.{0,40}work.{0,20}u\.?s|legally authorized.{0,40}u\.?s/i.test(ml)) {
    const authComboPrefs = /f-?1|opt|cpt/i.test(PROFILE.work_authorization?.visa_status || '')
      ? ['CPT', 'OPT', authorizedAns]
      : [authorizedAns];
    const combo = await pickComboboxInQuestion(tab, missingLabel, authComboPrefs);
    if (combo.ok) return combo;
  }

  if (/sponsor|sponsorship|work authorization|visa/i.test(ml)) {
    const visa = String(PROFILE.work_authorization?.visa_status || '').toLowerCase();
    const needsFuture = PROFILE.work_authorization?.requires_sponsorship_future;
    const needsNow = PROFILE.work_authorization?.requires_sponsorship_now;
    const sponsorComboPrefs = /f-?1|opt|cpt/.test(visa) && needsFuture
      ? [
          'I currently hold OPT and will require H-1B sponsorship in the future',
          'I currently hold STEM OPT and will require H-1B sponsorship in the future',
          'H-1B sponsorship in the future',
          'Yes'
        ]
      : needsNow || needsFuture
        ? ['Yes', 'I require another type of visa sponsorship']
        : ['No', 'No sponsorship required'];
    const combo = await pickComboboxInQuestion(tab, missingLabel, sponsorComboPrefs);
    if (combo.ok) return combo;
  }

  // PHASE 0: Essay templates (long-form Qs) take priority. Short date fields
  // also match availability templates, so let the normal field buckets handle them.
  if (essayAnswerFor(missingLabel) && !/(start date|earliest start|availability|when can you start|when could you start)/i.test(ml)) {
    return await answerEssay(tab, missingLabel);
  }

  // PHASE 1: "How did you hear about this job?" can be a free textarea/text input, a
  // radio group, OR a react-select combobox depending on the tenant. Try them in that
  // order with the first preferred value ("LinkedIn"). Other multichoice questions
  // (years of experience / seniority / work term) go straight to the radio handler.
  if (/how did you hear|hear about/i.test(ml)) {
    const preferred = (BANK.multichoice_preferences?.how_did_you_hear || ['LinkedIn', 'Online', 'Other'])[0];
    const textRes = await fillTextInQuestion(tab, missingLabel, preferred);
    if (textRes && textRes.ok) return textRes;
    const radioRes = await answerRadioMultichoice(tab, missingLabel);
    if (radioRes && radioRes.ok) return radioRes;
    const combo = await pickComboboxInQuestion(tab, missingLabel, preferred);
    if (combo && combo.ok) return combo;
    return { ok: false, note: 'hear_about_unresolved', text: textRes, radio: radioRes, combo };
  }
  if (/years?.{0,5}(of )?experience|seniority|level|work term|term availability/i.test(ml)) {
    return await answerRadioMultichoice(tab, missingLabel);
  }

  // Match keyword → call appropriate clicker. The DECISION (which bucket and the
  // resolved value/choice) is the pure `matchAnswerBucket` in answer_buckets.mjs;
  // every regex/value/flag there is verbatim with the prior inline list. The ctx
  // carries the driver-resolved values the bucket descriptors reference.
  const bucket = matchAnswerBucket(missingLabel, {
    PROFILE,
    authorizedAns,
    sponsorAns,
    rtoAns,
    genderAns,
    raceAns,
    veteranAns,
    disabilityAns,
    cityFull,
    compensationExpectation,
    earliestStartDate: PROFILE.standard_qa?.earliest_start_date || BANK.fallback_text?.start_date_summer_2026,
    linkedin,
    graduationDate: PROFILE.education?.graduation_date || BANK.fallback_text?.graduation_date,
    pna: PNA,
  });
  if (!bucket) {
    // Last resort: textarea / long-text → mark pending for main agent
    return { ok: false, note: 'no_bucket_for:' + missingLabel.slice(0, 60), pending_for_main_claude: true, question: missingLabel };
  }

  // Policy gate: an onsite/relocation COMMITMENT question only auto-answers when the
  // user's relocation_policy permits it. A plain remote/hybrid acknowledgment (no
  // relocate/onsite/named-office wording) is harmless and stays auto-Yes regardless,
  // so real submissions that rely on the general RTO path are unaffected.
  if (bucket.relocationCommitment && !relocationPolicyOpen) {
    const isPlainRemoteHybrid = /remote|hybrid/i.test(ml)
      && !/relocat|onsite|on[- ]site|in[- ]office|in.{0,5}person|headquarters|\bhq\b|office/i.test(ml);
    if (!isPlainRemoteHybrid) {
      return { ok: false, note: 'relocation_commitment_policy_unset', pending_for_main_claude: true, question: missingLabel };
    }
  }

  if (bucket.action === 'upload_resume') {
    return await uploadResume(tab);
  }

  if (bucket.action === 'fill_phone') {
    const digits = (PROFILE.personal.phone || '').replace(/\D/g, '').replace(/^1/, '');
    if (!digits) return { ok: false, note: 'profile_phone_missing' };
    const phoneRes = await evalInTab(tab, `
      (() => {
        const inp = [...document.querySelectorAll("input[type=tel], input[autocomplete=tel], input[name*='phone' i], input[id*='phone' i], input[aria-label*='phone' i]")].find(el => el.offsetParent !== null);
        if (!inp) return { ok:false, note:'phone_input_not_found' };
        if (!inp.id) inp.id = 'mrw_phone_retry';
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) {
          setter.call(inp, '');
          inp.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
        inp.focus();
        const sel = /^[0-9]/.test(inp.id) ? '[id="' + inp.id + '"]' : '#' + inp.id;
        return { ok:true, sel };
      })()
    `);
    if (phoneRes.ok) {
      cdp('typetext', tab, phoneRes.sel, digits);
      return { ok: true, mode: 'phone_retry' };
    }
    // Ashby often renders "Primary phone" as a plain text input with a UUID id and
    // no phone-y attributes — only the question label says "phone". Fall back to the
    // question-container text fill so these aren't false "phone_input_not_found" skips.
    if (bucket.q) return await fillTextInQuestion(tab, bucket.q, digits);
    return phoneRes;
  }

  if (bucket.action === 'click_single_radio_in_question') {
    return await evalInTab(tab, `
      (async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const targetQ = ${JSON.stringify(bucket.q.toLowerCase().replace(/\s+/g, ' ').slice(0, 56))};
        const containers = [...document.querySelectorAll("fieldset, div, label")].filter(c => {
          const t = norm(c.innerText);
          if (!t.includes(targetQ)) return false;
          return c.querySelectorAll("input[type=radio]").length >= 1;
        });
        if (containers.length === 0) return { ok:false, note:'no_single_radio_container', target: targetQ };
        containers.sort((a, b) => norm(a.innerText).length - norm(b.innerText).length);
        const c = containers[0];
        const radio = c.querySelector("input[type=radio]");
        if (!radio) return { ok:false, note:'radio_not_found' };
        try { radio.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (_) { radio.scrollIntoView({ block: 'center' }); }
        const label = radio.id ? document.querySelector('label[for="' + CSS.escape(radio.id) + '"]') : null;
        if (label) label.click();
        else radio.click();
        await sleep(150);
        if (!radio.checked) radio.click();
        await sleep(150);
        if (!radio.checked) {
          const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
          if (desc && typeof desc.set === 'function') desc.set.call(radio, true);
        }
        radio.dispatchEvent(new Event('input', { bubbles: true }));
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(150);
        return {
          ok: radio.checked,
          picked: label?.innerText?.trim() || radio.id,
          mode: 'single_radio',
          container_size: norm(c.innerText).length
        };
      })()
    `);
  }

  if (bucket.action === 'click_radio_in_question' || bucket.action === 'click_checkbox_in_question') {
    const r = await evalInTab(tab, `
      (async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const targetQ = ${JSON.stringify(bucket.q.toLowerCase().replace(/\s+/g, ' ').slice(0, 56))};
        const rawChoices = ${JSON.stringify(bucket.choices || [bucket.choice, bucket.fallback].filter(Boolean))};
        const choices = rawChoices.filter(Boolean).map(c => c.toLowerCase());

        // Find SMALLEST container with question text + has 2-12 selectable inputs OR buttons.
        const all = [...document.querySelectorAll("fieldset, div")];
        const candidates = all.filter(c => {
          const t = norm(c.innerText);
          if (!t.includes(targetQ)) return false;
          const inputs = c.querySelectorAll("input[type=radio], input[type=checkbox]");
          const btns = [...c.querySelectorAll("button")].filter(b => /^(Yes|No|I prefer.*|Decline.*|Not a protected|I do not want|Male|Female)$/i.test(b.innerText.trim()));
          return (inputs.length >= 2 && inputs.length <= 12) || btns.length >= 2;
        });
        if (candidates.length === 0) return { ok:false, note:'no_container', target: targetQ };
        candidates.sort((a, b) => a.innerText.length - b.innerText.length);
        const c = candidates[0];

        // TYPE A: Ashby Yes/No button widget — hidden checkbox + visible <button>Yes</button>
        const yesNoBtns = [...c.querySelectorAll("button")].filter(b => /^(yes|no|i prefer.*|decline.*|i am not a protected.*|i do not want.*|male|female)$/i.test(b.innerText.trim()));
        if (yesNoBtns.length >= 2) {
          for (const choice of choices) {
            const btn = yesNoBtns.find(b => b.innerText.trim().toLowerCase() === choice);
            if (btn) {
              const isActive = () => /(^|\\s)_active_/.test(btn.className);
              if (isActive()) return { ok:true, picked: btn.innerText.trim(), mode:'btn_widget_already_active', container_size: c.innerText.length };
              btn.click();
              await sleep(250);
              if (!isActive()) {
                btn.click();
                await sleep(300);
              }
              const cb = c.querySelector("input[type=checkbox]");
              if (cb) {
                const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
                if (desc && typeof desc.set === 'function') desc.set.call(cb, choice === 'yes');
                cb.dispatchEvent(new Event('input', { bubbles: true }));
                cb.dispatchEvent(new Event('change', { bubbles: true }));
                await sleep(120);
              }
              const active = isActive() || (c.querySelector("input[type=checkbox]")?.checked === (choice === 'yes'));
              return { ok:active, picked: btn.innerText.trim(), mode:'btn_widget', active, container_size: c.innerText.length };
            }
          }
        }

        // TYPE B: native radio/checkbox with label[for=id]
        const inputs = [...c.querySelectorAll("input[type=radio], input[type=checkbox]")];
        for (const choice of choices) {
          for (const inp of inputs) {
            let txt = '';
            const wrap = inp.closest('label');
            if (wrap) txt = wrap.innerText.trim();
            if (!txt && inp.id) {
              const sib = c.querySelector('label[for="' + CSS.escape(inp.id) + '"]');
              if (sib) txt = sib.innerText.trim();
            }
            if (!txt && inp.nextElementSibling) txt = (inp.nextElementSibling.innerText || '').trim();
            if (txt.toLowerCase() === choice) {
              inp.click();
              const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
              if (desc && typeof desc.set === 'function') desc.set.call(inp, true);
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              await sleep(120);
              return { ok:inp.checked, picked: txt, mode:'radio_checkbox', container_size: c.innerText.length };
            }
          }
        }

        return {
          ok:false,
          note:'no_choice_match',
          tried: choices,
          buttons_seen: yesNoBtns.map(b => b.innerText.trim()).slice(0,8),
          inputs_seen: inputs.length
        };
      })()
    `);
    return r;
  }

  if (bucket.action === 'fill_location_combobox') {
    if (bucket.q) {
      const cityOnly = bucket.value.split(',')[0].trim();
      const locationTerms = [
        bucket.value,
        locationStateFull ? `${cityOnly}, ${locationStateFull}, United States` : '',
        locationState ? `${cityOnly}, ${locationState}, United States` : '',
        PROFILE.education?.school && locationStateFull ? `${PROFILE.education.school}, ${locationStateFull}, United States` : '',
        PROFILE.education?.school || '',
        locationState ? '' : cityOnly,
      ].filter(Boolean);
      const scoped = await pickComboboxInQuestion(tab, bucket.q, locationTerms);
      if (scoped.ok || scoped.note !== 'no_combobox_in_question') return scoped;
    }

    // Find combobox, focus, typetext, pick option
    const found = await evalInTab(tab, `
      (() => {
        const inp = document.querySelector("input[role=combobox][placeholder*='typ' i], input[role=combobox][placeholder*='type' i], input[role=combobox][placeholder*='ocation' i]");
        if (!inp) return { ok:false, note:'no_combobox' };
        if (!inp.id) inp.id = 'mrw_loc_temp';
        inp.focus();
        const sel = /^[0-9]/.test(inp.id) ? '[id="' + inp.id + '"]' : '#' + inp.id;
        return { ok:true, sel };
      })()
    `);
    if (!found.ok) {
      if (bucket.q) return await fillTextInQuestion(tab, bucket.q, bucket.value);
      return found;
    }
    cdp('typetext', tab, found.sel, bucket.value.split(',')[0]); // type just city portion
    await sleep(1600);
    return await evalInTab(tab, `
      (() => {
        const v = ${JSON.stringify(bucket.value.toLowerCase())};
        const opts = [...document.querySelectorAll("[role=option]")];
        const cityOnly = v.split(',')[0].trim();
        const state = (v.split(',')[1] || '').trim();
        const stateOk = (txt) => {
          const t = txt.toLowerCase();
          if (!state) return /usa|united states/i.test(txt);
          if (state === 'ma') return /\\bma\\b|massachusetts/.test(t);
          return t.includes(state);
        };
        const match = opts.find(o => o.innerText.toLowerCase().includes(cityOnly) && stateOk(o.innerText));
        if (match) {
          ['mousedown', 'mouseup', 'click'].forEach(t => match.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 })));
          return { ok:true, picked: match.innerText.slice(0,80) };
        }
        return { ok:false, note: 'no_city_state_option', sample: opts.slice(0,5).map(o=>o.innerText.slice(0,80)) };
      })()
    `);
  }

  if (bucket.action === 'fill_text_in_question') {
    return await fillTextInQuestion(tab, bucket.q, bucket.value);
  }

  return { ok: false, note: 'unhandled_action' };
}

// ---------- radio multichoice handler ----------
// Patterns: "How did you hear about X" → pick LinkedIn; "Years of experience" → < 1
async function answerRadioMultichoice(tab, questionText) {
  const qLower = questionText.toLowerCase();
  let preferred = [];
  if (/how did you hear|how.{0,8}find.{0,5}us|hear about/i.test(qLower)) {
    preferred = BANK.multichoice_preferences?.how_did_you_hear || ['LinkedIn', 'Online', 'Other', 'Google'];
  } else if (/years?.{0,5}(of )?experience|how (many|long).{0,5}years/i.test(qLower)) {
    preferred = BANK.multichoice_preferences?.years_of_experience || ['< 1', '<1', '0-1', '1', '0', 'Less than 1'];
  } else if (/(seniority|level)/i.test(qLower)) {
    preferred = BANK.multichoice_preferences?.seniority_level || ['Intern', 'Student', 'Entry', 'Junior'];
  } else if (/work term|term availability/i.test(qLower)) {
    preferred = BANK.multichoice_preferences?.work_term_availability || ['Summer 2026', 'Fall 2026', 'Spring 2027', 'Summer', 'Fall', 'Spring'];
  } else {
    return { ok: false, note: 'no_multichoice_rule_for:' + questionText.slice(0, 50) };
  }
  return await evalInTab(tab, `
    (() => {
      const targetQ = ${JSON.stringify(qLower.slice(0, 40))};
      const preferred = ${JSON.stringify(preferred)};
      const containers = [...document.querySelectorAll("fieldset, div")].filter(c => {
        const t = (c.innerText || '').toLowerCase();
        if (!t.includes(targetQ)) return false;
        return c.querySelectorAll("input[type=radio], input[type=checkbox]").length >= 2;
      });
      containers.sort((a, b) => a.innerText.length - b.innerText.length);
      const c = containers[0];
      if (!c) return { ok:false, note:'no_choice_container' };
      const radios = [...c.querySelectorAll("input[type=radio], input[type=checkbox]")];
      for (const choice of preferred) {
        const cl = choice.toLowerCase();
        for (const r of radios) {
          let txt = '';
          const wrap = r.closest('label');
          if (wrap) txt = wrap.innerText.trim();
          if (!txt && r.name) txt = r.name.trim();
          if (!txt && r.id) {
            const lbl = c.querySelector('label[for="' + CSS.escape(r.id) + '"]');
            if (lbl) txt = lbl.innerText.trim();
          }
          if (!txt && r.nextElementSibling) txt = (r.nextElementSibling.innerText || '').trim();
          const tl = txt.toLowerCase();
          if (tl === cl || tl.includes(cl)) {
            r.click();
            const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
            if (desc && typeof desc.set === 'function') desc.set.call(r, true);
            r.dispatchEvent(new Event('input', { bubbles: true }));
            r.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok:true, picked: txt, mode:r.type === 'checkbox' ? 'checkbox_multichoice' : 'multichoice' };
          }
        }
      }
      return { ok:false, note:'no_preferred_match', tried: preferred, available: radios.map(r => (r.closest('label')?.innerText || r.name || r.value || '').trim().slice(0,80)) };
    })()
  `);
}

// ---------- textarea / long-text essay handler ----------
async function answerEssay(tab, questionText) {
  const ans = essayAnswerFor(questionText);
  if (!ans) return { ok: false, note: 'no_essay_template_for:' + questionText.slice(0, 60), pending_for_main_claude: true };

  // Find the textarea/input via question text
  const f = await evalInTab(tab, `
    (() => {
      const targetQ = ${JSON.stringify(questionText.toLowerCase().slice(0, 40))};
      // Look for textarea or long text input whose nearest container contains the question
      const candidates = [...document.querySelectorAll("textarea, input[type=text]")].filter(el => el.offsetParent !== null);
      for (const inp of candidates) {
        const wrap = inp.closest("fieldset, div");
        const txt = wrap ? (wrap.innerText || '').toLowerCase() : '';
        if (txt.includes(targetQ)) {
          if (!inp.id) inp.id = 'mrw_essay_' + Math.random().toString(36).slice(2,8);
          // CSS escape: ids starting with digit need [id="..."] form
          const sel = /^[0-9]/.test(inp.id) ? '[id="' + inp.id + '"]' : '#' + inp.id;
          return { ok:true, sel, type: inp.tagName.toLowerCase() };
        }
      }
      return { ok:false, note:'no_essay_input' };
    })()
  `);
  if (!f.ok) return f;
  cdp('typetext', tab, f.sel, ans);
  return { ok: true, mode: 'essay_template', answer_len: ans.length };
}

// ============================================================
// --list-pending-essays mode
// ============================================================
// Reads ~/.mrweirdo-jobs/essay_pending.jsonl, dedupes by job_id (latest wins),
// and prints a human-friendly block per job. Intended to be the input for a
// future main-Claude-in-loop essay consumer.
function listPendingEssays() {
  if (!existsSync(ESSAY_PENDING_LOG)) {
    console.log(`No essay_pending.jsonl found at ${ESSAY_PENDING_LOG}`);
    return;
  }
  const raw = readFileSync(ESSAY_PENDING_LOG, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim().length > 0);

  // Dedupe by job_id (latest entry wins — JSONL is append-only so later lines
  // are newer). Entries without job_id fall back to keying by url.
  const byJob = new Map();
  for (const line of lines) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.outcome !== 'essay_pending') continue;
    const key = rec.job_id || rec.url || Math.random().toString(36);
    byJob.set(String(key), rec);
  }

  if (byJob.size === 0) {
    console.log('No pending essay jobs found.');
    return;
  }

  // Dedupe pending[] entries within each job (essay_pending.jsonl tends to
  // duplicate question/selector pairs per round).
  for (const [key, rec] of byJob) {
    const seen = new Set();
    const dedupedPending = [];
    for (const p of rec.pending || []) {
      const sig = `${p.question || ''}::${p.selector || ''}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      dedupedPending.push(p);
    }

    console.log(`=== job_id=${rec.job_id || '(none)'} company=${rec.company || '?'} ===`);
    console.log(`  url: ${rec.url || '(none)'}`);
    console.log(`  tab: ${rec.tab_id || '(none)'}`);
    if ((rec.still_missing || []).length) {
      console.log(`  still_missing (all): ${rec.still_missing.join(' | ')}`);
    }
    console.log(`  pending essays:`);
    if (dedupedPending.length === 0) {
      console.log(`    (none)`);
    } else {
      dedupedPending.forEach((p, i) => {
        console.log(`    [${i + 1}] Q: ${JSON.stringify(p.question || '')}`);
        console.log(`        sel: ${p.selector || '(none)'}`);
        if (p.tag) console.log(`        tag: ${p.tag}`);
      });
    }
    console.log('');
  }
}

// Append an essay_pending record to the central log so --list-pending-essays
// can find it later. This is the bridge between "driver said essay_pending"
// and "main agent consumes pending list."
function logEssayPending(rec) {
  try {
    appendFileSync(ESSAY_PENDING_LOG, JSON.stringify(rec) + '\n');
  } catch (e) {
    log('WARN: failed to append essay_pending log:', e.message);
  }
}

function addPendingQuestion(pending, item) {
  if (!item?.question || !item?.selector) return;
  if (pending.some((p) => p.question === item.question && p.selector === item.selector)) return;
  pending.push(item);
}

function dedupePendingQuestions(pending) {
  const out = [];
  for (const item of pending || []) addPendingQuestion(out, item);
  return out;
}

// ============================================================
// Main
// ============================================================
async function main() {
  log('Open:', APPLY_URL);
  const tab = await open();
  // Longer hydrate wait — agentio + others need >5s for React to fully mount form
  await sleep(6000);
  const hydrated = await waitForAshbyForm(tab);
  if (!hydrated.ok) {
    console.log(JSON.stringify({ outcome: 'skip', reason: 'ashby_form_not_loaded', detail: hydrated, job_id: JOB_ID }));
    await closeTab(tab);
    return;
  }

  log('Upload resume…');
  const u = await uploadResume(tab);
  if (!u.ok) {
    console.log(JSON.stringify({ outcome: 'skip', reason: 'resume_upload_failed', detail: u, job_id: JOB_ID }));
    await closeTab(tab);
    return;
  }

  log('Fill name/email…');
  await fillStandard(tab);

  let lastMissing = [];
  let pendingForMainClaude = [];
  for (let attempt = 1; attempt <= 5; attempt++) {
    log(`Submit attempt ${attempt}…`);
    const res = await submitAndCheck(tab);
    if (res.success) {
      cdp('screenshot', tab, `/tmp/mrw_post_${JOB_ID || 'job'}.png`);
      console.log(JSON.stringify({ outcome: 'submitted', attempt, job_id: JOB_ID, url: APPLY_URL, post_url: res.url }));
      await closeTab(tab);
      return;
    }
    // Dedup missing (Ashby triplicates the error message)
    res.missing = [...new Set(res.missing)];
    log('  missing fields:', res.missing.join(' | ').slice(0, 200));
    if (res.missing.length === 0) {
      if (attempt < 5) { await sleep(2500); continue; }
      console.log(JSON.stringify({ outcome: 'skip', reason: 'unknown_state_no_errors_no_success', snippet: res.snippet, tab_id: tab, job_id: JOB_ID }));
      return;
    }
    if (JSON.stringify(res.missing) === JSON.stringify(lastMissing)) {
      // Same errors as last round — we're stuck. If pending essays exist, return that for main agent.
      if (pendingForMainClaude.length > 0) {
        const rec = {
          outcome: 'essay_pending', tab_id: tab, job_id: JOB_ID,
          pending: dedupePendingQuestions(pendingForMainClaude),
          still_missing: res.missing,
          company: COMPANY,
          url: APPLY_URL,
          hint: 'main agent: write answer for each pending question, then call: node cdp.mjs typetext <tab> <sel> "<answer>", then re-run this driver to retry submit',
        };
        logEssayPending(rec);
        console.log(JSON.stringify(rec));
        // KEEP tab open — user/main-Claude needs to follow up.
        return;
      }
      console.log(JSON.stringify({ outcome: 'skip', reason: 'stuck_on_same_missing', missing: res.missing, job_id: JOB_ID }));
      await closeTab(tab);
      return;
    }
    lastMissing = res.missing;
    for (const m of res.missing) {
      const a = await answerMissing(tab, m);
      if (a?.pending_for_main_claude) {
        // Try to locate the field to give main agent a CSS selector
        const sel = await evalInTab(tab, `
          (() => {
            const targetQ = ${JSON.stringify(m.toLowerCase().slice(0, 40))};
            const cands = [...document.querySelectorAll("textarea, input[type=text]")].filter(el => el.offsetParent !== null);
            for (const inp of cands) {
              const wrap = inp.closest("fieldset, div");
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
        if (sel) addPendingQuestion(pendingForMainClaude, { question: m, selector: sel.sel, tag: sel.tag });
      }
      log('  answer', m.slice(0, 50), '→', JSON.stringify(a).slice(0, 100));
    }
    await sleep(1200);
  }
  // Hit max attempts. If pending essays exist, surface them for main agent.
  if (pendingForMainClaude.length > 0) {
    const rec = {
      outcome: 'essay_pending', tab_id: tab, job_id: JOB_ID,
      pending: dedupePendingQuestions(pendingForMainClaude),
      still_missing: lastMissing,
      company: COMPANY,
      url: APPLY_URL,
    };
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
  console.log(JSON.stringify({ outcome: 'error', error: e.message, stack: e.stack?.split('\n').slice(0, 3), job_id: JOB_ID }));
  process.exit(1);
});
