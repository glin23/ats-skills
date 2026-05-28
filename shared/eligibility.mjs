// Pure auto-apply eligibility decision, extracted from
// recompute_auto_apply_eligibility.mjs so the full-time-leak gate can be
// unit-tested without a SQLite database. Behavior is verbatim with the prior
// inline `eligibleReason`; only the side-effecting DB/CLI wrapper stays in the
// script.
import { normalizeCompany, normalizeTitle } from './job_identity.mjs';
import { deriveRoleTypeFromJob } from './role_types.mjs';

export const DEFAULT_SUPPORTED_AUTO = new Set(['greenhouse', 'ashby']);

export function duplicateKey(row = {}) {
  return `${normalizeCompany(row.company)}::${normalizeTitle(row.title)}`;
}

// Returns one of:
//   'not_pending' | 'quota_guarded'
//   | 'duplicate_same_company_title_already_submitted'
//   | 'role_type_not_allowed' | 'fit_below_threshold'
//   | 'unsupported_ats_platform' | 'eligible'
// Order matters — the first failing guard wins (matches the original).
export function eligibleReason(row = {}, {
  roleType,
  allowedRoleTypes = ['intern', 'part_time'],
  submittedKeys = new Set(),
  minFit = 5,
  supportedAuto = DEFAULT_SUPPORTED_AUTO,
} = {}) {
  if (row.status !== '🤖 AI sourced') return 'not_pending';
  if (row.apply_quota_limit != null) return 'quota_guarded';
  if (submittedKeys.has(duplicateKey(row))) return 'duplicate_same_company_title_already_submitted';
  if (!allowedRoleTypes.includes(roleType)) return 'role_type_not_allowed';
  if ((row.fit_score ?? 0) < minFit) return 'fit_below_threshold';
  const supported = supportedAuto instanceof Set
    ? supportedAuto.has(row.ats_platform)
    : (Array.isArray(supportedAuto) && supportedAuto.includes(row.ats_platform));
  if (!supported) return 'unsupported_ats_platform';
  return 'eligible';
}

// Pure post-SQL queue predicate extracted from auto_apply_queue.mjs. A candidate
// row passes when it is NOT an already-submitted company/title, NOT already seen
// in this queue pass, AND its derived role type is in the allowed targets.
// Behavior is verbatim with the prior inline loop guards; only the decision is
// relocated here. The queue still does the `seenKeys.add` bookkeeping and the
// MAX_ROWS cap around this check.
export function passesQueueFilters(row = {}, {
  roleTypes = [],
  submittedKeys = new Set(),
  seenKeys = new Set(),
} = {}) {
  const key = duplicateKey(row);
  if (submittedKeys.has(key)) return false;
  if (seenKeys.has(key)) return false;
  if (!roleTypes.includes(deriveRoleTypeFromJob(row))) return false;
  return true;
}
