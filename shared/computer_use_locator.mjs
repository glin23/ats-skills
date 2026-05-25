#!/usr/bin/env node
/**
 * Computer Use Visual Locator (v0.5)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IMPORTANT ARCHITECTURE NOTE
 * ─────────────────────────────────────────────────────────────────────────
 * This module does NOT call Computer Use MCP tools directly. It cannot —
 * `mcp__computer-use__*` only exists inside a Claude Code session, not in
 * a spawned Node process. The actual vision calls (screenshot, left_click,
 * type) are issued by Claude as it follows the SKILL.md flow.
 *
 * This file is the bookkeeping / glue layer between CDP and the orchestrator
 * Claude. Responsibilities:
 *   (a) Capture a screenshot frame to disk via cdp.mjs (so Claude can read
 *       the exact same frame the CDP main loop was looking at)
 *   (b) Build vision prompts for Claude to follow
 *   (c) Decide whether to escalate to vision (cap attempts, only on required)
 *   (d) Append structured telemetry to ~/.mrweirdo-jobs/log/locator.jsonl
 *   (e) Produce a "fill plan" of MCP actions for caller Claude to execute
 *       when no CSS selector can be derived from vision (coord-based fill)
 *
 * Flow:
 *   1. mrweirdo-{platform} helper runs fillForm + findEmptyRequired
 *   2. Some required fields come back unidentified (no selector match)
 *   3. Helper calls shouldEscalateToVision(unidentified) — gated, capped
 *   4. Helper calls captureFrame(tabId) to write /tmp/mrweirdo-jobs/locator-frame.png
 *   5. Helper calls buildVisionPrompt(field) and returns it to SKILL.md
 *   6. SKILL.md flow: Claude reads prompt, calls mcp__computer-use__screenshot,
 *      analyzes, returns { selector?, x?, y?, confidence }
 *   7. If selector → fall back through cdp.mjs typetext (fast path)
 *      If only coords → use fillViaCoordsPlan() to get an MCP action sequence
 *      that Claude executes via left_click + type
 *   8. Helper calls logAttempt() to record outcome
 *   9. Control returns to CDP main loop for remaining fields
 *
 * Hard limits:
 *   - Max 3 vision attempts per form (MAX_VISION_ATTEMPTS_PER_FORM)
 *   - Only escalate when ≥ 1 unidentified field has required=true
 *   - On 3rd failure → log + skip form, never crash batch
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- constants ----------

export const MAX_VISION_ATTEMPTS_PER_FORM = 3;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_DIR = join(homedir(), '.mrweirdo-jobs', 'log');
const LOG_FILE = join(LOG_DIR, 'locator.jsonl');
const FRAME_DIR = '/tmp/mrweirdo-jobs';
const FRAME_PATH = join(FRAME_DIR, 'locator-frame.png');

// Ensure dirs at import time (idempotent)
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
if (!existsSync(FRAME_DIR)) mkdirSync(FRAME_DIR, { recursive: true });

// ---------- public API ----------

/**
 * captureFrame(tabId, opts?) → { ok, path } | { ok:false, error }
 *
 * Synchronously spawns `node cdp.mjs screenshot <tabId> <path>` so Claude
 * (running in the parent session) can read the exact same DOM frame the
 * CDP loop was looking at when fields came back unidentified.
 *
 * @param {string} tabId - CDP tab id
 * @param {object} [opts]
 * @param {string} [opts.cdpPath] - path to cdp.mjs (default: sibling file)
 * @param {string} [opts.outPath] - where to write PNG (default: FRAME_PATH)
 */
export function captureFrame(tabId, opts = {}) {
  const cdpPath = opts.cdpPath || join(__dirname, 'cdp.mjs');
  const outPath = pathResolve(opts.outPath || FRAME_PATH);
  if (!tabId) return { ok: false, error: 'tabId required' };
  try {
    execFileSync('node', [cdpPath, 'screenshot', tabId, outPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
    });
    return { ok: true, path: outPath };
  } catch (e) {
    return { ok: false, error: e.stderr?.toString?.() || e.message || String(e) };
  }
}

/**
 * shouldEscalateToVision(unidentifiedFields, attemptCount) → { ok, ... }
 *
 * Decide whether the vision fallback should run. Caps at 3 attempts/form,
 * and only escalates when at least one unidentified field is required.
 *
 * @param {Array<{label:string, type?:string, required?:boolean, currentValue?:string}>} unidentifiedFields
 * @param {number} [attemptCount=0]
 * @returns {{ok:true, fieldsToLocate:Array}|{ok:false, reason:string}}
 */
