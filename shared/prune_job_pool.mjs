#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './local_db.mjs';
import { SUBMITTED_STATUSES } from './job_identity.mjs';
import { hasUsableApplyUrl } from './sourcing/usable_apply_url.mjs';
import { SUPPORTED_AUTO_PLATFORMS } from './sourcing/apply_url_classification.mjs';

const PENDING_STATUS = '🤖 AI sourced';
const SKIPPED_STATUS = '⚠️ 跳过未投';
const SUPPORTED_AUTO = new Set(SUPPORTED_AUTO_PLATFORMS);

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function daysAgo(days) {
  return Date.now() - Number(days) * 86400 * 1000;
}

function parseDate(value) {
  if (!value) return 0;
  const normalized = String(value).includes('T') ? String(value) : String(value).replace(' ', 'T') + 'Z';
  const n = Date.parse(normalized);
  return Number.isFinite(n) ? n : 0;
}

function addReason(map, row, reason) {
  if (SUBMITTED_STATUSES.has(row.status)) return;
  const existing = map.get(row.id);
  if (existing) {
    existing.reasons.push(reason);
    return;
  }
  map.set(row.id, {
    id: row.id,
    company: row.company,
    title: row.title,
    status: row.status,
    fit_score: row.fit_score,
    ats_platform: row.ats_platform,
    skip_reason: row.skip_reason,
    last_seen_at: row.last_seen_at,
    discovery_run_id: row.discovery_run_id,
    reasons: [reason],
  });
}

function usage() {
  console.log(`Usage:
  node shared/prune_job_pool.mjs [options]

Options:
  --apply                     Actually delete rows. Without it, dry-run only.
  --json                      Print machine-readable JSON.
  --run-id <id>               Current discovery run id. Used to detect stale rows.
  --delete-stale              Delete pending rows not seen in the current run after --stale-days.
  --stale-days <n>            Default 30.
  --delete-low-fit            Delete pending rows below --min-fit after --low-fit-days.
  --low-fit-days <n>          Default 7.
  --delete-unsupported        Delete pending fit>=min rows on unsupported ATS after --unsupported-days.
  --unsupported-days <n>      Default 14.
  --delete-skipped            Delete skipped rows after --skipped-days.
  --skipped-days <n>          Default 7. Use 0 to delete skipped rows immediately.
  --delete-unusable-url       Delete non-submitted rows whose apply_url is not a real http(s) URL.
  --retry-limit <n>           Delete non-submitted rows with >= n skip/error feedback records. Default 3.
  --min-fit <n>               Default MRWEIRDO_MIN_FIT_SCORE or 5.
`);
}

if (hasArg('--help') || hasArg('-h')) {
  usage();
  process.exit(0);
}

const apply = hasArg('--apply');
const json = hasArg('--json');
const runId = argValue('--run-id', process.env.RUN_ID || null);
const minFit = Number(argValue('--min-fit', process.env.MRWEIRDO_MIN_FIT_SCORE || '5'));
const retryLimit = Math.max(1, Number(argValue('--retry-limit', '3')));

const opts = {
  deleteStale: hasArg('--delete-stale'),
  staleDays: Number(argValue('--stale-days', '30')),
  deleteLowFit: hasArg('--delete-low-fit'),
  lowFitDays: Number(argValue('--low-fit-days', '7')),
  deleteUnsupported: hasArg('--delete-unsupported'),
  unsupportedDays: Number(argValue('--unsupported-days', '14')),
  deleteSkipped: hasArg('--delete-skipped'),
  skippedDays: Number(argValue('--skipped-days', '7')),
  deleteUnusableUrl: hasArg('--delete-unusable-url'),
};

const db = new DatabaseSync(dbPath());
const rows = db.prepare(`
  SELECT id, company, title, apply_url, status, fit_score, ats_platform,
         skip_reason, discovery_run_id, created_at, updated_at,
         first_seen_at, last_seen_at, seen_count
    FROM jobs
`).all();

