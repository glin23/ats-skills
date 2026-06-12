import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRows } from '../shared/analyze_patterns.mjs';

test('analyze_patterns refuses weak conclusions when sample is too small', () => {
  const report = analyzeRows([
    { status: '✅ 已投', outcome_status: 'pending', fit_score: 8 },
    { status: '⚠️ 跳过未投', outcome_status: 'pending', skip_reason: 'missing_info' },
  ], { minSubmitted: 15, minOutcomes: 5, dbPathValue: '/tmp/test.db' });

  assert.equal(report.sample.sufficient, false);
  assert.match(report.sample.message, /样本不足/);
  assert.deepEqual(report.recommendations, []);
});

test('analyze_patterns emits recommendations only after sample gate passes', () => {
  const rows = [];
  for (let i = 0; i < 15; i += 1) {
    rows.push({
      status: '✅ 已投',
      outcome_status: i < 5 ? 'rejected' : 'pending',
      fit_score: 7,
      key_gaps: 'SQL missing / Tableau missing',
      skip_reason: i < 3 ? 'fit_below_threshold' : null,
      ats_platform: 'greenhouse',
      role_type_match: 'intern',
      search_source: 'greenhouse',
    });
  }
  const report = analyzeRows(rows, { minSubmitted: 15, minOutcomes: 5, dbPathValue: '/tmp/test.db' });
  assert.equal(report.sample.sufficient, true);
  assert.ok(report.negative_key_gaps.some((gap) => gap.key === 'sql missing'));
  assert.ok(report.recommendations.length >= 1);
});
