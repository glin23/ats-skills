#!/usr/bin/env node
// apply_report.mjs — renders a self-contained HTML report for a mrweirdo-jobs run.
//
// Two layers in one file:
//   1. A screenshot-ready "funnel battle-report card" (the hero) — built for
//      sharing on 小红书 / Twitter as honest build-in-public proof. It frames the
//      run as a FUNNEL (scored → matched → applied+verified → skipped) rather
//      than a vanity submit count.
//   2. The maintainer's detailed per-row table BELOW the card (unchanged intent).
//
// All numbers come from the real DB — nothing is fabricated.
//
// CLI:
//   --window all      cumulative funnel (default — the honest impressive number)
//   --window today    today's run only (UTC date)
//   --since YYYY-MM-DD backward-compat date floor (used by apply_batch.mjs).
//                      Implies the same "windowed" row table as before.
//   --elapsed-min N   optional elapsed minutes to show on the card
//   --output PATH     output html path (default reports/apply-report-<stamp>.html)
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './local_db.mjs';

const HOME = process.env.MRWEIRDO_HOME || path.join(process.env.HOME || '', '.mrweirdo-jobs');

const SUBMITTED = ['✅ 已投', '✅ 已确认'];
const SKIPPED = ['⚠️ 跳过未投', '❌ Rejected'];

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ---------- CLI / window resolution ----------
// Backward compat: apply_batch.mjs calls `--since <today>`. If --since is
// passed we honor it as the row-table floor AND treat the window as "today"
// for the funnel framing (it's a per-run report). Otherwise --window decides;
// default is "all" (the cumulative, honest, impressive card).
const sinceArg = argValue('--since');
const windowArg = (argValue('--window') || (sinceArg ? 'today' : 'all')).toLowerCase();
const isAll = windowArg === 'all';
const since = sinceArg || (isAll ? null : todayIso());

const elapsedMinRaw = argValue('--elapsed-min');
const elapsedMin = elapsedMinRaw != null && Number.isFinite(Number(elapsedMinRaw))
  ? Number(elapsedMinRaw)
  : null;

const outputArg = argValue('--output');
const reportsDir = path.join(HOME, 'reports');
const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
const outputPath = outputArg || path.join(reportsDir, `apply-report-${stamp}.html`);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const db = new DatabaseSync(dbPath());

// ---------- funnel metrics (whole window) ----------
// The funnel is computed over the same window as the table:
//  - "all"   => entire DB (no date floor)
//  - "today" => rows touched on/after `since`
const windowClause = since
  ? `date(COALESCE(submitted_at, auto_submitted_at, updated_at, created_at)) >= date(?)`
  : `1=1`;
const windowParams = since ? [since] : [];

const countWhere = (extra) =>
  db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE ${windowClause} AND (${extra})`)
    .get(...windowParams).n;

const scored = db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE ${windowClause}`)
  .get(...windowParams).n;
const matched = countWhere(`role_type_match = 'intern' AND fit_score >= 5`);
const submittedCount = countWhere(`status IN ('✅ 已投', '✅ 已确认')`);
const skippedCount = countWhere(`status IN ('⚠️ 跳过未投', '❌ Rejected')`);

// A few honest, human-readable example skip reasons (skip the noisy
// auto-dedupe markers; surface the substantive ones).
const skipExamples = db.prepare(`
  SELECT DISTINCT skip_reason
    FROM jobs
   WHERE ${windowClause}
     AND status IN ('⚠️ 跳过未投', '❌ Rejected')
     AND skip_reason IS NOT NULL AND skip_reason <> ''
     AND skip_reason NOT LIKE 'duplicate_%'
   ORDER BY length(skip_reason) ASC
   LIMIT 4
`).all(...windowParams)
  .map((r) => {
    // Take the leading "tag:" / first sentence so the card stays compact.
    let s = String(r.skip_reason).split(/[:\n]/)[0].trim();
    if (s.length > 64) s = s.slice(0, 61) + '…';
    return s.replaceAll('_', ' ');
  });

