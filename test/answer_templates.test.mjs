import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAnswerTemplate } from '../shared/answer_templates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('renderAnswerTemplate fills known tokens and blanks unknown ones', () => {
  const out = renderAnswerTemplate('Hi {{COMPANY_PRETTY}}, I study {{MAJOR}} at {{SCHOOL}}. {{NONEXISTENT}}', {
    profile: { education: { major: 'Business', school: 'Babson College' } },
    companyPretty: 'Acme',
  });
  assert.equal(out, 'Hi Acme, I study Business at Babson College.');
});

// 旧断言（assert.match(out, /F-1 OPT eligible/)）锁住的正是 ADR-12 判定的第 19 处
// 编造：visa_status 被逐字渲染进给雇主的英文。按 ADR-12 R1/R3 改写——与批次 A
// 修改 test/apply_gap_report.test.mjs:135 那条断言同一种情况，改动理由单独写在
// 施工记录里供 verify 复核（不是改测试迁就代码：旧断言锁的行为本身是缺陷）。
test('ADR-12 R1: employer-facing text never carries visa_status — in any language', () => {
  // 设计自己发明的标签不许变成他的自白。
  const label = renderAnswerTemplate('{{WORK_AUTH_SUMMARY}}', {
    profile: { work_authorization: { visa_status: 'student_visa_no_permission_yet', requires_sponsorship_future: true } },
  });
  assert.doesNotMatch(label, /student_visa_no_permission_yet|no_permission|F-?1/i);
  // 用户的中文原话更不许。历史档案的 visa_status 里真出现过中文。
  const chinese = renderAnswerTemplate('{{WORK_AUTH_SUMMARY}}', {
    profile: { work_authorization: { visa_status: '我不知道，学校说要等', requires_sponsorship_future: true, _user_words: '我不知道，学校说要等' } },
  });
  assert.doesNotMatch(chinese, /[一-鿿]/, 'a Chinese sentence must never reach an English employer form');
  // 三态布尔仍然可以诚实地说话。
  assert.match(chinese, /may require future sponsorship/);
});

test('ADR-12 R3: sponsorship reads three-state — null means the clause does not appear', () => {
  const neverAsked = renderAnswerTemplate('{{WORK_AUTH_SUMMARY}}', {
    profile: { work_authorization: { visa_status: 'other_status', requires_sponsorship_future: null } },
  });
  // 两态读法把 null 掉进「不需要担保」——一句他从没说过、入职核验对不上的话。
  assert.doesNotMatch(neverAsked, /does not require/);
  assert.doesNotMatch(neverAsked, /may require/);
  const saidNo = renderAnswerTemplate('{{WORK_AUTH_SUMMARY}}', {
    profile: { work_authorization: { requires_sponsorship_future: false } },
  });
  assert.match(saidNo, /does not require future sponsorship/);
});

test('ADR-12 R1: the availability template no longer volunteers a work-auth self-declaration', () => {
  // 问到岗时间的雇主没有问移民身份，附赠一句是我们自己多说的。
  const bank = readFileSync(join(ROOT, 'shared/answer_bank.json'), 'utf8');
  assert.doesNotMatch(bank, /WORK_AUTH_SUMMARY/, 'answer_bank.json:82 那半句按 lead 裁决删除');
});

test('renderAnswerTemplate tolerates empty/no-token input', () => {
  assert.equal(renderAnswerTemplate('', {}), '');
  assert.equal(renderAnswerTemplate('no tokens here', {}), 'no tokens here');
});
