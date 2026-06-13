#!/usr/bin/env node
// lever_apply_driver.mjs - batch-safe Lever auto-apply driver.
//
// Emits one final structured JSON line for record_apply_outcome.mjs:
//   { outcome: "submitted", ... } or { outcome: "skip", reason, ... }.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atsHome } from './paths.mjs';
import { bachelorProgressCandidates, gpaRangeCandidates, gpaValue } from './greenhouse_value_rules.mjs';

const HOME = atsHome();
const REPO = process.env.MRWEIRDO_REPO_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const CDP = join(REPO, 'shared/cdp.mjs');
const HELPERS = join(REPO, 'shared/lever_helpers.js');
const PROFILE_PATH = join(HOME, 'profile.json');
const ESSAY_PROFILE_PATH = join(HOME, 'essay_profile.json');
const SEARCH_INTENT_PATH = join(HOME, 'search_intent.json');
const ANSWER_BANK_PATH = join(REPO, 'shared/answer_bank.json');

const APPLY_URL_RAW = process.argv[2];
const JOB_ID = process.argv[3] || null;
if (!APPLY_URL_RAW) {
  console.error('usage: lever_apply_driver.mjs <url> [<job_id>]');
  process.exit(2);
}

const PROFILE = readJson(PROFILE_PATH, {});
const ESSAY_PROFILE = readJson(ESSAY_PROFILE_PATH, {});
const SEARCH_INTENT = readJson(SEARCH_INTENT_PATH, {});
const BANK = readJson(ANSWER_BANK_PATH, {});
const RESUME = PROFILE.resume_path || join(HOME, 'resume.pdf');
const DEFAULT_COVER_LETTER = join(HOME, 'cover_letter.pdf');
const STATIC_COVER_LETTER_ALLOWED = process.env.MRWEIRDO_DISABLE_STATIC_COVER_LETTER !== '1';
const COVER_LETTER = process.env.MRWEIRDO_COVER_LETTER_PATH ||
  (STATIC_COVER_LETTER_ALLOWED ? (PROFILE.cover_letter_path || (existsSync(DEFAULT_COVER_LETTER) ? DEFAULT_COVER_LETTER : '')) : '');