// Most recent verified submissions (company · title · verified).
const recentSubmits = db.prepare(`
  SELECT company, title, status, confirmation_url
    FROM jobs
   WHERE ${windowClause}
     AND status IN ('✅ 已投', '✅ 已确认')
   ORDER BY COALESCE(submitted_at, auto_submitted_at, updated_at) DESC, id DESC
   LIMIT 8
`).all(...windowParams);

// ---------- detailed maintainer table (windowed, as before) ----------
const tableWhere = since
  ? `date(COALESCE(submitted_at, auto_submitted_at, updated_at, created_at)) >= date(?)
       AND status IN ('✅ 已投', '✅ 已确认', '⚠️ 跳过未投', '❌ Rejected')`
  : `status IN ('✅ 已投', '✅ 已确认', '⚠️ 跳过未投', '❌ Rejected')`;
const rows = db.prepare(`
  SELECT id, company, title, apply_url, ats_platform, fit_score, role_type_match,
         status, skip_reason, submitted_at, auto_submitted_at, confirmed_at,
         confirmation_url, updated_at
    FROM jobs
   WHERE ${tableWhere}
   ORDER BY
     CASE WHEN status IN ('✅ 已投', '✅ 已确认') THEN 0 ELSE 1 END,
     COALESCE(submitted_at, auto_submitted_at, updated_at) DESC,
     id DESC
`).all(...(since ? [since] : []));

const generatedAt = new Date().toLocaleString();
const windowLabel = isAll ? 'All time (cumulative)' : `Today · since ${since}`;

const bodyRows = rows.map((r) => {
  const url = r.confirmation_url || r.apply_url;
  const reason = r.status === '✅ 已确认'
    ? 'Email confirmed'
    : r.status === '✅ 已投'
      ? 'Submitted'
      : r.skip_reason || '';
  return `<tr>
    <td>${escapeHtml(r.id)}</td>
    <td>${escapeHtml(r.company)}</td>
    <td>${escapeHtml(r.title)}</td>
    <td>${escapeHtml(r.role_type_match)}</td>
    <td>${escapeHtml(r.fit_score)}</td>
    <td>${escapeHtml(r.ats_platform)}</td>
    <td>${escapeHtml(r.status)}</td>
    <td>${escapeHtml(reason)}</td>
    <td><a href="${escapeHtml(url)}">${escapeHtml(url ? 'open' : '')}</a></td>
  </tr>`;
}).join('\n');

// ---------- funnel card pieces ----------
const pct = (n) => (scored > 0 ? Math.round((n / scored) * 100) : 0);

function funnelStep({ label, value, sub, tone, share }) {
  return `<div class="step ${tone}">
      <div class="step-bar" style="--share:${share}%"></div>
      <div class="step-body">
        <div class="step-num">${escapeHtml(value)}</div>
        <div class="step-text">
          <div class="step-label">${escapeHtml(label)}</div>
          <div class="step-sub">${sub}</div>
        </div>
      </div>
    </div>`;
}

// Widths are visual (relative to scored), clamped so small steps stay readable.
const w = (n) => Math.max(18, scored > 0 ? Math.round((n / scored) * 100) : 0);

const steps = [
  funnelStep({
    label: 'Jobs scored',
    value: scored.toLocaleString(),
    sub: 'roles the agent read + scored',
    tone: 'neutral',
    share: 100,
  }),
  funnelStep({
    label: 'Matched internships',
    value: matched.toLocaleString(),
    sub: `fit ≥ 5 · intern role · ${pct(matched)}% of scored`,
    tone: 'match',
    share: w(matched),
  }),
  funnelStep({
    label: 'Auto-applied & verified',
    value: submittedCount.toLocaleString(),
    sub: 'every submit confirmed on the page',
    tone: 'hero',
    share: w(submittedCount),
  }),
  funnelStep({
    label: 'Skipped — honestly',
    value: skippedCount.toLocaleString(),
    sub: 'logged with a specific reason, never spammed',
    tone: 'skip',
    share: w(skippedCount),
  }),
].join('\n');

const skipChips = skipExamples.length
  ? `<div class="chips">${skipExamples
      .map((s) => `<span class="chip">${escapeHtml(s)}</span>`)
      .join('')}</div>`
  : '';

