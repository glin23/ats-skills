// Turns the "never state a personal fact we were not told" red line into
// executable assertions. Until 2026-07-23 that rule lived only in prose, and
// the shipped defaults quietly contradicted it: veteran status was asserted as
// a fact, the profile template pre-filled demographics the user never answered,
// and the Greenhouse driver hard-coded "No" for a master's degree without
// reading the profile at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GATED_PATHS, blockingProfileGaps } from '../shared/personal_fact_gate.mjs';
import { ask, BASE } from './greenhouse_driver_harness.mjs';
import { categoryOf, runGapReport } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readText = (p) => readFileSync(join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(readText(p));

// A voluntary EEO (Equal Employment Opportunity, 平等就业机会) self-disclosure
// answer is only allowed to be a REFUSAL when it comes from a default.
const REFUSAL_RE = /prefer not|do not want|don'?t want|do not wish|don'?t wish|decline|prefer_not|rather not/i;

test('answer_bank yes_no_defaults: every EEO self-disclosure default is a refusal', () => {
  const defaults = readJson('shared/answer_bank.json').yes_no_defaults || {};
  for (const key of ['gender', 'race', 'veteran', 'disability']) {
    const value = defaults[key];
    assert.ok(typeof value === 'string' && value.length > 0, `missing yes_no_defaults.${key}`);
    assert.match(
      value,
      REFUSAL_RE,
      `yes_no_defaults.${key} = "${value}" asserts a personal fact; EEO defaults must decline to answer`,
    );
  }
});

test('driver EEO fallbacks: no hard-coded veteran-status FACT left in the drivers', () => {
  for (const file of [
    'shared/ashby_apply_driver.mjs',
    'shared/greenhouse_apply_driver.mjs',
    'shared/lever_apply_driver.mjs',
    'shared/answer_buckets.mjs',
    'shared/answer_bank.json',
    'shared/profile.template.json',
  ]) {
    const src = readText(file);
    assert.equal(
      /I am not a protected veteran/.test(src),
      false,
      `${file} still defaults to the factual claim "I am not a protected veteran"`,
    );
  }
});

test('profile.template.json: demographics ship EMPTY so "user said" stays distinguishable from "factory default"', () => {
  const demographics = readJson('shared/profile.template.json').demographics;
  assert.ok(demographics && typeof demographics === 'object', 'demographics block missing');
  for (const [key, value] of Object.entries(demographics)) {
    if (key.startsWith('_')) continue; // `_notes` documentation key, same convention as legal_attestations
    assert.equal(
      value,
      null,
      `demographics.${key} ships pre-filled with "${value}"; the code cannot tell that apart from a real user answer`,
    );
  }
  for (const key of ['race', 'hispanic_or_latino', 'gender', 'veteran_status', 'disability_status']) {
    assert.ok(key in demographics, `demographics.${key} key must stay present (as null) for shape stability`);
  }
});

// The same reasoning, applied to the block that actually blocks applications.
// The shipped template answered "yes, authorized to work in the US" for every
// person who ever installed the tool, and that pre-filled `true` is byte-for-byte
// what a real answer looks like — so the three-state guards added on 2026-07-25
// could never fire for anyone who started from the template. Empty is the only
// state that means "nobody has said".
test('profile.template.json: work authorization ships EMPTY, so a guard can tell nobody answered', () => {
  const auth = readJson('shared/profile.template.json').work_authorization;
  assert.ok(auth && typeof auth === 'object', 'work_authorization block missing');
  for (const key of ['authorized_to_work_us', 'requires_sponsorship_now', 'requires_sponsorship_future']) {
    assert.ok(key in auth, `work_authorization.${key} must stay present (as null) for shape stability`);
    assert.equal(
      auth[key],
      null,
      `work_authorization.${key} ships as "${auth[key]}"; the code cannot tell that apart from a real user answer`,
    );
  }
  assert.equal(auth.visa_status, '', `visa_status ships as "${auth.visa_status}", which is a claim nobody made`);
});

// Relocation willingness is named in the red line itself (PRD-v3: "never
// fabricate visa / GPA / demographic / attestation / background-check /
// RELOCATION"), and until 2026-07-26 it was the only name on that list with no
// assertion behind it. Found by verify on 2026-07-26: of six profile shapes fed
// to the shipped driver, the factory template was the ONLY one that answered
// "Would you be willing to relocate to our New York office?" — with "Yes".
// Same disease as the work_authorization block above: a factory value is
// byte-for-byte what a real answer looks like, so no code downstream can tell
// "the user agreed to move across the country" from "nobody ever asked".
//
// Two template values each trigger it on their own (found by bisecting the
// template, one key removed at a time):
// standard_qa.willing_to_relocate_scope and target_filters.relocation_policy
// both resolve to the driver's `anywhere_us` alias. willing_to_relocate is a
// third copy of the same statement, live only through ashby_helpers.js:1222.
test('profile.template.json: relocation willingness ships EMPTY, nobody is volunteered to move', () => {
  const template = readJson('shared/profile.template.json');
  const qa = template.standard_qa || {};
  assert.equal(
    qa.willing_to_relocate,
    null,
    `standard_qa.willing_to_relocate ships as "${qa.willing_to_relocate}"; that is a promise to an employer nobody made`,
  );
  assert.equal(
    qa.willing_to_relocate_scope,
    '',
    `standard_qa.willing_to_relocate_scope ships as "${qa.willing_to_relocate_scope}", which resolves to the driver's anywhere_us alias`,
  );
  assert.equal(
    template.target_filters?.relocation_policy,
    '',
    `target_filters.relocation_policy ships as "${template.target_filters?.relocation_policy}"; it independently resolves to anywhere_us`,
  );
});

// The end-to-end version: the shape assertion above is only worth something if
// it changes what the shipped driver puts on a real form.
const RELOCATE_LABEL = 'Would you be willing to relocate to our New York office?';
const ONSITE_LABEL = 'This role is based in our San Francisco office. Are you able to work from there?';

test('greenhouse driver: a fresh install does not agree to relocate on the user\'s behalf', async () => {
  const template = readJson('shared/profile.template.json');
  for (const label of [RELOCATE_LABEL, ONSITE_LABEL]) {
    const { res, fills } = await ask(template, label);
    assert.equal(
      res.ok,
      false,
      `the factory template answered a relocation question it was never asked: ${label} -> ${JSON.stringify(res)} ${JSON.stringify(fills)}`,
    );
    assert.deepEqual(fills, [], `nothing may be selected on the form: ${JSON.stringify(fills)}`);
  }
});

// The other half of the same rule: a user who DID say "anywhere in the US" must
// still be answered from their own words. Emptying the template must not turn
// into a blanket refusal that blocks every relocation question for everyone.
test('greenhouse driver: a user who actually said "anywhere in the US" is still answered', async () => {
  const said = { ...BASE, standard_qa: { willing_to_relocate_scope: 'Anywhere US' } };
  const { res, fills } = await ask(said, RELOCATE_LABEL);
  assert.equal(res.ok, true, `a stated relocation scope must still answer the question: ${JSON.stringify(res)}`);
  assert.equal(fills.at(-1)?.value, 'Yes', `expected the user's own answer on the form: ${JSON.stringify(fills)}`);
});

// GPA is named in the same red line as relocation ("never fabricate visa / GPA /
// demographic / attestation / background-check / relocation") and was the last
// name on it still shipping a value: education.gpa = "3.9". It is the same
// disease as work_authorization and relocation, with one twist — it is not a
// three-state boolean but a number, and "3.9" is truthy, so
// apply_gap_report.mjs:266 filed every GPA question under "the agent fills this
// from the profile". A user who copied the template was therefore never asked
// for a GPA and had a 3.9 he never claimed typed onto real application forms
// (verified against the shipped Greenhouse driver, below).
const GPA_LABEL = 'What is your GPA?';
const TEXT_FIELD = { type: 'text' };

test('profile.template.json: GPA ships EMPTY, no number is invented for the user', () => {
  const education = readJson('shared/profile.template.json').education;
  assert.ok(education && typeof education === 'object', 'education block missing');
  assert.ok('gpa' in education, 'education.gpa key must stay present (as "") for shape stability');
  assert.equal(
    education.gpa,
    '',
    `education.gpa ships as "${education.gpa}"; that is a claim about the user's grades nobody made`,
  );
});

test('greenhouse driver: a fresh install types no GPA onto the form', async () => {
  const template = readJson('shared/profile.template.json');
  const { res, fills } = await ask(template, GPA_LABEL, TEXT_FIELD);
  assert.equal(
    res.ok,
    false,
    `the factory template answered a GPA question it was never asked: ${JSON.stringify(res)} ${JSON.stringify(fills)}`,
  );
  assert.deepEqual(fills, [], `nothing may be typed on the form: ${JSON.stringify(fills)}`);
});

// The other half of the rule, twice over. Emptying the template must not turn
// into "no GPA is ever answered" (the user's own 3.2 must still be typed), and
// an empty GPA must BLOCK — not fall back to "" or 0, which on a real form is a
// worse lie than saying nothing.
test('greenhouse driver: a user who stated a GPA still gets it typed, and an empty one blocks', async () => {
  const stated = { ...BASE, education: { ...BASE.education, gpa: '3.2' } };
  const said = await ask(stated, GPA_LABEL, TEXT_FIELD);
  assert.equal(said.res.ok, true, `a stated GPA must still answer the question: ${JSON.stringify(said.res)}`);
  assert.equal(said.fills.at(-1)?.value, '3.2', `expected the user's own GPA on the form: ${JSON.stringify(said.fills)}`);

  const blank = await ask({ ...BASE, education: { ...BASE.education, gpa: '' } }, GPA_LABEL, TEXT_FIELD);
  assert.equal(blank.res.ok, false, `an unknown GPA must block: ${JSON.stringify(blank.res)}`);
  assert.deepEqual(blank.fills, [], `an unknown GPA must not be typed as "" or 0: ${JSON.stringify(blank.fills)}`);
});

// Blocking is only half a fix: a blocked row that never becomes a question is
// "stuck with no idea why". The report must file the factory template's GPA
// question under "ask the user", not under "fill it from the profile".
test('gap report: a fresh install is ASKED for a GPA instead of being answered from the template', () => {
  const template = readJson('shared/profile.template.json');
  const { report } = runGapReport('mrw-gpa-gap-', template, [{
    outcome: 'skip',
    reason: 'value_empty_for:what is your gpa?',
    job_id: 901,
    remaining: [{ label: GPA_LABEL, type: 'text', required: true, note: 'value_empty_for:what is your gpa?' }],
  }]);
  assert.equal(
    categoryOf(report, GPA_LABEL),
    'user_gpa',
    `a GPA nobody stated must become a question: ${JSON.stringify(report.user_questions)}`,
  );
});

test('the shipped template does not open the pre-batch gate on its own', () => {
  // The end-to-end version of the assertion above: a fresh install must be
  // stopped by the gate and asked, not waved through on factory values.
  const template = readJson('shared/profile.template.json');
  const gate = blockingProfileGaps(template);
  assert.equal(gate.ok, false, 'a fresh template profile must be gated until the user answers A0');
  assert.deepEqual(gate.missing_paths, [...GATED_PATHS]);
});

// A shared answer-bank default cannot know a fact about one specific person.
// Work authorization and future-sponsorship need are exactly such facts, and the
// shipped bank answered both with "Yes" — so every user, including one who had
// said "I am NOT authorized", got "Yes" typed onto real application forms.
// 88% of the eligible-but-unapplied queue is on Greenhouse, which read that
// default until 2026-07-25. No driver may read those keys again.
// willing_to_relocate is on the list for the same reason and while it still has
// zero readers: the bank ships it as "Yes", so the day someone wires it up they
// would re-create the defect this file exists to prevent, silently.
test('drivers: work-auth / sponsorship answers never come from a shared bank default', () => {
  for (const file of [
    'shared/greenhouse_apply_driver.mjs',
    'shared/ashby_apply_driver.mjs',
    'shared/lever_apply_driver.mjs',
    'shared/answer_buckets.mjs',
    'shared/answer_routing.mjs',
  ]) {
    const offenders = readText(file)
      .split('\n')
      .map((line, i) => `${file}:${i + 1}: ${line.trim()}`)
      .filter((entry) => /yes_no_defaults\s*\??\.\s*(work_authorization|sponsorship_future|willing_to_relocate)/.test(entry));
    assert.deepEqual(
      offenders,
      [],
      `a personal work-auth fact is answered from a shared default:\n${offenders.join('\n')}`,
    );
  }
});

test('greenhouse driver: the three-state work-auth guard runs BEFORE any work-auth value branch', () => {
  const src = readText('shared/greenhouse_apply_driver.mjs');
  const guardIdx = src.indexOf('workAuthGapFor(labelText, PROFILE)');
  assert.ok(guardIdx > 0, 'answerMissing must call workAuthGapFor(labelText, PROFILE)');
  assert.match(
    src.slice(guardIdx, guardIdx + 400),
    /needs_user_answer:\s*true/,
    'a never-asked work-auth question must be surfaced to the user, not filled',
  );
  const authBranchIdx = src.indexOf('legally authorized|authorized to work');
  assert.ok(authBranchIdx > 0, 'could not locate the work-authorization value branch');
  assert.ok(
    guardIdx < authBranchIdx,
    'the guard must run before the branch that fills a work-authorization answer',
  );
  const line = src.split('\n').find((l) => l.includes('legally authorized|authorized to work'));
  assert.match(line, /authorizedAns/, `work-authorization answer must come from the profile; found: ${line.trim()}`);
});

// Source-level guard: the Greenhouse driver is a CLI entry point (it reads
// profile.json and argv at import time), so it cannot be imported into a unit
// test. Asserting on its source is the honest way to lock this one line.
test('greenhouse driver: the master\'s-degree question reads the profile, never a hard-coded No', () => {
  const src = readText('shared/greenhouse_apply_driver.mjs');
  const line = src
    .split('\n')
    .find((l) => l.includes("master'?s|masters|graduate degree"));
  assert.ok(line, 'could not locate the master\'s-degree select branch');
  assert.match(
    line,
    /isGraduateDegreeProfile\(\)/,
    `master's-degree answer must come from isGraduateDegreeProfile(); found: ${line.trim()}`,
  );
  assert.equal(
    /value = 'No'/.test(line),
    false,
    `master's-degree answer is still hard-coded: ${line.trim()}`,
  );
});
