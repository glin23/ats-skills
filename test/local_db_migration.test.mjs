import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

test('old jobs.db migrates Phase 2 columns and views idempotently', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrweirdo-db-'));
  const dbFile = join(home, 'jobs.db');
  const db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      title TEXT,
      apply_url TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT '🤖 AI sourced',
      fit_score INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO jobs(company, title, apply_url, status, fit_score)
    VALUES ('Acme', 'Marketing Intern', 'https://example.com/job', '🤖 AI sourced', 8);
  `);
  db.close();

  for (let i = 0; i < 2; i += 1) {
    const result = spawnSync(process.execPath, ['shared/init_db_cli.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, MRWEIRDO_HOME: home },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  }

  const migrated = new DatabaseSync(dbFile);
  const columns = new Set(migrated.prepare(`PRAGMA table_info(jobs)`).all().map((row) => row.name));
  for (const name of [
	    'liveness_status',
	    'liveness_checked_at',
	    'key_alignment',
	    'report_path',
    'outcome_status',
    'outcome_updated_at',
    'last_followup_at',
    'followup_count',
  ]) {
    assert.ok(columns.has(name), `missing ${name}`);
  }
  const row = migrated.prepare(`SELECT outcome_status, followup_count FROM jobs`).get();
  assert.equal(row.outcome_status, 'pending');
  assert.equal(row.followup_count, 0);
  assert.ok(migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'view' AND name = 'v_outcomes'`).get());
  assert.ok(migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'view' AND name = 'v_followup_due'`).get());
  migrated.close();
});