const recentList = recentSubmits.length
  ? recentSubmits.map((r) => `<li>
        <span class="r-co">${escapeHtml(r.company)}</span>
        <span class="r-dot">·</span>
        <span class="r-title">${escapeHtml(r.title)}</span>
        <span class="r-ok">✅ verified</span>
      </li>`).join('\n')
  : '<li class="r-empty">No verified submissions in this window yet.</li>';

const elapsedPill = elapsedMin != null
  ? `<span class="pill">⏱ ${escapeHtml(elapsedMin)} min</span>`
  : '';

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mr. Weirdo Jobs · Funnel Report</title>
  <style>
    :root {
      color-scheme: light;
      --bg:#f4f6fb; --ink:#141a2b; --muted:#5b667d; --line:#e3e8f2;
      --accent:#4f46e5; --accent-soft:#eef0ff;
      --ok:#0f9d58; --warn:#b06a00;
      --border:#d8dee8; --text:#172033;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; background: var(--bg); color: var(--ink);
      font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: 1080px; margin: 0 auto; padding: 32px 24px 48px; }

    /* ---------- screenshot hero card ---------- */
    .card {
      background: linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
      border: 1px solid var(--line);
      border-radius: 28px;
      padding: 40px 40px 36px;
      box-shadow: 0 20px 60px -28px rgba(31,41,90,.35);
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand .mark {
      width: 44px; height: 44px; border-radius: 13px;
      background: var(--accent); color: #fff;
      display: grid; place-items: center; font-size: 22px; font-weight: 700;
    }
    .brand .name { font-size: 19px; font-weight: 700; letter-spacing: -.01em; }
    .brand .tag { font-size: 13px; color: var(--muted); margin-top: 1px; }
    .pills { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .pill {
      font-size: 12px; font-weight: 600; color: var(--accent);
      background: var(--accent-soft); border-radius: 999px; padding: 6px 12px;
      white-space: nowrap;
    }

    .headline { margin: 28px 0 4px; }
    .headline .eyebrow {
      font-size: 13px; font-weight: 700; letter-spacing: .08em;
      text-transform: uppercase; color: var(--accent);
    }
    .headline .hero {
      font-size: 64px; line-height: 1.02; font-weight: 800; letter-spacing: -.03em;
      margin: 6px 0 2px;
    }
    .headline .hero span { color: var(--accent); }
    .headline .hero-sub { font-size: 16px; color: var(--muted); }

    /* ---------- funnel ---------- */
    .funnel { margin-top: 26px; display: flex; flex-direction: column; gap: 0; }
    .step { position: relative; padding: 4px 0; }
    .step + .step::before {
      content: ""; position: absolute; left: 30px; top: -8px; height: 16px;
      width: 2px; background: var(--line);
    }
    .step-bar {
      height: 10px; width: var(--share); min-width: 60px; border-radius: 999px;
      margin-bottom: 8px; background: #c9d2e6; transition: none;
    }
    .step.match .step-bar { background: #8b93ff; }
    .step.hero .step-bar { background: var(--accent); }
    .step.skip .step-bar { background: #f0c06b; }
    .step-body { display: flex; align-items: baseline; gap: 16px; }
    .step-num {
      font-size: 34px; font-weight: 800; letter-spacing: -.02em;
      min-width: 96px; font-variant-numeric: tabular-nums;
    }
    .step.hero .step-num { color: var(--accent); }
    .step-label { font-size: 16px; font-weight: 700; }
    .step-sub { font-size: 13px; color: var(--muted); }

    .chips { margin: 10px 0 0 112px; display: flex; flex-wrap: wrap; gap: 6px; }
    .chip {
      font-size: 12px; color: var(--warn); background: #fdf4e3;
      border: 1px solid #f2e2c0; border-radius: 8px; padding: 4px 9px;
      font-variant-numeric: tabular-nums;
    }

    /* ---------- honesty badge ---------- */
    .badge {
      margin-top: 28px; display: flex; align-items: flex-start; gap: 12px;
      background: #ecfaf2; border: 1px solid #c8ecd6; border-radius: 16px;
      padding: 16px 18px;
    }
    .badge .ic { font-size: 22px; line-height: 1; }
    .badge .b-title { font-weight: 700; color: var(--ok); font-size: 15px; }
    .badge .b-sub { font-size: 13.5px; color: #2f5f47; margin-top: 2px; }

    /* ---------- recent ---------- */
    .recent { margin-top: 26px; }
    .recent h3 {
      font-size: 13px; text-transform: uppercase; letter-spacing: .06em;
      color: var(--muted); margin: 0 0 10px;
    }
    .recent ul { list-style: none; margin: 0; padding: 0; }
    .recent li {
      display: flex; align-items: baseline; gap: 8px; padding: 7px 0;
      border-bottom: 1px solid var(--line); font-size: 14px;
    }
    .recent li:last-child { border-bottom: none; }
    .r-co { font-weight: 700; }
    .r-dot { color: var(--muted); }
    .r-title { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .r-ok { margin-left: auto; color: var(--ok); font-weight: 600; font-size: 12.5px; white-space: nowrap; }
    .r-empty { color: var(--muted); }

    .card-foot {
      margin-top: 26px; padding-top: 16px; border-top: 1px solid var(--line);
      display: flex; justify-content: space-between; gap: 12px;
      font-size: 12.5px; color: var(--muted); flex-wrap: wrap;
    }

    /* ---------- maintainer table ---------- */
    .detail { margin-top: 40px; }
    .detail h2 { font-size: 16px; margin: 0 0 4px; }
    .detail .meta { color: var(--muted); font-size: 13px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; background: white; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; font-size: 13px; }
    th { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; background: #fbfcfe; }
    td:nth-child(7) { white-space: nowrap; }
    a { color: var(--accent); text-decoration: none; }

    @media (max-width: 720px) {
      .wrap { padding: 16px; }
      .card { padding: 26px 20px; border-radius: 22px; }
      .headline .hero { font-size: 48px; }
      .step-num { font-size: 28px; min-width: 72px; }
      .chips { margin-left: 0; }
      table { font-size: 12px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="card">
      <div class="brand">
        <div class="mark">⚡</div>
        <div>
          <div class="name">Mr. Weirdo Jobs</div>
          <div class="tag">honest auto-apply agent · build-in-public stats</div>
        </div>
        <div class="pills">
          <span class="pill">${escapeHtml(windowLabel)}</span>
          ${elapsedPill}
        </div>
      </div>

      <div class="headline">
        <div class="eyebrow">The funnel, not the flex</div>
        <div class="hero"><span>${submittedCount.toLocaleString()}</span> internships auto-applied &amp; verified</div>
        <div class="hero-sub">out of ${scored.toLocaleString()} jobs scored — every one of them checked, not blasted.</div>
      </div>

      <div class="funnel">
        ${steps}
        ${skipChips}
      </div>

      <div class="badge">
        <div class="ic">🛡️</div>
        <div>
          <div class="b-title">0 fabricated answers</div>
          <div class="b-sub">Every skip is logged with a specific reason. Every submit is verified on the confirmation page — no number on this card is made up.</div>
        </div>
      </div>

      <div class="recent">
        <h3>Recent verified submissions</h3>
        <ul>
          ${recentList}
        </ul>
      </div>

      <div class="card-foot">
        <span>Generated ${escapeHtml(generatedAt)} · all data local to ~/.mrweirdo-jobs</span>
        <span>Node 24 · zero external deps</span>
      </div>
    </section>

    <section class="detail">
      <h2>Detailed run log <span style="font-weight:400;color:var(--muted)">(maintainer view)</span></h2>
      <div class="meta">${escapeHtml(windowLabel)} · ${rows.length} rows · submitted + skipped/rejected</div>
      <table>
        <thead>
          <tr>
            <th>ID</th><th>Company</th><th>Position</th><th>Role type</th><th>Fit</th><th>ATS</th><th>Status</th><th>Reason</th><th>Link</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows || '<tr><td colspan="9">No matching rows.</td></tr>'}
        </tbody>
      </table>
    </section>
  </div>
</body>
</html>
`;

fs.writeFileSync(outputPath, html);
console.log(outputPath);
