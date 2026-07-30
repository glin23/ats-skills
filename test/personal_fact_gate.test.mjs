// One gate, one fact. Work authorization is the only personal fact whose
// absence blocks essentially every row (measured across 6 profile shapes x 4
// real question phrasings in BUILD section 14), so it is the only one worth
// stopping a batch for. Everything else is asked after the batch, from the
// questions real forms actually raised — the 2026-06 decision not to probe
// before applying still stands.
//
// Without this gate, a profile missing work authorization opens 20 tabs, fills
// half of each, blocks on all 20, and reports "0 submitted" twenty minutes
// later. With it, the same profile costs two seconds and one question.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATED_PATHS, blockingProfileGaps } from '../shared/personal_fact_gate.mjs';
import { answerWritePaths } from '../shared/missing_field_questions.mjs';
import { WHERE_TO_CHECK, workAuthAnswers } from '../shared/work_auth_identity.mjs';
import { workAuthSources } from '../shared/answer_provenance.mjs';
import { onboardTestEnv } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the gate opens for a profile that answered work authorization', () => {
  // The one real user today: F-1 OPT, all four keys present, and NO provenance
  // file at all (his profile predates that file). 设计稿 §13.9.2 promises him
  // 逐格零变化, so a gate that reads provenance and nothing else would lock out
  // the only real user there is — see the note in personal_fact_gate.mjs.
  const result = blockingProfileGaps({
    work_authorization: {
      visa_status: 'F-1 OPT eligible',
      authorized_to_work_us: true,
      requires_sponsorship_now: false,
      requires_sponsorship_future: true,
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing_paths, []);
});

test('ADR-11: the gate judges "was he ever asked", not "is this cell filled in"', () => {
  // 关卡 7 推翻的死锁的确切形状: 一个常态留学生答完了全部问题, 两个布尔仍然
  // 空着 (答不出来的东西不许替他写), 旧谓词于是永远拦着他 —— 一行也投不出去.
  // 实测: 那道门的实际阻塞面是 72/72 = 100%, 而这些格子缺失真正会挡的行是 4/72.
  const answeredEverythingHeCan = {
    work_authorization: {
      visa_status: 'student_visa_no_permission_yet',
      authorized_to_work_us: null,
      requires_sponsorship_now: null,
      requires_sponsorship_future: true,
      form_answer_policy: 'defer_to_user',
    },
  };
  const gate = blockingProfileGaps(answeredEverythingHeCan);
  assert.equal(gate.ok, true, '他能答的都答了, 再问只会拿回同一个答案');

  // 第二个死锁: 其他情形 + Q5 说不清楚 + Q4 选 B. pm 的值判据在这一格下
  // 门仍然关着, 而这个人已经把能答的都答了 —— 所以值判据不能当门用.
  const otherStatus = {
    work_authorization: {
      visa_status: 'other_status',
      authorized_to_work_us: false,
      requires_sponsorship_now: null,
      requires_sponsorship_future: null,
      form_answer_policy: 'answer_no',
    },
  };
  assert.equal(blockingProfileGaps(otherStatus).ok, true);
});

test('the gate opens on the provenance record alone, even before any cell can be filled', () => {
  // 门只读来源留痕这一半: 一个人被问过 (留痕在), 哪怕这一族的值一格都没落下来,
  // 也不该被拦 —— 再问一遍只会拿回同一个答案.
  const nothingOnFile = {
    work_authorization: {
      visa_status: '',
      authorized_to_work_us: null,
      requires_sponsorship_now: null,
      requires_sponsorship_future: null,
      form_answer_policy: null,
    },
  };
  assert.equal(blockingProfileGaps(nothingOnFile).ok, false, 'nothing at all: he was never asked');
  const asked = blockingProfileGaps(nothingOnFile, {
    work_auth_sources: { 'work_authorization.visa_status': 'onboarding_a0' },
  });
  assert.equal(asked.ok, true, '留痕说他被问过了, 门就不该再拦批次');

  // 但留痕必须是「人给的」. resume_inferred / unknown 不是他说的.
  for (const source of ['resume_inferred', 'unknown']) {
    assert.equal(
      blockingProfileGaps(nothingOnFile, { work_auth_sources: { 'work_authorization.visa_status': source } }).ok,
      false,
      `${source} is not the funnel having been run`,
    );
  }
});

