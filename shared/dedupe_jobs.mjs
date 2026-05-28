#!/usr/bin/env node
// dedupe_jobs.mjs — high-confidence local duplicate guard for jobs.db.
//
// The apply queue must never spend multiple attempts on the same company +
// same job title. This script marks duplicate pending rows as skipped before
// Step 10 selects auto-apply candidates.

import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './local_db.mjs';
import { normalizeCompany, normalizeTitle, SUBMITTED_STATUSES } from './job_identity.mjs';

const PENDING_STATUS = '🤖 AI sourced';
const SKIPPED_STATUS = '⚠️ 跳过未投';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const JSON_OUT = args.has('--json');
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Math.max(1, Number(LIMIT_ARG.split('=')[1] || 0)) : null;

function atsUrlScore(url = '') {
  const u = String(url).toLowerCase();
  if (/job-boards\.greenhouse\.io\/[^/]+\/jobs\/\d+/.test(u)) return 5;
  if (/boards\.greenhouse\.io\/[^/]+\/jobs\/\d+/.test(u)) return 5;
  if (/jobs\.ashbyhq\.com\/[^/]+\/[a-f0-9-]+/.test(u)) return 5;
  if (/lever\.co\/[^/]+\/[a-f0-9-]+/.test(u)) return 4;
  if (/\bgh_jid=/.test(u)) return 2;
  return 1;
}

function rowRank(row) {
  return [
    Number(row.auto_apply_eligible || 0),
    Number(row.fit_score || 0),
    atsUrlScore(row.apply_url),
    Number(row.id || 0) * -1,
  ];
}

function compareRows(a, b) {
  const ar = rowRank(a);
  const br = rowRank(b);
  for (let i = 0; i < ar.length; i++) {
    if (ar[i] !== br[i]) return br[i] - ar[i];
  }
  return a.id - b.id;
}

function duplicateSkipReferencesPending(row, pendingIds) {
  const m = String(row.skip_reason || '').match(/^duplicate_same_company_title_keep_id_(\d+)$/);
  return !!m && pendingIds.has(Number(m[1]));
}

function buildActions(rows) {
  const groups = new Map();
  for (const row of rows) {
    const companyKey = normalizeCompany(row.company);
    const titleKey = normalizeTitle(row.title);
    if (!companyKey || !titleKey) continue;
    const key = `${companyKey}::${titleKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...row, company_key: companyKey, title_key: titleKey });
  }

  const actions = [];
  for (const groupRows of groups.values()) {
    if (groupRows.length < 2) continue;

    const pending = groupRows.filter((r) => r.status === PENDING_STATUS);
    if (pending.length === 0) continue;

    const submitted = groupRows
      .filter((r) => SUBMITTED_STATUSES.has(r.status))
      .sort((a, b) => a.id - b.id);
    if (submitted.length > 0) {
      const ref = submitted[0];
      for (const row of pending) {
        actions.push({
          id: row.id,
          reason: 'duplicate_same_company_title_already_submitted',
          note: `Same company/title already submitted in row ${ref.id}; skipped to avoid duplicate applications.`,
          keep_id: ref.id,
          company: row.company,
          title: row.title,
        });
      }
      continue;
    }

    const pendingIds = new Set(pending.map((r) => r.id));
    const attempted = groupRows
      .filter((r) => r.status !== PENDING_STATUS && !SUBMITTED_STATUSES.has(r.status))
      // Idempotency: rows this script already skipped as duplicates of the
      // still-pending keeper are not real application attempts.
      .filter((r) => !duplicateSkipReferencesPending(r, pendingIds))
      .sort((a, b) => a.id - b.id);
    if (attempted.length > 0) {
      const ref = attempted[0];
      for (const row of pending) {
        actions.push({
          id: row.id,
          reason: 'duplicate_same_company_title_already_attempted',
          note: `Same company/title already attempted in row ${ref.id}; skipped to avoid repeat applications.`,
          keep_id: ref.id,
          company: row.company,
          title: row.title,
        });
      }
      continue;
    }

    const keep = [...pending].sort(compareRows)[0];
    for (const row of pending) {
      if (row.id === keep.id) continue;
      actions.push({
        id: row.id,
        reason: `duplicate_same_company_title_keep_id_${keep.id}`,
        note: `Duplicate company/title. Keeping row ${keep.id} as the single auto-apply candidate.`,
        keep_id: keep.id,
        company: row.company,
        title: row.title,
      });
    }
  }

  actions.sort((a, b) => a.id - b.id);
  return LIMIT ? actions.slice(0, LIMIT) : actions;
}

function applyActions(db, actions) {
  const stmt = db.prepare(`
    UPDATE jobs
       SET status = :status,
           skip_reason = :reason,
           user_note = :note,
           auto_apply_eligible = 0,
           updated_at = datetime('now')
     WHERE id = :id
       AND status = :pending
  `);
  const feedback = db.prepare(`
    INSERT INTO feedback (job_id, outcome, reason, detail)
    VALUES (:job_id, 'skip', :reason, :detail)
  `);

  db.exec('BEGIN');
  try {
    for (const action of actions) {
      stmt.run({
        id: action.id,
        status: SKIPPED_STATUS,
        pending: PENDING_STATUS,
        reason: action.reason,
        note: action.note,
      });
      feedback.run({
        job_id: action.id,
        reason: action.reason,
        detail: JSON.stringify({ keep_id: action.keep_id, company: action.company, title: action.title }),
      });
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const db = new DatabaseSync(dbPath());
const rows = db.prepare(`
  SELECT id, company, title, apply_url, status, fit_score, auto_apply_eligible, skip_reason, updated_at
    FROM jobs
   WHERE title IS NOT NULL
     AND trim(title) <> ''
     AND company IS NOT NULL
     AND trim(company) <> ''
`).all();

const actions = buildActions(rows);
if (APPLY && actions.length > 0) applyActions(db, actions);

const summary = {
  mode: APPLY ? 'apply' : 'dry-run',
  db_path: dbPath(),
  duplicate_pending_rows: actions.length,
  actions,
};

if (JSON_OUT) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`[dedupe] mode=${summary.mode} duplicate_pending_rows=${actions.length}`);
  for (const action of actions.slice(0, 50)) {
    console.log(`- #${action.id} ${action.company} — ${action.title} -> ${action.reason} (ref #${action.keep_id})`);
  }
  if (actions.length > 50) console.log(`... ${actions.length - 50} more`);
}
