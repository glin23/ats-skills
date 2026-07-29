#!/usr/bin/env node
// record_profile_answers.mjs — the only supported way an answer reaches profile.json.
//
// Until 2026-07-25 the instruction was a sentence in SKILL.md: "after the user
// answers, update the local profile as needed". That is a request to a language
// model, not an assertion, and PROJECT_MEMORY's first principle is the evidence
// that the difference matters — every fabricated-fact defect in this round came
// from a value landing in profile.json with nobody able to say who supplied it.
//
// Rules, in order:
//   1. Only paths some question declares (answerWritePaths). Model = permission.
//   2. Exact types. A three-state boolean takes `true` or `false`, never "yes",
//      never 1, never null. Coercion here becomes a claim about someone's
//      immigration status typed onto a live form.
//   3. The profile must already be valid; we do not build on a broken one.
//   4. Write atomically, re-run the validator, and restore the original bytes if
//      it complains. The profile is either fully updated or exactly as it was.
//
// Usage:
//   node shared/record_profile_answers.mjs \
//     --json '{"work_authorization.authorized_to_work_us": true,
//              "work_authorization.requires_sponsorship_future": true,
//              "work_authorization.visa_status": "F-1 OPT"}' \
//     --source user_answer --category user_work_authorization \
//     --asked-by queue_gate [--home <dir>] [--dry-run]
//
// Exit codes: 0 ok · 2 bad arguments or a path no question asked for ·
//             3 wrong value type · 4 profile validation failed (nothing changed)
import { chmodSync, copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atsHome } from './paths.mjs';
import { answerWritePaths } from './missing_field_questions.mjs';
import { PROVENANCE_SOURCES, backfillLegacy, isProvenanceSource, recordEntries } from './answer_provenance.mjs';
import { validateProfileBundle } from './validate_user_profile.mjs';

const EXIT_OK = 0;
const EXIT_ARGS = 2;
const EXIT_TYPE = 3;
const EXIT_VALIDATION = 4;

export function parseArgs(argv) {
  const value = (name) => {
    const idx = argv.indexOf(name);
    return idx >= 0 ? argv[idx + 1] : null;
  };
  return {
    json: value('--json'),
    source: value('--source'),
    category: value('--category'),
    askedBy: value('--asked-by'),
    home: value('--home') || atsHome(),
    dryRun: argv.includes('--dry-run'),
  };
}

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

/** Refuses rather than coerces. `"true"` is what a hand-edited profile looks
 *  like, and it means "somebody typed something", not "the user said yes". */
export function validateAnswers(answers, writePaths) {
  const unknown = [];
  const wrongType = [];
  const outOfEnum = [];
  for (const [path, value] of Object.entries(answers)) {
    const spec = writePaths.get(path);
    if (!spec) {
      unknown.push(path);
      continue;
    }
    const actual = typeOf(value);
    const expected = spec.value_type;
    const ok = expected === 'object'
      ? actual === 'object'
      : actual === expected;
    if (!ok) {
      wrongType.push({ path, expected, actual, value });
      continue;
    }
    // A path may also declare WHICH values it accepts. Same reason as the type
    // check one line up: a near-miss ("defer" for "defer_to_user") would be
    // stored happily and then read as "he never answered", which puts the
    // question he already answered back in front of him.
    if (spec.enum_values && !spec.enum_values.includes(value)) {
      outOfEnum.push({ path, allowed: spec.enum_values, value });
    }
  }
  return {
    unknown,
    wrongType,
    outOfEnum,
    ok: unknown.length === 0 && wrongType.length === 0 && outOfEnum.length === 0,
  };
}

