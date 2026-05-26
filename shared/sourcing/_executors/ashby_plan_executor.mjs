#!/usr/bin/env node
// ashby_plan_executor.mjs — execute the action plan returned by Ashby.fillForm()
//
// Ashby's React app rejects synthetic InputEvents on text fields, so text/upload
// MUST go through cdp.mjs (real CDP Input.insertText / DOM.setFileInputFiles).
// Select/yesno can run in-page via the injected Ashby helpers.
//
// Spawned per row by the mrweirdo-onboard Step 10 dispatch loop when
// ats_platform == 'ashby'. One process per row keeps blast radius small.
//
// CLI:
//   node ashby_plan_executor.mjs <tabId> <plan.json>
//
// Returns JSON on stdout:
//   { ok: true|false, executed: [...labels], skipped: [...{label, reason}], errors: [...] }

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CDP_BIN = pathResolve(__dirname, '../../cdp.mjs');

function runCdp(args, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn('node', [CDP_BIN, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, error: `cdp timeout after ${timeoutMs}ms`, stderr: err });
    }, timeoutMs);
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ ok: false, exitCode: code, stdout: out.trim(), stderr: err.trim() });
      } else {
        resolve({ ok: true, stdout: out.trim() });
      }
    });
  });
}

async function typetext(tabId, selector, value) {
  return runCdp(['typetext', tabId, selector, value]);
}

async function upload(tabId, selector, filePath) {
  const r = await runCdp(['upload', tabId, selector, filePath]);
  if (!r.ok) return r;
  // After CDP setFileInputFiles, React-form-state apps (Ashby) don't observe
  // the change. Manually dispatch a synthetic change event so React updates state.
  const nudge = await runCdp(['eval', tabId, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, error: 'selector_gone' };
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, files: el.files ? el.files.length : 0, name: el.files && el.files[0] ? el.files[0].name : null };
  })()`]);
  return { ok: true, upload: r, nudge };
}

async function pickSelect(tabId, fieldId, optionText) {
  // Ashby.pickSelect runs in-page via the helpers already injected by the
  // greenhouse-auto-style helper injection step. Caller must have already done
  // that step (otherwise Ashby.pickSelect won't be defined).
  const js = `(async () => { try { return await Ashby.pickSelect(${JSON.stringify(fieldId)}, ${JSON.stringify(optionText)}); } catch (e) { return { ok: false, error: e.message }; } })()`;
  return runCdp(['eval', tabId, js]);
}

async function setDate(tabId, fieldId, mmddyyyy) {
  const js = `(() => { try { return Ashby.setDate(${JSON.stringify(fieldId)}, ${JSON.stringify(mmddyyyy)}); } catch (e) { return { ok: false, error: e.message }; } })()`;
  return runCdp(['eval', tabId, js]);
}

async function clickYesNo(tabId, uuid, answer) {
  // The fillForm output gives us a checkbox name (the uuid) but not the actual
  // Yes/No button selectors. Re-discover them at execute time by walking up
  // ancestors looking for buttons with text "Yes"/"No". See ashby_helpers.js
  // lines 791-822 for the same heuristic used at plan time.
  const js = `(() => {
    const cb = document.querySelector('input[type=checkbox][name=' + JSON.stringify(${JSON.stringify(uuid)}) + ']');
    if (!cb) return { ok: false, error: 'checkbox_not_found', uuid: ${JSON.stringify(uuid)} };
    let container = cb.parentElement;
    let yesBtn = null, noBtn = null;
    for (let i = 0; i < 6 && container && (!yesBtn || !noBtn); i++) {
      const btns = container.querySelectorAll('button');
      for (const b of btns) {
        const t = (b.innerText || '').trim();
        if (t === 'Yes') yesBtn = b;
        if (t === 'No') noBtn = b;
      }
      container = container.parentElement;
    }
    const target = ${JSON.stringify(answer)} === 'Yes' ? yesBtn : noBtn;
    if (!target) return { ok: false, error: 'no_button_for_answer', wanted: ${JSON.stringify(answer)} };
    target.click();
    return { ok: true, clicked: ${JSON.stringify(answer)} };
  })()`;
  return runCdp(['eval', tabId, js]);
}

export async function executePlan(tabId, plan) {
  const executed = [];
  const skipped = [];
  const errors = [];

  for (const step of plan) {
    const label = step.label || step.action;
    try {
      // Skip steps the planner couldn't resolve (no answer derived from profile).
      if (step.value === null || step.value === undefined) {
        skipped.push({ label, reason: step.note || 'no_value' });
        continue;
      }

      let res;
      switch (step.action) {
        case 'typetext':
          res = await typetext(tabId, step.selector, String(step.value));
          break;
        case 'upload':
          res = await upload(tabId, step.selector, String(step.value));
          break;
        case 'select':
          res = await pickSelect(tabId, step.fieldId, String(step.value));
          break;
        case 'date':
          res = await setDate(tabId, step.fieldId, String(step.value));
          break;
        case 'yesno':
          res = await clickYesNo(tabId, step.uuid, String(step.value));
          break;
        default:
          skipped.push({ label, reason: 'unknown_action:' + step.action });
          continue;
      }

      if (res.ok) {
        executed.push(label);
      } else {
        errors.push({ label, action: step.action, error: res.error || res.stderr || `exit ${res.exitCode}` });
      }

      // Small inter-action pause — Ashby's react-hook-form sometimes drops
      // events when several actions land in the same tick.
      await new Promise((r) => setTimeout(r, 120));
    } catch (e) {
      errors.push({ label, action: step.action, error: e.message });
    }
  }

  return { ok: errors.length === 0, executed, skipped, errors };
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const [, , tabId, planPath] = process.argv;
    if (!tabId || !planPath) {
      console.error('Usage: ashby_plan_executor.mjs <tabId> <plan.json>');
      process.exit(2);
    }
    const planRaw = JSON.parse(readFileSync(planPath, 'utf8'));
    const plan = Array.isArray(planRaw) ? planRaw : planRaw.plan;
    if (!Array.isArray(plan)) {
      console.error('plan.json must be an array or {plan: [...]}');
      process.exit(2);
    }
    const result = await executePlan(tabId, plan);
    process.stdout.write(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  })();
}
