#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './local_db.mjs';
import { roleTypesFromSearchIntent } from './role_types.mjs';

const repoRoot = process.env.MRWEIRDO_REPO_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const home = process.env.MRWEIRDO_HOME || path.join(homedir(), '.mrweirdo-jobs');

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function readSearchIntent() {
  const intentPath = path.join(home, 'search_intent.json');
  try {
    const data = JSON.parse(fs.readFileSync(intentPath, 'utf8'));
    return data.search_intent || data;
  } catch {
    return null;
  }
}

function resolveRoleTargets() {
  const explicit = argValue('--role-targets') || process.env.MRWEIRDO_ROLE_TYPE_TARGETS || '';
  if (explicit) return explicit;
  const intent = readSearchIntent();
  if (!intent) return '';
  return roleTypesFromSearchIntent(intent, '').join(',');
}

function runNode(args, env = {}) {
  const r = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

async function checkCdp(port) {
  try {
    const res = await fetch(`http://localhost:${port}/json/version`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return { port, ok: false, status: res.status };
    const body = await res.json().catch(() => ({}));
    return { port, ok: true, browser: body.Browser || body.browser || null };
  } catch (e) {
    return { port, ok: false, error: e.message };
  }
}

function latestReport() {
  const dir = path.join(home, 'reports');
  try {
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith('.html'))
      .map((name) => {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        return { path: full, mtime_ms: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => b.mtime_ms - a.mtime_ms)[0] || null;
  } catch {
    return null;
  }
}

function statusCounts() {
  try {
    const db = new DatabaseSync(dbPath());
    return db.prepare(`
      SELECT status, COUNT(*) AS count
        FROM jobs
       GROUP BY status
       ORDER BY count DESC
    `).all();
  } catch {
    return [];
  }
}

function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

const target = Math.max(1, Number(argValue('--target', process.env.MRWEIRDO_TARGET_APPLICATIONS || '100')));
const max = Math.max(1, Number(argValue('--max', process.env.MRWEIRDO_MAX_AUTO_APPLY || '3')));
const roleTargets = resolveRoleTargets();
const cdpPorts = ['9222', '9223'];
const cdp = await Promise.all(cdpPorts.map(checkCdp));
const cdpReady = cdp.some((p) => p.ok);
const preferredRecoveryPort = cdp.find((p) => p.ok)?.port || (process.env.ATS_CDP_PORT || '9223');
const cdpRecoveryCommands = cdpReady
  ? []
  : [
      `ATS_CDP_PORT=${preferredRecoveryPort} bash shared/chrome-cdp-launcher.sh`,
      `ATS_CDP_PORT=${preferredRecoveryPort} node shared/apply_supervisor.mjs --real --max ${max} --role-targets ${roleTargets}`,
    ];

const queueRun = runNode(['shared/auto_apply_queue.mjs', '--summary'], {
  MRWEIRDO_MAX_AUTO_APPLY: String(max),
  MRWEIRDO_ROLE_TYPE_TARGETS: roleTargets,
});
const queueRows = queueRun.stdout.split(/\r?\n/).filter((line) => line.trim().startsWith('{')).length;

const capacityRun = runNode(['shared/apply_capacity_plan.mjs', '--json', '--target', String(target)], {
  MRWEIRDO_ROLE_TYPE_TARGETS: roleTargets,
});
const capacity = parseJson(capacityRun.stdout.split(/\n(?=\/)/)[0]) || null;

const discoverPlanRun = runNode(['shared/discover_candidates.mjs', '--plan'], {
  MRWEIRDO_ROLE_TYPE_TARGETS: roleTargets,
});
const discoverPlan = parseJson(discoverPlanRun.stdout) || null;

const result = {
  ok: true,
  generated_at: new Date().toISOString(),
  role_targets: roleTargets.split(',').map((s) => s.trim()).filter(Boolean),
  requested_real_batch_size: max,
  target_applications: target,
  cdp,
  ready_to_real_apply: cdpReady && queueRows >= max,
  cdp_recovery_commands: cdpRecoveryCommands,
  latest_report: latestReport(),
  status_counts: statusCounts(),
  queue: {
    requested: max,
    ready_for_requested_batch: queueRows,
  },
  capacity,
  discover_plan: discoverPlan,
  next_commands: [
    ...cdpRecoveryCommands,
    `node shared/apply_supervisor.mjs --dry-run --max ${max} --role-targets ${roleTargets}`,
    `node shared/apply_supervisor.mjs --real --max ${max} --role-targets ${roleTargets}`,
    'node shared/rescore_review.mjs --output /tmp/mrweirdo-rescore-review-latest.html',
    'node shared/discover_candidates.mjs --run',
  ],
};

if (hasArg('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('# Mr. Weirdo Jobs Supervisor Status');
  console.log(`role targets: ${roleTargets}`);
  console.log(`CDP: ${cdp.map((p) => `${p.port}=${p.ok ? 'ok' : 'down'}`).join(', ')}`);
  console.log(`ready to real apply: ${result.ready_to_real_apply ? 'yes' : 'no'}`);
  console.log(`latest report: ${result.latest_report?.path || '(none)'}`);
  console.log(`ready for requested batch: ${queueRows}/${max}`);
  if (capacity) {
    console.log(`target ${target}: ready_now=${capacity.ready_now}, shortfall=${capacity.shortfall_now}`);
    console.log(`review candidates: ${capacity.expansion?.human_rescore_fit_one_below?.count ?? 0}`);
    console.log(`additional sourcing needed after known pool: ${capacity.expansion?.additional_sourcing_needed_after_known_pool ?? '?'}`);
  }
  console.log('status counts:');
  for (const row of result.status_counts) console.log(`- ${row.status}: ${row.count}`);
  console.log('next commands:');
  for (const cmd of result.next_commands) console.log(`- ${cmd}`);
}
