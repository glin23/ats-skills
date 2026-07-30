#!/usr/bin/env node
// submission_evidence.mjs — 「投出去了没有」的唯一判定实现（阶段 1 设计 §14 数字变真，
// ADR-14 判定器唯一实现）。
//
// Why this module exists: the three ATS drivers each carried their own success
// regex and they drifted — Ashby's extra branch judged the literal failure
// banner "We couldn't submit your application … you have already applied …"
// as success, which is where six fake-"success" screenshots and their fake DB
// rows came from. One implementation, imported everywhere, guarded later by a
// source scan (阶段 1 提交 9).
//
// Collection semantics, not a rule chain (label-key-binding 定稿的教训——有序
// 规则链插一行会盖住上面某行且无人知晓):
//   * ALL confirm rules and ALL deny rules are evaluated, no short-circuit.
//   * confirm hits ∧ no deny hits  → 'submitted'
//   * deny hits ∧ no confirm hits  → 'not_submitted'
//   * anything else                → 'unknown'   (both, or neither)
// 'unknown' is a legitimate answer and NEVER counts as submitted downstream —
// 宁可少计一家，不可虚报一家。There is no default-success path in this file,
// and tests pin that property.
//
// Every rule carries the name of a fixture file under
// test/fixtures/submission_pages/ that demonstrably triggers it; the test
// suite walks the exported tables and fails on any rule without a live
// fixture (ADR-14: 规则没有夹具，改了不知道漂没漂).

import { mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockDir, lockFile } from './state_file_lock.mjs';

