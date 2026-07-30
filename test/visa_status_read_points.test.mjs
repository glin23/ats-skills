// ADR-12 的读点白名单守卫：`visa_status` 与 `_user_words` 是「只给系统看」的
// 字段，谁在读必须登记。新增一个读点而不在这里登记 = 本测试红——
// 「有没有人重新扫一遍」必须从人的自觉变成 CI 的动作（与 ADR-10 同一套路）。
//
// 第 19 处编造的形状：字段本身没问题，读它的人把它送到了雇主面前
// （answer_templates 逐字渲染）或用正则把它猜成了 Yes/No（两个驱动 + 桶）。
// 所以守卫按「文件 → 理由」登记每一个合法读点，并对产出雇主可见文本的
// 模块设零容忍。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 读点的样子：成员访问（.visa_status / ?.visa_status）或点分路径字符串。
// 只认这些形状，注释里提一句「不再嗅 visa_status」不算读点。
const READ_SHAPES = /[?.]visa_status\b|[?.]_user_words\b|['"]work_authorization\.visa_status['"]|['"]work_authorization\._user_words['"]|['"]visa_status['"]|['"]_user_words['"]/;

// 白名单：文件 → 它为什么可以读。删一个读点记得同步删这一行（多登记不红，
// 少登记才红——守卫防的是「悄悄新增」，不是「忘了清理」）。
const ALLOWED_READ_POINTS = {
  'shared/work_auth_identity.mjs': '字段的定义处：枚举、路径表、漏斗写入映射',
  'shared/missing_field_questions.mjs': 'ADR-5 模板即权限：声明路径/类型/枚举，答案才写得进档案',
  'shared/personal_fact_gate.mjs': '门的漏斗证据（枚举值 = 跑过漏斗）+ 补救命令里的枚举提示',
  'shared/record_profile_answers.mjs': '写回口：用法注释里的枚举示例与 _user_words 去向说明',
  'shared/validate_user_profile.mjs': '档案形状校验（键在不在、类型对不对），不产出表单答案',
  'shared/ashby_apply_driver.mjs': '已知限制（施工记录第 10 轮）：两处 combobox 选项偏好读点，只在三态布尔已答后细化选哪个下拉选项；枚举值匹配不上会自然失效，不产出 Yes/No',
};

// 零容忍名单：产出「给雇主看的文本」的模块，一个读点都不许有（ADR-12 R1）。
const EMPLOYER_FACING = ['shared/answer_templates.mjs', 'shared/answer_bank.json', 'shared/cover_letter_materials.mjs'];

function codeFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === '_unwired' || name === 'node_modules') continue;
    if (statSync(full).isDirectory()) { out.push(...codeFiles(full)); continue; }
    if (/\.(mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

test('ADR-12: visa_status / _user_words 的每个读点都在白名单里', () => {
  const files = ['shared', 'scripts', 'bin'].flatMap((d) => codeFiles(join(ROOT, d)));
  const offenders = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (!READ_SHAPES.test(readFileSync(file, 'utf8'))) continue;
    if (!(rel in ALLOWED_READ_POINTS)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `未登记的 visa_status/_user_words 读点：${offenders.join(', ')} —— 读它之前先来本文件登记理由；产出雇主可见文本的模块一律不批`,
  );
});

test('ADR-12 R1: 产出雇主可见文本的模块零读点', () => {
  for (const rel of EMPLOYER_FACING) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.doesNotMatch(src, /visa_status|_user_words/, `${rel} 不得读只给系统看的字段`);
    assert.ok(!(rel in ALLOWED_READ_POINTS), `${rel} 不许进白名单`);
  }
});

test('白名单没有腐烂：登记过的文件确实还在读（防守卫空转）', () => {
  for (const rel of Object.keys(ALLOWED_READ_POINTS)) {
    assert.ok(
      READ_SHAPES.test(readFileSync(join(ROOT, rel), 'utf8')),
      `${rel} 已不再读这两个字段——把它从白名单里删掉，别让守卫带着死条目空转`,
    );
  }
});
