// The Ashby driver knows exactly why it stopped — and then throws that reason
// away.
//
// answerMissing() returns { note, pending_for_main_claude: true } for a fact it
// was never told (a residence, a transport capability, a work-authorization
// status). main() then puts the question on the pending list with only
// { question, selector, tag }: `a.note` is dropped. By the time the result file
// reaches shared/apply_gap_report.mjs the driver's precise reason is gone, and
// the report is left guessing from the form's own wording.
//
// That guess is not harmless. "Do you currently live in the San Francisco Bay
// Area?" matches the report's `currently live` label rule and lands in
// agent_profile_backed — "Do not ask the user first. Fill from existing profile"
// — for a profile that holds no such fact. The row is blocked, the user is never
// asked, and nothing in the report says why.
// 设计稿 §1.1（缺口报告的信号通路那一节）假定"驱动侧已经接好线"：对 Greenhouse
// 成立，对 Ashby 从来没成立过。
//
// Work authorization survives this only by luck: the report has a label rule for
// it too. Residence, transport and legal facts have no such safety net.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askAndQueue, BASE, loadDriver } from './ashby_driver_harness.mjs';
import { categoryOf, runGapReport } from './helpers.mjs';

const RESIDENCE_LABEL = 'Do you currently live in the San Francisco Bay Area?';
const TRANSPORT_LABEL = 'Do you have reliable transportation to our Austin office?';
const AUTH_LABEL = 'Are you legally authorized to work in the United States?';

test('ashby driver: a blocked question keeps the driver\'s own reason on the pending list', async () => {
  for (const [label, expected] of [
    [RESIDENCE_LABEL, 'specific_city_fact_unconfirmed'],
    [TRANSPORT_LABEL, 'specific_city_fact_unconfirmed'],
    [AUTH_LABEL, 'work_authorization_required'],
  ]) {
    const { res, pending } = await askAndQueue(BASE, label);
    assert.equal(res.ok, false, `${label} must block, not be answered: ${JSON.stringify(res)}`);
    assert.equal(res.note, expected, `driver stopped for an unexpected reason: ${JSON.stringify(res)}`);
    assert.equal(pending.length, 1, `the question must reach the pending list: ${JSON.stringify(pending)}`);
    assert.equal(
      pending[0].note,
      expected,
      `the driver's reason was dropped on the way to the pending list: ${JSON.stringify(pending[0])}`,
    );
    assert.equal(pending[0].question, label, 'the question text must survive too');
    assert.equal(pending[0].selector, '#q_1', 'the selector must survive too');
  }
});

// End-to-end: the pending list built by the shipped line, fed to the real
// gap-report CLI. This is the assertion that matters — the one above only proves
// a field is present; this one proves the user actually gets asked.
test('gap report: an Ashby-blocked residence question becomes a user question, not "fill from profile"', async () => {
  const pending = [];
  for (const label of [RESIDENCE_LABEL, TRANSPORT_LABEL, AUTH_LABEL]) {
    pending.push(...(await askAndQueue(BASE, label)).pending);
  }
  const { report } = runGapReport('mrw-ashby-note-', BASE, [{
    outcome: 'essay_pending',
    job_id: 901,
    pending,
    still_missing: pending.map((p) => p.question),
  }]);

  assert.equal(
    categoryOf(report, RESIDENCE_LABEL),
    'user_logistics_fact',
    'a residence fact the driver refused to invent must be asked, not filed as "fill it from the profile"',
  );
  assert.equal(
    categoryOf(report, TRANSPORT_LABEL),
    'user_logistics_fact',
    'a transport fact must be routed by the driver\'s own reason, not by the form\'s wording',
  );
  // The one that already worked without the note, via the report's label rule.
  // It must keep working — the fix may not move it somewhere new.
  assert.equal(categoryOf(report, AUTH_LABEL), 'user_work_authorization');
  assert.ok(
    report.retry_candidates.some((row) => row.row_id === 901 && row.requires_user_answer === true),
    `the row must be queued for a retry once answered: ${JSON.stringify(report.retry_candidates)}`,
  );
});

