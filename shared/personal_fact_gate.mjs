// personal_fact_gate.mjs — the one thing checked before a batch opens a tab.
//
// Pure functions, no IO, no imports that touch the filesystem. Safe to call from
// supervisor_preflight and from apply_batch's dry-run path.
//
// Why exactly one fact is gated, and why it is this one:
//
// Two existing constraints pull against each other. The question set is derived
// from what real forms actually asked and then condensed (2026-06 decision: no
// pre-application probing, and onboarding stays at three questions, because a
// twenty-question setup is a product nobody finishes). But work authorization is
// asked by nearly every Greenhouse and Ashby form, and without it the row cannot
// be submitted at all — measured over 6 profile shapes x 4 real phrasings.
//
// So the rule is quantitative, not a matter of taste: a fact gets a pre-batch
// gate when its absence blocks 80%+ of rows. Today only these two keys qualify.
// Legal attestations, residence, EEO and education each block a slice, so they
// stay on the post-batch path.
//
// This gate probes no form. It only asserts, in code, the answer onboarding step
// A0 was already supposed to have collected — which is the difference between an
// instruction to a model and an assertion.
import { QUESTION_TEMPLATES } from './missing_field_questions.mjs';
import { BLOCKED_BECAUSE, VISA_STATUS, WHAT_HAPPENS_NEXT, WHERE_TO_CHECK } from './work_auth_identity.mjs';

const GATE_CATEGORY = 'user_work_authorization';

// Sources that mean "a person told us this", as opposed to "it was already on
// disk" or "we read it off a resume". Only the first kind proves the question
// was actually put to him — which is what makes asking a second time pointless.
const USER_SUPPLIED_SOURCES = new Set(['user_answer', 'onboarding_a0', 'onboarding_a2']);

/** Paths whose absence stops a real batch. Declared by the question template so
 *  the gate can never ask for something the write-back command cannot store. */
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
 * @param {{visa_status_source?: string}} context what shared/answer_provenance.mjs
 *        says about `work_authorization.visa_status` — i.e. whether a human ever
 *        supplied it. Callers read it with `sourceFor()`; the gate itself stays
 *        pure so it can run from a dry run, a preflight or a test alike.
 * @returns {{ok: boolean, missing_paths: string[], category: string,
 *            question: string, asked_in_this_batch: boolean,
 *            blocked_because: string, where_to_check: string[],
 *            what_happens_next: string, remediation_command: string}}
 *
 * Not ok exactly when a gated path holds neither `true` nor `false`. Only real
 * booleans count: `"true"` and `"Yes"` are treated as never asked rather than
 * coerced, because coercing here writes a claim about someone's immigration
 * status onto a live application form.
 *
 * When it is not ok it always hands back three things together (设计稿 §13.3):
 * what it is stuck on, three concrete places that hold the answer, and what
 * happens meanwhile. A stop without those three is the "0 submitted, no reason"
 * behaviour this round exists to delete.
 */
export function blockingProfileGaps(profile = {}, context = {}) {
  const missing_paths = GATED_PATHS.filter((path) => typeof valueAtPath(profile, path) !== 'boolean');
  if (missing_paths.length === 0) {
    return {
      ok: true,
      missing_paths: [],
      category: GATE_CATEGORY,
      question: '',
      asked_in_this_batch: false,
      blocked_because: '',
      where_to_check: [],
      what_happens_next: '',
      remediation_command: '',
    };
  }
  // He answered the question and still could not settle it (the classic case:
  // an F-1 student who does not know whether his CPT is approved). Asking again
  // this batch can only produce the same answer, so the main conversation shows
  // the three places to look instead of re-opening the same prompt.
  const visaStatus = valueAtPath(profile, 'work_authorization.visa_status');
  const asked_in_this_batch = USER_SUPPLIED_SOURCES.has(context.visa_status_source)
    && typeof visaStatus === 'string' && visaStatus.trim() !== '';
  return {
    ok: false,
    missing_paths,
    category: GATE_CATEGORY,
    question: QUESTION_TEMPLATES[GATE_CATEGORY].question,
    asked_in_this_batch,
    blocked_because: BLOCKED_BECAUSE,
    where_to_check: [...WHERE_TO_CHECK],
    what_happens_next: WHAT_HAPPENS_NEXT,
    remediation_command: remediationCommand(missing_paths),
  };
}
