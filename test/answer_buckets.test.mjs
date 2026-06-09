// Unit-tests the driver's answer-bucket matching decision (extracted from
// ashby_apply_driver.mjs answerMissing()). matchAnswerBucket is pure: given a
// field label + a ctx of driver-resolved values, it returns the bucket
// descriptor (action + resolved value/choice + flags) the driver will execute.
// These tests lock the routing for representative Ashby labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchAnswerBucket, PNA } from '../shared/answer_buckets.mjs';

// A representative ctx mirroring what the driver builds from PROFILE/BANK/
// SEARCH_INTENT + deriveWorkAuthAnswers (F-1 OPT honesty -> Yes/Yes).
const CTX = {
  PROFILE: {
    personal: {
      first_name: 'Alex',
      last_name: 'Chen',
      full_name: 'Alex Chen',
      preferred_name: 'Alex',
      portfolio: 'https://alex.example/portfolio',
    },
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
  earliestStartDate: '2026-06-08',
  linkedin: 'https://linkedin.com/in/alexchen',
  graduationDate: 'May 2027',
  pna: PNA,
};

test('authorized-to-work routes to a Yes radio (F-1 OPT)', () => {
  const b = matchAnswerBucket('Are you authorized to work in the United States?', CTX);
  assert.equal(b.action, 'click_radio_in_question');
  assert.equal(b.choice, 'Yes');
  assert.equal(b.fallback, PNA);
});

test('sponsorship routes to the sponsorAns radio (never a false no-sponsorship)', () => {
  const b = matchAnswerBucket('Will you now or in the future require sponsorship for employment visa status?', CTX);
  assert.equal(b.action, 'click_radio_in_question');
  assert.equal(b.choice, 'Yes');
  assert.equal(b.fallback, PNA);
});

test('RTO / in-office commitment carries the relocationCommitment flag', () => {
  const b = matchAnswerBucket('Are you willing and able to work in-office three days per week?', CTX);
  assert.equal(b.action, 'click_radio_in_question');
  assert.equal(b.choice, 'Yes'); // rtoAns
  assert.equal(b.relocationCommitment, true);
});

test('SF Bay relocation question offers the relocation choice list', () => {
  const b = matchAnswerBucket('Are you currently located in the SF Bay Area, or open to relocation?', CTX);
  assert.equal(b.action, 'click_radio_in_question');
  assert.ok(Array.isArray(b.choices));
  assert.equal(b.choices[0], 'Yes, I am open to relocation');
  // 3-option radios phrase the yes-answer differently (abby-care regression):
  // the list must carry contraction/gerund variants so one of them lands.
  assert.ok(b.choices.includes("Yes, I'm open to relocation"));
  assert.ok(b.choices.includes('Yes, I am open to relocating'));
  assert.ok(b.choices.includes('No, but I am open to relocating to the Bay Area'));
  // Plain 'No' stays LAST so specific yes-variants always win first.
  assert.equal(b.choices[b.choices.length - 1], 'No');
});

test('location question routes to the combobox filler with cityFull', () => {
  const b = matchAnswerBucket('Where are you currently based?', CTX);
  assert.equal(b.action, 'fill_location_combobox');
  assert.equal(b.value, 'Boston, Massachusetts, United States');
});

test('compensation routes to a text fill with the comp expectation', () => {
  const b = matchAnswerBucket('What are your salary requirements?', CTX);
  assert.equal(b.action, 'fill_text_in_question');
  assert.equal(b.value, 'Open to discussion based on the role.');
});

test('EEO gender/race/veteran/disability prefer-not-to-answer', () => {
  assert.equal(matchAnswerBucket('Gender', CTX).choice, PNA);
  assert.equal(matchAnswerBucket('Race/Ethnicity', CTX).choice, PNA);
  assert.equal(matchAnswerBucket('Veteran status', CTX).choice, 'I am not a protected veteran');
  assert.equal(matchAnswerBucket('Disability status', CTX).choice, 'I do not want to answer');
});

test('start date fills the profile start date', () => {
  const b = matchAnswerBucket('What is your earliest start date?', CTX);
  assert.equal(b.action, 'fill_text_in_question');
  assert.equal(b.value, '2026-06-08');
});

test('name fields resolve from profile; preferred/legal qualifiers ordered first', () => {
  assert.equal(matchAnswerBucket('Legal Last Name', CTX).value, 'Chen');
  assert.equal(matchAnswerBucket('Preferred First Name', CTX).value, 'Alex');
  assert.equal(matchAnswerBucket('Legal First Name', CTX).value, 'Alex');
  assert.equal(matchAnswerBucket('Full Name', CTX).value, 'Alex Chen');
});

test('hear-about is handled before the bucket list — bucket list has no rule', () => {
  // answerMissing() intercepts "how did you hear" before matchAnswerBucket is
  // reached, so the bucket list itself returns null for it (verbatim: there is
  // no hear-about descriptor in the buckets array).
  assert.equal(matchAnswerBucket('How did you hear about this job?', CTX), null);
});

test('graduation date uses ctx.graduationDate', () => {
  const b = matchAnswerBucket('When do you expect to graduate?', CTX);
  assert.equal(b.action, 'fill_text_in_question');
  assert.equal(b.value, 'May 2027');
});

test('no matching bucket returns null (driver marks pending_for_main_claude)', () => {
  assert.equal(matchAnswerBucket('Describe a time you led a project (500 words)', CTX), null);
});

test('phone and resume route to their dedicated actions', () => {
  assert.equal(matchAnswerBucket('Phone number', CTX).action, 'fill_phone');
  assert.equal(matchAnswerBucket('Resume', CTX).action, 'upload_resume');
});
