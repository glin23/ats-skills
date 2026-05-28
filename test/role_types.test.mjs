// Regression lock for the role-type gate — the logic that prevents the
// full-time-leak (auto-applying an F-1 intern seeker to permanent FT roles)
// and the mis-apply class of bugs found 2026-05-28.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRoleType,
  roleTypesFromSearchIntent,
  classifyRoleType,
  deriveRoleTypeFromJob,
  passesAllowedRoleType,
  roleTypeConflict,
} from '../shared/role_types.mjs';

test('normalizeRoleType maps variants to canonical types', () => {
  assert.equal(normalizeRoleType('internship'), 'intern');
  assert.equal(normalizeRoleType('Intern'), 'intern');
  assert.equal(normalizeRoleType('full_time'), 'new_grad_FT');
  assert.equal(normalizeRoleType('Full Time'), 'new_grad_FT');
  assert.equal(normalizeRoleType('new_grad'), 'new_grad_FT');
  assert.equal(normalizeRoleType('part_time'), 'part_time');
  assert.equal(normalizeRoleType('Part-Time'), 'part_time');
  assert.equal(normalizeRoleType('new_grad_FT'), 'new_grad_FT');
  assert.equal(normalizeRoleType('nonsense'), null);
  assert.equal(normalizeRoleType(''), null);
});

test('roleTypesFromSearchIntent: explicit targets win, NO silent full-time widening', () => {
  assert.deepEqual(roleTypesFromSearchIntent({ role_type_targets: ['intern', 'part_time'] }, ''), ['intern', 'part_time']);
  // legacy "both" / "intern_or_part_time" must map to intern+part_time, never full-time
  assert.deepEqual(roleTypesFromSearchIntent({ seniority: 'both' }, ''), ['intern', 'part_time']);
  assert.deepEqual(roleTypesFromSearchIntent({ seniority: 'intern_or_part_time' }, ''), ['intern', 'part_time']);
  assert.deepEqual(roleTypesFromSearchIntent({ seniority: 'intern' }, ''), ['intern']);
  assert.deepEqual(roleTypesFromSearchIntent({}, ''), ['intern']);
  assert.ok(!roleTypesFromSearchIntent({ seniority: 'both' }, '').includes('new_grad_FT'));
  // env override path
  assert.deepEqual(roleTypesFromSearchIntent({}, 'intern,part_time'), ['intern', 'part_time']);
});

test('classifyRoleType: title-driven, with employment cross-read', () => {
  assert.equal(classifyRoleType({ title: 'Growth Intern' }), 'intern');
  assert.equal(classifyRoleType({ title: 'Software Engineering Internship' }), 'intern');
  assert.equal(classifyRoleType({ title: 'Data Co-op' }), 'intern');
  assert.equal(classifyRoleType({ title: 'Campus Ambassador' }), 'part_time');
  assert.equal(classifyRoleType({ title: 'Part-Time Sales Associate' }), 'part_time');
  assert.equal(classifyRoleType({ title: 'New Grad Software Engineer' }), 'new_grad_FT');
  assert.equal(classifyRoleType({ title: 'Business Operations Associate', employment_type: 'FullTime' }), 'other');
  // Acorns case: an intern title wins over a "FullTime" employment_type
  assert.equal(classifyRoleType({ title: 'Growth Product Management Intern', employment_type: 'FullTime' }), 'intern');
});

test('deriveRoleTypeFromJob: corrects a mislabeled stored intern via the title', () => {
  assert.equal(deriveRoleTypeFromJob({ role_type_match: 'intern', title: 'Business Operations Associate', employment_type: 'Full Time' }), 'other');
  assert.equal(deriveRoleTypeFromJob({ role_type_match: 'intern', title: 'Growth Intern' }), 'intern');
  assert.equal(deriveRoleTypeFromJob({ role_type_match: 'new_grad_FT', title: 'Anything' }), 'new_grad_FT');
});

test('passesAllowedRoleType: gate honors allow-list and blocks senior titles', () => {
  assert.equal(passesAllowedRoleType({ title: 'Growth Intern' }, ['intern', 'part_time']), true);
  assert.equal(passesAllowedRoleType({ title: 'Business Operations Associate', employment_type: 'FullTime' }, ['intern', 'part_time']), false);
  // a senior-titled intern is blocked even though it classifies as intern
  assert.equal(passesAllowedRoleType({ title: 'Senior Product Intern' }, ['intern', 'part_time']), false);
});

test('roleTypeConflict: flags intern-title + permanent employment, spares real interns', () => {
  // acorns-style: intern title, FullTime employment, no temp signal -> CONFLICT (flag only, not a block)
  const acorns = roleTypeConflict({ title: 'Growth Product Management Intern', employment_type: 'FullTime' });
  assert.equal(acorns.roleType, 'intern');
  assert.equal(acorns.conflict, true);
  assert.ok(acorns.reason.length > 0);
  // genuine internships carry an intern/temp signal in employment_type -> no conflict
  assert.equal(roleTypeConflict({ title: 'Growth Intern', employment_type: 'Intern' }).conflict, false);
  assert.equal(roleTypeConflict({ title: 'Summer Intern', employment_type: 'Internship' }).conflict, false);
  assert.equal(roleTypeConflict({ title: 'Data Co-op', employment_type: '' }).conflict, false);
  // non-intern roles never raise a conflict
  assert.equal(roleTypeConflict({ title: 'Business Operations Associate', employment_type: 'FullTime' }).conflict, false);
});
