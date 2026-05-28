// Locks the dedup normalization that prevents double-submitting the same
// company/title across formatting variants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCompany, normalizeTitle, sameCompanyTitle, SUBMITTED_STATUSES } from '../shared/job_identity.mjs';

test('normalizeCompany strips suffixes/punctuation so variants collapse', () => {
  assert.equal(normalizeCompany('Acme, Inc.'), 'acme');
  assert.equal(normalizeCompany('Acme'), 'acme');
  assert.equal(normalizeCompany('Foo & Bar LLC'), 'fooandbar');
  assert.equal(normalizeCompany('Stripe Careers'), 'stripe');
  assert.equal(normalizeCompany('Stripe'), 'stripe');
});

test('normalizeTitle canonicalizes internship/co-op and dashes', () => {
  assert.equal(normalizeTitle('Software Engineer Internship'), 'software engineer intern');
  assert.equal(normalizeTitle('Data Co-op'), 'data intern');
  assert.equal(normalizeTitle('Growth Intern – Summer 2026'), 'growth intern summer 2026');
});

test('sameCompanyTitle dedupes across formatting (double-submit guard)', () => {
  assert.equal(sameCompanyTitle(
    { company: 'Acme Inc', title: 'Growth Intern' },
    { company: 'acme', title: 'Growth Internship' },
  ), true);
  assert.equal(sameCompanyTitle(
    { company: 'Acme', title: 'Growth Intern' },
    { company: 'Acme', title: 'Data Intern' },
  ), false);
});

test('SUBMITTED_STATUSES covers submitted + confirmed only', () => {
  assert.ok(SUBMITTED_STATUSES.has('✅ 已投'));
  assert.ok(SUBMITTED_STATUSES.has('✅ 已确认'));
  assert.ok(!SUBMITTED_STATUSES.has('🤖 AI sourced'));
});
