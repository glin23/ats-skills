import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { QUESTION_GROUPS, condenseMissingQuestions, validateQuestionGroups } from '../shared/missing_field_questions.mjs';
import { onboardTestEnv } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_QUESTION_TEMPLATES = {
  user_full_address: {
    priority: 1,
    profile_paths: ['personal.address_street', 'personal.address_city', 'personal.address_state', 'personal.address_zip', 'personal.address_country'],
    question: 'full address',
    answer_type: 'short_text',
  },
  user_earliest_start_date: {
    priority: 2,
    profile_paths: ['standard_qa.earliest_start_date'],
    question: 'earliest start date',
    answer_type: 'short_text',
  },
  user_high_school_location: {
    priority: 3,
    profile_paths: ['standard_qa.high_school_location'],
    question: 'high school location',
    answer_type: 'short_text',
  },
  user_government_relative_compliance: {
    priority: 4,
    profile_paths: ['legal_attestations.relatives_in_federal_government_or_contractors'],
    question: 'government relative compliance',
    answer_type: 'yes_no_plus_detail',
  },
  user_language_or_skill_level: {
    priority: 5,
    profile_paths: ['standard_qa.language_proficiency'],
    question: 'language or skill level',
    answer_type: 'short_text',
  },
  user_compliance_relationship_or_restriction: {
    priority: 6,
    profile_paths: ['legal_attestations.conflicting_obligations', 'standard_qa.company_relationships'],
    question: 'compliance relationship or restriction',
    answer_type: 'yes_no_plus_detail',
  },
  user_gpa: {
    priority: 7,
    profile_paths: ['education.gpa'],
    question: 'gpa',
    answer_type: 'short_text',
  },
  user_logistics_fact: {
    priority: 8,
    profile_paths: ['standard_qa.location_logistics'],
    question: 'logistics fact',
    answer_type: 'short_text',
  },
  user_work_location_commitment: {
    priority: 9,
    profile_paths: ['standard_qa.work_location_commitments'],
    question: 'work location commitment',
    answer_type: 'short_text',
  },
  user_external_form_completion: {
    priority: 10,
    profile_paths: ['standard_qa.external_form_confirmations'],
    question: 'external form completion',
    answer_type: 'yes_no',
  },
  unknown_user_fact: {
    priority: 20,
    profile_paths: ['standard_qa.custom_facts'],
    question: 'unknown user fact',
    answer_type: 'short_text',
  },
};

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

