// Locks the shape of the data files the drivers depend on, and proves every
// answer-bank essay regex compiles (a bad regex would crash the live driver).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

test('answer_bank.json: parses, has required sections, every regex compiles', () => {
  const bank = read('shared/answer_bank.json');
  assert.ok(Array.isArray(bank.essay_templates));
  assert.ok(bank.yes_no_defaults && typeof bank.yes_no_defaults === 'object');
  assert.ok(Array.isArray(bank.multichoice_preferences?.how_did_you_hear));
  assert.ok(bank.fallback_text?.compensation_expectations, 'compensation_expectations fallback missing');
  assert.ok(bank.fallback_text?.hours_per_week, 'hours_per_week fallback missing');
  for (const t of bank.essay_templates) {
    assert.doesNotThrow(() => new RegExp(t.match, 'i'), `bad essay_templates regex: ${t.match}`);
    assert.ok(typeof t.answer_template === 'string' && t.answer_template.length > 0, `empty answer_template for: ${t.match}`);
  }
});

test('essay_profile.template.json: parses + factual_gap_fields taxonomy present', () => {
  const tpl = read('shared/essay_profile.template.json');
  const gaps = tpl.factual_gap_fields;
  assert.ok(gaps, 'factual_gap_fields missing');
  for (const key of [
    'permanent_address',
    'social_handles',
    'compensation_acceptance',
    'third_party_accounts',
    'personal_preferences',
    'cover_letter_path',
    'onsite_location_logistics',
  ]) {
    assert.ok(gaps[key], `missing factual_gap_fields.${key}`);
  }
});
