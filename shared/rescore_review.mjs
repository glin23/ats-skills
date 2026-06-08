#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './local_db.mjs';
import { atsHome } from './paths.mjs';
import { deriveRoleTypeFromJob, roleTypesFromSearchIntent } from './role_types.mjs';
import { normalizeCompany, normalizeTitle, SUBMITTED_STATUSES } from './job_identity.mjs';
import { SUPPORTED_AUTO_PLATFORMS } from './sourcing/apply_url_classification.mjs';

const HOME = atsHome();
const MIN_FIT = Math.max(0, Number(process.env.MRWEIRDO_MIN_FIT_SCORE || 5));
const SUPPORTED_AUTO = new Set(SUPPORTED_AUTO_PLATFORMS);

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
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

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function duplicateKey(row) {
  return `${normalizeCompany(row.company)}::${normalizeTitle(row.title)}`;
}

function idsFromArg(value) {
  return String(value || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function candidateShape(row) {
  return {
    id: row.id,
    company: row.company,
    title: row.title,
    ats_platform: row.ats_platform,
    fit_score: row.fit_score,
    target_fit_score: MIN_FIT,
    role_type: deriveRoleTypeFromJob(row),
    apply_url: row.apply_url,
  };
}

function htmlReport(rows, outputPath, allowedRoleTypes) {
  const ids = rows.map((r) => r.id).join(',');
  const command = ids
    ? `node shared/rescore_review.mjs --promote ${ids} --apply`
    : 'No rows to promote.';
  const bodyRows = rows.map((row) => `<tr>
    <td>${escapeHtml(row.id)}</td>
    <td>${escapeHtml(row.company)}</td>
    <td>${escapeHtml(row.title)}</td>
    <td>${escapeHtml(row.fit_score)} -> ${escapeHtml(MIN_FIT)}</td>
    <td>${escapeHtml(row.ats_platform)}</td>
    <td>${escapeHtml(deriveRoleTypeFromJob(row))}</td>
    <td><a href="${escapeHtml(row.apply_url)}">open</a></td>
  </tr>`).join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mr. Weirdo Jobs Rescore Review</title>
  <style>
    :root { color-scheme: light; --bg:#f7f9fc; --card:#fff; --text:#172033; --muted:#667085; --border:#d8dee8; --accent:#1358a8; }
    body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    header { padding: 28px 32px 18px; background: var(--card); border-bottom: 1px solid var(--border); }
    h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: 0; }
    .meta, p { color: var(--muted); }
    main { padding: 22px 32px 32px; }
    .command { margin: 0 0 18px; padding: 14px; border: 1px solid var(--border); background: var(--card); border-radius: 8px; }
    code { overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--border); }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
    th { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; background: #fbfcfe; }
    a { color: var(--accent); text-decoration: none; }
  </style>
</head>
<body>
  <header>
    <h1>Mr. Weirdo Jobs Rescore Review</h1>
    <div class="meta">Generated ${escapeHtml(new Date().toLocaleString())} · Role targets: ${escapeHtml(allowedRoleTypes.join(', '))} · Rows: ${rows.length}</div>
  </header>
  <main>
    <div class="command">
      <p>After reviewing these rows, promote only the IDs you actually want to include in auto-apply.</p>
      <code>${escapeHtml(command)}</code>
    </div>
    <table>
      <thead>
        <tr><th>ID</th><th>Company</th><th>Position</th><th>Fit</th><th>ATS</th><th>Role</th><th>Link</th></tr>
      </thead>
      <tbody>${bodyRows || '<tr><td colspan="7">No rows.</td></tr>'}</tbody>
    </table>
  </main>
</body>
</html>
`;
  fs.writeFileSync(outputPath, html);
}

function csvReport(rows, outputPath) {
  const header = ['id', 'company', 'title', 'fit_score', 'target_fit_score', 'ats_platform', 'role_type', 'apply_url'];
  const lines = [header.join(',')];
  for (const row of rows) {
    const shaped = candidateShape(row);
    lines.push(header.map((key) => csvCell(shaped[key])).join(','));
  }
  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`);
}

const outputArg = argValue('--output');
const format = hasArg('--json') ? 'json' : hasArg('--csv') ? 'csv' : 'html';
const limit = Math.max(1, Number(argValue('--limit', '200')));
const promoteIds = idsFromArg(argValue('--promote'));
const apply = hasArg('--apply');
const reportsDir = path.join(HOME, 'reports');
const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
const outputPath = outputArg || path.join(reportsDir, `rescore-review-${stamp}.${format === 'csv' ? 'csv' : 'html'}`);

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
     AND fit_score = ?
   ORDER BY updated_at DESC, id ASC
`).all(MIN_FIT - 1);

const candidates = rows
  .map((row) => ({ ...row, derived_role_type: deriveRoleTypeFromJob(row) }))
  .filter((row) => allowedRoleTypes.includes(row.derived_role_type))
  .filter((row) => SUPPORTED_AUTO.has(row.ats_platform))
  .filter((row) => row.apply_quota_limit == null)
  .filter((row) => !submittedKeys.has(duplicateKey(row)));

const candidateIds = new Set(candidates.map((row) => row.id));

if (promoteIds.length) {
  const invalidIds = promoteIds.filter((id) => !candidateIds.has(id));
  if (invalidIds.length) {
    console.error(`Refusing to promote row IDs that are not in this review: ${invalidIds.join(',')}`);
    process.exit(1);
  }

  const selected = candidates.filter((row) => promoteIds.includes(row.id));
  if (!apply) {
    console.log(JSON.stringify({ ok: true, dry_run: true, would_promote: selected.map(candidateShape) }, null, 2));
    process.exit(0);
  }

  const update = db.prepare(`
    UPDATE jobs
       SET fit_score = ?,
           auto_apply_eligible = 1,
           user_note = trim(COALESCE(user_note, '') || char(10) || ?),
           updated_at = datetime('now')
     WHERE id = ?
  `);
  const feedback = db.prepare(`
    INSERT INTO feedback(job_id, outcome, reason, detail)
    VALUES (?, 'rescore_promoted', 'human_rescore_fit_to_threshold', ?)
  `);

  db.exec('BEGIN');
  try {
    for (const row of selected) {
      const note = `Promoted by rescore_review from fit ${MIN_FIT - 1} to ${MIN_FIT} at ${new Date().toISOString()}.`;
      update.run(MIN_FIT, note, row.id);
      feedback.run(row.id, JSON.stringify(candidateShape(row)));
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  console.log(JSON.stringify({ ok: true, promoted: selected.map(candidateShape) }, null, 2));
  process.exit(0);
}

const limited = candidates.slice(0, limit);
if (format === 'json') {
  console.log(JSON.stringify({
    ok: true,
    min_fit: MIN_FIT,
    promote_from_fit: MIN_FIT - 1,
    allowed_role_types: allowedRoleTypes,
    count: limited.length,
    candidates: limited.map(candidateShape),
  }, null, 2));
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (format === 'csv') csvReport(limited, outputPath);
  else htmlReport(limited, outputPath, allowedRoleTypes);
  console.log(outputPath);
}
