#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './local_db.mjs';
import { roleTypesFromSearchIntent } from './role_types.mjs';
import { normalizeCompany, normalizeTitle, SUBMITTED_STATUSES } from './job_identity.mjs';
import { passesQueueFilters, duplicateKey } from './eligibility.mjs';

const HOME = process.env.MRWEIRDO_HOME || path.join(process.env.HOME || '', '.mrweirdo-jobs');
const MAX_ROWS = Math.max(1, Number(process.env.MRWEIRDO_MAX_AUTO_APPLY || 10));
const MIN_FIT = Math.max(0, Number(process.env.MRWEIRDO_MIN_FIT_SCORE || 5));
const SUPPORTED_AUTO = new Set(['greenhouse', 'ashby']);

function readIntent() {
  try {
    return JSON.parse(fs.readFileSync(path.join(HOME, 'search_intent.json'), 'utf8'));
  } catch (_) {
    return { search_intent: { seniority: 'intern' } };
  }
}

const roleTypes = roleTypesFromSearchIntent(readIntent().search_intent || {});
const platformPlaceholders = [...SUPPORTED_AUTO].map(() => '?').join(',');

const db = new DatabaseSync(dbPath());
const candidates = db.prepare(`
  WITH ranked AS (
    SELECT id, company, title, apply_url, ats_platform, fit_score, role_type_match,
           auto_apply_eligible, apply_quota_limit, updated_at,
           ROW_NUMBER() OVER (
             PARTITION BY lower(trim(company)), lower(trim(title))
             ORDER BY fit_score DESC,
                      CASE
                        WHEN lower(apply_url) LIKE '%job-boards.greenhouse.io%' THEN 0
                        WHEN lower(apply_url) LIKE '%boards.greenhouse.io%' THEN 1
                        WHEN lower(apply_url) LIKE '%ashbyhq.com%' THEN 2
                        ELSE 9
                      END,
                      updated_at DESC,
                      id ASC
           ) AS rn
     FROM jobs
     WHERE status = '🤖 AI sourced'
       AND fit_score >= ?
       AND ats_platform IN (${platformPlaceholders})
       AND apply_quota_limit IS NULL
  )
  SELECT id, company, title, apply_url, ats_platform, fit_score, role_type_match,
         auto_apply_eligible, apply_quota_limit
    FROM ranked
   WHERE rn = 1
   ORDER BY fit_score DESC, updated_at DESC
   LIMIT ?
`).all(MIN_FIT, ...SUPPORTED_AUTO, MAX_ROWS * 20);

const submittedKeys = new Set(
  db.prepare(`
    SELECT company, title
      FROM jobs
     WHERE status IN (${[...SUBMITTED_STATUSES].map(() => '?').join(',')})
  `).all(...SUBMITTED_STATUSES)
    .map((r) => `${normalizeCompany(r.company)}::${normalizeTitle(r.title)}`)
);

const rows = [];
const queuedKeys = new Set();
for (const row of candidates) {
  if (!passesQueueFilters(row, { roleTypes, submittedKeys, seenKeys: queuedKeys })) continue;
  rows.push(row);
  queuedKeys.add(duplicateKey(row));
  if (rows.length >= MAX_ROWS) break;
}

if (process.argv.includes('--summary')) {
  console.error(JSON.stringify({ max_rows: MAX_ROWS, min_fit: MIN_FIT, role_type_targets: roleTypes, rows: rows.length }));
}

for (const row of rows) {
  console.log(JSON.stringify(row));
}
