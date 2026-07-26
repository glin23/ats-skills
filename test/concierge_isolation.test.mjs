import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Running a stranger's resume on the owner's machine ("concierge run") is
// protected by environment variables, and environment variables do not survive
// from one shell to the next: every skill block re-exports
// `MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"`, so a single block
// that is not prefixed silently writes the stranger's data into the owner's own
// home. A file on disk does survive between blocks, which is why the run marks
// itself with one and every entry point refuses the owner's home while it is there.
//
// Second half of the same problem: run artefacts used to go to a hard-coded
// /tmp/mrweirdo-onboard through a SECOND switch that no skill or script ever
// set — what the form was filled with, which personal questions went
// unanswered, the scored job list. One home switch now moves all of it.
// ---------------------------------------------------------------------------

const LOCK_NAME = '.concierge_run_active';

function nodeEval(expression, env) {
  return spawnSync(process.execPath, ['-e', expression], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8' });
}

function print(fn, env) {
  return nodeEval(`import('./shared/paths.mjs').then(async (p) => {
    const t = await import('./shared/onboard_tmp.mjs');
    console.log(${fn});
  }).catch((e) => { console.error(e.message); process.exit(9); })`, env);
}

function makeHome(prefix, { locked = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const home = join(root, '.mrweirdo-jobs');
  mkdirSync(home, { recursive: true });
  if (locked) writeFileSync(join(home, LOCK_NAME), `${locked}\n`);
  return { root, home };
}

test('run artefacts follow the home switch instead of a shared /tmp directory', () => {
  const { home } = makeHome('mrw-tmp-follow-');
  const run = print('t.onboardTmpDir()', { MRWEIRDO_HOME: home, MRWEIRDO_ONBOARD_TMP_DIR: '' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(
    run.stdout.trim(),
    join(home, 'run-tmp'),
    'one switch has to move everything, or the sandbox leaks the answers it typed onto forms',
  );
});

test('an explicit run-artefact directory still wins', () => {
  const { home } = makeHome('mrw-tmp-explicit-');
  const run = print('t.onboardTmpDir()', { MRWEIRDO_HOME: home, MRWEIRDO_ONBOARD_TMP_DIR: '/tmp/somewhere-else' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), '/tmp/somewhere-else');
});

test('a home marked as off-limits is refused, not silently used', () => {
  const { root, home } = makeHome('mrw-lock-explicit-', { locked: '/tmp/concierge-abc' });
  // The `${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}` shape every skill block uses:
  // the variable IS set, it is just set to the owner's own home because nothing
  // was inherited. Checking "is the variable missing" would sail straight past it.
  const run = print('p.atsHome()', { MRWEIRDO_HOME: home, HOME: root });
  assert.equal(run.status, 9, `expected a refusal, got: ${run.stdout}`);
  assert.match(run.stderr, /concierge/i);
  assert.ok(run.stderr.includes('/tmp/concierge-abc'), 'the message must name the sandbox this run belongs in');
  assert.ok(run.stderr.includes(join(home, LOCK_NAME)), 'the message must name the file to delete when the run is over');
});

test('a home marked as off-limits is refused when nothing set the switch at all', () => {
  const { root, home } = makeHome('mrw-lock-inherit-', { locked: '/tmp/concierge-xyz' });
  const run = print('p.atsHome()', { MRWEIRDO_HOME: '', HOME: root });
  assert.equal(run.status, 9, `expected a refusal, got: ${run.stdout}`);
  assert.ok(run.stderr.includes(home), 'the message must name the home it refused to touch');
});

test('an unmarked home is used without a word', () => {
  const { root, home } = makeHome('mrw-lock-absent-');
  const run = print('p.atsHome()', { MRWEIRDO_HOME: '', HOME: root });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), home);
  assert.equal(run.stderr.trim(), '', 'no marker, no noise');
});

test('the sandbox itself is never refused', () => {
  const { home } = makeHome('mrw-lock-owner-', { locked: '/tmp/concierge-abc' });
  const sandbox = mkdtempSync(join(tmpdir(), 'mrw-sandbox-'));
  const run = print('p.atsHome()', { MRWEIRDO_HOME: sandbox, HOME: dirname(home) });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), sandbox);
});

test('the shell entry points refuse the marked home too, before anything is copied', () => {
  // intake_resume.sh copies the resume with `cp`, never touching Node — the
  // guard the JS side gives us would not have seen it, and a resume is exactly
  // the file that must not land in the wrong home.
  const { root, home } = makeHome('mrw-lock-shell-', { locked: '/tmp/concierge-abc' });
  const resume = join(root, 'stranger.pdf');
  writeFileSync(resume, '%PDF-1.4\n1 0 obj\n<< >>\nendobj\ntrailer\n%%EOF\n');

  const run = spawnSync('bash', ['scripts/intake_resume.sh', resume], {
    cwd: ROOT,
    env: { ...process.env, MRWEIRDO_HOME: home, HOME: root },
    encoding: 'utf8',
  });

  assert.notEqual(run.status, 0, 'copying a stranger\'s resume into a marked home must fail loudly');
  assert.match(run.stderr, /concierge/i);
  assert.equal(existsSync(join(home, 'resume.pdf')), false, 'and nothing may be copied before the refusal');
});
