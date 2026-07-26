// answer_provenance.mjs — "who told us this, and when".
//
// The whole round started from one measurement: five demographics values in the
// real profile were byte-identical to the shipped template defaults, and the
// onboarding flow had never asked those questions. Once a value is in
// profile.json, code cannot tell a real answer from a factory default. Making
// the template ship empty fixes most of that for free; this file covers the rest
// (did the user say it out loud, or did we infer it from a resume?).
//
// Deliberately NOT part of any form-filling decision — see ADR-4. The drivers
// answer from the three-state value alone. This file feeds the queue gate's
// "source:" line and future audit work, so a missing or corrupt provenance file
// can never block an application.
//
// It stores a fingerprint, never the value: audit should not create a second
// plaintext copy of someone's immigration status on disk.
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { atsHome } from './paths.mjs';

export const PROVENANCE_FILE = 'answer_provenance.json';
export const PROVENANCE_VERSION = 1;

/** Where an answer came from. `legacy_unverified` is the honest label for values
 *  that predate this file — we know they exist, not who supplied them. */
export const PROVENANCE_SOURCES = [
  'user_answer',
  'onboarding_a0',
  'onboarding_a2',
  'resume_inferred',
  'legacy_unverified',
];

export function isProvenanceSource(source) {
  return PROVENANCE_SOURCES.includes(source);
}

export function provenancePath(home = atsHome()) {
  return join(home, PROVENANCE_FILE);
}

export function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value === undefined ? null : value)).digest('hex').slice(0, 16);
}

export function readProvenance(home = atsHome()) {
  const path = provenancePath(home);
  if (!existsSync(path)) return { version: PROVENANCE_VERSION, entries: {} };
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return { version: parsed.version || PROVENANCE_VERSION, entries: parsed.entries || {} };
}

function writeProvenance(home, doc) {
  const path = provenancePath(home);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  renameSync(tmp, path);
  chmodSync(path, 0o600);
  return doc;
}

/**
 * @param {string} home
 * @param {{path: string, to: any}[]} changes  the writes that actually landed
 * @param {{source: string, asked_by?: string|null, category?: string|null}} meta
 */
export function recordEntries(home, changes, meta) {
  if (!isProvenanceSource(meta?.source)) {
    throw new Error(`unknown provenance source: ${meta?.source}`);
  }
  const doc = readProvenance(home);
  const recorded_at = new Date().toISOString();
  for (const change of changes) {
    doc.entries[change.path] = {
      source: meta.source,
      value_fingerprint: fingerprint(change.to),
      recorded_at,
      asked_by: meta.asked_by || null,
      category: meta.category || null,
    };
  }
  return writeProvenance(home, doc);
}

/**
 * Returns the recorded source, or `'unknown'` when there is no record or the
 * value on disk no longer matches the one we recorded. A stale record must
 * out itself rather than vouch for a value it never saw.
 */
export function sourceFor(home, path, currentValue) {
  const entry = readProvenance(home).entries[path];
  if (!entry) return 'unknown';
  return entry.value_fingerprint === fingerprint(currentValue) ? entry.source : 'unknown';
}

function valueAtPath(profile, path) {
  let node = profile;
  for (const key of path.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[key];
  }
  return node;
}

/**
 * One-time labelling of values that were already on disk before this file
 * existed. They keep working exactly as before (ADR-4); they are simply marked
 * as "we cannot say who supplied this". Idempotent: a path that already has a
 * record is left alone.
 * @returns {number} how many paths were labelled
 */
export function backfillLegacy(home, profile, paths) {
  const doc = readProvenance(home);
  const recorded_at = new Date().toISOString();
  let labelled = 0;
  for (const path of paths) {
    if (doc.entries[path]) continue;
    const value = valueAtPath(profile, path);
    if (value == null || value === '') continue;
    doc.entries[path] = {
      source: 'legacy_unverified',
      value_fingerprint: fingerprint(value),
      recorded_at,
      asked_by: null,
      category: null,
    };
    labelled += 1;
  }
  if (labelled > 0) writeProvenance(home, doc);
  return labelled;
}
