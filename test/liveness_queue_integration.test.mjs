import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { onboardTestEnv } from './helpers.mjs';

test('auto queue keeps unchecked and uncertain liveness rows but drops expired', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrweirdo-live-queue-'));
  const env = onboardTestEnv(home, { MRWEIRDO_MAX_AUTO_APPLY: '0' });
  writeFileSync(join(home, 'search_intent.json'), JSON.stringify({
    search_intent: { role_type_targets: ['intern'] },
  }));
  const init = spawnSync(process.execPath, ['shared/init_db_cli.mjs'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
  assert.equal(init.status, 0, init.stderr);

  const db = new DatabaseSync(join(home, 'jobs.db'));
  const insert = db.prepare(`
    INSERT INTO jobs(company, title, apply_url, status, fit_score, recommended,
                     role_type_match, auto_apply_eligible, ats_platform, liveness_status)
    VALUES (?, 'Marketing Intern', ?, '🤖 AI sourced', 8, 1, 'intern', 1, 'greenhouse', ?)
  `);
  insert.run('Unchecked Co', 'https://boards.greenhouse.io/unchecked/jobs/1', null);
  insert.run('Uncertain Co', 'https://boards.greenhouse.io/uncertain/jobs/1', 'uncertain');
  insert.run('Expired Co', 'https://boards.greenhouse.io/expired/jobs/1', 'expired');
  db.close();

  const queue = spawnSync(process.execPath, ['shared/auto_apply_queue.mjs'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
  assert.equal(queue.status, 0, queue.stderr);
  const rows = queue.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  assert.deepEqual(rows.map((row) => row.company).sort(), ['Uncertain Co', 'Unchecked Co']);
});