test('the gate opens for a NO as readily as a YES — an answer is an answer', () => {
  const notAuthorized = blockingProfileGaps({
    work_authorization: {
      visa_status: 'F-1, no CPT/OPT yet',
      authorized_to_work_us: false,
      requires_sponsorship_now: true,
      requires_sponsorship_future: true,
    },
  });
  assert.equal(notAuthorized.ok, true);

  const citizen = blockingProfileGaps({
    work_authorization: {
      visa_status: 'US Citizen',
      authorized_to_work_us: true,
      requires_sponsorship_now: false,
      requires_sponsorship_future: false,
    },
  });
  assert.equal(citizen.ok, true);
});

test('the gate closes on every shape of "nobody ever told us"', () => {
  const cases = {
    'whole block missing': {},
    'block present but empty': { work_authorization: {} },
    'explicitly null': { work_authorization: { authorized_to_work_us: null, requires_sponsorship_future: null } },
    'undefined profile': undefined,
  };
  for (const [name, profile] of Object.entries(cases)) {
    const result = blockingProfileGaps(profile);
    assert.equal(result.ok, false, `${name} should have been blocked`);
    assert.ok(result.missing_paths.length > 0, `${name} must name the missing paths`);
    assert.ok(result.question.length > 0, `${name} must carry a question`);
  }
  // 反向守卫: 「改成一律放行」是这一轮最省事也最坏的解法, 所以这一行必须仍然拦.
  assert.deepEqual(
    blockingProfileGaps({}).missing_paths,
    [...GATED_PATHS],
  );
  // 而「一个格子有值」已经足够证明有人走过这个漏斗 —— 之后该卡的行按行卡.
  assert.equal(blockingProfileGaps({ work_authorization: { authorized_to_work_us: true } }).ok, true);
});

test('the gate treats a stringy "true" as never asked, and never coerces it', () => {
  // What a hand-edited or migrated profile looks like. Coercing it would put a
  // claim about immigration status on a real form on the strength of a typo.
  for (const value of ['true', 'True', 'Yes', 1, 'false', 0]) {
    const result = blockingProfileGaps({
      work_authorization: { authorized_to_work_us: value, requires_sponsorship_future: value },
    });
    assert.equal(result.ok, false, `${JSON.stringify(value)} must not pass as an answer`);
  }
});

test('the gate asks which kind of person he is, and hands back a runnable fix', () => {
  // 关卡 3 ①: the question may not ask him to reach a legal conclusion. It used
  // to be a four-option question with CPT/OPT in the options, i.e. exactly the
  // conclusion 拍板人 said nobody can be expected to reach.
  const result = blockingProfileGaps({});
  assert.match(result.question, /公民/);
  assert.match(result.question, /绿卡/);
  assert.match(result.question, /学生签证/);
  assert.doesNotMatch(result.question, /你有没有工作授权|你在美国的工作授权属于哪一种/);
  // 关卡 8 决定一: Q4 出现在哪里, 那句提示就必须出现在哪里.
  assert.match(result.question, /会被原样打到真实雇主的表单上/);
  // 关卡 7 推翻的两句话不许留在任何一份问句里.
  assert.doesNotMatch(result.question, /这一批先不投|几乎每一份都会卡住/);
  assert.equal(result.category, 'user_work_authorization');
  assert.match(result.remediation_command, /record_profile_answers\.mjs/);
  for (const path of result.missing_paths) {
    assert.ok(result.remediation_command.includes(path), `${path} missing from the remediation command`);
  }
});

