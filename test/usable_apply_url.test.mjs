import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { discoveryApplyBucket, platformFromUrl } from '../shared/sourcing/apply_url_classification.mjs';
import { hasUsableApplyUrl } from '../shared/sourcing/usable_apply_url.mjs';

test('hasUsableApplyUrl accepts only real http(s) URLs', () => {
  assert.equal(hasUsableApplyUrl('https://boards.greenhouse.io/acme/jobs/1'), true);
  assert.equal(hasUsableApplyUrl({ apply_url: 'http://jobs.ashbyhq.com/acme/abc' }), true);
  assert.equal(hasUsableApplyUrl('NO_URL:yc_waas:94401'), false);
  assert.equal(hasUsableApplyUrl({ apply_url: '' }), false);
  assert.equal(hasUsableApplyUrl({ apply_url: 'mailto:jobs@example.com' }), false);
  assert.equal(hasUsableApplyUrl({ apply_url: 'not a url' }), false);
});

test('discoveryApplyBucket separates auto-supported from manual sources', () => {
  assert.equal(discoveryApplyBucket({
    apply_url: 'https://boards.greenhouse.io/acme/jobs/1',
    source: 'greenhouse_bulk',
  }), 'auto_supported');
  assert.equal(discoveryApplyBucket({
    apply_url: 'https://www.ycombinator.com/companies/acme/jobs/123',
    source: 'yc_waas',
  }), 'manual_only');
  assert.equal(discoveryApplyBucket({
    apply_url: 'https://remoteok.com/remote-jobs/123',
    source: 'remoteok',
  }), 'manual_only');
  assert.equal(discoveryApplyBucket({
    apply_url: 'https://company.example/careers?gh_jid=123',
    source: 'yc_waas',
  }), 'auto_supported');
  assert.equal(discoveryApplyBucket({
    apply_url: 'https://jobs.lever.co/acme/abc-123/apply',
    source: 'lever_bulk',
  }), 'known_unsupported_ats');
  assert.equal(platformFromUrl('https://company.example/careers?gh_jid=123'), 'greenhouse');
});

test('store_scored_jobs skips candidates without usable apply URLs', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrweirdo-usable-url-'));
  const toScorePath = join(home, 'to_score.json');
  const scoredPath = join(home, 'scored.json');
  writeFileSync(join(home, 'search_intent.json'), JSON.stringify({
    search_intent: {
      role_type_targets: ['intern'],
      geographic_preference: {
        primary_country: 'US',
        countries_open_to: ['US'],
      },
    },
  }));
  writeFileSync(toScorePath, JSON.stringify([
    {
      company: 'Acme',
      title: 'Growth Intern',
      apply_url: 'https://boards.greenhouse.io/acme/jobs/1',
      location: 'United States',
      _discovery_source: 'greenhouse_bulk',
    },
    {
      company: '(unknown)',
      title: 'NO_URL:yc_waas:94401',
      apply_url: 'NO_URL:yc_waas:94401',
      location: 'United States',
      _discovery_source: 'yc_waas',
    },
  ]));
  writeFileSync(scoredPath, JSON.stringify([
    {
      apply_url: 'https://boards.greenhouse.io/acme/jobs/1',
      fit_score: 5,
      recommended: true,
      role_type_match: 'intern',
    },
    {
      apply_url: 'NO_URL:yc_waas:94401',
      fit_score: 7,
      recommended: true,
      role_type_match: 'intern',
    },
  ]));

  const stdout = execFileSync(process.execPath, [
    'shared/store_scored_jobs.mjs',
    '--run-id',
    'test-usable-url',
    '--to-score',
    toScorePath,
    '--scored',
    scoredPath,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MRWEIRDO_HOME: home,
      MRWEIRDO_DB_PATH: join(home, 'jobs.db'),
      MRWEIRDO_REPO_ROOT: process.cwd(),
    },
    encoding: 'utf8',
  });

  const summary = JSON.parse(stdout);
  assert.equal(summary.candidate_count, 2);
  assert.equal(summary.stored, 1);
  assert.equal(summary.eligible, 1);
  assert.equal(summary.skipped_unusable_apply_url, 1);
});

