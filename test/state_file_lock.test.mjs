// state_file_lock.mjs — the single PII lock module（设计稿 §13.4 写入侧统一上锁 /
// §14.1.3 并入阶段 1 的裁决）。One list of carriers (PII_TARGETS), two triggers:
// write-side (whoever writes, locks) and a sweep safety net (preflight +
// secure_profile_files.sh).
//
// Everything here runs against throwaway fake homes. No ~/.mrweirdo-jobs access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockFile, lockDir, sweep, PII_TARGETS } from '../shared/state_file_lock.mjs';
import { writeCoverLetterArtifact } from '../shared/cover_letter_materials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = (path) => statSync(path).mode & 0o777;

// A home holding every carrier class from PII_TARGETS, all born the way
// umask 022 leaves them: files 644, directories 755.
function fullHome() {
  const home = mkdtempSync(join(tmpdir(), 'mrw-lock-full-'));
  const files = [
    'profile.json',
    'search_intent.json',
    'essay_profile.json',
    'answer_provenance.json',
    'profile.json.bak',
    'resume.pdf',
    'cover_letter.pdf',
    'log/submissions.jsonl',
    'log/screenshots/acme_1_before_submit.png',
    'log/screenshots/acme_1_after_submitted.png',
    'materials/cover_letters/1-acme-intern.pdf',
    'materials/cover_letters/1-acme-intern.html',
    'generated_materials/draft.html',
    'run-tmp/apply-result-7.jsonl',
    'run-tmp/apply-batch-summary-1.json',
  ];
  for (const rel of files) {
    const path = join(home, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'x');
    chmodSync(path, 0o644);
  }
  for (const dir of ['log/screenshots', 'materials/cover_letters', 'generated_materials', 'run-tmp']) {
    chmodSync(join(home, dir), 0o755);
  }
  return { home, files };
}

test('sweep locks every carrier class: files 600, carrier directories 700', () => {
  const { home, files } = fullHome();
  const report = sweep(home);

  for (const rel of files) {
    assert.equal(mode(join(home, rel)), 0o600, `${rel} left readable by other accounts`);
  }
  for (const dir of ['log/screenshots', 'materials/cover_letters', 'generated_materials', 'run-tmp']) {
    assert.equal(mode(join(home, dir)), 0o700, `${dir}/ left listable by other accounts`);
  }
  assert.ok(report.locked.length > 0, 'sweep must report what it locked');
  assert.equal(report.failed.length, 0, JSON.stringify(report.failed));
});

test('sweep on an empty home: no error, nothing created, everything reported missing', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-lock-empty-'));
  const report = sweep(home);
  assert.equal(report.locked.length, 0);
  assert.equal(report.failed.length, 0);
  assert.ok(report.missing.length >= PII_TARGETS.length - 1, 'absent carriers are normal, listed as missing');
  assert.deepEqual(readdirSync(home), [], 'sweep must not create files or directories');
});

test('sweep is idempotent: second pass has nothing left to lock', () => {
  const { home } = fullHome();
  sweep(home);
  const second = sweep(home);
  assert.equal(second.locked.length, 0, 'everything was already 600/700; a second sweep must chmod nothing');
  assert.equal(second.failed.length, 0);
});

test('report-only sweep observes but does not touch (demo:check must stay read-only)', () => {
  const { home, files } = fullHome();
  const report = sweep(home, { apply: false });
  for (const rel of files) {
    assert.equal(mode(join(home, rel)), 0o644, `${rel} was chmodded by a report-only sweep`);
  }
  assert.equal(report.locked.length, 0);
  assert.ok(report.would_lock.length >= files.length, 'report mode must still name every unlocked carrier');
});

test('lockFile: locks what exists, silently skips what does not, never creates', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-lock-file-'));
  const present = join(home, 'a.json');
  writeFileSync(present, '{}');
  chmodSync(present, 0o644);
  lockFile(present);
  assert.equal(mode(present), 0o600);

  lockFile(join(home, 'absent.json')); // must not throw
  assert.deepEqual(readdirSync(home), ['a.json'], 'lockFile must not create absent files');
});

test('lockDir: recursive option reaches nested files', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-lock-dir-'));
  const nested = join(home, 'box', 'inner', 'deep.txt');
  mkdirSync(dirname(nested), { recursive: true });
  writeFileSync(nested, 'x');
  chmodSync(nested, 0o644);
  chmodSync(join(home, 'box'), 0o755);
  chmodSync(join(home, 'box', 'inner'), 0o755);

  lockDir(join(home, 'box'), { recursive: true });
  assert.equal(mode(join(home, 'box')), 0o700);
  assert.equal(mode(join(home, 'box', 'inner')), 0o700);
  assert.equal(mode(nested), 0o600);
});