test('the stop says what it is stuck on and what happens next — and it is no longer "this batch is off"', () => {
  const result = blockingProfileGaps({});
  assert.equal(result.ok, false);
  assert.ok(result.blocked_because.length > 0, 'the gate must say what it is stuck on');
  assert.match(result.blocked_because, /一次都没问过|还没走完/, '它现在只有一个理由: 引导没跑过');
  // 关卡 7: 「这一批先不投」已删. 剩下的承诺是「问到那道题的那几行停下, 其余照投」.
  assert.match(result.what_happens_next, /其余照投/);
  assert.doesNotMatch(result.what_happens_next, /这一批先不投|这一批我先不投/);
  // 那三条查证去处已按 §13.3.2 挪到 Q4 旁边: 它们全是「确认你有没有」的去处,
  // 没有一条能让一个还没投工作的人拿到许可. 挂在门上就是一个礼貌的死胡同.
  assert.ok(!('where_to_check' in result), '三条去处不再挂在门上, 它们在 Q4 里');
  assert.ok(!('asked_in_this_batch' in result), '门只在「一次都没问过」时关, 不存在「已经问过还关着」这种状态');
  assert.equal(WHERE_TO_CHECK.length, 3, '它们仍然存在, 只是换了位置');
});

const EMPTY_HOME_PROFILE = {
  personal: {},
  education: {},
  work_authorization: {
    visa_status: '',
    authorized_to_work_us: null,
    requires_sponsorship_now: null,
    requires_sponsorship_future: null,
    form_answer_policy: null,
    _user_words: '',
  },
  resume_path: '/tmp/resume.pdf',
  standard_qa: {},
};

// 设计稿 §13.9.3 第 3 条: 门在 10 种情形里只关 1 次 (第 10 行「漏斗没跑过」),
// 其余 9 行必须放行 —— 包括「还没批」「说不清楚」「其他情形 + Q5 说不清楚」
// 这三行, 它们就是本轮修掉的两个死锁.
const NINE_FUNNEL_ROWS = [
  { row: 1, input: { citizenOrGreenCard: true } },
  { row: 2, input: { citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: true } },
  { row: 3, input: { citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: false, formAnswerPolicy: 'answer_yes' } },
  { row: 4, input: { citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: false, formAnswerPolicy: 'answer_no' } },
  { row: 5, input: { citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: false, formAnswerPolicy: 'defer_to_user' } },
  {
    row: 6,
    input: {
      citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: 'unclear',
      formAnswerPolicy: 'defer_to_user', userWords: '我不知道，学校说要等',
    },
  },
  { row: 7, input: { citizenOrGreenCard: false, studentVisa: false, sponsorshipNeededFuture: true, formAnswerPolicy: 'answer_yes' } },
  { row: 8, input: { citizenOrGreenCard: false, studentVisa: false, sponsorshipNeededFuture: false, formAnswerPolicy: 'answer_no' } },
  { row: 9, input: { citizenOrGreenCard: false, studentVisa: false, sponsorshipNeededFuture: 'unclear', formAnswerPolicy: 'defer_to_user' } },
];

test('the gate closes exactly once in the ten-row truth table: only for the funnel that never ran', () => {
  for (const { row, input } of NINE_FUNNEL_ROWS) {
    const home = mkdtempSync(join(tmpdir(), 'mrw-gate-identity-'));
    const profilePath = join(home, 'profile.json');
    writeFileSync(profilePath, `${JSON.stringify(EMPTY_HOME_PROFILE, null, 2)}\n`);

    // 第 10 行的形状: 同一份档案, 漏斗还没跑.
    assert.equal(
      blockingProfileGaps(JSON.parse(readFileSync(profilePath, 'utf8')), {
        work_auth_sources: workAuthSources(home),
      }).ok,
      false,
      '第 10 行 (漏斗一次都没跑过) 必须仍然拦',
    );

    const { write_groups, unwritten_paths } = workAuthAnswers(input);
    for (const group of write_groups) {
      execFileSync(process.execPath, [
        'shared/record_profile_answers.mjs',
        '--json', JSON.stringify(group.answers),
        '--source', group.source, '--category', 'user_work_authorization', '--asked-by', 'onboarding_a0',
      ], { cwd: ROOT, env: onboardTestEnv(home), encoding: 'utf8' });
    }

    const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
    for (const path of unwritten_paths) {
      const key = path.split('.').pop();
      const value = profile.work_authorization[key];
      assert.ok(
        value === null || value === '',
        `第 ${row} 行: ${path} must stay empty, got ${JSON.stringify(value)}`,
      );
    }
    const gate = blockingProfileGaps(profile, { work_auth_sources: workAuthSources(home) });
    assert.equal(gate.ok, true, `第 ${row} 行必须放行, 得到 ${JSON.stringify(gate.missing_paths)}`);
  }
});

