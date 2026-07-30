// Loads the REAL Ashby driver for tests — not a re-implementation of it.
// Sibling of test/greenhouse_driver_harness.mjs, same rules and same reasons.
//
// ashby_apply_driver.mjs is a CLI entry point (it reads profile.json and argv at
// import time and calls main() at the bottom), so it cannot simply be imported.
// The harness takes the shipped source verbatim, strips ONLY the `main().catch(...)`
// invocation, and renames the two functions that touch the browser (cdp /
// evalInTab) so stubs can take their place.
//
// It also exposes ONE statement out of main(): the line that turns a blocked
// question into an entry on the pending list. That line is lifted from the
// shipped source verbatim at load time — never retyped here — because it is
// the line under test, and a copy of it would prove nothing about the product.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = join(ROOT, 'shared');
const DRIVER_SRC = readFileSync(join(SHARED, 'ashby_apply_driver.mjs'), 'utf8');

// The only functions the harness replaces: the browser boundary.
const BROWSER_FNS = ['cdp', 'evalInTab'];

// The shipped line that builds a pending entry, taken from main() as-is.
const PENDING_LINE = DRIVER_SRC.split('\n').find((l) => l.includes('addPendingQuestion(pendingForMainClaude,'));
assert.ok(PENDING_LINE, 'harness stale: no addPendingQuestion(pendingForMainClaude, ...) call in the driver');

const STUBS = `
// ---- test harness: browser boundary only ----------------------------------
function cdp(...args) {
  globalThis.__MRW_CDP.push(args);
  return { stdout: '{"ok":true}', stderr: '' };
}
async function evalInTab(tab, js) { return globalThis.__MRW_EVAL_RESULT ?? { ok: false }; }
export { answerMissing, addPendingQuestion, submitAndCheck };

// The shipped pending-list statement, verbatim, with the three variables main()
// has in scope at that point bound as arguments.
export function shippedPendingItems(a, m, sel) {
  const pendingForMainClaude = [];
${PENDING_LINE}
  return pendingForMainClaude;
}
`;

let seq = 0;

// Loads the shipped driver against `profile` in a throwaway fake home. No
// ~/.mrweirdo-jobs access, no browser, no network.
export async function loadDriver(profile) {
  const home = mkdtempSync(join(tmpdir(), 'mrw-ashby-driver-'));
  writeFileSync(join(home, 'profile.json'), JSON.stringify(profile, null, 2));
  let src = DRIVER_SRC.replace(/\nmain\(\)\.catch\([\s\S]*$/, '\n');
  // No real waits under test: submitAndCheck alone sleeps 7s per call in the
  // shipped code. Guarded like PENDING_LINE — if the declaration drifts, this
  // fails loudly instead of silently re-slowing the suite.
  const SLEEP_DECL = 'const sleep = (ms) => new Promise((r) => setTimeout(r, ms));';
  assert.ok(src.includes(SLEEP_DECL), 'harness stale: sleep declaration not found in the driver');
  src = src.replace(SLEEP_DECL, 'const sleep = () => Promise.resolve();');
  for (const fn of BROWSER_FNS) {
    const decl = `function ${fn}(`;
    assert.ok(src.includes(decl), `harness stale: ${decl} not found in the driver`);
    src = src.replace(decl, `function __unused_${fn}(`);
  }
  src = src.replace(/from '\.\//g, `from '${SHARED}/`) + STUBS;
  const file = join(home, `ashby_under_test_${seq++}.mjs`);
  writeFileSync(file, src);

  const prevHome = process.env.MRWEIRDO_HOME;
  const prevRepo = process.env.MRWEIRDO_REPO_ROOT;
  const prevArgv = process.argv.slice();
  process.env.MRWEIRDO_HOME = home;
  process.env.MRWEIRDO_REPO_ROOT = ROOT; // use the REAL shipped answer_bank.json
  process.argv[2] = 'https://jobs.ashbyhq.com/testco/00000000-0000-0000-0000-000000000000';
  globalThis.__MRW_CDP = [];
  try {
    return await import(file);
  } finally {
    if (prevHome === undefined) delete process.env.MRWEIRDO_HOME; else process.env.MRWEIRDO_HOME = prevHome;
    if (prevRepo === undefined) delete process.env.MRWEIRDO_REPO_ROOT; else process.env.MRWEIRDO_REPO_ROOT = prevRepo;
    process.argv = prevArgv;
  }
}

// Asks the shipped driver one real form question, then runs the shipped
// pending-list line on its answer exactly as main() does when the driver has
// found the field. Returns both the decision and the resulting pending entry.
export async function askAndQueue(profile, label, sel = { sel: '#q_1', tag: 'input' }) {
  const { answerMissing, shippedPendingItems } = await loadDriver(profile);
  const res = await answerMissing('tab-1', label);
  const pending = res?.pending_for_main_claude ? shippedPendingItems(res, label, sel) : [];
  return { res, pending };
}

// A minimal profile with nothing to say about residence, transport or work
// authorization — i.e. exactly the person the driver must ask instead of guess.
export const BASE = {
  personal: {
    first_name: 'Test', last_name: 'User', email: 't@example.com', phone: '+1 555 0100',
    address_city: 'Boston', address_state: 'MA', address_country: 'United States',
    linkedin: 'https://linkedin.com/in/test',
  },
  education: { school: 'Babson College', major: 'Business Analytics', degree: "Bachelor's degree", graduation_date: '2027-05' },
};
