#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { dbPath, initDb } from './local_db.mjs';
import { OUTCOME_STATUSES } from './constants.mjs';

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function usage() {
  console.error(`Usage:
  node shared/tracker_cli.mjs --row-id <id> --outcome <pending|responded|oa|interview|offer|rejected|ghosted> [--note "..."]
  node shared/tracker_cli.mjs --row-id <id> --followup-sent [--note "..."]
  node shared/tracker_cli.mjs --funnel [--json]
`);
}

export function validateOutcomeStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (!OUTCOME_STATUSES.includes(status)) throw new Error(`invalid outcome_status: ${value}`);
  return status;
}

function recordOutcome(db, rowId, outcome, note = '') {
  const status = validateOutcomeStatus(outcome);
  const row = db.prepare(`SELECT id, company, title, status FROM jobs WHERE id = ?`).get(rowId);
  if (!row) throw new Error(`row not found: ${rowId}`);
  db.prepare(`
    UPDATE jobs
       SET outcome_status = ?,
           outcome_updated_at = datetime('now')
     WHERE id = ?
  `).run(status, rowId);
  db.prepare(`
    INSERT INTO feedback(job_id, outcome, reason, detail)
    VALUES (?, ?, ?, ?)
  `).run(rowId, `outcome_${status}`, 'tracker_update', note || null);
  return { ok: true, row_id: rowId, outcome_status: status };
}

function recordFollowup(db, rowId, note = '') {
  const row = db.prepare(`SELECT id FROM jobs WHERE id = ?`).get(rowId);
  if (!row) throw new Error(`row not found: ${rowId}`);
  db.prepare(`
    UPDATE jobs
       SET followup_count = COALESCE(followup_count, 0) + 1,
           last_followup_at = datetime('now')
     WHERE id = ?
  `).run(rowId);
  db.prepare(`
    INSERT INTO feedback(job_id, outcome, reason, detail)
    VALUES (?, 'followup_sent', 'tracker_update', ?)
  `).run(rowId, note || null);
  const updated = db.prepare(`SELECT id, followup_count, last_followup_at FROM jobs WHERE id = ?`).get(rowId);
  return { ok: true, row_id: rowId, followup_count: updated.followup_count, last_followup_at: updated.last_followup_at };
}

function funnel(db) {
  return {
    outcomes: db.prepare(`SELECT * FROM v_outcomes`).all(),
    followup_due: db.prepare(`
      SELECT id, company, title, submitted_at, followup_count
        FROM v_followup_due
       ORDER BY submitted_at ASC
    `).all(),
  };
}

export function runTrackerCli(argv = process.argv) {
  const rowId = Number(argValue('--row-id') || 0);
  const outcome = argValue('--outcome');
  const note = argValue('--note', '');
  initDb();
  const db = new DatabaseSync(dbPath());
  if (hasArg('--funnel')) return { ok: true, ...funnel(db) };
  if (!rowId) throw new Error('missing --row-id');
  if (hasArg('--followup-sent')) return recordFollowup(db, rowId, note);
  if (outcome) return recordOutcome(db, rowId, outcome, note);
  throw new Error('expected --outcome, --followup-sent, or --funnel');
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  try {
    if (hasArg('--help') || hasArg('-h')) {
      usage();
      process.exit(0);
    }
    const result = runTrackerCli();
    if (hasArg('--json') || !hasArg('--funnel')) console.log(JSON.stringify(result, null, 2));
    else {
      console.log('outcomes:');
      for (const row of result.outcomes) console.log(`- ${row.outcome_status}: ${row.count}`);
      console.log(`follow-up due: ${result.followup_due.length}`);
    }
  } catch (e) {
    console.error(`[tracker] ${e.message}`);
    process.exit(1);
  }
}
