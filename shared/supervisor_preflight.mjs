#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atsHome } from './paths.mjs';
import { deriveRoleTypeFromJob, normalizeRoleType, roleTypesFromSearchIntent } from './role_types.mjs';
import { validateProfileBundle } from './validate_user_profile.mjs';
import { formatMaxRows, resolveMaxRows } from './batch_limit.mjs';

const repoRoot = process.env.MRWEIRDO_REPO_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const home = atsHome();
const maxRows = resolveMaxRows();
const roleTargetsEnv = process.env.MRWEIRDO_ROLE_TYPE_TARGETS || '';

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function runNode(args, env = {}) {
  const r = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function resolveCdpHost() {
  if (process.env.CDP_HOST) return process.env.CDP_HOST.replace(/^https?:\/\//, '');
  if (process.env.ATS_CDP_PORT) return `localhost:${process.env.ATS_CDP_PORT}`;
  try {
    const fromFile = readFileSync(join(home, 'cdp_host'), 'utf8').trim();
    if (fromFile) return fromFile.replace(/^https?:\/\//, '');
  } catch {
    // no persisted host
  }
  return 'localhost:9222';
}

function cdpRemediation(host) {
  const match = String(host || '').match(/:(\d+)$/);
  const port = match ? match[1] : '9222';
  const nextPort = port === '9222' ? '9223' : port;
  const launcher = 'shared/chrome-cdp-launcher.sh';
  return [
    `Start Chrome CDP: ATS_CDP_PORT=${nextPort} bash ${launcher}`,
    `Then run apply/preflight with: ATS_CDP_PORT=${nextPort}`,
    'If Chrome cannot launch from an agent sandbox, run the launcher in the visible Terminal/Cloud Code terminal.',
  ];
}

function formatDetail(detail) {
  if (detail == null) return '';
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

async function checkCdp() {
  const host = resolveCdpHost();
  try {
    const res = await fetch(`http://${host}/json/version`, { signal: AbortSignal.timeout(1500) });
    return { ok: res.ok, host, status: res.status, remediation: res.ok ? [] : cdpRemediation(host) };
  } catch (e) {
    return { ok: false, host, error: e.message, remediation: cdpRemediation(host) };
  }
}

const profilePath = join(home, 'profile.json');
const intentPath = join(home, 'search_intent.json');
const profileValidation = validateProfileBundle(home);
const profile = readJson(profilePath, {});
const intent = readJson(intentPath, {});
const allowedRoleTypes = roleTargetsEnv
  ? roleTargetsEnv.split(',').map((s) => s.trim()).filter(Boolean)
  : roleTypesFromSearchIntent(intent.search_intent || {});
const resumePath = profile?.resume_path || join(home, 'resume.pdf');
const coverLetterPath = profile?.cover_letter_path || join(home, 'cover_letter.pdf');

const queueRun = runNode(['shared/auto_apply_queue.mjs', '--summary'], {
  MRWEIRDO_MAX_AUTO_APPLY: maxRows == null ? '0' : String(maxRows),
  MRWEIRDO_ROLE_TYPE_TARGETS: allowedRoleTypes.join(','),
});
const queueRows = queueRun.stdout.trim().split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
const diagnosticsRun = runNode(['shared/queue_diagnostics.mjs', '--json'], {
  MRWEIRDO_MAX_AUTO_APPLY: maxRows == null ? '0' : String(maxRows),
  MRWEIRDO_ROLE_TYPE_TARGETS: allowedRoleTypes.join(','),
});
let queueDiagnostics = null;
try {
  queueDiagnostics = JSON.parse(diagnosticsRun.stdout || '{}');
} catch {
  queueDiagnostics = null;
}
const validations = queueRows.map((row) => {
  const validate = runNode(['shared/validate_auto_row.mjs', '--row-id', String(row.id)], {
    MRWEIRDO_ROLE_TYPE_TARGETS: allowedRoleTypes.join(','),
  });
  let parsed = null;
  try {
    parsed = JSON.parse(validate.stdout || validate.stderr);
  } catch {
    parsed = { ok: validate.code === 0, raw: validate.stdout || validate.stderr };
  }
  const storedRoleType = normalizeRoleType(row.role_type_match);
  const reclassified = deriveRoleTypeFromJob(row);
  return {
    id: row.id,
    ok: validate.code === 0 && parsed.ok !== false,
    role_type_match: row.role_type_match,
    reclassified,
    allowed: (!storedRoleType || allowedRoleTypes.includes(storedRoleType)) && allowedRoleTypes.includes(reclassified),
    validate: parsed,
  };
});

const syntaxFiles = [
  'shared/constants.mjs',
  'shared/progress.mjs',
  'shared/init_db_cli.mjs',
  'shared/role_types.mjs',
  'shared/function_relevance.mjs',
  'shared/job_identity.mjs',
  'shared/auto_apply_queue.mjs',
  'shared/recompute_auto_apply_eligibility.mjs',
  'shared/validate_auto_row.mjs',
  'shared/validate_user_profile.mjs',
  'shared/discover_candidates.mjs',
  'shared/supervisor_status.mjs',
  'shared/apply_supervisor.mjs',
  'shared/apply_batch.mjs',
  'shared/liveness_gate.mjs',
  'shared/job_report.mjs',
  'shared/analyze_patterns.mjs',
  'shared/upskill_report.mjs',
  'shared/tracker_cli.mjs',
  'shared/queue_diagnostics.mjs',
  'shared/queue_review_report.mjs',
  'shared/apply_readiness_plan.mjs',
  'shared/apply_capacity_plan.mjs',
  'shared/rescore_review.mjs',
  'shared/record_apply_outcome.mjs',
  'shared/apply_report.mjs',
  'shared/answer_templates.mjs',
  'shared/greenhouse_value_rules.mjs',
  'shared/ashby_apply_driver.mjs',
  'shared/greenhouse_apply_driver.mjs',
];
const syntax = syntaxFiles.map((file) => {
  const r = runNode(['--check', file]);
  return { file, ok: r.code === 0, stderr: r.stderr.trim() };
});

const smoke = runNode(['scripts/role_guard_smoke.mjs']);
const cdp = await checkCdp();

const checks = [
  { name: 'profile_json', ok: existsSync(profilePath), detail: profilePath },
  { name: 'profile_shape', ok: !existsSync(profilePath) || profileValidation.ok, detail: profileValidation.issues },
  { name: 'resume_pdf', ok: existsSync(resumePath), detail: resumePath },
  { name: 'search_intent_json', ok: existsSync(intentPath), detail: intentPath },
  { name: 'role_targets_nonempty', ok: allowedRoleTypes.length > 0, detail: allowedRoleTypes },
  { name: 'role_targets_supported', ok: allowedRoleTypes.every((r) => ['intern', 'part_time', 'new_grad_FT'].includes(r)), detail: allowedRoleTypes },
  { name: 'syntax', ok: syntax.every((s) => s.ok), detail: syntax.filter((s) => !s.ok) },
  { name: 'role_guard_smoke', ok: smoke.code === 0, detail: (smoke.stdout || smoke.stderr).trim() },
  { name: 'queue_nonempty', ok: queueRows.length > 0, detail: { rows: queueRows.length } },
  { name: 'queue_validated', ok: validations.every((v) => v.ok && v.allowed), detail: validations.filter((v) => !(v.ok && v.allowed)) },
  { name: 'cdp', ok: cdp.ok, detail: cdp },
];

const warnings = [];
for (const warning of profileValidation.warnings || []) {
  warnings.push({
    name: `profile_${String(warning.path || 'warning').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase()}`,
    detail: warning.message,
  });
}
if (!existsSync(coverLetterPath)) {
  warnings.push({
    name: 'cover_letter_missing',
    detail: 'Rows with required cover-letter uploads will be skipped until profile.cover_letter_path or ~/.mrweirdo-jobs/cover_letter.pdf exists.',
  });
}
if (maxRows != null && queueRows.length > 0 && queueRows.length < maxRows) {
  warnings.push({
    name: 'ready_rows_below_requested_batch',
    detail: queueDiagnostics
      ? {
          requested: maxRows,
          eligible: queueRows.length,
          by_reason: queueDiagnostics.by_reason,
          note: 'Run realtime discovery/scoring or add support for more ATS platforms before expecting a larger batch.',
        }
      : `Requested ${maxRows} rows, but only ${queueRows.length} currently pass the auto-apply queue gates. Run realtime discovery/scoring before expecting a larger batch.`,
  });
}
if (allowedRoleTypes.includes('new_grad_FT')) {
  warnings.push({ name: 'new_grad_enabled', detail: 'Current run includes full-time/new-grad rows.' });
}

const result = {
  ok: checks.every((c) => c.ok),
  generated_at: new Date().toISOString(),
  home,
  repoRoot,
  maxRows: formatMaxRows(maxRows),
  allowedRoleTypes,
  checks,
  warnings,
  queue_diagnostics: queueDiagnostics,
  queue: queueRows,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`# Mr. Weirdo Jobs Supervisor Preflight`);
  console.log(`ok: ${result.ok}`);
  console.log(`role targets: ${allowedRoleTypes.join(', ')}`);
  console.log(`max rows: ${formatMaxRows(maxRows)}`);
  console.log(`queue rows: ${queueRows.length}`);
  for (const check of checks) {
    console.log(`- ${check.ok ? 'OK' : 'FAIL'} ${check.name}`);
    if (!check.ok && check.name === 'cdp') {
      console.log(`  host: ${check.detail.host}`);
      if (check.detail.error) console.log(`  error: ${check.detail.error}`);
      for (const line of check.detail.remediation || []) console.log(`  next: ${line}`);
    }
  }
  for (const warning of warnings) {
    console.log(`- WARN ${warning.name}: ${formatDetail(warning.detail)}`);
  }
  for (const row of queueRows) {
    console.log(`QUEUE ${row.id} | ${row.company} | ${row.title} | ${row.role_type_match} | fit=${row.fit_score}`);
  }
}

process.exit(result.ok ? 0 : 1);
