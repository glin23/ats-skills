#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './local_db.mjs';
import { atsHome } from './paths.mjs';
import { deriveRoleTypeFromJob, normalizeRoleType, roleTypesFromSearchIntent } from './role_types.mjs';
import { normalizeCompany, normalizeTitle } from './job_identity.mjs';

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

const rowId = Number(argValue('--row-id') || process.env.ROW_ID || 0);
if (!rowId) {
  console.error('missing_row_id');
  process.exit(2);
}

const home = atsHome();
let intent = { search_intent: { seniority: 'intern' } };
try {
  intent = JSON.parse(fs.readFileSync(path.join(home, 'search_intent.json'), 'utf8'));
} catch (_) {
  // Fall back to internship-only rather than widening the gate.
}

const allowedRoleTypes = roleTypesFromSearchIntent(intent.search_intent || {});
const minFit = Math.max(0, Number(process.env.MRWEIRDO_MIN_FIT_SCORE || 5));
const db = new DatabaseSync(dbPath());
const row = db.prepare(`
  SELECT id, company, title, apply_url, ats_platform, fit_score, role_type_match,
         status, auto_apply_eligible, apply_quota_limit
    FROM jobs
   WHERE id = ?
`).get(rowId);

function fail(reason, detail = {}) {
  console.error(JSON.stringify({ ok: false, reason, row_id: rowId, allowed_role_types: allowedRoleTypes, ...detail }));
  process.exit(1);
}

if (!row) fail('row_not_found');
if (row.status !== '🤖 AI sourced') fail('row_status_not_pending', { status: row.status });
if (!['greenhouse', 'ashby'].includes(row.ats_platform)) fail('unsupported_ats_platform', { ats_platform: row.ats_platform });
if (row.apply_quota_limit != null) fail('quota_guarded_row', { apply_quota_limit: row.apply_quota_limit });
if ((row.fit_score ?? 0) < minFit) fail('fit_below_threshold', { fit_score: row.fit_score, min_fit: minFit });
const storedRoleType = normalizeRoleType(row.role_type_match);
const recheckedRoleType = deriveRoleTypeFromJob(row);
if (storedRoleType && !allowedRoleTypes.includes(storedRoleType)) {
  fail('role_type_not_allowed', { role_type_match: row.role_type_match, rechecked_role_type: recheckedRoleType });
}
if (!allowedRoleTypes.includes(recheckedRoleType)) {
  fail('role_type_recheck_failed', { role_type_match: row.role_type_match, rechecked_role_type: recheckedRoleType });
}

const companyKey = normalizeCompany(row.company);
const titleKey = normalizeTitle(row.title);
const submitted = db.prepare(`
  SELECT id, status, company, title
    FROM jobs
   WHERE id <> ?
     AND status IN ('✅ 已投', '✅ 已确认')
`).all(row.id).find((r) => normalizeCompany(r.company) === companyKey && normalizeTitle(r.title) === titleKey);

if (submitted) {
  fail('duplicate_same_company_title_already_submitted', {
    submitted_row_id: submitted.id,
    submitted_status: submitted.status,
  });
}

console.log(JSON.stringify({ ok: true, allowed_role_types: allowedRoleTypes, row }));
