#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath, initDb } from './local_db.mjs';
import { atsHome } from './paths.mjs';

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function splitGaps(value) {
  return String(value || '')
    .split(/\s+\/\s+|\n+|;+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeGap(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.。]+$/g, '')
    .trim();
}

function weightForFit(fitScore) {
  const score = Number(fitScore ?? 0);
  if (!Number.isFinite(score)) return 1;
  return Math.max(0, Number(((10 - score) / 10).toFixed(3)));
}

function topCompanies(rows, limit = 5) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const label = `${row.company || 'Unknown'} - ${row.title || 'Unknown role'}`;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ row_id: row.id, company: row.company, title: row.title, fit_score: row.fit_score });
    if (out.length >= limit) break;
  }
  return out;
}

function latestPreviousJson(reportsDir, currentDate) {
  if (!existsSync(reportsDir)) return null;
  const files = readdirSync(reportsDir)
    .filter((name) => /^upskill-\d{4}-\d{2}-\d{2}\.json$/.test(name) && !name.includes(currentDate))
    .sort()
    .reverse();
  for (const file of files) {
    try {
      return { path: join(reportsDir, file), data: JSON.parse(readFileSync(join(reportsDir, file), 'utf8')) };
    } catch {
      // skip malformed previous reports
    }
  }
  return null;
}

function diffAgainstPrevious(current, previous) {
  if (!previous?.data?.heatmap) return [];
  const previousByGap = new Map();
  for (const role of previous.data.heatmap || []) {
    for (const gap of role.gaps || []) previousByGap.set(`${role.role_category}::${gap.gap}`, gap.weighted_count);
  }
  const changes = [];
  for (const role of current.heatmap || []) {
    for (const gap of role.gaps || []) {
      const key = `${role.role_category}::${gap.gap}`;
      const before = previousByGap.get(key) || 0;
      const delta = Number((gap.weighted_count - before).toFixed(3));
      if (delta !== 0) changes.push({ role_category: role.role_category, gap: gap.gap, before, after: gap.weighted_count, delta });
    }
  }
  return changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 12);
}

export function buildUpskillReport(rows, { generatedAt = new Date().toISOString(), previous = null } = {}) {
  const byRole = new Map();
  for (const row of rows) {
    const role = row.role_type_match || 'unknown';
    if (!byRole.has(role)) byRole.set(role, new Map());
    const gaps = byRole.get(role);
    for (const rawGap of splitGaps(row.key_gaps)) {
      const gap = normalizeGap(rawGap);
      if (!gap) continue;
      if (!gaps.has(gap)) gaps.set(gap, { gap, weighted_count: 0, mentions: 0, examples: [] });
      const entry = gaps.get(gap);
      entry.weighted_count = Number((entry.weighted_count + weightForFit(row.fit_score)).toFixed(3));
      entry.mentions += 1;
      entry.examples.push(row);
    }
  }

  const report = {
    ok: true,
    generated_at: generatedAt,
    db_path: dbPath(),
    rows_scanned: rows.length,
    heatmap: [...byRole.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([role, gaps]) => ({
        role_category: role,
        gaps: [...gaps.values()]
          .sort((a, b) => b.weighted_count - a.weighted_count || b.mentions - a.mentions || a.gap.localeCompare(b.gap))
          .slice(0, 12)
          .map((entry) => ({
            gap: entry.gap,
            weighted_count: Number(entry.weighted_count.toFixed(3)),
            mentions: entry.mentions,
            examples: topCompanies(entry.examples),
          })),
      })),
    previous_report: previous?.path || null,
    diff: [],
  };
  report.diff = diffAgainstPrevious(report, previous);
  return report;
}

function renderMarkdown(report) {
  const lines = [
    '# Mr. Weirdo Jobs Upskill Report',
    '',
    `Generated: ${report.generated_at}`,
    `Rows scanned: ${report.rows_scanned}`,
    '',
  ];
  if (!report.heatmap.length || report.heatmap.every((role) => !role.gaps.length)) {
    lines.push('No key gaps found yet. Score more jobs before using this report.');
    return lines.join('\n');
  }
  for (const role of report.heatmap) {
    lines.push(`## ${role.role_category}`, '');
    if (!role.gaps.length) {
      lines.push('_No gaps for this role._', '');
      continue;
    }
    lines.push('| Gap | Weighted Count | Mentions | Examples |', '|---|---:|---:|---|');
    for (const gap of role.gaps) {
      const examples = gap.examples.map((ex) => `${ex.company} (${ex.fit_score ?? '?'})`).join('; ');
      lines.push(`| ${gap.gap.replace(/\|/g, '\\|')} | ${gap.weighted_count} | ${gap.mentions} | ${examples.replace(/\|/g, '\\|')} |`);
    }
    lines.push('');
  }
  if (report.previous_report) {
    lines.push('## Diff From Previous', '');
    if (!report.diff.length) lines.push('_No changes._');
    for (const item of report.diff) {
      lines.push(`- ${item.role_category}: ${item.gap} (${item.before} -> ${item.after}, delta ${item.delta})`);
    }
  }
  return lines.join('\n');
}

function readRows() {
  initDb();
  const db = new DatabaseSync(dbPath());
  return db.prepare(`
    SELECT id, company, title, fit_score, role_type_match, key_gaps
      FROM jobs
     WHERE key_gaps IS NOT NULL
       AND trim(key_gaps) <> ''
  `).all();
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const date = argValue('--date', todayIso());
  const reportsDir = join(atsHome(), 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const previous = latestPreviousJson(reportsDir, date);
  const report = buildUpskillReport(readRows(), { previous });
  const jsonPath = join(reportsDir, `upskill-${date}.json`);
  const mdPath = join(reportsDir, `upskill-${date}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, renderMarkdown(report));
  if (hasArg('--json')) console.log(JSON.stringify({ ok: true, json_path: jsonPath, report_path: mdPath, rows_scanned: report.rows_scanned }, null, 2));
  else console.log(mdPath);
}
