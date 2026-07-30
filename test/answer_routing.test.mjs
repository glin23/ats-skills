// Locks the driver's safety-critical answer-routing decisions (extracted from
// ashby_apply_driver.mjs). Includes the REAL question labels seen on live Ashby
// forms so a regression would fail here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  isSpecificCityLogisticsFact,
  isOpenEndedResidenceQuestion,
  relocationPolicyOpen,
  confirmedCitiesFrom,
  mentionsConfirmedCity,
  deriveWorkAuthAnswers,
  workAuthGapFor,
  currentResidenceYesNoAnswer,
} from '../shared/answer_routing.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The REAL shipped answer bank — the 2026-07-23 defect was only reachable with
// it, because its yes_no_defaults turned every non-true profile into "Yes".
const SHIPPED_BANK = JSON.parse(readFileSync(join(ROOT, 'shared/answer_bank.json'), 'utf8'));

test('isOpenEndedResidenceQuestion: answerable-from-profile prompts vs guarded named-city', () => {
  // Open-ended "state your residence" prompts — answerable from the profile city.
  assert.equal(isOpenEndedResidenceQuestion('Where do you currently live?'), true);
  assert.equal(isOpenEndedResidenceQuestion('Where do you reside?'), true);
  assert.equal(isOpenEndedResidenceQuestion('Where are you located?'), true);
  assert.equal(isOpenEndedResidenceQuestion('Current city of residence'), true);
  // Named / yes-no specific-city questions must NOT count as open-ended (stay guarded).
  assert.equal(isOpenEndedResidenceQuestion('Are you currently located in the Bay Area, California?'), false);
  assert.equal(isOpenEndedResidenceQuestion('Do you currently reside in Boston?'), false);
  assert.equal(isOpenEndedResidenceQuestion('Do you have reliable transportation to our Cincinnati office?'), false);
  // Combined guard semantics: a row is only blocked when it's a specific-city fact
  // AND not an open-ended prompt.
  const blocked = (l) => isSpecificCityLogisticsFact(l) && !isOpenEndedResidenceQuestion(l);
  assert.equal(blocked('Where do you currently live?'), false); // answerable now
  assert.equal(blocked('Do you currently reside in Boston?'), true); // still guarded
});

test('isSpecificCityLogisticsFact: residence/transport FACTS, not willingness', () => {
  // real abby-care label (conflates residence fact + willingness) -> treated as FACT
  assert.equal(isSpecificCityLogisticsFact('Are you currently located in the SF Bay Area? Or, if not located in the Bay Area, are you open to relocation?'), true);
  assert.equal(isSpecificCityLogisticsFact('Do you have reliable transportation to our Cincinnati office?'), true);
  assert.equal(isSpecificCityLogisticsFact('Do you currently reside in Boston?'), true);
  // real fuel-cycle label (pure willingness) -> NOT a fact
  assert.equal(isSpecificCityLogisticsFact('Are you willing and able to work in-office three days per week as required for this role?'), false);
  assert.equal(isSpecificCityLogisticsFact('Are you open to relocation for this role?'), false);
});

test('relocationPolicyOpen reads geographic_preference (whole-intent or inner shape)', () => {
  const openWhole = { search_intent: { geographic_preference: { relocation_policy: 'anywhere_legal_work', willing_to_relocate_for_internship: true } } };
  assert.equal(relocationPolicyOpen(openWhole), true);
  assert.equal(relocationPolicyOpen({ geographic_preference: { relocation_policy: 'anywhere_legal_work', willing_to_relocate_for_internship: true } }), true);
  assert.equal(relocationPolicyOpen({ search_intent: { geographic_preference: { relocation_policy: 'fixed_metros', willing_to_relocate_for_internship: true } } }), false);
  assert.equal(relocationPolicyOpen({}), false);
});

test('confirmedCities lowercases; mentionsConfirmedCity matches case-insensitively', () => {
  const profile = { factual_gap_fields: { onsite_location_logistics: { confirmed_cities: ['Cincinnati'] } } };
  const cc = confirmedCitiesFrom(profile);
  assert.deepEqual(cc, ['cincinnati']);
  assert.equal(mentionsConfirmedCity('Do you currently reside in Cincinnati?', cc), true);
  assert.equal(mentionsConfirmedCity('Do you currently reside in Boston?', cc), false);
  assert.deepEqual(confirmedCitiesFrom({}), []);
});

test('confirmedCities includes true work-location commitments, not declined places', () => {
  const cc = confirmedCitiesFrom({
    standard_qa: {
      work_location_commitments: {
        'Bay Area': true,
        'San Francisco': true,
        Singapore: false,
      },
    },
  });
  assert.equal(mentionsConfirmedCity('Are you able to work in the Bay Area?', cc), true);
  assert.equal(mentionsConfirmedCity('Can you work from San Francisco?', cc), true);
  assert.equal(mentionsConfirmedCity('Do you have confirmed plans to be in Singapore?', cc), false);
});

