#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath, initDb } from './local_db.mjs';
import { atsHome } from './paths.mjs';

const HOME = atsHome();

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
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

const since = argValue('--since', todayIso());
const outputArg = argValue('--output');
const reportsDir = path.join(HOME, 'reports');
const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
const outputPath = outputArg || path.join(reportsDir, `apply-report-${stamp}.html`);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

initDb();
const db = new DatabaseSync(dbPath());
const rows = db.prepare(`
  SELECT id, company, title, apply_url, ats_platform, fit_score, role_type_match,
         status, skip_reason, submitted_at, auto_submitted_at, confirmed_at,
         confirmation_url, updated_at
    FROM jobs
   WHERE date(COALESCE(submitted_at, auto_submitted_at, updated_at, created_at)) >= date(?)
     AND status IN ('✅ 已投', '✅ 已确认', '⚠️ 跳过未投', '❌ Rejected')
   ORDER BY
     CASE WHEN status IN ('✅ 已投', '✅ 已确认') THEN 0 ELSE 1 END,
     COALESCE(submitted_at, auto_submitted_at, updated_at) DESC,
     id DESC
`).all(since);

const funnel = db.prepare(`
  SELECT
    COUNT(*) AS total_rows,
    SUM(CASE WHEN status = '🤖 AI sourced' THEN 1 ELSE 0 END) AS pending_discovered,
    SUM(CASE WHEN COALESCE(auto_apply_eligible, 0) = 1 THEN 1 ELSE 0 END) AS auto_eligible,
    SUM(CASE WHEN status IN ('✅ 已投', '✅ 已确认') THEN 1 ELSE 0 END) AS submitted_or_confirmed,
    SUM(CASE WHEN status = '✅ 已确认' THEN 1 ELSE 0 END) AS confirmed_total,
    SUM(CASE WHEN status IN ('⚠️ 跳过未投', '❌ Rejected') THEN 1 ELSE 0 END) AS skipped_or_rejected,
    SUM(CASE WHEN apply_quota_limit IS NOT NULL THEN 1 ELSE 0 END) AS quota_guarded,
    SUM(CASE WHEN lower(COALESCE(legitimacy, 'high')) = 'suspicious' THEN 1 ELSE 0 END) AS suspicious,
    SUM(CASE WHEN lower(COALESCE(liveness_status, '')) = 'expired' THEN 1 ELSE 0 END) AS expired_liveness
  FROM jobs
`).get();

const submitted = rows.filter((r) => r.status === '✅ 已投' || r.status === '✅ 已确认');
const skipped = rows.filter((r) => r.status === '⚠️ 跳过未投' || r.status === '❌ Rejected');
const confirmed = rows.filter((r) => r.status === '✅ 已确认');
const generatedAt = new Date().toLocaleString();

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

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mr. Weirdo Jobs Application Report</title>
  <style>
    :root { color-scheme: light; --border:#d8dee8; --text:#172033; --muted:#5b6678; --ok:#0f7a4f; --warn:#9b5b00; }
    body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: #f7f9fc; }
    header { padding: 28px 32px 18px; background: white; border-bottom: 1px solid var(--border); }
    h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: 0; }
    .meta { color: var(--muted); }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 12px; padding: 18px 32px; }
    .metric { background: white; border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
    .metric strong { display: block; font-size: 24px; }
    .metric span { color: var(--muted); }
    main { padding: 0 32px 32px; }
    .funnel { background: white; border: 1px solid var(--border); margin: 0 32px 18px; padding: 14px 16px; }
    .funnel h2 { margin: 0 0 10px; font-size: 16px; }
    .funnel-grid { display: grid; grid-template-columns: repeat(5, minmax(110px, 1fr)); gap: 10px; }
    .funnel-grid div { color: var(--muted); }
    .funnel-grid strong { display: block; color: var(--text); font-size: 20px; }
    table { width: 100%; border-collapse: collapse; background: white; border: 1px solid var(--border); }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
    th { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; background: #fbfcfe; }
    td:nth-child(7) { white-space: nowrap; }
    a { color: #1358a8; text-decoration: none; }
    @media (max-width: 900px) {
      .summary { grid-template-columns: repeat(2, minmax(120px, 1fr)); padding: 16px; }
      .funnel { margin: 0 16px 16px; }
      .funnel-grid { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
      header, main { padding-left: 16px; padding-right: 16px; }
      table { font-size: 12px; }
      th, td { padding: 8px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Mr. Weirdo Jobs Application Report</h1>
    <div class="meta">Generated ${escapeHtml(generatedAt)} · Since ${escapeHtml(since)} · Local-only user data</div>
  </header>
  <section class="summary">
    <div class="metric"><strong>${rows.length}</strong><span>Total rows</span></div>
    <div class="metric"><strong>${submitted.length}</strong><span>Submitted</span></div>
    <div class="metric"><strong>${confirmed.length}</strong><span>Email confirmed</span></div>
    <div class="metric"><strong>${skipped.length}</strong><span>Skipped / rejected</span></div>
  </section>
  <section class="funnel">
    <h2>Funnel</h2>
    <div class="funnel-grid">
      <div><strong>${escapeHtml(funnel.total_rows || 0)}</strong>Total DB rows</div>
      <div><strong>${escapeHtml(funnel.pending_discovered || 0)}</strong>Pending discovered</div>
      <div><strong>${escapeHtml(funnel.auto_eligible || 0)}</strong>Auto eligible now</div>
      <div><strong>${escapeHtml(funnel.quota_guarded || 0)}</strong>Quota guarded</div>
      <div><strong>${escapeHtml(funnel.suspicious || 0)}</strong>Suspicious review</div>
      <div><strong>${escapeHtml(funnel.expired_liveness || 0)}</strong>Expired liveness</div>
      <div><strong>${escapeHtml(funnel.submitted_or_confirmed || 0)}</strong>Submitted total</div>
      <div><strong>${escapeHtml(funnel.confirmed_total || 0)}</strong>Confirmed total</div>
      <div><strong>${escapeHtml(funnel.skipped_or_rejected || 0)}</strong>Skipped / rejected</div>
    </div>
  </section>
  <main>
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
  </main>
</body>
</html>
`;

fs.writeFileSync(outputPath, html);
console.log(outputPath);
