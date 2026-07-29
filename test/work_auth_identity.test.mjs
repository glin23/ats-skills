// The truth table behind 关卡 3 ①: ask the user which kind of person he is, and
// let code draw the legal conclusion.
//
// The old question asked "which work authorization do you have?" with CPT/OPT in
// the option text. 拍板人的原话是「这没人能知道」—— and he is right: whether a
// given F-1 student is "authorized to work" depends on the role, the school and
// the timing. Asking him to answer it is asking him to make a legal call, and a
// wrong answer hurts in both directions (an international student who says "yes"
// has misstated a fact; a citizen who says "no" is filtered out on the spot).
//
// So the module only maps facts a person can read off his own documents onto the
// four profile fields — and, just as importantly, leaves every cell it cannot
// derive completely alone. Writing `false` into a cell nobody answered is the
// exact defect this whole round exists to remove; `false` and "the user said no"
// are byte-identical on disk (PROJECT_MEMORY 长期原则第 2 条).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BLOCKED_BECAUSE,
  FORM_ANSWER_POLICIES,
  IDENTITY_QUESTIONS,
  WHAT_HAPPENS_NEXT,
  Q4_NOTICE,
  VISA_STATUS,
  WHERE_TO_CHECK,
  WORK_AUTH_PATHS,
  identitySituation,
  workAuthAnswers,
} from '../shared/work_auth_identity.mjs';
import { answerWritePaths } from '../shared/missing_field_questions.mjs';
import { onboardTestEnv } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const AUTHORIZED = WORK_AUTH_PATHS.authorized_to_work_us;
const NOW = WORK_AUTH_PATHS.requires_sponsorship_now;
const FUTURE = WORK_AUTH_PATHS.requires_sponsorship_future;
const VISA = WORK_AUTH_PATHS.visa_status;
const POLICY = WORK_AUTH_PATHS.form_answer_policy;

