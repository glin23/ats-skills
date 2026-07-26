// The write-back path used to be a sentence in SKILL.md ("update the profile as
// needed") aimed at a language model. PROJECT_MEMORY's first long-term principle
// is the evidence that a red line living only in prose is not a red line: every
// defect in this round came from a personal fact reaching profile.json without
// anyone being able to say who supplied it. This suite pins the replacement:
// a CLI that can only write paths some question actually asked for, refuses to
// coerce a three-state boolean, and leaves the profile byte-identical whenever
// it refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { QUESTION_TEMPLATES, answerWritePaths } from '../shared/missing_field_questions.mjs';
import { fingerprint, readProvenance, sourceFor } from '../shared/answer_provenance.mjs';
import { main as recordMain } from '../shared/record_profile_answers.mjs';
import { onboardTestEnv } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'shared/record_profile_answers.mjs');

const VALID_PROFILE = {
  personal: { address_city: 'Boston', address_state: 'MA', address_country: 'United States' },
  education: { gpa: '3.4' },
  work_authorization: {
    visa_status: '',
    authorized_to_work_us: null,
    requires_sponsorship_now: null,
    requires_sponsorship_future: null,
  },
  legal_attestations: {
    conflicting_obligations: null,
    no_prohibited_possessor_status: null,
    relatives_in_federal_government_or_contractors: null,
  },
  demographics: {
    race: null, hispanic_or_latino: null, gender: null, veteran_status: null, disability_status: null,
  },
  resume_path: '/tmp/resume.pdf',
  standard_qa: {},
};

const VALID_INTENT = {
  search_intent: {
    role_type_targets: ['intern'],
    geographic_preference: {
      primary_country: 'United States',
      countries_open_to: ['US'],
      relocation_policy: 'anywhere_primary_country',
    },
  },
};

function makeHome(prefix, profile = VALID_PROFILE, intent = VALID_INTENT) {
  const home = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'profile.json'), `${JSON.stringify(profile, null, 2)}\n`);
  if (intent) writeFileSync(join(home, 'search_intent.json'), `${JSON.stringify(intent, null, 2)}\n`);
  return home;
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function runCli(home, args) {
  const run = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: onboardTestEnv(home),
    encoding: 'utf8',
  });
  let parsed = null;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    parsed = null;
  }
  return { code: run.status, stdout: run.stdout, stderr: run.stderr, json: parsed };
}

test('record_profile_answers writes the answer and records where it came from', () => {
  const home = makeHome('mrw-rec-ok-');
  const profilePath = join(home, 'profile.json');

  const run = runCli(home, [
    '--json', JSON.stringify({
      'work_authorization.visa_status': 'F-1 OPT eligible',
      'work_authorization.authorized_to_work_us': true,
      'work_authorization.requires_sponsorship_now': false,
      'work_authorization.requires_sponsorship_future': true,
    }),
    '--source', 'onboarding_a0',
    '--category', 'user_work_authorization',
    '--asked-by', 'queue_gate',
  ]);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.json.ok, true);
  assert.equal(run.json.changed.length, 4);
  assert.deepEqual(
    run.json.changed.find((c) => c.path === 'work_authorization.authorized_to_work_us'),
    { path: 'work_authorization.authorized_to_work_us', from: null, to: true },
  );

  const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  assert.equal(profile.work_authorization.authorized_to_work_us, true);
  assert.equal(profile.work_authorization.requires_sponsorship_now, false);
  assert.equal(profile.work_authorization.visa_status, 'F-1 OPT eligible');
  // Everything the command was not asked to touch stays exactly as it was.
  assert.equal(profile.education.gpa, '3.4');
  assert.equal(profile.legal_attestations.no_prohibited_possessor_status, null);

  const provenance = readProvenance(home);
  const entry = provenance.entries['work_authorization.authorized_to_work_us'];
  assert.equal(entry.source, 'onboarding_a0');
  assert.equal(entry.asked_by, 'queue_gate');
  assert.equal(entry.category, 'user_work_authorization');
  assert.equal(entry.value_fingerprint, fingerprint(true));
  assert.ok(!('value' in entry), 'provenance must not keep a second copy of the personal value');
  assert.equal(sourceFor(home, 'work_authorization.authorized_to_work_us', true), 'onboarding_a0');
  // A fingerprint that no longer matches means the value was changed behind our
  // back; the record says so instead of vouching for a value it did not see.
  assert.equal(sourceFor(home, 'work_authorization.authorized_to_work_us', false), 'unknown');
});

