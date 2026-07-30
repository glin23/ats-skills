// personal_fact_gate.mjs — the one thing checked before a batch opens a tab.
//
// Pure functions, no IO, no imports that touch the filesystem. Safe to call from
// supervisor_preflight and from apply_batch's dry-run path.
//
// What this gate judges (ADR-11, 关卡 7): 「引导那三个身份问题问过没问过」——
// NOT "are these cells filled in". The old predicate ("both booleans present")
// was built on a reversed premise: it assumed a student needs his work permit
// BEFORE applying, when in fact the permit comes after the offer. A normal F-1
// student who answered every question he can answer still had two null booleans,
// so the old gate held the whole batch shut for him forever. Measured on 72 real
// submissions x 263 real form questions: those missing cells actually block
// 4/72 = 5.6% of rows (22.2% worst case), while the old gate blocked 100%.
//
// The criterion for a pre-batch gate now has TWO necessary conditions (ADR-11):
// ① absence blocks >= 80% of rows AND ② the user can settle it in one sentence.
// Work authorization fails both (5.6%, and for the normal student the fact does
// not exist yet), so NO fact qualifies for a value-gate today. What remains is
// an onboarding-completeness check: it closes exactly once — when the funnel
// never ran at all (a profile copied from the template) — and is永远 open for
// anyone who finished onboarding, whatever they answered. Unanswerable cells
// stop only the rows that actually ask that question; they never stop a batch.
//
// This gate probes no form. It only asserts, in code, that onboarding step A0
// actually happened — which is the difference between an instruction to a model
// and an assertion.
import { QUESTION_TEMPLATES } from './missing_field_questions.mjs';
import {
  BLOCKED_BECAUSE, FORM_ANSWER_POLICIES, VISA_STATUS, WHAT_HAPPENS_NEXT,
} from './work_auth_identity.mjs';

const GATE_CATEGORY = 'user_work_authorization';

// Sources that mean "a person was asked and answered", as opposed to "it was
// already on disk" or "we read it off a resume". Only the first kind proves the
// funnel ran — resume_inferred / legacy_unverified / unknown do not, because
// nobody put the question to him.
const FUNNEL_SOURCES = new Set(['user_answer', 'onboarding_a0']);

// The cells the funnel is allowed to write (work_auth_identity.WORK_AUTH_PATHS).
// Any strictly-typed value in one of them is evidence the funnel ran: the three
// booleans only ever hold true/false when someone answered (the template ships
// null), the two enums are only writable through record_profile_answers.mjs,
// which rejects anything outside the enum. Strings like "true"/"Yes" and free
// text are NOT evidence — they are what a hand-edit or a resume inference looks
// like, and coercing them would put a claim about immigration status on a form.
const VISA_STATUS_VALUES = new Set(Object.values(VISA_STATUS));
const POLICY_VALUES = new Set(Object.values(FORM_ANSWER_POLICIES));
const FUNNEL_EVIDENCE = [
  ['work_authorization.authorized_to_work_us', (v) => typeof v === 'boolean'],
  ['work_authorization.requires_sponsorship_now', (v) => typeof v === 'boolean'],
  ['work_authorization.requires_sponsorship_future', (v) => typeof v === 'boolean'],
  ['work_authorization.form_answer_policy', (v) => POLICY_VALUES.has(v)],
  ['work_authorization.visa_status', (v) => VISA_STATUS_VALUES.has(v)],
];

/** The paths the gate names when it closes (i.e. when the funnel never ran).
 *  Their absence does NOT stop a batch by itself — ADR-11. Declared by the
 *  question template so the gate can never ask for something the write-back
 *  command cannot store. */
export const GATED_PATHS = QUESTION_TEMPLATES[GATE_CATEGORY].gate_paths;

function valueAtPath(profile, path) {
  let node = profile;
  for (const key of path.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[key];
  }
  return node;
}

function remediationCommand(missingPaths) {
  const answers = {};
  for (const path of missingPaths) answers[path] = '<true|false>';
  // visa_status is not gated (an empty string is a legitimate "did not say"),
  // but a user answering this question always knows it, and having it on file
  // keeps the drivers from re-deriving it from the booleans. It is a fixed enum
  // since ADR-12 — his own sentence goes to `_user_words`, never here — so a
  // hand-run command and the funnel put the same strings on disk.
  answers['work_authorization.visa_status'] = `<${Object.values(VISA_STATUS).join(' | ')}>`;
  return [
    'node shared/record_profile_answers.mjs',
    `--json '${JSON.stringify(answers)}'`,
    `--source user_answer --category ${GATE_CATEGORY} --asked-by queue_gate`,
  ].join(' ');
}

/**
 * @param {object} profile parsed ~/.mrweirdo-jobs/profile.json
 * @param {{work_auth_sources?: Record<string, string>}} context what
 *        shared/answer_provenance.mjs `workAuthSources()` recorded for the
 *        work-authorization family — i.e. whether the funnel was ever run.
 *        Callers with a home directory read it there; the gate itself stays
 *        pure so it can run from a dry run, a preflight or a test alike.
 * @returns {{ok: boolean, missing_paths: string[], category: string,
 *            question: string, blocked_because: string,
 *            what_happens_next: string, remediation_command: string}}
 *
 * Not ok exactly when NOTHING proves the funnel ever ran: no strictly-typed
 * value in any of its cells, and no user-supplied provenance record for the
 * family. One answered cell is enough — a funnel that leaves cells unwritten
 * is the funnel working as designed (「确定不了的一格都不写」), and asking again
 * would only get the same answer back. `"true"` / `"Yes"` strings are treated
 * as never asked rather than coerced.
 *
 * 设计稿 §13.3.3（那道门的去留）写的是「门只读来源留痕，不读值」; this reads
 * values AS WELL, because the one real user predates the provenance file
 * entirely (§13.9.2 对现有真实用户的零变化承诺) — provenance-only would lock
 * out the only real user there is. Reading a strictly-typed value as
 * proof-of-asking is the opposite direction from the outlawed predicate
 * ("missing value ⇒ locked"): here a value can only OPEN the gate, never hold
 * it shut.
 *
 * When it is not ok it hands back what it is stuck on, what happens next, and
 * a runnable fix. The three places-to-look now live next to Q4（§13.3.2
 * 「还没有 / 说不清楚」的处置）— they answer "do I HAVE a permission", which is
 * not the question this gate asks, and a gate is not allowed to send a user on
 * an errand that cannot open it.
 */
export function blockingProfileGaps(profile = {}, context = {}) {
  const funnelRan = FUNNEL_EVIDENCE.some(([path, isAnswer]) => isAnswer(valueAtPath(profile, path)))
    || Object.entries(context.work_auth_sources || {}).some(
      ([path, source]) => path.startsWith('work_authorization.') && FUNNEL_SOURCES.has(source),
    );
  if (funnelRan) {
    return {
      ok: true,
      missing_paths: [],
      category: GATE_CATEGORY,
      question: '',
      blocked_because: '',
      what_happens_next: '',
      remediation_command: '',
    };
  }
  const missing_paths = GATED_PATHS.filter((path) => typeof valueAtPath(profile, path) !== 'boolean');
  return {
    ok: false,
    missing_paths,
    category: GATE_CATEGORY,
    question: QUESTION_TEMPLATES[GATE_CATEGORY].question,
    blocked_because: BLOCKED_BECAUSE,
    what_happens_next: WHAT_HAPPENS_NEXT,
    remediation_command: remediationCommand(missing_paths),
  };
}
