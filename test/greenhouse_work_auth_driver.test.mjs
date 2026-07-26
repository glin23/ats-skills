// Exercises the REAL Greenhouse driver decision path for work-authorization
// questions — not a re-implementation of it.
//
// Why a harness: greenhouse_apply_driver.mjs is a CLI entry point (it reads
// profile.json and argv at import time and calls main() at the bottom), so it
// cannot simply be imported. The harness takes the shipped source verbatim,
// strips ONLY the `main().catch(...)` invocation, and renames the six functions
// that touch the browser (findFieldByLabel / reactSelect / reactSelectOneOf /
// selectNativeOneOf / cdp / evalInTab) so stubs can take their place. Every
// decision under test — label routing, the three-state work-auth branches, the
// blocking guard — is the driver's own code, byte for byte.
//
// The defect this locks (2026-07-25): the driver answered "Are you legally
// authorized to work in the US?" from a SHARED answer-bank default ("Yes"),
// never from the user's profile. 88% of the eligible-but-unapplied queue is on
// Greenhouse, so this was the majority of the fabrication surface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
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
async function loadDriver(profile) {
  const home = mkdtempSync(join(tmpdir(), 'mrw-gh-workauth-'));
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

const BASE = {
  personal: {
    first_name: 'Test', last_name: 'User', email: 't@example.com', phone: '+1 555 0100',
    address_city: 'Boston', address_state: 'MA', address_country: 'United States',
    linkedin: 'https://linkedin.com/in/test',
  },
  education: { school: 'Babson College', major: 'Business Analytics', degree: "Bachelor's degree", graduation_date: '2027-05' },
};
const withAuth = (work_authorization) => ({ ...BASE, work_authorization });

// Real Greenhouse question labels.
const AUTH_LABEL = 'Are you legally authorized to work in the United States?';
const SPONSOR_LABEL = 'Do you require visa sponsorship for employment?';
const FUTURE_SPONSOR_LABEL = 'Will you now or in the future require sponsorship for employment visa status?';

async function ask(profile, label) {
  const { answerMissing } = await loadDriver(profile);
  globalThis.__MRW_FILLS = [];
  const res = await answerMissing('tab-1', label);
  return { res, fills: globalThis.__MRW_FILLS.slice() };
}

test('greenhouse driver: explicitly NOT authorized -> the form gets "No", never "Yes"', async () => {
  const notAuthorized = withAuth({
    visa_status: 'F-1 (no CPT/OPT yet)',
    authorized_to_work_us: false,
    requires_sponsorship_now: true,
    requires_sponsorship_future: true,
  });
  const auth = await ask(notAuthorized, AUTH_LABEL);
  assert.equal(auth.res.ok, true, `work-auth question should be answered from the profile: ${JSON.stringify(auth.res)}`);
  assert.equal(auth.fills.at(-1)?.value, 'No', `a user who said "I am NOT authorized" must not have "Yes" typed on the form: ${JSON.stringify(auth.fills)}`);

  const sponsor = await ask(notAuthorized, SPONSOR_LABEL);
  assert.equal(sponsor.fills.at(-1)?.value, 'Yes');
});

test('greenhouse driver: authorized + no sponsorship needed (US citizen shape)', async () => {
  const citizen = withAuth({
    visa_status: 'US citizen',
    authorized_to_work_us: true,
    requires_sponsorship_now: false,
    requires_sponsorship_future: false,
  });
  assert.equal((await ask(citizen, AUTH_LABEL)).fills.at(-1)?.value, 'Yes');
  assert.equal(
    (await ask(citizen, SPONSOR_LABEL)).fills.at(-1)?.value,
    'No',
    'a citizen must not be reported as needing visa sponsorship',
  );
  assert.equal((await ask(citizen, FUTURE_SPONSOR_LABEL)).fills.at(-1)?.value, 'No');
});

test('greenhouse driver: F-1 OPT (the current real user) is unchanged -> Yes / Yes', async () => {
  const f1opt = withAuth({
    visa_status: 'F-1 OPT eligible',
    authorized_to_work_us: true,
    requires_sponsorship_now: false,
    requires_sponsorship_future: true,
  });
  assert.equal((await ask(f1opt, AUTH_LABEL)).fills.at(-1)?.value, 'Yes');
  assert.equal((await ask(f1opt, SPONSOR_LABEL)).fills.at(-1)?.value, 'Yes');
  assert.equal((await ask(f1opt, FUTURE_SPONSOR_LABEL)).fills.at(-1)?.value, 'Yes');
});

test('greenhouse driver: never asked -> blocks the row and fills NOTHING', async () => {
  const neverAsked = [
    withAuth({}),                                                              // block present, all keys missing
    { ...BASE },                                                               // no work_authorization block at all
    withAuth({ visa_status: null, authorized_to_work_us: null, requires_sponsorship_now: null, requires_sponsorship_future: null }),
  ];
  for (const profile of neverAsked) {
    const auth = await ask(profile, AUTH_LABEL);
    assert.equal(auth.res.ok, false, `unknown authorization must not resolve to an answer: ${JSON.stringify(auth.res)}`);
    assert.equal(auth.res.needs_user_answer, true, 'the row must be surfaced as needing the user, not filled');
    assert.equal(auth.res.note, 'work_authorization_required');
    assert.deepEqual(auth.fills, [], `nothing may be typed or selected on the form: ${JSON.stringify(auth.fills)}`);

    for (const label of [SPONSOR_LABEL, FUTURE_SPONSOR_LABEL]) {
      const sponsor = await ask(profile, label);
      assert.equal(sponsor.res.ok, false, `unknown sponsorship need must block: ${label}`);
      assert.equal(sponsor.res.needs_user_answer, true);
      assert.equal(sponsor.res.note, 'sponsorship_future_required');
      assert.deepEqual(sponsor.fills, []);
    }
  }
});

test('greenhouse driver: the work-auth answer is not a constant function of the profile', async () => {
  const profiles = [
    withAuth({ authorized_to_work_us: true, requires_sponsorship_future: true }),
    withAuth({ authorized_to_work_us: false, requires_sponsorship_future: true }),
    withAuth({ authorized_to_work_us: true, requires_sponsorship_future: false }),
    withAuth({}),
    { ...BASE },
  ];
  const outcomes = [];
  for (const p of profiles) {
    const { res, fills } = await ask(p, AUTH_LABEL);
    outcomes.push(res.ok ? `fill:${fills.at(-1)?.value}` : `block:${res.note}`);
  }
  assert.ok(
    new Set(outcomes).size >= 3,
    `work-auth answer collapsed to a near-constant: ${outcomes.join(' | ')}`,
  );
  assert.equal(
    outcomes.every((o) => o === 'fill:Yes'),
    false,
    'the driver still answers "Yes" for every profile shape',
  );
});
