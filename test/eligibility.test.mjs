// Locks the auto-apply eligibility gate (the full-time-leak prevention) at the
// decision layer, independent of the SQLite database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligibleReason, duplicateKey, DEFAULT_SUPPORTED_AUTO } from '../shared/eligibility.mjs';

const base = {
  status: '🤖 AI sourced',
  company: 'Acme',
  title: 'Growth Intern',
  ats_platform: 'ashby',
  fit_score: 7,
  apply_quota_limit: null,
};
const opts = (over = {}) => ({
  roleType: 'intern',
  allowedRoleTypes: ['intern', 'part_time'],
  submittedKeys: new Set(),
  minFit: 5,
  supportedAuto: DEFAULT_SUPPORTED_AUTO,
  ...over,
});

test('eligible row passes the gate', () => {
  assert.equal(eligibleReason(base, opts()), 'eligible');
});

test('non-pending status is blocked', () => {
  assert.equal(eligibleReason({ ...base, status: '✅ 已投' }, opts()), 'not_pending');
});

test('quota-guarded row is blocked', () => {
  assert.equal(eligibleReason({ ...base, apply_quota_limit: 1 }, opts()), 'quota_guarded');
});

test('already-submitted company/title is blocked (double-submit guard)', () => {
  const submittedKeys = new Set([duplicateKey(base)]);
  assert.equal(eligibleReason(base, opts({ submittedKeys })), 'duplicate_same_company_title_already_submitted');
});

test('role type outside targets is blocked (FT-leak gate)', () => {
  assert.equal(eligibleReason(base, opts({ roleType: 'new_grad_FT' })), 'role_type_not_allowed');
});

test('FT role with a HIGH fit is still blocked — role-type checked before fit', () => {
  assert.equal(eligibleReason({ ...base, fit_score: 9 }, opts({ roleType: 'new_grad_FT' })), 'role_type_not_allowed');
});

test('fit below threshold is blocked', () => {
  assert.equal(eligibleReason({ ...base, fit_score: 4 }, opts()), 'fit_below_threshold');
});

test('unsupported ATS is blocked', () => {
  assert.equal(eligibleReason({ ...base, ats_platform: 'lever' }, opts()), 'unsupported_ats_platform');
});

test('supportedAuto accepts a plain array as well as a Set', () => {
  assert.equal(eligibleReason(base, opts({ supportedAuto: ['ashby'] })), 'eligible');
  assert.equal(eligibleReason({ ...base, ats_platform: 'greenhouse' }, opts({ supportedAuto: ['ashby'] })), 'unsupported_ats_platform');
});
