import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { onboardTestEnv } from './helpers.mjs';

function initHome() {
  const home = mkdtempSync(join(tmpdir(), 'mrweirdo-tracker-'));
  const env = onboardTestEnv(home);
  const init = spawnSync(process.execPath, ['shared/init_db_cli.mjs'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
  assert.equal(init.status, 0, init.stderr);
  return { home, env, dbFile: join(home, 'jobs.db') };
}

test('tracker_cli records outcome metadata without changing emoji status', () => {
  const { env, dbFile } = initHome();
  let db = new DatabaseSync(dbFile);
  db.prepare(`
    INSERT INTO jobs(company, title, apply_url, status, submitted_at)
    VALUES ('Acme', 'Marketing Intern', 'https://example.com/acme', '✅ 已投', datetime('now', '-2 days'))
  `).run();
  const rowId = db.prepare(`SELECT id FROM jobs`).get().id;
  db.close();

  const result = spawnSync(process.execPath, [
    'shared/tracker_cli.mjs',
    '--row-id', String(rowId),
    '--outcome', 'oa',
    '--note', 'online assessment received',
  ], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);

  db = new DatabaseSync(dbFile);
  const row = db.prepare(`SELECT status, outcome_status, outcome_updated_at FROM jobs WHERE id = ?`).get(rowId);
  assert.equal(row.status, '✅ 已投');
  assert.equal(row.outcome_status, 'oa');
  assert.ok(row.outcome_updated_at);
  const feedback = db.prepare(`SELECT outcome, reason, detail FROM feedback WHERE job_id = ?`).get(rowId);
  assert.equal(feedback.outcome, 'outcome_oa');
  assert.equal(feedback.reason, 'tracker_update');
  assert.equal(feedback.detail, 'online assessment received');
  db.close();
});

test('tracker_cli records follow-up sent counts separately from outcome', () => {
  const { env, dbFile } = initHome();
  let db = new DatabaseSync(dbFile);
  db.prepare(`
    INSERT INTO jobs(company, title, apply_url, status, submitted_at)
    VALUES ('Acme', 'Marketing Intern', 'https://example.com/acme', '✅ 已投', datetime('now', '-8 days'))
  `).run();
  const rowId = db.prepare(`SELECT id FROM jobs`).get().id;
  db.close();

  const result = spawnSync(process.execPath, [
    'shared/tracker_cli.mjs',
    '--row-id', String(rowId),
    '--followup-sent',
    '--note', 'sent by email',
  ], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);

  db = new DatabaseSync(dbFile);
  const row = db.prepare(`SELECT outcome_status, followup_count, last_followup_at FROM jobs WHERE id = ?`).get(rowId);
  assert.equal(row.outcome_status, 'pending');
  assert.equal(row.followup_count, 1);
  assert.ok(row.last_followup_at);
  db.close();
});