// target: 'text' (default) matches against page bodyText; 'url' against the
// page URL. URL hits join the same confirm set — evidence, not a bypass.
export const CONFIRM_PATTERNS = [
  { id: 'ashby_success', re: /successfully submitted/i, fixture: 'confirm_ashby_success.txt' },
  { id: 'application_received', re: /application[\s\S]{0,30}received/i, fixture: 'confirm_application_received.txt' },
  { id: 'thank_you_for_applying', re: /thanks? (?:so much )?for (?:applying|submitting|your application)|thank you for (?:applying|submitting|your application)/i, fixture: 'confirm_greenhouse_thank_you.txt' },
  { id: 'lever_application_submitted', re: /application (?:has been )?submitted|your application has been received/i, fixture: 'confirm_lever_submitted.txt' },
  { id: 'lever_thanks_url', re: /\/thanks(?:[/?#]|$)|\/thank-you(?:[/?#]|$)/i, target: 'url', fixture: 'confirm_lever_thanks_url.txt' },
  { id: 'greenhouse_confirmation_url', re: /\/confirmation(?:[/?#]|$)/i, target: 'url', fixture: 'confirm_greenhouse_confirmation_url.txt' },
];

// Deny rules deliberately err in the safe direction: a false deny costs one
// human look at the manual-review list; a false confirm invents a submission.
export const DENY_PATTERNS = [
  { id: 'couldnt_submit', re: /could(?:n[’']t| ?not) submit|unable to submit/i, fixture: 'deny_directive_304.txt' },
  { id: 'already_applied', re: /already applied|already submitted an application/i, fixture: 'deny_directive_305.txt' },
  { id: 'needs_corrections', re: /needs corrections/i, fixture: 'deny_binti_needs_corrections.txt' },
  { id: 'missing_required_field', re: /missing entry for required field/i, fixture: 'deny_missing_required.txt' },
  { id: 'try_again', re: /try again/i, fixture: 'deny_try_again.txt' },
  { id: 'submission_error', re: /error (?:while )?submitting|submission failed/i, fixture: 'deny_error_submitting.txt' },
];

// Pure function. Missing/empty input is not an error — it is exactly the
// "page said nothing readable" case, and the honest answer to it is 'unknown'.
export function submissionVerdict({ bodyText, url } = {}) {
  const text = String(bodyText ?? '');
  const href = String(url ?? '');
  const hits = (rules) => rules
    .filter((rule) => rule.re.test(rule.target === 'url' ? href : text))
    .map((rule) => rule.id);
  const confirmHits = hits(CONFIRM_PATTERNS);
  const denyHits = hits(DENY_PATTERNS);

  let verdict = 'unknown';
  if (confirmHits.length > 0 && denyHits.length === 0) verdict = 'submitted';
  else if (denyHits.length > 0 && confirmHits.length === 0) verdict = 'not_submitted';
  return { verdict, confirmHits, denyHits };
}

// ---------------------------------------------------------------------------
// Evidence capture — 设计稿 §13.7（投递留证）/ §14.2 File List 的 captureEvidence 面。
// The file NAME is decided by code from the judged verdict, never by a bash
// string in a skill file — that is how six failure pages got named
// "..._success_...". And the shot is FULL PAGE after scrolling to the bottom:
// one-viewport shots caught the questions that matter in 2 of 50 historical
// screenshots (取证报告第四节：留证机制从一开始就没对准要留的东西).

export const EVIDENCE_PHASES = ['before_submit', 'after_submit'];
export const VERDICTS = ['submitted', 'not_submitted', 'unknown'];

const slug = (value, fallback) =>
  String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;

// Pure and exported so the naming contract is testable without a browser.
export function evidenceFileName({ company, jobId, phase, verdict, now = new Date() }) {
  if (!EVIDENCE_PHASES.includes(phase)) {
    throw new Error(`evidenceFileName: unknown phase "${phase}" (expected ${EVIDENCE_PHASES.join('|')})`);
  }
  const ts = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const base = `${slug(company, 'company')}_${slug(jobId, 'job')}_${ts}`;
  if (phase === 'before_submit') return `${base}_before_submit.png`;
  if (!VERDICTS.includes(verdict)) {
    throw new Error(`evidenceFileName: after_submit needs a judged verdict, got "${verdict}" — never name a file "success" on faith`);
  }
  return `${base}_after_${verdict}.png`;
}

// Default CDP runner: shells out to the screenshot funnel (shared/cdp.mjs),
// which itself locks whatever it writes. Throws on failure — a screenshot
// that silently did not happen is exactly the evidence gap this exists to fix.
async function defaultRunCdp(...args) {
  const { spawnSync } = await import('node:child_process');
  const cdpPath = join(dirname(fileURLToPath(import.meta.url)), 'cdp.mjs');
  const r = spawnSync(process.execPath, [cdpPath, ...args], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`cdp ${args[0]} failed (exit ${r.status}): ${(r.stderr || r.stdout || '').trim()}`);
  }
  return (r.stdout || '').trim();
}

// captureEvidence(tab, { company, jobId, phase, verdict?, home?, now? }, runCdp?)
//   before_submit: scroll to bottom → full-page shot → …_before_submit.png
//   after_submit : read page text/url → judge (unless a verdict is passed in
//                  by a caller that already judged) → full-page shot →
//                  …_after_<verdict>.png
// Returns { ok, phase, path, verdict, confirm_hits, deny_hits } — flat, so a
// bash caller can read .verdict straight off the JSON.
export async function captureEvidence(tab, opts = {}, runCdp = defaultRunCdp) {
  const { company, jobId, phase, home, now } = opts;
  if (!tab) throw new Error('captureEvidence: tab id required');
  if (!EVIDENCE_PHASES.includes(phase)) {
    throw new Error(`captureEvidence: unknown phase "${phase}" (expected ${EVIDENCE_PHASES.join('|')})`);
  }

  let verdict = opts.verdict ?? null;
  let confirmHits = [];
  let denyHits = [];
  if (phase === 'after_submit' && !verdict) {
    const raw = await runCdp('eval', tab,
      'JSON.stringify({ bodyText: document.body.innerText.slice(0, 20000), url: location.href })');
    let page;
    try {
      page = JSON.parse(raw);
    } catch {
      page = { bodyText: '', url: '' }; // unreadable page = no evidence either way → unknown
    }
    const judged = submissionVerdict(page);
    verdict = judged.verdict;
    confirmHits = judged.confirmHits;
    denyHits = judged.denyHits;
  }
  if (phase === 'after_submit' && !VERDICTS.includes(verdict)) {
    throw new Error(`captureEvidence: caller-supplied verdict "${verdict}" is not one of ${VERDICTS.join('|')}`);
  }

  const stateHome = home || (await import('./paths.mjs')).atsHome();
  const dir = join(stateHome, 'log', 'screenshots');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  lockDir(dir);

  const path = join(dir, evidenceFileName({ company, jobId, phase, verdict, ...(now ? { now } : {}) }));
  await runCdp('screenshot', tab, path, '--full-page');
  lockFile(path); // cdp locks at the write; this covers injected runners too

  return {
    ok: true,
    phase,
    path,
    verdict: phase === 'after_submit' ? verdict : null,
    confirm_hits: confirmHits,
    deny_hits: denyHits,
  };
}

// CLI（三份 -auto 技能说明书的截图段就换成这一行）:
//   node shared/submission_evidence.mjs --tab <tab> --company <name> --job <row> --phase before_submit|after_submit
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  const argValue = (name) => {
    const idx = process.argv.indexOf(name);
    return idx >= 0 ? process.argv[idx + 1] : null;
  };
  const tab = argValue('--tab');
  const phase = argValue('--phase');
  if (!tab || !phase) {
    console.error('usage: node shared/submission_evidence.mjs --tab <tabId> --company <name> --job <rowId> --phase before_submit|after_submit');
    process.exit(2);
  }
  try {
    const result = await captureEvidence(tab, {
      company: argValue('--company'),
      jobId: argValue('--job'),
      phase,
    });
    console.log(JSON.stringify(result));
  } catch (e) {
    console.error(`[submission_evidence] ${e.message}`);
    process.exit(1);
  }
}