test('store_scored_jobs refuses partial scoring for usable candidates', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrweirdo-partial-score-'));
  const toScorePath = join(home, 'to_score.json');
  const scoredPath = join(home, 'scored.json');
  writeFileSync(join(home, 'search_intent.json'), JSON.stringify({
    search_intent: {
      role_type_targets: ['intern'],
      geographic_preference: {
        primary_country: 'US',
        countries_open_to: ['US'],
      },
    },
  }));
  writeFileSync(toScorePath, JSON.stringify([
    {
      company: 'Acme',
      title: 'Growth Intern',
      apply_url: 'https://boards.greenhouse.io/acme/jobs/1',
      location: 'United States',
      _discovery_source: 'greenhouse_bulk',
    },
    {
      company: 'Beta',
      title: 'Marketing Intern',
      apply_url: 'https://jobs.ashbyhq.com/beta/abc/application',
      location: 'United States',
      _discovery_source: 'ashby_bulk',
    },
  ]));
  writeFileSync(scoredPath, JSON.stringify([
    {
      apply_url: 'https://boards.greenhouse.io/acme/jobs/1',
      fit_score: 6,
      recommended: true,
      role_type_match: 'intern',
    },
  ]));

  const env = {
    ...process.env,
    MRWEIRDO_HOME: home,
    MRWEIRDO_DB_PATH: join(home, 'jobs.db'),
    MRWEIRDO_REPO_ROOT: process.cwd(),
  };
  const result = spawnSync(process.execPath, [
    'shared/store_scored_jobs.mjs',
    '--run-id',
    'test-partial-score',
    '--to-score',
    toScorePath,
    '--scored',
    scoredPath,
  ], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to store partial scoring/);
  assert.match(result.stderr, /"score_missing_count": 1/);

  const stdout = execFileSync(process.execPath, [
    'shared/store_scored_jobs.mjs',
    '--run-id',
    'test-partial-score-debug',
    '--to-score',
    toScorePath,
    '--scored',
    scoredPath,
    '--allow-partial-scores',
  ], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });

  const summary = JSON.parse(stdout);
  assert.equal(summary.usable_candidate_count, 2);
  assert.equal(summary.score_missing_count, 1);
  assert.equal(summary.stored, 2);
  assert.equal(summary.eligible, 1);
});

test('store_scored_jobs defaults missing legitimacy to high and holds suspicious rows', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrweirdo-legitimacy-'));
  const toScorePath = join(home, 'to_score.json');
  const scoredPath = join(home, 'scored.json');
  const dbPath = join(home, 'jobs.db');
  writeFileSync(join(home, 'search_intent.json'), JSON.stringify({
    search_intent: {
      role_type_targets: ['intern'],
      geographic_preference: {
        primary_country: 'US',
        countries_open_to: ['US'],
      },
    },
  }));
  writeFileSync(toScorePath, JSON.stringify([
    {
      company: 'Acme',
      title: 'Growth Intern',
      apply_url: 'https://boards.greenhouse.io/acme/jobs/1',
      location: 'United States',
      _discovery_source: 'greenhouse_bulk',
    },
    {
      company: 'Beta',
      title: 'Marketing Intern',
      apply_url: 'https://jobs.ashbyhq.com/beta/abc/application',
      location: 'United States',
      _discovery_source: 'ashby_bulk',
    },
  ]));
  writeFileSync(scoredPath, JSON.stringify([
    {
      apply_url: 'https://boards.greenhouse.io/acme/jobs/1',
      fit_score: 7,
      recommended: true,
      role_type_match: 'intern',
      dim_scores: {
        role_fit: 7,
        skills_match: 7,
        location_fit: 8,
        visa_compatible: 5,
        seniority_match: 10,
        exclude_check: 10,
      },
    },
    {
      apply_url: 'https://jobs.ashbyhq.com/beta/abc/application',
      fit_score: 8,
      recommended: true,
      role_type_match: 'intern',
      legitimacy: 'suspicious',
      legitimacy_signals: ['very generic description', 'unclear timing'],
      dim_scores: {
        role_fit: 8,
        skills_match: 7,
        location_fit: 8,
        visa_compatible: 5,
        seniority_match: 10,
        exclude_check: 10,
      },
    },
  ]));

  const env = {
    ...process.env,
    MRWEIRDO_HOME: home,
    MRWEIRDO_DB_PATH: dbPath,
    MRWEIRDO_REPO_ROOT: process.cwd(),
  };
  const stdout = execFileSync(process.execPath, [
    'shared/store_scored_jobs.mjs',
    '--run-id',
    'test-legitimacy',
    '--to-score',
    toScorePath,
    '--scored',
    scoredPath,
  ], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });

  const summary = JSON.parse(stdout);
  assert.equal(summary.stored, 2);
  assert.equal(summary.eligible, 1);
  assert.equal(summary.by_legitimacy.high, 1);
  assert.equal(summary.by_legitimacy.suspicious, 1);
  assert.equal(summary.by_ineligible_reason.legitimacy_suspicious, 1);

  const db = new DatabaseSync(dbPath);
  const rows = db.prepare(`
    SELECT company, auto_apply_eligible, recommended, legitimacy, legitimacy_signals
      FROM jobs
     ORDER BY company
  `).all();
  db.close();
  assert.deepEqual(rows.map((r) => [r.company, r.auto_apply_eligible, r.recommended, r.legitimacy]), [
    ['Acme', 1, 1, 'high'],
    ['Beta', 0, 1, 'suspicious'],
  ]);
  assert.match(rows[1].legitimacy_signals, /generic description/);

  const queue = execFileSync(process.execPath, ['shared/auto_apply_queue.mjs'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  }).trim().split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(queue.length, 1);
  assert.equal(queue[0].company, 'Acme');
});
