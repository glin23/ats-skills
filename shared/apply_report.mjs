#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './local_db.mjs';

const HOME = process.env.MRWEIRDO_HOME || path.join(process.env.HOME || '', '.mrweirdo-jobs');

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
    table { width: 100%; border-collapse: collapse; background: white; border: 1px solid var(--border); }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
    th { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; background: #fbfcfe; }
    td:nth-child(7) { white-space: nowrap; }
    a { color: #1358a8; text-decoration: none; }
    @media (max-width: 900px) {
      .summary { grid-template-columns: repeat(2, minmax(120px, 1fr)); padding: 16px; }
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
