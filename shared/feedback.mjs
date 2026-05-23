// shared/feedback.mjs
// Manages ~/.ats-skills/feedback.jsonl — append, load, format for AI prompt, summarize.
// Node 24 ESM, zero-dep.
//
// Each entry:
//   { ts, company, role?, url?, ats?, skip_reason, user_note? }
//
// skip_reason is a short tag like "Wrong Role" / "Wrong Location" / "Wrong Seniority"
// user_note is freeform explanation.

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const FEEDBACK_PATH = join(homedir(), '.ats-skills', 'feedback.jsonl');

export function getFeedbackPath() {
  return FEEDBACK_PATH;
}

function ensureDir(path) {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Append a feedback entry to the JSONL file.
 * @param {Object} entry - { company, role?, url?, ats?, skip_reason, user_note?, ts? }
 * @returns {Object} the entry as written (with ts filled in if missing)
 */
export function append(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('feedback.append: entry must be an object');
  }
  if (!entry.company || !entry.skip_reason) {
    throw new Error('feedback.append: company and skip_reason are required');
  }
  const record = {
    ts: entry.ts || new Date().toISOString(),
    company: entry.company,
    ...(entry.role ? { role: entry.role } : {}),
    ...(entry.url ? { url: entry.url } : {}),
    ...(entry.ats ? { ats: entry.ats } : {}),
    skip_reason: entry.skip_reason,
    ...(entry.user_note ? { user_note: entry.user_note } : {}),
  };
  ensureDir(FEEDBACK_PATH);
  appendFileSync(FEEDBACK_PATH, JSON.stringify(record) + '\n', 'utf8');
  return record;
}

/**
 * Load the latest N feedback entries (most recent first).
 * Silently skips malformed JSONL lines.
 * @param {number} n - max entries to return
 * @returns {Array<Object>}
 */
export function loadRecent(n = 20) {
  if (!existsSync(FEEDBACK_PATH)) return [];
  let raw;
  try {
    raw = readFileSync(FEEDBACK_PATH, 'utf8');
  } catch {
    return [];
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed
    }
  }
  // newest first
  entries.reverse();
  return entries.slice(0, n);
}

/**
 * Format feedback entries as concise context for AI scorer system prompt.
 * Truncates to ≤ 2000 chars.
 * @param {Array<Object>} entries
 * @returns {string}
 */
export function formatForPrompt(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const parts = [];
  for (const e of entries) {
    const company = e.company || 'Unknown';
    const role = e.role ? ` (${e.role}` : '';
    const reason = e.skip_reason ? `${role ? ' — ' : ' ('}${e.skip_reason}` : role ? '' : '';
    const note = e.user_note ? ` — ${e.user_note}` : '';
    const closing = role || reason ? ')' : '';
    parts.push(`${company}${role}${reason}${note}${closing}`);
  }
  const prefix = 'User recently rejected: ';
  let out = prefix + parts.join('; ') + '.';
  const MAX = 2000;
  if (out.length > MAX) {
    out = out.slice(0, MAX - 4) + '...';
  }
  return out;
}

/**
 * Aggregate stats about feedback entries.
 * @param {Array<Object>} entries
 * @returns {{ total: number, top_reasons: Array<[string, number]>, top_companies: Array<[string, number]> }}
 */
export function summarize(entries) {
  const safe = Array.isArray(entries) ? entries : [];
  const reasonCounts = new Map();
  const companyCounts = new Map();
  for (const e of safe) {
    if (e.skip_reason) {
      reasonCounts.set(e.skip_reason, (reasonCounts.get(e.skip_reason) || 0) + 1);
    }
    if (e.company) {
      companyCounts.set(e.company, (companyCounts.get(e.company) || 0) + 1);
    }
  }
  const topN = (m, n) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  return {
    total: safe.length,
    top_reasons: topN(reasonCounts, 3),
    top_companies: topN(companyCounts, 3),
  };
}