// --- Three-state work-authorization facts (yes / no / never asked) -----------
// These are FACTS ABOUT THE USER'S PERSON. A missing profile value means "we
// never asked", NOT "no" and NOT "yes" — it must block the row instead of
// putting an invented statement on a real application form.

test('deriveWorkAuthAnswers: explicit true -> Yes/Yes (F-1 OPT honesty preserved)', () => {
  const f1 = deriveWorkAuthAnswers(
    { work_authorization: { visa_status: 'F-1 OPT eligible', authorized_to_work_us: true, requires_sponsorship_future: true } },
  );
  assert.equal(f1.sponsorAns, 'Yes');
  assert.equal(f1.authorizedAns, 'Yes');
  assert.equal(f1.sponsorNeedsUser, false);
  assert.equal(f1.authorizedNeedsUser, false);
});

test('deriveWorkAuthAnswers: explicit false -> No, even under the SHIPPED answer bank', () => {
  // A US citizen / green-card holder: needs no sponsorship. The old code sent
  // "Yes, I need sponsorship" here, which gets a real user screened out.
  const citizen = deriveWorkAuthAnswers(
    { work_authorization: { authorized_to_work_us: true, requires_sponsorship_future: false } },
    SHIPPED_BANK,
  );
  assert.equal(citizen.sponsorAns, 'No');
  assert.equal(citizen.authorizedAns, 'Yes');

  // An F-1 student without CPT/OPT yet: NOT authorized today. The old code
  // said "Yes, I am authorized" — a false statement about the user.
  const notAuthorized = deriveWorkAuthAnswers(
    { work_authorization: { visa_status: 'F-1 (no CPT/OPT yet)', authorized_to_work_us: false, requires_sponsorship_future: true } },
    SHIPPED_BANK,
  );
  assert.equal(notAuthorized.authorizedAns, 'No');
  assert.equal(notAuthorized.sponsorAns, 'Yes');
  assert.equal(notAuthorized.authorizedNeedsUser, false);
});

test('deriveWorkAuthAnswers: never asked -> blocks, never invents an answer', () => {
  for (const profile of [{}, { work_authorization: {} }, { work_authorization: { authorized_to_work_us: null, requires_sponsorship_future: null } }]) {
    const out = deriveWorkAuthAnswers(profile, SHIPPED_BANK);
    assert.equal(out.authorizedAns, null, 'unknown authorization must not resolve to a value');
    assert.equal(out.sponsorAns, null, 'unknown sponsorship need must not resolve to a value');
    assert.equal(out.authorizedNeedsUser, true);
    assert.equal(out.sponsorNeedsUser, true);
    assert.equal(out.authorizedNote, 'work_authorization_required');
    assert.equal(out.sponsorNote, 'sponsorship_future_required');
  }
});

test('deriveWorkAuthAnswers is not a constant function (3 profiles -> 3 outcomes)', () => {
  const shapes = [
    { work_authorization: { authorized_to_work_us: true, requires_sponsorship_future: true } },
    { work_authorization: { authorized_to_work_us: true, requires_sponsorship_future: false } },
    {},
  ].map((p) => JSON.stringify(deriveWorkAuthAnswers(p, SHIPPED_BANK)));
  assert.equal(new Set(shapes).size, 3, `work-auth answers collapsed to a constant: ${shapes.join(' | ')}`);
});

test('workAuthGapFor: unknown personal facts block the matching form question', () => {
  const unknown = {};
  const authLabels = [
    'Are you legally authorized to work in the United States?',
    'Are you authorized to work in the US?',
    'Do you have the right to work in the country of employment?',
  ];
  for (const label of authLabels) {
    assert.deepEqual(
      workAuthGapFor(label, unknown),
      { needs_user_answer: true, note: 'work_authorization_required' },
      `should block: ${label}`,
    );
  }
  const sponsorLabels = [
    'Will you now or in the future require sponsorship for employment visa status?',
    'Do you need us to sponsor your work authorization?',
    'What is your current visa status?',
  ];
  for (const label of sponsorLabels) {
    assert.deepEqual(
      workAuthGapFor(label, unknown),
      { needs_user_answer: true, note: 'sponsorship_future_required' },
      `should block: ${label}`,
    );
  }
});

test('workAuthGapFor: an answered profile never blocks; unrelated labels never block', () => {
  const answered = { work_authorization: { authorized_to_work_us: false, requires_sponsorship_future: true } };
  assert.equal(workAuthGapFor('Are you legally authorized to work in the United States?', answered), null);
  assert.equal(workAuthGapFor('Will you require visa sponsorship in the future?', answered), null);
  // Unrelated questions are untouched by this guard.
  assert.equal(workAuthGapFor('What is your expected graduation date?', {}), null);
  assert.equal(workAuthGapFor('How did you hear about this job?', {}), null);
});

