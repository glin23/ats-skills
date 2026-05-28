#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyRoleType, roleTypesFromSearchIntent, roleTypeConflict } from '../shared/role_types.mjs';
import { renderAnswerTemplate } from '../shared/answer_templates.mjs';
import { graduationSelectValues, hoursPerWeekAnswer, monthYear } from '../shared/greenhouse_value_rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const tmpHome = mkdtempSync(path.join(tmpdir(), 'mrweirdo-role-guard-'));
const dbFile = path.join(tmpHome, 'jobs.db');

process.env.MRWEIRDO_HOME = tmpHome;
process.env.MRWEIRDO_DB_PATH = dbFile;
process.env.MRWEIRDO_REPO_ROOT = repoRoot;

writeFileSync(
  path.join(tmpHome, 'search_intent.json'),
  JSON.stringify({ search_intent: { role_type_targets: ['intern', 'part_time'] } }, null, 2)
);

function runScript(script, args = [], extraEnv = {}) {
  return execFileSync(process.execPath, [path.join(repoRoot, script), ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function mustFail(script, args, expectedReason, extraEnv = {}) {
  try {
    runScript(script, args, extraEnv);
  } catch (e) {
    const err = String(e.stderr || e.stdout || '');
    assert.match(err, new RegExp(expectedReason));
    return;
  }
  throw new Error(`${script} unexpectedly passed; wanted ${expectedReason}`);
}

try {
  assert.equal(classifyRoleType({ title: 'Associate Product Manager (APM)', employment_type: 'Full-time' }), 'other');
  assert.equal(classifyRoleType({ title: 'APM Intern', employment_type: 'Internship' }), 'intern');
  assert.equal(classifyRoleType({ title: 'Fellowship Operations Associate', employment_type: 'Full-time' }), 'other');
  assert.equal(classifyRoleType({ title: 'Summer 2026 Fellowship Program' }), 'other');
  assert.equal(classifyRoleType({ title: 'Summer 2026 Associate Product Manager' }), 'other');
  assert.equal(classifyRoleType({ title: 'Summer 2026 Internship - Marketing' }), 'intern');
  assert.equal(classifyRoleType({ title: 'Part-time Campus Ambassador' }), 'part_time');
  assert.equal(classifyRoleType({ title: 'New Graduate Product Analyst', employment_type: 'Full-time' }), 'new_grad_FT');

  // (a) Acorns-style: intern TITLE but FullTime employment_type. Title is the
  // strong signal so it stays roleType intern (still eligible), but the
  // permanent-looking employment_type with no temp signal raises a conflict
  // FLAG for a human glance — it is NOT reclassified/blocked.
  {
    const acorns = { title: 'Growth Product Management Intern', employment_type: 'FullTime' };
    assert.equal(classifyRoleType(acorns), 'intern');
    const c = roleTypeConflict(acorns);
    assert.equal(c.roleType, 'intern');
    assert.equal(c.conflict, true);
    assert.match(c.reason, /permanent employment_type/);
  }
  // (b) Pure full-time role (no intern title) → not intern, no conflict.
  {
    const ft = { title: 'Business Operations Associate', employment_type: 'FullTime' };
    assert.equal(classifyRoleType(ft), 'other');
    const c = roleTypeConflict(ft);
    assert.notEqual(c.roleType, 'intern');
    assert.equal(c.conflict, false);
  }
  // (c) Genuine internship: intern title + intern employment_type → intern, NO conflict.
  {
    const pure = { title: 'Growth Intern', employment_type: 'Intern' };
    assert.equal(classifyRoleType(pure), 'intern');
    const c = roleTypeConflict(pure);
    assert.equal(c.roleType, 'intern');
    assert.equal(c.conflict, false);
  }
  // (c2) Full-time-HOURS internship that names the schedule: title carries the
  // intern signal so no conflict even though "full-time" appears.
  {
    const ftHours = { title: 'Growth Marketing Intern', employment_type: 'Internship', schedule: 'Full-time' };
    assert.equal(classifyRoleType(ftHours), 'intern');
    assert.equal(roleTypeConflict(ftHours).conflict, false);
  }
  // (d) Part-time → part_time, no conflict.
  {
    const pt = { title: 'Part-time Campus Ambassador', employment_type: 'Part-time' };
    assert.equal(classifyRoleType(pt), 'part_time');
    assert.equal(roleTypeConflict(pt).conflict, false);
  }
  assert.deepEqual(roleTypesFromSearchIntent({ seniority: 'intern_or_part_time' }, ''), ['intern', 'part_time']);
  assert.deepEqual(roleTypesFromSearchIntent({ seniority: 'both' }, ''), ['intern', 'part_time']);
  assert.equal(monthYear('2027-05'), 'May 2027');
  assert.deepEqual(graduationSelectValues('May 2027'), ['May 2027', 'June 2027', 'December 2027', '2027']);
  assert.deepEqual(graduationSelectValues('December 2027'), ['December 2027', 'June 2027', '2027']);
  assert.equal(hoursPerWeekAnswer({ searchIntent: { search_intent: { role_type_targets: ['part_time'] } } }), '20');
  assert.equal(hoursPerWeekAnswer({ profile: { standard_qa: { hours_per_week: '25' } } }), '25');
  assert.equal(
    renderAnswerTemplate('I study {{MAJOR}} at {{SCHOOL}} for {{COMPANY_PRETTY}}.', {
      profile: { education: { major: 'Design', school: 'State University' } },
      companyPretty: 'Example Co',
    }),
    'I study Design at State University for Example Co.'
  );

  const { initDb } = await import('../shared/local_db.mjs');
  initDb();
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbFile);
  const insert = db.prepare(`
    INSERT INTO jobs(company, title, apply_url, status, fit_score, role_type_match, ats_platform,
                     auto_apply_eligible, apply_quota_limit)
    VALUES (:company, :title, :url, :status, :fit, :role, :ats, :eligible, :quota)
  `);
  insert.run({
    company: 'Good Co',
    title: 'Marketing Intern',
    url: 'https://job-boards.greenhouse.io/good/jobs/1',
    status: '🤖 AI sourced',
    fit: 7,
    role: 'intern',
    ats: 'greenhouse',
    eligible: 1,
    quota: null,
  });
  insert.run({
    company: 'Bad Co',
    title: 'Associate Product Manager (APM)',
    url: 'https://job-boards.greenhouse.io/bad/jobs/2',
    status: '🤖 AI sourced',
    fit: 7,
    role: 'intern',
    ats: 'greenhouse',
    eligible: 1,
    quota: null,
  });
  insert.run({
    company: 'FT Co',
    title: 'New Graduate Product Analyst',
    url: 'https://job-boards.greenhouse.io/ft/jobs/3',
    status: '🤖 AI sourced',
    fit: 7,
    role: 'new_grad_FT',
    ats: 'greenhouse',
    eligible: 1,
    quota: null,
  });
  insert.run({
    company: 'Skipped Co',
    title: 'Skipped Marketing Intern',
    url: 'https://job-boards.greenhouse.io/skipped/jobs/4',
    status: '⚠️ 跳过未投',
    fit: 7,
    role: 'intern',
    ats: 'greenhouse',
    eligible: 1,
    quota: null,
  });
  db.prepare("UPDATE jobs SET updated_at = '2026-01-01 00:00:00' WHERE id = 4").run();

  assert.match(runScript('shared/validate_auto_row.mjs', ['--row-id', '1']), /"ok":true/);
  mustFail('shared/validate_auto_row.mjs', ['--row-id', '2'], 'role_type_recheck_failed');
  mustFail('shared/validate_auto_row.mjs', ['--row-id', '3'], 'role_type_not_allowed');
  assert.match(
    runScript('shared/validate_auto_row.mjs', ['--row-id', '3'], { MRWEIRDO_ROLE_TYPE_TARGETS: 'new_grad_FT' }),
    /"ok":true/
  );
  mustFail('shared/validate_auto_row.mjs', ['--row-id', '1'], 'role_type_not_allowed', {
    MRWEIRDO_ROLE_TYPE_TARGETS: 'new_grad_FT',
  });
  const fullTimeQueue = runScript('shared/auto_apply_queue.mjs', ['--summary'], {
    MRWEIRDO_ROLE_TYPE_TARGETS: 'new_grad_FT',
    MRWEIRDO_MAX_AUTO_APPLY: '10',
  });
  assert.match(fullTimeQueue, /New Graduate Product Analyst/);
  assert.doesNotMatch(fullTimeQueue, /Marketing Intern/);
  assert.doesNotMatch(fullTimeQueue, /Associate Product Manager/);
  runScript('shared/recompute_auto_apply_eligibility.mjs', ['--apply']);
  assert.equal(db.prepare('SELECT auto_apply_eligible FROM jobs WHERE id = 2').get().auto_apply_eligible, 0);
  assert.equal(db.prepare('SELECT auto_apply_eligible FROM jobs WHERE id = 3').get().auto_apply_eligible, 0);
  assert.equal(db.prepare('SELECT auto_apply_eligible FROM jobs WHERE id = 4').get().auto_apply_eligible, 0);
  assert.equal(db.prepare('SELECT updated_at FROM jobs WHERE id = 4').get().updated_at, '2026-01-01 00:00:00');

  insert.run({
    company: 'Good Co',
    title: 'Marketing Internship',
    url: 'https://example.com/already-submitted',
    status: '✅ 已投',
    fit: 7,
    role: 'intern',
    ats: 'greenhouse',
    eligible: 0,
    quota: null,
  });
  mustFail('shared/validate_auto_row.mjs', ['--row-id', '1'], 'duplicate_same_company_title_already_submitted');
  runScript('shared/recompute_auto_apply_eligibility.mjs', ['--apply']);
  assert.equal(db.prepare('SELECT auto_apply_eligible FROM jobs WHERE id = 1').get().auto_apply_eligible, 0);

  insert.run({
    company: 'Recorder Co',
    title: 'Operations Intern',
    url: 'https://job-boards.greenhouse.io/recorder/jobs/6',
    status: '🤖 AI sourced',
    fit: 7,
    role: 'intern',
    ats: 'greenhouse',
    eligible: 1,
    quota: null,
  });
  const recorderId = db.prepare("SELECT id FROM jobs WHERE company = 'Recorder Co'").get().id;
  const submittedLog = path.join(tmpHome, 'submitted.log');
  writeFileSync(submittedLog, 'human log line\n{"outcome":"submitted","post_url":"https://example.com/confirmation"}\n');
  runScript('shared/record_apply_outcome.mjs', ['--row-id', String(recorderId), '--result-file', submittedLog]);
  const submittedRow = db.prepare('SELECT status, confirmation_url, skip_reason, auto_apply_eligible FROM jobs WHERE id = ?').get(recorderId);
  assert.equal(submittedRow.status, '✅ 已投');
  assert.equal(submittedRow.confirmation_url, 'https://example.com/confirmation');
  assert.equal(submittedRow.skip_reason, null);
  assert.equal(submittedRow.auto_apply_eligible, 0);

  insert.run({
    company: 'Skip Recorder Co',
    title: 'Marketing Intern',
    url: 'https://job-boards.greenhouse.io/skiprecorder/jobs/7',
    status: '🤖 AI sourced',
    fit: 7,
    role: 'intern',
    ats: 'greenhouse',
    eligible: 1,
    quota: null,
  });
  const skipRecorderId = db.prepare("SELECT id FROM jobs WHERE company = 'Skip Recorder Co'").get().id;
  const skipLog = path.join(tmpHome, 'skip.log');
  writeFileSync(skipLog, '{"outcome":"skip","reason":"profile_specific_answer_required"}\n');
  runScript('shared/record_apply_outcome.mjs', ['--row-id', String(skipRecorderId), '--result-file', skipLog]);
  const skipRow = db.prepare('SELECT status, skip_reason, auto_apply_eligible FROM jobs WHERE id = ?').get(skipRecorderId);
  assert.equal(skipRow.status, '⚠️ 跳过未投');
  assert.equal(skipRow.skip_reason, 'profile_specific_answer_required');
  assert.equal(skipRow.auto_apply_eligible, 0);

  insert.run({
    company: 'Essay Co',
    title: 'Content Intern',
    url: 'https://job-boards.greenhouse.io/essay/jobs/9',
    status: '🤖 AI sourced',
    fit: 7,
    role: 'intern',
    ats: 'greenhouse',
    eligible: 1,
    quota: null,
  });
  const essayRecorderId = db.prepare("SELECT id FROM jobs WHERE company = 'Essay Co'").get().id;
  const essayLog = path.join(tmpHome, 'essay.log');
  writeFileSync(essayLog, '{"outcome":"essay_pending","pending":[{"question":"Why us?","selector":"textarea"}]}\n');
  const essayRecord = runScript('shared/record_apply_outcome.mjs', ['--row-id', String(essayRecorderId), '--result-file', essayLog]);
  assert.match(essayRecord, /"action":"essay_pending"/);
  const essayRow = db.prepare('SELECT status, skip_reason, auto_apply_eligible FROM jobs WHERE id = ?').get(essayRecorderId);
  assert.equal(essayRow.status, '⚠️ 跳过未投');
  assert.equal(essayRow.skip_reason, 'essay_pending_main_agent_required');
  assert.equal(essayRow.auto_apply_eligible, 0);

  insert.run({
    company: 'Batch Co',
    title: 'Operations Intern',
    url: 'https://job-boards.greenhouse.io/batch/jobs/8',
    status: '🤖 AI sourced',
    fit: 7,
    role: 'intern',
    ats: 'greenhouse',
    eligible: 1,
    quota: null,
  });
  insert.run({
    company: 'Low Fit Co',
    title: 'Campus Marketing Intern',
    url: 'https://job-boards.greenhouse.io/lowfit/jobs/10',
    status: '🤖 AI sourced',
    fit: 4,
    role: 'intern',
    ats: 'greenhouse',
    eligible: 0,
    quota: null,
  });
  const batchDryRun = runScript('shared/apply_batch.mjs', ['--dry-run', '--max', '1', '--role-targets', 'intern,part_time']);
  assert.match(batchDryRun, /dry_run_validated/);
  const diagnostics = runScript('shared/queue_diagnostics.mjs', ['--json'], {
    MRWEIRDO_ROLE_TYPE_TARGETS: 'intern,part_time',
    MRWEIRDO_MAX_AUTO_APPLY: '10',
  });
  assert.match(diagnostics, /"eligible"/);
  assert.match(diagnostics, /"fit_below_threshold"/);
  assert.match(diagnostics, /"near_misses"/);

  const reviewReportPath = path.join(tmpHome, 'queue-review.html');
  runScript('shared/queue_review_report.mjs', ['--output', reviewReportPath], {
    MRWEIRDO_ROLE_TYPE_TARGETS: 'intern,part_time',
  });
  assert.equal(existsSync(reviewReportPath), true);
  const reviewReport = readFileSync(reviewReportPath, 'utf8');
  assert.match(reviewReport, /Ready To Auto-Apply/);
  assert.match(reviewReport, /Fit 4 Candidates/);
  assert.match(reviewReport, /Marketing Intern/);
  assert.doesNotMatch(reviewReport, /Associate Product Manager/);
  assert.doesNotMatch(reviewReport, /New Graduate Product Analyst/);

  const rescoreJson = runScript('shared/rescore_review.mjs', ['--json'], {
    MRWEIRDO_ROLE_TYPE_TARGETS: 'intern,part_time',
  });
  assert.match(rescoreJson, /Campus Marketing Intern/);
  assert.doesNotMatch(rescoreJson, /Associate Product Manager/);
  assert.doesNotMatch(rescoreJson, /New Graduate Product Analyst/);
  const lowFitId = db.prepare("SELECT id FROM jobs WHERE company = 'Low Fit Co'").get().id;
  const rescoreDryRun = runScript('shared/rescore_review.mjs', ['--promote', String(lowFitId)], {
    MRWEIRDO_ROLE_TYPE_TARGETS: 'intern,part_time',
  });
  assert.match(rescoreDryRun, /"dry_run": true/);
  runScript('shared/rescore_review.mjs', ['--promote', String(lowFitId), '--apply'], {
    MRWEIRDO_ROLE_TYPE_TARGETS: 'intern,part_time',
  });
  const promoted = db.prepare('SELECT fit_score, auto_apply_eligible FROM jobs WHERE id = ?').get(lowFitId);
  assert.equal(promoted.fit_score, 5);
  assert.equal(promoted.auto_apply_eligible, 1);

  const capacityPlan = runScript('shared/apply_capacity_plan.mjs', ['--json', '--target', '10'], {
    MRWEIRDO_ROLE_TYPE_TARGETS: 'intern,part_time',
  });
  assert.match(capacityPlan, /"target_applications": 10/);
  assert.match(capacityPlan, /"ready_now"/);
  assert.match(capacityPlan, /"human_rescore_fit_one_below"/);

  const queue = runScript('shared/auto_apply_queue.mjs', ['--summary'], {
    MRWEIRDO_ROLE_TYPE_TARGETS: 'intern,part_time',
    MRWEIRDO_MAX_AUTO_APPLY: '10',
  });
  assert.doesNotMatch(queue, /"Marketing Intern"/);
  assert.doesNotMatch(queue, /Associate Product Manager/);
  assert.doesNotMatch(queue, /New Graduate Product Analyst/);

  const discoverPlan = runScript('shared/discover_candidates.mjs', ['--plan'], {
    MRWEIRDO_ROLE_TYPE_TARGETS: 'intern,part_time',
  });
  assert.match(discoverPlan, /"Intern"/);
  assert.match(discoverPlan, /"Part-time"/);
  assert.doesNotMatch(discoverPlan, /New Grad/);
  assert.doesNotMatch(discoverPlan, /Graduate",/);

  const statusJson = runScript('shared/supervisor_status.mjs', ['--json', '--max', '1', '--target', '10'], {
    MRWEIRDO_ROLE_TYPE_TARGETS: 'intern,part_time',
  });
  assert.match(statusJson, /"role_targets"/);
  assert.match(statusJson, /"capacity"/);
  assert.match(statusJson, /apply_supervisor/);

  const derivedStatusJson = runScript('shared/supervisor_status.mjs', ['--json', '--max', '1', '--target', '10'], {
    MRWEIRDO_ROLE_TYPE_TARGETS: '',
  });
  assert.match(derivedStatusJson, /"intern"/);
  assert.match(derivedStatusJson, /"part_time"/);

  const derivedSupervisorDryRun = runScript(
    'shared/apply_supervisor.mjs',
    ['--dry-run', '--max', '1', '--pace-min-ms', '0', '--pace-max-ms', '0'],
    { MRWEIRDO_ROLE_TYPE_TARGETS: '' }
  );
  assert.match(derivedSupervisorDryRun, /"allowed_role_types":\["intern","part_time"\]/);
  assert.match(derivedSupervisorDryRun, /dry_run_validated/);

  console.log('role guard smoke ok');
} finally {
  rmSync(tmpHome, { recursive: true, force: true });
}