// 设计稿 §13.3.1 的定稿真值表: 10 种情形 x 5 列 = 50 格, 逐格断言.
// `undefined` 一律读作「这一格一个字都不许写」—— 不是 false, 不是空字符串.
// 第 10 行（漏斗一次都没跑过）没有输入可喂，它由本文件末尾那条磁盘断言守着。
const TRUTH_TABLE = [
  {
    row: 1,
    name: 'US citizen or green card holder',
    input: { citizenOrGreenCard: true },
    situation: VISA_STATUS.citizen_or_green_card,
    cells: {
      [AUTHORIZED]: true,
      [NOW]: false,
      [FUTURE]: false,
      [VISA]: 'citizen_or_green_card',
      [POLICY]: undefined,
    },
  },
  {
    row: 2,
    name: 'student whose work permission is already in hand',
    input: { citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: true },
    situation: VISA_STATUS.student_visa_with_permission,
    cells: {
      [AUTHORIZED]: true,
      [NOW]: false,
      // Derivable from the identity itself: a student work permission expires,
      // so long-term employment needs sponsorship whatever this job is.
      [FUTURE]: true,
      [VISA]: 'student_visa_with_permission',
      [POLICY]: undefined,
    },
  },
  {
    row: 3,
    name: 'student, permission not yet granted, Q4 = A (fill "yes")',
    input: {
      citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: false,
      formAnswerPolicy: FORM_ANSWER_POLICIES.answer_yes,
    },
    situation: VISA_STATUS.student_visa_no_permission_yet,
    cells: {
      // His own statement, not our derivation — the source split is asserted
      // separately below, because on disk the two are byte-identical.
      [AUTHORIZED]: true,
      [NOW]: undefined,
      [FUTURE]: true,
      [VISA]: 'student_visa_no_permission_yet',
      [POLICY]: 'answer_yes',
    },
  },
  {
    row: 4,
    name: 'student, permission not yet granted, Q4 = B (fill "no")',
    input: {
      citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: false,
      formAnswerPolicy: FORM_ANSWER_POLICIES.answer_no,
    },
    situation: VISA_STATUS.student_visa_no_permission_yet,
    cells: {
      [AUTHORIZED]: false,
      [NOW]: undefined,
      [FUTURE]: true,
      [VISA]: 'student_visa_no_permission_yet',
      [POLICY]: 'answer_no',
    },
  },
  {
    row: 5,
    name: 'student, permission not yet granted, Q4 = C (do not answer for me) — the default',
    input: {
      citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: false,
      formAnswerPolicy: FORM_ANSWER_POLICIES.defer_to_user,
    },
    situation: VISA_STATUS.student_visa_no_permission_yet,
    cells: {
      [AUTHORIZED]: undefined,
      [NOW]: undefined,
      [FUTURE]: true,
      [VISA]: 'student_visa_no_permission_yet',
      [POLICY]: 'defer_to_user',
    },
  },
  {
    row: 6,
    name: 'student who cannot tell whether he has permission, Q4 = C',
    input: {
      citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: 'unclear',
      formAnswerPolicy: FORM_ANSWER_POLICIES.defer_to_user, userWords: '我不知道，学校说要等',
    },
    situation: VISA_STATUS.student_visa_permission_unclear,
    cells: {
      [AUTHORIZED]: undefined,
      [NOW]: undefined,
      // 上一版把这一格整行清空，等于把 Q2 已经答完的事实一起丢掉。
      // 实测: 补上这一格, 被阻塞的真实投递 16/72 → 4/72.
      [FUTURE]: true,
      [VISA]: 'student_visa_permission_unclear',
      [POLICY]: 'defer_to_user',
    },
  },
  {
    row: 7,
    name: 'other status, Q5 = needs sponsorship later, Q4 = A',
    input: {
      citizenOrGreenCard: false, studentVisa: false,
      sponsorshipNeededFuture: true, formAnswerPolicy: FORM_ANSWER_POLICIES.answer_yes,
    },
    situation: VISA_STATUS.other_status,
    cells: {
      [AUTHORIZED]: true,
      [NOW]: undefined,
      [FUTURE]: true,
      [VISA]: 'other_status',
      [POLICY]: 'answer_yes',
    },
  },
  {
    row: 8,
    name: 'other status, Q5 = does not need sponsorship later, Q4 = B',
    input: {
      citizenOrGreenCard: false, studentVisa: false,
      sponsorshipNeededFuture: false, formAnswerPolicy: FORM_ANSWER_POLICIES.answer_no,
    },
    situation: VISA_STATUS.other_status,
    cells: {
      [AUTHORIZED]: false,
      [NOW]: undefined,
      [FUTURE]: false,
      [VISA]: 'other_status',
      [POLICY]: 'answer_no',
    },
  },
  {
    row: 9,
    name: 'other status, Q5 = cannot tell, Q4 = C',
    input: {
      citizenOrGreenCard: false, studentVisa: false,
      sponsorshipNeededFuture: 'unclear', formAnswerPolicy: FORM_ANSWER_POLICIES.defer_to_user,
    },
    situation: VISA_STATUS.other_status,
    cells: {
      [AUTHORIZED]: undefined,
      [NOW]: undefined,
      // 绝不许拿 Q4 的答案去补这一格:「碰到授权题怎么答」与「将来要不要办手续」
      // 是两件事, 用前者推后者就是新造一次编造.
      [FUTURE]: undefined,
      [VISA]: 'other_status',
      [POLICY]: 'defer_to_user',
    },
  },
];

test('work auth identity: all 50 cells of the 定稿 truth table (10 situations x 5 columns)', () => {
  let asserted = 0;
  for (const row of TRUTH_TABLE) {
    const result = workAuthAnswers(row.input);
    assert.equal(result.situation, row.situation, row.name);
    assert.equal(identitySituation(row.input), row.situation, `${row.name}: situation helper disagrees`);
    for (const [path, expected] of Object.entries(row.cells)) {
      asserted += 1;
      if (expected === undefined) {
        assert.ok(
          !(path in result.answers),
          `第 ${row.row} 行 ${row.name}: ${path} must not be written at all, got ${JSON.stringify(result.answers[path])}`,
        );
        assert.ok(result.unwritten_paths.includes(path), `第 ${row.row} 行 ${row.name}: ${path} must be reported as unwritten`);
      } else {
        assert.equal(result.answers[path], expected, `第 ${row.row} 行 ${row.name}: ${path}`);
      }
    }
  }
  // 第 10 行（漏斗没跑过）的 5 格由 'the funnel that never ran' 那条测试守着。
  assert.equal(asserted, 45, 'the truth table must assert 9 x 5 cells here; the 10th row is asserted on disk');
});

