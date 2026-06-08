// Locks the driver's safety-critical answer-routing decisions (extracted from
// ashby_apply_driver.mjs). Includes the REAL question labels seen on live Ashby
// forms so a regression would fail here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSpecificCityLogisticsFact,
  isOpenEndedResidenceQuestion,
  relocationPolicyOpen,
  confirmedCitiesFrom,
  mentionsConfirmedCity,
  deriveWorkAuthAnswers,
} from '../shared/answer_routing.mjs';

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

test('deriveWorkAuthAnswers: F-1 OPT answers Yes/Yes (never a false no-sponsorship)', () => {
  const f1 = deriveWorkAuthAnswers(
    { work_authorization: { visa_status: 'F-1 OPT eligible', authorized_to_work_us: true, requires_sponsorship_future: true } },
    {},
  );
  assert.equal(f1.sponsorAns, 'Yes');
  assert.equal(f1.authorizedAns, 'Yes');
  // a user who needs no future sponsorship falls back to the bank default
  const noSpon = deriveWorkAuthAnswers(
    { work_authorization: { authorized_to_work_us: true, requires_sponsorship_future: false } },
    { yes_no_defaults: { sponsorship_future: 'No' } },
  );
  assert.equal(noSpon.sponsorAns, 'No');
  assert.equal(noSpon.authorizedAns, 'Yes');
});
