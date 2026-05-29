// Fixture-driven routing test over REAL/representative Ashby question phrasings
// (including labels this project has actually hit). It reproduces the driver's
// routing ORDER from answerMissing(): (1) the answer_routing specific-city
// logistics FACT guard, (2) the "how did you hear" interception, then (3) the
// pure matchAnswerBucket bucket list. Each fixture asserts the resolved action.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { matchAnswerBucket, PNA } from '../shared/answer_buckets.mjs';
import {
  isSpecificCityLogisticsFact,
  mentionsConfirmedCity,
} from '../shared/answer_routing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(readFileSync(join(HERE, 'fixtures/ashby_questions.json'), 'utf8'));

const CTX = {
  PROFILE: {
    personal: { first_name: 'Lee', last_name: 'Lin', full_name: 'Lee Lin', preferred_name: 'Lee' },
    education: { school: 'Babson College', degree: 'Bachelor of Science', major: 'Business' },
  },
  authorizedAns: 'Yes',
  sponsorAns: 'Yes',
  rtoAns: 'Yes',
  genderAns: PNA,
  raceAns: PNA,
  veteranAns: 'I am not a protected veteran',
  disabilityAns: 'I do not want to answer',
  cityFull: 'Boston, Massachusetts, United States',
  compensationExpectation: 'Open to discussion based on the role.',
  linkedin: 'https://linkedin.com/in/leelin',
  graduationDate: 'May 2027',
  pna: PNA,
};

// Mirrors the routing precedence in answerMissing() up to the bucket list.
function routeAction(label) {
  const ml = label.toLowerCase();
  // (1) specific-city logistics FACT guard runs first (no confirmed cities here)
  if (isSpecificCityLogisticsFact(ml) && !mentionsConfirmedCity(ml, [])) {
    return 'specific_city_fact';
  }
  // (2) "how did you hear" is intercepted before the bucket list
  if (/how did you hear|hear about/i.test(ml)) {
    return 'hear_about';
  }
  // (3) the pure bucket list
  const b = matchAnswerBucket(label, CTX);
  return b ? b.action : null;
}

test('every fixture label routes to its expected action', () => {
  assert.ok(FIXTURES.length >= 8, 'fixture should cover the representative labels');
  for (const { label, expectedAction, note } of FIXTURES) {
    assert.equal(routeAction(label), expectedAction, `${label} (${note})`);
  }
});

test('RTO fixture also carries the relocationCommitment flag in its bucket', () => {
  const rto = FIXTURES.find((f) => /in-office three days/.test(f.label));
  const b = matchAnswerBucket(rto.label, CTX);
  assert.equal(b.relocationCommitment, true);
});
