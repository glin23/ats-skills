#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const home = process.env.MRWEIRDO_HOME || join(homedir(), '.mrweirdo-jobs');
const args = process.argv.slice(2);
const json = args.includes('--json');
const expectIdx = args.indexOf('--expect-ready');
const expectReady = expectIdx >= 0 ? Math.max(0, Number(args[expectIdx + 1] || 0)) : 0;

function read(path, fallback = '') {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return fallback;
  }
}

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, {
    cwd: repoRoot,
    env: { ...process.env, MRWEIRDO_HOME: home, MRWEIRDO_REPO_ROOT: repoRoot, ...(opts.env || {}) },
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
}

function warn(name, detail = '') {
  warnings.push({ name, detail });
}

function jsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function resolveCdpHost() {
  if (process.env.CDP_HOST) return process.env.CDP_HOST.replace(/^https?:\/\//, '');
  if (process.env.ATS_CDP_PORT) return `localhost:${process.env.ATS_CDP_PORT}`;
  const fromFile = read(join(home, 'cdp_host')).trim();
  return fromFile ? fromFile.replace(/^https?:\/\//, '') : 'localhost:9222';
}

async function cdpStatus() {
  const host = resolveCdpHost();
  try {
    const res = await fetch(`http://${host}/json/version`, { signal: AbortSignal.timeout(1500) });
    return { ok: res.ok, host, status: res.status };
  } catch (e) {
    return { ok: false, host, error: e.message };
  }
}

function skillLinkStatus(skillName, baseDir) {
  const target = join(baseDir, skillName);
  if (!existsSync(target)) return { exists: false, target };
  const st = statSync(target);
  return { exists: true, target, symlink: st.isSymbolicLink?.() ?? false };
}

const checks = [];
const warnings = [];
const facts = {};

const packageJson = jsonParse(read(join(repoRoot, 'package.json')), {});
facts.version = packageJson?.version || read(join(repoRoot, 'VERSION')).trim();

const nodeMajor = Number(process.versions.node.split('.')[0]);
check('node_24_or_newer', nodeMajor >= 24, `node=${process.version}`);

const setupSyntax = run('bash', ['-n', 'setup.sh']);
check('setup_syntax', setupSyntax.code === 0, setupSyntax.stderr.trim());

for (const skillName of ['mrweirdo-jobskill', 'mrweirdo-onboard', 'mrweirdo-doctor']) {
  check(`skill_source_${skillName}`, existsSync(join(repoRoot, '.claude/skills', skillName, 'SKILL.md')));
}

const skillDirs = [
  ['claude', process.env.CLAUDE_SKILLS_DIR || join(homedir(), '.claude/skills')],
  ['codex', process.env.CODEX_SKILLS_DIR || join(homedir(), '.codex/skills')],
  ['workspace', join(repoRoot, '.agents/skills')],
];
for (const [label, dir] of skillDirs) {
  const status = skillLinkStatus('mrweirdo-jobskill', dir);
  if (!status.exists) {
    warn(`skill_not_linked_${label}`, `Run setup.sh so /mrweirdo-jobskill appears in ${dir}`);
  }
}

const cdp = await cdpStatus();
facts.cdp = cdp;
if (!cdp.ok) {
  warn('chrome_cdp_not_running', `Start it with: bash ${join(repoRoot, 'shared/chrome-cdp-launcher.sh')}`);
}

const profilePath = join(home, 'profile.json');
const intentPath = join(home, 'search_intent.json');
const dbPath = process.env.MRWEIRDO_DB_PATH || join(home, 'jobs.db');
facts.home = home;
facts.profile_exists = existsSync(profilePath);
facts.intent_exists = existsSync(intentPath);
facts.db_exists = existsSync(dbPath);

if (existsSync(profilePath)) {
  const validation = run(process.execPath, ['shared/validate_user_profile.mjs']);
  check('profile_valid', validation.code === 0, (validation.stdout || validation.stderr).trim());
} else {
  warn('first_run_profile_missing', 'This is fine before onboarding. /mrweirdo-jobskill will ask for a resume and intro.');
}

let preflight = null;
if (existsSync(profilePath) && existsSync(intentPath) && existsSync(dbPath)) {
  const maxRows = String(Math.max(expectReady || 10, 1));
  const r = run(process.execPath, ['shared/supervisor_preflight.mjs', '--json'], {
    env: { MRWEIRDO_MAX_AUTO_APPLY: maxRows },
  });
  preflight = jsonParse(r.stdout, null);
  facts.ready_rows = Array.isArray(preflight?.queue) ? preflight.queue.length : 0;
  facts.eligible_rows = preflight?.queue_diagnostics?.eligible ?? null;
  if (!preflight?.ok) warn('supervisor_preflight_not_clean', (r.stdout || r.stderr).slice(0, 1000));
  if (expectReady > 0 && facts.ready_rows < expectReady) {
    check('ready_rows_meet_demo_target', false, `expected=${expectReady}; ready=${facts.ready_rows}`);
  }
} else if (expectReady > 0) {
  warn('ready_rows_not_checked', 'Run onboarding/discovery first, then rerun demo:check -- --expect-ready 10.');
}

if (expectReady === 0 || (facts.ready_rows ?? 0) >= expectReady) {
  check('demo_check_completed', true);
}

const result = {
  ok: checks.every((c) => c.ok),
  generated_at: new Date().toISOString(),
  facts,
  checks,
  warnings,
  next_command: '/mrweirdo-jobskill',
  preflight,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('# Mr. Weirdo Jobs Demo Check');
  console.log(`ok: ${result.ok}`);
  console.log(`version: ${facts.version || 'unknown'}`);
  console.log(`home: ${home}`);
  console.log(`start command: ${result.next_command}`);
  console.log('');
  for (const c of checks) console.log(`${c.ok ? 'OK' : 'FAIL'} ${c.name}${c.detail && !c.ok ? ` - ${c.detail}` : ''}`);
  for (const w of warnings) console.log(`WARN ${w.name}: ${w.detail}`);
  if (facts.ready_rows != null) {
    console.log(`ready rows: ${facts.ready_rows}${facts.eligible_rows != null ? ` / eligible ${facts.eligible_rows}` : ''}`);
  }
  console.log('');
  console.log('Live demo flow: type /mrweirdo-jobskill, upload resume, add a short self-introduction, confirm the parsed profile, then run the 10-row batch.');
}

process.exit(result.ok ? 0 : 1);
