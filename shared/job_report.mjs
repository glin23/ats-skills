#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath, initDb } from './local_db.mjs';
import { atsHome } from './paths.mjs';
import { DEFAULT_OUTCOME_STATUS } from './constants.mjs';
import { onboardTmpPath } from './onboard_tmp.mjs';

const MACHINE_KEYS = new Set([
  'row_id',
  'company',
  'title',
  'fit_score',
  'dim_scores',
  'legitimacy',
  'outcome_status',
  'ats_platform',
  'submitted_at',
  'gap_fields',
]);

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function slugify(value) {
  const slug = String(value || 'job')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'job';
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function readJsonLines(path) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      out.push(JSON.parse(trimmed.slice(start, end + 1)));
    } catch {
      // keep report generation tolerant of mixed human/JSON driver logs
    }
  }
  return out;
}

function collectStrings(value, predicate, out = new Set()) {
  if (typeof value === 'string') {
    if (predicate(value)) out.add(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, predicate, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, predicate, out);
  }
  return out;
}

function compact(value, max = 160) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function splitGaps(value) {
  return String(value || '')
    .split(/\s+\/\s+|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function summarizeSubmission(rowId) {
  const resultFile = onboardTmpPath(`apply-result-${rowId}.jsonl`);
  const entries = readJsonLines(resultFile);
  const latest = [...entries].reverse().find((entry) => entry?.outcome || entry?.action) || null;
  const screenshots = [...collectStrings(entries, (s) => /\.(png|jpe?g)$/i.test(s) || s.includes('/screenshots/'))];
  const gapFields = [...collectStrings(entries, (s) => /required|missing|incomplete|gap/i.test(s))]
    .map((s) => compact(s, 96))
    .slice(0, 8);
  return {
    result_file: existsSync(resultFile) ? resultFile : null,
    latest,
    screenshots,
    gap_fields: gapFields,
  };
}

function mdEscape(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}

function renderDimTable(dimScores) {
  const dim = dimScores && typeof dimScores === 'object' ? dimScores : {};
  const rows = Object.entries(dim);
  if (!rows.length) return '_暂无维度分数 / No dimension scores stored._';
  return [
    '| 维度 / Dimension | 分数 / Score |',
    '|---|---:|',
    ...rows.map(([key, value]) => `| ${mdEscape(key)} | ${mdEscape(value)} |`),
  ].join('\n');
}

function renderKeyValueTable(rows) {
  return [
    '| 项目 | 内容 |',
    '|---|---|',
    ...rows.map(([key, value]) => `| ${mdEscape(key)} | ${mdEscape(value || '-')} |`),
  ].join('\n');
}

function yamlValue(value) {
  if (value == null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function renderMachineSummary(row, { dimScores, gapFields }) {
  const data = {
    row_id: row.id,
    company: row.company || '',
    title: row.title || '',
    fit_score: row.fit_score ?? null,
    dim_scores: dimScores || {},
    legitimacy: row.legitimacy || 'high',
    outcome_status: row.outcome_status || DEFAULT_OUTCOME_STATUS,
    ats_platform: row.ats_platform || '',
    submitted_at: row.submitted_at || row.auto_submitted_at || null,
    gap_fields: gapFields || [],
  };
  return [
    '<details>',
    '<summary>Machine Summary / tooling</summary>',
    '',
    '## Machine Summary',
    '',
    '```yaml',
    ...Object.entries(data).map(([key, value]) => `${key}: ${yamlValue(value)}`),
    '```',
    '',
    '</details>',
  ].join('\n');
}

function renderSubmissionAudit(submission, submittedAt) {
  const latest = submission.latest || null;
  const outcome = latest
    ? [latest.outcome || latest.action || 'unknown', latest.reason || latest.post_url || latest.url || ''].filter(Boolean).join(' / ')
    : '';
  const rows = [
    ['结果文件 / Result file', submission.result_file || 'not found'],
    ['记录结果 / Recorder outcome', outcome || 'not found'],
    ['提交时间 / Submitted at', submittedAt || 'not recorded'],
  ];
  const table = renderKeyValueTable(rows);
  const screenshots = submission.screenshots?.length
    ? ['截图 / Screenshots', ...submission.screenshots.map((shot) => `- ${shot}`)].join('\n')
    : '';
  return screenshots ? `${table}\n\n${screenshots}` : table;
}

export function parseMachineSummary(markdown) {
  const match = String(markdown || '').match(/## Machine Summary\s+```yaml\s+([\s\S]*?)```/m);
  if (!match) throw new Error('missing Machine Summary yaml block');
  const out = {};
  for (const raw of match[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sep = line.indexOf(':');
    if (sep <= 0) throw new Error(`invalid yaml line: ${line}`);
    const key = line.slice(0, sep);
    if (!MACHINE_KEYS.has(key)) throw new Error(`machine summary key not allowed: ${key}`);
    const rawValue = line.slice(sep + 1).trim();
    try {
      out[key] = JSON.parse(rawValue);
    } catch {
      if (rawValue === 'null') out[key] = null;
      else if (/^-?\d+(?:\.\d+)?$/.test(rawValue)) out[key] = Number(rawValue);
      else out[key] = rawValue;
    }
  }
  return out;
}

function renderReport(row, { appendSubmission = false } = {}) {
  const dimScores = parseJson(row.dim_scores, {});
  const legitimacySignals = parseJson(row.legitimacy_signals, []);
  const submission = appendSubmission ? summarizeSubmission(row.id) : { gap_fields: [] };
  const keyAlignment = splitGaps(row.key_alignment);
  const keyGaps = splitGaps(row.key_gaps);
  const gapFields = [...new Set([...keyGaps, ...(submission.gap_fields || [])])];
  const submittedAt = row.submitted_at || row.auto_submitted_at || '';
  const headerMeta = [
    `Row ${row.id}`,
    row.ats_platform || 'ATS unknown',
    row.fit_score != null ? `fit ${row.fit_score}` : 'fit n/a',
    row.status || 'status unknown',
  ].filter(Boolean).join(' | ');

  const sections = [
    `# 岗位快照 / Job Snapshot - ${row.company || 'Unknown Company'} - ${row.title || 'Unknown Role'}`,
    '',
    `> ${headerMeta}`,
    '',
    '## 1. 岗位信息 / Job',
    '',
    renderKeyValueTable([
      ['Company', row.company || ''],
      ['Role', row.title || ''],
      ['Location', row.location || ''],
      ['ATS', row.ats_platform || ''],
      ['Source', row.search_source || row.source || ''],
      ['Apply URL', row.apply_url || ''],
    ]),
    '',
    '## 2. 匹配摘要 / Fit',
    '',
    renderKeyValueTable([
      ['Fit score', row.fit_score ?? ''],
      ['Role type', row.role_type_match || ''],
      ['Key alignment', keyAlignment.length ? keyAlignment.join(' / ') : 'none recorded'],
    ]),
    '',
    '## 3. 评分维度 / Score Breakdown',
    '',
    renderDimTable(dimScores),
    '',
    '## 4. 缺口 / Gaps',
    '',
    keyGaps.length ? keyGaps.map((gap) => `- ${gap}`).join('\n') : '_暂无关键缺口 / No key gaps stored._',
    '',
    '## 5. 安全信号 / Safety',
    '',
    renderKeyValueTable([
      ['Legitimacy', row.legitimacy || 'high'],
      ['Signals', Array.isArray(legitimacySignals) && legitimacySignals.length ? legitimacySignals.slice(0, 2).join(' / ') : 'none recorded'],
    ]),
    '',
    '## 6. 提交记录 / Submission',
    '',
    appendSubmission ? renderSubmissionAudit(submission, submittedAt) : '_本报告尚未追加提交记录 / No submission audit appended yet._',
    '',
    renderMachineSummary(row, { dimScores, gapFields }),
    '',
  ];

  return sections.join('\n');
}

function selectByRowId(db, rowId) {
  return db.prepare(`
    SELECT id, company, title, apply_url, location, source, search_source,
           ats_platform, fit_score, key_alignment, key_gaps, role_type_match, dim_scores,
           legitimacy, legitimacy_signals, status, outcome_status,
           submitted_at, auto_submitted_at, report_path, discovery_run_id
      FROM jobs
     WHERE id = ?
  `).get(rowId);
}

function selectBatch(db, runId) {
  if (runId) {
    return db.prepare(`
      SELECT id, company, title, apply_url, location, source, search_source,
             ats_platform, fit_score, key_alignment, key_gaps, role_type_match, dim_scores,
             legitimacy, legitimacy_signals, status, outcome_status,
             submitted_at, auto_submitted_at, report_path, discovery_run_id
        FROM jobs
       WHERE discovery_run_id = ?
         AND fit_score IS NOT NULL
       ORDER BY fit_score DESC, id ASC
    `).all(runId);
  }
  return db.prepare(`
    SELECT id, company, title, apply_url, location, source, search_source,
           ats_platform, fit_score, key_alignment, key_gaps, role_type_match, dim_scores,
           legitimacy, legitimacy_signals, status, outcome_status,
           submitted_at, auto_submitted_at, report_path, discovery_run_id
      FROM jobs
     WHERE fit_score IS NOT NULL
       AND (COALESCE(auto_apply_eligible, 0) = 1 OR status IN ('✅ 已投', '✅ 已确认'))
     ORDER BY fit_score DESC, id ASC
  `).all();
}

function writeReport(db, row, opts = {}) {
  const reportsDir = join(atsHome(), 'reports', 'jobs');
  mkdirSync(reportsDir, { recursive: true });
  const outputPath = join(reportsDir, `${row.id}-${slugify(row.company)}.md`);
  const markdown = renderReport(row, opts);
  parseMachineSummary(markdown);
  writeFileSync(outputPath, markdown);
  db.prepare(`UPDATE jobs SET report_path = ? WHERE id = ?`).run(outputPath, row.id);
  return outputPath;
}

function runSelfTest() {
  const markdown = renderMachineSummary({
    id: 1,
    company: 'Acme',
    title: 'Intern',
    fit_score: 8,
    legitimacy: 'high',
    outcome_status: 'pending',
    ats_platform: 'greenhouse',
    submitted_at: null,
  }, { dimScores: { role_fit: 8 }, gapFields: ['SQL missing'] });
  const parsed = parseMachineSummary(markdown);
  if (parsed.row_id !== 1 || parsed.company !== 'Acme') throw new Error('self-test parse mismatch');
  for (const key of Object.keys(parsed)) {
    if (!MACHINE_KEYS.has(key)) throw new Error(`unexpected key ${key}`);
  }
  return { ok: true, parsed };
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  try {
    if (hasArg('--self-test')) {
      console.log(JSON.stringify(runSelfTest(), null, 2));
      process.exit(0);
    }

    const rowId = Number(argValue('--row-id') || 0);
    const batch = hasArg('--batch');
    if (!rowId && !batch) {
      console.error('Usage: node shared/job_report.mjs --row-id <id> [--append-submission] | --batch [--run-id <id>] | --self-test');
      process.exit(2);
    }

    initDb();
    const db = new DatabaseSync(dbPath());
    const opts = { appendSubmission: hasArg('--append-submission') };
    const paths = [];
    if (rowId) {
      const row = selectByRowId(db, rowId);
      if (!row) throw new Error(`row not found: ${rowId}`);
      paths.push(writeReport(db, row, opts));
    } else {
      for (const row of selectBatch(db, argValue('--run-id'))) {
        paths.push(writeReport(db, row, opts));
      }
    }
    if (hasArg('--json')) console.log(JSON.stringify({ ok: true, paths }, null, 2));
    else console.log(paths.join('\n'));
  } catch (e) {
    console.error(`[job-report] ${e.message}`);
    process.exit(1);
  }
}
