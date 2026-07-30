// captureEvidence / evidenceFileName — 留证的文件名由代码按判定结果起（设计稿
// §13.7 投递留证 R1 / §14.2 captureEvidence 面）。
//
// The browser is injected: a fake runCdp records every call and writes a fake
// PNG where the real funnel would. Everything else — naming, judging, locking,
// ordering — is the shipped code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  captureEvidence,
  evidenceFileName,
  EVIDENCE_PHASES,
  VERDICTS,
} from '../shared/submission_evidence.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test', 'fixtures', 'submission_pages');
const mode = (path) => statSync(path).mode & 0o777;

function fakeCdp({ pageJson } = {}) {
  const calls = [];
  const runner = async (...args) => {
    calls.push(args);
    if (args[0] === 'eval') return pageJson ?? '';
    if (args[0] === 'screenshot') {
      writeFileSync(args[2], 'PNG');
      return JSON.stringify({ ok: true, path: args[2] });
    }
    throw new Error(`fake cdp: unexpected command ${args[0]}`);
  };
  return { calls, runner };
}

test('evidenceFileName：名字来自判定，不再有任何"按 success 起名"的路径', () => {
  const now = new Date('2026-07-30T12:34:56Z');
  assert.equal(
    evidenceFileName({ company: 'Directive', jobId: 304, phase: 'before_submit', now }),
    'directive_304_20260730T123456Z_before_submit.png',
  );
  for (const verdict of VERDICTS) {
    const name = evidenceFileName({ company: 'Directive', jobId: 304, phase: 'after_submit', verdict, now });
    assert.equal(name, `directive_304_20260730T123456Z_after_${verdict}.png`);
    assert.ok(!/success/.test(name), 'the word "success" never appears in an evidence file name again');
  }
  assert.equal(
    evidenceFileName({ company: 'Acme Corp!', jobId: 'row 7', phase: 'before_submit', now }),
    'acme-corp_row-7_20260730T123456Z_before_submit.png',
    'company and job id are slugged, no shell-hostile characters',
  );
});

test('evidenceFileName：非法 phase 与"after 无判定"都必须响，不许默认', () => {
  assert.throws(() => evidenceFileName({ company: 'x', jobId: 1, phase: 'post_submit' }), /unknown phase/);
  assert.throws(() => evidenceFileName({ company: 'x', jobId: 1, phase: 'after_submit' }), /never name a file "success" on faith/);
  assert.throws(() => evidenceFileName({ company: 'x', jobId: 1, phase: 'after_submit', verdict: 'success' }), /never name a file/);
});

test('before_submit：一次 --full-page 截图，落进 log/screenshots，出生即 600/700', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-evidence-before-'));
  const { calls, runner } = fakeCdp();
  const result = await captureEvidence('tab-1', { company: 'acme', jobId: 7, phase: 'before_submit', home }, runner);

  assert.equal(calls.length, 1, 'before_submit needs exactly one cdp call (the shot; scrolling lives inside --full-page)');
  assert.equal(calls[0][0], 'screenshot');
  assert.ok(calls[0].includes('--full-page'), '取景必须整页——单屏截图的命中率是 2/50');
  assert.match(basename(result.path), /^acme_7_.*_before_submit\.png$/);
  assert.equal(mode(result.path), 0o600, 'evidence born unlocked');
  assert.equal(mode(join(home, 'log', 'screenshots')), 0o700);
  assert.equal(result.verdict, null, 'before_submit has nothing to judge yet');
});

test('after_submit：先读页面、判定、再截图；Directive 横幅命名 _after_not_submitted', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-evidence-after-'));
  const banner = readFileSync(join(FIXTURES, 'deny_directive_304.txt'), 'utf8');
  const { calls, runner } = fakeCdp({
    pageJson: JSON.stringify({ bodyText: banner, url: 'https://jobs.ashbyhq.com/directive/x' }),
  });
  const result = await captureEvidence('tab-1', { company: 'directive', jobId: 304, phase: 'after_submit', home }, runner);

  assert.deepEqual(calls.map((c) => c[0]), ['eval', 'screenshot'], 'judge first, then shoot — the name depends on the verdict');
  assert.equal(result.verdict, 'not_submitted');
  assert.ok(result.deny_hits.includes('couldnt_submit'));
  assert.match(basename(result.path), /_after_not_submitted\.png$/, '曾经这张会被命名 success');
  assert.equal(mode(result.path), 0o600);
});

test('after_submit：调用方已判定时不重读页面，判定字符串必须合法', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-evidence-passed-'));
  const { calls, runner } = fakeCdp();
  const result = await captureEvidence('tab-1', { company: 'acme', jobId: 9, phase: 'after_submit', verdict: 'submitted', home }, runner);
  assert.ok(!calls.some((c) => c[0] === 'eval'), 'caller already judged; no second reading');
  assert.match(basename(result.path), /_after_submitted\.png$/);

  await assert.rejects(
    () => captureEvidence('tab-1', { company: 'acme', jobId: 9, phase: 'after_submit', verdict: 'success', home }, runner),
    /is not one of/,
    'the old free-text "success" vocabulary is rejected loudly',
  );
});

test('after_submit：页面读不出来 = unknown（诚实档），不是成功', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-evidence-unreadable-'));
  const { runner } = fakeCdp({ pageJson: 'not json at all' });
  const result = await captureEvidence('tab-1', { company: 'acme', jobId: 3, phase: 'after_submit', home }, runner);
  assert.equal(result.verdict, 'unknown');
  assert.match(basename(result.path), /_after_unknown\.png$/);
});

test('phases 契约：只有 before_submit / after_submit 两档，错档必响', async () => {
  assert.deepEqual(EVIDENCE_PHASES, ['before_submit', 'after_submit']);
  const { runner } = fakeCdp();
  await assert.rejects(
    () => captureEvidence('tab-1', { company: 'a', jobId: 1, phase: 'pre_submit', home: tmpdir() }, runner),
    /unknown phase/,
  );
});

test('CLI：缺参 exit 2 并给用法；不碰任何家目录', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-evidence-cli-'));
  const run = spawnSync(process.execPath, ['shared/submission_evidence.mjs', '--tab', 'x'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, MRWEIRDO_HOME: home },
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /usage:/);
});
