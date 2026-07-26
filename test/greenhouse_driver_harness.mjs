// Loads the REAL Greenhouse driver for tests — not a re-implementation of it.
//
// Why a harness: greenhouse_apply_driver.mjs is a CLI entry point (it reads
// profile.json and argv at import time and calls main() at the bottom), so it
// cannot simply be imported. The harness takes the shipped source verbatim,
// strips ONLY the `main().catch(...)` invocation, and renames the six functions
// that touch the browser (findFieldByLabel / reactSelect / reactSelectOneOf /
// selectNativeOneOf / cdp / evalInTab) so stubs can take their place. Every
// decision under test — label routing, the three-state work-auth branches, the
// location/relocation branches, the blocking guards — is the driver's own code,
// byte for byte.
//
// Extracted from test/greenhouse_work_auth_driver.test.mjs on 2026-07-26 so the
// relocation guard could drive the same shipped code. A second copy of this
// harness would go stale silently the first time the driver's browser boundary
// changed, and only one of the two copies would notice.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = join(ROOT, 'shared');
const DRIVER_SRC = readFileSync(join(SHARED, 'greenhouse_apply_driver.mjs'), 'utf8');

// The only functions the harness replaces: the browser boundary.
const BROWSER_FNS = ['findFieldByLabel', 'reactSelectOneOf', 'reactSelect', 'selectNativeOneOf', 'cdp', 'evalInTab'];

const STUBS = `
// ---- test harness: browser boundary only ----------------------------------
async function findFieldByLabel(tab, labelText) {
  // Greenhouse renders these custom questions as react-select comboboxes.
  return { ok: true, id: 'question_1', type: 'select-one', is_react_select: true };
}
async function reactSelect(tab, id, value, opts = {}) {
  globalThis.__MRW_FILLS.push({ via: 'reactSelect', value });
  return { ok: true, picked: value };
}
async function reactSelectOneOf(tab, id, values, opts = {}) {
  globalThis.__MRW_FILLS.push({ via: 'reactSelectOneOf', value: values[0], candidates: values });
  return { ok: true, picked: values[0] };
}
async function selectNativeOneOf(tab, id, values) {
  globalThis.__MRW_FILLS.push({ via: 'selectNativeOneOf', value: values[0], candidates: values });
  return { ok: true, picked: values[0] };
}
function cdp(...args) {
  globalThis.__MRW_FILLS.push({ via: 'cdp', args });
  return { stdout: '{"ok":true}', stderr: '' };
}
async function evalInTab(tab, js) { return { ok: false }; }
export { answerMissing };
`;

let seq = 0;

// Loads the shipped driver against `profile` in a throwaway fake home. No
// ~/.mrweirdo-jobs access, no browser, no network.
export async function loadDriver(profile) {
  const home = mkdtempSync(join(tmpdir(), 'mrw-gh-driver-'));
  writeFileSync(join(home, 'profile.json'), JSON.stringify(profile, null, 2));
  let src = DRIVER_SRC.replace(/\nmain\(\)\.catch\([\s\S]*$/, '\n');
  for (const fn of BROWSER_FNS) {
    const decl = `function ${fn}(`;
    assert.ok(src.includes(decl), `harness stale: ${decl} not found in the driver`);
    src = src.replace(decl, `function __unused_${fn}(`);
  }
  src = src.replace(/from '\.\//g, `from '${SHARED}/`) + STUBS;
  const file = join(home, `driver_under_test_${seq++}.mjs`);
  writeFileSync(file, src);

  const prevHome = process.env.MRWEIRDO_HOME;
  const prevRepo = process.env.MRWEIRDO_REPO_ROOT;
  const prevArgv = process.argv.slice();
  process.env.MRWEIRDO_HOME = home;
  process.env.MRWEIRDO_REPO_ROOT = ROOT; // use the REAL shipped answer_bank.json
  process.argv[2] = 'https://job-boards.greenhouse.io/testco/jobs/1';
  try {
    return await import(file);
  } finally {
    if (prevHome === undefined) delete process.env.MRWEIRDO_HOME; else process.env.MRWEIRDO_HOME = prevHome;
    if (prevRepo === undefined) delete process.env.MRWEIRDO_REPO_ROOT; else process.env.MRWEIRDO_REPO_ROOT = prevRepo;
    process.argv = prevArgv;
  }
}

// Asks the shipped driver one real form question. Returns its decision plus
// everything it tried to put on the form.
export async function ask(profile, label) {
  const { answerMissing } = await loadDriver(profile);
  globalThis.__MRW_FILLS = [];
  const res = await answerMissing('tab-1', label);
  return { res, fills: globalThis.__MRW_FILLS.slice() };
}

// A minimal profile with nothing to say about work authorization or relocation.
export const BASE = {
  personal: {
    first_name: 'Test', last_name: 'User', email: 't@example.com', phone: '+1 555 0100',
    address_city: 'Boston', address_state: 'MA', address_country: 'United States',
    linkedin: 'https://linkedin.com/in/test',
  },
  education: { school: 'Babson College', major: 'Business Analytics', degree: "Bachelor's degree", graduation_date: '2027-05' },
};
