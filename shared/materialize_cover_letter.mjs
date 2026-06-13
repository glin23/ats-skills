#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { atsHome, repoRoot } from './paths.mjs';
import { dbPath, initDb } from './local_db.mjs';
import {
  markCoverLetterUsed,
  readJsonOptional,
  writeCoverLetterArtifact,
} from './cover_letter_materials.mjs';

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function usage() {
  console.error('usage: node shared/materialize_cover_letter.mjs --row-id <id> [--json]');
  console.error('       node shared/materialize_cover_letter.mjs --mark-used --row-id <id> --path <pdf> [--result-file <log>] [--json]');
  process.exit(2);
}

const home = atsHome();
const jsonMode = hasArg('--json');
const rowId = Number(argValue('--row-id') || 0);
if (!rowId) usage();

function print(obj, code = 0) {
  const text = jsonMode ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
  console.log(text);
  process.exit(code);
}

if (hasArg('--mark-used')) {
  const result = markCoverLetterUsed({
    home,
    rowId,
    path: argValue('--path'),
    resultFile: argValue('--result-file') || '',
  });
  print(result, result.ok ? 0 : 1);
}

try {
  initDb();
  const db = new DatabaseSync(dbPath());
  const row = db.prepare(`
    SELECT id, company, title, location, apply_url, key_alignment
      FROM jobs
     WHERE id = ?
  `).get(rowId);
  db.close();
  if (!row) print({ ok: false, reason: 'row_not_found', row_id: rowId }, 1);

  const profilePath = join(home, 'profile.json');
  if (!existsSync(profilePath)) print({ ok: false, reason: 'profile_missing', path: profilePath }, 1);
  const profile = readJsonOptional(profilePath, {});
  const essayProfile = readJsonOptional(join(home, 'essay_profile.json'), {});
  const answerBank = readJsonOptional(join(repoRoot(), 'shared/answer_bank.json'), {});

  const result = writeCoverLetterArtifact({
    row,
    profile,
    essayProfile,
    answerBank,
    home,
  });
  print(result, result.ok ? 0 : 1);
} catch (e) {
  print({ ok: false, reason: 'cover_letter_generation_exception', error: e.message }, 1);
}
