// The write-back path used to be a sentence in SKILL.md ("update the profile as
// needed") aimed at a language model. PROJECT_MEMORY's first long-term principle
// is the evidence that a red line living only in prose is not a red line: every
// defect in this round came from a personal fact reaching profile.json without
// anyone being able to say who supplied it. This suite pins the replacement:
// a CLI that can only write paths some question actually asked for, refuses to
// coerce a three-state boolean, and leaves the profile byte-identical whenever
// it refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { QUESTION_TEMPLATES, answerWritePaths } from '../shared/missing_field_questions.mjs';
import { fingerprint, readProvenance, recordEntries, sourceFor } from '../shared/answer_provenance.mjs';
import { main, main as recordMain } from '../shared/record_profile_answers.mjs';
import { workAuthAnswers } from '../shared/work_auth_identity.mjs';
import { onboardTestEnv } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'shared/record_profile_answers.mjs');

const VALID_PROFILE = {
  personal: { address_city: 'Boston', address_state: 'MA', address_country: 'United States' },
  education: { gpa: '3.4' },
  work_authorization: {
    visa_status: '',
    authorized_to_work_us: null,
    requires_sponsorship_now: null,
    requires_sponsorship_future: null,
  },
  legal_attestations: {
    conflicting_obligations: null,
    no_prohibited_possessor_status: null,
    relatives_in_federal_government_or_contractors: null,
  },
  demographics: {
    race: null, hispanic_or_latino: null, gender: null, veteran_status: null, disability_status: null,
  },
  resume_path: '/tmp/resume.pdf',
  standard_qa: {},
};

const VALID_INTENT = {
  search_intent: {
    role_type_targets: ['intern'],
    geographic_preference: {
      primary_country: 'United States',
      countries_open_to: ['US'],
      relocation_policy: 'anywhere_primary_country',
    },
  },
};

function makeHome(prefix, profile = VALID_PROFILE, intent = VALID_INTENT) {
  const home = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'profile.json'), `${JSON.stringify(profile, null, 2)}\n`);
  if (intent) writeFileSync(join(home, 'search_intent.json'), `${JSON.stringify(intent, null, 2)}\n`);
  return home;
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function runCli(home, args) {
  const run = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: onboardTestEnv(home),
    encoding: 'utf8',
  });
  let parsed = null;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    parsed = null;
  }
  return { code: run.status, stdout: run.stdout, stderr: run.stderr, json: parsed };
}

test('record_profile_answers writes the answer and records where it came from', () => {
  const home = makeHome('mrw-rec-ok-');
  const profilePath = join(home, 'profile.json');

  const run = runCli(home, [
    '--json', JSON.stringify({
      'work_authorization.visa_status': 'student_visa_with_permission',
      'work_authorization.authorized_to_work_us': true,
      'work_authorization.requires_sponsorship_now': false,
      'work_authorization.requires_sponsorship_future': true,
    }),
    '--source', 'onboarding_a0',
    '--category', 'user_work_authorization',
    '--asked-by', 'queue_gate',
  ]);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.json.ok, true);
  assert.equal(run.json.changed.length, 4);
  assert.deepEqual(
    run.json.changed.find((c) => c.path === 'work_authorization.authorized_to_work_us'),
    { path: 'work_authorization.authorized_to_work_us', from: null, to: true },
  );

  const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  assert.equal(profile.work_authorization.authorized_to_work_us, true);
  assert.equal(profile.work_authorization.requires_sponsorship_now, false);
  assert.equal(profile.work_authorization.visa_status, 'student_visa_with_permission');
  // Everything the command was not asked to touch stays exactly as it was.
  assert.equal(profile.education.gpa, '3.4');
  assert.equal(profile.legal_attestations.no_prohibited_possessor_status, null);

  const provenance = readProvenance(home);
  const entry = provenance.entries['work_authorization.authorized_to_work_us'];
  assert.equal(entry.source, 'onboarding_a0');
  assert.equal(entry.asked_by, 'queue_gate');
  assert.equal(entry.category, 'user_work_authorization');
  assert.equal(entry.value_fingerprint, fingerprint(true));
  assert.ok(!('value' in entry), 'provenance must not keep a second copy of the personal value');
  assert.equal(sourceFor(home, 'work_authorization.authorized_to_work_us', true), 'onboarding_a0');
  // A fingerprint that no longer matches means the value was changed behind our
  // back; the record says so instead of vouching for a value it did not see.
  assert.equal(sourceFor(home, 'work_authorization.authorized_to_work_us', false), 'unknown');
});