test('work auth identity: the 10th row — a funnel that never ran writes nothing and refuses to guess', () => {
  // 「漏斗一次都没跑过」不是一个可以喂进来的输入, 它是「没有人调用过我」。
  // 所以这一行的断言形状是: 任何缺答案的调用都必须抛错, 而不是产出一行默认值.
  for (const input of [{}, undefined, { citizenOrGreenCard: null }]) {
    assert.throws(() => workAuthAnswers(input), /work_auth_identity/, `${JSON.stringify(input)} must throw`);
  }
});

test('work auth identity: Q4 covers every situation that Q3/Q5 leaves open, in all three settings', () => {
  const openSituations = [
    { citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: false },
    { citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: 'unclear' },
    { citizenOrGreenCard: false, studentVisa: false, sponsorshipNeededFuture: true },
    { citizenOrGreenCard: false, studentVisa: false, sponsorshipNeededFuture: false },
    { citizenOrGreenCard: false, studentVisa: false, sponsorshipNeededFuture: 'unclear' },
  ];
  const expectedAuthorized = {
    [FORM_ANSWER_POLICIES.answer_yes]: true,
    [FORM_ANSWER_POLICIES.answer_no]: false,
    [FORM_ANSWER_POLICIES.defer_to_user]: undefined,
  };
  for (const base of openSituations) {
    for (const policy of Object.values(FORM_ANSWER_POLICIES)) {
      const result = workAuthAnswers({ ...base, formAnswerPolicy: policy });
      assert.equal(result.answers[POLICY], policy, `${JSON.stringify(base)} + ${policy}: policy must always be written`);
      const expected = expectedAuthorized[policy];
      if (expected === undefined) {
        assert.ok(!(AUTHORIZED in result.answers), `${JSON.stringify(base)} + ${policy}: nothing may be written`);
      } else {
        assert.equal(result.answers[AUTHORIZED], expected, `${JSON.stringify(base)} + ${policy}`);
      }
      // requires_sponsorship_now is never derivable once Q3 is not a plain yes.
      assert.ok(!(NOW in result.answers), `${JSON.stringify(base)} + ${policy}: requires_sponsorship_now is not ours to write`);
    }
  }
});

test('work auth identity: "he said it" and "we derived it" are two different sources on the same byte', () => {
  // 设计稿 §13.9.3 第 6 条. 档案里第 1 行的 true 与第 3 行的 true 字节相同,
  // 只有留痕能把它们分开 —— 留痕缺失 = 测试红.
  const derived = workAuthAnswers({ citizenOrGreenCard: true });
  assert.equal(derived.answers[AUTHORIZED], true);
  assert.equal(derived.answer_sources[AUTHORIZED], 'onboarding_a0');

  const stated = workAuthAnswers({
    citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: false,
    formAnswerPolicy: FORM_ANSWER_POLICIES.answer_yes,
  });
  assert.equal(stated.answers[AUTHORIZED], true, 'the value on disk is identical…');
  assert.equal(stated.answer_sources[AUTHORIZED], 'user_answer', '…and only the source tells them apart');
  assert.equal(stated.answer_sources[FUTURE], 'onboarding_a0', 'the derived cell in the same row keeps its own source');

  // write_groups is what the caller feeds record_profile_answers: one call per
  // source, so the two never collapse into one provenance entry.
  const sources = stated.write_groups.map((g) => g.source).sort();
  assert.deepEqual(sources, ['onboarding_a0', 'user_answer']);
  for (const group of stated.write_groups) {
    assert.ok(Object.keys(group.answers).length > 0, 'an empty write group would be a wasted CLI call');
    for (const path of Object.keys(group.answers)) {
      assert.equal(stated.answer_sources[path], group.source, `${path} is grouped under the wrong source`);
    }
  }
});