test('record_profile_answers refuses a path no question ever asked for, and does not touch the profile', () => {
  const home = makeHome('mrw-rec-whitelist-');
  const profilePath = join(home, 'profile.json');
  const before = digest(profilePath);

  const run = runCli(home, [
    '--json', JSON.stringify({ 'personal.email': 'someone-else@example.com' }),
    '--source', 'user_answer',
  ]);

  assert.equal(run.code, 2);
  assert.match(run.stderr, /personal\.email/);
  assert.equal(digest(profilePath), before, 'profile.json must be byte-identical after a rejected write');
  assert.equal(existsSync(join(home, 'answer_provenance.json')), false);
});

test('record_profile_answers refuses to coerce a three-state boolean', () => {
  const home = makeHome('mrw-rec-type-');
  const profilePath = join(home, 'profile.json');
  const before = digest(profilePath);

  for (const bad of ['true', 'Yes', 1, null]) {
    const run = runCli(home, [
      '--json', JSON.stringify({ 'work_authorization.authorized_to_work_us': bad }),
      '--source', 'user_answer',
    ]);
    assert.equal(run.code, 3, `value ${JSON.stringify(bad)} should be a type violation`);
    assert.equal(digest(profilePath), before, `profile.json changed after rejecting ${JSON.stringify(bad)}`);
  }

  const stringPath = runCli(home, [
    '--json', JSON.stringify({ 'education.gpa': 3.4 }),
    '--source', 'user_answer',
  ]);
  assert.equal(stringPath.code, 3);
  assert.equal(digest(profilePath), before);
});

test('record_profile_answers restores the profile byte-for-byte when validation fails after the write', () => {
  const home = makeHome('mrw-rec-rollback-');
  const profilePath = join(home, 'profile.json');
  const before = digest(profilePath);

  // The validator is an independent contract that can grow rules at any time,
  // so the rollback path is exercised through the injected seam rather than by
  // waiting for a rule that today's type check happens not to cover.
  const code = recordMain(
    ['--json', JSON.stringify({ 'education.gpa': '3.9' }), '--source', 'user_answer', '--home', home],
    { validate: () => ({ ok: false, issues: [{ severity: 'error', file: join(home, 'profile.json'), path: 'education.gpa', message: 'synthetic failure' }], warnings: [] }) },
  );

  assert.equal(code, 4);
  assert.equal(digest(profilePath), before, 'a failed validation must leave the profile exactly as it was');
  assert.equal(JSON.parse(readFileSync(profilePath, 'utf8')).education.gpa, '3.4');
});

test('record_profile_answers refuses to build on an already-invalid profile', () => {
  const home = makeHome('mrw-rec-preinvalid-', { ...VALID_PROFILE, work_authorization: { visa_status: '' } });
  const profilePath = join(home, 'profile.json');
  const before = digest(profilePath);

  const run = runCli(home, [
    '--json', JSON.stringify({ 'education.gpa': '3.9' }),
    '--source', 'user_answer',
  ]);

  assert.equal(run.code, 4);
  assert.equal(digest(profilePath), before);
  assert.match(run.stderr, /missing canonical key/);
});

