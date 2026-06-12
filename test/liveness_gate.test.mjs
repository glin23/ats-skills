import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLiveness } from '../shared/liveness_gate.mjs';
import { eligibleReason } from '../shared/eligibility.mjs';

const base = {
  company: 'Acme',
  title: 'Marketing Intern',
  status: '🤖 AI sourced',
  fit_score: 8,
  recommended: 1,
  ats_platform: 'greenhouse',
};

test('Greenhouse error redirect is expired', () => {
  assert.equal(classifyLiveness({
    status: 200,
    finalUrl: 'https://boards.greenhouse.io/acme/jobs/123?error=true',
    bodyText: '',
  }), 'expired');
});

test('Cloudflare challenge is uncertain, never expired', () => {
  assert.equal(classifyLiveness({
    status: 403,
    finalUrl: 'https://jobs.example.com/role',
    bodyText: '<html>Attention Required! | Cloudflare</html>',
  }), 'uncertain');
});

test('bot challenge classification is non-blocking for eligibility', () => {
  const reason = eligibleReason({ ...base, liveness_status: 'bot_challenge' }, {
    roleType: 'intern',
    allowedRoleTypes: ['intern'],
    submittedKeys: new Set(),
    minFit: 5,
    supportedAuto: new Set(['greenhouse']),
  });
  assert.equal(reason, 'eligible');
});

test('expired liveness is the only blocking liveness state', () => {
  const opts = {
    roleType: 'intern',
    allowedRoleTypes: ['intern'],
    submittedKeys: new Set(),
    minFit: 5,
    supportedAuto: new Set(['greenhouse']),
  };
  assert.equal(eligibleReason({ ...base, liveness_status: 'expired' }, opts), 'liveness_expired');
  assert.equal(eligibleReason({ ...base, liveness_status: 'uncertain' }, opts), 'eligible');
});
