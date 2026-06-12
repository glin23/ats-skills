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

test('drops a suspicious-legitimacy row before it enters the queue', () => {
  assert.equal(passesQueueFilters({ ...internRow, legitimacy: 'suspicious' }, {
    roleTypes: ['intern', 'part_time'],
    submittedKeys: new Set(),
    seenKeys: new Set(),
  }), false);
});

test('drops an expired-liveness row but keeps uncertain liveness', () => {
  assert.equal(passesQueueFilters({ ...internRow, liveness_status: 'expired' }, {
    roleTypes: ['intern', 'part_time'],
    submittedKeys: new Set(),
    seenKeys: new Set(),
  }), false);
  assert.equal(passesQueueFilters({ ...internRow, liveness_status: 'uncertain' }, {
    roleTypes: ['intern', 'part_time'],
    submittedKeys: new Set(),
    seenKeys: new Set(),
  }), true);
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

test('drops a sandbox/example row even when it otherwise looks eligible', () => {
  assert.equal(passesQueueFilters({
    company: 'examplecorpsandbox',
    title: 'Cloud Software Development Co-op Intern - Summer/Fall 2026',
    apply_url: 'https://job-boards.greenhouse.io/examplecorpsandbox/jobs/7232268',
    role_type_match: 'intern',
  }, {
    roleTypes: ['intern', 'part_time'],
    submittedKeys: new Set(),
    seenKeys: new Set(),
    now: new Date('2026-06-08T00:00:00Z'),
  }), false);
});

test('drops an expired student job before it enters the real apply queue', () => {
  assert.equal(passesQueueFilters({
    company: 'Acme',
    title: 'Cloud Software Development Co-op Intern - Summer/Fall 2021',
    apply_url: 'https://job-boards.greenhouse.io/acme/jobs/7232268',
    role_type_match: 'intern',
  }, {
    roleTypes: ['intern', 'part_time'],
    submittedKeys: new Set(),
    seenKeys: new Set(),
    now: new Date('2026-06-08T00:00:00Z'),
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
