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
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = process.env.MRWEIRDO_HOME || join(homedir(), '.mrweirdo-jobs');
const REPO = process.env.MRWEIRDO_REPO_ROOT || '/Users/lee/Projects/mrweirdo-jobs';
const PROFILE = JSON.parse(readFileSync(join(HOME, 'profile.json'), 'utf8'));
const RESUME = PROFILE.resume_path || join(HOME, 'resume.pdf');
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
const latestExperience = Array.isArray(PROFILE.experience_summary) ? PROFILE.experience_summary[0] : null;
const profilePortfolio =
  PROFILE.personal?.portfolio ||
  PROFILE.personal?.website ||
  PROFILE.personal?.github ||
  PROFILE.personal?.linkedin ||
  '';
const profileSchool = PROFILE.education?.school || 'Babson College';
const profileMajor = PROFILE.education?.major || 'Business';
const profileDegree = PROFILE.education?.degree || 'Bachelor of Science';
const profileGraduationDate = PROFILE.education?.graduation_date || 'May 2027';
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
    veteran: 'I am not a protected veteran', disability: 'I do not want to answer',
    gender: 'I prefer not to answer', race: 'I prefer not to answer',
  },
  multichoice_preferences: {
    how_did_you_hear: ['LinkedIn', 'Online', 'Other', 'Google'],
    years_of_experience: ['< 1', '<1', '0-1', '1', '0', 'Less than 1'],
  },
  location_preferences: { city: 'Boston', city_full_match: ['massachusetts', 'united states'] },
  fallback_text: { linkedin: '', graduation_date: 'May 2027', start_date_summer_2026: 'May 2026' },
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

function monthYear(value) {
  const raw = String(value || '').trim();
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  let m = raw.match(/^(\d{1,2})[/-](\d{4})$/);
  if (m) {
    const month = Number(m[1]);
    if (month >= 1 && month <= 12) return `${months[month - 1]} ${m[2]}`;
  }
  m = raw.match(/^(\d{4})[/-](\d{1,2})$/);
  if (m) {
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) return `${months[month - 1]} ${m[1]}`;
  }
  return raw || 'May 2027';
}

function preferredLocationAliases() {
  const geo = SEARCH_INTENT.search_intent?.geographic_preference || {};
  const metros = Array.isArray(geo.preferred_metros) ? geo.preferred_metros : [];
  const raw = [
    ...metros,
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
    if (/anywhere|nationwide|all\s+(?:over\s+)?(?:the\s+)?(?:us|usa|united states)|open to.*(?:us|usa|united states)/.test(item)) aliases.add('anywhere_us');
  }
  return aliases;
}

function locationDecisionForLabel(labelText) {
  const lt = String(labelText || '').toLowerCase();
  const aliases = preferredLocationAliases();
  if (aliases.has('anywhere_us')) return { ok: true, note: 'anywhere_us' };

  const commonLocationWords = [
    'austin', 'texas', 'tx', 'new york', 'nyc', 'ny', 'cincinnati', 'ohio', 'oh',
    'menlo park', 'palo alto', 'san francisco', 'bay area', 'california', 'ca',
    'boston', 'cambridge', 'massachusetts', 'ma', 'seattle', 'washington', 'wa',
    'chicago', 'illinois', 'il', 'los angeles', 'la', 'denver', 'colorado', 'co',
  ];
  const mentioned = commonLocationWords.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lt));
  if (mentioned.length === 0) return { ok: true, note: 'no_specific_location_in_label' };
  const preferred = mentioned.some((w) => aliases.has(w));
  return preferred
    ? { ok: true, note: 'preferred_location_match', mentioned }
    : { ok: false, note: 'unsupported_specific_location', mentioned };
}

function companyFromUrl(url) {
  const m = url.match(/(?:boards|job-boards)\.greenhouse\.io\/([^/]+)/);
  return m ? m[1] : 'this team';
}
const COMPANY = companyFromUrl(APPLY_URL);
const COMPANY_PRETTY = COMPANY.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function essayAnswerFor(questionText) {
  for (const t of BANK.essay_templates_compiled || []) {
    if (t.regex.test(questionText)) {
      return t.template.replace(/\{\{COMPANY_PRETTY\}\}/g, COMPANY_PRETTY);
    }
  }
  return null;
}

