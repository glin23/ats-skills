#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath, initDb } from './local_db.mjs';
import { atsHome } from './paths.mjs';
import { DEFAULT_OUTCOME_STATUS } from './constants.mjs';

const TMP = '/tmp/mrweirdo-onboard';

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

function bucketFit(score) {
  const n = Number(score ?? 0);
  if (n >= 8) return '8-10';
  if (n >= 5) return '5-7';
  if (n >= 1) return '1-4';
  return 'missing';
}

function splitGaps(value) {
  return String(value || '')
    .split(/\s+\/\s+|\n+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function bump(obj, key, by = 1) {
  const k = String(key || 'unknown');
  obj[k] = (obj[k] || 0) + by;
}

function summarizeGroup(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(keyFn(row) || 'unknown');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([key, items]) => {
      const submitted = items.filter((r) => r.status === '✅ 已投' || r.status === '✅ 已确认').length;
      const positive = items.filter((r) => ['responded', 'oa', 'interview', 'offer'].includes(r.outcome_status)).length;
      const negative = items.filter((r) => ['rejected', 'ghosted'].includes(r.outcome_status) || r.status === '❌ Rejected').length;
      return {
        key,
        count: items.length,
        submitted,
        positive,
        negative,
        submitted_rate: items.length ? Number((submitted / items.length).toFixed(3)) : 0,
        positive_rate: submitted ? Number((positive / submitted).toFixed(3)) : 0,
      };
    });
}

function topEntries(obj, limit = 8) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function renderMarkdown(report) {
  const lines = [
    '# Mr. Weirdo Jobs Pattern Analysis',
    '',
    `Generated: ${report.generated_at}`,
    `DB: ${report.db_path}`,
    '',
    '## Sample Gate',
    '',
    `- Submitted rows: ${report.sample.submitted_rows}`,
    `- Non-pending outcomes: ${report.sample.non_pending_outcomes}`,
    `- Sufficient: ${report.sample.sufficient ? 'yes' : 'no'}`,
  ];
  if (!report.sample.sufficient) {
    lines.push('', report.sample.message);
    return lines.join('\n');
  }

  lines.push(
    '',
    '## Funnel',
    '',
    `- Total rows: ${report.funnel.total}`,
    `- Pending discovered: ${report.funnel.pending_discovered}`,
    `- Submitted: ${report.funnel.submitted}`,
    `- Confirmed: ${report.funnel.confirmed}`,
    `- Skipped / rejected: ${report.funnel.skipped_or_rejected}`,
    '',
    '## Top Skip Reasons',
    '',
    ...report.skip_reasons.map((item) => `- ${item.key}: ${item.count}`),
    '',
    '## Negative Outcome Gaps',
    '',
    ...report.negative_key_gaps.map((item) => `- ${item.key}: ${item.count}`),
    '',
    '## Recommendations',
    '',
    ...(report.recommendations.length
      ? report.recommendations.map((r) => `- ${r.target_file}: ${r.proposed_change} (${r.reason})`)
      : ['_No recommendations yet._'])
  );
  return lines.join('\n');
}

export function analyzeRows(rows, {
  minSubmitted = 15,
  minOutcomes = 5,
  generatedAt = new Date().toISOString(),
  dbPathValue = dbPath(),
} = {}) {
  const normalized = rows.map((row) => ({
    ...row,
    outcome_status: row.outcome_status || DEFAULT_OUTCOME_STATUS,
  }));
  const submittedRows = normalized.filter((r) => r.status === '✅ 已投' || r.status === '✅ 已确认');
  const nonPendingOutcomes = normalized.filter((r) => (r.outcome_status || DEFAULT_OUTCOME_STATUS) !== DEFAULT_OUTCOME_STATUS);
  const sufficient = submittedRows.length >= minSubmitted && nonPendingOutcomes.length >= minOutcomes;
  const report = {
    ok: true,
    generated_at: generatedAt,
    db_path: dbPathValue,
    sample: {
      submitted_rows: submittedRows.length,
      non_pending_outcomes: nonPendingOutcomes.length,
      min_submitted: minSubmitted,
      min_outcomes: minOutcomes,
      sufficient,
      message: sufficient ? 'sample sufficient' : '样本不足：已投或非 pending outcome 太少，先记录更多结果再做模式分析。',
    },
    funnel: {
      total: normalized.length,
      pending_discovered: normalized.filter((r) => r.status === '🤖 AI sourced').length,
      submitted: submittedRows.length,
      confirmed: normalized.filter((r) => r.status === '✅ 已确认').length,
      skipped_or_rejected: normalized.filter((r) => r.status === '⚠️ 跳过未投' || r.status === '❌ Rejected').length,
    },
    fit_distribution: summarizeGroup(normalized, (r) => bucketFit(r.fit_score)),
    by_ats_platform: summarizeGroup(normalized, (r) => r.ats_platform),
    by_search_source: summarizeGroup(normalized, (r) => r.search_source || r.source),
    by_role_type: summarizeGroup(normalized, (r) => r.role_type_match),
    skip_reasons: [],
    negative_key_gaps: [],
    recommendations: [],
  };

  const skipReasons = {};
  for (const row of normalized) {
    if (row.skip_reason) bump(skipReasons, row.skip_reason);
  }
  report.skip_reasons = topEntries(skipReasons);

  const negativeGaps = {};
  const negativeRows = normalized.filter((row) =>
    ['rejected', 'ghosted'].includes(row.outcome_status) || row.status === '❌ Rejected' || row.status === '⚠️ 跳过未投'
  );
  for (const row of negativeRows) {
    for (const gap of splitGaps(row.key_gaps)) bump(negativeGaps, gap);
  }
  report.negative_key_gaps = topEntries(negativeGaps);

  if (sufficient && report.negative_key_gaps[0]) {
    report.recommendations.push({
      target_file: 'search_intent.json',
      proposed_change: `Review whether target keywords should de-emphasize recurring gap: "${report.negative_key_gaps[0].key}".`,
      reason: `${report.negative_key_gaps[0].count} negative/skipped rows mention this gap.`,
    });
  }
  if (sufficient && report.skip_reasons[0]) {
    report.recommendations.push({
      target_file: 'target_filters.min_fit_score',
      proposed_change: `Before changing thresholds, inspect rows with top skip reason "${report.skip_reasons[0].key}".`,
      reason: `${report.skip_reasons[0].count} skipped rows share that reason.`,
    });
  }

  return report;
}

function readRows() {
  initDb();
  const db = new DatabaseSync(dbPath());
  return db.prepare(`
    SELECT id, company, title, status, fit_score, key_gaps, role_type_match,
           skip_reason, ats_platform, search_source, source,
           outcome_status, submitted_at, confirmed_at, updated_at
      FROM jobs
  `).all();
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const minSubmitted = Number(argValue('--min-threshold', argValue('--min-submitted', '15')));
  const minOutcomes = Number(argValue('--min-outcomes', '5'));
  const report = analyzeRows(readRows(), { minSubmitted, minOutcomes });
  mkdirSync(TMP, { recursive: true });
  const jsonPath = join(TMP, 'patterns.json');
  const reportsDir = join(atsHome(), 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const mdPath = join(reportsDir, `patterns-${todayIso()}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, renderMarkdown(report));
  if (hasArg('--json')) console.log(JSON.stringify({ ok: true, json_path: jsonPath, report_path: mdPath, sample: report.sample }, null, 2));
  else console.log(mdPath);
}
