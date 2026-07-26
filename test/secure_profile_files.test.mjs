// scripts/secure_profile_files.sh is the only place three profile files are
// chmod'ed to 600, and on 2026-07-25 it grew a second loop for the files that
// only exist once the user has answered something (answer_provenance.json,
// profile.json.bak). Verify measured on 2026-07-26 that the new loop never ran
// in the window it was written for: the required-file loop exits 1 on the first
// missing file, and answer_provenance.json exists from the A0 write-back while
// search_intent.json is not written until a later step. Observed:
// answer_provenance.json left at 644.
//
// These tests run the real script against a throwaway fake home. No
// ~/.mrweirdo-jobs access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'secure_profile_files.sh');

const mode = (path) => statSync(path).mode & 0o777;

// Every file starts world-readable, the way umask 022 leaves it.
function fakeHome(files) {
  const home = mkdtempSync(join(tmpdir(), 'mrw-secure-'));
  for (const name of files) {
    const path = join(home, name);
    writeFileSync(path, '{}');
    chmodSync(path, 0o644);
  }
  return home;
}

const run = (home) => spawnSync('bash', [SCRIPT], {
  encoding: 'utf8',
  env: { ...process.env, MRWEIRDO_HOME: home },
});

test('secure_profile_files: locks the optional files even when a required one is missing', () => {
  // The A0 write-back window: answer_provenance.json is on disk, search_intent
  // and essay_profile are not written yet.
  const home = fakeHome(['profile.json', 'answer_provenance.json']);
  const res = run(home);

  assert.equal(
    mode(join(home, 'answer_provenance.json')),
    0o600,
    'answer_provenance.json holds the record of what the user was asked and answered; it must be locked whenever the script runs at all',
  );
  assert.equal(mode(join(home, 'profile.json')), 0o600);

  // Still a hard failure: a home missing search_intent.json is a real problem
  // and the caller has to hear about it. Securing what IS there first does not
  // make the gap quieter.
  assert.equal(res.status, 1, 'a missing required file must still fail the script');
  assert.match(res.stderr, /Missing required profile file/);
});

test('secure_profile_files: a complete home locks everything and succeeds', () => {
  const home = fakeHome(['profile.json', 'search_intent.json', 'essay_profile.json', 'answer_provenance.json', 'profile.json.bak']);
  const res = run(home);
  assert.equal(res.status, 0, res.stderr);
  for (const name of ['profile.json', 'search_intent.json', 'essay_profile.json', 'answer_provenance.json', 'profile.json.bak']) {
    assert.equal(mode(join(home, name)), 0o600, `${name} left readable by other accounts on this machine`);
  }
});

test('secure_profile_files: absent optional files are normal, not an error', () => {
  const home = fakeHome(['profile.json', 'search_intent.json', 'essay_profile.json']);
  const res = run(home);
  assert.equal(res.status, 0, `optional files are absent for most of a run: ${res.stderr}`);
});
