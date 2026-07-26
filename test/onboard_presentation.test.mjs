import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skill = () => readFileSync('.claude/skills/mrweirdo-onboard/SKILL.md', 'utf8');

test('onboard output templates use one consistent progress language', () => {
  const text = skill();
  assert.match(text, /## Output Presentation Rules/);
  for (const step of ['0', '1', '3', '4', '5', '6', '7']) {
    assert.match(text, new RegExp(`\\[Step ${step}\\/7\\]`));
  }
  assert.match(text, /Do not paste raw JSON, database rows, or unformatted command output/);
  assert.match(text, /Discovery 漏斗/);
  assert.match(text, /Queue gate - 最终确认后才真实提交/);
  assert.match(text, /补缺口 \/ Missing info/);
  assert.match(text, /本轮完成 \/ Batch report/);
});

test('queue gate presentation preserves identity, counts, manual path, cover-letter disclosure, and start consent', () => {
  const text = skill();
  assert.match(text, /将以以下身份提交：<name> \/ <email> \/ <phone> \/ <visa 状态>/);
  assert.match(text, /自动投 <N> 行 \| manual 清单 <M> 行（不会替你投）\| quota 保护 <Q> 行 \| suspicious 待复核 <S> 行/);
  // The guard is "the gate tells the user where the manual list is", not the
  // literal /tmp path it used to be: run artefacts moved inside the home so one
  // switch moves the whole run. Same strength, new address.
  assert.match(text, /manual 清单在 \$MRWEIRDO_HOME\/run-tmp\/manual_or_unsupported\.json/);
  assert.match(text, /对需要 cover letter 的岗位/);
  assert.match(text, /回复"开始"执行，或先指出需要修改的行\/字段/);
});