test('record_profile_answers refuses a path no question ever asked for, and does not touch the profile', () => {
  const home = makeHome('mrw-rec-whitelist-');
  const profilePath = join(home, 'profile.json');
  const before = digest(profilePath);

  const run = runCli(home, [
    '--json', JSON.stringify({ 'personal.email': 'someone-else@example.com' }),
    '--source', 'user_answer',
  ]);

  assert.equal(run.code, 2);
  assert.match(run.stderr, /personal\.email/);
  assert.equal(digest(profilePath), before, 'profile.json must be byte-identical after a rejected write');
  assert.equal(existsSync(join(home, 'answer_provenance.json')), false);
});

test('record_profile_answers refuses to coerce a three-state boolean', () => {
  const home = makeHome('mrw-rec-type-');
  const profilePath = join(home, 'profile.json');
  const before = digest(profilePath);

  for (const bad of ['true', 'Yes', 1, null]) {
    const run = runCli(home, [
      '--json', JSON.stringify({ 'work_authorization.authorized_to_work_us': bad }),
      '--source', 'user_answer',
    ]);
    assert.equal(run.code, 3, `value ${JSON.stringify(bad)} should be a type violation`);
    assert.equal(digest(profilePath), before, `profile.json changed after rejecting ${JSON.stringify(bad)}`);
  }

  const stringPath = runCli(home, [
    '--json', JSON.stringify({ 'education.gpa': 3.4 }),
    '--source', 'user_answer',
  ]);
  assert.equal(stringPath.code, 3);
  assert.equal(digest(profilePath), before);
});

// ADR-5「模板即权限」原来只管到路径这一层: 一条声明过的路径可以收下任何一个
// 同类型的值. 对枚举字段这不够 —— form_answer_policy 写错一个字符, 下游的
// 「别替我答」就会静默变成「没答过」, 于是他答过的问题被再问一遍; visa_status
// 写进一句自由文本, 就是 ADR-12 那条被逐字打给雇主的路重新长出来.
test('record_profile_answers refuses a value outside the enum, and does not touch the profile', () => {
  const home = makeHome('mrw-rec-enum-');
  const profilePath = join(home, 'profile.json');
  const before = digest(profilePath);

  const bad = [
    { 'work_authorization.form_answer_policy': 'defer' },
    { 'work_authorization.form_answer_policy': 'answer_maybe' },
    { 'work_authorization.form_answer_policy': '' },
    { 'work_authorization.visa_status': 'F-1 OPT eligible' },
    { 'work_authorization.visa_status': '我不知道，学校说要等' },
  ];
  for (const answers of bad) {
    const run = runCli(home, ['--json', JSON.stringify(answers), '--source', 'user_answer']);
    assert.equal(run.code, 3, `${JSON.stringify(answers)} should be refused as an out-of-enum value`);
    assert.match(run.stderr, /form_answer_policy|visa_status/);
    assert.equal(digest(profilePath), before, `profile.json changed after rejecting ${JSON.stringify(answers)}`);
  }

  for (const answers of [
    { 'work_authorization.form_answer_policy': 'defer_to_user' },
    { 'work_authorization.visa_status': 'student_visa_no_permission_yet' },
    // 他的原话不是枚举, 它就该原样收下 —— 枚举管的是给系统看的那一格.
    { 'work_authorization._user_words': '我不知道，学校说要等' },
  ]) {
    const run = runCli(home, ['--json', JSON.stringify(answers), '--source', 'user_answer']);
    assert.equal(run.code, 0, `${JSON.stringify(answers)} must be accepted: ${run.stderr}`);
  }
  const written = JSON.parse(readFileSync(profilePath, 'utf8')).work_authorization;
  assert.equal(written.form_answer_policy, 'defer_to_user');
  assert.equal(written.visa_status, 'student_visa_no_permission_yet');
  assert.equal(written._user_words, '我不知道，学校说要等');
});

