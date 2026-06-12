#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { dbPath, initDb } from './local_db.mjs';
import { LIVENESS_STATUSES } from './constants.mjs';
import { progress } from './progress.mjs';

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function looksLikeCloudflare(bodyText) {
  const body = normalizeText(bodyText);
  return body.includes('cloudflare')
    || body.includes('cf-challenge')
    || body.includes('cf-turnstile')
    || body.includes('checking your browser before accessing')
    || body.includes('attention required! | cloudflare');
}

function looksLikeBotChallenge(bodyText) {
  const body = normalizeText(bodyText);
  return body.includes('verify you are human')
    || body.includes('are you a robot')
    || body.includes('captcha')
    || body.includes('hcaptcha')
    || body.includes('unusual traffic')
    || body.includes('bot detection');
}

function looksExpired(bodyText) {
  const body = normalizeText(bodyText);
  return [
    'job is no longer available',
    'position no longer available',
    'job posting has been removed',
    'this job is no longer accepting applications',
    'this opening is no longer available',
    'this position has been filled',
    'no longer accepting applications',
    'job has expired',
  ].some((needle) => body.includes(needle));
}

function isGreenhouseErrorRedirect(finalUrl) {
  try {
    const url = new URL(String(finalUrl || ''));
    const host = url.hostname.toLowerCase();
    return host === 'greenhouse.io' || host.endsWith('.greenhouse.io')
      ? url.searchParams.get('error') === 'true'
      : false;
  } catch {
    return /greenhouse\.io/i.test(String(finalUrl || '')) && /[?&]error=true(?:&|$)/i.test(String(finalUrl || ''));
  }
}

export function classifyLiveness({ status = 0, finalUrl = '', bodyText = '' } = {}) {
  const numericStatus = Number(status || 0);
  if (looksLikeCloudflare(bodyText)) return 'uncertain';
  if (isGreenhouseErrorRedirect(finalUrl)) return 'expired';
  if (looksLikeBotChallenge(bodyText)) return 'bot_challenge';
  if (numericStatus === 404 || numericStatus === 410) return 'expired';
  if (looksExpired(bodyText)) return 'expired';
  if (numericStatus >= 200 && numericStatus < 400) return 'live';
  if ([401, 403, 429].includes(numericStatus)) return 'bot_challenge';
  return 'uncertain';
}

function printUsage() {
  console.error(`Usage:
  node shared/liveness_gate.mjs --row-id <id> [--json]
  node shared/liveness_gate.mjs --batch [--run-id <id>] [--json]

Options:
  --skip-liveness         No-op escape hatch; prints a skipped summary.
  --timeout-ms N          Per-request timeout. Default 8000.
  --delay-ms N            Serial delay between batch requests. Default 250.
`);
}

async function sleep(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkUrl(url, timeoutMs) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; MrWeirdoJobs/3.0; liveness-check)',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    let bodyText = '';
    try {
      bodyText = (await res.text()).slice(0, 50000);
    } catch {
      bodyText = '';
    }
    return {
      ok: true,
      status: res.status,
      final_url: res.url || url,
      liveness_status: classifyLiveness({ status: res.status, finalUrl: res.url || url, bodyText }),
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      final_url: url,
      liveness_status: 'uncertain',
      error: e.message,
    };
  }
}

function updateLiveness(db, rowId, status) {
  if (!LIVENESS_STATUSES.includes(status)) throw new Error(`invalid liveness status: ${status}`);
  db.prepare(`
    UPDATE jobs
       SET liveness_status = ?,
           liveness_checked_at = datetime('now')
     WHERE id = ?
  `).run(status, rowId);
}

function selectRows(db, { rowId, runId }) {
  if (rowId) {
    return db.prepare(`
      SELECT id, company, title, apply_url
        FROM jobs
       WHERE id = ?
    `).all(rowId);
  }
  if (runId) {
    return db.prepare(`
      SELECT id, company, title, apply_url
        FROM jobs
       WHERE status = '🤖 AI sourced'
         AND COALESCE(auto_apply_eligible, 0) = 1
         AND apply_url LIKE 'http%'
         AND discovery_run_id = ?
       ORDER BY fit_score DESC, id ASC
    `).all(runId);
  }
  return db.prepare(`
    SELECT id, company, title, apply_url
      FROM jobs
     WHERE status = '🤖 AI sourced'
       AND COALESCE(auto_apply_eligible, 0) = 1
       AND apply_url LIKE 'http%'
     ORDER BY fit_score DESC, id ASC
  `).all();
}

export async function runLivenessGate({
  rowId = null,
  batch = false,
  runId = null,
  timeoutMs = 8000,
  delayMs = 250,
  skip = false,
} = {}) {
  if (skip) {
    return { ok: true, skipped: true, checked: 0, by_status: {} };
  }
  if (!rowId && !batch) throw new Error('expected --row-id or --batch');
  initDb();
  const db = new DatabaseSync(dbPath());
  const rows = selectRows(db, { rowId, runId });
  const summary = {
    ok: true,
    db_path: dbPath(),
    checked: 0,
    row_id: rowId || null,
    run_id: runId || null,
    by_status: {},
    rows: [],
  };

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    progress('liveness', `checking ${i + 1}/${rows.length}: ${row.id} ${row.company || ''}`);
    const result = await checkUrl(row.apply_url, timeoutMs);
    updateLiveness(db, row.id, result.liveness_status);
    summary.checked += 1;
    summary.by_status[result.liveness_status] = (summary.by_status[result.liveness_status] || 0) + 1;
    summary.rows.push({
      row_id: row.id,
      company: row.company,
      title: row.title,
      apply_url: row.apply_url,
      ...result,
    });
    if (i < rows.length - 1) await sleep(delayMs);
  }

  return summary;
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  if (hasArg('--help') || hasArg('-h')) {
    printUsage();
    process.exit(0);
  }
  try {
    const rowId = Number(argValue('--row-id') || 0) || null;
    const result = await runLivenessGate({
      rowId,
      batch: hasArg('--batch'),
      runId: argValue('--run-id'),
      timeoutMs: Math.max(1000, Number(argValue('--timeout-ms', '8000'))),
      delayMs: Math.max(0, Number(argValue('--delay-ms', '250'))),
      skip: hasArg('--skip-liveness'),
    });
    if (hasArg('--json')) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`liveness checked: ${result.checked}`);
      for (const [status, count] of Object.entries(result.by_status || {})) {
        console.log(`- ${status}: ${count}`);
      }
    }
  } catch (e) {
    console.error(`[liveness] ${e.message}`);
    process.exit(1);
  }
}
