#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath, initDb } from './local_db.mjs';
import { atsHome } from './paths.mjs';
import { deriveRoleTypeFromJob, roleTypesFromSearchIntent } from './role_types.mjs';
import { normalizeCompany, normalizeTitle, SUBMITTED_STATUSES } from './job_identity.mjs';
import { eligibleReason } from './eligibility.mjs';
import { assessFunctionRelevance, FUNCTION_RELEVANCE_TOO_DISTANT_REASON } from './function_relevance.mjs';
import { SUPPORTED_AUTO_PLATFORMS } from './sourcing/apply_url_classification.mjs';

const HOME = atsHome();
const MIN_FIT = Math.max(0, Number(process.env.MRWEIRDO_MIN_FIT_SCORE || 5));
const SUPPORTED_AUTO = new Set(SUPPORTED_AUTO_PLATFORMS);

function readIntent() {
  try {
    return JSON.parse(fs.readFileSync(path.join(HOME, 'search_intent.json'), 'utf8'));
  } catch (_) {
    return { search_intent: { seniority: 'intern' } };
  }
}

function boolArg(name) {
  return process.argv.includes(name);
}


const apply = boolArg('--apply');
const json = boolArg('--json');
const intentDoc = readIntent();
const allowedRoleTypes = roleTypesFromSearchIntent(intentDoc.search_intent || {});

initDb();
const db = new DatabaseSync(dbPath());
const submittedKeys = new Set(
  db.prepare(`
    SELECT company, title
      FROM jobs
     WHERE status IN (${[...SUBMITTED_STATUSES].map(() => '?').join(',')})
  `).all(...SUBMITTED_STATUSES)
    .map((r) => `${normalizeCompany(r.company)}::${normalizeTitle(r.title)}`)
);
const rows = db.prepare(`
  SELECT id, company, title, apply_url, ats_platform, status, fit_score,
         recommended, role_type_match, apply_quota_limit, auto_apply_eligible,
         legitimacy, liveness_status, updated_at
    FROM jobs
   WHERE fit_score IS NOT NULL
     AND status = '🤖 AI sourced'
   ORDER BY fit_score DESC, updated_at DESC, id ASC
`).all();

const changes = [];
const summary = {
  apply,
  min_fit: MIN_FIT,
  allowed_role_types: allowedRoleTypes,
  scanned: rows.length,
  enable: 0,
  disable: 0,
  stale_non_pending_disabled: 0,
  unchanged: 0,
  by_reason: {},
};

for (const row of rows) {
  const roleType = deriveRoleTypeFromJob(row);
  const functionRelevance = assessFunctionRelevance(row, intentDoc);
  let reason = functionRelevance.status === 'too_distant'
    ? FUNCTION_RELEVANCE_TOO_DISTANT_REASON
    : eligibleReason(row, {
      roleType,
      allowedRoleTypes,
      submittedKeys,
      minFit: MIN_FIT,
      supportedAuto: SUPPORTED_AUTO,
    });
  const currentEligible = Number(row.auto_apply_eligible || 0);
  if (reason === 'eligible' && row.recommended == null && currentEligible === 0) {
    reason = 'legacy_recommended_unknown';
  }
  const nextEligible = reason === 'eligible' ? 1 : 0;
  summary.by_reason[reason] = (summary.by_reason[reason] || 0) + 1;

  if (nextEligible === currentEligible) {
    summary.unchanged += 1;
    continue;
  }

  const change = {
    id: row.id,
    company: row.company,
    title: row.title,
    ats_platform: row.ats_platform,
    fit_score: row.fit_score,
    role_type_match: roleType,
    from: currentEligible,
    to: nextEligible,
    reason,
    function_relevance: functionRelevance,
  };
  changes.push(change);
  if (nextEligible) summary.enable += 1;
  else summary.disable += 1;
}

if (apply && changes.length) {
  db.exec('BEGIN');
  try {
    const stmt = db.prepare(`
      UPDATE jobs
         SET auto_apply_eligible = :eligible,
             role_type_match = COALESCE(NULLIF(role_type_match, ''), :role_type),
             updated_at = datetime('now')
       WHERE id = :id
         AND status = '🤖 AI sourced'
    `);
    for (const c of changes) {
      stmt.run({ id: c.id, eligible: c.to, role_type: c.role_type_match });
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

if (apply) {
  const stale = db.prepare(`
    UPDATE jobs
       SET auto_apply_eligible = 0
     WHERE status <> '🤖 AI sourced'
       AND COALESCE(auto_apply_eligible, 0) <> 0
  `).run();
  summary.stale_non_pending_disabled = stale.changes || 0;
}

if (json) {
  console.log(JSON.stringify({ summary, changes }, null, 2));
} else {
  console.error(JSON.stringify(summary));
  for (const c of changes.slice(0, 50)) console.log(JSON.stringify(c));
  if (changes.length > 50) {
    console.error(JSON.stringify({ omitted_changes: changes.length - 50 }));
  }
}
