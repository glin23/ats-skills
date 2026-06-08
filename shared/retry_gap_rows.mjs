#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './local_db.mjs';

const DEFAULT_GAP_REPORT = '/tmp/mrweirdo-onboard/apply-gap-report.json';

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function usage() {
  console.error(`usage:
  node shared/retry_gap_rows.mjs --gap-report /tmp/mrweirdo-onboard/apply-gap-report.json
  node shared/retry_gap_rows.mjs --apply --max 10

Requeues skipped rows from the latest missing-info report after the agent has
updated profile.json / answer templates from the user's answers.
`);
  process.exit(2);
}

if (hasArg('--help') || hasArg('-h')) usage();

const apply = hasArg('--apply');
const gapReportPath = argValue('--gap-report', DEFAULT_GAP_REPORT);
const maxRows = Math.max(0, Number(argValue('--max', '0') || 0));
const categoryFilter = new Set(compact(argValue('--categories', ''))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean));

if (!fs.existsSync(gapReportPath)) {
  console.error(`[retry-gap-rows] missing gap report: ${gapReportPath}`);
  process.exit(1);
}
if (!fs.existsSync(dbPath())) {
  console.error(`[retry-gap-rows] missing local DB: ${dbPath()}`);
  process.exit(1);
}

const report = readJson(gapReportPath);
const rawCandidates = Array.isArray(report.retry_candidates) ? report.retry_candidates : [];
let candidates = rawCandidates
  .filter((row) => Number(row.row_id || 0) > 0)
  .filter((row) => {
    if (!categoryFilter.size) return true;
    return (row.categories || []).some((category) => categoryFilter.has(category));
  });
if (maxRows > 0) candidates = candidates.slice(0, maxRows);

const db = new DatabaseSync(dbPath());
const byId = new Map();
for (const candidate of candidates) {
  byId.set(Number(candidate.row_id), candidate);
}

const outcomes = [];
const select = db.prepare(`
  SELECT id, company, title, status, auto_apply_eligible, submitted_at, auto_submitted_at
    FROM jobs
   WHERE id = ?
`);

for (const [rowId, candidate] of byId) {
  const row = select.get(rowId);
  if (!row) {
    outcomes.push({ row_id: rowId, action: 'missing_db_row', categories: candidate.categories || [] });
    continue;
  }
  if (row.submitted_at || row.auto_submitted_at || row.status === '✅ 已投' || row.status === '✅ 已确认') {
    outcomes.push({
      row_id: rowId,
      company: row.company,
      title: row.title,
      status: row.status,
      action: 'already_submitted',
      categories: candidate.categories || [],
    });
    continue;
  }
  if (row.status === '🤖 AI sourced' && Number(row.auto_apply_eligible || 0) === 1) {
    outcomes.push({
      row_id: rowId,
      company: row.company,
      title: row.title,
      status: row.status,
      action: 'already_pending',
      categories: candidate.categories || [],
    });
    continue;
  }
  if (row.status !== '⚠️ 跳过未投' && row.status !== '🤖 AI sourced') {
    outcomes.push({
      row_id: rowId,
      company: row.company,
      title: row.title,
      status: row.status,
      action: 'not_requeued_status_guard',
      categories: candidate.categories || [],
    });
    continue;
  }
  outcomes.push({
    row_id: rowId,
    company: row.company,
    title: row.title,
    status: row.status,
    action: apply ? 'requeued' : 'would_requeue',
    categories: candidate.categories || [],
  });
}

if (apply) {
  const toRequeue = outcomes.filter((row) => row.action === 'requeued');
  db.exec('BEGIN');
  try {
    const update = db.prepare(`
      UPDATE jobs
         SET status = '🤖 AI sourced',
             skip_reason = NULL,
             user_note = NULL,
             bot_note = 'mrweirdo retry queued after missing-info follow-up',
             auto_apply_eligible = 1,
             updated_at = datetime('now')
       WHERE id = ?
         AND status IN ('⚠️ 跳过未投', '🤖 AI sourced')
         AND submitted_at IS NULL
         AND auto_submitted_at IS NULL
    `);
    const feedback = db.prepare(`
      INSERT INTO feedback(job_id, outcome, reason, detail)
      VALUES (?, 'requeued', 'missing_info_followup_answered', ?)
    `);
    for (const row of toRequeue) {
      update.run(row.row_id);
      feedback.run(row.row_id, JSON.stringify({
        gap_report: path.basename(gapReportPath),
        categories: row.categories,
      }));
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const summary = {
  ok: true,
  apply,
  gap_report: gapReportPath,
  scanned_candidates: rawCandidates.length,
  selected_candidates: candidates.length,
  requeued: outcomes.filter((row) => row.action === 'requeued').length,
  would_requeue: outcomes.filter((row) => row.action === 'would_requeue').length,
  already_pending: outcomes.filter((row) => row.action === 'already_pending').length,
  already_submitted: outcomes.filter((row) => row.action === 'already_submitted').length,
  guarded: outcomes.filter((row) => row.action === 'not_requeued_status_guard').length,
  missing_db_rows: outcomes.filter((row) => row.action === 'missing_db_row').length,
};

console.log(JSON.stringify({ summary, rows: outcomes }, null, 2));