export function shouldEscalateToVision(unidentifiedFields = [], attemptCount = 0) {
  if (!Array.isArray(unidentifiedFields)) {
    return { ok: false, reason: 'unidentifiedFields must be an array' };
  }
  if (attemptCount >= MAX_VISION_ATTEMPTS_PER_FORM) {
    return { ok: false, reason: `max attempts reached (${MAX_VISION_ATTEMPTS_PER_FORM})` };
  }
  const required = unidentifiedFields.filter(f => f && f.required === true);
  if (required.length === 0) {
    return { ok: false, reason: 'no required fields unidentified' };
  }
  return { ok: true, fieldsToLocate: required };
}

/**
 * buildVisionPrompt(field, pageContext?) → string
 *
 * Builds a markdown prompt that the SKILL.md flow hands to Claude. Claude
 * then invokes mcp__computer-use__screenshot, locates the field visually,
 * and returns a JSON result.
 *
 * @param {{label:string, type?:string, required?:boolean, currentValue?:string}} field
 * @param {{url?:string, atsPlatform?:string, formTitle?:string}} [pageContext]
 */
export function buildVisionPrompt(field, pageContext = {}) {
  const { url, atsPlatform, formTitle } = pageContext;
  const ctxLines = [];
  if (atsPlatform) ctxLines.push(`- **ATS**: ${atsPlatform}`);
  if (url) ctxLines.push(`- **URL**: ${url}`);
  if (formTitle) ctxLines.push(`- **Form**: ${formTitle}`);
  const ctxBlock = ctxLines.length ? `\n${ctxLines.join('\n')}\n` : '';

  return `## Visual Field Locator Task
${ctxBlock}
You need to find a form field on the current page screenshot.

**Field label**: "${field.label}"
**Field type**: ${field.type || 'unknown'}
**Required**: ${field.required ? 'yes' : 'no'}
**Currently filled**: "${field.currentValue || '(empty)'}"

A frame has already been written to:
  ${FRAME_PATH}

Steps:
1. Call \`mcp__computer-use__screenshot\` to capture the current page (or read the saved frame).
2. Locate the input element matching the field label above. Match on visible
   label text, surrounding context, and proximity — not just exact string.
3. If you can see distinctive DOM attributes via the actual page (aria-label,
   placeholder, name), prefer returning a CSS selector — CDP can refill it
   ~50× faster than coord-based clicks.

Return strict JSON with this shape (no prose):

\`\`\`json
{
  "selector": "input[aria-label='Phone number']" | null,
  "x": 642,
  "y": 318,
  "confidence": 0.85,
  "notes": "found below 'Phone' label, left column"
}
\`\`\`

- \`selector\` — best CSS/ARIA selector if derivable, else null
- \`x\`, \`y\` — pixel center of the input (required even if selector present;
  used as last-resort if selector misses)
- \`confidence\` — 0–1 (below 0.5 → caller skips and logs)
`.trim();
}

/**
 * fillViaCoordsPlan(x, y, text) → Array<MCPAction>
 *
 * Last-resort fill path when vision returns coords but no usable selector.
 * Returns an action plan the caller Claude executes via mcp__computer-use__*
 * tools. NOT executed here (this script can't call MCP).
 *
 * Plan shape:
 *   [{ action: 'left_click', x, y },
 *    { action: 'wait', ms },
 *    { action: 'type', text }]
 */
export function fillViaCoordsPlan(x, y, text) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('fillViaCoordsPlan: x and y must be finite numbers');
  }
  if (typeof text !== 'string') {
    throw new Error('fillViaCoordsPlan: text must be a string');
  }
  return [
    { action: 'left_click', x, y },
    { action: 'wait', ms: 300 },
    { action: 'type', text },
  ];
}

/**
 * logAttempt(entry) → void
 *
 * Append a single locator attempt to ~/.mrweirdo-jobs/log/locator.jsonl.
 * Used for telemetry: what labels need vision most, hit-rate, confidence,
 * cost (each call is several seconds + tokens).
 *
 * @param {{fieldLabel?:string, strategy?:string, result?:string,
 *          confidence?:number, attempt?:number, formId?:string,
 *          ats?:string, error?:string}} entry
 */
export function logAttempt(entry = {}) {
  const row = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  appendFileSync(LOG_FILE, row + '\n');
}

// ---------- exports for paths (handy for SKILL.md docs/tests) ----------

export const PATHS = Object.freeze({
  LOG_DIR,
  LOG_FILE,
  FRAME_DIR,
  FRAME_PATH,
});