test('record_profile_answers is idempotent: the same answer twice writes one provenance entry', () => {
  const home = makeHome('mrw-rec-idem-');
  const profilePath = join(home, 'profile.json');
  const args = [
    '--json', JSON.stringify({ 'legal_attestations.no_prohibited_possessor_status': true }),
    '--source', 'user_answer',
    '--category', 'user_legal_attestation',
  ];

  const first = runCli(home, args);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.json.changed.length, 1);
  assert.equal(first.json.provenance_written, 1);
  const afterFirst = digest(profilePath);
  const firstRecordedAt = readProvenance(home).entries['legal_attestations.no_prohibited_possessor_status'].recorded_at;

  const second = runCli(home, args);
  assert.equal(second.code, 0, second.stderr);
  assert.deepEqual(second.json.changed, []);
  assert.equal(second.json.provenance_written, 0);
  assert.deepEqual(second.json.skipped, [{ path: 'legal_attestations.no_prohibited_possessor_status', reason: 'unchanged' }]);
  assert.equal(digest(profilePath), afterFirst, 'a no-op run must not rewrite the profile');

  const provenance = readProvenance(home);
  assert.equal(Object.keys(provenance.entries).length, 1);
  assert.equal(provenance.entries['legal_attestations.no_prohibited_possessor_status'].recorded_at, firstRecordedAt);
});

test('record_profile_answers --dry-run reports the change without making it', () => {
  const home = makeHome('mrw-rec-dry-');
  const profilePath = join(home, 'profile.json');
  const before = digest(profilePath);

  const run = runCli(home, [
    '--json', JSON.stringify({ 'demographics.gender': 'Prefer not to say' }),
    '--source', 'user_answer',
    '--dry-run',
  ]);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.json.dry_run, true);
  assert.equal(run.json.changed.length, 1);
  assert.equal(digest(profilePath), before);
  assert.equal(existsSync(join(home, 'answer_provenance.json')), false);
});

test('every provenance key is a path some question is allowed to write', () => {
  const home = makeHome('mrw-rec-keys-');
  const run = runCli(home, [
    '--json', JSON.stringify({
      'work_authorization.authorized_to_work_us': true,
      'work_authorization.requires_sponsorship_future': false,
      'demographics.race': 'Prefer not to say',
    }),
    '--source', 'user_answer',
  ]);
  assert.equal(run.code, 0, run.stderr);

  const writable = answerWritePaths();
  for (const key of Object.keys(readProvenance(home).entries)) {
    assert.ok(writable.has(key), `provenance recorded ${key}, which no question declares as writable`);
  }
});

test('answerWritePaths derives the whitelist from the question templates themselves', () => {
  const writable = answerWritePaths();
  // "What we ask" and "what we may write" cannot drift apart, because they are
  // the same list read twice.
  for (const [category, template] of Object.entries(QUESTION_TEMPLATES)) {
    for (const path of template.profile_paths) {
      assert.ok(writable.has(path), `${category} asks about ${path} but cannot write it`);
      assert.ok(writable.get(path).categories.includes(category));
    }
  }
  assert.equal(writable.get('work_authorization.authorized_to_work_us').value_type, 'boolean');
  assert.equal(writable.get('work_authorization.visa_status').value_type, 'string');
  assert.equal(writable.get('legal_attestations.conflicting_obligations').value_type, 'boolean');
  assert.equal(writable.get('education.gpa').value_type, 'string');
  // Nothing outside the question set is writable — notably identity fields the
  // user gave us once, on a resume, and never agreed to have rewritten.
  assert.equal(writable.has('personal.email'), false);
  assert.equal(writable.has('resume_path'), false);
});

test('record_profile_answers rejects an unknown provenance source rather than inventing one', () => {
  const home = makeHome('mrw-rec-source-');
  const before = digest(join(home, 'profile.json'));
  const run = runCli(home, [
    '--json', JSON.stringify({ 'education.gpa': '3.9' }),
    '--source', 'because_i_said_so',
  ]);
  assert.equal(run.code, 2);
  assert.equal(digest(join(home, 'profile.json')), before);
});