test('work auth identity: his own words are kept where no employer-facing text can read them', () => {
  const result = workAuthAnswers({
    citizenOrGreenCard: false, studentVisa: false, sponsorshipNeededFuture: 'unclear',
    formAnswerPolicy: FORM_ANSWER_POLICIES.defer_to_user, userWords: '我是陪读签证，老公在这边工作',
  });
  assert.equal(result.answers[WORK_AUTH_PATHS.user_words], '我是陪读签证，老公在这边工作');
  assert.equal(result.answers[VISA], 'other_status', 'visa_status is an enum now, never his sentence');
  assert.equal(result.answer_sources[WORK_AUTH_PATHS.user_words], 'user_answer');
  // ADR-12 R4: the raw sentence lives under a leading underscore = system-only.
  assert.match(WORK_AUTH_PATHS.user_words, /\._[a-z]/, 'the raw-words path must be marked system-only by name');
});

test('work auth identity: an unanswered or contradictory funnel is an error, never a guess', () => {
  const bad = [
    [{}, 'Q1 unanswered'],
    [{ citizenOrGreenCard: 'yes' }, 'Q1 answered with a string'],
    [{ citizenOrGreenCard: false }, 'Q2 never asked'],
    [{ citizenOrGreenCard: false, studentVisa: true }, 'Q3 never asked'],
    [{ citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: 'maybe' }, 'Q3 answered out of domain'],
    [{ citizenOrGreenCard: true, studentVisa: true }, 'Q2 answered though Q1 already settled it'],
    [{ citizenOrGreenCard: false, studentVisa: false, workPermissionGranted: true }, 'Q3 answered though Q2 said no'],
    [{ citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: false }, 'Q4 never asked though Q3 left it open'],
    [{ citizenOrGreenCard: false, studentVisa: false, sponsorshipNeededFuture: true }, 'Q4 never asked though Q2 said no'],
    [{ citizenOrGreenCard: false, studentVisa: false, formAnswerPolicy: 'defer_to_user' }, 'Q5 never asked'],
    [{
      citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: false, formAnswerPolicy: 'whatever',
    }, 'Q4 answered out of domain'],
    [{
      citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: true,
      formAnswerPolicy: 'defer_to_user',
    }, 'Q4 answered though Q3 already settled it'],
    [{
      citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: false,
      formAnswerPolicy: 'defer_to_user', sponsorshipNeededFuture: true,
    }, 'Q5 answered though it is only asked of the other-status branch'],
  ];
  for (const [input, why] of bad) {
    assert.throws(() => workAuthAnswers(input), /work_auth_identity/, `${why} must throw, not be filled in`);
  }
});

test('work auth identity: the questions never ask the user for a legal conclusion', () => {
  assert.equal(IDENTITY_QUESTIONS.length, 5);
  const questions = IDENTITY_QUESTIONS.map((q) => q.question);
  const [q1, q2, q3, q4, q5] = questions;
  for (const question of questions) {
    assert.doesNotMatch(
      question,
      /你有没有工作授权|你是否有工作授权|你的工作授权|legally authorized/,
      `a person cannot answer this: ${question}`,
    );
    // 关卡 3 ① 硬约束: 问句里不出现签证与许可的类别术语.
    assert.doesNotMatch(question, /CPT|OPT|EAD|H-?1B|J-?1/i, `jargon in a question the user must answer: ${question}`);
  }
  assert.match(q1, /公民/);
  assert.match(q1, /绿卡/);
  assert.match(q2, /学生签证|留学生/);
  // Q3 asks what a piece of paper says, and says out loud that "not yet" is the
  // normal answer — the old wording made a majority state look like a failed
  // eligibility check.
  assert.match(q3, /已经有一份批下来|允许你在美国工作的证件/);
  const q3Options = IDENTITY_QUESTIONS[2].options.map((o) => o.label);
  assert.equal(q3Options.length, 3);
  assert.ok(q3Options.some((o) => /正常/.test(o)), `「还没有」这一档必须写着「正常」: ${q3Options.join(' / ')}`);
  assert.ok(q3Options.some((o) => /说不清楚/.test(o)), '「说不清楚」必须是一个正式选项');
  assert.match(q5, /需要公司帮你办手续|办手续/);
});