test('the funnel round-trips: every situation it can produce lands on disk with its own provenance', () => {
  // 第 1 个提交产出 write_groups, 这一条证明它真的落得了盘 —— 而且两个来源
  // 分得开: 同一个 true, 一个是他说的, 一个是我们推的.
  for (const input of [
    { citizenOrGreenCard: true },
    { citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: true },
    { citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: false, formAnswerPolicy: 'answer_yes' },
    { citizenOrGreenCard: false, studentVisa: true, workPermissionGranted: false, formAnswerPolicy: 'defer_to_user' },
    {
      citizenOrGreenCard: false, studentVisa: false, sponsorshipNeededFuture: 'unclear',
      formAnswerPolicy: 'answer_no', userWords: '我是陪读签证',
    },
  ]) {
    const home = makeHome('mrw-rec-funnel-');
    const { answers, answer_sources, write_groups } = workAuthAnswers(input);
    for (const group of write_groups) {
      const run = runCli(home, [
        '--json', JSON.stringify(group.answers),
        '--source', group.source, '--category', 'user_work_authorization',
      ]);
      assert.equal(run.code, 0, `${JSON.stringify(input)} / ${group.source}: ${run.stderr}`);
    }
    const profile = JSON.parse(readFileSync(join(home, 'profile.json'), 'utf8'));
    for (const [path, value] of Object.entries(answers)) {
      const key = path.split('.').pop();
      assert.equal(profile.work_authorization[key], value, `${JSON.stringify(input)}: ${path}`);
      assert.equal(
        sourceFor(home, path, value),
        answer_sources[path],
        `${JSON.stringify(input)}: ${path} lost the record of who said it`,
      );
    }
  }
});

test('record_profile_answers restores the profile byte-for-byte when validation fails after the write', () => {
  const home = makeHome('mrw-rec-rollback-');
  const profilePath = join(home, 'profile.json');
  const before = digest(profilePath);

  // The validator is an independent contract that can grow rules at any time,
  // so the rollback path is exercised through the injected seam rather than by
  // waiting for a rule that today's type check happens not to cover.
  //
  // The seam is called twice — once before the write and once after — and only
  // the second call may fail here. A validator that fails both times would exit
  // at the pre-check and this test would pass while proving nothing.
  let calls = 0;
  const code = recordMain(
    ['--json', JSON.stringify({ 'education.gpa': '3.9' }), '--source', 'user_answer', '--home', home],
    {
      validate: () => {
        calls += 1;
        if (calls === 1) return { ok: true, issues: [], warnings: [] };
        return { ok: false, issues: [{ severity: 'error', file: join(home, 'profile.json'), path: 'education.gpa', message: 'synthetic failure' }], warnings: [] };
      },
    },
  );

  assert.equal(calls, 2, 'the write must have happened before validation rejected it');
  assert.equal(code, 4);
  assert.equal(existsSync(join(home, 'profile.json.bak')), false, 'the rollback must not leave a backup behind');
  assert.equal(digest(profilePath), before, 'a failed validation must leave the profile exactly as it was');
  assert.equal(JSON.parse(readFileSync(profilePath, 'utf8')).education.gpa, '3.4');
});