let coverLetterUploaded = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readJson(file, fallback = {}) {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function normalizeLeverUrl(url) {
  const u = new URL(url);
  if (!/jobs\.lever\.co$/i.test(u.hostname)) throw new Error(`not a Lever URL: ${url}`);
  if (!/\/apply\/?$/i.test(u.pathname)) u.pathname = u.pathname.replace(/\/$/, '') + '/apply';
  return u.toString();
}

function cdp(...args) {
  const r = spawnSync(process.execPath, [CDP, ...args], { encoding: 'utf8' });
  return { code: r.status ?? 1, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function evalInTab(tab, js) {
  const r = cdp('eval', tab, js);
  return parseJson(r.stdout, { ok: false, _raw: r.stdout, _err: r.stderr, _code: r.code });
}

function outcome(obj) {
  console.log(JSON.stringify({ job_id: JOB_ID, ...obj }));
}

function profileLocation(profile = {}) {
  const personal = profile.personal || {};
  const city = personal.address_city || personal.city || '';
  const state = personal.address_state || '';
  const country = personal.address_country || 'United States';
  if (city && state) return `${city}, ${state}, ${country}`;
  if (city) return city;
  return '';
}

function profileFullAddress(profile = {}) {
  const personal = profile.personal || {};
  const addr = personal.address || {};
  const line1 = personal.address_line1 || personal.address_street || addr.line1 || addr.street || addr.street1 || '';
  const city = personal.address_city || addr.city || '';
  const state = personal.address_state || addr.state || '';
  const zip = personal.address_zip || personal.zip || addr.zip || addr.postal_code || '';
  const country = personal.address_country || addr.country || 'United States';
  if (!line1 || !city || !state || !zip) return '';
  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [line1, cityStateZip, country].filter(Boolean).join(', ');
}

function stateValueCandidates(state) {
  const value = String(state || '').trim();
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
  if (!value) return [];
  const upper = value.toUpperCase();
  return [...new Set([value, upper, map[upper]].filter(Boolean))];
}

function graduation(profile = {}) {
  return profile.education?.graduation_date || '';
}

function salaryNumber(profile = {}, essayProfile = {}) {
  const raw =
    profile.work_authorization?.salary_expectation_usd ||
    profile.standard_qa?.salary_expectation_usd ||
    essayProfile.factual_gap_fields?.compensation_acceptance?.expected_salary_number ||
    '';
  const match = String(raw).match(/\d+(?:\.\d+)?/);
  return match ? match[0] : '';
}

function buildLeverProfile(profile = {}) {
  const personal = profile.personal || {};
  const standard = profile.standard_qa || {};
  return {
    ...profile,
    first_name: personal.first_name,
    last_name: personal.last_name,
    full_name: personal.full_name || [personal.first_name, personal.last_name].filter(Boolean).join(' '),
    email: personal.email,
    phone: personal.phone,
    linkedin_url: personal.linkedin,
    website_url: personal.portfolio,
    github_url: personal.github,
    location_text: profileLocation(profile),
    custom_answers: {
      ...(profile.custom_answers || {}),
      'how did you hear': standard.how_did_you_hear || 'LinkedIn',
      'linkedin': personal.linkedin || '',
      'portfolio': personal.portfolio || '',
      'website': personal.portfolio || '',
      'school': profile.education?.school || '',
      'university': profile.education?.school || '',
      'major': profile.education?.major || '',
      'minor': profile.education?.minor || 'N/A',
      'graduation': graduation(profile),
      'gpa': profile.education?.gpa || '',
      'location': profileLocation(profile),
      'city': profileLocation(profile),
    },
    picker_answers: profile.picker_answers || {},
  };
}

function optionTexts(field = {}) {
  return (field.options || []).map((option) => {
    if (typeof option === 'string') return option;
    return option?.text || option?.value || '';
  }).filter(Boolean);
}

function isCoverLetterField(field = {}) {
  const text = [field.label, field.id, field.name].map((v) => String(v || '')).join(' ').toLowerCase();
  return /cover.{0,20}letter|coverletter/.test(text);
}

function selectorForField(field = {}) {
  const id = String(field.id || field.name || '').trim();
  if (!id) return '';
  const escaped = id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) return `#${id}, [name="${escaped}"]`;
  return `[id="${escaped}"], [name="${escaped}"]`;
}

function collectAnswerPassUnresolved(answerPass = {}) {
  return [
    ...(Array.isArray(answerPass.unresolved) ? answerPass.unresolved : []),
    ...(Array.isArray(answerPass.still_missing) ? answerPass.still_missing : []),
    ...(Array.isArray(answerPass.first_pass?.unresolved) ? answerPass.first_pass.unresolved : []),
    ...(Array.isArray(answerPass.first_pass?.still_missing) ? answerPass.first_pass.still_missing : []),
    ...(Array.isArray(answerPass.second_pass?.unresolved) ? answerPass.second_pass.unresolved : []),
    ...(Array.isArray(answerPass.second_pass?.still_missing) ? answerPass.second_pass.still_missing : []),
  ];
}

function chooseOption(field, preferences) {
  const opts = optionTexts(field);
  if (!opts.length) return preferences[0] || '';
  const normalized = opts.map((text) => ({ text, lower: text.toLowerCase() }));
  for (const pref of preferences.filter(Boolean)) {
    const p = String(pref).toLowerCase();
    const exact = normalized.find((o) => o.lower === p);
    if (exact) return exact.text;
    const contains = normalized.find((o) => o.lower.includes(p) || p.includes(o.lower));
    if (contains) return contains.text;
  }
  return '';
}

function answerForField(field = {}) {
  const label = String(field.label || '').replace(/\s+/g, ' ').trim();
  const l = label.toLowerCase();
  const auth = PROFILE.work_authorization || {};
  const demographics = PROFILE.demographics || {};
  const education = PROFILE.education || {};
  const personal = PROFILE.personal || {};
  const standard = PROFILE.standard_qa || {};
  const location = profileLocation(PROFILE);
  const salary = salaryNumber(PROFILE, ESSAY_PROFILE);

  if (/notice period|certification|initial|signature|certify|true and complete|privacy|consent|acknowledge/i.test(label)) return null;
  if (/currently (located|live|living|reside|residing|based) in|do you (currently )?(live|reside)/i.test(label)) return null;
  if (/transportation|driver'?s license/i.test(label)) return null;
  if (/full.{0,20}address|permanent address|street, city, state, zip|mailing address/i.test(label)) {
    return profileFullAddress(PROFILE) || null;
  }
  if (/street address|address line 1|street line 1/i.test(label)) {
    return personal.address_street || personal.address_line1 || personal.address?.street || '';
  }

  if (/how did you hear|source|referred/i.test(label)) return chooseOption(field, [standard.how_did_you_hear, 'LinkedIn', 'Online']) || 'LinkedIn';
  if (/linkedin/i.test(label)) return personal.linkedin || '';
  if (/portfolio|website|github|project/i.test(label)) return personal.portfolio || personal.github || '';
  if (/high school/i.test(label)) return standard.high_school_location || '';
  if (/\bgpa\b/i.test(label)) {
    if (field.type === 'select' || field.type === 'react-select') {
      return chooseOption(field, gpaRangeCandidates(PROFILE)) || '';
    }
    return gpaValue(PROFILE);
  }
  if (/completed.*bachelor|bachelor.*(?:completed|progress|working towards)|currently working towards.*bachelor/i.test(label)) {
    return chooseOption(field, bachelorProgressCandidates(PROFILE)) || '';
  }
  if (/home state|state:/i.test(label)) {
    return chooseOption(field, stateValueCandidates(personal.address_state || personal.address?.state)) || '';
  }
  if (/location|where are you|city|reside/i.test(label) && location) return location;
  if (/school|university|college/i.test(label)) return education.school || '';
  if (/major|discipline|field of study/i.test(label)) return education.major || '';
  if (/minor/i.test(label)) return education.minor || 'N/A';
  if (/graduat|complete your program|month and year/i.test(label)) return graduation(PROFILE);
  if (/salary|compensation|pay expectation|hourly|rate/i.test(label)) {
    if (field.type === 'number') return salary || null;
    return PROFILE.work_authorization?.salary_expectation_usd || BANK.fallback_text?.compensation_expectations || salary || null;
  }

  if (/authorized|eligible.*work|legally.*work/i.test(label)) return chooseOption(field, ['Yes', 'I am authorized', 'Authorized']) || 'Yes';
  if (/sponsor|sponsorship|visa|work authorization|maintain that authorization/i.test(label)) {
    return auth.requires_sponsorship_future === true
      ? (chooseOption(field, ['Yes', 'require', 'will require']) || 'Yes')
      : (chooseOption(field, ['No', 'do not require']) || 'No');
  }
  if (/currently enrolled|return to (the )?(program|school)|student/i.test(label)) return chooseOption(field, ['Yes']) || 'Yes';
  if (/work style|remote|hybrid|on[- ]?site|onsite|in[- ]?person/i.test(label)) {
    return chooseOption(field, [standard.preferred_work_arrangement, 'Remote', 'Hybrid', 'On-site', 'Onsite']);
  }
  if (/relative|previously employed|former employee|previously applied|previously interviewed|interviewed with.*hiring team|conflict/i.test(label)) return chooseOption(field, ['No']) || 'No';
  if (/18 years|over 18|at least 18/i.test(label)) return chooseOption(field, ['Yes']) || 'Yes';
  if (/gender/i.test(label)) return chooseOption(field, [demographics.gender, 'Prefer not', 'Decline']);
  if (/hispanic|latino/i.test(label)) return chooseOption(field, [demographics.hispanic_or_latino, 'Prefer not', 'Decline']);
  if (/race|ethnicity/i.test(label)) return chooseOption(field, [demographics.race, 'Prefer not', 'Decline']);
  if (/veteran/i.test(label)) return chooseOption(field, [demographics.veteran_status, 'I am not a protected veteran', 'No']);
  if (/disability/i.test(label)) return chooseOption(field, [demographics.disability_status, 'I do not wish to answer', 'Prefer not']);

  return null;
}

async function answerRemaining(tab) {
  let missing = await evalInTab(tab, 'Lever.findEmptyRequired()');
  if (!Array.isArray(missing)) missing = [];
  const unresolved = [];
  const filled = [];

	  for (const field of missing) {
	    if (field.type === 'file' && isCoverLetterField(field)) {
	      if (!COVER_LETTER || !existsSync(COVER_LETTER)) {
	        unresolved.push({
	          ...field,
	          note: 'cover_letter_required_not_generated',
	          manual_required: true,
	          detail: process.env.MRWEIRDO_COVER_LETTER_GENERATION_REASON || 'no_d1_cover_letter_path',
	        });
	        continue;
	      }
	      const selector = selectorForField(field);
	      const upload = selector ? cdp('upload', tab, selector, COVER_LETTER) : { code: 1, stdout: '', stderr: 'missing selector' };
	      if (upload.code === 0) {
	        coverLetterUploaded = true;
	        filled.push({ label: field.label, result: parseJson(upload.stdout, upload.stdout), mode: 'cover_letter_upload' });
	      } else {
	        unresolved.push({ ...field, note: 'cover_letter_upload_failed', manual_required: true, stderr: upload.stderr, stdout: upload.stdout });
	      }
	      await sleep(150);
	      continue;
	    }
	    const answer = answerForField(field);
    if (!answer) {
      unresolved.push(field);
      continue;
    }
    const js = field.type === 'react-select'
      ? `(async () => await Lever.pickSelect(${JSON.stringify(field.id)}, ${JSON.stringify(answer)}))()`
      : `Lever.fillCardField(${JSON.stringify(field.id)}, ${JSON.stringify(answer)})`;
    const result = await evalInTab(tab, js);
    if (result?.ok) filled.push({ label: field.label, answer, result });
    else unresolved.push({ ...field, attempted_answer: answer, result });
    await sleep(150);
  }

  const stillMissing = await evalInTab(tab, 'Lever.findEmptyRequired()');
  return {
    filled,
    unresolved,
    still_missing: Array.isArray(stillMissing) ? stillMissing : [],
  };
}

async function closeTab(tab) {
  if (!tab) return;
  const host = process.env.CDP_HOST?.replace(/^https?:\/\//, '') ||
    (process.env.ATS_CDP_PORT ? `localhost:${process.env.ATS_CDP_PORT}` : 'localhost:9222');
  try {
    await fetch(`http://${host}/json/close/${tab}`);
  } catch {
    // best effort
  }
}

async function main() {
  let tab = null;
  let preShot = null;
  let postShot = null;
  try {
    const applyUrl = normalizeLeverUrl(APPLY_URL_RAW);
    if (!existsSync(RESUME)) {
      outcome({ outcome: 'skip', reason: 'resume_missing', resume_path: RESUME });
      return;
    }

    const goto = cdp('goto', applyUrl);
    const tabInfo = parseJson(goto.stdout);
    if (goto.code !== 0 || !tabInfo?.id) {
      outcome({ outcome: 'skip', reason: 'cdp_goto_failed', stderr: goto.stderr, url: applyUrl });
      return;
    }
    tab = tabInfo.id;
    await sleep(2500);

    const unavailable = await evalInTab(tab, `(() => {
      const text = (document.body && document.body.innerText || '').toLowerCase();
      const hasSubmit = !!document.querySelector('button[data-qa="btn-submit"], button#btn-submit, #btn-submit, button[type="submit"], input[type="submit"]');
      const unavailable = /no longer accepting|posting was removed|position.*closed|job not found|404/.test(text);
      return { unavailable, hasSubmit, url: location.href, title: document.title };
    })()`);
    if (unavailable.unavailable || !unavailable.hasSubmit) {
      outcome({ outcome: 'skip', reason: 'job_unavailable', detail: unavailable, url: applyUrl });
      return;
    }

    const inject = cdp('eval', tab, readFileSync(HELPERS, 'utf8'));
    if (inject.code !== 0 || !/Lever ready/.test(inject.stdout)) {
      outcome({ outcome: 'skip', reason: 'helpers_inject_fail', stdout: inject.stdout, stderr: inject.stderr });
      return;
    }

    const leverProfile = buildLeverProfile(PROFILE);
    const fill = await evalInTab(tab, `(async () => await Lever.fillForm(${JSON.stringify(leverProfile)}))()`);

    let uploaded = null;
    for (const selector of ['input[type=file][name=resume]', 'input[type=file][data-qa=resume-upload]', '#resume-upload-input', 'input[type=file]']) {
      const up = cdp('upload', tab, selector, RESUME);
      if (up.code === 0) {
        uploaded = { selector, result: parseJson(up.stdout, up.stdout) };
        break;
      }
    }
    if (!uploaded) {
      outcome({ outcome: 'skip', reason: 'resume_upload_fail', fill });
      return;
    }

    const storage = await evalInTab(tab, '(async () => await Lever.waitForResumeStorageId(45000))()');
    const verifyResume = await evalInTab(tab, 'Lever.verifyResumeUploaded()');
    if (!storage?.ok && !verifyResume?.ok) {
      outcome({ outcome: 'skip', reason: 'resume_storage_timeout', storage, verifyResume, fill });
      return;
    }

    let answerPass = await answerRemaining(tab);
    if (answerPass.filled.length > 0 && answerPass.still_missing.length > 0) {
      answerPass = {
        first_pass: answerPass,
        second_pass: await answerRemaining(tab),
      };
    }
	    const unresolved = answerPass.second_pass?.still_missing || answerPass.still_missing || [];
	    if (unresolved.length > 0) {
	      const allUnresolved = collectAnswerPassUnresolved(answerPass);
	      const manualCoverLetter = allUnresolved.some((field) => field?.note === 'cover_letter_required_not_generated');
	      outcome({ outcome: 'skip', reason: manualCoverLetter ? 'cover_letter_required_not_generated' : 'incomplete_form', fill, answer_pass: answerPass, remaining: unresolved });
	      return;
	    }

    const captcha = await evalInTab(tab, `(() => {
      const selectors = ['iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]', '[id*="captcha" i]'];
      const foundWidget = selectors.some((s) => document.querySelector(s));
      const text = (document.body && document.body.innerText || '').toLowerCase();
      return { found_widget: foundWidget, found_text: text.includes('verify you are human') };
    })()`);
    if (captcha.found_widget || captcha.found_text) {
      outcome({ outcome: 'skip', reason: 'captcha_detected', captcha });
      return;
    }

    const visibleError = await evalInTab(tab, 'Lever.isErrorMessageVisible()');
    if (visibleError.visible) {
      outcome({ outcome: 'skip', reason: 'visible_validation_error', visible_error: visibleError });
      return;
    }

    mkdirSync(join(HOME, 'log/screenshots'), { recursive: true });
    const company = (new URL(applyUrl).pathname.split('/')[1] || 'lever').replace(/[^a-z0-9_-]+/gi, '_');
    const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
    preShot = join(HOME, 'log/screenshots', `${company}_${JOB_ID || 'row'}_lever_pre_${stamp}.png`);
    postShot = join(HOME, 'log/screenshots', `${company}_${JOB_ID || 'row'}_lever_post_${stamp}.png`);
    cdp('screenshot', tab, preShot);

    const submit = await evalInTab(tab, `(() => {
      const found = Lever.findSubmit();
      if (!found.ok) return found;
      const el = document.querySelector(found.selector);
      el.click();
      return { ok: true, clicked: found.selector, text: found.text };
    })()`);
    if (!submit?.ok) {
      outcome({ outcome: 'skip', reason: 'submit_button_not_found', submit });
      return;
    }

    await sleep(5000);
    const success = await evalInTab(tab, 'Lever.checkSuccess()');
    const page = await evalInTab(tab, '(() => ({ url: location.href, title: document.title }))()');
    cdp('screenshot', tab, postShot);

    if (success?.ok) {
      outcome({
        outcome: 'submitted',
        platform: 'lever',
        url: applyUrl,
        post_url: page.url,
        screenshot_pre: preShot,
	        screenshot_post: postShot,
	        fill,
	        answer_pass: answerPass,
	        cover_letter_uploaded: coverLetterUploaded,
	      });
      return;
    }

    outcome({
      outcome: 'skip',
      reason: 'submit_verify_fail',
      submit,
      success,
      page,
      screenshot_pre: preShot,
      screenshot_post: postShot,
    });
  } catch (e) {
    outcome({ outcome: 'skip', reason: 'driver_exception', error: e.message, stack: e.stack });
  } finally {
    await closeTab(tab);
  }
}

await main();
