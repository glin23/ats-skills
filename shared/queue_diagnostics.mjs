#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath, initDb } from './local_db.mjs';
import { atsHome } from './paths.mjs';
import { deriveRoleTypeFromJob, roleTypesFromSearchIntent } from './role_types.mjs';
import { normalizeCompany, normalizeTitle, SUBMITTED_STATUSES } from './job_identity.mjs';
import { eligibleReason, legitimacyBlockReason } from './eligibility.mjs';
import { assessFunctionRelevance, FUNCTION_RELEVANCE_TOO_DISTANT_REASON } from './function_relevance.mjs';
import { KNOWN_UNSUPPORTED_PLATFORMS, SUPPORTED_AUTO_PLATFORMS, discoveryApplyBucket } from './sourcing/apply_url_classification.mjs';
import { formatMaxRows, resolveMaxRows } from './batch_limit.mjs';

const HOME = atsHome();
const MAX_ROWS = resolveMaxRows();
const MIN_FIT = Math.max(0, Number(process.env.MRWEIRDO_MIN_FIT_SCORE || 5));
const SUPPORTED_AUTO = new Set(SUPPORTED_AUTO_PLATFORMS);

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

function reasonFor(row, allowedRoleTypes, submittedKeys, intentDoc) {
  const functionRelevance = assessFunctionRelevance(row, intentDoc);
  if (functionRelevance.status === 'too_distant') return FUNCTION_RELEVANCE_TOO_DISTANT_REASON;
  const roleType = deriveRoleTypeFromJob(row);
  return eligibleReason(row, {
    roleType,
    allowedRoleTypes,
    submittedKeys,
    minFit: MIN_FIT,
    supportedAuto: SUPPORTED_AUTO,
  });
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
    recommended: r.recommended == null ? null : Boolean(r.recommended),
    legitimacy: r.legitimacy || 'high',
    legitimacy_signals: r.legitimacy_signals || null,
    liveness_status: r.liveness_status || null,
    liveness_checked_at: r.liveness_checked_at || null,
    role_type_match: r.role_type_match,
    derived_role_type: deriveRoleTypeFromJob(r),
    function_relevance: r.function_relevance || null,
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
  SELECT id, company, title, apply_url, ats_platform, search_source, status, fit_score,
         recommended, role_type_match, apply_quota_limit, auto_apply_eligible, legitimacy,
         legitimacy_signals, liveness_status, liveness_checked_at, updated_at
    FROM jobs
   WHERE fit_score IS NOT NULL
   ORDER BY fit_score DESC, updated_at DESC, id ASC
`).all();

const pendingRows = rows.filter((row) => row.status === '🤖 AI sourced');
const annotated = pendingRows.map((row) => {
  const functionRelevance = assessFunctionRelevance(row, intentDoc);
  return {
    ...row,
    function_relevance: functionRelevance,
    reason: functionRelevance.status === 'too_distant'
      ? FUNCTION_RELEVANCE_TOO_DISTANT_REASON
      : reasonFor(row, allowedRoleTypes, submittedKeys, intentDoc),
  };
});
const rescoreCandidates = pendingRows.filter((row) => {
  const roleType = deriveRoleTypeFromJob(row);
  return SUPPORTED_AUTO.has(row.ats_platform)
    && row.apply_quota_limit == null
    && allowedRoleTypes.includes(roleType)
    && !isAlreadySubmitted(row, submittedKeys)
    && !legitimacyBlockReason(row)
    && reasonFor(row, allowedRoleTypes, submittedKeys, intentDoc) !== FUNCTION_RELEVANCE_TOO_DISTANT_REASON
    && reasonFor(row, allowedRoleTypes, submittedKeys, intentDoc) !== 'expired_title_year'
    && reasonFor(row, allowedRoleTypes, submittedKeys, intentDoc) !== 'test_or_sandbox_posting'
    && (row.fit_score ?? 0) === MIN_FIT - 1;
});
const platformExpansionCandidates = pendingRows.filter((row) => {
  const roleType = deriveRoleTypeFromJob(row);
  return KNOWN_UNSUPPORTED_PLATFORMS.has(row.ats_platform)
    && row.apply_quota_limit == null
    && allowedRoleTypes.includes(roleType)
    && !isAlreadySubmitted(row, submittedKeys)
    && !legitimacyBlockReason(row)
    && reasonFor(row, allowedRoleTypes, submittedKeys, intentDoc) !== FUNCTION_RELEVANCE_TOO_DISTANT_REASON
    && reasonFor(row, allowedRoleTypes, submittedKeys, intentDoc) !== 'expired_title_year'
    && reasonFor(row, allowedRoleTypes, submittedKeys, intentDoc) !== 'test_or_sandbox_posting'
    && (row.fit_score ?? 0) >= MIN_FIT;
});
const manualOnlyCandidates = pendingRows.filter((row) => {
  const roleType = deriveRoleTypeFromJob(row);
  return ['manual_only', 'unknown_or_custom_platform'].includes(discoveryApplyBucket(row))
    && row.apply_quota_limit == null
    && allowedRoleTypes.includes(roleType)
    && !isAlreadySubmitted(row, submittedKeys)
    && !legitimacyBlockReason(row)
    && reasonFor(row, allowedRoleTypes, submittedKeys, intentDoc) !== FUNCTION_RELEVANCE_TOO_DISTANT_REASON
    && reasonFor(row, allowedRoleTypes, submittedKeys, intentDoc) !== 'expired_title_year'
    && reasonFor(row, allowedRoleTypes, submittedKeys, intentDoc) !== 'test_or_sandbox_posting'
    && (row.fit_score ?? 0) >= MIN_FIT;
});
const summary = {
  max_rows: formatMaxRows(MAX_ROWS),
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
  by_legitimacy: {},
  by_liveness: {},
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
summary.shortfall = MAX_ROWS == null ? 0 : Math.max(0, MAX_ROWS - summary.eligible);
summary.remaining_to_requested_batch = summary.shortfall;

for (const row of annotated) {
  bump(summary.by_reason, row.reason);
  bump(summary.by_platform, row.ats_platform);
  bump(summary.by_fit_score, row.fit_score ?? 'missing');
  bump(summary.by_legitimacy, row.legitimacy || 'high');
  bump(summary.by_liveness, row.liveness_status || 'unchecked');
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
  console.log(`queue diagnostics: eligible=${summary.eligible}, requested=${formatMaxRows(MAX_ROWS)}, remaining=${summary.remaining_to_requested_batch}`);
  for (const [reason, count] of Object.entries(summary.by_reason).sort((a, b) => b[1] - a[1])) {
    console.log(`- ${reason}: ${count}`);
  }
  console.log(`near misses:`);
  console.log(`- rows_to_review_fit_one_below: ${summary.near_misses.rescore_candidates_fit_one_below.count}`);
  console.log(`- unsupported_ats_rows: ${summary.near_misses.platform_expansion_candidates.count}`);
}
