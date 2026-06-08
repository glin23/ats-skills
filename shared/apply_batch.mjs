#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  createWriteStream,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atsHome } from './paths.mjs';

const repoRoot = process.env.MRWEIRDO_REPO_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const home = atsHome();
const tmpDir = '/tmp/mrweirdo-onboard';

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function hasArg(name) {
  return process.argv.includes(name);
}

const maxRows = Math.max(1, Number(argValue('--max') || process.env.MRWEIRDO_MAX_AUTO_APPLY || 3));
const roleTargets = argValue('--role-targets') || process.env.MRWEIRDO_ROLE_TYPE_TARGETS || '';
const dryRun = hasArg('--dry-run');
const paceMinMs = Math.max(0, Number(argValue('--pace-min-ms') || process.env.MRWEIRDO_APPLY_PACE_MIN_MS || 30000));
const paceMaxMs = Math.max(paceMinMs, Number(argValue('--pace-max-ms') || process.env.MRWEIRDO_APPLY_PACE_MAX_MS || 90000));

const env = {
  ...process.env,
  MRWEIRDO_MAX_AUTO_APPLY: String(maxRows),
  ...(roleTargets ? { MRWEIRDO_ROLE_TYPE_TARGETS: roleTargets } : {}),
};

function runNode(args, opts = {}) {
  const r = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    ...opts,
  });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function fail(label, result) {
  if (result?.stdout) process.stdout.write(result.stdout);
  if (result?.stderr) process.stderr.write(result.stderr);
  console.error(`[apply-batch] ${label} failed`);
  process.exit(1);
}

function parseJsonLines(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // Pretty-printed JSON spans multiple lines; parseLastJson handles it.
    }
  }
  return rows;
}

function parseLastJson(text) {
  const rows = parseJsonLines(text);
  if (rows.length) return rows[rows.length - 1];
  try {
    return JSON.parse(String(text || '').trim());
  } catch {
    return null;
  }
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs() {
  if (paceMaxMs <= paceMinMs) return paceMinMs;
  return Math.floor(paceMinMs + Math.random() * (paceMaxMs - paceMinMs + 1));
}

function runTee(args, outPath) {
  return new Promise((resolve) => {
    const out = createWriteStream(outPath, { flags: 'w' });
    const child = spawn(process.execPath, args, { cwd: repoRoot, env });
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      out.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      out.write(chunk);
    });
    child.on('close', (code) => {
      out.end();
      resolve(code ?? 1);
    });
  });
}

function driverFor(row) {
  if (row.ats_platform === 'greenhouse') return 'shared/greenhouse_apply_driver.mjs';
  if (row.ats_platform === 'ashby') return 'shared/ashby_apply_driver.mjs';
  if (row.ats_platform === 'lever') return 'shared/lever_apply_driver.mjs';
  throw new Error(`unsupported platform: ${row.ats_platform}`);
}

function acquireBatchLock() {
  const locksDir = join(home, 'locks');
  const lockPath = join(locksDir, 'apply_batch.lock');
  mkdirSync(locksDir, { recursive: true });

  const payload = `${JSON.stringify({
    pid: process.pid,
    started_at: new Date().toISOString(),
    max_rows: maxRows,
    role_targets: roleTargets || '(from search_intent)',
  })}\n`;

  let fd;
  try {
    fd = openSync(lockPath, 'wx');
    writeFileSync(fd, payload);
  } catch (e) {
    let existing = '';
    try {
      existing = readFileSync(lockPath, 'utf8').trim();
    } catch {
      existing = '(unable to read existing lock)';
    }
    console.error(`[apply-batch] another apply batch appears to be running: ${lockPath}`);
    console.error(`[apply-batch] existing lock: ${existing}`);
    console.error('[apply-batch] stop the other run first; if it crashed, remove the stale lock file manually.');
    process.exit(1);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      unlinkSync(lockPath);
    } catch {
      // Best-effort cleanup; a missing lock is already safe.
    }
  };

  process.once('exit', release);
  process.once('SIGINT', () => {
    release();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    release();
    process.exit(143);
  });

  console.error(`[apply-batch] lock=${lockPath}`);
}

