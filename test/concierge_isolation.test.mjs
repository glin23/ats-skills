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
const SANDBOX_NAME = '.concierge_sandbox';
// The refusal exits with this code instead of throwing: an uncaught throw puts
// `paths.mjs:NN / throw new Error( / ^` and a stack above the one sentence the
// machine's owner needs, and he does not program — that reads as "it crashed".
// Same code as the shell guard, so both entrances behave alike.
const REFUSAL_EXIT = 3;

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

// A sandbox that declares whose home left the note for it.
function makeSandbox(prefix, ownerHome) {
  const sandbox = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(sandbox, SANDBOX_NAME), `${ownerHome}\n`);
  return sandbox;
}

// Position of the "delete the note" line vs the "re-run with both switches"
// line. Returned as indexes so a test can say which one has to come first.
function adviceOrder(text) {
  const lines = text.split('\n');
  return {
    deleteNote: lines.findIndex((l) => l.trim().startsWith('rm ') && l.includes(LOCK_NAME)),
    reRun: lines.findIndex((l) => l.includes('MRWEIRDO_HOME=')),
  };
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
  assert.equal(run.status, REFUSAL_EXIT, `expected a refusal, got: ${run.stdout}${run.stderr}`);
  assert.match(run.stderr, /concierge/i);
  assert.ok(run.stderr.includes('/tmp/concierge-abc'), 'the message must name the sandbox this run belongs in');
  assert.ok(run.stderr.includes(join(home, LOCK_NAME)), 'the message must name the file to delete when the run is over');
});

test('a home marked as off-limits is refused when nothing set the switch at all', () => {
  const { root, home } = makeHome('mrw-lock-inherit-', { locked: '/tmp/concierge-xyz' });
  const run = print('p.atsHome()', { MRWEIRDO_HOME: '', HOME: root });
  assert.equal(run.status, REFUSAL_EXIT, `expected a refusal, got: ${run.stdout}${run.stderr}`);
  assert.ok(run.stderr.includes(home), 'the message must name the home it refused to touch');
});

// ---------------------------------------------------------------------------
// The message itself is a deliverable. The person who sees it owns the machine
// and does not program; the run he is being refused is over by the time he sees
// it (the runbook deletes the sandbox in its last step, the note in the same
// breath — the note is what survives a missed step). Leading with "re-run with
// both switches" therefore points him at a directory that no longer exists.
// ---------------------------------------------------------------------------
test('the refusal leads with the fix, in his language, with no stack trace', () => {
  const { root, home } = makeHome('mrw-lock-msg-', { locked: '/tmp/concierge-abc' });
  const run = print('p.atsHome()', { MRWEIRDO_HOME: home, HOME: root });

  const order = adviceOrder(run.stderr);
  assert.ok(order.deleteNote >= 0, `the message must hand him a copy-paste rm line:\n${run.stderr}`);
  assert.ok(order.reRun >= 0, 'and must still tell a real concierge run how to carry on');
  assert.ok(
    order.deleteNote < order.reRun,
    `"delete the note" has to come first — the sandbox it would send him to is already gone:\n${run.stderr}`,
  );
  assert.match(run.stderr, /[一-龥]/, 'the runbook is in Chinese and so is he');
  assert.doesNotMatch(run.stderr, /^\s+at /m, 'a stack frame reads as "the program crashed"');
  assert.doesNotMatch(run.stderr, /paths\.mjs:\d+/, 'no source-line preamble either');
  assert.doesNotMatch(run.stderr, /throw new Error/, 'nor the throwing line itself');
});

test('the Node refusal and the shell refusal say the same thing', () => {
  // Two copies of the wording exist because one entry point never reaches Node.
  // Two copies drift; this is what notices.
  const { root, home } = makeHome('mrw-lock-drift-', { locked: '/tmp/concierge-abc' });
  const node = print('p.atsHome()', { MRWEIRDO_HOME: home, HOME: root });
  const shell = spawnSync('bash', ['scripts/concierge_guard.sh', home], {
    cwd: ROOT, env: { ...process.env, HOME: root }, encoding: 'utf8',
  });

  assert.equal(shell.status, REFUSAL_EXIT);
  const strip = (t) => t.trim().split('\n').map((l) => l.trimEnd()).join('\n');
  assert.equal(strip(shell.stderr), strip(node.stderr), 'the two copies have drifted apart');
});

// ---------------------------------------------------------------------------
// The note is a one-way check: it only speaks when it is there. Forgetting to
// leave it, or deleting it before the run is over, switched the whole
// protection off with nobody to say so — the guard would only ever have spoken
// when it was already working. The sandbox carries a marker of its own so a run
// can insist that the note it depends on is still in place.
// ---------------------------------------------------------------------------
test('a sandbox whose note has gone missing refuses to run', () => {
  const { root, home } = makeHome('mrw-pair-gone-');       // note never left
  const sandbox = makeSandbox('mrw-pair-gone-sandbox-', home);
  const run = print('p.atsHome()', { MRWEIRDO_HOME: sandbox, HOME: root });

  assert.equal(run.status, REFUSAL_EXIT, `an unprotected sandbox must not run: ${run.stdout}`);
  assert.ok(run.stderr.includes(join(home, LOCK_NAME)), 'the message must name the note that is missing');
  assert.ok(run.stderr.includes(sandbox), 'and the sandbox it is meant to point at');
});

test('a sandbox whose note points somewhere else refuses to run', () => {
  const { root, home } = makeHome('mrw-pair-crossed-', { locked: '/tmp/concierge-someone-else' });
  const sandbox = makeSandbox('mrw-pair-crossed-sandbox-', home);
  const run = print('p.atsHome()', { MRWEIRDO_HOME: sandbox, HOME: root });

  assert.equal(run.status, REFUSAL_EXIT, `two crossed runs must not both proceed: ${run.stdout}`);
  assert.ok(run.stderr.includes('/tmp/concierge-someone-else'), 'the message must say where the note actually points');
});

test('a sandbox with its note in place runs without a word', () => {
  const { root, home } = makeHome('mrw-pair-ok-');
  const sandbox = makeSandbox('mrw-pair-ok-sandbox-', home);
  writeFileSync(join(home, LOCK_NAME), `${sandbox}\n`);
  const run = print('p.atsHome()', { MRWEIRDO_HOME: sandbox, HOME: root });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), sandbox);
  assert.equal(run.stderr.trim(), '', 'a correct pair is silent');
});

test('the shell entry point refuses an unprotected sandbox before copying the resume', () => {
  // The `cp` path again: it is the one entry point that never reaches Node, and
  // a resume is the one file that must not land in the wrong place.
  const { root, home } = makeHome('mrw-pair-shell-');       // note never left
  const sandbox = makeSandbox('mrw-pair-shell-sandbox-', home);
  const resume = join(root, 'stranger.pdf');
  writeFileSync(resume, '%PDF-1.4\n1 0 obj\n<< >>\nendobj\ntrailer\n%%EOF\n');

  const run = spawnSync('bash', ['scripts/intake_resume.sh', resume], {
    cwd: ROOT,
    env: { ...process.env, MRWEIRDO_HOME: sandbox, HOME: root },
    encoding: 'utf8',
  });

  assert.equal(run.status, REFUSAL_EXIT, `expected a refusal, got: ${run.stdout}${run.stderr}`);
  assert.equal(existsSync(join(sandbox, 'resume.pdf')), false, 'and nothing may be copied before the refusal');
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
