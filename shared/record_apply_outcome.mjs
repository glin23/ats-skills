#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath, initDb } from './local_db.mjs';
import { normalizeCompany, normalizeTitle, SUBMITTED_STATUSES } from './job_identity.mjs';
import { onboardTmpPath } from './onboard_tmp.mjs';

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function usage() {
  console.error('usage: node shared/record_apply_outcome.mjs --row-id <id> --result-file <driver-output.log>');
  process.exit(2);
}

const rowId = Number(argValue('--row-id') || process.env.ROW_ID || 0);
const resultFile = argValue('--result-file');
if (!rowId || !resultFile) usage();

const MANUAL_REVIEW_PATH = onboardTmpPath('manual_or_unsupported.json');
const MANUAL_REVIEW_REASONS = new Set([
  'cover_letter_required_not_generated',
  'cover_letter_file_required',
  'cover_letter_generation_failed',
  'cover_letter_input_not_found',
  'cover_letter_upload_failed',
]);

function parseOutcome(text) {
  const parsed = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const jsonStart = line.indexOf('{');
    const jsonEnd = line.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) continue;
    try {
      const obj = JSON.parse(line.slice(jsonStart, jsonEnd + 1));
      if (obj && typeof obj === 'object') parsed.push(obj);
    } catch {
      // Driver logs include human-readable lines; ignore non-JSON output.
    }
  }
  return parsed.reverse().find((obj) => typeof obj.outcome === 'string') || null;
}

function compactDetail(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 600 ? `${text.slice(0, 597)}...` : text;
}

function appendManualReviewRow(reason, detail = outcome) {
  if (!MANUAL_REVIEW_REASONS.has(reason)) return;
  try {
    mkdirSync(dirname(MANUAL_REVIEW_PATH), { recursive: true });
    let existing = [];
    if (existsSync(MANUAL_REVIEW_PATH)) {
      const parsed = JSON.parse(readFileSync(MANUAL_REVIEW_PATH, 'utf8') || '[]');
      existing = Array.isArray(parsed) ? parsed : [];
    }
    const withoutDuplicate = existing.filter((item) => Number(item.row_id || item.id || 0) !== rowId);
    withoutDuplicate.push({
      row_id: rowId,
      id: rowId,
      company: row.company,
      title: row.title,
      reason,
      manual_apply_required: true,
      source: 'auto_apply_driver',
      detail,
      added_at: new Date().toISOString(),
    });
    writeFileSync(MANUAL_REVIEW_PATH, JSON.stringify(withoutDuplicate, null, 2));
  } catch {
    // The DB skip reason remains visible; the manual review file is best-effort.
  }
}

const output = readFileSync(resultFile, 'utf8');
const outcome = parseOutcome(output) || { outcome: 'skip', reason: 'driver_no_structured_outcome' };
initDb();
const db = new DatabaseSync(dbPath());
const row = db.prepare('SELECT id, company, title, status FROM jobs WHERE id = ?').get(rowId);
if (!row) {
  console.error(JSON.stringify({ ok: false, reason: 'row_not_found', row_id: rowId }));
  process.exit(1);
}

function writeFeedback(reason, detail = outcome) {
  try {
    db.prepare('INSERT INTO feedback(job_id, outcome, reason, detail) VALUES (?, ?, ?, ?)').run(
      rowId,
      outcome.outcome || 'unknown',
      reason,
      compactDetail(detail)
    );
  } catch {
    // The jobs table update is the source of truth; feedback insert is best-effort.
  }
}

function markSkipped(reason, detail = outcome, action = 'skipped') {
  if (SUBMITTED_STATUSES.has(row.status)) {
    writeFeedback('not_downgrading_submitted_row', { reason, detail, current_status: row.status });
    console.log(JSON.stringify({ ok: true, action: 'unchanged', row_id: rowId, status: row.status }));
    return;
  }
  db.prepare(`
    UPDATE jobs
       SET status = '⚠️ 跳过未投',
           skip_reason = ?,
           bot_note = 'mrweirdo auto-apply skipped after driver verification',
           auto_apply_eligible = 0,
           updated_at = datetime('now')
     WHERE id = ?
	  `).run(reason, rowId);
	  writeFeedback(reason, detail);
	  appendManualReviewRow(reason, detail);
	  console.log(JSON.stringify({ ok: true, action, row_id: rowId, reason }));
	}

if (outcome.outcome !== 'submitted') {
  if (outcome.outcome === 'essay_pending') {
    markSkipped('essay_pending_main_agent_required', outcome, 'essay_pending');
    process.exit(0);
  }
  markSkipped(outcome.reason || outcome.outcome || 'driver_not_submitted');
  process.exit(0);
}

const companyKey = normalizeCompany(row.company);
const titleKey = normalizeTitle(row.title);
const submittedDuplicate = db.prepare(`
  SELECT id, status, company, title
    FROM jobs
   WHERE id <> ?
     AND status IN (${[...SUBMITTED_STATUSES].map(() => '?').join(',')})
`).all(rowId, ...SUBMITTED_STATUSES)
  .find((r) => normalizeCompany(r.company) === companyKey && normalizeTitle(r.title) === titleKey);

if (submittedDuplicate) {
  markSkipped('duplicate_same_company_title_already_submitted', {
    submitted_row_id: submittedDuplicate.id,
    submitted_status: submittedDuplicate.status,
    driver_outcome: outcome,
  });
  process.exit(0);
}

if (row.status !== '🤖 AI sourced' && !SUBMITTED_STATUSES.has(row.status)) {
  markSkipped('row_status_changed_before_recording', { current_status: row.status, driver_outcome: outcome });
  process.exit(0);
}

db.prepare(`
  UPDATE jobs
     SET status = '✅ 已投',
         submitted_at = COALESCE(submitted_at, datetime('now')),
         auto_submitted_at = COALESCE(auto_submitted_at, datetime('now')),
         confirmation_url = COALESCE(?, confirmation_url),
         skip_reason = NULL,
         bot_note = 'mrweirdo auto-apply verified by driver success check',
         auto_apply_eligible = 0,
         updated_at = datetime('now')
   WHERE id = ?
`).run(outcome.post_url || outcome.url || null, rowId);
writeFeedback('submitted_verified', outcome);
console.log(JSON.stringify({
  ok: true,
  action: 'submitted',
  row_id: rowId,
  confirmation_url: outcome.post_url || outcome.url || null,
}));
