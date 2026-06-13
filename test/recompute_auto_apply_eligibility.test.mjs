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

test('recompute and queue keep function-distant rows out of auto-apply', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrweirdo-recompute-function-'));
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
      function_area: ['Operations', 'Product Management'],
      role_categories: [
        { title_pattern: 'Business Operations Intern', priority: 'high' },
        { title_pattern: 'Product Management Intern', priority: 'high' },
        { title_pattern: 'Strategy Intern', priority: 'medium' },
      ],
      target_function_anchor: {
        self_reported_target_functions: ['Operations', 'Product Management'],
        adjacent_functions: ['BizOps', 'Strategy', 'APM', 'Program Management'],
        excluded_functions: ['Software Engineering', 'Nursing', 'Design', 'Data'],
      },
      geographic_preference: { primary_country: 'US', countries_open_to: ['US'] },
    },
  }));

  runNode(['shared/init_db_cli.mjs'], env);
  const db = new DatabaseSync(dbPath);
  db.prepare(`
    INSERT INTO jobs(company, title, apply_url, status, fit_score, recommended,
                     role_type_match, ats_platform, auto_apply_eligible)
    VALUES ('Wrong Function Co', 'Software Engineering Intern',
            'https://job-boards.greenhouse.io/wrongfunction/jobs/1',
            '🤖 AI sourced', 9, 1, 'intern', 'greenhouse', 1)
  `).run();
  db.close();

  const plan = JSON.parse(runNode(['shared/recompute_auto_apply_eligibility.mjs', '--json'], env));
  assert.equal(plan.summary.by_reason.function_relevance_too_distant, 1);
  assert.equal(plan.changes.find((row) => row.company === 'Wrong Function Co')?.to, 0);

  runNode(['shared/recompute_auto_apply_eligibility.mjs', '--apply', '--json'], env);
  const after = new DatabaseSync(dbPath);
  const row = after.prepare(`
    SELECT auto_apply_eligible
      FROM jobs
     WHERE company = 'Wrong Function Co'
  `).get();
  after.close();
  assert.equal(row.auto_apply_eligible, 0);

  const queue = runNode(['shared/auto_apply_queue.mjs'], env).trim();
  assert.equal(queue, '');

  const diagnostics = JSON.parse(runNode(['shared/queue_diagnostics.mjs', '--json'], env));
  assert.equal(diagnostics.by_reason.function_relevance_too_distant, 1);
  assert.equal(diagnostics.examples.function_relevance_too_distant[0].company, 'Wrong Function Co');
});
