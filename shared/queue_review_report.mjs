#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './local_db.mjs';
import { deriveRoleTypeFromJob, roleTypesFromSearchIntent } from './role_types.mjs';
import { normalizeCompany, normalizeTitle, SUBMITTED_STATUSES } from './job_identity.mjs';

const HOME = process.env.MRWEIRDO_HOME || path.join(process.env.HOME || '', '.mrweirdo-jobs');
const MIN_FIT = Math.max(0, Number(process.env.MRWEIRDO_MIN_FIT_SCORE || 5));
const SUPPORTED_AUTO = new Set(['greenhouse', 'ashby']);

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function readIntent() {
  try {
    return JSON.parse(fs.readFileSync(path.join(HOME, 'search_intent.json'), 'utf8'));
  } catch {
    return { search_intent: { seniority: 'intern' } };
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function duplicateKey(row) {
  return `${normalizeCompany(row.company)}::${normalizeTitle(row.title)}`;
}

function rowHtml(row, note = '') {
  const url = row.apply_url || '';
  return `<tr>
    <td>${escapeHtml(row.id)}</td>
    <td>${escapeHtml(row.company)}</td>
    <td>${escapeHtml(row.title)}</td>
    <td>${escapeHtml(row.fit_score)}</td>
    <td>${escapeHtml(row.ats_platform)}</td>
    <td>${escapeHtml(deriveRoleTypeFromJob(row))}</td>
    <td>${escapeHtml(note)}</td>
    <td><a href="${escapeHtml(url)}">${escapeHtml(url ? 'open' : '')}</a></td>
  </tr>`;
}

function section(title, subtitle, rows, noteForRow) {
  return `<section>
    <header>
      <h2>${escapeHtml(title)} <span>${rows.length}</span></h2>
      <p>${escapeHtml(subtitle)}</p>
    </header>
    <table>
      <thead>
        <tr><th>ID</th><th>Company</th><th>Position</th><th>Fit</th><th>ATS</th><th>Role</th><th>Note</th><th>Link</th></tr>
      </thead>
      <tbody>
        ${rows.map((row) => rowHtml(row, noteForRow(row))).join('\n') || '<tr><td colspan="8">No rows.</td></tr>'}
      </tbody>
    </table>
  </section>`;
}

const outputArg = argValue('--output');
const limit = Math.max(1, Number(argValue('--limit', '200')));
const reportsDir = path.join(HOME, 'reports');
const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
const outputPath = outputArg || path.join(reportsDir, `queue-review-${stamp}.html`);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const allowedRoleTypes = roleTypesFromSearchIntent(readIntent().search_intent || {});
const db = new DatabaseSync(dbPath());
const submittedKeys = new Set(
  db.prepare(`
    SELECT company, title
      FROM jobs
     WHERE status IN (${[...SUBMITTED_STATUSES].map(() => '?').join(',')})
  `).all(...SUBMITTED_STATUSES)
    .map((r) => `${normalizeCompany(r.company)}::${normalizeTitle(r.title)}`)
);

const rows = db.prepare(`
  SELECT id, company, title, apply_url, ats_platform, status, fit_score,
         role_type_match, apply_quota_limit, updated_at
    FROM jobs
   WHERE status = '🤖 AI sourced'
     AND fit_score IS NOT NULL
   ORDER BY fit_score DESC, updated_at DESC, id ASC
`).all();

const candidates = rows
  .map((row) => ({ ...row, derived_role_type: deriveRoleTypeFromJob(row) }))
  .filter((row) => allowedRoleTypes.includes(row.derived_role_type))
  .filter((row) => row.apply_quota_limit == null)
  .filter((row) => !submittedKeys.has(duplicateKey(row)));

const ready = candidates
  .filter((row) => SUPPORTED_AUTO.has(row.ats_platform) && (row.fit_score ?? 0) >= MIN_FIT)
  .slice(0, limit);

const rescore = candidates
  .filter((row) => SUPPORTED_AUTO.has(row.ats_platform) && (row.fit_score ?? 0) === MIN_FIT - 1)
  .slice(0, limit);

const platformExpansion = candidates
  .filter((row) => !SUPPORTED_AUTO.has(row.ats_platform) && (row.fit_score ?? 0) >= MIN_FIT)
  .slice(0, limit);

const generatedAt = new Date().toLocaleString();
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mr. Weirdo Jobs Queue Review</title>
  <style>
    :root { color-scheme: light; --border:#d8dee8; --text:#172033; --muted:#5b6678; --bg:#f7f9fc; --card:#ffffff; --accent:#1358a8; }
    body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: var(--bg); }
    body > header { padding: 28px 32px 18px; background: var(--card); border-bottom: 1px solid var(--border); }
    h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: 0; }
    .meta { color: var(--muted); }
    .summary { display: grid; grid-template-columns: repeat(3, minmax(140px, 1fr)); gap: 12px; padding: 18px 32px; }
    .metric { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
    .metric strong { display: block; font-size: 24px; }
    .metric span { color: var(--muted); }
    main { padding: 0 32px 32px; }
    section { margin: 0 0 24px; }
    section header { margin: 0 0 10px; }
    h2 { margin: 0; font-size: 18px; letter-spacing: 0; }
    h2 span { color: var(--muted); font-weight: 500; }
    p { margin: 4px 0 0; color: var(--muted); }
    table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--border); }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
    th { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; background: #fbfcfe; }
    a { color: var(--accent); text-decoration: none; }
    @media (max-width: 900px) {
      body > header, main { padding-left: 16px; padding-right: 16px; }
      .summary { grid-template-columns: 1fr; padding: 16px; }
      table { font-size: 12px; }
      th, td { padding: 8px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Mr. Weirdo Jobs Queue Review</h1>
    <div class="meta">Generated ${escapeHtml(generatedAt)} · Role targets: ${escapeHtml(allowedRoleTypes.join(', '))} · Auto threshold: fit >= ${escapeHtml(MIN_FIT)}</div>
  </header>
  <div class="summary">
    <div class="metric"><strong>${ready.length}</strong><span>Ready to auto-apply</span></div>
    <div class="metric"><strong>${rescore.length}</strong><span>Fit ${MIN_FIT - 1} review candidates</span></div>
    <div class="metric"><strong>${platformExpansion.length}</strong><span>ATS expansion candidates</span></div>
  </div>
  <main>
    ${section('Ready To Auto-Apply', 'These pending rows meet role, fit, ATS, quota, and duplicate guards.', ready, () => 'Eligible now')}
    ${section(`Review: Fit ${MIN_FIT - 1} Candidates`, `These rows would enter the queue if a human agrees they should be re-scored to ${MIN_FIT}.`, rescore, () => 'Needs human re-score')}
    ${section('ATS Expansion Candidates', 'These rows fit the target role and score threshold but are blocked by unsupported ATS automation.', platformExpansion, (row) => `Unsupported ATS: ${row.ats_platform || 'unknown'}`)}
  </main>
</body>
</html>
`;

fs.writeFileSync(outputPath, html);
console.log(outputPath);
