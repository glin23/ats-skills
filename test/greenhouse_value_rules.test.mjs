import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bachelorProgressCandidates,
  gpaRangeCandidates,
  gpaValue,
  graduationSelectValues,
  hoursPerWeekAnswer,
  monthYear,
} from '../shared/greenhouse_value_rules.mjs';

test('monthYear parses MM/YYYY and YYYY-MM, falls back on junk', () => {
  assert.equal(monthYear('05/2027'), 'May 2027');
  assert.equal(monthYear('2027-05'), 'May 2027');
  assert.equal(monthYear('12/2026'), 'December 2026');
  assert.equal(monthYear('13/2027'), '13/2027'); // invalid month -> raw passthrough
  assert.equal(monthYear(''), 'May 2027'); // default fallback
  assert.equal(monthYear('', 'June 2028'), 'June 2028');
});

test('graduationSelectValues offers nearest-semester fallbacks + bare year', () => {
  assert.deepEqual(graduationSelectValues('05/2027'), ['May 2027', 'June 2027', 'December 2027', '2027']);
  assert.deepEqual(graduationSelectValues('12/2026'), ['December 2026', 'June 2026', '2026']);
});

test('hoursPerWeekAnswer prefers explicit, else infers from role type', () => {
  assert.equal(hoursPerWeekAnswer({ searchIntent: { search_intent: { hours_per_week: 25 } } }), '25');
  assert.equal(hoursPerWeekAnswer({ bank: { fallback_text: { hours_per_week: '30' } } }), '30');
  assert.equal(hoursPerWeekAnswer({ searchIntent: { search_intent: { role_type_targets: ['part_time'] } } }), '20');
  assert.equal(hoursPerWeekAnswer({}), '40');
});

test('gpa helpers preserve exact GPA and map select ranges', () => {
  assert.equal(gpaValue({ education: { gpa: '3.2' } }), '3.2');
  assert.deepEqual(gpaRangeCandidates({ education: { gpa: '3.2' } }), ['3.0 - 3.2', '3.0-3.2']);
  assert.deepEqual(gpaRangeCandidates({ education: { gpa: '3.65' } }), ['3.6 - 3.7', '3.6-3.7']);
  assert.deepEqual(gpaRangeCandidates({ education: {} }), []);
});

test('bachelorProgressCandidates maps current undergrad status to ATS labels', () => {
  assert.deepEqual(
    bachelorProgressCandidates({ education: { degree: 'Bachelor of Science', currently_enrolled: true } }).slice(0, 2),
    ["Bachelor's Degree in Progress", 'Bachelor’s Degree in Progress']
  );
  assert.deepEqual(
    bachelorProgressCandidates({ education: { degree: 'Bachelor of Science', currently_enrolled: false } }).slice(0, 2),
    ["Bachelor's Degree Completed", 'Bachelor’s Degree Completed']
  );
});