const feedbackCounts = new Map(
  db.prepare(`
    SELECT job_id, COUNT(*) AS n
      FROM feedback
     WHERE outcome IN ('skip', 'error', 'failed')
       AND job_id IS NOT NULL
     GROUP BY job_id
  `).all().map((r) => [r.job_id, Number(r.n || 0)])
);

const deletions = new Map();
const now = Date.now();
const staleCutoff = daysAgo(opts.staleDays);
const lowFitCutoff = daysAgo(opts.lowFitDays);
const unsupportedCutoff = daysAgo(opts.unsupportedDays);
const skippedCutoff = daysAgo(opts.skippedDays);

for (const row of rows) {
  if (SUBMITTED_STATUSES.has(row.status)) continue;

  const lastSeen = parseDate(row.last_seen_at || row.updated_at || row.created_at);
  const updated = parseDate(row.updated_at || row.last_seen_at || row.created_at);
  const feedbackSkips = feedbackCounts.get(row.id) || 0;

  if (opts.deleteUnusableUrl && !hasUsableApplyUrl(row.apply_url)) {
    addReason(deletions, row, 'unusable_apply_url');
  }

  if (feedbackSkips >= retryLimit) {
    addReason(deletions, row, `retry_exhausted_${feedbackSkips}`);
  }

  if (
    opts.deleteStale &&
    row.status === PENDING_STATUS &&
    runId &&
    row.discovery_run_id !== runId &&
    lastSeen > 0 &&
    lastSeen <= staleCutoff
  ) {
    addReason(deletions, row, `stale_not_seen_in_current_run_${opts.staleDays}d`);
  }

  if (
    opts.deleteLowFit &&
    row.status === PENDING_STATUS &&
    row.fit_score !== null &&
    Number(row.fit_score) < minFit &&
    lastSeen > 0 &&
    lastSeen <= lowFitCutoff
  ) {
    addReason(deletions, row, `low_fit_below_${minFit}_${opts.lowFitDays}d`);
  }

  if (
    opts.deleteUnsupported &&
    row.status === PENDING_STATUS &&
    Number(row.fit_score || 0) >= minFit &&
    row.ats_platform &&
    !SUPPORTED_AUTO.has(String(row.ats_platform).toLowerCase()) &&
    lastSeen > 0 &&
    lastSeen <= unsupportedCutoff
  ) {
    addReason(deletions, row, `unsupported_ats_${opts.unsupportedDays}d`);
  }

  if (
    opts.deleteSkipped &&
    row.status === SKIPPED_STATUS &&
    updated > 0 &&
    updated <= skippedCutoff
  ) {
    addReason(deletions, row, `skipped_${opts.skippedDays}d`);
  }
}

const victims = [...deletions.values()].sort((a, b) => a.id - b.id);
const byReason = {};
for (const row of victims) {
  for (const reason of row.reasons) byReason[reason] = (byReason[reason] || 0) + 1;
}

if (apply && victims.length) {
  db.exec('BEGIN');
  try {
    const del = db.prepare(`DELETE FROM jobs WHERE id = ? AND status NOT IN (${[...SUBMITTED_STATUSES].map(() => '?').join(',')})`);
    for (const row of victims) del.run(row.id, ...SUBMITTED_STATUSES);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const summary = {
  apply,
  db_path: dbPath(),
  run_id: runId,
  min_fit: minFit,
  retry_limit: retryLimit,
  options: opts,
  scanned: rows.length,
  delete_count: victims.length,
  by_reason: byReason,
  examples: victims.slice(0, 20),
  generated_at: new Date(now).toISOString(),
};

if (json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`${apply ? 'deleted' : 'would delete'} ${victims.length} rows from ${dbPath()}`);
  for (const [reason, count] of Object.entries(byReason)) {
    console.log(`- ${reason}: ${count}`);
  }
  if (victims.length) {
    console.log('examples:');
    for (const row of victims.slice(0, 20)) {
      console.log(`- #${row.id} ${row.company} — ${row.title} (${row.reasons.join(', ')})`);
    }
  }
}