// Hole 2 (设计稿 §13.5): a blocked question only survived when the driver could
// point at a TEXT BOX. `if (sel)` in main() plus `!item.selector -> return` in
// addPendingQuestion meant a dropdown- or radio-shaped blocked question — which
// is what work authorization, sponsorship and residence actually look like on a
// real Ashby form — vanished question, note and all, leaving one bare label in
// `missing`. A selector is a convenience for typing the answer back in; it is
// not what decides whether the user gets asked.
test('ashby driver: a dropdown-shaped blocked question reaches the pending list without a selector', async () => {
  for (const [label, expected] of [
    [AUTH_LABEL, 'work_authorization_required'],
    [RESIDENCE_LABEL, 'specific_city_fact_unconfirmed'],
  ]) {
    const { res, pending } = await askAndQueue(BASE, label, null);
    assert.equal(res.ok, false, `${label} must block: ${JSON.stringify(res)}`);
    assert.equal(
      pending.length,
      1,
      `a question with no text box still has to be asked: ${JSON.stringify(pending)}`,
    );
    assert.equal(pending[0].question, label);
    assert.equal(pending[0].selector, null, 'no text box means selector null, not a dropped question');
    assert.equal(pending[0].note, expected, 'the driver\'s reason must survive the missing selector');
  }
});

test('ashby driver: the pending list dedupes on the question, not on the selector', async () => {
  // Ashby re-renders the same question with a fresh generated id on every submit
  // attempt, so a (question, selector) key let the same question in five times —
  // and after the fix a selector-less copy would be a sixth.
  const { addPendingQuestion } = await loadDriver(BASE);
  const pending = [];
  addPendingQuestion(pending, { question: AUTH_LABEL, selector: '#mrw_pending_a1b2c3', tag: 'input', note: 'work_authorization_required' });
  addPendingQuestion(pending, { question: AUTH_LABEL, selector: '#mrw_pending_z9y8x7', tag: 'input', note: 'work_authorization_required' });
  addPendingQuestion(pending, { question: AUTH_LABEL, selector: null, tag: null, note: 'work_authorization_required' });
  assert.equal(pending.length, 1, `the same question must appear once: ${JSON.stringify(pending)}`);
  assert.equal(pending[0].selector, '#mrw_pending_a1b2c3', 'the first entry wins, so a usable selector is not lost');

  // The one thing that is still not a question: an entry with no question text.
  addPendingQuestion(pending, { selector: '#q_2', tag: 'input', note: 'work_authorization_required' });
  assert.equal(pending.length, 1, 'an entry with no question text is not a question');
});

// End to end for hole 2: the selector-less pending entry must survive the trip
// to the gap report and become a question, not disappear.
test('gap report: a dropdown-shaped Ashby blocker still becomes a user question', async () => {
  const pending = [];
  for (const label of [AUTH_LABEL, RESIDENCE_LABEL]) {
    pending.push(...(await askAndQueue(BASE, label, null)).pending);
  }
  const { report } = runGapReport('mrw-ashby-nosel-', BASE, [{
    outcome: 'essay_pending',
    job_id: 903,
    pending,
    still_missing: pending.map((p) => p.question),
  }]);
  assert.equal(categoryOf(report, AUTH_LABEL), 'user_work_authorization');
  assert.equal(categoryOf(report, RESIDENCE_LABEL), 'user_logistics_fact');
});

// The reverse guard: carrying the note must not re-route questions that were
// already handled correctly. An essay the driver has no template for is the
// agent's job to write, not a question for the user, and it stays that way.
test('gap report: an Ashby essay pending question stays the agent\'s job', async () => {
  const label = 'Why do you want to work here?';
  const { report } = runGapReport('mrw-ashby-essay-', BASE, [{
    outcome: 'essay_pending',
    job_id: 902,
    pending: [{ question: label, selector: '#q_1', tag: 'textarea', note: `no_essay_template_for:${label}` }],
    still_missing: [label],
  }]);
  assert.equal(categoryOf(report, label), 'agent_open_text');
});
