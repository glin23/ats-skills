// The defer_to_user seam (设计稿 §13.3.3 门与行层的接缝, 硬规定 2 + 3).
//
// 「别替我答」和「没问过」在结果文件里如果共用一个 note, 报告就会把他已经
// 回答过的问题再问一遍 —— 本项目反复犯的那类错. 这里钉死三件事:
// ① deferred 的行落进「你自己填最后一格」的自助清单, 文案是交待不是问句;
// ② 没问过的行仍走「该问你」那条路, 两个 note 的后续完全相反;
// ③ 他改口 (policy C → A/B) 之后, 旧结果里的 deferred 行自动变成「按档案填」.
//
// Lives in its own file because test/apply_gap_report.test.mjs is at the
// 800-line cap; same helpers, same real CLI underneath.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryOf, runGapReport } from './helpers.mjs';

const AUTH_LABEL = 'Are you legally authorized to work in the United States?';

test('「你自己填」不再被当成「该问你」：defer 的行进自助清单，且绝不重问', () => {
  // 真值表第 5 行：常态留学生 + Q4 选 C（默认档）。
  const rowFive = {
    work_authorization: {
      visa_status: 'student_visa_no_permission_yet',
      authorized_to_work_us: null,
      requires_sponsorship_now: null,
      requires_sponsorship_future: true,
      form_answer_policy: 'defer_to_user',
    },
  };
  const { report } = runGapReport('mrw-gap-defer-', rowFive, [{
    outcome: 'skip',
    reason: 'needs_user_answer',
    job_id: 9001,
    company: 'Defer Co',
    remaining: [{ label: AUTH_LABEL, note: 'work_authorization_deferred_by_user' }],
  }]);

  assert.equal(categoryOf(report, AUTH_LABEL), 'user_work_authorization_self_serve');
  const entry = report.user_questions.find((q) => q.category === 'user_work_authorization_self_serve');
  assert.ok(entry, 'the self-serve list must exist in the report');
  // 文案是一句交待（按你说的没替你答，你自己填最后一格），不是把工作授权问题再问一遍。
  assert.match(entry.question, /没替你答|你自己填/);
  assert.doesNotMatch(entry.question, /你是美国公民|请按顺序回答/, 'deferred rows must not re-open the funnel');
  // 该行必须能重投（他随时可以把 policy 从 C 改成 A/B）；不进重试清单 = 改了答案也没变化。
  assert.ok(
    report.retry_candidates.some((row) => row.row_id === 9001),
    'a deferred row must stay retryable',
  );

  // 反向守卫：同一道题、没问过的 note 仍走「该问你」那条路，两个 note 分得开。
  const neverAsked = runGapReport('mrw-gap-defer-vs-asked-', {}, [{
    outcome: 'skip',
    reason: 'needs_user_answer',
    job_id: 9002,
    company: 'Never Asked Co',
    remaining: [{ label: AUTH_LABEL, note: 'work_authorization_required' }],
  }]).report;
  assert.equal(categoryOf(neverAsked, AUTH_LABEL), 'user_work_authorization');
});

test('defer 的行在他改口之后变成「按档案填」，清单自动清空', () => {
  // 结果文件会被重读：他后来把 policy 改成 A（authorized_to_work_us 落了布尔），
  // 旧结果里的 deferred note 就不该再把这行留在自助清单里——档案有最终发言权，
  // 与 note→类目通路的其他条目同一条规则（否则同一行永远挂在清单上）。
  const changedHisMind = {
    work_authorization: {
      visa_status: 'student_visa_no_permission_yet',
      authorized_to_work_us: true,
      requires_sponsorship_now: null,
      requires_sponsorship_future: true,
      form_answer_policy: 'answer_yes',
    },
  };
  const { report } = runGapReport('mrw-gap-defer-answered-', changedHisMind, [{
    outcome: 'skip',
    reason: 'needs_user_answer',
    job_id: 9003,
    company: 'Changed Mind Co',
    remaining: [{ label: AUTH_LABEL, note: 'work_authorization_deferred_by_user' }],
  }]);
  assert.equal(categoryOf(report, AUTH_LABEL), 'agent_profile_backed');
});
