#!/usr/bin/env node
// state_file_lock.mjs — 写入侧统一上锁（设计稿 §13.4 那一节 / §14.1.3 并入阶段 1 的裁决）。
// One job: personal-data files go to 600, their directories to 700.
//
// Why one module: the old secure_profile_files.sh knew three JSON files and
// nothing else — cover_letter.pdf had no producer and no chmod anywhere in the
// repo, 50 screenshots and 38 cover letters sat at 644 with real contact info
// inside. A second list would rot the same way, so PII_TARGETS below is the
// only list, and both the shell script and preflight delegate to it.
//
// Two triggers (设计稿 §13.4 定的形状):
//   1. write-side — whoever writes a carrier calls lockFile/lockDir right at the
//      write. Failures there THROW: a file that cannot be locked where it was
//      just written means the directory itself is wrong, and that must be heard.
//   2. sweep — the safety net for carriers that have no producer at all
//      (cover_letter.pdf is hand-placed). Failures here are collected and
//      reported, not thrown: preflight turns them into a WARN, because
//      stopping a whole batch over a chmod is worse than saying it out loud.
//
// run-tmp is in the list by lead's ruling on 阶段 1 设计 §14.5 未明点 1（UNCLEAR-1，
// answers 途经的中转文件）: the transit files carry what was typed into real
// forms, and a 700 directory protects them wholesale.

import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Relative to the state home. String = file; { dir } = directory whose
// contents (and, for nested layouts, subdirectories) are all carriers.
export const PII_TARGETS = [
  'profile.json',
  'search_intent.json',
  'essay_profile.json',
  'answer_provenance.json',
  'profile.json.bak',
  'resume.pdf',
  'cover_letter.pdf',
  'log/submissions.jsonl',
  { dir: 'log/screenshots' },
  { dir: 'materials/cover_letters' },
  { dir: 'generated_materials' },
  { dir: 'run-tmp' },
];

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

const currentMode = (path) => statSync(path).mode & 0o777;

// Locks a single file. Absent file: not an error, nothing is created — most
// carriers only exist once the user has answered something. chmod failures
// are NOT swallowed (write-side is the hard trigger).
export function lockFile(path) {
  if (!existsSync(path)) return { path, action: 'missing' };
  if (currentMode(path) === FILE_MODE) return { path, action: 'already_locked' };
  chmodSync(path, FILE_MODE);
  return { path, action: 'locked' };
}

// Locks a directory (700) and every file inside (600). With { recursive },
// walks subdirectories too. Absent directory: not an error, nothing created.
export function lockDir(dir, { recursive = false } = {}) {
  if (!existsSync(dir)) return [{ path: dir, action: 'missing' }];
  const results = [];
  if (currentMode(dir) !== DIR_MODE) {
    chmodSync(dir, DIR_MODE);
    results.push({ path: dir, action: 'locked' });
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) results.push(...lockDir(path, { recursive }));
      continue;
    }
    if (!entry.isFile()) continue; // sockets/symlinks are not carriers
    const r = lockFile(path);
    if (r.action === 'locked') results.push(r);
  }
  return results;
}

// The safety-net pass over PII_TARGETS. `apply: false` is the read-only
// diagnostic mode (demo:check): it names every unlocked carrier but touches
// nothing. Per-target chmod failures are collected — never thrown — and the
// original error text is kept so the caller can print it verbatim.
export function sweep(home, { apply = true } = {}) {
  const report = { home, apply, locked: [], would_lock: [], missing: [], failed: [] };

  const inspect = (path, wantedMode, lock) => {
    if (!existsSync(path)) {
      report.missing.push(path);
      return false;
    }
    if (currentMode(path) === wantedMode) return true;
    if (!apply) {
      report.would_lock.push(path);
      return true;
    }
    try {
      lock(path);
      report.locked.push(path);
    } catch (e) {
      report.failed.push({ path, error: e.message });
    }
    return true;
  };

  for (const target of PII_TARGETS) {
    if (typeof target === 'string') {
      inspect(join(home, target), FILE_MODE, (p) => chmodSync(p, FILE_MODE));
      continue;
    }
    const dir = join(home, target.dir);
    if (!inspect(dir, DIR_MODE, (p) => chmodSync(p, DIR_MODE))) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        inspect(path, DIR_MODE, (p) => lockDir(p, { recursive: true }));
        continue;
      }
      if (!entry.isFile()) continue;
      inspect(path, FILE_MODE, (p) => chmodSync(p, FILE_MODE));
    }
  }
  return report;
}

// CLI: `node shared/state_file_lock.mjs sweep [--report]`
// Used by scripts/secure_profile_files.sh (delegation — no second list) and
// available for hand-running. Exit 0 even with failures: failures are data
// for the caller's WARN, the JSON on stdout says exactly what happened.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly && process.argv[2] === 'sweep') {
  const { atsHome } = await import('./paths.mjs');
  const report = sweep(atsHome(), { apply: !process.argv.includes('--report') });
  console.log(JSON.stringify(report, null, 2));
  for (const f of report.failed) {
    console.error(`[state_file_lock] could not lock ${f.path}: ${f.error}`);
  }
}
