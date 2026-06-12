import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpskillReport } from '../shared/upskill_report.mjs';

test('upskill_report weights key_gaps by (10 - fit_score) / 10', () => {
  const report = buildUpskillReport([
    { id: 1, company: 'A', title: 'Intern', role_type_match: 'intern', fit_score: 8, key_gaps: 'SQL missing / Tableau missing' },
    { id: 2, company: 'B', title: 'Intern', role_type_match: 'intern', fit_score: 5, key_gaps: 'SQL missing' },
    { id: 3, company: 'C', title: 'Part-time', role_type_match: 'part_time', fit_score: 6, key_gaps: 'Excel modeling' },
  ], { generatedAt: '2026-06-12T00:00:00Z' });

  const intern = report.heatmap.find((role) => role.role_category === 'intern');
  assert.ok(intern);
  const sql = intern.gaps.find((gap) => gap.gap === 'sql missing');
  assert.equal(sql.weighted_count, 0.7);
  assert.equal(sql.mentions, 2);
  assert.equal(sql.examples.length, 2);
});

test('upskill_report includes diff from previous report', () => {
  const previous = {
    path: '/tmp/old.json',
    data: {
      heatmap: [
        { role_category: 'intern', gaps: [{ gap: 'sql missing', weighted_count: 0.2 }] },
      ],
    },
  };
  const report = buildUpskillReport([
    { id: 1, company: 'A', title: 'Intern', role_type_match: 'intern', fit_score: 5, key_gaps: 'SQL missing' },
  ], { previous });
  assert.equal(report.previous_report, '/tmp/old.json');
  assert.deepEqual(report.diff[0], {
    role_category: 'intern',
    gap: 'sql missing',
    before: 0.2,
    after: 0.5,
    delta: 0.3,
  });
});
