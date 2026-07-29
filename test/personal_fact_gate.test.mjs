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
import { sourceFor } from '../shared/answer_provenance.mjs';
import { onboardTestEnv } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the gate opens for a profile that answered work authorization', () => {
  // The one real user today: F-1 OPT, all four keys present. This assertion is
  // the "existing user sees no change" guarantee in executable form.
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
    'one key missing': { work_authorization: { authorized_to_work_us: true } },
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
  assert.deepEqual(
    blockingProfileGaps({ work_authorization: { authorized_to_work_us: true } }).missing_paths,
    ['work_authorization.requires_sponsorship_future'],
  );
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

test('"I do not know" is not a dead end: the gate hands back all three things at once', () => {
  // 设计稿 §13.3: 卡在哪 / 去哪里查 / 查清楚之前会怎样. Stopping the batch without
  // all three is the behaviour this round exists to delete — the user sees
  // "0 submitted", no question, and no reason.
  const result = blockingProfileGaps({});
  assert.equal(result.ok, false);
  assert.ok(result.blocked_because.length > 0, 'the gate must say what it is stuck on');
  assert.deepEqual(result.where_to_check, WHERE_TO_CHECK, 'the three places must come from one source, not be retyped');
  // 关卡 7: 「这一批先不投」已删. 剩下的承诺是「问到那道题的那几行停下, 其余照投」.
  assert.match(result.what_happens_next, /其余照投/);
  assert.doesNotMatch(result.what_happens_next, /这一批先不投|这一批我先不投/);
});

test('the gate does not ask twice in one batch once the user has said he cannot tell', () => {
  // Without this the loop is: ask -> "I don't know" -> gate still shut -> ask
  // the same question again. The signal is structural, not a guess: provenance
  // says a human supplied visa_status, and the two gated booleans are still
  // unanswered, so asking again can only produce the same answer.
  const unclear = {
    work_authorization: {
      visa_status: '我不知道，学校说要等',
      authorized_to_work_us: null,
      requires_sponsorship_now: null,
      requires_sponsorship_future: null,
    },
  };
  const firstTime = blockingProfileGaps(unclear);
  assert.equal(firstTime.ok, false);
  assert.equal(firstTime.asked_in_this_batch, false, 'nothing on record means nobody asked yet');

  const afterAsking = blockingProfileGaps(unclear, { visa_status_source: 'user_answer' });
  assert.equal(afterAsking.ok, false, 'a status we cannot act on still stops the batch');
  assert.equal(afterAsking.asked_in_this_batch, true);
  assert.ok(afterAsking.where_to_check.length === 3, 'and he still gets told where to look');

  // A value nobody vouches for is not an answer: an inferred or unlabelled
  // visa_status must not silence the question.
  for (const source of ['unknown', 'legacy_unverified', 'resume_inferred']) {
    assert.equal(
      blockingProfileGaps(unclear, { visa_status_source: source }).asked_in_this_batch,
      false,
      `${source} is not the user telling us`,
    );
  }
});

test('an answered gate never reports itself as already asked', () => {
  const settled = blockingProfileGaps({
    work_authorization: {
      visa_status: 'US Citizen or Permanent Resident',
      authorized_to_work_us: true,
      requires_sponsorship_now: false,
      requires_sponsorship_future: false,
    },
  }, { visa_status_source: 'user_answer' });
  assert.equal(settled.ok, true);
  assert.equal(settled.asked_in_this_batch, false);
  assert.deepEqual(settled.where_to_check, []);
});

test('every situation the identity funnel can produce is written to disk without a single invented boolean', () => {
  // 本条在本提交里只守一件事: 漏斗产出的每一种情形都能原样落盘, 且它拒绝写的
  // 格子落盘后仍是 null. 门的判据本身在下一个提交 (ADR-11) 换成「问过没问过」,
  // 那时这里会补上逐行的开/关期望.
  const home = mkdtempSync(join(tmpdir(), 'mrw-gate-identity-'));
  for (const input of [
    { citizenOrGreenCard: true },
    { citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: true },
    { citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: false, formAnswerPolicy: 'defer_to_user' },
    {
      citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: 'unclear',
      formAnswerPolicy: 'answer_yes', userWords: '不清楚',
    },
    {
      citizenOrGreenCard: false, studentVisa: false, sponsorshipNeededFuture: 'unclear',
      formAnswerPolicy: 'answer_no', userWords: 'H-1B',
    },
  ]) {
    const profilePath = join(home, 'profile.json');
    writeFileSync(profilePath, `${JSON.stringify({
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
    }, null, 2)}\n`);

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
        `${JSON.stringify(input)}: ${path} must stay empty, got ${JSON.stringify(value)}`,
      );
    }
    const gate = blockingProfileGaps(profile, {
      visa_status_source: sourceFor(home, 'work_authorization.visa_status', profile.work_authorization.visa_status),
    });
    if (!gate.ok) {
      assert.equal(gate.where_to_check.length, 3, `${JSON.stringify(input)}: a blocked user must be told where to look`);
    }
  }
});

test('every gated path is a path the write-back command is allowed to write', () => {
  // A gate that asks for something the writer cannot store is a dead end by
  // construction, so this is checked rather than assumed.
  const writable = answerWritePaths();
  for (const path of GATED_PATHS) {
    assert.ok(writable.has(path), `the gate asks for ${path}, which no question can write`);
    assert.equal(writable.get(path).value_type, 'boolean');
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
      'work_authorization.visa_status': 'F-1 OPT eligible',
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
