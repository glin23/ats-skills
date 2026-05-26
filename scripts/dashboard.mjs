#!/usr/bin/env node
// dashboard.mjs — live terminal dashboard for mrweirdo-jobs.
//
// Reads ~/.mrweirdo-jobs/jobs.db (SQLite) + ~/.mrweirdo-jobs/feedback.jsonl
// every REFRESH_MS and rewrites the screen with ANSI escapes — no external
// deps beyond Node 24 builtins.
//
// Usage:
//   node scripts/dashboard.mjs            # default refresh = 1500ms
//   node scripts/dashboard.mjs --refresh 500
//   node scripts/dashboard.mjs --once     # print one snapshot and exit
//
// What it shows:
//   - Header: daily quota (today applied / 50 cap), large-co quota,
//     last apply elapsed time, total scored, total in-queue.
//   - Top section "现在/最近 (10)": last 10 status changes (submitted /
//     skipped / confirmed) sorted by updated_at desc, with status icon +
//     company + ATS + fit_score + relative time.
//   - Bottom section "等候 (top 8)": top 8 jobs by fit_score that are
//     still '🤖 AI sourced' (pending). Shows what will likely apply next.
//
// Optional "now applying" line — if `~/.mrweirdo-jobs/current.json`
// exists (written by the auto-apply skills when they start a row), the
// dashboard shows it as ⏳ ACTIVE.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = process.env.MRWEIRDO_HOME || path.join(os.homedir(), '.mrweirdo-jobs');
const DB_PATH = path.join(HOME, 'jobs.db');
const FEEDBACK = path.join(HOME, 'feedback.jsonl');
const CURRENT = path.join(HOME, 'current.json');
const DAILY_CAP = 50;
const LARGE_CO_CAP = 25;

const argv = process.argv.slice(2);
const arg = (k, def) => {
  const i = argv.findIndex((a) => a === `--${k}` || a.startsWith(`--${k}=`));
  if (i < 0) return def;
  return argv[i].includes('=') ? argv[i].split('=')[1] : argv[i + 1];
};
const REFRESH_MS = parseInt(arg('refresh', '1500'), 10);
const ONCE = argv.includes('--once');

