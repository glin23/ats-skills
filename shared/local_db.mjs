// local_db.mjs — SQLite-backed job tracker for mrweirdo-jobs (v1.1+)
// Uses Node 24+ built-in `node:sqlite` (experimental — pass --no-warnings to silence).
// File location: ~/.mrweirdo-jobs/jobs.db (overridable via MRWEIRDO_DB_PATH env).
//
// Product data model note:
// - This is a per-user local database. A separate student should have a separate
//   MRWEIRDO_HOME / MRWEIRDO_DB_PATH, not a shared demo database.
// - Discovery rows are per-user run results, not a shared company dump.
//   Re-seen postings update last_seen_at + seen_count; stale / repeatedly failed
//   rows can be pruned by shared/prune_discovered_jobs.mjs.
//
// API surface mirrors the v1.0 notion_sync.mjs so /mrweirdo-source, /mrweirdo-jobs,
// /mrweirdo-confirm can swap import paths with minimal flow changes:
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
import { DEFAULT_OUTCOME_STATUS } from './constants.mjs';

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
  // Step 1: CREATE TABLE (idempotent — won't add columns to existing table).
  // The v2 columns inside this CREATE only take effect on fresh DBs; for
  // pre-v2 DBs we ALTER TABLE below.
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
      recommended INTEGER,
      key_gaps TEXT,
      role_type_match TEXT,
      skip_reason TEXT,
      user_note TEXT,
      dim_scores TEXT,
      legitimacy TEXT DEFAULT 'high',
      legitimacy_signals TEXT,
      liveness_status TEXT,
      liveness_checked_at TEXT,

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

      -- v2 fields (PRD §"Data Flow")
      scored INTEGER NOT NULL DEFAULT 0,
      auto_apply_eligible INTEGER,
      search_source TEXT,
      discovery_run_id TEXT,
      auto_submitted_at TEXT,
      report_path TEXT,

      -- tracker/outcome metadata. The emoji status column remains the
      -- application-state source of truth; outcome_status is follow-up context.
      outcome_status TEXT DEFAULT 'pending',
      outcome_updated_at TEXT,
      last_followup_at TEXT,
      followup_count INTEGER NOT NULL DEFAULT 0,

      -- discovery freshness metadata
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      seen_count INTEGER NOT NULL DEFAULT 1,

      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      outcome TEXT,
      reason TEXT,
      detail TEXT
    );
  `);

  // Step 2: v2 migration — add columns idempotently for any pre-v2 db.
  // SQLite throws on duplicate column; catch and continue.
  const v2Columns = [
    "location TEXT",
    "source TEXT",
    "recommended INTEGER",
    "key_gaps TEXT",
    "role_type_match TEXT",
    "skip_reason TEXT",
    "user_note TEXT",
    "dim_scores TEXT",
    "salary_min REAL",
    "salary_max REAL",
    "salary_currency TEXT",
    "salary_interval TEXT",
    "hourly_rate REAL",
    "ats_platform TEXT",
    "apply_quota_limit INTEGER",
    "apply_quota_period TEXT",
    "apply_quota_note TEXT",
    "submitted_at TEXT",
    "confirmed_at TEXT",
    "confirmation_email_id TEXT",
    "confirmation_url TEXT",
    "bot_note TEXT",
    "scored INTEGER NOT NULL DEFAULT 0",
    "auto_apply_eligible INTEGER",
    "search_source TEXT",
    "discovery_run_id TEXT",
    "auto_submitted_at TEXT",
    // ALTER TABLE cannot add columns with non-constant datetime defaults, so
    // existing DBs get nullable columns here and are backfilled below. Fresh DBs
    // still use the NOT NULL defaults from CREATE TABLE.
    "first_seen_at TEXT",
    "last_seen_at TEXT",
    "seen_count INTEGER NOT NULL DEFAULT 1",
    "legitimacy TEXT DEFAULT 'high'",
    "legitimacy_signals TEXT",
    "liveness_status TEXT",
    "liveness_checked_at TEXT",
    "report_path TEXT",
    "outcome_status TEXT DEFAULT 'pending'",
    "outcome_updated_at TEXT",
    "last_followup_at TEXT",
    "followup_count INTEGER NOT NULL DEFAULT 0",
    "created_at TEXT",
    "updated_at TEXT",
  ];
  for (const colDef of v2Columns) {
    try {
      d.exec(`ALTER TABLE jobs ADD COLUMN ${colDef}`);
    } catch (e) {
      if (!String(e.message || e).match(/duplicate column/i)) throw e;
    }
  }

  d.exec(`
    UPDATE jobs
       SET first_seen_at = COALESCE(first_seen_at, created_at, updated_at, datetime('now')),
           last_seen_at = COALESCE(last_seen_at, updated_at, created_at, datetime('now')),
           seen_count = COALESCE(seen_count, 1),
           outcome_status = COALESCE(outcome_status, '${DEFAULT_OUTCOME_STATUS}'),
           followup_count = COALESCE(followup_count, 0)
     WHERE first_seen_at IS NULL
        OR last_seen_at IS NULL
        OR seen_count IS NULL
        OR outcome_status IS NULL
        OR followup_count IS NULL;
  `);

  // Step 3: indexes + views (run AFTER columns exist).
  d.exec(`
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
    CREATE INDEX IF NOT EXISTS idx_jobs_submitted_at ON jobs(submitted_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_discovery_run_id ON jobs(discovery_run_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_last_seen_at ON jobs(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_scored ON jobs(scored);
    CREATE INDEX IF NOT EXISTS idx_jobs_liveness_status ON jobs(liveness_status);
    CREATE INDEX IF NOT EXISTS idx_jobs_outcome_status ON jobs(outcome_status);

    -- Datasette-friendly views (v1)
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

    -- v2 views
    CREATE VIEW IF NOT EXISTS v_unscored AS
      SELECT * FROM jobs WHERE scored = 0 ORDER BY updated_at DESC;
    CREATE VIEW IF NOT EXISTS v_auto_apply_eligible AS
      SELECT * FROM jobs
       WHERE auto_apply_eligible = 1
         AND status = '🤖 AI sourced'
       ORDER BY fit_score DESC;
    CREATE VIEW IF NOT EXISTS v_auto_submitted AS
      SELECT * FROM jobs WHERE auto_submitted_at IS NOT NULL ORDER BY auto_submitted_at DESC;
    CREATE VIEW IF NOT EXISTS v_outcomes AS
      SELECT
        COALESCE(outcome_status, 'pending') AS outcome_status,
        COUNT(*) AS count,
        SUM(CASE WHEN status IN ('✅ 已投', '✅ 已确认') THEN 1 ELSE 0 END) AS submitted_rows,
        MAX(COALESCE(outcome_updated_at, submitted_at, auto_submitted_at, updated_at)) AS latest_event_at
      FROM jobs
      GROUP BY COALESCE(outcome_status, 'pending')
      ORDER BY count DESC, outcome_status ASC;
    CREATE VIEW IF NOT EXISTS v_followup_due AS
      SELECT *
        FROM jobs
       WHERE status IN ('✅ 已投', '✅ 已确认')
         AND COALESCE(outcome_status, 'pending') = 'pending'
         AND submitted_at IS NOT NULL
         AND datetime(submitted_at) <= datetime('now', '-7 days')
         AND COALESCE(followup_count, 0) < 2
       ORDER BY submitted_at ASC;

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
  'fit_score', 'recommended', 'key_gaps', 'role_type_match', 'skip_reason', 'user_note',
  'dim_scores', 'legitimacy', 'legitimacy_signals',
  'salary_min', 'salary_max', 'salary_currency',
  'salary_interval', 'hourly_rate', 'ats_platform',
  'apply_quota_limit', 'apply_quota_period', 'apply_quota_note',
  // v2
  'scored', 'auto_apply_eligible', 'search_source', 'discovery_run_id',
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
  if (params.legitimacy_signals && typeof params.legitimacy_signals === 'object') {
    params.legitimacy_signals = JSON.stringify(params.legitimacy_signals);
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
  const updatedAtClause = `
      , last_seen_at = datetime('now')
      , seen_count = COALESCE(seen_count, 0) + 1
      , updated_at = datetime('now')`;
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
  if (out.legitimacy_signals) {
    try {
      out.legitimacy_signals = JSON.parse(out.legitimacy_signals);
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
