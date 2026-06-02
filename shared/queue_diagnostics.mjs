#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './local_db.mjs';
import { atsHome } from './paths.mjs';
import { deriveRoleTypeFromJob, roleTypesFromSearchIntent } from './role_types.mjs';
import { normalizeCompany, normalizeTitle, SUBMITTED_STATUSES } from './job_identity.mjs';
import { KNOWN_UNSUPPORTED_PLATFORMS, discoveryApplyBucket } from './sourcing/apply_url_classification.mjs';

const HOME = atsHome();
const MAX_ROWS = Math.max(1, Number(process.env.MRWEIRDO_MAX_AUTO_APPLY || 10));
const MIN_FIT = Math.max(0, Number(process.env.MRWEIRDO_MIN_FIT_SCORE || 5));
const SUPPORTED_AUTO = new Set(['greenhouse', 'ashby']);

function readIntent() {
  try {
    return JSON.parse(fs.readFileSync(path.join(HOME, 'search_intent.json'), 'utf8'));
  } catch {
    return { search_intent: { seniority: 'intern' } };
  }
}

function bump(obj, key, by = 1) {
  const k = String(key || 'unknown');
  obj[k] = (obj[k] || 0) + by;
}

function duplicateKey(row) {
  return `${normalizeCompany(row.company)}::${normalizeTitle(row.title)}`;
}

function isAlreadySubmitted(row, submittedKeys) {
  return submittedKeys.has(duplicateKey(row));
}

function reasonFor(row, allowedRoleTypes, submittedKeys) {
  if (row.apply_quota_limit != null) return 'quota_guarded';
  if (isAlreadySubmitted(row, submittedKeys)) return 'duplicate_same_company_title_already_submitted';
  const roleType = deriveRoleTypeFromJob(row);
  if (!allowedRoleTypes.includes(roleType)) return 'role_type_not_allowed';
  if ((row.fit_score ?? 0) < MIN_FIT) return 'fit_below_threshold';
  if (!SUPPORTED_AUTO.has(row.ats_platform)) return 'unsupported_ats_platform';
  return 'eligible';
}

function exampleShape(r) {
  return {
    id: r.id,
    company: r.company,
    title: r.title,
    ats_platform: r.ats_platform,
    search_source: r.search_source,
    discovery_apply_bucket: discoveryApplyBucket(r),
    fit_score: r.fit_score,
    role_type_match: r.role_type_match,
    derived_role_type: deriveRoleTypeFromJob(r),
  };
}

function examplesForRows(rows, limit = 8) {
  return rows
    .sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0) || a.id - b.id)
    .slice(0, limit)
    .map(exampleShape);
}

function examplesFor(rows, reason, limit = 8) {
  return examplesForRows(rows.filter((r) => r.reason === reason), limit);
}

const allowedRoleTypes = roleTypesFromSearchIntent(readIntent().search_intent || {});
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
  SELECT id, company, title, apply_url, ats_platform, search_source, status, fit_score,
         role_type_match, apply_quota_limit, auto_apply_eligible, updated_at
    FROM jobs
   WHERE fit_score IS NOT NULL
   ORDER BY fit_score DESC, updated_at DESC, id ASC
`).all();

const pendingRows = rows.filter((row) => row.status === '🤖 AI sourced');
const annotated = pendingRows.map((row) => ({ ...row, reason: reasonFor(row, allowedRoleTypes, submittedKeys) }));
const rescoreCandidates = pendingRows.filter((row) => {
  const roleType = deriveRoleTypeFromJob(row);
  return SUPPORTED_AUTO.has(row.ats_platform)
    && row.apply_quota_limit == null
    && allowedRoleTypes.includes(roleType)
    && !isAlreadySubmitted(row, submittedKeys)
    && (row.fit_score ?? 0) === MIN_FIT - 1;
});
const platformExpansionCandidates = pendingRows.filter((row) => {
  const roleType = deriveRoleTypeFromJob(row);
  return KNOWN_UNSUPPORTED_PLATFORMS.has(row.ats_platform)
    && row.apply_quota_limit == null
    && allowedRoleTypes.includes(roleType)
    && !isAlreadySubmitted(row, submittedKeys)
    && (row.fit_score ?? 0) >= MIN_FIT;
});
const manualOnlyCandidates = pendingRows.filter((row) => {
  const roleType = deriveRoleTypeFromJob(row);
  return ['manual_only', 'unknown_or_custom_platform'].includes(discoveryApplyBucket(row))
    && row.apply_quota_limit == null
    && allowedRoleTypes.includes(roleType)
    && !isAlreadySubmitted(row, submittedKeys)
    && (row.fit_score ?? 0) >= MIN_FIT;
});
const summary = {
  max_rows: MAX_ROWS,
  min_fit: MIN_FIT,
  allowed_role_types: allowedRoleTypes,
  scanned: pendingRows.length,
  all_status_rows: rows.length,
  not_pending: rows.length - pendingRows.length,
  eligible: annotated.filter((r) => r.reason === 'eligible').length,
  shortfall: 0,
  by_reason: {},
  by_platform: {},
  by_fit_score: {},
  examples: {},
  near_misses: {
    rescore_candidates_fit_one_below: {
      description: `Pending rows that would become ready-to-submit if manually re-scored from ${MIN_FIT - 1} to ${MIN_FIT}.`,
      count: rescoreCandidates.length,
      examples: examplesForRows(rescoreCandidates, 12),
    },
    platform_expansion_candidates: {
      description: 'Pending rows with allowed role type and sufficient fit score on a known ATS whose auto-submit driver is not enabled.',
      count: platformExpansionCandidates.length,
      by_platform: {},
      examples: examplesForRows(platformExpansionCandidates, 12),
    },
    manual_or_unknown_platform_candidates: {
      description: 'Pending rows with allowed role type and sufficient fit score that are manual-only, aggregators, or unknown/custom platforms. They are visible for review but are not counted as auto-submit-ready rows.',
      count: manualOnlyCandidates.length,
      by_bucket: {},
      examples: examplesForRows(manualOnlyCandidates, 12),
    },
  },
};
summary.shortfall = Math.max(0, MAX_ROWS - summary.eligible);
summary.remaining_to_requested_batch = summary.shortfall;

for (const row of annotated) {
  bump(summary.by_reason, row.reason);
  bump(summary.by_platform, row.ats_platform);
  bump(summary.by_fit_score, row.fit_score ?? 'missing');
}

for (const row of platformExpansionCandidates) {
  bump(summary.near_misses.platform_expansion_candidates.by_platform, row.ats_platform);
}
for (const row of manualOnlyCandidates) {
  bump(summary.near_misses.manual_or_unknown_platform_candidates.by_bucket, discoveryApplyBucket(row));
}

for (const reason of Object.keys(summary.by_reason)) {
  if (reason !== 'eligible') summary.examples[reason] = examplesFor(annotated, reason);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`queue diagnostics: eligible=${summary.eligible}, requested=${MAX_ROWS}, remaining=${summary.remaining_to_requested_batch}`);
  for (const [reason, count] of Object.entries(summary.by_reason).sort((a, b) => b[1] - a[1])) {
    console.log(`- ${reason}: ${count}`);
  }
  console.log(`near misses:`);
  console.log(`- rows_to_review_fit_one_below: ${summary.near_misses.rescore_candidates_fit_one_below.count}`);
  console.log(`- unsupported_ats_rows: ${summary.near_misses.platform_expansion_candidates.count}`);
}
