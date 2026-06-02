import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { sourceWindow, normalizedOffset } from '../shared/sourcing/source_window.mjs';

test('sourceWindow rotates and wraps source lists', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];

  assert.deepEqual(sourceWindow(items, { limit: 3, offset: 0 }), ['a', 'b', 'c']);
  assert.deepEqual(sourceWindow(items, { limit: 3, offset: 2 }), ['c', 'd', 'e']);
  assert.deepEqual(sourceWindow(items, { limit: 3, offset: 4 }), ['e', 'a', 'b']);
  assert.deepEqual(sourceWindow(items, { limit: 99, offset: 3 }), items);
  assert.deepEqual(sourceWindow(items, { limit: 0, offset: 3 }), items);
});

test('normalizedOffset handles large and negative offsets', () => {
  assert.equal(normalizedOffset(7, 5), 2);
  assert.equal(normalizedOffset(-1, 5), 4);
  assert.equal(normalizedOffset('bad', 5), 0);
});

test('discover_candidates plan reads local source cursor without mutating it', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrweirdo-source-window-'));
  const cursorPath = join(home, 'source_cursor.json');
  writeFileSync(cursorPath, JSON.stringify({ next_offset: 2000 }));
  writeFileSync(join(home, 'search_intent.json'), JSON.stringify({
    search_intent: {
      role_type_targets: ['intern', 'part_time'],
      geographic_preference: {
        primary_country: 'US',
        countries_open_to: ['US'],
        relocation_policy: 'anywhere_primary_country',
      },
    },
  }));

  const stdout = execFileSync(process.execPath, [
    'shared/discover_candidates.mjs',
    '--plan',
    '--source-window-size',
    '1000',
  ], {
    cwd: process.cwd(),
    env: { ...process.env, MRWEIRDO_HOME: home, MRWEIRDO_REPO_ROOT: process.cwd() },
    encoding: 'utf8',
  });

  const plan = JSON.parse(stdout);
  assert.equal(plan.source_window.enabled, true);
  assert.equal(plan.source_window.size, 1000);
  assert.equal(plan.source_window.offset, 2000);
  assert.equal(plan.source_window.offset_source, 'local_cursor');
  assert.equal(plan.source_window.advances_cursor_on_run, true);
  assert.deepEqual(JSON.parse(readFileSync(cursorPath, 'utf8')), { next_offset: 2000 });
});

test('discover_candidates run advances local source cursor after completion', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrweirdo-source-window-run-'));
  const outputDir = join(home, 'out');
  mkdirSync(outputDir);
  writeFileSync(join(home, 'search_intent.json'), JSON.stringify({
    search_intent: {
      role_type_targets: ['intern'],
      geographic_preference: {
        primary_country: 'US',
        countries_open_to: ['US'],
        relocation_policy: 'anywhere_primary_country',
      },
    },
  }));

  const stdout = execFileSync(process.execPath, [
    'shared/discover_candidates.mjs',
    '--run',
    '--sources',
    'wellfound',
    '--source-window-size',
    '1000',
    '--output-dir',
    outputDir,
  ], {
    cwd: process.cwd(),
    env: { ...process.env, MRWEIRDO_HOME: home, MRWEIRDO_REPO_ROOT: process.cwd() },
    encoding: 'utf8',
  });

  const result = JSON.parse(stdout);
  const cursor = JSON.parse(readFileSync(join(home, 'source_cursor.json'), 'utf8'));
  assert.equal(result.source_window.offset, 0);
  assert.equal(result.source_window_cursor_next_offset, 1000);
  assert.equal(cursor.next_offset, 1000);
  assert.equal(cursor.window_size, 1000);
});