mkdirSync(tmpDir, { recursive: true });

console.error(`[apply-batch] repo=${repoRoot}`);
console.error(`[apply-batch] home=${home}`);
console.error(`[apply-batch] max=${maxRows} role_targets=${roleTargets || '(from search_intent)'} dry_run=${dryRun}`);

if (!dryRun) {
  acquireBatchLock();

  const dedupe = runNode(['shared/dedupe_jobs.mjs', '--apply']);
  if (dedupe.code !== 0) fail('dedupe', dedupe);
  if (dedupe.stdout) process.stdout.write(dedupe.stdout);
  if (dedupe.stderr) process.stderr.write(dedupe.stderr);

  const recompute = runNode(['shared/recompute_auto_apply_eligibility.mjs', '--apply']);
  if (recompute.code !== 0) fail('recompute_auto_apply_eligibility', recompute);
  if (recompute.stdout) process.stdout.write(recompute.stdout);
  if (recompute.stderr) process.stderr.write(recompute.stderr);

  const preflight = runNode(['shared/supervisor_preflight.mjs', '--json']);
  if (preflight.stdout) process.stdout.write(preflight.stdout);
  if (preflight.stderr) process.stderr.write(preflight.stderr);
  if (preflight.code !== 0) fail('supervisor_preflight', preflight);
}

const queueRun = runNode(['shared/auto_apply_queue.mjs', '--summary']);
if (queueRun.stderr) process.stderr.write(queueRun.stderr);
if (queueRun.code !== 0) fail('auto_apply_queue', queueRun);
const rows = parseJsonLines(queueRun.stdout).slice(0, maxRows);
console.error(`[apply-batch] queue_rows=${rows.length}`);
if (rows.length < maxRows) {
  const diag = runNode(['shared/queue_diagnostics.mjs', '--json']);
  if (diag.code === 0) {
    const parsed = parseLastJson(diag.stdout) || {};
    console.error(`[apply-batch] ready rows below requested batch: requested=${maxRows}, eligible=${rows.length}`);
    if (parsed.by_reason) console.error(`[apply-batch] queue reasons: ${JSON.stringify(parsed.by_reason)}`);
    if (parsed.near_misses) {
      const rescoreCount = parsed.near_misses.rescore_candidates_fit_one_below?.count ?? 0;
      const platformCount = parsed.near_misses.platform_expansion_candidates?.count ?? 0;
      console.error(`[apply-batch] review hints: rescore_fit_${(parsed.min_fit ?? 5) - 1}_to_${parsed.min_fit ?? 5}=${rescoreCount}, unsupported_platform_fit_ge_${parsed.min_fit ?? 5}=${platformCount}`);
    }
    const reviewArgs = ['shared/queue_review_report.mjs'];
    if (dryRun) reviewArgs.push('--output', join(tmpDir, `queue-review-dry-run-${Date.now()}.html`));
    const review = runNode(reviewArgs);
    if (review.code === 0) {
      console.error(`[apply-batch] queue review HTML: ${review.stdout.trim().split(/\r?\n/).filter(Boolean).pop()}`);
    } else {
      console.error(`[apply-batch] queue review HTML generation failed; continuing`);
      if (review.stderr) process.stderr.write(review.stderr);
    }
    const readinessArgs = ['shared/apply_readiness_plan.mjs', '--target', String(maxRows)];
    if (dryRun) readinessArgs.push('--output', join(tmpDir, `readiness-plan-dry-run-${Date.now()}.html`));
    const readiness = runNode(readinessArgs);
    if (readiness.code === 0) {
      console.error(`[apply-batch] readiness report HTML: ${readiness.stdout.trim().split(/\r?\n/).filter(Boolean).pop()}`);
    } else {
      console.error('[apply-batch] readiness report generation failed; continuing');
      if (readiness.stderr) process.stderr.write(readiness.stderr);
    }
  }
}