test('every gated path is a path the write-back command is allowed to write', () => {
  // A gate that asks for something the writer cannot store is a dead end by
  // construction, so this is checked rather than assumed.
  const writable = answerWritePaths();
  for (const path of GATED_PATHS) {
    assert.ok(writable.has(path), `the gate asks for ${path}, which no question can write`);
  }
});

test('answering the gated question actually opens the gate', () => {
  // End to end on the real CLI: blocked -> record the answer -> open. If these
  // two halves ever disagree about a path name, the user is stuck in a loop
  // that no unit test would catch.
  const home = mkdtempSync(join(tmpdir(), 'mrw-gate-loop-'));
  const profilePath = join(home, 'profile.json');
  writeFileSync(profilePath, `${JSON.stringify({
    personal: {},
    education: {},
    work_authorization: {
      visa_status: '',
      authorized_to_work_us: null,
      requires_sponsorship_now: null,
      requires_sponsorship_future: null,
    },
    resume_path: '/tmp/resume.pdf',
    standard_qa: {},
  }, null, 2)}\n`);
  writeFileSync(join(home, 'search_intent.json'), `${JSON.stringify({
    search_intent: {
      role_type_targets: ['intern'],
      geographic_preference: {
        primary_country: 'United States',
        countries_open_to: ['US'],
        relocation_policy: 'anywhere_primary_country',
      },
    },
  }, null, 2)}\n`);

  const before = blockingProfileGaps(JSON.parse(readFileSync(profilePath, 'utf8')));
  assert.equal(before.ok, false);

  execFileSync(process.execPath, [
    'shared/record_profile_answers.mjs',
    '--json', JSON.stringify({
      'work_authorization.visa_status': 'student_visa_with_permission',
      'work_authorization.authorized_to_work_us': true,
      'work_authorization.requires_sponsorship_now': false,
      'work_authorization.requires_sponsorship_future': true,
    }),
    '--source', 'onboarding_a0',
    '--category', 'user_work_authorization',
    '--asked-by', 'queue_gate',
  ], { cwd: ROOT, env: onboardTestEnv(home), encoding: 'utf8' });

  const after = blockingProfileGaps(JSON.parse(readFileSync(profilePath, 'utf8')));
  assert.equal(after.ok, true, 'recording the gate answer must open the gate');
});

test('the gate is a hard check on the real-batch path, not a warning', () => {
  // supervisor_preflight is a CLI that shells out to the queue, the database and
  // Chrome, so its wiring is asserted at source level — the same approach the
  // driver guards in personal_facts_guard.test.mjs use.
  const preflight = readFileSync(join(ROOT, 'shared/supervisor_preflight.mjs'), 'utf8');
  assert.match(preflight, /blockingProfileGaps/, 'preflight must consult the gate');
  const checksBlock = preflight.match(/const checks = \[([\s\S]*?)\n\];/);
  assert.ok(checksBlock, 'could not locate the preflight checks array');
  assert.match(
    checksBlock[1],
    /work_authorization_answered/,
    'the gate must be a hard check; a WARN is ignored by an automated flow',
  );

  const batch = readFileSync(join(ROOT, 'shared/apply_batch.mjs'), 'utf8');
  assert.match(batch, /blockingProfileGaps/, 'dry-run must surface the gap before the user says 开始');
  assert.match(batch, /profile_gate/, 'dry-run output must carry profile_gate for the queue gate to read');
});