test('CLI: `state_file_lock.mjs sweep` locks the resolved home and exits 0', () => {
  const { home, files } = fullHome();
  const run = spawnSync(process.execPath, ['shared/state_file_lock.mjs', 'sweep'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, MRWEIRDO_HOME: home },
  });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.ok(Array.isArray(report.locked));
  for (const rel of files) {
    assert.equal(mode(join(home, rel)), 0o600, `${rel} not locked via CLI sweep`);
  }
});

test('CLI: `sweep --report` changes nothing (the demo:check contract)', () => {
  const { home, files } = fullHome();
  const run = spawnSync(process.execPath, ['shared/state_file_lock.mjs', 'sweep', '--report'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, MRWEIRDO_HOME: home },
  });
  assert.equal(run.status, 0, run.stderr);
  for (const rel of files) {
    assert.equal(mode(join(home, rel)), 0o644, `${rel} was chmodded by --report`);
  }
});

// Write-side trigger, exercised through a real producer: the cover-letter
// artifact writer. Files must be BORN locked — not swept later.
test('write-side: cover letter HTML and PDF land at 600 the moment they are written', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-lock-writeside-'));
  const result = writeCoverLetterArtifact({
    home,
    row: { id: 12, company: 'Acme', title: 'Operations Intern', key_alignment: '' },
    profile: {
      personal: { first_name: 'Alex', last_name: 'Chen', full_name: 'Alex Chen', email: 'alex@example.com' },
      education: { school: 'State University', degree: 'B.S.', major: 'Business Analytics' },
      experience_summary: [{ title: 'Operations Project Intern', company: 'Campus Lab', summary: 'organized data checks and weekly stakeholder updates' }],
    },
    essayProfile: {
      candidate_positioning: { one_sentence_pitch: 'business analytics student with operations project experience', strongest_themes: ['operations', 'analytics'] },
      proof_points: [{ label: 'Operations dashboard', context: 'student project', actions: ['cleaned weekly data'], evidence: 'class project notes', skills: ['analysis'] }],
      cover_letter_defaults: { opening_angle: 'resume-backed operations and analytics work', closing_angle: '' },
    },
    answerBank: {},
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(mode(result.path), 0o600, 'cover letter PDF born unlocked');
  assert.equal(mode(result.path.replace(/\.pdf$/, '.html')), 0o600, 'cover letter HTML born unlocked');
});

// The screenshot funnel (shared/cdp.mjs) cannot run without a live Chrome, so the
// write-side trigger there is pinned at source level: the screenshot write must
// be followed by a lockFile call in the same handler. Weaker than a behavioural
// test and said so; the behavioural half lives in the captureEvidence tests.
test('write-side: cdp.mjs screenshot handler locks what it writes (source pin)', () => {
  const src = spawnSync(process.execPath, ['-e', `
    const s = require('node:fs').readFileSync('shared/cdp.mjs', 'utf8');
    const fn = s.slice(s.indexOf('async function cmdScreenshot'), s.indexOf('async function cmdTypetext'));
    if (!/writeFileSync[\\s\\S]*lockFile\\(/.test(fn)) { console.error('cmdScreenshot writes without locking'); process.exit(1); }
  `], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(src.status, 0, src.stderr);
});

test('secure_profile_files.sh delegates to the same single list (no second list to rot)', () => {
  // The script must lock carriers the old inline loops never knew about
  // (cover_letter.pdf had no producer and no chmod anywhere in the repo).
  const home = mkdtempSync(join(tmpdir(), 'mrw-lock-delegate-'));
  for (const rel of ['profile.json', 'search_intent.json', 'essay_profile.json', 'cover_letter.pdf']) {
    writeFileSync(join(home, rel), 'x');
    chmodSync(join(home, rel), 0o644);
  }
  const run = spawnSync('bash', [join(ROOT, 'scripts', 'secure_profile_files.sh')], {
    encoding: 'utf8',
    env: { ...process.env, MRWEIRDO_HOME: home },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(mode(join(home, 'cover_letter.pdf')), 0o600, 'cover_letter.pdf is exactly the carrier the old script could not reach');
});