test('workAuthGapFor: 「别替我答」有自己的 note，绝不与「没问过」共用', () => {
  // 接缝硬规定 2（设计稿 §13.3.3 门与行层的接缝）：两个 note 的正确后续完全相反——
  // work_authorization_required = 没问过 → 该问；deferred = 他答过了（答的是
  // 「别替我答」）→ 不许再问，只把这一行放进「你自己填最后一格」清单。
  // 共用一个 note 的直接后果是把他已经回答过的问题再问一遍。
  const rowFive = {
    // 真值表第 5 行：常态留学生 + Q4 选 C（默认档）。
    work_authorization: {
      visa_status: 'student_visa_no_permission_yet',
      authorized_to_work_us: null,
      requires_sponsorship_now: null,
      requires_sponsorship_future: true,
      form_answer_policy: 'defer_to_user',
    },
  };
  assert.deepEqual(
    workAuthGapFor('Are you legally authorized to work in the United States?', rowFive),
    { needs_user_answer: true, note: 'work_authorization_deferred_by_user' },
  );

  // 担保题同族一起 defer（接缝表第 5 行「同左」）：其他情形 + Q5 说不清楚 + Q4′ = C。
  const rowNineC = {
    work_authorization: {
      visa_status: 'other_status',
      authorized_to_work_us: null,
      requires_sponsorship_now: null,
      requires_sponsorship_future: null,
      form_answer_policy: 'defer_to_user',
    },
  };
  assert.deepEqual(
    workAuthGapFor('Will you now or in the future require sponsorship for employment visa status?', rowNineC),
    { needs_user_answer: true, note: 'work_authorization_deferred_by_user' },
  );

  // Q4 选 A：授权题已是他自己的陈述（布尔在档案里），不拦；担保题他没答过
  // （真值表第 9 行不写 rsf），照旧走「该问」——policy 管的是授权那道题的作者权，
  // 不是把整个人的所有空格都盖掉。
  const rowNineA = {
    work_authorization: {
      visa_status: 'other_status',
      authorized_to_work_us: true,
      requires_sponsorship_now: null,
      requires_sponsorship_future: null,
      form_answer_policy: 'answer_yes',
    },
  };
  assert.equal(workAuthGapFor('Are you legally authorized to work in the United States?', rowNineA), null);
  assert.deepEqual(
    workAuthGapFor('Do you need us to sponsor your work authorization?', rowNineA),
    { needs_user_answer: true, note: 'sponsorship_future_required' },
  );

  // 没跑过漏斗（没有 policy）的空档案仍走「没问过」那个 note——回归护栏。
  assert.deepEqual(
    workAuthGapFor('Are you legally authorized to work in the United States?', {}),
    { needs_user_answer: true, note: 'work_authorization_required' },
  );
});

test('workAuthGapFor: "visa" is matched as a WORD, not as a substring of another word', () => {
  const unknown = {};
  // Real work-auth phrasings must still block.
  for (const label of [
    'What is your current visa status?',
    'Will you require visa sponsorship now or in the future?',
    'Do you hold an H-1B visa?',
    'Do any of your visas restrict your employment?',
  ]) {
    assert.ok(workAuthGapFor(label, unknown), `should still block: ${label}`);
  }
  // …but an unrelated question that merely CONTAINS the letters v-i-s-a must not
  // be dragged into the work-authorization guard. Measured 2026-07-25: the bare
  // `visa` token matched "ad-VISA-ble".
  assert.equal(
    workAuthGapFor('Would it be advisable to contact your current employer?', unknown),
    null,
    '"advisable" is not a work-authorization question',
  );
  // Known remaining limitation (unchanged, reported not fixed): a company
  // literally named "Visa" still matches, because there "visa" IS a word.
});

test('currentResidenceYesNoAnswer uses profile address for named residence facts', () => {
  const profile = {
    personal: {
      address_city: 'Waltham',
      address_state: 'MA',
      address_country: 'United States',
    },
  };
  assert.deepEqual(
    currentResidenceYesNoAnswer('Do you live in the West End Neighborhood?', profile),
    { value: 'No', note: 'current_residence_not_matching_profile' },
  );
  assert.deepEqual(
    currentResidenceYesNoAnswer('Do you live in Massachusetts?', profile),
    { value: 'Yes', note: 'current_residence_from_profile' },
  );
  assert.deepEqual(
    currentResidenceYesNoAnswer('Do you live in the West End Neighborhood? Tell us more if yes.', profile),
    { value: 'No', note: 'current_residence_not_matching_profile' },
  );
  assert.equal(
    currentResidenceYesNoAnswer('Are you open to relocation for this role?', profile),
    null,
  );
});
