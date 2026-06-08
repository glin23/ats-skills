#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { atsHome } from './paths.mjs';
import { initDb, upsertJob } from './local_db.mjs';
import { classifyRoleType, roleTypesFromSearchIntent } from './role_types.mjs';
import { SUPPORTED_AUTO_PLATFORMS, platformFromUrl } from './sourcing/apply_url_classification.mjs';
import { hasUsableApplyUrl } from './sourcing/usable_apply_url.mjs';

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
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
const allowPartialScores = hasArg('--allow-partial-scores') || process.env.MRWEIRDO_ALLOW_PARTIAL_SCORES === '1';
const supportedAuto = new Set((argValue('--supported-auto', [...SUPPORTED_AUTO_PLATFORMS].join(',')) || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean));

initDb();

const candidates = readJson(toScorePath, []);
const scored = readJson(scoredPath, []);
if (!Array.isArray(candidates)) throw new Error(`${toScorePath} must contain a JSON array`);
if (!Array.isArray(scored)) throw new Error(`${scoredPath} must contain a JSON array`);

function rowUrl(row = {}) {
  return row.apply_url || row.url || '';
}

function hasCompleteScore(score = {}) {
  return typeof score.fit_score === 'number' && Number.isFinite(score.fit_score) &&
    typeof score.recommended === 'boolean' &&
    typeof score.role_type_match === 'string' &&
    score.role_type_match.length > 0;
}

const byUrl = new Map(scored
  .map((s) => [rowUrl(s), s])
  .filter(([url]) => Boolean(url)));
const companyList = readJson(quotaPath, { companies: [] }) || { companies: [] };
const cappedNames = new Set();
for (const c of (companyList.companies || [])) {
  if (c?.apply_quota?.enabled && c.name) cappedNames.add(String(c.name).toLowerCase());
}

const intentDoc = readJson(path.join(HOME, 'search_intent.json'), { search_intent: { seniority: 'intern' } });
const wantedRoleTypes = new Set(roleTypesFromSearchIntent(intentDoc.search_intent || intentDoc || {}));

const usableCandidates = candidates.filter((job) => hasUsableApplyUrl(job));
const scoreMissing = usableCandidates
  .filter((job) => !hasCompleteScore(byUrl.get(rowUrl(job))))
  .map((job) => ({
    company: job.company || '(unknown)',
    title: job.title || '(untitled)',
    apply_url: rowUrl(job),
  }));

const summary = {
  run_id: runId,
  threshold,
  candidate_count: candidates.length,
  scored_count: scored.length,
  usable_candidate_count: usableCandidates.length,
  score_missing_count: scoreMissing.length,
  score_coverage: usableCandidates.length
    ? Number(((usableCandidates.length - scoreMissing.length) / usableCandidates.length).toFixed(4))
    : 1,
  allow_partial_scores: allowPartialScores,
  missing_score_examples: scoreMissing.slice(0, 5),
  stored: 0,
  eligible: 0,
  by_platform: {},
  by_ineligible_reason: {},
  skipped_unusable_apply_url: 0,
};

if (scoreMissing.length > 0 && !allowPartialScores) {
  const message = [
    `Refusing to store partial scoring: ${scoreMissing.length} of ${usableCandidates.length} usable candidates have no complete score.`,
    `Score every row in ${toScorePath} and write complete results to ${scoredPath}.`,
    'For a deliberate debug-only run, pass --allow-partial-scores or set MRWEIRDO_ALLOW_PARTIAL_SCORES=1.',
  ].join(' ');
  console.error(JSON.stringify({ ok: false, error: message, ...summary }, null, 2));
  process.exit(1);
}

function bump(obj, key) {
  const k = String(key || 'unknown');
  obj[k] = (obj[k] || 0) + 1;
}

for (const job of candidates) {
  if (!hasUsableApplyUrl(job)) {
    summary.skipped_unusable_apply_url += 1;
    continue;
  }
  // hasUsableApplyUrl() accepts a row whose only URL is `url` (no `apply_url`),
  // so resolve the apply URL the same way to avoid upsertJob's "apply_url required".
  const applyUrl = rowUrl(job);
  const score = byUrl.get(applyUrl) || {};
  const platform = platformFromUrl(applyUrl);
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
    apply_url: applyUrl,
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
