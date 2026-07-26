// One gate, one fact. Work authorization is the only personal fact whose
// absence blocks essentially every row (measured across 6 profile shapes x 4
// real question phrasings in BUILD section 14), so it is the only one worth
// stopping a batch for. Everything else is asked after the batch, from the
// questions real forms actually raised — the 2026-06 decision not to probe
// before applying still stands.
//
// Without this gate, a profile missing work authorization opens 20 tabs, fills
// half of each, blocks on all 20, and reports "0 submitted" twenty minutes
// later. With it, the same profile costs two seconds and one question.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATED_PATHS, blockingProfileGaps } from '../shared/personal_fact_gate.mjs';
import { answerWritePaths } from '../shared/missing_field_questions.mjs';
import { onboardTestEnv } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the gate opens for a profile that answered work authorization', () => {
  // The one real user today: F-1 OPT, all four keys present. This assertion is
  // the "existing user sees no change" guarantee in executable form.
  const result = blockingProfileGaps({
    work_authorization: {
      visa_status: 'F-1 OPT eligible',
      authorized_to_work_us: true,
      requires_sponsorship_now: false,
      requires_sponsorship_future: true,
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing_paths, []);
});

test('the gate opens for a NO as readily as a YES — an answer is an answer', () => {
  const notAuthorized = blockingProfileGaps({
    work_authorization: {
      visa_status: 'F-1, no CPT/OPT yet',
      authorized_to_work_us: false,
      requires_sponsorship_now: true,
      requires_sponsorship_future: true,
    },
  });
  assert.equal(notAuthorized.ok, true);

  const citizen = blockingProfileGaps({
    work_authorization: {
      visa_status: 'US Citizen',
      authorized_to_work_us: true,
      requires_sponsorship_now: false,
      requires_sponsorship_future: false,
    },
  });
  assert.equal(citizen.ok, true);
});

test('the gate closes on every shape of "nobody ever told us"', () => {
  const cases = {
    'one key missing': { work_authorization: { authorized_to_work_us: true } },
    'whole block missing': {},
    'block present but empty': { work_authorization: {} },
    'explicitly null': { work_authorization: { authorized_to_work_us: null, requires_sponsorship_future: null } },
    'undefined profile': undefined,
  };
  for (const [name, profile] of Object.entries(cases)) {
    const result = blockingProfileGaps(profile);
    assert.equal(result.ok, false, `${name} should have been blocked`);
    assert.ok(result.missing_paths.length > 0, `${name} must name the missing paths`);
    assert.ok(result.question.length > 0, `${name} must carry a question`);
  }
  assert.deepEqual(
    blockingProfileGaps({ work_authorization: { authorized_to_work_us: true } }).missing_paths,
    ['work_authorization.requires_sponsorship_future'],
  );
});

test('the gate treats a stringy "true" as never asked, and never coerces it', () => {
  // What a hand-edited or migrated profile looks like. Coercing it would put a
  // claim about immigration status on a real form on the strength of a typo.
  for (const value of ['true', 'True', 'Yes', 1, 'false', 0]) {
    const result = blockingProfileGaps({
      work_authorization: { authorized_to_work_us: value, requires_sponsorship_future: value },
    });
    assert.equal(result.ok, false, `${JSON.stringify(value)} must not pass as an answer`);
  }
});

test('the gate names the four onboarding options and hands back a runnable fix', () => {
  const result = blockingProfileGaps({});
  assert.match(result.question, /公民|绿卡/);
  assert.match(result.question, /CPT|OPT/);
  assert.match(result.question, /担保/);
  assert.match(result.question, /不确定/);
  assert.equal(result.category, 'user_work_authorization');
  assert.match(result.remediation_command, /record_profile_answers\.mjs/);
  for (const path of result.missing_paths) {
    assert.ok(result.remediation_command.includes(path), `${path} missing from the remediation command`);
  }
});

test('every gated path is a path the write-back command is allowed to write', () => {
  // A gate that asks for something the writer cannot store is a dead end by
  // construction, so this is checked rather than assumed.
  const writable = answerWritePaths();
  for (const path of GATED_PATHS) {
    assert.ok(writable.has(path), `the gate asks for ${path}, which no question can write`);
    assert.equal(writable.get(path).value_type, 'boolean');
  }
});

test('answering the gated question actually opens the gate', () => {
  // End to end on the real CLI: blocked -> record the answer -> open. If these
  // two halves ever disagree about a path name, the user is stuck in a loop
  // that no unit test would catch.
  const home = mkdtempSync(join(tmpdir(), 'mrw-gate-loop-'));
  const profilePath = join(home, 'profile.json');
  writeFileSync(profilePath, `${JSON.stringify({
    personal: {},
    education: {},
    work_authorization: {
      visa_status: '',
      authorized_to_work_us: null,
      requires_sponsorship_now: null,
      requires_sponsorship_future: null,
    },
    resume_path: '/tmp/resume.pdf',
    standard_qa: {},
  }, null, 2)}\n`);
  writeFileSync(join(home, 'search_intent.json'), `${JSON.stringify({
    search_intent: {
      role_type_targets: ['intern'],
      geographic_preference: {
        primary_country: 'United States',
        countries_open_to: ['US'],
        relocation_policy: 'anywhere_primary_country',
      },
    },
  }, null, 2)}\n`);

  const before = blockingProfileGaps(JSON.parse(readFileSync(profilePath, 'utf8')));
  assert.equal(before.ok, false);

  execFileSync(process.execPath, [
    'shared/record_profile_answers.mjs',
    '--json', JSON.stringify({
      'work_authorization.visa_status': 'F-1 OPT eligible',
      'work_authorization.authorized_to_work_us': true,
      'work_authorization.requires_sponsorship_now': false,
      'work_authorization.requires_sponsorship_future': true,
    }),
    '--source', 'onboarding_a0',
    '--category', 'user_work_authorization',
    '--asked-by', 'queue_gate',
  ], { cwd: ROOT, env: onboardTestEnv(home), encoding: 'utf8' });

  const after = blockingProfileGaps(JSON.parse(readFileSync(profilePath, 'utf8')));
  assert.equal(after.ok, true, 'recording the gate answer must open the gate');
});

test('the gate is a hard check on the real-batch path, not a warning', () => {
  // supervisor_preflight is a CLI that shells out to the queue, the database and
  // Chrome, so its wiring is asserted at source level — the same approach the
  // driver guards in personal_facts_guard.test.mjs use.
  const preflight = readFileSync(join(ROOT, 'shared/supervisor_preflight.mjs'), 'utf8');
  assert.match(preflight, /blockingProfileGaps/, 'preflight must consult the gate');
  const checksBlock = preflight.match(/const checks = \[([\s\S]*?)\n\];/);
  assert.ok(checksBlock, 'could not locate the preflight checks array');
  assert.match(
    checksBlock[1],
    /work_authorization_answered/,
    'the gate must be a hard check; a WARN is ignored by an automated flow',
  );

  const batch = readFileSync(join(ROOT, 'shared/apply_batch.mjs'), 'utf8');
  assert.match(batch, /blockingProfileGaps/, 'dry-run must surface the gap before the user says 开始');
  assert.match(batch, /profile_gate/, 'dry-run output must carry profile_gate for the queue gate to read');
});