test('apply_gap_report separates factual user gaps from agent-fillable fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'mrw-gap-'));
  const home = join(root, 'home');
  const resultDir = join(root, 'run');
  const profilePath = join(home, 'profile.json');
  const resultPath = join(resultDir, 'apply-result-101.jsonl');
  const summaryPath = join(resultDir, 'summary.json');
  const jsonPath = join(resultDir, 'gap.json');
  const mdPath = join(resultDir, 'gap.md');
  const jsonFromDirPath = join(resultDir, 'gap-from-dir.json');
  const mdFromDirPath = join(resultDir, 'gap-from-dir.md');

  mkdirSync(home, { recursive: true });
  mkdirSync(resultDir, { recursive: true });

  writeFileSync(profilePath, JSON.stringify({
    personal: { address_city: 'Babson Park', address_state: 'MA', address_country: 'United States' },
    education: { gpa: '3.2' },
  }));
  writeFileSync(resultPath, `${JSON.stringify({
    outcome: 'skip',
    reason: 'profile_full_address_required',
    job_id: 101,
    remaining: [
      { label: 'What is your primary mailing address?', type: 'textarea', required: true },
      { label: 'The interview may be recorded in audio, video, and/or transcript.', type: 'radio', required: true },
      { label: 'What is your GPA?', type: 'text', required: true },
      { label: 'Attach', type: 'file', required: true },
      { label: 'Gender', type: 'select', required: true },
      { label: 'Are you Hispanic/Latino?', type: 'select', required: true },
      { label: 'I confirm the information provided in this application, including my resume, is true and correct.', type: 'checkbox', required: true },
      { label: 'What is your expected graduation month and year?', type: 'text', required: true },
      { label: 'Which work style(s) are you open to?', type: 'select', required: true },
    ],
  })}\n`);
  writeFileSync(summaryPath, JSON.stringify({ rows: [{ row_id: 101, result_file: resultPath }] }));

  const run = spawnSync(process.execPath, [
    'shared/apply_gap_report.mjs',
    '--summary', summaryPath,
    '--json-output', jsonPath,
    '--md-output', mdPath,
  ], {
    cwd: ROOT,
    env: onboardTestEnv(home),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(readFileSync(jsonPath, 'utf8'));
  assert.deepEqual(report.user_questions.map((q) => q.category), ['user_full_address']);
  assert.ok(report.agent_actions.some((a) => a.category === 'agent_attestation'));
  assert.ok(report.agent_actions.some((a) => a.category === 'agent_profile_backed'));
  assert.equal(report.retry_candidates.length, 1);
  assert.equal(report.retry_candidates[0].row_id, 101);

  const runFromDir = spawnSync(process.execPath, [
    'shared/apply_gap_report.mjs',
    '--result-dir', resultDir,
    '--json-output', jsonFromDirPath,
    '--md-output', mdFromDirPath,
  ], {
    cwd: ROOT,
    env: onboardTestEnv(home),
    encoding: 'utf8',
  });

  assert.equal(runFromDir.status, 0, runFromDir.stderr);
  const reportFromDir = JSON.parse(readFileSync(jsonFromDirPath, 'utf8'));
  assert.deepEqual(reportFromDir.user_questions.map((q) => q.category), ['user_full_address']);
});

test('apply_gap_report does not re-ask facts already stored in profile', () => {
  const root = mkdtempSync(join(tmpdir(), 'mrw-gap-known-'));
  const home = join(root, 'home');
  const resultDir = join(root, 'run');
  const profilePath = join(home, 'profile.json');
  const resultPath = join(resultDir, 'apply-result-202.jsonl');
  const summaryPath = join(resultDir, 'summary.json');
  const jsonPath = join(resultDir, 'gap.json');
  const mdPath = join(resultDir, 'gap.md');

  mkdirSync(home, { recursive: true });
  mkdirSync(resultDir, { recursive: true });

  writeFileSync(profilePath, JSON.stringify({
    personal: {
      address_street: '123 Example St',
      address_city: 'Example City',
      address_state: 'CA',
      address_zip: '00000',
      address_country: 'United States',
    },
    education: { gpa: '3.2' },
    legal_attestations: {
      conflicting_obligations: false,
      relatives_in_federal_government_or_contractors: false,
    },
    standard_qa: {
      earliest_start_date: '2026-06-08',
      language_proficiency: { Spanish: 'Beginner' },
      company_relationships: {
        alarm_com_dealer_partner_supplier_last_year: false,
        pebl_employee_or_affiliate_partner_client_relationship: false,
      },
      work_location_commitments: {
        'Bay Area': true,
        'San Francisco': true,
        Singapore: false,
      },
      external_form_confirmations: {
        manual_external_forms: false,
        auto_only: true,
      },
    },
  }));
  writeFileSync(resultPath, `${JSON.stringify({
    outcome: 'skip',
    reason: 'incomplete_form',
    job_id: 202,
    remaining: [
      { label: 'What is your full permanent address (Street, City, State, Zip)?' },
      { label: 'What is your earliest start date for this position?' },
      { label: 'What is your proficiency level in Spanish? (Written and verbal communication)' },
      { label: 'Are you currently under a non-compete agreement?' },
      { label: 'Do you have any relatives that are currently employed by the Federal Government?' },
      { label: 'This role is a hybrid role based in the Bay Area - San Francisco. Are you comfortable with being in office?' },
      { label: 'Do you have confirmed plans to be in Singapore for the duration of this internship?' },
      { label: 'Did you successfully complete the form below?' },
    ],
  })}\n`);
  writeFileSync(summaryPath, JSON.stringify({ rows: [{ row_id: 202, result_file: resultPath }] }));

  const run = spawnSync(process.execPath, [
    'shared/apply_gap_report.mjs',
    '--summary', summaryPath,
    '--json-output', jsonPath,
    '--md-output', mdPath,
  ], {
    cwd: ROOT,
    env: onboardTestEnv(home),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(readFileSync(jsonPath, 'utf8'));
  assert.deepEqual(report.user_questions, []);
  assert.ok(report.agent_actions.some((a) => a.category === 'agent_profile_backed'));
  assert.ok(report.system_blockers.some((a) => a.category === 'system_profile_declined_location'));
  assert.ok(report.system_blockers.some((a) => a.category === 'system_external_form_auto_required'));
});

test('apply_gap_report ranks missing fields by distinct row ids', () => {
  const root = mkdtempSync(join(tmpdir(), 'mrw-gap-ranking-'));
  const home = join(root, 'home');
  const resultDir = join(root, 'run');
  const profilePath = join(home, 'profile.json');
  const resultPathA = join(resultDir, 'apply-result-301.jsonl');
  const resultPathB = join(resultDir, 'apply-result-302.jsonl');
  const summaryPath = join(resultDir, 'summary.json');
  const jsonPath = join(resultDir, 'gap.json');
  const mdPath = join(resultDir, 'gap.md');

  mkdirSync(home, { recursive: true });
  mkdirSync(resultDir, { recursive: true });

  writeFileSync(profilePath, JSON.stringify({}));
  writeFileSync(resultPathA, `${JSON.stringify({
    outcome: 'skip',
    reason: 'incomplete_form',
    job_id: 301,
    company: 'Alpha Co',
    remaining: [
      { label: 'What is your earliest start date for this position?' },
      { label: 'Earliest start date' },
      { label: 'What is your GPA?' },
      { label: 'I confirm the information provided in this application is true and correct.' },
    ],
  })}\n`);
  writeFileSync(resultPathB, `${JSON.stringify({
    outcome: 'skip',
    reason: 'incomplete_form',
    job_id: 302,
    company: 'Beta Co',
    remaining: [
      { label: 'What is your earliest start date for this position?' },
    ],
  })}\n`);
  writeFileSync(summaryPath, JSON.stringify({
    rows: [
      { row_id: 301, result_file: resultPathA },
      { row_id: 302, result_file: resultPathB },
    ],
  }));

  const run = spawnSync(process.execPath, [
    'shared/apply_gap_report.mjs',
    '--summary', summaryPath,
    '--json-output', jsonPath,
    '--md-output', mdPath,
  ], {
    cwd: ROOT,
    env: onboardTestEnv(home),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(readFileSync(jsonPath, 'utf8'));
  assert.deepEqual(report.missing_field_ranking, [
    {
      category: 'user_earliest_start_date',
      question: '你最早可以开始实习/part-time 的日期是什么？请给一个具体日期或月份，例如 2026-05-15 / May 2026。',
      profile_paths: ['standard_qa.earliest_start_date'],
      unblocks_n_jobs: 2,
    },
    {
      category: 'user_gpa',
      question: '你的本科 cumulative GPA 是多少？如果不想自动填写 GPA，也可以说“不填 GPA”。',
      profile_paths: ['education.gpa'],
      unblocks_n_jobs: 1,
    },
  ]);
  assert.equal(report.grouped_counts.user_earliest_start_date, 3);
  assert.ok(!report.missing_field_ranking.some((item) => item.category === 'agent_attestation'));
});

test('question group profile_paths must match covered category profile paths', () => {
  assert.doesNotThrow(() => validateQuestionGroups(QUESTION_GROUPS, TEST_QUESTION_TEMPLATES));
  const invalidGroups = [
    {
      ...QUESTION_GROUPS[0],
      profile_paths: ['standard_qa.wrong_path'],
    },
  ];
  assert.throws(
    () => validateQuestionGroups(invalidGroups, TEST_QUESTION_TEMPLATES),
    /profile_paths must match/,
  );
});

test('condensed missing questions cover every present user-fillable category', () => {
  const categories = Object.keys(TEST_QUESTION_TEMPLATES);
  for (let mask = 1; mask < (1 << categories.length); mask += 1) {
    const present = categories.filter((_, idx) => mask & (1 << idx));
    const entries = present.map((category, idx) => ({
      category,
      row_id: 1000 + idx,
    }));
    const questions = condenseMissingQuestions(entries, TEST_QUESTION_TEMPLATES);
    const covered = sorted(questions.flatMap((question) => question.covers_categories));
    assert.deepEqual(covered, sorted(present), `coverage mismatch for ${present.join(', ')}`);
  }
});

test('apply_gap_report condenses ABCDEFG categories without hard-bundling availability and education', () => {
  const root = mkdtempSync(join(tmpdir(), 'mrw-gap-condensed-'));
  const home = join(root, 'home');
  const resultDir = join(root, 'run');
  const profilePath = join(home, 'profile.json');
  const summaryPath = join(resultDir, 'summary.json');
  const jsonPath = join(resultDir, 'gap.json');
  const mdPath = join(resultDir, 'gap.md');

  mkdirSync(home, { recursive: true });
  mkdirSync(resultDir, { recursive: true });
  writeFileSync(profilePath, JSON.stringify({}));

  const rows = [
    [101, [
      { label: 'What is your primary mailing address?' },
      { label: 'What is your earliest start date for this position?' },
    ]],
    [102, [
      { label: 'What is your full permanent address (Street, City, State, Zip)?' },
      { label: 'This role is hybrid based in New York. Are you comfortable working onsite?' },
    ]],
    [103, [
      { label: 'This role is hybrid based in New York. Are you comfortable working onsite?' },
      { label: 'What is your proficiency level in Spanish?' },
    ]],
    [104, [
      { label: 'This role is hybrid based in New York. Are you comfortable working onsite?' },
      { label: "Do you have reliable transportation or a driver's license?" },
    ]],
    [105, [
      { label: 'What is your earliest start date for this position?' },
      { label: 'What is your GPA?' },
    ]],
    [106, [
      { label: 'What is your GPA?' },
      { label: 'What high school did you attend? Please include city/state.' },
    ]],
    [107, [
      { label: 'What is your proficiency level in Spanish?' },
    ]],
  ];

  const summaryRows = [];
  for (const [rowId, remaining] of rows) {
    const resultPath = join(resultDir, `apply-result-${rowId}.jsonl`);
    writeFileSync(resultPath, `${JSON.stringify({
      outcome: 'skip',
      reason: 'incomplete_form',
      job_id: rowId,
      remaining,
    })}\n`);
    summaryRows.push({ row_id: rowId, result_file: resultPath });
  }
  writeFileSync(summaryPath, JSON.stringify({ rows: summaryRows }));

  const run = spawnSync(process.execPath, [
    'shared/apply_gap_report.mjs',
    '--summary', summaryPath,
    '--json-output', jsonPath,
    '--md-output', mdPath,
  ], {
    cwd: ROOT,
    env: onboardTestEnv(home),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const locationGroup = report.condensed_missing_questions.find((item) => item.group_id === 'location_and_logistics');
  assert.deepEqual(locationGroup.covers_categories, [
    'user_full_address',
    'user_work_location_commitment',
    'user_logistics_fact',
  ]);
  assert.equal(locationGroup.unblocks_n_jobs, 4);

  const singletonCategories = sorted(report.singleton_missing_categories);
  assert.deepEqual(singletonCategories, sorted([
    'user_earliest_start_date',
    'user_gpa',
    'user_high_school_location',
    'user_language_or_skill_level',
  ]));
  assert.ok(!report.condensed_missing_questions.some((item) => item.group_id === 'availability_and_education'));
  assert.equal(report.condensed_missing_questions.find((item) => item.group_id === 'user_earliest_start_date').unblocks_n_jobs, 2);
  assert.equal(report.condensed_missing_questions.find((item) => item.group_id === 'user_gpa').unblocks_n_jobs, 2);
  assert.equal(report.condensed_missing_questions.find((item) => item.group_id === 'user_language_or_skill_level').unblocks_n_jobs, 2);
});
