import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { onboardTestEnv } from './helpers.mjs';

test('required cover letter without generated PDF is recorded as manual-visible review item', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrweirdo-cover-manual-'));
  const dbPath = join(home, 'jobs.db');
  const runTmp = join(home, 'run-tmp');
  const resultFile = join(home, 'driver-result.jsonl');
  const manualReviewPath = join(runTmp, 'manual_or_unsupported.json');
  rmSync(manualReviewPath, { force: true });
  const env = onboardTestEnv(home, {
    MRWEIRDO_DB_PATH: dbPath,
    MRWEIRDO_ONBOARD_TMP_DIR: runTmp,
  });
  execFileSync(process.execPath, ['shared/init_db_cli.mjs'], { cwd: process.cwd(), env });
  const db = new DatabaseSync(dbPath);
  db.prepare(`
    INSERT INTO jobs(company, title, apply_url, status)
    VALUES ('Acme', 'Marketing Intern', 'https://boards.greenhouse.io/acme/jobs/1', '🤖 AI sourced')
  `).run();
  const rowId = db.prepare('SELECT id FROM jobs').get().id;
  db.close();
  writeFileSync(resultFile, `${JSON.stringify({
    outcome: 'skip',
    reason: 'cover_letter_required_not_generated',
    detail: { question: 'Cover Letter' },
  })}\n`);

  const stdout = execFileSync(process.execPath, [
    'shared/record_apply_outcome.mjs',
    '--row-id',
    String(rowId),
    '--result-file',
    resultFile,
  ], { cwd: process.cwd(), env, encoding: 'utf8' });
  const recorded = JSON.parse(stdout);
  assert.equal(recorded.action, 'skipped');
  assert.equal(recorded.reason, 'cover_letter_required_not_generated');

  const after = new DatabaseSync(dbPath);
  const row = after.prepare('SELECT status, skip_reason, auto_apply_eligible FROM jobs WHERE id = ?').get(rowId);
  after.close();
  assert.equal(row.status, '⚠️ 跳过未投');
  assert.equal(row.skip_reason, 'cover_letter_required_not_generated');
  assert.equal(row.auto_apply_eligible, 0);

  assert.equal(existsSync(manualReviewPath), true);
  const manual = JSON.parse(readFileSync(manualReviewPath, 'utf8'));
  assert.equal(manual.length, 1);
  assert.equal(manual[0].row_id, rowId);
  assert.equal(manual[0].reason, 'cover_letter_required_not_generated');
  assert.equal(manual[0].manual_apply_required, true);
});
