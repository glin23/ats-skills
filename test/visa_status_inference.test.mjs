// ADR-12 R2: no form answer may ever be INFERRED from `visa_status` — it is a
// system-only field that has held free text, including the user's own Chinese
// sentence. Measured before this round (shipped drivers, real question
// phrasings): a profile whose visa_status was 「我是陪读签证，老公在这边工作」
// was answered `No` to "Have you been admitted to the United States as a
// nonimmigrant?" — a legal statement the user never made, and the opposite of
// the truth. These tests drive the SHIPPED drivers through the harnesses (only
// the browser boundary is stubbed) and pin four things:
//   ① free text in visa_status can never again produce a Yes/No;
//   ② the three-state booleans still answer what they honestly can;
//   ③ unknowable = the row blocks — no default branch (关卡 2 ③);
//   ④ a Q4「别替我答」profile blocks with its own deferred note, not「没问过」.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchAnswerBucket } from '../shared/answer_buckets.mjs';
import { withoutSponsorshipAnswer } from '../shared/answer_routing.mjs';
import { ask, BASE } from './greenhouse_driver_harness.mjs';
import { askAndQueue, BASE as ASHBY_BASE } from './ashby_driver_harness.mjs';

const CHINESE_FREE_TEXT = {
  ...BASE,
  work_authorization: {
    visa_status: '我是陪读签证，老公在这边工作',
    authorized_to_work_us: null,
    requires_sponsorship_now: null,
    requires_sponsorship_future: null,
  },
};
const CITIZEN = {
  ...BASE,
  work_authorization: {
    visa_status: 'citizen_or_green_card',
    authorized_to_work_us: true,
    requires_sponsorship_now: false,
    requires_sponsorship_future: false,
  },
};
const NONIMMIGRANT_Q = 'Have you been admitted to the United States as a nonimmigrant?';
const UNRESTRICTED_Q = 'Do you have unlimited and unrestricted authorization to work in the U.S.?';
const FUTURE_Q = 'Will you now or in the future require the support of an immigration case?';

test('ADR-12 R2: 中文原话档案问「非移民入境」——阻塞，不再答 No', async () => {
  const { res, fills } = await ask(CHINESE_FREE_TEXT, NONIMMIGRANT_Q);
  assert.equal(res.needs_user_answer, true, `expected a block, got ${JSON.stringify(res)}`);
  assert.equal(res.note, 'work_authorization_required');
  assert.equal(fills.length, 0, 'not one character may land on the form');
});

test('ADR-12 R2: 「非移民入境」只有担保两问皆否才可推 No', async () => {
  const citizen = await ask(CITIZEN, NONIMMIGRANT_Q);
  assert.equal(citizen.fills.at(-1)?.value, 'No', JSON.stringify(citizen.res));
  // 学生（rsf=true）不许从枚举猜 Yes：他的入境方式不是布尔能回答的事。
  const student = await ask({
    ...BASE,
    work_authorization: {
      visa_status: 'student_visa_with_permission',
      authorized_to_work_us: true,
      requires_sponsorship_now: false,
      requires_sponsorship_future: true,
    },
  }, NONIMMIGRANT_Q);
  assert.equal(student.res.needs_user_answer, true, 'a student profile must block, never guess');
});

test('ADR-12 R2 + 关卡 2 ③: 无限制授权——布尔说了算，未知阻塞（两个驱动 + 桶）', async () => {
  // Greenhouse：公民 Yes / 未知阻塞。
  assert.equal((await ask(CITIZEN, UNRESTRICTED_Q)).fills.at(-1)?.value, 'Yes');
  assert.equal((await ask(CHINESE_FREE_TEXT, UNRESTRICTED_Q)).res.needs_user_answer, true);
  // Ashby 同一族题（combobox 形态）：未知 → 停行进 pending，带 note。
  const ashby = await askAndQueue({
    ...ASHBY_BASE,
    work_authorization: { visa_status: '我是陪读签证，老公在这边工作', authorized_to_work_us: null, requires_sponsorship_now: null, requires_sponsorship_future: null },
  }, 'Are you authorized to work in the U.S. without sponsorship?');
  assert.equal(ashby.res.ok, false);
  assert.equal(ashby.res.note, 'sponsorship_future_required');
  // 纯函数三态（两个驱动与桶共用同一份判定）。
  assert.equal(withoutSponsorshipAnswer(CITIZEN), 'Yes');
  assert.equal(withoutSponsorshipAnswer({ work_authorization: { requires_sponsorship_future: true } }), 'No');
  assert.equal(withoutSponsorshipAnswer(CHINESE_FREE_TEXT), null);
  // 桶：未知时「无担保授权」专属桶整行消失——不再有写死的 No。落到下一个
  // 授权桶时 choice 来自 ctx 的三态派生（未知 = 不给值），没有任何编造值。
  // 出货驱动里这个形态在到达桶之前就被上面那条 combobox 分支停行了。
  const label = 'Are you legally authorized to work without sponsorship?';
  const unknownBucket = matchAnswerBucket(label, { PROFILE: CHINESE_FREE_TEXT });
  assert.equal(unknownBucket?.choice ?? null, null, `no invented choice allowed: ${JSON.stringify(unknownBucket)}`);
  assert.equal(matchAnswerBucket(label, { PROFILE: CITIZEN })?.choice, 'Yes');
});

test('ADR-12 R2: 「将来移民支持」三态三分支，不再嗅 visa_status', async () => {
  assert.equal((await ask(CITIZEN, FUTURE_Q)).fills.at(-1)?.value, 'No');
  const student = await ask({
    ...BASE,
    work_authorization: { visa_status: 'student_visa_no_permission_yet', authorized_to_work_us: null, requires_sponsorship_now: null, requires_sponsorship_future: true },
  }, FUTURE_Q);
  assert.equal(student.fills.at(-1)?.value, 'Yes');
  const unknown = await ask(CHINESE_FREE_TEXT, FUTURE_Q);
  assert.equal(unknown.res.needs_user_answer, true);
  assert.equal(unknown.res.note, 'sponsorship_future_required');
});

test('接缝：Q4「别替我答」的档案在这三条驱动内联分支上也带自己的 note', async () => {
  // workAuthGapFor 之外的三个内联分支（无限制授权 / 将来移民支持 / 非移民入境）
  // 同样要认得 defer——否则他答过的指示只在一部分题面上被听见。
  const deferred = {
    ...BASE,
    work_authorization: {
      visa_status: 'student_visa_no_permission_yet',
      authorized_to_work_us: null,
      requires_sponsorship_now: null,
      requires_sponsorship_future: null,
      form_answer_policy: 'defer_to_user',
    },
  };
  for (const q of [UNRESTRICTED_Q, FUTURE_Q, NONIMMIGRANT_Q]) {
    const { res } = await ask(deferred, q);
    assert.equal(res.needs_user_answer, true, q);
    assert.equal(res.note, 'work_authorization_deferred_by_user', q);
  }
});
