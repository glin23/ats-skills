#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roleTypesFromSearchIntent } from './role_types.mjs';

const repoRoot = process.env.MRWEIRDO_REPO_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const home = process.env.MRWEIRDO_HOME || join(homedir(), '.mrweirdo-jobs');

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function readSearchIntent() {
  const intentPath = join(home, 'search_intent.json');
  if (!existsSync(intentPath)) return null;
  try {
    const data = JSON.parse(readFileSync(intentPath, 'utf8'));
    return data.search_intent || data;
  } catch {
    return null;
  }
}

function resolveRoleTargets() {
  const explicit = argValue('--role-targets') || process.env.MRWEIRDO_ROLE_TYPE_TARGETS || '';
  if (explicit) return explicit;
  const searchIntent = readSearchIntent();
  if (!searchIntent) return '';
  return roleTypesFromSearchIntent(searchIntent, '').join(',');
}

function printUsage() {
  console.error(`Usage:
  Dry-run validation:
    node shared/apply_supervisor.mjs --dry-run --max 3 --role-targets intern,part_time

  Real foreground batch:
    node shared/apply_supervisor.mjs --real --max 3 --role-targets intern,part_time

Options:
  --max N                  Number of rows to process.
  --role-targets LIST      Comma-separated: intern,part_time,new_grad_FT.
  --cdp-port PORT          Preferred Chrome CDP port. Defaults to ATS_CDP_PORT or 9222.
  --no-launch-cdp          Do not try to launch Chrome; only check the existing endpoint.
  --pace-min-ms N          Forwarded to apply_batch.
  --pace-max-ms N          Forwarded to apply_batch.
`);
}

function run(cmd, args, env = {}, stdio = 'inherit') {
  return spawnSync(cmd, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio,
    encoding: stdio === 'pipe' ? 'utf8' : undefined,
  });
}

async function cdpReady(port) {
  try {
    const res = await fetch(`http://localhost:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function launchAndCheck(port) {
  console.error(`[apply-supervisor] launching Chrome CDP on port ${port}`);
  const result = run('bash', ['shared/chrome-cdp-launcher.sh'], { ATS_CDP_PORT: String(port) });
  if ((result.status ?? 1) !== 0) return false;
  return cdpReady(port);
}

function remediationPort(preferredPort) {
  return preferredPort === '9222' && !argValue('--cdp-port') && !process.env.ATS_CDP_PORT ? '9223' : preferredPort;
}

function printCdpRecovery(port, maxRows, roleTargets) {
  console.error('Start it from the visible Terminal/Cloud Code terminal, then rerun:');
  console.error(`  ATS_CDP_PORT=${port} bash shared/chrome-cdp-launcher.sh`);
  console.error(`  ATS_CDP_PORT=${port} node shared/apply_supervisor.mjs --real --max ${maxRows} --role-targets ${roleTargets}`);
}

async function ensureCdp(preferredPort) {
  if (await cdpReady(preferredPort)) {
    console.error(`[apply-supervisor] CDP ready on port ${preferredPort}`);
    return preferredPort;
  }

  if (hasArg('--no-launch-cdp')) {
    const port = remediationPort(preferredPort);
    console.error(`[apply-supervisor] CDP is not available on port ${preferredPort}`);
    printCdpRecovery(port, argValue('--max') || '3', argValue('--role-targets') || 'intern,part_time');
    return null;
  }

  if (await launchAndCheck(preferredPort)) return preferredPort;

  const fallbackPort = preferredPort === '9223' ? '9224' : '9223';
  if (fallbackPort !== preferredPort && await launchAndCheck(fallbackPort)) return fallbackPort;

  console.error('[apply-supervisor] Chrome CDP is still unavailable.');
  printCdpRecovery(fallbackPort, argValue('--max') || '3', argValue('--role-targets') || 'intern,part_time');
  return null;
}

const dryRun = hasArg('--dry-run');
const realRun = hasArg('--real');
const maxRows = argValue('--max') || process.env.MRWEIRDO_MAX_AUTO_APPLY || '3';
const roleTargets = resolveRoleTargets();
const preferredPort = String(argValue('--cdp-port') || process.env.ATS_CDP_PORT || '9222');

if (hasArg('--help') || hasArg('-h')) {
  printUsage();
  process.exit(0);
}

if (!dryRun && !realRun) {
  printUsage();
  console.error('[apply-supervisor] Refusing to run without --dry-run or --real.');
  process.exit(2);
}

if (dryRun && realRun) {
  console.error('[apply-supervisor] Choose exactly one of --dry-run or --real.');
  process.exit(2);
}

if (!roleTargets) {
  console.error('[apply-supervisor] Missing role targets. Set --role-targets or run onboarding to create search_intent.role_type_targets.');
  process.exit(2);
}

let cdpPort = preferredPort;
if (realRun) {
  cdpPort = await ensureCdp(preferredPort);
  if (!cdpPort) process.exit(1);
}

const applyArgs = ['shared/apply_batch.mjs', '--max', String(maxRows), '--role-targets', roleTargets];
if (dryRun) applyArgs.push('--dry-run');
for (const name of ['--pace-min-ms', '--pace-max-ms']) {
  const value = argValue(name);
  if (value != null) applyArgs.push(name, value);
}

console.error(`[apply-supervisor] mode=${dryRun ? 'dry-run' : 'real'} max=${maxRows} role_targets=${roleTargets}`);
const apply = run(process.execPath, applyArgs, {
  ATS_CDP_PORT: cdpPort,
  MRWEIRDO_MAX_AUTO_APPLY: String(maxRows),
  MRWEIRDO_ROLE_TYPE_TARGETS: roleTargets,
});

process.exit(apply.status ?? 1);
