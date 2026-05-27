#!/usr/bin/env node
// mrweirdo-jobs install/runtime doctor.
// Pure local checks only; no external network and no ATS actions.

import { accessSync, constants, existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.MRWEIRDO_REPO_ROOT || resolve(__dirname, '..');
const home = process.env.MRWEIRDO_HOME || join(homedir(), '.mrweirdo-jobs');
const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const strict = args.has('--strict');
const checkCdp = args.has('--cdp');
const installCheck = args.has('--install-check');

function resolveCdpHost() {
  if (process.env.CDP_HOST) return process.env.CDP_HOST.replace(/^https?:\/\//, '');
  if (process.env.ATS_CDP_PORT) return `localhost:${process.env.ATS_CDP_PORT}`;
  try {
    const fromFile = readFileSync(join(home, 'cdp_host'), 'utf8').trim();
    if (fromFile) return fromFile.replace(/^https?:\/\//, '');
  } catch {
    // no persisted host yet
  }
  return 'localhost:9222';
}

const results = [];

function add(level, name, detail, fix = '') {
  results.push({ level, name, detail, fix });
}

function pass(name, detail) {
  add('PASS', name, detail);
}

function warn(name, detail, fix = '') {
  add('WARN', name, detail, fix);
}

function fail(name, detail, fix = '') {
  add('FAIL', name, detail, fix);
}

function commandVersion(cmd, versionArgs = ['--version']) {
  const out = spawnSync(cmd, versionArgs, { encoding: 'utf8' });
  if (out.error || out.status !== 0) return null;
  return String(out.stdout || out.stderr || '').trim();
}

function canExecute(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function canRead(path) {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function checkJsonFile(path, label) {
  if (!existsSync(path)) {
    warn(label, `${path} not found yet.`, 'Run /mrweirdo-onboard to create it.');
    return;
  }
  try {
    JSON.parse(readFileSync(path, 'utf8'));
    pass(label, `${path} parses as JSON.`);
  } catch (e) {
    fail(label, `${path} is not valid JSON: ${e.message}`, 'Fix the JSON before running apply.');
  }
}

function checkSkillLocation(label, dir) {
  const required = ['mrweirdo-onboard', 'mrweirdo-doctor'];
  const missing = required
    .map((name) => join(dir, name, 'SKILL.md'))
    .filter((skill) => !existsSync(skill));
  if (missing.length) {
    warn(label, `Missing ${missing.join(', ')}.`, 'Re-run setup.sh, or set the relevant skills directory env var and re-run setup.');
    return false;
  }
  pass(label, `Found ${required.join(', ')} in ${dir}.`);
  return true;
}

async function checkCdpEndpoint() {
  const host = resolveCdpHost();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://${host}/json/version`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      warn('Chrome CDP', `${host} responded with HTTP ${res.status}.`, 'Restart Chrome CDP with shared/chrome-cdp-launcher.sh.');
      return;
    }
    const body = await res.json();
    pass('Chrome CDP', `Connected to ${body.Browser || 'Chrome'} at ${host}.`);
  } catch {
    warn('Chrome CDP', `No DevTools endpoint at ${host}.`, 'Run: bash ~/.mrweirdo-jobs/repo/shared/chrome-cdp-launcher.sh');
  }
}

function runChecks() {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor >= 24) pass('Node.js', `v${process.versions.node}`);
  else fail('Node.js', `v${process.versions.node} found; Node 24+ is required.`, 'Install Node 24+ and re-run setup.');

  const gitVersion = commandVersion('git');
  if (gitVersion) pass('git', gitVersion);
  else fail('git', 'git command not found.', 'Install git and re-run setup.');

  if (platform() === 'darwin') pass('OS', 'macOS detected.');
  else warn('OS', `${platform()} detected. The Chrome launcher is macOS-first.`, 'Edit shared/chrome-cdp-launcher.sh for this OS before applying.');

  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (canExecute(chromePath)) pass('Chrome', chromePath);
  else warn('Chrome', 'Google Chrome was not found at the default macOS path.', 'Install Chrome or edit shared/chrome-cdp-launcher.sh.');

  const versionPath = join(repoRoot, 'VERSION');
  if (canRead(versionPath)) pass('Repo', `${repoRoot} (${readFileSync(versionPath, 'utf8').trim()})`);
  else fail('Repo', `VERSION not readable under ${repoRoot}.`, 'Run setup.sh from a valid mrweirdo-jobs checkout.');

  const canonicalSkills = ['mrweirdo-onboard', 'mrweirdo-doctor'].map((name) =>
    join(repoRoot, '.claude', 'skills', name, 'SKILL.md')
  );
  const missingCanonical = canonicalSkills.filter((p) => !canRead(p));
  if (missingCanonical.length === 0) pass('Canonical Skills', canonicalSkills.join(', '));
  else fail('Canonical Skills', `Missing ${missingCanonical.join(', ')}.`, 'Your checkout is incomplete; pull main or re-run setup.');

  const claudeReady = checkSkillLocation('Claude Code skills', process.env.CLAUDE_SKILLS_DIR || join(homedir(), '.claude', 'skills'));
  const codexReady = checkSkillLocation('Codex user skills', process.env.CODEX_SKILLS_DIR || join(homedir(), '.codex', 'skills'));
  const workspaceReady = checkSkillLocation('Codex workspace skills', join(repoRoot, '.agents', 'skills'));
  if (!claudeReady && !codexReady && !workspaceReady) {
    fail('Skill install', 'No host skill location contains both mrweirdo-onboard and mrweirdo-doctor.', 'Re-run setup.sh and restart Claude Code/Codex.');
  }

  const workspaceSkillDir = join(repoRoot, '.agents', 'skills', 'mrweirdo-onboard');
  if (existsSync(workspaceSkillDir)) {
    const st = lstatSync(workspaceSkillDir);
    if (!st.isSymbolicLink()) {
      warn('Codex workspace mirror', `${workspaceSkillDir} exists but is not a symlink.`, 'Set MRWEIRDO_FORCE_LINK=1 and re-run setup.sh to regenerate workspace links.');
    }
  }

  if (existsSync(home)) pass('User state dir', home);
  else fail('User state dir', `${home} does not exist.`, 'Run setup.sh first.');

  const envPath = join(home, '.env');
  if (existsSync(envPath)) {
    const mode = statSync(envPath).mode & 0o777;
    if (mode === 0o600) pass('.env permissions', `${envPath} is 600.`);
    else warn('.env permissions', `${envPath} is ${mode.toString(8)}, expected 600.`, `Run: chmod 600 ${envPath}`);
  } else {
    warn('.env', `${envPath} not found.`, 'Run setup.sh to create an empty private .env.');
  }

  if (!installCheck) {
    const resumePath = join(home, 'resume.pdf');
    if (existsSync(resumePath)) pass('Resume', resumePath);
    else warn('Resume', `${resumePath} not found yet.`, 'Run /mrweirdo-onboard and provide a resume PDF.');

    checkJsonFile(join(home, 'profile.json'), 'profile.json');
    checkJsonFile(join(home, 'search_intent.json'), 'search_intent.json');

    const dbPath = join(home, 'jobs.db');
    if (existsSync(dbPath)) pass('jobs.db', dbPath);
    else warn('jobs.db', `${dbPath} not found yet.`, 'It will be created during /mrweirdo-onboard Step 4.');
  }
}

function printHuman() {
  console.log('mrweirdo-jobs doctor');
  console.log(`repo: ${repoRoot}`);
  console.log(`home: ${home}`);
  console.log('');
  const order = { FAIL: 0, WARN: 1, PASS: 2 };
  for (const r of [...results].sort((a, b) => order[a.level] - order[b.level])) {
    const icon = r.level === 'PASS' ? '✓' : r.level === 'WARN' ? '!' : 'x';
    console.log(`[${r.level}] ${icon} ${r.name}: ${r.detail}`);
    if (r.fix) console.log(`       fix: ${r.fix}`);
  }
  const counts = results.reduce((acc, r) => {
    acc[r.level] = (acc[r.level] || 0) + 1;
    return acc;
  }, {});
  console.log('');
  console.log(`summary: ${counts.PASS || 0} pass, ${counts.WARN || 0} warn, ${counts.FAIL || 0} fail`);
  if ((counts.FAIL || 0) === 0) {
    const cdpWarn = results.some((r) => r.level === 'WARN' && r.name === 'Chrome CDP');
    if (cdpWarn) {
      console.log('status: install looks usable, but start Chrome CDP before running real applications.');
    } else if ((counts.WARN || 0) > 0) {
      console.log('status: install looks usable. Warnings may be normal before first onboarding.');
    } else {
      console.log('status: ready.');
    }
  } else {
    console.log('status: fix FAIL items before running real applications.');
  }
}

runChecks();
if (checkCdp) await checkCdpEndpoint();

const failCount = results.filter((r) => r.level === 'FAIL').length;
const warnCount = results.filter((r) => r.level === 'WARN').length;

if (json) {
  console.log(JSON.stringify({ ok: failCount === 0, fail_count: failCount, warn_count: warnCount, results }, null, 2));
} else {
  printHuman();
}

process.exit(failCount > 0 || (strict && warnCount > 0) ? 1 : 0);
