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
  IDENTITY_QUESTIONS,
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

// 5 situations x 4 fields = 20 cells, every one of them asserted. `undefined`
// means "this module must not write this cell at all" — not false, not "".
const TRUTH_TABLE = [
  {
    name: 'US citizen or green card holder',
    input: { citizenOrGreenCard: true },
    situation: 'citizen_or_green_card',
    cells: {
      [AUTHORIZED]: true,
      [NOW]: false,
      [FUTURE]: false,
      [VISA]: 'US Citizen or Permanent Resident',
    },
  },
  {
    name: 'F-1 whose work permission is already granted',
    input: { citizenOrGreenCard: false, f1Student: true, workPermissionGranted: true },
    situation: 'f1_with_permission',
    cells: {
      [AUTHORIZED]: true,
      [NOW]: false,
      // Derivable from the identity itself: an F-1 work permission expires, so
      // long-term employment needs sponsorship whatever this particular job is.
      [FUTURE]: true,
      [VISA]: 'F-1 with CPT/OPT',
    },
  },
  {
    name: 'F-1 whose work permission is not granted yet',
    input: { citizenOrGreenCard: false, f1Student: true, workPermissionGranted: false },
    situation: 'f1_without_permission',
    cells: {
      // NOT false. Whether this student can work depends on whether the role
      // qualifies for CPT and whether his school approves it — a case-by-case
      // call we are not entitled to make for him. `false` gets him filtered out.
      [AUTHORIZED]: undefined,
      [NOW]: undefined,
      [FUTURE]: true,
      [VISA]: 'F-1 without current work permission',
    },
  },
  {
    name: 'F-1 who cannot tell whether he has permission',
    input: { citizenOrGreenCard: false, f1Student: true, workPermissionGranted: 'unclear', userWords: '我不知道，学校说要等' },
    situation: 'f1_permission_unclear',
    cells: {
      [AUTHORIZED]: undefined,
      [NOW]: undefined,
      [FUTURE]: undefined,
      [VISA]: '我不知道，学校说要等',
    },
  },
  {
    name: 'any other status',
    input: { citizenOrGreenCard: false, f1Student: false, userWords: 'H-1B，去年转的' },
    situation: 'other_status',
    cells: {
      [AUTHORIZED]: undefined,
      [NOW]: undefined,
      [FUTURE]: undefined,
      [VISA]: 'H-1B，去年转的',
    },
  },
];

test('work auth identity: all 20 cells of the truth table', () => {
  for (const row of TRUTH_TABLE) {
    const result = workAuthAnswers(row.input);
    assert.equal(result.situation, row.situation, row.name);
    assert.equal(identitySituation(row.input), row.situation, `${row.name}: situation helper disagrees`);
    for (const [path, expected] of Object.entries(row.cells)) {
      if (expected === undefined) {
        assert.ok(
          !(path in result.answers),
          `${row.name}: ${path} must not be written at all, got ${JSON.stringify(result.answers[path])}`,
        );
        assert.ok(result.unwritten_paths.includes(path), `${row.name}: ${path} must be reported as unwritten`);
      } else {
        assert.equal(result.answers[path], expected, `${row.name}: ${path}`);
      }
    }
  }
});

test('work auth identity: the two situations that settle nothing are flagged for follow-up', () => {
  for (const row of TRUTH_TABLE) {
    const result = workAuthAnswers(row.input);
    const settled = [AUTHORIZED, FUTURE].every((path) => typeof result.answers[path] === 'boolean');
    assert.equal(
      result.needs_lookup,
      !settled,
      `${row.name}: needs_lookup must mean "the gate will still be shut after this answer"`,
    );
  }
});

test('work auth identity: an unclear answer with no words of the user\'s own writes nothing at all', () => {
  // Better an empty visa_status than one we invented a label for. "说不清楚" is
  // a state, not a status.
  const result = workAuthAnswers({ citizenOrGreenCard: false, f1Student: true, workPermissionGranted: 'unclear' });
  assert.deepEqual(result.answers, {});
  assert.equal(result.needs_lookup, true);
});

test('work auth identity: an unanswered or contradictory funnel is an error, never a guess', () => {
  const bad = [
    [{}, 'Q1 unanswered'],
    [{ citizenOrGreenCard: 'yes' }, 'Q1 answered with a string'],
    [{ citizenOrGreenCard: false }, 'Q2 never asked'],
    [{ citizenOrGreenCard: false, f1Student: true }, 'Q3 never asked'],
    [{ citizenOrGreenCard: false, f1Student: true, workPermissionGranted: 'maybe' }, 'Q3 answered out of domain'],
    [{ citizenOrGreenCard: true, f1Student: true }, 'Q2 answered though Q1 already settled it'],
    [{ citizenOrGreenCard: false, f1Student: false, workPermissionGranted: true }, 'Q3 answered though Q2 said no'],
  ];
  for (const [input, why] of bad) {
    assert.throws(() => workAuthAnswers(input), /work_auth_identity/, `${why} must throw, not be filled in`);
  }
});

test('work auth identity: the questions never ask the user for a legal conclusion', () => {
  assert.equal(IDENTITY_QUESTIONS.length, 3);
  const [q1, q2, q3] = IDENTITY_QUESTIONS.map((q) => q.question);
  for (const question of [q1, q2, q3]) {
    assert.doesNotMatch(question, /工作授权|授权在美国工作|legally authorized/, `a person cannot answer this: ${question}`);
  }
  // Q1 and Q2 ask what he is. Q3 asks what a piece of paper says.
  assert.match(q1, /公民/);
  assert.match(q1, /绿卡/);
  assert.match(q2, /F-1/);
  for (const question of [q1, q2]) {
    assert.doesNotMatch(question, /CPT|OPT/, `jargon in a question the user has to answer: ${question}`);
  }
  assert.match(q3, /EAD|I-20/, 'Q3 must point at the document, not ask him to remember a rule');
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

test('work auth identity: end to end, the cells it refuses to derive are still null on disk', () => {
  // The assertion 设计稿 §13.8 第 1 条 asks for by name: not false, not "".
  for (const row of TRUTH_TABLE.filter((r) => r.situation !== 'citizen_or_green_card')) {
    const home = mkdtempSync(join(tmpdir(), 'mrw-identity-'));
    writeFileSync(join(home, 'profile.json'), `${JSON.stringify({
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

    const { answers, unwritten_paths } = workAuthAnswers(row.input);
    if (Object.keys(answers).length > 0) {
      execFileSync(process.execPath, [
        'shared/record_profile_answers.mjs',
        '--json', JSON.stringify(answers),
        '--source', 'onboarding_a0',
        '--category', 'user_work_authorization',
        '--asked-by', 'onboarding_a0',
      ], { cwd: ROOT, env: onboardTestEnv(home), encoding: 'utf8' });
    }

    const profile = JSON.parse(readFileSync(join(home, 'profile.json'), 'utf8'));
    for (const path of unwritten_paths) {
      const key = path.split('.').pop();
      assert.equal(
        profile.work_authorization[key],
        key === 'visa_status' ? '' : null,
        `${row.name}: ${path} must still be untouched, got ${JSON.stringify(profile.work_authorization[key])}`,
      );
    }
  }
});
