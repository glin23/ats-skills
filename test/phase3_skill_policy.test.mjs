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

test('jobskill menu exposes landed Phase 2 and Phase 3 commands without coming-soon labels', () => {
  const text = read('.claude/skills/mrweirdo-jobskill/SKILL.md');
  for (const command of ['/mrweirdo-tracker', '/mrweirdo-expand', '/mrweirdo-upskill', '/mrweirdo-materials']) {
    assert.match(text, new RegExp(command.replace('/', '\\/')));
  }
  assert.doesNotMatch(text, /即将上线/);
});
