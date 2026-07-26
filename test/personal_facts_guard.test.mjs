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
// default until 2026-07-25. No driver may read those two keys again.
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
      .filter((entry) => /yes_no_defaults\s*\??\.\s*(work_authorization|sponsorship_future)/.test(entry));
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