test('record_profile_answers refuses to build on an already-invalid profile', () => {
  const home = makeHome('mrw-rec-preinvalid-', { ...VALID_PROFILE, work_authorization: { visa_status: '' } });
  const profilePath = join(home, 'profile.json');
  const before = digest(profilePath);

  const run = runCli(home, [
    '--json', JSON.stringify({ 'education.gpa': '3.9' }),
    '--source', 'user_answer',
  ]);

  assert.equal(run.code, 4);
  assert.equal(digest(profilePath), before);
  assert.match(run.stderr, /missing canonical key/);
});

test('record_profile_answers is idempotent: the same answer twice writes one provenance entry', () => {
  const home = makeHome('mrw-rec-idem-');
  const profilePath = join(home, 'profile.json');
  const args = [
    '--json', JSON.stringify({ 'legal_attestations.no_prohibited_possessor_status': true }),
    '--source', 'user_answer',
    '--category', 'user_legal_attestation',
  ];

  const first = runCli(home, args);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.json.changed.length, 1);
  assert.equal(first.json.provenance_written, 1);
  const afterFirst = digest(profilePath);
  const firstRecordedAt = readProvenance(home).entries['legal_attestations.no_prohibited_possessor_status'].recorded_at;

  const second = runCli(home, args);
  assert.equal(second.code, 0, second.stderr);
  assert.deepEqual(second.json.changed, []);
  assert.equal(second.json.provenance_written, 0);
  assert.deepEqual(second.json.skipped, [{ path: 'legal_attestations.no_prohibited_possessor_status', reason: 'unchanged' }]);
  assert.equal(digest(profilePath), afterFirst, 'a no-op run must not rewrite the profile');

  const provenance = readProvenance(home);
  assert.equal(provenance.entries['legal_attestations.no_prohibited_possessor_status'].recorded_at, firstRecordedAt);
  assert.deepEqual(
    Object.keys(provenance.entries).sort(),
    // the recorded answer plus the values that were already on disk, labelled once
    ['education.gpa', 'legal_attestations.no_prohibited_possessor_status', 'personal.address_city', 'personal.address_country', 'personal.address_state'],
  );
});

test('record_profile_answers --dry-run reports the change without making it', () => {
  const home = makeHome('mrw-rec-dry-');
  const profilePath = join(home, 'profile.json');
  const before = digest(profilePath);

  const run = runCli(home, [
    '--json', JSON.stringify({ 'demographics.gender': 'Prefer not to say' }),
    '--source', 'user_answer',
    '--dry-run',
  ]);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.json.dry_run, true);
  assert.equal(run.json.changed.length, 1);
  assert.equal(digest(profilePath), before);
  assert.equal(existsSync(join(home, 'answer_provenance.json')), false);
});

test('every provenance key is a path some question is allowed to write', () => {
  const home = makeHome('mrw-rec-keys-');
  const run = runCli(home, [
    '--json', JSON.stringify({
      'work_authorization.authorized_to_work_us': true,
      'work_authorization.requires_sponsorship_future': false,
      'demographics.race': 'Prefer not to say',
    }),
    '--source', 'user_answer',
  ]);
  assert.equal(run.code, 0, run.stderr);

  const writable = answerWritePaths();
  for (const key of Object.keys(readProvenance(home).entries)) {
    assert.ok(writable.has(key), `provenance recorded ${key}, which no question declares as writable`);
  }
});

test('answerWritePaths derives the whitelist from the question templates themselves', () => {
  const writable = answerWritePaths();
  // "What we ask" and "what we may write" cannot drift apart, because they are
  // the same list read twice.
  for (const [category, template] of Object.entries(QUESTION_TEMPLATES)) {
    for (const path of template.profile_paths) {
      assert.ok(writable.has(path), `${category} asks about ${path} but cannot write it`);
      assert.ok(writable.get(path).categories.includes(category));
    }
  }
  assert.equal(writable.get('work_authorization.authorized_to_work_us').value_type, 'boolean');
  assert.equal(writable.get('work_authorization.visa_status').value_type, 'string');
  assert.equal(writable.get('legal_attestations.conflicting_obligations').value_type, 'boolean');
  assert.equal(writable.get('education.gpa').value_type, 'string');
  // Nothing outside the question set is writable — notably identity fields the
  // user gave us once, on a resume, and never agreed to have rewritten.
  assert.equal(writable.has('personal.email'), false);
  assert.equal(writable.has('resume_path'), false);
});

