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

const GATE_CATEGORY = 'user_work_authorization';

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
  // keeps the drivers from re-deriving it from the booleans.
  answers['work_authorization.visa_status'] = '<US Citizen | Green Card | F-1 CPT | F-1 OPT | Other>';
  return [
    'node shared/record_profile_answers.mjs',
    `--json '${JSON.stringify(answers)}'`,
    `--source user_answer --category ${GATE_CATEGORY} --asked-by queue_gate`,
  ].join(' ');
}

/**
 * @param {object} profile parsed ~/.mrweirdo-jobs/profile.json
 * @returns {{ok: boolean, missing_paths: string[], category: string,
 *            question: string, remediation_command: string}}
 *
 * Not ok exactly when a gated path holds neither `true` nor `false`. Only real
 * booleans count: `"true"` and `"Yes"` are treated as never asked rather than
 * coerced, because coercing here writes a claim about someone's immigration
 * status onto a live application form.
 */
export function blockingProfileGaps(profile = {}) {
  const missing_paths = GATED_PATHS.filter((path) => typeof valueAtPath(profile, path) !== 'boolean');
  if (missing_paths.length === 0) {
    return { ok: true, missing_paths: [], category: GATE_CATEGORY, question: '', remediation_command: '' };
  }
  return {
    ok: false,
    missing_paths,
    category: GATE_CATEGORY,
    question: QUESTION_TEMPLATES[GATE_CATEGORY].question,
    remediation_command: remediationCommand(missing_paths),
  };
}