const summaries = [];
const batchStartedAt = new Date().toISOString();
for (let i = 0; i < rows.length; i += 1) {
  const row = rows[i];
  console.error(`[apply-batch] row ${i + 1}/${rows.length}: ${row.id} ${row.company} — ${row.title}`);

  const validate = runNode(['shared/validate_auto_row.mjs', '--row-id', String(row.id)]);
  if (validate.stdout) process.stdout.write(validate.stdout);
  if (validate.stderr) process.stderr.write(validate.stderr);
  if (validate.code !== 0) {
    const validationResult = parseLastJson(`${validate.stdout}\n${validate.stderr}`) || {};
    const reason = validationResult.reason || 'validation_failed';
    if (dryRun) {
      summaries.push({ row_id: row.id, action: 'validation_failed', reason });
      continue;
    }

    const resultFile = join(tmpDir, `apply-result-${row.id}.jsonl`);
    writeFileSync(resultFile, `${JSON.stringify({
      outcome: 'skip',
      reason,
      validation: validationResult,
    })}\n`);
    const record = runNode(['shared/record_apply_outcome.mjs', '--row-id', String(row.id), '--result-file', resultFile]);
    if (record.stdout) process.stdout.write(record.stdout);
    if (record.stderr) process.stderr.write(record.stderr);
    if (record.code !== 0) fail(`record validation failure row ${row.id}`, record);
    const recorded = parseLastJson(record.stdout) || { action: 'recorded_unknown' };
    summaries.push({ row_id: row.id, result_file: resultFile, ...recorded });
    continue;
  }

  if (dryRun) {
    summaries.push({ row_id: row.id, action: 'dry_run_validated' });
    continue;
  }

  const resultFile = join(tmpDir, `apply-result-${row.id}.jsonl`);
  const code = await runTee([driverFor(row), row.apply_url, String(row.id)], resultFile);
  if (code !== 0) {
    console.error(`[apply-batch] driver exited code=${code}; recorder will classify from captured output`);
  }

  const record = runNode(['shared/record_apply_outcome.mjs', '--row-id', String(row.id), '--result-file', resultFile]);
  if (record.stdout) process.stdout.write(record.stdout);
  if (record.stderr) process.stderr.write(record.stderr);
  if (record.code !== 0) fail(`record_apply_outcome row ${row.id}`, record);

  const recorded = parseLastJson(record.stdout) || { action: 'recorded_unknown' };
  summaries.push({ row_id: row.id, company: row.company, title: row.title, result_file: resultFile, ...recorded });

  if (recorded.action === 'submitted') {
    appendFileSync(
      join(home, 'daily_count.jsonl'),
      `${JSON.stringify({
        date: todayUtc(),
        company: row.company,
        apply_url: row.apply_url,
        submitted_at: new Date().toISOString(),
      })}\n`
    );
  }

  if (i < rows.length - 1 && paceMaxMs > 0) {
    const delay = jitterMs();
    console.error(`[apply-batch] pacing ${Math.round(delay / 1000)}s before next row`);
    await sleep(delay);
  }
}

let reportPath = null;
if (!dryRun) {
  const report = runNode(['shared/apply_report.mjs', '--since', todayUtc()]);
  if (report.stdout) process.stdout.write(report.stdout);
  if (report.stderr) process.stderr.write(report.stderr);
  if (report.code === 0) reportPath = report.stdout.trim().split(/\r?\n/).filter(Boolean).pop() || null;
}

const batchSummary = {
  ok: true,
  dry_run: dryRun,
  started_at: batchStartedAt,
  finished_at: new Date().toISOString(),
  rows: summaries,
  report_path: reportPath,
};

const summaryPath = join(tmpDir, `apply-batch-summary-${Date.now()}.json`);
writeFileSync(summaryPath, JSON.stringify(batchSummary, null, 2));

let gapReport = null;
if (!dryRun) {
  const gaps = runNode(['shared/apply_gap_report.mjs', '--summary', summaryPath]);
  if (gaps.stdout) process.stdout.write(gaps.stdout);
  if (gaps.stderr) process.stderr.write(gaps.stderr);
  if (gaps.code === 0) gapReport = parseLastJson(gaps.stdout);
  else console.error('[apply-batch] apply gap report generation failed; continuing');
}

console.log(JSON.stringify({
  ...batchSummary,
  summary_path: summaryPath,
  gap_report: gapReport,
}, null, 2));
