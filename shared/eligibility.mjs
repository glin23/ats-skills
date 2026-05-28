// Pure auto-apply eligibility decision, extracted from
// recompute_auto_apply_eligibility.mjs so the full-time-leak gate can be
// unit-tested without a SQLite database. Behavior is verbatim with the prior
// inline `eligibleReason`; only the side-effecting DB/CLI wrapper stays in the
// script.
import { normalizeCompany, normalizeTitle } from './job_identity.mjs';

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
