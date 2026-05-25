// local_db.mjs — SQLite-backed job tracker for ats-skills v1.1
// Uses Node 24+ built-in `node:sqlite` (experimental — pass --no-warnings to silence).
// File location: ~/.mrweirdo-jobs/jobs.db (overridable via MRWEIRDO_DB_PATH env).
//
// API surface mirrors the v1.0 notion_sync.mjs so /ats-source, /ats-skills,
// /ats-confirm can swap import paths with minimal flow changes:
//
//   upsertJob(job)            -> {ok, page_id, created|updated}
//   batchUpsert(jobs)         -> [results]
//   markApplied(id, info)     -> {ok}
//   markSkipped(id, reason, note)
//   markConfirmed(id, info)
//   queryApprovedView()       -> rows[]
//   queryAiSourcedPending()   -> rows[]
//   queryRecentlyApplied(days)
//
// Schema lives in-file (idempotent CREATE TABLE IF NOT EXISTS). First call
// to initDb() runs schema; later calls are no-ops.

import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { atsHome } from './paths.mjs';

export const dbPath = () => process.env.MRWEIRDO_DB_PATH || join(atsHome(), 'jobs.db');

let _db = null;

function ensureDir(p) {
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function db() {
  if (_db) return _db;
  const p = dbPath();
  ensureDir(p);
  _db = new DatabaseSync(p);
  initSchema(_db);
  return _db;
}

function initSchema(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      title TEXT,
      apply_url TEXT UNIQUE NOT NULL,
      location TEXT,
      source TEXT,
      status TEXT NOT NULL DEFAULT '🤖 AI sourced',

      fit_score INTEGER,
      key_gaps TEXT,
      role_type_match TEXT,
      skip_reason TEXT,
      user_note TEXT,
      dim_scores TEXT,

      salary_min REAL,
      salary_max REAL,
      salary_currency TEXT,
      salary_interval TEXT,
      hourly_rate REAL,
      ats_platform TEXT,

      apply_quota_limit INTEGER,
      apply_quota_period TEXT,
      apply_quota_note TEXT,

      submitted_at TEXT,
      confirmed_at TEXT,
      confirmation_email_id TEXT,
      confirmation_url TEXT,
      bot_note TEXT,

      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
    CREATE INDEX IF NOT EXISTS idx_jobs_submitted_at ON jobs(submitted_at);

    -- Datasette-friendly views
    CREATE VIEW IF NOT EXISTS v_ai_sourced AS
      SELECT * FROM jobs WHERE status = '🤖 AI sourced' ORDER BY fit_score DESC, updated_at DESC;
    CREATE VIEW IF NOT EXISTS v_approved AS
      SELECT * FROM jobs WHERE status = '✅ Approved' ORDER BY fit_score DESC;
    CREATE VIEW IF NOT EXISTS v_submitted AS
      SELECT * FROM jobs WHERE status IN ('✅ 已投', '✅ 已确认') ORDER BY submitted_at DESC;
    CREATE VIEW IF NOT EXISTS v_skipped AS
      SELECT * FROM jobs WHERE status IN ('⚠️ 跳过未投', '❌ Rejected') ORDER BY updated_at DESC;
    CREATE VIEW IF NOT EXISTS v_large_company_pending AS
      SELECT * FROM jobs
       WHERE apply_quota_limit IS NOT NULL
         AND apply_quota_limit > 0
         AND status = '🤖 AI sourced'
       ORDER BY fit_score DESC;

    -- per-apply feedback log (mirror of feedback.jsonl, queryable in Datasette)
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      outcome TEXT,
      reason TEXT,
      detail TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_job_id ON feedback(job_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_ts ON feedback(ts);
  `);
}

// Public initializer (no-op if already initialized via lazy db()).
export function initDb() {
  db();
  return { ok: true, path: dbPath() };
}

// Convert a JS object to {keys, placeholders, values} for INSERT/UPDATE.
function _bindable(obj) {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  const values = keys.map((k) => {
    const v = obj[k];
    if (v === null) return null;
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  });
  return { keys, values };
}

// ---------- upsert ----------

const UPSERT_COLUMNS = [
  'company', 'title', 'apply_url', 'location', 'source', 'status',
  'fit_score', 'key_gaps', 'role_type_match', 'skip_reason', 'user_note',
  'dim_scores', 'salary_min', 'salary_max', 'salary_currency',
  'salary_interval', 'hourly_rate', 'ats_platform',
  'apply_quota_limit', 'apply_quota_period', 'apply_quota_note',
];

function buildUpsertParams(job) {
  const params = {};
  for (const col of UPSERT_COLUMNS) {
    if (job[col] !== undefined) params[col] = job[col];
  }
  // dim_scores may come in as object — stringify
  if (params.dim_scores && typeof params.dim_scores === 'object') {
    params.dim_scores = JSON.stringify(params.dim_scores);
  }
  return params;
}

export function upsertJob(job) {
  if (!job?.apply_url) return { ok: false, error: 'apply_url required' };
  if (!job?.company) return { ok: false, error: 'company required' };
  const params = buildUpsertParams(job);
  // status only set on insert; updates preserve existing user-curated status
  // unless explicitly overridden via job.force_status.
  const insertCols = Object.keys(params);
  const insertPlaceholders = insertCols.map((c) => `:${c}`).join(', ');
  // For ON CONFLICT update, refresh fit_score and AI-derived fields,
  // but NEVER overwrite status/user_note/skip_reason (user owns those).
  const updateCols = insertCols.filter(
    (c) => !['status', 'user_note', 'skip_reason'].includes(c)
  );
  const updateClause = updateCols.map((c) => `${c} = excluded.${c}`).join(', ');
  const updatedAtClause = ", updated_at = datetime('now')";
  const sql = `
    INSERT INTO jobs (${insertCols.join(', ')})
    VALUES (${insertPlaceholders})
    ON CONFLICT(apply_url) DO UPDATE SET
      ${updateClause}${updatedAtClause}
    RETURNING id, (created_at = updated_at) AS created
  `;
  try {
    const stmt = db().prepare(sql);
    const result = stmt.get(params);
    return { ok: true, page_id: result.id, created: !!result.created };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function batchUpsert(jobs, { concurrency: _concurrency = 1 } = {}) {
  // SQLite is fast enough for serial execution; ignore concurrency param.
  // Wrap in a transaction for atomicity + perf.
  const d = db();
  d.exec('BEGIN');
  const results = [];
  try {
    for (const job of jobs) {
      results.push(upsertJob(job));
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return results;
}

// ---------- mark transitions ----------

export function markApplied(jobId, info = {}) {
  if (!jobId) return { ok: false, error: 'jobId required' };
  const params = {
    id: jobId,
    submitted_at: info.submitted_at || new Date().toISOString(),
    confirmation_url: info.confirmation_url || null,
    bot_note: info.bot_note || null,
  };
  try {
    const stmt = db().prepare(`
      UPDATE jobs
         SET status = '✅ 已投',
             submitted_at = :submitted_at,
             confirmation_url = COALESCE(:confirmation_url, confirmation_url),
             bot_note = COALESCE(:bot_note, bot_note),
             updated_at = datetime('now')
       WHERE id = :id
    `);
    stmt.run(params);
    return { ok: true, page_id: jobId };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function markSkipped(jobId, reason, userNote = '') {
  if (!jobId) return { ok: false, error: 'jobId required' };
  try {
    const stmt = db().prepare(`
      UPDATE jobs
         SET status = '⚠️ 跳过未投',
             skip_reason = :reason,
             user_note = :note,
             updated_at = datetime('now')
       WHERE id = :id
    `);
    stmt.run({ id: jobId, reason: reason || null, note: userNote || null });
    return { ok: true, page_id: jobId };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function markConfirmed(jobId, info = {}) {
  if (!jobId) return { ok: false, error: 'jobId required' };
  try {
    const stmt = db().prepare(`
      UPDATE jobs
         SET status = '✅ 已确认',
             confirmed_at = :confirmed_at,
             confirmation_email_id = COALESCE(:email_id, confirmation_email_id),
             updated_at = datetime('now')
       WHERE id = :id
    `);
    stmt.run({
      id: jobId,
      confirmed_at: info.confirmed_at || new Date().toISOString(),
      email_id: info.email_id || null,
    });
    return { ok: true, page_id: jobId };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------- queries ----------

function _rowToJob(row) {
  if (!row) return null;
  const out = { ...row, page_id: row.id };
  // dim_scores stored as JSON string — parse for caller convenience
  if (out.dim_scores) {
    try {
      out.dim_scores = JSON.parse(out.dim_scores);
    } catch {
      /* leave as string */
    }
  }
  return out;
}

export function queryByStatus(status) {
  const stmt = db().prepare(
    `SELECT * FROM jobs WHERE status = :status ORDER BY fit_score DESC, updated_at DESC`
  );
  return stmt.all({ status }).map(_rowToJob);
}

export function queryApprovedView() {
  return queryByStatus('✅ Approved');
}

export function queryAiSourcedPending() {
  return queryByStatus('🤖 AI sourced');
}

export function queryRecentlyApplied(days = 14) {
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const stmt = db().prepare(`
    SELECT * FROM jobs
     WHERE status = '✅ 已投'
       AND submitted_at >= :since
     ORDER BY submitted_at DESC
  `);
  return stmt.all({ since }).map(_rowToJob);
}

export function findByCompany(company) {
  const stmt = db().prepare(`SELECT * FROM jobs WHERE LOWER(company) = LOWER(:c)`);
  return stmt.all({ c: company }).map(_rowToJob);
}

export function findByUrl(url) {
  const stmt = db().prepare(`SELECT * FROM jobs WHERE apply_url = :url`);
  const row = stmt.get({ url });
  return _rowToJob(row);
}

export function logFeedback({ job_id, outcome, reason, detail }) {
  const stmt = db().prepare(`
    INSERT INTO feedback (job_id, outcome, reason, detail)
    VALUES (:job_id, :outcome, :reason, :detail)
  `);
  stmt.run({
    job_id: job_id || null,
    outcome: outcome || null,
    reason: reason || null,
    detail: detail ? (typeof detail === 'object' ? JSON.stringify(detail) : detail) : null,
  });
  return { ok: true };
}

export function summary() {
  const d = db();
  const total = d.prepare(`SELECT COUNT(*) as n FROM jobs`).get().n;
  const byStatus = d.prepare(`
    SELECT status, COUNT(*) as n FROM jobs GROUP BY status ORDER BY n DESC
  `).all();
  const recentSubmits = d.prepare(`
    SELECT COUNT(*) as n FROM jobs
     WHERE submitted_at >= datetime('now', '-7 days')
  `).get().n;
  return { total, byStatus, recentSubmits, db_path: dbPath() };
}

// ---------- CLI ----------

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'init') {
      console.log(JSON.stringify(initDb(), null, 2));
    } else if (cmd === 'summary') {
      console.log(JSON.stringify(summary(), null, 2));
    } else if (cmd === 'approved') {
      console.log(JSON.stringify(queryApprovedView(), null, 2));
    } else if (cmd === 'ai-sourced') {
      console.log(JSON.stringify(queryAiSourcedPending(), null, 2));
    } else if (cmd === 'recent') {
      const days = parseInt(process.argv[3] || '14', 10);
      console.log(JSON.stringify(queryRecentlyApplied(days), null, 2));
    } else {
      console.error(
        'Usage: node shared/local_db.mjs <init|summary|approved|ai-sourced|recent [days]>'
      );
      process.exit(1);
    }
  } catch (e) {
    console.error('local_db error:', e.message);
    process.exit(1);
  }
}
