// The closed loop, end to end, with nothing stubbed: a driver blocks -> the gap
// report turns that into a question -> the answer is recorded -> the same gap
// report stops asking and the row is queued for retry.
//
// Every piece of this chain has its own unit test and each of them can be green
// while the chain is broken, which is exactly what happened before 2026-07-25:
// the drivers blocked correctly, the report classified those blocks as "the
// agent fills this from the profile", and the profile was empty. The row was
// retried, blocked, and re-filed forever while the user saw only "skipped".
//
// The fixture profile is deliberately not the one real user's: it is the shipped
// template, i.e. a brand new install that has answered nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUESTION_TEMPLATES } from '../shared/missing_field_questions.mjs';
import { blockingProfileGaps } from '../shared/personal_fact_gate.mjs';
import { readProvenance } from '../shared/answer_provenance.mjs';
import { onboardTestEnv } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'mrw-loop-'));
  const home = join(root, 'home');
  const resultDir = join(root, 'run');
  mkdirSync(home, { recursive: true });
  mkdirSync(resultDir, { recursive: true });

  const template = JSON.parse(readFileSync(join(ROOT, 'shared/profile.template.json'), 'utf8'));
  writeFileSync(join(home, 'profile.json'), `${JSON.stringify(template, null, 2)}\n`);
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

  // What a real Greenhouse row looks like when it stops instead of inventing an
  // answer: outcome skip, a row-level reason, and per-field blocker notes.
  const resultPath = join(resultDir, 'apply-result-901.jsonl');
  writeFileSync(resultPath, `${JSON.stringify({
    outcome: 'skip',
    reason: 'profile_specific_answer_required',
    job_id: 901,
    company: 'Loop Co',
    blockers: [
      { question: 'Are you legally authorized to work in the United States?', note: 'work_authorization_required', detail: null },
      { question: 'Will you now or in the future require sponsorship for employment visa status?', note: 'sponsorship_future_required', detail: null },
    ],
    missing: ['Are you legally authorized to work in the United States?'],
  })}\n`);
  const summaryPath = join(resultDir, 'summary.json');
  writeFileSync(summaryPath, JSON.stringify({ rows: [{ row_id: 901, result_file: resultPath }] }));

  return { home, resultDir, summaryPath };
}

function gapReport(home, summaryPath, resultDir, tag) {
  const jsonPath = join(resultDir, `gap-${tag}.json`);
  execFileSync(process.execPath, [
    'shared/apply_gap_report.mjs',
    '--summary', summaryPath,
    '--json-output', jsonPath,
    '--md-output', join(resultDir, `gap-${tag}.md`),
  ], { cwd: ROOT, env: onboardTestEnv(home), encoding: 'utf8' });
  return JSON.parse(readFileSync(jsonPath, 'utf8'));
}

test('blocked row -> question -> recorded answer -> no longer asked, and queued for retry', () => {
  const { home, resultDir, summaryPath } = setup();
  const profilePath = join(home, 'profile.json');

  // 0. A brand new install is stopped by the gate rather than waved through on
  //    factory values — the batch never opens a browser tab.
  assert.equal(blockingProfileGaps(JSON.parse(readFileSync(profilePath, 'utf8'))).ok, false);

  // 1. The blocked row becomes a question the user can actually answer.
  const before = gapReport(home, summaryPath, resultDir, 'before');
  const categories = before.user_questions.map((q) => q.category);
  assert.deepEqual(categories, ['user_work_authorization']);
  assert.ok(
    !before.agent_actions.some((a) => a.category === 'agent_profile_backed'),
    'a fact nobody supplied must never be handed to the agent to "fill from the profile"',
  );
  assert.deepEqual(before.retry_candidates.map((r) => r.row_id), [901]);
  assert.equal(before.retry_candidates[0].requires_user_answer, true);

  // The condensed question the user actually sees carries the writable paths, so
  // the next step needs no knowledge the report did not hand over.
  const condensed = before.condensed_missing_questions.find((c) => c.group_id === 'user_work_authorization');
  assert.ok(condensed, 'the work-auth question must survive condensation');
  assert.equal(condensed.unblocks_n_jobs, 1);
  assert.deepEqual(
    condensed.profile_paths,
    QUESTION_TEMPLATES.user_work_authorization.profile_paths,
  );

  // 2. Record the answer through the only supported path.
  execFileSync(process.execPath, [
    'shared/record_profile_answers.mjs',
    '--json', JSON.stringify({
      'work_authorization.visa_status': 'F-1 OPT eligible',
      'work_authorization.authorized_to_work_us': true,
      'work_authorization.requires_sponsorship_now': false,
      'work_authorization.requires_sponsorship_future': true,
    }),
    '--source', 'user_answer',
    '--category', 'user_work_authorization',
    '--asked-by', 'step6',
  ], { cwd: ROOT, env: onboardTestEnv(home), encoding: 'utf8' });

  // 3. The gate opens and the answer is attributable.
  assert.equal(blockingProfileGaps(JSON.parse(readFileSync(profilePath, 'utf8'))).ok, true);
  assert.equal(
    readProvenance(home).entries['work_authorization.authorized_to_work_us'].source,
    'user_answer',
  );

  // 4. Same batch, same result file, re-read: the question is gone. Without this
  //    the user answers and is asked the identical question next batch.
  const after = gapReport(home, summaryPath, resultDir, 'after');
  assert.deepEqual(after.user_questions, [], 'an answered fact must not be asked again');
  assert.deepEqual(after.condensed_missing_questions, []);
  assert.ok(after.agent_actions.some((a) => a.category === 'agent_profile_backed'));
});

test('answering one fact does not silence the facts still missing', () => {
  // The loop must close per fact, not per row: a row blocked on two different
  // facts still has to ask about the second one after the first is answered.
  const { home, resultDir, summaryPath } = setup();
  writeFileSync(join(resultDir, 'apply-result-901.jsonl'), `${JSON.stringify({
    outcome: 'skip',
    reason: 'profile_specific_answer_required',
    job_id: 901,
    company: 'Loop Co',
    blockers: [
      { question: 'Are you legally authorized to work in the United States?', note: 'work_authorization_required', detail: null },
      { question: 'Are you a fugitive from justice?', note: 'legal_attestation_required', detail: null },
    ],
  })}\n`);

  execFileSync(process.execPath, [
    'shared/record_profile_answers.mjs',
    '--json', JSON.stringify({
      'work_authorization.authorized_to_work_us': true,
      'work_authorization.requires_sponsorship_future': true,
    }),
    '--source', 'user_answer',
    '--category', 'user_work_authorization',
  ], { cwd: ROOT, env: onboardTestEnv(home), encoding: 'utf8' });

  const report = gapReport(home, summaryPath, resultDir, 'partial');
  assert.deepEqual(report.user_questions.map((q) => q.category), ['user_legal_attestation']);
  assert.deepEqual(report.retry_candidates.map((r) => r.row_id), [901]);
});