// ANSI helpers
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', under: '\x1b[4m',
  fg: { red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', blu: '\x1b[34m', mag: '\x1b[35m', cyn: '\x1b[36m', white: '\x1b[37m', gray: '\x1b[90m' },
  bg: { gray: '\x1b[100m', grn: '\x1b[42m', red: '\x1b[41m', yel: '\x1b[43m' },
};
const clear = () => process.stdout.write('\x1b[H\x1b[2J\x1b[3J'); // home + clear + clear scrollback
const cursorHome = () => process.stdout.write('\x1b[H');
const hideCur = () => process.stdout.write('\x1b[?25l');
const showCur = () => process.stdout.write('\x1b[?25h');

// terminal width
const COLS = process.stdout.columns || 80;
const hr = (ch = '─') => ch.repeat(Math.max(COLS - 2, 40));

function relTime(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const dt = Math.floor((Date.now() - t) / 1000);
  if (dt < 60) return `${dt}s ago`;
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`;
  if (dt < 86400) return `${Math.floor(dt / 3600)}h ago`;
  return `${Math.floor(dt / 86400)}d ago`;
}

function pad(s, n, align = 'l') {
  s = String(s ?? '');
  // crude width — assume CJK chars are width 2
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
  if (w >= n) {
    // truncate by char from end
    let acc = '';
    let aw = 0;
    for (const ch of s) {
      const cw = ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
      if (aw + cw > n - 1) { acc += '…'; break; }
      acc += ch; aw += cw;
    }
    return align === 'r' ? acc.padStart(n) : acc.padEnd(n);
  }
  const pad = ' '.repeat(n - w);
  return align === 'r' ? pad + s : s + pad;
}

function safeReadFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function statusBadge(status) {
  if (status === '✅ 已确认') return `${C.fg.grn}${C.bold}✓✓${C.reset}`;
  if (status === '✅ 已投') return `${C.fg.grn}✅${C.reset}`;
  if (status === '⚠️ 跳过未投') return `${C.fg.yel}⚠ ${C.reset}`;
  if (status === '❌ Rejected') return `${C.fg.red}✘ ${C.reset}`;
  if (status === '🤖 AI sourced') return `${C.fg.cyn}? ${C.reset}`;
  if (status === '✅ Approved') return `${C.fg.blu}→ ${C.reset}`;
  return `${C.dim}? ${C.reset}`;
}

function atsTag(p) {
  if (!p) return `${C.dim}?     ${C.reset}`;
  const colors = { ashby: C.fg.mag, greenhouse: C.fg.grn, lever: C.fg.cyn, workday: C.fg.yel, icims: C.fg.blu, jobvite: C.fg.red, smartrecruiters: C.fg.yel, handshake: C.fg.blu };
  const col = colors[p] || C.fg.gray;
  return `${col}${pad(p, 6)}${C.reset}`;
}

function fitColor(s) {
  // Render in a fixed 2-char visual cell so right-padding stays correct.
  if (s == null) return `${C.dim} —${C.reset}`;
  const cell = String(s).padStart(2);
  if (s >= 9) return `${C.fg.grn}${C.bold}${cell}${C.reset}`;
  if (s >= 7) return `${C.fg.grn}${cell}${C.reset}`;
  if (s >= 5) return `${C.fg.yel}${cell}${C.reset}`;
  return `${C.fg.red}${cell}${C.reset}`;
}

function dbStats(db) {
  const todayISOprefix = new Date().toISOString().slice(0, 10);
  const submittedToday = db.prepare("SELECT COUNT(*) as c FROM jobs WHERE status='✅ 已投' AND substr(submitted_at,1,10)=?").get(todayISOprefix)?.c ?? 0;
  const submittedAll = db.prepare("SELECT COUNT(*) as c FROM jobs WHERE status IN ('✅ 已投','✅ 已确认')").get()?.c ?? 0;
  const skippedAll = db.prepare("SELECT COUNT(*) as c FROM jobs WHERE status IN ('⚠️ 跳过未投','❌ Rejected')").get()?.c ?? 0;
  const queueScored = db.prepare("SELECT COUNT(*) as c FROM jobs WHERE status='🤖 AI sourced' AND scored=1").get()?.c ?? 0;
  const queueAll = db.prepare("SELECT COUNT(*) as c FROM jobs WHERE status='🤖 AI sourced'").get()?.c ?? 0;
  const lastSubmitted = db.prepare("SELECT submitted_at FROM jobs WHERE submitted_at IS NOT NULL ORDER BY submitted_at DESC LIMIT 1").get()?.submitted_at;
  return { submittedToday, submittedAll, skippedAll, queueScored, queueAll, lastSubmitted };
}

function dbRecent(db, n = 10) {
  return db.prepare(`SELECT id, company, title, ats_platform, status, fit_score, submitted_at, updated_at, skip_reason FROM jobs
                     WHERE status IN ('✅ 已投','✅ 已确认','⚠️ 跳过未投','❌ Rejected')
                     ORDER BY COALESCE(submitted_at, updated_at) DESC LIMIT ?`).all(n);
}

function dbQueue(db, n = 8) {
  return db.prepare(`SELECT id, company, title, ats_platform, fit_score FROM jobs
                     WHERE status='🤖 AI sourced' AND scored=1 AND fit_score>=7
                     ORDER BY fit_score DESC, updated_at DESC LIMIT ?`).all(n);
}

function readCurrent() {
  const raw = safeReadFile(CURRENT);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function render(db) {
  cursorHome();
  let lines = [];
  const s = dbStats(db);
  const cur = readCurrent();

  const quotaColor = s.submittedToday >= DAILY_CAP ? C.fg.red : (s.submittedToday >= DAILY_CAP * 0.8 ? C.fg.yel : C.fg.grn);
  const headerL = `${C.bold}mrweirdo${C.reset} ${C.dim}│${C.reset} quota ${quotaColor}${s.submittedToday}/${DAILY_CAP}${C.reset} 今 ${C.dim}│${C.reset} ${C.fg.grn}${s.submittedAll}${C.reset} total ✅ ${C.dim}│${C.reset} ${C.fg.yel}${s.skippedAll}${C.reset} skip ${C.dim}│${C.reset} ${C.fg.cyn}${s.queueScored}${C.reset} queue (${s.queueAll} sourced)`;
  const headerR = `last apply ${C.fg.grn}${relTime(s.lastSubmitted)}${C.reset}  ${C.dim}refresh ${REFRESH_MS}ms · ^C quit${C.reset}`;
  lines.push(headerL);
  lines.push(headerR);
  lines.push(`${C.dim}${hr('━')}${C.reset}`);

  // ACTIVE
  if (cur && cur.url) {
    const t = relTime(cur.started_at);
    const stage = cur.stage || 'unknown';
    lines.push(`${C.bg.gray}${C.bold} ⏳ ACTIVE ${C.reset} ${C.fg.cyn}${cur.company || '?'}${C.reset} ⚬ ${cur.title || '?'} ${C.dim}|${C.reset} ${atsTag(cur.ats)} ${C.dim}|${C.reset} stage=${C.fg.yel}${stage}${C.reset} ${C.dim}|${C.reset} ${t}`);
    lines.push('');
  }

  lines.push(`${C.bold}最近 / Recent${C.reset}  ${C.dim}(latest 10, sorted by submitted/updated)${C.reset}`);
  lines.push(`${C.dim}${pad('  status', 10)} ${pad('company', 22)} ${pad('title', 28)} ${pad('ats', 7)} fit  ${pad('time', 12)}${C.reset}`);
  const recent = dbRecent(db, 10);
  if (recent.length === 0) {
    lines.push(`${C.dim}  (none yet — run /mrweirdo-onboard to start)${C.reset}`);
  } else {
    for (const r of recent) {
      const t = r.submitted_at || r.updated_at;
      const extra = r.skip_reason ? `${C.fg.red} ${r.skip_reason}${C.reset}` : '';
      lines.push(`  ${statusBadge(r.status)}  ${pad(r.company, 22)} ${pad(r.title, 28)} ${atsTag(r.ats_platform)} ${fitColor(r.fit_score)}  ${pad(relTime(t), 12)}${extra}`);
    }
  }

  lines.push('');
  lines.push(`${C.bold}下一批 / Next${C.reset}  ${C.dim}(scored, fit≥7, ranked, top 8)${C.reset}`);
  lines.push(`${C.dim}${pad('  ', 4)} ${pad('company', 22)} ${pad('title', 36)} ${pad('ats', 7)} fit${C.reset}`);
  const queue = dbQueue(db, 8);
  if (queue.length === 0) {
    lines.push(`${C.dim}  (queue empty — discovery hasn't surfaced new fit≥7 rows)${C.reset}`);
  } else {
    for (const r of queue) {
      lines.push(`  ${C.fg.cyn}→${C.reset}   ${pad(r.company, 22)} ${pad(r.title, 36)} ${atsTag(r.ats_platform)} ${fitColor(r.fit_score)} `);
    }
  }

  // clear leftover lines (write enough blank lines to clear scrollback)
  const need = process.stdout.rows ? process.stdout.rows - lines.length : 8;
  for (let i = 0; i < need; i++) lines.push('\x1b[K');

  process.stdout.write(lines.join('\n') + '\n');
}

// main loop — DB may not exist yet (dashboard often started BEFORE onboard
// creates jobs.db). Lazy-open + re-try every render.
let db = null;
function openDbIfReady() {
  if (db) return db;
  if (!fs.existsSync(DB_PATH)) return null;
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true });
    return db;
  } catch (e) {
    return null;
  }
}

function renderEmptyState() {
  cursorHome();
  const lines = [];
  lines.push(`${C.bold}mrweirdo${C.reset} ${C.dim}│${C.reset} ${C.fg.yel}waiting for jobs.db${C.reset} ${C.dim}│${C.reset} ${C.fg.cyn}^C quit${C.reset}`);
  lines.push(`${C.dim}${hr('━')}${C.reset}`);
  lines.push('');
  lines.push(`  ${C.fg.yel}⏳${C.reset}  No applications yet.`);
  lines.push('');
  lines.push(`  Dashboard polls ${C.bold}${DB_PATH}${C.reset} every ${REFRESH_MS}ms.`);
  lines.push(`  It will populate the moment you run an application flow:`);
  lines.push('');
  lines.push(`     ${C.fg.cyn}/mrweirdo-onboard${C.reset}                  ${C.dim}full pipeline (recommended for first run)${C.reset}`);
  lines.push(`     ${C.fg.cyn}/mrweirdo-ashby-auto <url>${C.reset}        ${C.dim}single Ashby URL${C.reset}`);
  lines.push(`     ${C.fg.cyn}/mrweirdo-greenhouse-auto <url>${C.reset}   ${C.dim}single Greenhouse URL${C.reset}`);
  lines.push(`     ${C.fg.cyn}/mrweirdo-lever-auto <url>${C.reset}        ${C.dim}single Lever URL${C.reset}`);
  lines.push('');
  lines.push(`  ${C.dim}(open Claude Code in another terminal, type one of the above)${C.reset}`);
  // clear leftover
  const need = process.stdout.rows ? process.stdout.rows - lines.length : 8;
  for (let i = 0; i < need; i++) lines.push('\x1b[K');
  process.stdout.write(lines.join('\n') + '\n');
}

function tick() {
  const ready = openDbIfReady();
  if (ready) {
    try { render(ready); }
    catch (e) {
      // DB may have been recreated mid-poll; drop handle and retry next tick
      db = null;
      console.error('render error, will retry:', e.message);
    }
  } else {
    renderEmptyState();
  }
}

if (ONCE) {
  tick();
  process.exit(0);
}

clear();
hideCur();
process.on('SIGINT', () => { showCur(); console.log('\n\nbye.'); process.exit(0); });
process.on('exit', () => { showCur(); });

tick();
setInterval(tick, REFRESH_MS);
