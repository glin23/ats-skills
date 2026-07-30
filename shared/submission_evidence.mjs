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
