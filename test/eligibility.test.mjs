// Locks the auto-apply eligibility gate (the full-time-leak prevention) at the
// decision layer, independent of the SQLite database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligibleReason, duplicateKey, DEFAULT_SUPPORTED_AUTO, unusableAutoApplyReason } from '../shared/eligibility.mjs';

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

test('guard order: quota is evaluated before legitimacy', () => {
  assert.equal(eligibleReason({
    ...base,
    apply_quota_limit: 1,
    legitimacy: 'suspicious',
  }, opts()), 'quota_guarded');
});

test('guard order: quota is evaluated before liveness', () => {
  assert.equal(eligibleReason({
    ...base,
    apply_quota_limit: 1,
    liveness_status: 'expired',
  }, opts()), 'quota_guarded');
});

test('expired liveness blocks before legitimacy', () => {
  assert.equal(eligibleReason({
    ...base,
    liveness_status: 'expired',
    legitimacy: 'suspicious',
  }, opts()), 'liveness_expired');
});

test('uncertain and bot-challenge liveness do not block the queue', () => {
  assert.equal(eligibleReason({ ...base, liveness_status: 'uncertain' }, opts()), 'eligible');
  assert.equal(eligibleReason({ ...base, liveness_status: 'bot_challenge' }, opts()), 'eligible');
});

test('suspicious legitimacy is blocked without changing fit-score logic', () => {
  assert.equal(eligibleReason({ ...base, legitimacy: 'suspicious' }, opts()), 'legitimacy_suspicious');
});

test('already-submitted company/title is blocked (double-submit guard)', () => {
  const submittedKeys = new Set([duplicateKey(base)]);
  assert.equal(eligibleReason(base, opts({ submittedKeys })), 'duplicate_same_company_title_already_submitted');
});

test('not recommended rows are blocked even when fit is high', () => {
  assert.equal(eligibleReason({ ...base, recommended: 0, fit_score: 9 }, opts()), 'not_recommended');
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
  assert.equal(eligibleReason({ ...base, ats_platform: 'workday' }, opts()), 'unsupported_ats_platform');
});

test('Greenhouse sandbox/example tenants are blocked before auto-apply', () => {
  const row = {
    ...base,
    company: 'examplecorpsandbox',
    title: 'Cloud Software Development Co-op Intern - Summer/Fall 2026',
    apply_url: 'https://job-boards.greenhouse.io/examplecorpsandbox/jobs/7232268',
    ats_platform: 'greenhouse',
  };
  assert.equal(unusableAutoApplyReason(row, { now: new Date('2026-06-08T00:00:00Z') }), 'test_or_sandbox_posting');
  assert.equal(eligibleReason(row, opts({ now: new Date('2026-06-08T00:00:00Z') })), 'test_or_sandbox_posting');
});

test('student jobs with already-past title years are blocked', () => {
  const row = {
    ...base,
    title: 'Cloud Software Development Co-op Intern - Summer/Fall 2021',
    apply_url: 'https://job-boards.greenhouse.io/acme/jobs/7232268',
    ats_platform: 'greenhouse',
  };
  assert.equal(unusableAutoApplyReason(row, { now: new Date('2026-06-08T00:00:00Z') }), 'expired_title_year');
  assert.equal(eligibleReason(row, opts({ now: new Date('2026-06-08T00:00:00Z') })), 'expired_title_year');
});

test('future-dated student jobs are not blocked by the title-year guard', () => {
  const row = {
    ...base,
    title: '2027 Real Estate Investments Summer Intern',
    apply_url: 'https://job-boards.greenhouse.io/acme/jobs/7761840003',
    ats_platform: 'greenhouse',
  };
  assert.equal(unusableAutoApplyReason(row, { now: new Date('2026-06-08T00:00:00Z') }), null);
  assert.equal(eligibleReason(row, opts({ now: new Date('2026-06-08T00:00:00Z') })), 'eligible');
});

test('Lever is not in the stable batch auto-submit set', () => {
  assert.equal(eligibleReason({ ...base, ats_platform: 'lever' }, opts()), 'unsupported_ats_platform');
});

test('supportedAuto accepts a plain array as well as a Set', () => {
  assert.equal(eligibleReason(base, opts({ supportedAuto: ['ashby'] })), 'eligible');
  assert.equal(eligibleReason({ ...base, ats_platform: 'greenhouse' }, opts({ supportedAuto: ['ashby'] })), 'unsupported_ats_platform');
});
