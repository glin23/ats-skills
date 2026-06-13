import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

test('materials skill keeps generated files out of auto-apply and avoids LaTeX', () => {
  const text = read('.claude/skills/mrweirdo-materials/SKILL.md');
  assert.match(text, /Do not use LaTeX/);
  assert.match(text, /Do not attach the generated file to auto-apply/);
  assert.match(text, /Keep, soften, or drop/);
  assert.match(text, /used_in_submission: false/);
});

test('expand skill locks sensitive profile areas and requires idempotence', () => {
  const text = read('.claude/skills/mrweirdo-expand/SKILL.md');
  assert.match(text, /second run must be idempotent/);
  assert.match(text, /work_authorization/);
  assert.match(text, /legal attestations/);
  assert.match(text, /demographics/);
});

test('tracker follow-up drafts avoid empty checking-in language', () => {
  const text = read('.claude/skills/mrweirdo-tracker/SKILL.md');
  assert.match(text, /avoid empty phrases like "just checking in"/);
  assert.match(text, /Never send a follow-up/);
  assert.match(text, /--followup-sent/);
});

test('jobskill menu exposes five choice labels without user-facing slash commands', () => {
  const text = read('.claude/skills/mrweirdo-jobskill/SKILL.md');
  for (const label of ['开始找实习 / Onboard', '进度跟踪 / Tracker', '扩充写作画像 / Expand', '技能提升 / Upskill', '起草申请材料 / Materials']) {
    assert.match(text, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const command of ['/mrweirdo-tracker', '/mrweirdo-expand', '/mrweirdo-upskill', '/mrweirdo-materials', '/mrweirdo-greenhouse', '/mrweirdo-ashby', '/mrweirdo-lever']) {
    assert.doesNotMatch(text, new RegExp(command.replace('/', '\\/')));
  }
  assert.doesNotMatch(text, /即将上线/);
});
