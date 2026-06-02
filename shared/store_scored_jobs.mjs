#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { atsHome } from './paths.mjs';
import { initDb, upsertJob } from './local_db.mjs';
import { classifyRoleType, roleTypesFromSearchIntent } from './role_types.mjs';
import { platformFromUrl } from './sourcing/apply_url_classification.mjs';
import { hasUsableApplyUrl } from './sourcing/usable_apply_url.mjs';

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const HOME = atsHome();
const runId = argValue('--run-id', process.env.RUN_ID || `run-${new Date().toISOString()}`);
const threshold = Math.max(0, Number(argValue('--threshold', process.env.MRWEIRDO_MIN_FIT_SCORE || '5')));
const toScorePath = argValue('--to-score', '/tmp/mrweirdo-onboard/to_score.json');
const scoredPath = argValue('--scored', '/tmp/mrweirdo-onboard/scored.json');
const quotaPath = argValue('--company-list', path.join(HOME, 'company_list.user.json'));
const supportedAuto = new Set((argValue('--supported-auto', 'greenhouse,ashby') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean));

initDb();

const candidates = readJson(toScorePath, []);
const scored = readJson(scoredPath, []);
if (!Array.isArray(candidates)) throw new Error(`${toScorePath} must contain a JSON array`);
if (!Array.isArray(scored)) throw new Error(`${scoredPath} must contain a JSON array`);

const byUrl = new Map(scored.map((s) => [s.apply_url, s]));
const companyList = readJson(quotaPath, { companies: [] }) || { companies: [] };
const cappedNames = new Set();
for (const c of (companyList.companies || [])) {
  if (c?.apply_quota?.enabled && c.name) cappedNames.add(String(c.name).toLowerCase());
}

const intentDoc = readJson(path.join(HOME, 'search_intent.json'), { search_intent: { seniority: 'intern' } });
const wantedRoleTypes = new Set(roleTypesFromSearchIntent(intentDoc.search_intent || intentDoc || {}));

const summary = {
  run_id: runId,
  threshold,
  candidate_count: candidates.length,
  scored_count: scored.length,
  stored: 0,
  eligible: 0,
  by_platform: {},
  by_ineligible_reason: {},
  skipped_unusable_apply_url: 0,
};

function bump(obj, key) {
  const k = String(key || 'unknown');
  obj[k] = (obj[k] || 0) + 1;
}

for (const job of candidates) {
  if (!hasUsableApplyUrl(job)) {
    summary.skipped_unusable_apply_url += 1;
    continue;
  }
  const score = byUrl.get(job.apply_url) || {};
  const platform = platformFromUrl(job.apply_url);
  const capped = cappedNames.has(String(job.company || '').toLowerCase());
  const storedRoleType = score.role_type_match || job.role_type || 'other';
  const recheckedRoleType = classifyRoleType(job);
  const roleType = wantedRoleTypes.has(recheckedRoleType) ? recheckedRoleType : storedRoleType;
  const passThreshold = (score.fit_score ?? 0) >= threshold;
  const recommended = score.recommended === true;
  const roleOk = wantedRoleTypes.has(storedRoleType) && wantedRoleTypes.has(recheckedRoleType);
  const platformOk = supportedAuto.has(platform);
  const eligible = passThreshold && recommended && roleOk && !capped && platformOk;

  let reason = 'eligible';
  if (!passThreshold) reason = 'fit_below_threshold';
  else if (!recommended) reason = 'not_recommended';
  else if (!roleOk) reason = 'role_type_not_allowed';
  else if (capped) reason = 'quota_guarded';
  else if (!platformOk) reason = 'unsupported_ats_platform';

  const row = {
    company: job.company || '(unknown)',
    title: job.title,
    apply_url: job.apply_url,
    location: job.location,
    source: job.source || job._discovery_source || 'unknown',
    status: '🤖 AI sourced',
    fit_score: score.fit_score ?? null,
    key_gaps: Array.isArray(score.key_gaps) ? score.key_gaps.join(' / ') : null,
    role_type_match: roleType,
    dim_scores: score.dim_scores || null,
    ats_platform: platform,
    apply_quota_limit: capped ? 1 : null,
    scored: score.fit_score != null ? 1 : 0,
    auto_apply_eligible: eligible ? 1 : 0,
    search_source: job._discovery_source || job.search_source || job.source || 'unknown',
    discovery_run_id: runId,
    user_note: score.honest_reason || null,
  };

  const result = upsertJob(row);
  if (!result.ok) throw new Error(result.error);
  summary.stored += 1;
  if (eligible) summary.eligible += 1;
  bump(summary.by_platform, platform);
  if (!eligible) bump(summary.by_ineligible_reason, reason);
}

console.log(JSON.stringify(summary, null, 2));
