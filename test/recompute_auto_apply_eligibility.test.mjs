import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

function runNode(args, env) {
  return execFileSync(process.execPath, args, {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
}

test('recompute does not upgrade legacy recommended-null rows that were already disabled', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrweirdo-recompute-'));
  const dbPath = join(home, 'jobs.db');
  const env = {
    ...process.env,
    MRWEIRDO_HOME: home,
    MRWEIRDO_DB_PATH: dbPath,
    MRWEIRDO_REPO_ROOT: process.cwd(),
  };

  writeFileSync(join(home, 'search_intent.json'), JSON.stringify({
    search_intent: {
      role_type_targets: ['intern'],
      geographic_preference: { primary_country: 'US', countries_open_to: ['US'] },
    },
  }));

  runNode(['shared/init_db_cli.mjs'], env);
  const db = new DatabaseSync(dbPath);
  const insert = db.prepare(`
    INSERT INTO jobs(company, title, apply_url, status, fit_score, recommended,
                     role_type_match, ats_platform, auto_apply_eligible)
    VALUES (:company, :title, :url, '🤖 AI sourced', :fit, :recommended,
            'intern', 'greenhouse', :eligible)
  `);
  insert.run({
    company: 'Legacy Disabled',
    title: 'Marketing Intern',
    url: 'https://job-boards.greenhouse.io/legacydisabled/jobs/1',
    fit: 8,
    recommended: null,
    eligible: 0,
  });
  insert.run({
    company: 'Legacy Enabled',
    title: 'Growth Intern',
    url: 'https://job-boards.greenhouse.io/legacyenabled/jobs/2',
    fit: 8,
    recommended: null,
    eligible: 1,
  });
  insert.run({
    company: 'Modern Enabled',
    title: 'Ops Intern',
    url: 'https://job-boards.greenhouse.io/modernenabled/jobs/3',
    fit: 8,
    recommended: 1,
    eligible: 0,
  });
  db.close();

  const plan = JSON.parse(runNode(['shared/recompute_auto_apply_eligibility.mjs', '--json'], env));
  assert.equal(plan.summary.by_reason.legacy_recommended_unknown, 1);
  assert.equal(plan.changes.find((row) => row.company === 'Legacy Disabled'), undefined);
  assert.equal(plan.changes.find((row) => row.company === 'Modern Enabled')?.to, 1);

  runNode(['shared/recompute_auto_apply_eligibility.mjs', '--apply', '--json'], env);
  const after = new DatabaseSync(dbPath);
  const rows = after.prepare(`
    SELECT company, auto_apply_eligible
      FROM jobs
     ORDER BY company
  `).all();
  after.close();

  assert.deepEqual(rows.map((row) => [row.company, row.auto_apply_eligible]), [
    ['Legacy Disabled', 0],
    ['Legacy Enabled', 1],
    ['Modern Enabled', 1],
  ]);
});
