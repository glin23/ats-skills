// Pure auto-apply eligibility decision, extracted from
// recompute_auto_apply_eligibility.mjs so the full-time-leak gate can be
// unit-tested without a SQLite database. Behavior is verbatim with the prior
// inline `eligibleReason`; only the side-effecting DB/CLI wrapper stays in the
// script.
import { normalizeCompany, normalizeTitle } from './job_identity.mjs';
import { deriveRoleTypeFromJob } from './role_types.mjs';
import { SUPPORTED_AUTO_PLATFORMS } from './sourcing/apply_url_classification.mjs';
import { BLOCKING_LEGITIMACY, BLOCKING_LIVENESS } from './constants.mjs';

export const DEFAULT_SUPPORTED_AUTO = new Set(SUPPORTED_AUTO_PLATFORMS);

export function duplicateKey(row = {}) {
  return `${normalizeCompany(row.company)}::${normalizeTitle(row.title)}`;
}

function compact(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function currentYear(now = new Date()) {
  const y = now instanceof Date ? now.getUTCFullYear() : Number(now);
  return Number.isFinite(y) ? y : new Date().getUTCFullYear();
}

function isStudentRoleTitle(title = '') {
  return /\b(intern|internship|co[-\s]?op|working student|student assistant|summer|fall|spring)\b/i.test(String(title || ''));
}

function expiredStudentRoleYear(title = '', now = new Date()) {
  if (!isStudentRoleTitle(title)) return null;
  const year = currentYear(now);
  const years = [...String(title || '').matchAll(/\b20\d{2}\b/g)]
    .map((m) => Number(m[0]))
    .filter((n) => Number.isFinite(n));
  const expired = years.filter((n) => n < year).sort((a, b) => a - b)[0];
  return expired || null;
}

// Rows like Greenhouse's "examplecorpsandbox" are live-submit test tenants.
// They can look valid to the ATS driver, so keep this guard near eligibility.
export function unusableAutoApplyReason(row = {}, { now = new Date() } = {}) {
  const companyCompact = compact(row.company);
  const urlCompact = compact(row.apply_url || row.url);
  const joinedCompact = `${companyCompact} ${urlCompact}`;
  const joinedText = `${row.company || ''} ${row.title || ''} ${row.apply_url || row.url || ''}`.toLowerCase();

  if (/(examplecorp|examplecompany|samplecompany|democompany|testcompany)/.test(joinedCompact)) {
    return 'test_or_sandbox_posting';
  }
  if (/(example.*sandbox|sandbox.*example|test.*sandbox|sandbox.*test)/.test(joinedCompact)) {
    return 'test_or_sandbox_posting';
  }
  if (/\b(example|sample|demo|test)\s+(job|posting|requisition|application)\b/i.test(joinedText)) {
    return 'test_or_sandbox_posting';
  }

  const expiredYear = expiredStudentRoleYear(row.title, now);
  if (expiredYear) return 'expired_title_year';

  return null;
}

export function legitimacyBlockReason(row = {}) {
  const value = String(row.legitimacy || '').trim().toLowerCase();
  if (BLOCKING_LEGITIMACY.has(value)) return `legitimacy_${value}`;
  return null;
}

export function livenessBlockReason(row = {}) {
  const value = String(row.liveness_status || '').trim().toLowerCase();
  if (BLOCKING_LIVENESS.has(value)) return `liveness_${value}`;
  return null;
}

// Returns one of:
//   'not_pending' | 'quota_guarded'
//   | 'liveness_expired' | 'legitimacy_suspicious'
//   | 'duplicate_same_company_title_already_submitted'
//   | 'test_or_sandbox_posting' | 'expired_title_year' | 'not_recommended'
//   | 'role_type_not_allowed' | 'fit_below_threshold'
//   | 'unsupported_ats_platform' | 'eligible'
// Order matters — the first failing guard wins (matches the original).
export function eligibleReason(row = {}, {
  roleType,
  allowedRoleTypes = ['intern', 'part_time'],
  submittedKeys = new Set(),
  minFit = 5,
  supportedAuto = DEFAULT_SUPPORTED_AUTO,
  now = new Date(),
} = {}) {
  if (row.status !== '🤖 AI sourced') return 'not_pending';
  if (row.apply_quota_limit != null) return 'quota_guarded';
  const livenessReason = livenessBlockReason(row);
  if (livenessReason) return livenessReason;
  const legitimacyReason = legitimacyBlockReason(row);
  if (legitimacyReason) return legitimacyReason;
  const unusableReason = unusableAutoApplyReason(row, { now });
  if (unusableReason) return unusableReason;
  if (submittedKeys.has(duplicateKey(row))) return 'duplicate_same_company_title_already_submitted';
  if (row.recommended === 0 || row.recommended === false) return 'not_recommended';
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
  now = new Date(),
} = {}) {
  const key = duplicateKey(row);
  if (livenessBlockReason(row)) return false;
  if (legitimacyBlockReason(row)) return false;
  if (unusableAutoApplyReason(row, { now })) return false;
  if (submittedKeys.has(key)) return false;
  if (seenKeys.has(key)) return false;
  if (!roleTypes.includes(deriveRoleTypeFromJob(row))) return false;
  return true;
}
