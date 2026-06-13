import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { onboardTestEnv } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function createDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY,
      company TEXT,
      title TEXT,
      status TEXT,
      auto_apply_eligible INTEGER,
      submitted_at TEXT,
      auto_submitted_at TEXT,
      skip_reason TEXT,
      user_note TEXT,
      bot_note TEXT,
      updated_at TEXT
    );
    CREATE TABLE feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      outcome TEXT,
      reason TEXT,
      detail TEXT
    );
  `);
  db.prepare(`
    INSERT INTO jobs(id, company, title, status, auto_apply_eligible, submitted_at, auto_submitted_at, skip_reason, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(201, 'Address Co', 'Marketing Intern', '⚠️ 跳过未投', 0, null, null, 'profile_full_address_required');
  db.prepare(`
    INSERT INTO jobs(id, company, title, status, auto_apply_eligible, submitted_at, auto_submitted_at, skip_reason, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(202, 'Done Co', 'Ops Intern', '✅ 已投', 0, '2026-06-08T00:00:00Z', '2026-06-08T00:00:00Z', null);
  db.close();
}

test('retry_gap_rows requeues only skipped missing-info rows', () => {
  const root = mkdtempSync(join(tmpdir(), 'mrw-retry-'));
  const home = join(root, 'home');
  const dbFile = join(home, 'jobs.db');
  const gapPath = join(root, 'gap.json');
  mkdirSync(home, { recursive: true });
  createDb(dbFile);

  writeFileSync(gapPath, JSON.stringify({
    retry_candidates: [
      { row_id: 201, company: 'Address Co', title: 'Marketing Intern', categories: ['user_full_address'] },
      { row_id: 202, company: 'Done Co', title: 'Ops Intern', categories: ['user_full_address'] },
    ],
  }));

  const run = spawnSync(process.execPath, [
    'shared/retry_gap_rows.mjs',
    '--apply',
    '--gap-report', gapPath,
  ], {
    cwd: ROOT,
    env: onboardTestEnv(home, { MRWEIRDO_DB_PATH: dbFile }),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  const output = JSON.parse(run.stdout);
  assert.equal(output.summary.requeued, 1);
  assert.equal(output.summary.already_submitted, 1);

  const db = new DatabaseSync(dbFile);
  const requeued = db.prepare('SELECT status, auto_apply_eligible, skip_reason, bot_note FROM jobs WHERE id = 201').get();
  assert.equal(requeued.status, '🤖 AI sourced');
  assert.equal(requeued.auto_apply_eligible, 1);
  assert.equal(requeued.skip_reason, null);
  assert.match(requeued.bot_note, /missing-info follow-up/);

  const submitted = db.prepare('SELECT status, auto_apply_eligible FROM jobs WHERE id = 202').get();
  assert.equal(submitted.status, '✅ 已投');
  assert.equal(submitted.auto_apply_eligible, 0);

  const feedback = db.prepare('SELECT reason, detail FROM feedback WHERE job_id = 201').get();
  assert.equal(feedback.reason, 'missing_info_followup_answered');
  assert.match(feedback.detail, /user_full_address/);
  db.close();
});
