import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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
    env: {
      ...process.env,
      MRWEIRDO_HOME: home,
      MRWEIRDO_DB_PATH: join(home, 'jobs.db'),
    },
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
    env: {
      ...process.env,
      MRWEIRDO_HOME: home,
      MRWEIRDO_DB_PATH: join(home, 'jobs.db'),
    },
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
      address_street: '60 Hope Ave, Apt #401',
      address_city: 'Waltham',
      address_state: 'MA',
      address_zip: '02453',
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
    env: {
      ...process.env,
      MRWEIRDO_HOME: home,
      MRWEIRDO_DB_PATH: join(home, 'jobs.db'),
    },
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(readFileSync(jsonPath, 'utf8'));
  assert.deepEqual(report.user_questions, []);
  assert.ok(report.agent_actions.some((a) => a.category === 'agent_profile_backed'));
  assert.ok(report.system_blockers.some((a) => a.category === 'system_profile_declined_location'));
  assert.ok(report.system_blockers.some((a) => a.category === 'system_external_form_auto_required'));
});
