import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function onboardTestEnv(home, extra = {}) {
  return {
    ...process.env,
    MRWEIRDO_HOME: home,
    MRWEIRDO_DB_PATH: join(home, 'jobs.db'),
    MRWEIRDO_REPO_ROOT: process.cwd(),
    MRWEIRDO_ONBOARD_TMP_DIR: join(home, 'run-tmp'),
    ...extra,
  };
}

export function makeOnboardTestHome(prefix) {
  const home = mkdtempSync(join(tmpdir(), prefix));
  return {
    home,
    dbPath: join(home, 'jobs.db'),
    env: onboardTestEnv(home),
  };
}

// Runs the real gap-report CLI against a throwaway home + result dir and returns
// the report. Lived in test/apply_gap_report.test.mjs until 2026-07-26; moved
// here when a second test file needed it, for the same reason the Greenhouse
// driver harness was extracted — a copied runner goes stale silently and only
// one of the two copies notices.
export function runGapReport(prefix, profile, outcomes) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const home = join(root, 'home');
  const resultDir = join(root, 'run');
  mkdirSync(home, { recursive: true });
  mkdirSync(resultDir, { recursive: true });
  writeFileSync(join(home, 'profile.json'), JSON.stringify(profile));

  const summaryRows = [];
  for (const outcome of outcomes) {
    const resultPath = join(resultDir, `apply-result-${outcome.job_id}.jsonl`);
    writeFileSync(resultPath, `${JSON.stringify(outcome)}\n`);
    summaryRows.push({ row_id: outcome.job_id, result_file: resultPath });
  }
  const summaryPath = join(resultDir, 'summary.json');
  writeFileSync(summaryPath, JSON.stringify({ rows: summaryRows }));

  const jsonPath = join(resultDir, 'gap.json');
  const run = spawnSync(process.execPath, [
    'shared/apply_gap_report.mjs',
    '--summary', summaryPath,
    '--json-output', jsonPath,
    '--md-output', join(resultDir, 'gap.md'),
  ], { cwd: ROOT, env: onboardTestEnv(home), encoding: 'utf8' });

  assert.equal(run.status, 0, run.stderr);
  return { report: JSON.parse(readFileSync(jsonPath, 'utf8')), home, resultDir, summaryPath, jsonPath };
}

// Which bucket did the report put this form question in?
export function categoryOf(report, label) {
  for (const question of report.user_questions) {
    if (question.examples.some((e) => e.label === label)) return question.category;
  }
  for (const action of report.agent_actions) {
    if (action.examples.some((e) => e.label === label)) return action.category;
  }
  for (const blocker of report.system_blockers) {
    if (blocker.examples.some((e) => e.label === label)) return blocker.category;
  }
  return null;
}
