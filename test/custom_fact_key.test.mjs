import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { customFactAnswered, customFactKey } from '../shared/missing_field_questions.mjs';
import { categoryOf, runGapReport } from './helpers.mjs';

// ---------------------------------------------------------------------------
// `standard_qa.custom_facts` is the bucket for every fact that has no bucket of
// its own. "Is the bucket non-empty?" is therefore not an answer to any one
// question: the user telling us his current city says nothing about his
// preferred name. Reading the bucket as an answer is how a question nobody has
// ever been asked comes back as "fill it from the profile" — the driver says it
// has nothing to type, the report says the profile holds it, and the row sticks
// with no one to unstick it.
//
// The real profile holds 11 such facts, so before this rule existed the whole
// empty-value prefix rule was cancelled out for the only real user.
// ---------------------------------------------------------------------------

// Shaped like the real profile's bucket (same key style, same kinds of values),
// so a rule that only works on toy one-key fixtures cannot pass here.
const REAL_SHAPED_FACTS = {
  previously_worked_at_faraday_future: false,
  lives_in_west_end_neighborhood: false,
  excel_proficiency: 'Advanced',
  google_sheets_proficiency: 'Advanced',
  figma_proficiency: 'Intermediate',
  us_citizen: false,
  us_citizen_note: 'Not a US citizen; F-1 OPT eligible',
  previously_employed_here_default: false,
  permanent_residence_state: 'MA',
  current_city: 'Waltham, MA',
  english_first_language_note: 'Bilingual native',
};

const NO_VALUE_LABELS = [
  ['Preferred name', 'value_empty_for:preferred name'],
  ['Primary phone number', 'no_bucket_for:primary phone number'],
  ['Expected graduation month', 'value_empty_for:expected graduation month'],
];

function blockedRow(jobId, company, fields) {
  return {
    outcome: 'skip',
    reason: 'incomplete_form',
    job_id: jobId,
    company,
    remaining: fields.map(([label, note]) => ({ label, note })),
  };
}

test('customFactKey: the key is the question, with the phrasing stripped off', () => {
  assert.equal(customFactKey('Preferred name'), 'preferred_name');
  assert.equal(customFactKey('What is your primary phone number?'), 'primary_phone_number');
  assert.equal(customFactKey('Expected graduation month'), 'expected_graduation_month');
  // Whatever is stripped must leave a run of words that is still IN the label,
  // otherwise the answer would be written under a key the next run cannot find.
  for (const label of ['Preferred name', 'What is your primary phone number?', 'Do you have reliable transportation?']) {
    const phrase = customFactKey(label).replace(/_/g, ' ');
    assert.ok(
      ` ${label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `.includes(` ${phrase} `),
      `${label} -> ${phrase} must stay a word run of the label`,
    );
  }
});

test('customFactAnswered: one fact in the bucket is not an answer to every question', () => {
  assert.equal(customFactAnswered('Preferred name', REAL_SHAPED_FACTS), false);
  assert.equal(customFactAnswered('What is your primary phone number?', REAL_SHAPED_FACTS), false);
  // The fact he really did answer stays answered — a finer rule must not turn
  // into "always ask".
  assert.equal(customFactAnswered('What is your current city?', REAL_SHAPED_FACTS), true);
  assert.equal(customFactAnswered('Are you a US citizen?', REAL_SHAPED_FACTS), true);
  // `false` is an answer ("no, I never worked there"); an empty value is not.
  assert.equal(customFactAnswered('Have you previously worked at Faraday Future?', REAL_SHAPED_FACTS), true);
  assert.equal(customFactAnswered('Preferred name', { preferred_name: '' }), false);
  assert.equal(customFactAnswered('Preferred name', { preferred_name: null }), false);
  // Word boundaries, not substrings: "us" inside "bonus" is not a US citizen.
  assert.equal(customFactAnswered('What is your expected bonus?', { us: true }), false);
});

test('gap report: a full custom_facts bucket does not answer a question nobody was asked', () => {
  const { report } = runGapReport('mrw-gap-bucket-', {
    standard_qa: { custom_facts: REAL_SHAPED_FACTS },
  }, [blockedRow(2001, 'Bucket Co', NO_VALUE_LABELS)]);

  for (const [label] of NO_VALUE_LABELS) {
    assert.equal(
      categoryOf(report, label),
      'unknown_user_fact',
      `${label}: the driver said it had nothing to type, so the report may not answer "fill it from the profile"`,
    );
  }
  assert.ok(!report.agent_actions.some((a) => a.category === 'agent_profile_backed'));
});

test('gap report: the fact he really answered stays answered, the others get asked', () => {
  const { report } = runGapReport('mrw-gap-bucket-mixed-', {
    standard_qa: { custom_facts: { ...REAL_SHAPED_FACTS, preferred_name: 'Al' } },
  }, [blockedRow(2002, 'Mixed Co', NO_VALUE_LABELS)]);

  assert.equal(categoryOf(report, 'Preferred name'), 'agent_profile_backed');
  assert.equal(categoryOf(report, 'Primary phone number'), 'unknown_user_fact');
  assert.equal(categoryOf(report, 'Expected graduation month'), 'unknown_user_fact');
});

test('gap report: answering under the key the report itself hands out ends the question', () => {
  // The closing half of the loop, and the reason the report publishes a key at
  // all: if the key were left to whoever writes the answer, the next run would
  // not recognise it and the same question would come back forever.
  const first = runGapReport('mrw-gap-loop-', {
    standard_qa: { custom_facts: REAL_SHAPED_FACTS },
  }, [blockedRow(2003, 'Loop Co', NO_VALUE_LABELS)]);

  const asked = first.report.user_questions.find((q) => q.category === 'unknown_user_fact');
  assert.ok(asked, 'the three facts must be asked the first time round');
  assert.equal(asked.examples.length, 3);
  const answers = {};
  for (const example of asked.examples) {
    assert.ok(example.profile_key, `${example.label} must come with the key its answer is written under`);
    answers[example.profile_key] = 'answered by the user';
  }

  const profilePath = join(first.home, 'profile.json');
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  profile.standard_qa.custom_facts = { ...profile.standard_qa.custom_facts, ...answers };
  writeFileSync(profilePath, JSON.stringify(profile));

  const second = runGapReport('mrw-gap-loop-2-', profile, [blockedRow(2003, 'Loop Co', NO_VALUE_LABELS)]);
  assert.deepEqual(
    second.report.user_questions.map((q) => q.category),
    [],
    'a fact answered under the published key must stop being asked',
  );
  for (const [label] of NO_VALUE_LABELS) {
    assert.equal(categoryOf(second.report, label), 'agent_profile_backed');
  }
});
