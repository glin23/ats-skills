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
//   6. Click Submit again. Up to 4 retries.
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
import { homedir } from 'node:os';
import { join } from 'node:path';

// ============================================================
// CLI dispatcher — handle --list-pending-essays before anything else.
// ============================================================
const HOME = process.env.MRWEIRDO_HOME || join(homedir(), '.mrweirdo-jobs');
const REPO = process.env.MRWEIRDO_REPO_ROOT || '/Users/lee/Projects/mrweirdo-jobs';
const CDP = join(REPO, 'shared/cdp.mjs');
const ANSWER_BANK_PATH = join(REPO, 'shared/answer_bank.json');
const ESSAY_PENDING_LOG = join(HOME, 'essay_pending.jsonl');

if (process.argv[2] === '--list-pending-essays') {
  listPendingEssays();
  process.exit(0);
}

// ============================================================
// Normal apply-mode setup
// ============================================================
const PROFILE = JSON.parse(readFileSync(join(HOME, 'profile.json'), 'utf8'));
const RESUME = PROFILE.resume_path || join(HOME, 'resume.pdf');

const APPLY_URL = process.argv[2];
const JOB_ID = process.argv[3] || null;
if (!APPLY_URL) {
  console.error('usage: ashby_apply_driver.mjs <url> [<job_id>]');
  console.error('       ashby_apply_driver.mjs --list-pending-essays');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error('[driver]', ...a);

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
  const host = process.env.CDP_HOST || 'localhost:9222';
  try {
    const res = await fetch(`http://${host}/json/close/${tab}`, { method: 'GET' });
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
  location_preferences: { city: 'Boston', city_full_match: ['massachusetts', 'united states'] },
  fallback_text: { linkedin: '', graduation_date: 'May 2027', start_date_summer_2026: 'May 2026' },
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

function essayAnswerFor(questionText) {
  for (const t of BANK.essay_templates_compiled || []) {
    if (t.regex.test(questionText)) {
      return t.template.replace(/\{\{COMPANY_PRETTY\}\}/g, COMPANY_PRETTY);
    }
  }
  return null;
}

// ---------- step: navigate + ensure tab ----------
async function open() {
  const r = cdp('goto', APPLY_URL);
  const j = JSON.parse(r.stdout);
  return j.id;
}

// ---------- step: upload resume + dispatch React change ----------
async function uploadResume(tab) {
  const u = cdp('upload', tab, '#_systemfield_resume', RESUME);
  if (!u.stdout.includes('"ok":true')) {
    return { ok: false, note: 'upload_failed', detail: u.stdout };
  }
  // After CDP setFileInputFiles, React may UNMOUNT the resume input — don't
  // hard-fail if the element is gone; assume the upload widget swapped to a
  // "resume.pdf attached" view. We surface what we can observe.
  const r = await evalInTab(tab, `
    (() => {
      const r = document.querySelector("#_systemfield_resume");
      if (!r) {
        const body = document.body.innerText;
        const looks_attached = /resume\\.pdf|resume_lee_lin|\\bReplace\\b/i.test(body);
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
  await sleep(4500);
  return await evalInTab(tab, `
    (() => {
      const bodyText = document.body.innerText;
      const success = /successfully submitted|application[\\s\\S]{0,30}(received|success)|thanks? for (applying|submitting)|thank you for submitting/i.test(bodyText);
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

// ---------- step: answer a missing field by keyword ----------
async function answerMissing(tab, missingLabel) {
  const ml = missingLabel.toLowerCase();
  const PNA = 'I prefer not to answer';

  // Profile-derived defaults (profile overrides bank where present)
  const sponsorAns = PROFILE.work_authorization?.requires_sponsorship_future
    ? 'Yes'
    : (BANK.yes_no_defaults?.sponsorship_future || 'Yes');
  const authorizedAns = PROFILE.work_authorization?.authorized_to_work_us
    ? 'Yes'
    : (BANK.yes_no_defaults?.work_authorization || 'Yes');
  const cityFull = `${PROFILE.personal.address_city || PROFILE.personal.city || BANK.location_preferences?.city || 'Boston'}, ${PROFILE.personal.address_state || 'MA'}, USA`;
  const linkedin = PROFILE.personal.linkedin || BANK.fallback_text?.linkedin || '';
  const genderAns = BANK.yes_no_defaults?.gender || PNA;
  const raceAns = BANK.yes_no_defaults?.race || PNA;
  const veteranAns = BANK.yes_no_defaults?.veteran || 'I am not a protected veteran';
  const disabilityAns = BANK.yes_no_defaults?.disability || 'I do not want to answer';
  const rtoAns = BANK.yes_no_defaults?.rto_office_in_person || 'Yes';

  // PHASE 0: Essay templates (long-form Qs) take priority
  if (essayAnswerFor(missingLabel)) {
    return await answerEssay(tab, missingLabel);
  }

  // PHASE 1: Multichoice radio (How did you hear / Years of experience)
  if (/how did you hear|hear about|years?.{0,5}(of )?experience|seniority|level/i.test(ml)) {
    return await answerRadioMultichoice(tab, missingLabel);
  }

  // Match keyword → call appropriate clicker
  const buckets = [
    // Authorization separate from sponsorship: "Are you authorized to work" → Yes (F-1 OPT)
    { match: /authorized to work|legally.{0,5}work|eligible to work|right to work/i, action: 'click_radio_in_question', q: missingLabel, choice: authorizedAns, fallback: PNA },
    { match: /require.{0,5}sponsor|need.{0,5}sponsor|sponsorship/i, action: 'click_radio_in_question', q: missingLabel, choice: sponsorAns, fallback: PNA },
    { match: /work auth|visa/i, action: 'click_radio_in_question', q: missingLabel, choice: sponsorAns, fallback: PNA },
    // RTO covers many phrasings
    { match: /rto|return to office|office.{0,5}\d+.{0,5}day|in[- ]office|in.{0,5}person|hybrid|on[- ]site|onsite|based in.{0,15}(office|nyc|sf)|relocate|willing.{0,15}move|currently.{0,5}reside/i, action: 'click_radio_in_question', q: missingLabel, choice: rtoAns, fallback: PNA },
    { match: /gender/i, action: 'click_radio_in_question', q: missingLabel, choice: genderAns, fallback: 'Decline to self-identify' },
    { match: /race|ethnic/i, action: 'click_radio_in_question', q: missingLabel, choice: raceAns, fallback: 'Decline to self-identify' },
    { match: /sexual orientation/i, action: 'click_checkbox_in_question', q: missingLabel, choice: PNA },
    { match: /veteran/i, action: 'click_radio_in_question', q: missingLabel, choice: veteranAns, fallback: PNA },
    { match: /disab/i, action: 'click_radio_in_question', q: missingLabel, choice: disabilityAns, fallback: PNA },
    { match: /current location|^location$/i, action: 'fill_location_combobox', value: cityFull },
    { match: /linkedin/i, action: 'fill_text_in_question', q: missingLabel, value: linkedin },
  ];

  const bucket = buckets.find((b) => b.match.test(ml));
  if (!bucket) {
    // Last resort: textarea / long-text → mark pending for main Claude
    return { ok: false, note: 'no_bucket_for:' + missingLabel.slice(0, 60), pending_for_main_claude: true, question: missingLabel };
  }

  if (bucket.action === 'click_radio_in_question' || bucket.action === 'click_checkbox_in_question') {
    const r = await evalInTab(tab, `
      (() => {
        const targetQ = ${JSON.stringify(bucket.q.toLowerCase().slice(0, 40))};
        const targetChoice = ${JSON.stringify(bucket.choice)};
        const fallbackChoice = ${JSON.stringify(bucket.fallback || '')};
        const choices = [targetChoice, fallbackChoice].filter(Boolean).map(c => c.toLowerCase());

        // Find SMALLEST container with question text + has 2-12 selectable inputs OR buttons.
        const all = [...document.querySelectorAll("fieldset, div")];
        const candidates = all.filter(c => {
          const t = (c.innerText || '').toLowerCase();
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
              btn.click();
              return { ok:true, picked: btn.innerText.trim(), mode:'btn_widget', container_size: c.innerText.length };
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
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok:true, picked: txt, mode:'radio_checkbox', container_size: c.innerText.length };
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
    // Find combobox, focus, typetext, pick option
    const found = await evalInTab(tab, `
      (() => {
        const inp = document.querySelector("input[role=combobox][placeholder*='ype' i], input[role=combobox][placeholder*='ocation' i]");
        if (!inp) return { ok:false, note:'no_combobox' };
        if (!inp.id) inp.id = 'mrw_loc_temp';
        inp.focus();
        const sel = /^[0-9]/.test(inp.id) ? '[id="' + inp.id + '"]' : '#' + inp.id;
        return { ok:true, sel };
      })()
    `);
    if (!found.ok) return found;
    cdp('typetext', tab, found.sel, bucket.value.split(',')[0]); // type just city portion
    await sleep(1200);
    return await evalInTab(tab, `
      (() => {
        const v = ${JSON.stringify(bucket.value.toLowerCase())};
        const opts = [...document.querySelectorAll("[role=option]")];
        const cityOnly = v.split(',')[0].trim();
        // Try exact match first (city + state)
        let match = opts.find(o => o.innerText.toLowerCase().includes(cityOnly) && /usa|united states|, ma|massachusetts/i.test(o.innerText));
        if (!match) match = opts.find(o => o.innerText.toLowerCase().includes(cityOnly));
        if (match) { match.click(); return { ok:true, picked: match.innerText.slice(0,80) }; }
        return { ok:false, note: 'no_city_option', sample: opts.slice(0,5).map(o=>o.innerText.slice(0,40)) };
      })()
    `);
  }

  if (bucket.action === 'fill_text_in_question') {
    const r = await evalInTab(tab, `
      (() => {
        const targetQ = ${JSON.stringify(bucket.q.toLowerCase().slice(0, 60))};
        const inputs = [...document.querySelectorAll("input[type=text], input[type=url], textarea")];
        for (const inp of inputs) {
          const wrap = inp.closest("fieldset, div");
          if (wrap && (wrap.innerText || '').toLowerCase().includes(targetQ)) {
            if (!inp.id) inp.id = 'mrw_txt_' + Math.random().toString(36).slice(2,8);
            const sel = /^[0-9]/.test(inp.id) ? '[id="' + inp.id + '"]' : '#' + inp.id;
            return { ok:true, sel };
          }
        }
        return { ok:false };
      })()
    `);
    if (!r.ok) return r;
    cdp('typetext', tab, r.sel, bucket.value);
    return { ok: true, mode: 'text_fill' };
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
        return c.querySelectorAll("input[type=radio]").length >= 2;
      });
      containers.sort((a, b) => a.innerText.length - b.innerText.length);
      const c = containers[0];
      if (!c) return { ok:false, note:'no_radio_container' };
      const radios = [...c.querySelectorAll("input[type=radio]")];
      for (const choice of preferred) {
        const cl = choice.toLowerCase();
        for (const r of radios) {
          let txt = '';
          const wrap = r.closest('label');
          if (wrap) txt = wrap.innerText.trim();
          if (!txt && r.id) {
            const lbl = c.querySelector('label[for="' + CSS.escape(r.id) + '"]');
            if (lbl) txt = lbl.innerText.trim();
          }
          if (!txt && r.nextElementSibling) txt = (r.nextElementSibling.innerText || '').trim();
          if (txt.toLowerCase() === cl) {
            r.click();
            r.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok:true, picked: txt, mode:'multichoice' };
          }
        }
      }
      return { ok:false, note:'no_preferred_match', tried: preferred, available: radios.map(r => r.closest('label')?.innerText?.trim().slice(0,30) || r.value) };
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
// and "main Claude consumes pending list."
function logEssayPending(rec) {
  try {
    appendFileSync(ESSAY_PENDING_LOG, JSON.stringify(rec) + '\n');
  } catch (e) {
    log('WARN: failed to append essay_pending log:', e.message);
  }
}

// ============================================================
// Main
// ============================================================
async function main() {
  log('Open:', APPLY_URL);
  const tab = await open();
  // Longer hydrate wait — agentio + others need >5s for React to fully mount form
  await sleep(6000);

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
  for (let attempt = 1; attempt <= 4; attempt++) {
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
      if (attempt === 1) { await sleep(2000); continue; }
      console.log(JSON.stringify({ outcome: 'skip', reason: 'unknown_state_no_errors_no_success', snippet: res.snippet, job_id: JOB_ID }));
      await closeTab(tab);
      return;
    }
    if (JSON.stringify(res.missing) === JSON.stringify(lastMissing)) {
      // Same errors as last round — we're stuck. If pending essays exist, return that for main Claude.
      if (pendingForMainClaude.length > 0) {
        const rec = {
          outcome: 'essay_pending', tab_id: tab, job_id: JOB_ID,
          pending: pendingForMainClaude,
          still_missing: res.missing,
          company: COMPANY,
          url: APPLY_URL,
          hint: 'main Claude: write answer for each pending question, then call: node cdp.mjs typetext <tab> <sel> "<answer>", then re-run this driver to retry submit',
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
        // Try to locate the field to give main Claude a CSS selector
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
        if (sel) pendingForMainClaude.push({ question: m, selector: sel.sel, tag: sel.tag });
      }
      log('  answer', m.slice(0, 50), '→', JSON.stringify(a).slice(0, 100));
    }
    await sleep(1200);
  }
  // Hit max attempts. If pending essays exist, surface them for main Claude.
  if (pendingForMainClaude.length > 0) {
    const rec = {
      outcome: 'essay_pending', tab_id: tab, job_id: JOB_ID,
      pending: pendingForMainClaude,
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