test('record_profile_answers rejects an unknown provenance source rather than inventing one', () => {
  const home = makeHome('mrw-rec-source-');
  const before = digest(join(home, 'profile.json'));
  const run = runCli(home, [
    '--json', JSON.stringify({ 'education.gpa': '3.9' }),
    '--source', 'because_i_said_so',
  ]);
  assert.equal(run.code, 2);
  assert.equal(digest(join(home, 'profile.json')), before);
});

// --- argument handling, exercised in-process so the branches are measured ---

test('record_profile_answers rejects malformed invocations before touching anything', () => {
  const home = makeHome('mrw-rec-args-');
  const before = digest(join(home, 'profile.json'));
  const cases = [
    [[], 'no --json at all'],
    [['--json', '{oops', '--source', 'user_answer', '--home', home], 'unparseable JSON'],
    [['--json', '["education.gpa"]', '--source', 'user_answer', '--home', home], 'a JSON array'],
    [['--json', '{}', '--source', 'user_answer', '--home', home], 'an empty object'],
  ];
  for (const [argv, why] of cases) {
    assert.equal(main(argv), 2, `${why} should be an argument error`);
  }
  assert.equal(digest(join(home, 'profile.json')), before);

  assert.equal(
    main(['--json', '{"education.gpa":"3.9"}', '--source', 'user_answer', '--home', join(home, 'nope')]),
    2,
    'a missing profile.json is an argument error, not a crash',
  );
});

test('record_profile_answers refuses to turn a scalar into an object on the way to a leaf', () => {
  const home = makeHome('mrw-rec-scalar-', { ...VALID_PROFILE, education: 'B.S. Marketing' });
  const before = digest(join(home, 'profile.json'));
  assert.equal(main(['--json', '{"education.gpa":"3.9"}', '--source', 'user_answer', '--home', home]), 3);
  assert.equal(digest(join(home, 'profile.json')), before);
});

test('provenance labels pre-existing values legacy_unverified instead of claiming they were answered', () => {
  // The one real user's profile predates all of this. Its values keep working
  // untouched (ADR-4); the record simply refuses to imply anybody supplied them.
  const home = makeHome('mrw-rec-legacy-', {
    ...VALID_PROFILE,
    education: { gpa: '3.4' },
    standard_qa: { earliest_start_date: '2026-06-01' },
  });

  assert.equal(main(['--json', '{"demographics.gender":"Prefer not to say"}', '--source', 'user_answer', '--home', home]), 0);

  const entries = readProvenance(home).entries;
  assert.equal(entries['demographics.gender'].source, 'user_answer');
  assert.equal(entries['education.gpa'].source, 'legacy_unverified');
  assert.equal(entries['standard_qa.earliest_start_date'].source, 'legacy_unverified');
  // Paths with no value are not labelled: there is nothing to be unsure about.
  assert.equal('legal_attestations.no_prohibited_possessor_status' in entries, false);
  // Nor are empty containers — `{}` is a shape placeholder, not an answer.
  assert.equal('standard_qa.language_proficiency' in entries, false);
  assert.equal('standard_qa.custom_facts' in entries, false);

  // Idempotent: a second run neither relabels nor duplicates.
  const firstSeen = entries['education.gpa'].recorded_at;
  assert.equal(main(['--json', '{"demographics.race":"Prefer not to say"}', '--source', 'user_answer', '--home', home]), 0);
  assert.equal(readProvenance(home).entries['education.gpa'].recorded_at, firstSeen);
});

test('recordEntries refuses an invented provenance source', () => {
  const home = makeHome('mrw-prov-source-');
  assert.throws(
    () => recordEntries(home, [{ path: 'education.gpa', to: '3.9' }], { source: 'vibes' }),
    /unknown provenance source/,
  );
});