test('work auth identity: Q4 tells him the three characters land on a real employer\'s form', () => {
  // 关卡 8 决定一: 凡是把用户的答案原样打到雇主表单上的选项, 问的时候必须先讲明
  // 这件事 —— 不讲就是诱导. 这句提示是拍板的组成部分, 不是可选文案.
  const q4 = IDENTITY_QUESTIONS.find((q) => q.id === 'Q4');
  assert.ok(q4, 'Q4 must exist');
  assert.match(Q4_NOTICE, /会被原样打到真实雇主的表单上/);
  assert.equal(q4.notice, Q4_NOTICE, 'the notice must travel with the question, not live in a comment');
  assert.match(Q4_NOTICE, /国际学生办公室|就业指导中心/, '不确定选哪个时的去处必须挨着这句提示');
  const labels = q4.options.map((o) => o.label);
  assert.equal(labels.length, 3);
  assert.equal(q4.options.find((o) => o.default)?.value, FORM_ANSWER_POLICIES.defer_to_user, '默认必须是「别替我答」');
  assert.deepEqual(q4.options.map((o) => o.value), ['answer_yes', 'answer_no', 'defer_to_user']);
});

test('work auth identity: Q5 keeps all three of its guard rails', () => {
  // 设计稿 §13.3.4 的三条护栏, 逐条一个断言 —— 写在注释里的护栏等于没有.
  const q5 = IDENTITY_QUESTIONS.find((q) => q.id === 'Q5');
  assert.ok(q5, 'Q5 must exist');
  // ① 「说不清楚」是三档之一, 且零代价 (走 Q4 的 policy, 不拦任何东西).
  const unclear = q5.options.find((o) => o.value === 'unclear');
  assert.ok(unclear, '一道没有诚实出口的问题, 迟早会被用户猜着答');
  const answered = workAuthAnswers({
    citizenOrGreenCard: false, studentVisa: false, sponsorshipNeededFuture: 'unclear',
    formAnswerPolicy: FORM_ANSWER_POLICIES.defer_to_user,
  });
  assert.ok(!(FUTURE in answered.answers), '「说不清楚」不许被补成一个值');
  assert.equal(answered.answers[POLICY], 'defer_to_user', '它的后续就是 Q4 的 policy, 没有第二种代价');
  // ② 零签证类别术语. ③ 零倾向性提示.
  const q5Text = [q5.question, ...q5.options.map((o) => o.label)].join(' ');
  assert.doesNotMatch(q5Text, /CPT|OPT|EAD|H-?1B|J-?1|F-?1/i);
  assert.doesNotMatch(q5Text, /大多数人|建议选|一般来说|通常选|推荐/, '倾向性提示是用社会证明包装的法律建议');
  assert.equal(q5.ask_when, 'Q2 = 否', 'Q5 只对「其他情形」问, 留学生一律不问');
});

test('work auth identity: the batch-level wording no longer says "this batch is off"', () => {
  // 关卡 7 推翻的前提的两个直接产物. 实测被阻塞面 5.6%, 不是「几乎每一份」.
  for (const line of [BLOCKED_BECAUSE, WHAT_HAPPENS_NEXT]) {
    assert.doesNotMatch(line, /这一批先不投|这一批我先不投|几乎每一份都会卡住/, `被推翻的前提还留在文案里: ${line}`);
  }
  assert.match(WHAT_HAPPENS_NEXT, /其余照投|照投/, '「问到的那几行停下, 其余照投」是本轮的结论');
});

test('work auth identity: "I do not know" is given three concrete places to look', () => {
  assert.equal(WHERE_TO_CHECK.length, 3);
  assert.ok(WHERE_TO_CHECK.some((place) => /国际学生办公室|OISS/.test(place)));
  assert.ok(WHERE_TO_CHECK.some((place) => /I-20/.test(place)));
  assert.ok(WHERE_TO_CHECK.some((place) => /EAD/.test(place)));
  for (const place of WHERE_TO_CHECK) {
    assert.doesNotMatch(place, /请自行确认|自己查一下$/, 'a place to look, not a brush-off');
  }
});