function readAt(node, segments) {
  let current = node;
  for (const key of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

/** @returns {{path: string, from: any, to: any}[]} only the paths that really move */
export function applyAnswers(profile, answers) {
  const changed = [];
  const skipped = [];
  for (const [path, value] of Object.entries(answers)) {
    const segments = path.split('.');
    const leaf = segments.pop();
    let node = profile;
    for (const key of segments) {
      if (node[key] == null) node[key] = {};
      if (typeof node[key] !== 'object' || Array.isArray(node[key])) {
        throw new Error(`cannot write ${path}: ${key} is a ${typeOf(node[key])}, not an object`);
      }
      node = node[key];
    }
    const from = readAt(profile, [...segments, leaf]);
    if (JSON.stringify(from ?? null) === JSON.stringify(value)) {
      skipped.push({ path, reason: 'unchanged' });
      continue;
    }
    node[leaf] = value;
    changed.push({ path, from: from === undefined ? null : from, to: value });
  }
  return { changed, skipped };
}

export function main(argv, deps = {}) {
  const validate = deps.validate || validateProfileBundle;
  const args = parseArgs(argv);

  if (!args.json) {
    console.error('[record-answers] --json is required, e.g. --json \'{"education.gpa": "3.7"}\'');
    return EXIT_ARGS;
  }
  if (!isProvenanceSource(args.source)) {
    console.error(`[record-answers] --source must be one of: ${PROVENANCE_SOURCES.join(', ')} (got ${args.source})`);
    return EXIT_ARGS;
  }

  let answers;
  try {
    answers = JSON.parse(args.json);
  } catch (e) {
    console.error(`[record-answers] --json is not valid JSON: ${e.message}`);
    return EXIT_ARGS;
  }
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    console.error('[record-answers] --json must be an object of "profile.path": value');
    return EXIT_ARGS;
  }
  if (Object.keys(answers).length === 0) {
    console.error('[record-answers] --json is empty; nothing to record');
    return EXIT_ARGS;
  }

  const writePaths = answerWritePaths();
  const validation = validateAnswers(answers, writePaths);
  if (validation.unknown.length) {
    console.error(`[record-answers] no question declares these paths, so they cannot be written: ${validation.unknown.join(', ')}`);
    console.error('[record-answers] add the path to a QUESTION_TEMPLATES entry in shared/missing_field_questions.mjs first.');
    return EXIT_ARGS;
  }
  if (validation.wrongType.length) {
    for (const bad of validation.wrongType) {
      console.error(`[record-answers] ${bad.path} expects ${bad.expected}, got ${bad.actual} (${JSON.stringify(bad.value)}). Values are not coerced.`);
    }
    return EXIT_TYPE;
  }
  if (validation.outOfEnum.length) {
    for (const bad of validation.outOfEnum) {
      console.error(`[record-answers] ${bad.path} only accepts ${bad.allowed.join(' | ')}, got ${JSON.stringify(bad.value)}. Near misses are refused, not stored.`);
    }
    return EXIT_TYPE;
  }

  const profilePath = join(args.home, 'profile.json');
  if (!existsSync(profilePath)) {
    console.error(`[record-answers] profile.json not found at ${profilePath}. Run /mrweirdo-onboard first.`);
    return EXIT_ARGS;
  }

  const beforeValidation = validate(args.home);
  const preExisting = (beforeValidation.issues || []).filter((issue) => issue.file === profilePath);
  if (preExisting.length) {
    console.error('[record-answers] profile.json is already invalid; refusing to write on top of it:');
    for (const issue of preExisting) console.error(`  - ${issue.path || issue.file}: ${issue.message}`);
    return EXIT_VALIDATION;
  }

  const original = readFileSync(profilePath, 'utf8');
  const profile = JSON.parse(original);
  let changed;
  let skipped;
  try {
    ({ changed, skipped } = applyAnswers(profile, answers));
  } catch (e) {
    console.error(`[record-answers] ${e.message}`);
    return EXIT_TYPE;
  }

  if (args.dryRun || changed.length === 0) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: args.dryRun,
      home: args.home,
      changed,
      skipped,
      provenance_written: 0,
      validation: { ok: beforeValidation.ok, issues: beforeValidation.issues, warnings: beforeValidation.warnings },
    }, null, 2));
    return EXIT_OK;
  }

  const backupPath = `${profilePath}.bak`;
  const tmpPath = `${profilePath}.tmp`;
  copyFileSync(profilePath, backupPath);
  chmodSync(backupPath, 0o600);
  writeFileSync(tmpPath, `${JSON.stringify(profile, null, 2)}\n`);
  renameSync(tmpPath, profilePath);
  chmodSync(profilePath, 0o600);

  const afterValidation = validate(args.home);
  const introduced = (afterValidation.issues || []).filter((issue) => issue.file === profilePath);
  if (introduced.length) {
    copyFileSync(backupPath, profilePath);
    chmodSync(profilePath, 0o600);
    unlinkSync(backupPath);
    console.error('[record-answers] the profile validator rejected the result; profile.json was restored unchanged.');
    for (const issue of introduced) console.error(`  - ${issue.path || issue.file}: ${issue.message}`);
    return EXIT_VALIDATION;
  }

  // The backup exists only for the window between the write and the validator.
  // Leaving it behind would mean an unmanaged extra copy of someone's personal
  // data sitting in the state directory forever, which is the kind of thing this
  // round is trying to remove, not add.
  unlinkSync(backupPath);

  // Values that were already on disk before any of this existed get labelled
  // once, honestly, as `legacy_unverified` — we know they are there, not who
  // supplied them. Idempotent, and per ADR-4 it changes nothing about how those
  // values are used; it only stops the record from implying they were answered.
  const backfilled = backfillLegacy(args.home, profile, [...writePaths.keys()].filter((p) => !answers[p]));

  const provenance = recordEntries(args.home, changed, {
    source: args.source,
    asked_by: args.askedBy,
    category: args.category,
  });

  console.log(JSON.stringify({
    ok: true,
    dry_run: false,
    home: args.home,
    changed,
    skipped,
    provenance_written: changed.length,
    provenance_backfilled: backfilled,
    provenance_entries: Object.keys(provenance.entries).length,
    validation: { ok: afterValidation.ok, issues: afterValidation.issues, warnings: afterValidation.warnings },
  }, null, 2));
  return EXIT_OK;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
