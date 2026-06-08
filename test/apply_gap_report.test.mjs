import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('apply_gap_report separates factual user gaps from agent-fillable fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'mrw-gap-'));
  const home = join(root, 'home');
  const resultDir = join(root, 'run');
  const profilePath = join(home, 'profile.json');
  const resultPath = join(resultDir, 'apply-result-101.jsonl');
  const summaryPath = join(resultDir, 'summary.json');
  const jsonPath = join(resultDir, 'gap.json');
  const mdPath = join(resultDir, 'gap.md');
  const jsonFromDirPath = join(resultDir, 'gap-from-dir.json');
  const mdFromDirPath = join(resultDir, 'gap-from-dir.md');

  mkdirSync(home, { recursive: true });
  mkdirSync(resultDir, { recursive: true });

  writeFileSync(profilePath, JSON.stringify({
    personal: { address_city: 'Babson Park', address_state: 'MA', address_country: 'United States' },
    education: { gpa: '3.2' },
  }));
  writeFileSync(resultPath, `${JSON.stringify({
    outcome: 'skip',
    reason: 'profile_full_address_required',
    job_id: 101,
    remaining: [
      { label: 'What is your primary mailing address?', type: 'textarea', required: true },
      { label: 'The interview may be recorded in audio, video, and/or transcript.', type: 'radio', required: true },
      { label: 'What is your GPA?', type: 'text', required: true },
      { label: 'Attach', type: 'file', required: true },
      { label: 'Gender', type: 'select', required: true },
      { label: 'Are you Hispanic/Latino?', type: 'select', required: true },
      { label: 'I confirm the information provided in this application, including my resume, is true and correct.', type: 'checkbox', required: true },
      { label: 'What is your expected graduation month and year?', type: 'text', required: true },
      { label: 'Which work style(s) are you open to?', type: 'select', required: true },
    ],
  })}\n`);
  writeFileSync(summaryPath, JSON.stringify({ rows: [{ row_id: 101, result_file: resultPath }] }));

  const run = spawnSync(process.execPath, [
    'shared/apply_gap_report.mjs',
    '--summary', summaryPath,
    '--json-output', jsonPath,
    '--md-output', mdPath,
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      MRWEIRDO_HOME: home,
      MRWEIRDO_DB_PATH: join(home, 'jobs.db'),
    },
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(readFileSync(jsonPath, 'utf8'));
  assert.deepEqual(report.user_questions.map((q) => q.category), ['user_full_address']);
  assert.ok(report.agent_actions.some((a) => a.category === 'agent_attestation'));
  assert.ok(report.agent_actions.some((a) => a.category === 'agent_profile_backed'));
  assert.equal(report.retry_candidates.length, 1);
  assert.equal(report.retry_candidates[0].row_id, 101);

  const runFromDir = spawnSync(process.execPath, [
    'shared/apply_gap_report.mjs',
    '--result-dir', resultDir,
    '--json-output', jsonFromDirPath,
    '--md-output', mdFromDirPath,
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      MRWEIRDO_HOME: home,
      MRWEIRDO_DB_PATH: join(home, 'jobs.db'),
    },
    encoding: 'utf8',
  });

  assert.equal(runFromDir.status, 0, runFromDir.stderr);
  const reportFromDir = JSON.parse(readFileSync(jsonFromDirPath, 'utf8'));
  assert.deepEqual(reportFromDir.user_questions.map((q) => q.category), ['user_full_address']);
});
