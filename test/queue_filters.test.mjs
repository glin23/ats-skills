// Unit-tests the pure post-SQL queue predicate extracted from
// auto_apply_queue.mjs. passesQueueFilters drops rows that are already
// submitted, already seen in this pass, or whose derived role type is not in
// the allowed targets. Behavior is verbatim with the prior inline loop guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passesQueueFilters, duplicateKey } from '../shared/eligibility.mjs';

const internRow = { company: 'Acorns', title: 'Product Management Intern', role_type_match: 'intern' };
const ftRow = { company: 'Lambda', title: 'Senior Product Manager', role_type_match: 'full_time' };

test('passes an intern row when role type is allowed and not seen/submitted', () => {
  assert.equal(passesQueueFilters(internRow, {
    roleTypes: ['intern', 'part_time'],
    submittedKeys: new Set(),
    seenKeys: new Set(),
  }), true);
});

test('drops a row whose company/title is already submitted', () => {
  const submittedKeys = new Set([duplicateKey(internRow)]);
  assert.equal(passesQueueFilters(internRow, {
    roleTypes: ['intern', 'part_time'],
    submittedKeys,
    seenKeys: new Set(),
  }), false);
});

test('drops a row already seen earlier in this queue pass (dedupe)', () => {
  const seenKeys = new Set([duplicateKey(internRow)]);
  assert.equal(passesQueueFilters(internRow, {
    roleTypes: ['intern', 'part_time'],
    submittedKeys: new Set(),
    seenKeys,
  }), false);
});

test('drops a row whose derived role type is not in the targets (full-time leak)', () => {
  assert.equal(passesQueueFilters(ftRow, {
    roleTypes: ['intern', 'part_time'],
    submittedKeys: new Set(),
    seenKeys: new Set(),
  }), false);
});

test('submitted-key check is normalized (case/whitespace insensitive)', () => {
  const submittedKeys = new Set([duplicateKey({ company: 'ACORNS', title: 'product management intern' })]);
  assert.equal(passesQueueFilters(internRow, {
    roleTypes: ['intern', 'part_time'],
    submittedKeys,
    seenKeys: new Set(),
  }), false);
});
