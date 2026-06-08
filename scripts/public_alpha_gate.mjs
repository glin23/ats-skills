#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/, '');
}

const checks = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
}

function fileExists(rel) {
  const ok = existsSync(join(repoRoot, rel));
  check(`file exists: ${rel}`, ok);
  return ok;
}

function textDoesNotMatch(rel, pattern, label) {
  if (!fileExists(rel)) return;
  const text = read(rel);
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  const matches = [...text.matchAll(globalPattern)].map((m) => `${rel}:${text.slice(0, m.index).split(/\r?\n/).length}: ${m[0]}`);
  check(`${rel}: no ${label}`, matches.length === 0, matches.join('\n'));
}

function textMatches(rel, pattern, label) {
  if (!fileExists(rel)) return;
  check(`${rel}: ${label}`, pattern.test(read(rel)));
}

const packageJson = JSON.parse(read('package.json'));
const version = normalizeVersion(read('VERSION'));
check('VERSION matches package.json', version === normalizeVersion(packageJson.version), `VERSION=${version}; package=${packageJson.version}`);
check('release:alpha script exists', Boolean(packageJson.scripts?.['release:alpha']));
check('demo:check script exists', Boolean(packageJson.scripts?.['demo:check']));

for (const rel of [
  'README.md',
  'DISCLAIMER.md',
  'LICENSE',
  'VERSION',
  'setup.sh',
  'docs/PUBLIC_ALPHA.md',
  '.github/workflows/ci.yml',
  '.claude/skills/mrweirdo-jobskill/SKILL.md',
  '.claude/skills/mrweirdo-onboard/SKILL.md',
  '.claude/skills/mrweirdo-doctor/SKILL.md',
  'scripts/demo_check.mjs',
  'shared/discover_candidates.mjs',
  'shared/apply_readiness_plan.mjs',
  'shared/prune_discovered_jobs.mjs',
  'shared/store_scored_jobs.mjs',
  'shared/lever_apply_driver.mjs',
  'shared/validate_user_profile.mjs',
]) {
  fileExists(rel);
}

if (existsSync(join(repoRoot, 'setup.sh'))) {
  const mode = statSync(join(repoRoot, 'setup.sh')).mode & 0o777;
  check('setup.sh is executable', (mode & 0o111) !== 0, `mode=${mode.toString(8)}`);
  const syntax = spawnSync('bash', ['-n', 'setup.sh'], { cwd: repoRoot, encoding: 'utf8' });
  check('setup.sh syntax', syntax.status === 0, syntax.stderr || syntax.stdout);
}

textMatches('README.md', /Public Alpha Status/, 'has public alpha status section');
textMatches('README.md', /npm run release:alpha/, 'documents alpha gate');
textMatches('DISCLAIMER.md', /public-alpha/i, 'uses public-alpha risk wording');
textMatches('setup.sh', /public alpha/i, 'labels installer as public alpha');

const publicSurface = [
  'README.md',
  'DISCLAIMER.md',
  'setup.sh',
  'docs/PUBLIC_ALPHA.md',
  'examples/launch-posts.md',
  'shared/profile.template.json',
  'shared/supervisor_preflight.mjs',
  '.claude/skills/mrweirdo-onboard/SKILL.md',
  '.claude/skills/mrweirdo-jobskill/SKILL.md',
  '.claude/skills/mrweirdo-onboard/references/run-and-database.md',
];

for (const rel of publicSurface) {
  textDoesNotMatch(rel, /\bpublic[- ]beta\b/i, 'public beta wording');
  textDoesNotMatch(rel, /candidate pool|候选池|补池|补候选|known pool|ready-now pool|ready pool|source pool/i, 'candidate-pool wording');
  textDoesNotMatch(rel, /v2\.1\.7/i, 'stale v2.1.7 version text');
}

textDoesNotMatch('examples/launch-posts.md', /永远不自动 submit|Submit 必须人工授权|250\+ companies/i, 'stale launch promise');
check('old lee company example removed', !existsSync(join(repoRoot, 'examples/lee_company_list.json')));
check('schema-only company-list example present', existsSync(join(repoRoot, 'examples/example_company_list.json')));
check('shared source cache removed', !existsSync(join(repoRoot, 'shared/source_cache.mjs')));

const onboardLines = read('.claude/skills/mrweirdo-onboard/SKILL.md').split(/\r?\n/).length;
check('onboard skill stays concise', onboardLines <= 500, `${onboardLines} lines`);

const failures = checks.filter((c) => !c.ok);
for (const c of checks) {
  const mark = c.ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${c.name}${c.detail && !c.ok ? `\n${c.detail}` : ''}`);
}

if (failures.length) {
  console.error(`\npublic alpha gate failed: ${failures.length} issue(s)`);
  process.exit(1);
}

console.log('\npublic alpha gate ok');