test('work auth identity: every path it can write is a path the write-back command accepts', () => {
  const writable = answerWritePaths();
  for (const path of Object.values(WORK_AUTH_PATHS)) {
    assert.ok(writable.has(path), `${path} is not declared by any question, so the answer could never be stored`);
  }
  for (const row of TRUTH_TABLE) {
    for (const [path, value] of Object.entries(workAuthAnswers(row.input).answers)) {
      const expected = writable.get(path).value_type;
      assert.equal(typeof value, expected, `${row.name}: ${path} must be a ${expected} for the writer to accept it`);
    }
  }
});

test('the onboarding guide asks the same three questions, and no longer writes the deadlock down as normal', () => {
  // A guide that still says "leave it null and let the gate ask later" turns the
  // dead end into documented behaviour: the user finishes onboarding believing
  // he is set up, and finds out at the batch that he is not. The words a model
  // is given are the only thing that runs during onboarding, so they are checked
  // here the way code is checked.
  const guide = readFileSync(
    join(ROOT, '.claude/skills/mrweirdo-onboard/references/intake-and-profile.md'),
    'utf8',
  );
  for (const { id, question } of IDENTITY_QUESTIONS) {
    assert.ok(guide.includes(question), `${id} is not the question the guide tells the model to ask`);
  }
  assert.doesNotMatch(
    guide,
    /F-1 CPT\/OPT; F-1 now and future sponsorship/,
    'the four-option work-authorization question is the one 关卡 3 ① replaced',
  );
  assert.doesNotMatch(
    guide,
    /the pre-batch gate will ask before anything is submitted/,
    'the guide may not present an unanswered work-authorization key as a normal outcome',
  );
  for (const place of WHERE_TO_CHECK) {
    // The guide points at the module rather than retyping the list; what it must
    // not do is leave the user with no place to look at all.
    assert.ok(place.length > 0);
  }
  assert.match(guide, /WHERE_TO_CHECK/, 'the guide must send the model to the one list of places to check');
  assert.match(guide, /满 18 岁/, '关卡 2 ②: A2 asks the age question in the same breath');
});

const EMPTY_WORK_AUTH = {
  visa_status: '',
  authorized_to_work_us: null,
  requires_sponsorship_now: null,
  requires_sponsorship_future: null,
  form_answer_policy: null,
  _user_words: '',
};

function seedHome(prefix) {
  const home = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(home, 'profile.json'), `${JSON.stringify({
    personal: {},
    education: {},
    work_authorization: { ...EMPTY_WORK_AUTH },
    resume_path: '/tmp/resume.pdf',
    standard_qa: {},
  }, null, 2)}\n`);
  return home;
}

test('work auth identity: end to end, the cells it refuses to derive are still null on disk', () => {
  // The assertion 设计稿 §13.9.3 第 2 条 asks for by name: not false, not "".
  for (const row of TRUTH_TABLE) {
    const home = seedHome('mrw-identity-');
    const { write_groups, unwritten_paths } = workAuthAnswers(row.input);
    for (const group of write_groups) {
      execFileSync(process.execPath, [
        'shared/record_profile_answers.mjs',
        '--json', JSON.stringify(group.answers),
        '--source', group.source,
        '--category', 'user_work_authorization',
        '--asked-by', 'onboarding_a0',
      ], { cwd: ROOT, env: onboardTestEnv(home), encoding: 'utf8' });
    }

    const profile = JSON.parse(readFileSync(join(home, 'profile.json'), 'utf8'));
    for (const path of unwritten_paths) {
      const key = path.split('.').pop();
      assert.equal(
        profile.work_authorization[key],
        EMPTY_WORK_AUTH[key],
        `第 ${row.row} 行 ${row.name}: ${path} must still be untouched, got ${JSON.stringify(profile.work_authorization[key])}`,
      );
    }
  }
});

test('work auth identity: the 10th row on disk — nothing ran, so all five cells are still empty', () => {
  const home = seedHome('mrw-identity-never-');
  const profile = JSON.parse(readFileSync(join(home, 'profile.json'), 'utf8'));
  for (const path of Object.values(WORK_AUTH_PATHS)) {
    const key = path.split('.').pop();
    assert.equal(
      profile.work_authorization[key],
      EMPTY_WORK_AUTH[key],
      `${path} must be empty when the funnel never ran, got ${JSON.stringify(profile.work_authorization[key])}`,
    );
  }
});