// ---------- nav + resume ----------
async function open() {
  const r = cdp('goto', APPLY_URL);
  return JSON.parse(r.stdout).id;
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
        has_resume_text: /resume\\.pdf|resume_lee_lin/i.test(txt),
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
      const errHelpers = [...document.querySelectorAll('.helper-text--error, .field-error, .error')].filter(e => e.offsetParent !== null);
      for (const eh of errHelpers) {
        const wrap = eh.closest('.input-wrapper, .select__container, [class*=field], .application--question, fieldset, div');
        if (!wrap) continue;
        let labelTxt = '';
        const lbl = wrap.querySelector('label, legend, [class*=label]:not([class*=error])');
        if (lbl) labelTxt = lbl.innerText.trim();
        if (!labelTxt) labelTxt = eh.innerText.trim();
        // Clean: take only first line + strip trailing * and a11y screen-reader noise
        labelTxt = labelTxt.split('\\n')[0].replace(/\\*+$/, '').trim();
        if (labelTxt && !seen.has(labelTxt) && labelTxt.length < 150) {
          seen.add(labelTxt);
          missing.push(labelTxt);
        }
      }
      // Also legacy parse: "Missing entry for required field: X"
      const errBlocks = [...document.querySelectorAll('#application_form_errors, [role=alert], [aria-live]')]
        .map(e => (e.innerText || '').trim()).filter(s => s.length > 0 && s.length < 800);
      for (const e of errBlocks) {
        const matches = e.matchAll(/Missing entry for required field:?\\s*([^\\n]+)/gi);
        for (const m of matches) {
          const t = m[1].trim();
          if (!seen.has(t)) { seen.add(t); missing.push(t); }
        }
      }
      const invalids = [...document.querySelectorAll('[aria-invalid="true"][aria-required="true"], input[required][aria-invalid="true"]')];
      for (const el of invalids) {
        if (!el.id) continue;
        const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        const t = (lbl?.innerText || '').replace(/\\*+$/, '').trim();
        if (t && !seen.has(t) && t.length < 180) { seen.add(t); missing.push(t); }
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
      const wrap = lbl.closest('div, fieldset');
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
    return await evalInTab(tab, `
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
  if (!f.ok) return { ok: false, note: 'find_failed', detail: f, pending_for_main_claude: /\?$|describe|tell us|explain|why|projects|experience/i.test(labelText), question: labelText };

  // Bank defaults
  const needsFutureSponsorship =
    PROFILE.work_authorization?.requires_sponsorship_future ??
    PROFILE.work_authorization?.needs_sponsor;
  const sponsorVal = needsFutureSponsorship === false ? 'No' : (BANK.yes_no_defaults?.sponsorship_future || 'Yes');

  // City / Location / Country
  if (/^location|city|country/i.test(lt) || f.is_react_select) {
    let value;
    let mode = 'async';
    if (/master'?s|masters|graduate degree/i.test(lt)) { value = 'No'; mode = 'sync'; }
    else if (/legally authorized|authorized to work|work authorization|work authorised/i.test(lt)) { value = BANK.yes_no_defaults?.work_authorization || 'Yes'; mode = 'sync'; }
    else if (/school|college|university/i.test(lt) && !/confirm|enrolled/i.test(lt)) { value = profileSchool; mode = 'async'; }
    else if (/degree/i.test(lt)) { value = degreeSelectValue(); mode = 'sync'; }
    else if (/discipline|major|field of study/i.test(lt)) { value = profileMajor; mode = 'sync'; }
    else if (/country/i.test(lt)) { value = 'United States'; mode = 'sync'; }
    else if (/relocate|willing.*location|currently live|resident|residency|based (?:in|there)|confirmed plans|located in|on-?site|office|commute/i.test(lt)) {
      const loc = locationDecisionForLabel(labelText);
      if (!loc.ok) return { ok: false, note: 'location_not_in_profile_preferences', detail: loc, needs_user_answer: true };
      value = "I am willing to relocate to this job's location.";
      mode = 'sync';
    }
    else if (/expect(?:ed)? to graduate|graduation date|graduation year|graduate.*program|when do you expect|complete your program/i.test(lt)) { value = monthYear(profileGraduationDate || BANK.fallback_text?.graduation_date || 'May 2027'); mode = 'sync'; }
    else if (/location|city/i.test(lt)) value = BANK.location_preferences?.city || 'Boston';
    else if (/sponsor|work auth|visa/i.test(lt)) value = sponsorVal;
    else if (/enrolled in.*university|currently enrolled/i.test(lt)) {
      const loc = locationDecisionForLabel(labelText);
      if (!loc.ok) return { ok: false, note: 'school_location_not_in_profile', detail: loc, needs_user_answer: true };
      value = BANK.yes_no_defaults?.enrolled_in_university || 'Yes';
      mode = 'sync';
    }
    else if (/full.?time|consider.*ft|consideration for|full.?time offer/i.test(lt)) { value = 'Need to return to school and available upon graduation'; mode = 'sync'; }
    else if (/available to start|earliest.*start|start date|when can you start/i.test(lt)) { value = BANK.fallback_text?.start_date_summer_2026 || 'May 2026'; mode = 'sync'; }
    else if (/gender/i.test(lt)) value = BANK.yes_no_defaults?.gender || "Don't want to answer";
    else if (/race|ethnic/i.test(lt)) value = BANK.yes_no_defaults?.race || "Don't want to answer";
    else if (/veteran/i.test(lt)) value = BANK.yes_no_defaults?.veteran || 'I am not a protected veteran';
    else if (/disab/i.test(lt)) value = BANK.yes_no_defaults?.disability || "I don't wish to answer";
    else if (/how did you hear/i.test(lt)) value = (BANK.multichoice_preferences?.how_did_you_hear || ['LinkedIn'])[0];
    else return { ok: false, note: 'no_value_rule_for_label:' + labelText.slice(0, 40) };

    const r = await reactSelect(tab, f.id, value, { mode });
    return r;
  }

  // Text fields
  if (f.type === 'text' || f.type === 'textarea') {
    let value;
    if (/linkedin/i.test(lt)) value = PROFILE.personal.linkedin || BANK.fallback_text?.linkedin;
    else if (/project|portfolio|github|live url|website|shipped/i.test(lt)) value = profilePortfolio;
    else if (/legal name/i.test(lt)) value = `${PROFILE.personal.first_name} ${PROFILE.personal.last_name}`;
    else if (/school|college|university/i.test(lt)) value = profileSchool;
    else if (/degree/i.test(lt)) value = profileDegree;
    else if (/discipline|major|field of study/i.test(lt)) value = profileMajor;
    else if (/how did you hear/i.test(lt)) value = (BANK.multichoice_preferences?.how_did_you_hear || ['LinkedIn'])[0];
    else if (/expect(?:ed)? to graduate|graduation date|graduation year|when do you expect|complete your program/i.test(lt)) value = monthYear(profileGraduationDate || BANK.fallback_text?.graduation_date || 'May 2027');
    else if (/available to start|earliest.*start|start date|when can you start/i.test(lt)) value = BANK.fallback_text?.start_date_summer_2026 || 'May 2026';
    else if (/salary|compensation/i.test(lt)) value = PROFILE.work_authorization?.salary_expectation_usd || 'Negotiable';
    else if (/most recent employer|current employer|latest employer/i.test(lt)) value = latestExperience?.company || '';
    else if (/most recent job title|current title|latest title/i.test(lt)) value = latestExperience?.title || '';
    else if (/gpa/i.test(lt)) value = ''; // skip GPA — fill empty (may still fail validation)
    else return { ok: false, note: 'no_value_rule_text:' + labelText.slice(0, 40) };
    if (!value) return { ok: false, note: 'value_empty_for:' + lt.slice(0, 30) };
    // Leading-digit-safe selector
    const sel = /^[0-9]/.test(f.id) ? `[id="${f.id}"]` : '#' + f.id;
    cdp('typetext', tab, sel, value);
    return { ok: true, mode: 'text_fill', value };
  }

  // Checkbox: acknowledge / privacy / confirm
  if (f.type === 'checkbox' || /acknowledge|confirm|privacy|policy|review/i.test(lt)) {
    const r = await evalInTab(tab, `
      (() => {
        // Find checkbox by label text — GH renders these as <input type=checkbox> with sibling label
        const target = ${JSON.stringify(labelText.toLowerCase().slice(0, 40))};
        const cbs = [...document.querySelectorAll('input[type=checkbox]')].filter(el => el.offsetParent !== null);
        for (const cb of cbs) {
          const wrap = cb.closest('.input-wrapper, .application--question, fieldset, div');
          if (wrap && (wrap.innerText || '').toLowerCase().includes(target)) {
            if (!cb.checked) {
              cb.scrollIntoView({block:'center'});
              cb.click();
              cb.dispatchEvent(new Event('change',{bubbles:true}));
            }
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

// ---------- main ----------
async function main() {
  log('Open:', APPLY_URL);
  const tab = await open();
  await sleep(4500);

  log('Upload resume…');
  const u = await uploadResume(tab);
  if (!u.ok) {
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
  log('Pre-fill Location = Boston, MA (async Select)…');
  await reactSelect(tab, 'candidate-location', BANK.location_preferences?.city || 'Boston', {
    mode: 'async',
    fullMatchKeywords: BANK.location_preferences?.city_full_match || ['massachusetts', 'united states'],
  });
  await sleep(500);

  let lastMissing = [];
  let pendingForMainClaude = [];
  let unanswerable = [];
  for (let attempt = 1; attempt <= 5; attempt++) {
    log(`Submit attempt ${attempt}…`);
    const res = await submitAndCheck(tab);
    if (res.success) {
      cdp('screenshot', tab, `/tmp/mrw_gh_post_${JOB_ID || 'job'}.png`);
      console.log(JSON.stringify({ outcome: 'submitted', attempt, job_id: JOB_ID, url: APPLY_URL, post_url: res.url }));
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
          reason: 'profile_specific_answer_required',
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
      console.log(JSON.stringify({ outcome: 'skip', reason: 'stuck_on_same_missing', missing: res.missing, job_id: JOB_ID }));
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
