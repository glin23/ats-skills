// work_auth_identity.mjs — "which kind of person are you", never "are you
// authorized to work".
//
// 关卡 3 ① 拍板原话：问「你是美国公民或绿卡吗？」「你是持 F-1 的留学生吗？」，
// 不许问「你有没有工作授权」——「这没人能知道」。
//
// He is right, and the reason is worth keeping next to the code. "Am I
// authorized to work in the US?" is a legal conclusion, not a fact a person can
// read off a document: for an F-1 student it depends on whether the specific
// role qualifies for CPT, on whether his school signs off, and on when. The old
// four-option question asked him to reach that conclusion himself, with CPT/OPT
// in the option text — and a wrong answer hurts in both directions (a student
// who says "yes" has put a misstatement on a real employer's form; a citizen who
// says "no" is filtered out of the pipeline on the spot).
//
// So: three yes/no questions about facts a person can check, and the four
// profile fields derived here in code.
//
// Two rules are written into the table below and must stay there:
//
//   1. Only cells we can actually determine get written. The F-1-without-
//      permission row looks like it could take `authorized_to_work_us: false` —
//      it must not. Whether that student can work is decided case by case by his
//      school and the role; deciding it for him is a fabrication with teeth,
//      because `false` on a form gets him rejected outright. On disk `false` is
//      byte-identical to "the user said no" (PROJECT_MEMORY 长期原则第 2 条), so
//      a guess here can never be walked back by code.
//   2. `requires_sponsorship_future` IS derivable for every F-1 situation: an
//      F-1 work permission has an end date, so long-term employment needs
//      sponsorship. That follows from the status itself, not from the case.
//
// Pure functions, no IO, no imports. The callers (the pre-batch gate, the
// onboarding write-back) decide what to do with the result.

/** The four cells this module is allowed to speak about. */
export const WORK_AUTH_PATHS = {
  visa_status: 'work_authorization.visa_status',
  authorized_to_work_us: 'work_authorization.authorized_to_work_us',
  requires_sponsorship_now: 'work_authorization.requires_sponsorship_now',
  requires_sponsorship_future: 'work_authorization.requires_sponsorship_future',
};

/** Asked in order; stop as soon as the answers settle the case. */
export const IDENTITY_QUESTIONS = [
  {
    id: 'Q1',
    ask_when: 'always',
    question: '你是美国公民，或者持有绿卡（永久居民卡）吗？',
  },
  {
    id: 'Q2',
    ask_when: 'Q1 = 否',
    question: '你是持 F-1 学生签证在美国读书的留学生吗？',
  },
  {
    id: 'Q3',
    ask_when: 'Q2 = 是',
    // CPT appears here as a pointer to a line on a document he already owns —
    // "the box on your I-20" — not as a term he has to understand. That is the
    // difference between helping him find the paper and asking him to make the
    // legal call.
    question: '学校已经给你批下来可以工作的许可了吗？（就是那张 EAD 卡，或者你的 I-20 上写着 CPT 那一栏）',
  },
];

/** Canonical visa_status labels for the three situations we can name. */
export const VISA_STATUS_LABELS = {
  citizen_or_green_card: 'US Citizen or Permanent Resident',
  f1_with_permission: 'F-1 with CPT/OPT',
  f1_without_permission: 'F-1 without current work permission',
};

/** Why the batch stopped, in one sentence the user can act on. */
export const BLOCKED_BECAUSE = '投递表单几乎每一份都会问你的工作身份，这一格我不能替你猜——猜错了两个方向都伤你。';

/** Three places that actually hold the answer. Not "please confirm yourself". */
export const WHERE_TO_CHECK = [
  '你学校的国际学生办公室（International Student Office / OISS，管 F-1 学生身份的那个办公室）——最快，一封邮件就能问清',
  '你自己的 I-20 表：第 2 页 Employment Authorization（工作许可）那一栏写着有没有 CPT',
  'EAD 卡（Employment Authorization Document，工作许可卡）——有 OPT 的人手里那张实体卡',
];

/** The promise that keeps "I don't know" from being a dead end. */
export const WHAT_HAPPENS_NEXT = '这一批我先不投；你查到了跟我说一声，一条命令就能续上，已经排好的队列不会白排。';

export const SITUATIONS = [
  'citizen_or_green_card',
  'f1_with_permission',
  'f1_without_permission',
  'f1_permission_unclear',
  'other_status',
];

function fail(message) {
  throw new Error(`work_auth_identity: ${message}`);
}

function answered(value) {
  return value !== undefined && value !== null;
}

function requireUnasked(value, questionId, why) {
  if (answered(value)) fail(`${questionId} carries an answer but ${why}; the funnel and the caller disagree`);
}

/**
 * @param {{citizenOrGreenCard?: boolean|null, f1Student?: boolean|null,
 *          workPermissionGranted?: boolean|'unclear'|null}} answers
 * @returns {string} one of SITUATIONS
 *
 * Throws rather than assumes. A missing answer here is a bug in the caller's
 * question flow, and the cost of papering over it is a claim about someone's
 * immigration status typed onto a real form.
 */
export function identitySituation({ citizenOrGreenCard, f1Student, workPermissionGranted } = {}) {
  if (typeof citizenOrGreenCard !== 'boolean') {
    fail(`Q1 (公民/绿卡) must be answered true or false, got ${JSON.stringify(citizenOrGreenCard)}`);
  }
  if (citizenOrGreenCard) {
    requireUnasked(f1Student, 'Q2', 'Q1 already settled the case');
    requireUnasked(workPermissionGranted, 'Q3', 'Q1 already settled the case');
    return 'citizen_or_green_card';
  }
  if (typeof f1Student !== 'boolean') {
    fail(`Q2 (F-1 留学生) must be answered true or false, got ${JSON.stringify(f1Student)}`);
  }
  if (!f1Student) {
    requireUnasked(workPermissionGranted, 'Q3', 'Q3 is only asked of F-1 students');
    return 'other_status';
  }
  if (workPermissionGranted === true) return 'f1_with_permission';
  if (workPermissionGranted === false) return 'f1_without_permission';
  if (workPermissionGranted === 'unclear') return 'f1_permission_unclear';
  return fail(`Q3 (许可批下来了吗) must be true, false or 'unclear', got ${JSON.stringify(workPermissionGranted)}`);
}

/**
 * @param {{citizenOrGreenCard?: boolean|null, f1Student?: boolean|null,
 *          workPermissionGranted?: boolean|'unclear'|null, userWords?: string}} input
 * @returns {{situation: string, answers: Record<string, boolean|string>,
 *            unwritten_paths: string[], needs_lookup: boolean}}
 *
 * `answers` is ready to hand to shared/record_profile_answers.mjs as-is. A path
 * absent from it is a path this module refuses to derive — the caller must leave
 * it null rather than fill it in with a "safe" default, because there is no safe
 * default for a fact about a person.
 */
export function workAuthAnswers(input = {}) {
  const situation = identitySituation(input);
  const words = typeof input.userWords === 'string' ? input.userWords.trim() : '';
  const answers = {};

  if (situation === 'citizen_or_green_card') {
    answers[WORK_AUTH_PATHS.authorized_to_work_us] = true;
    answers[WORK_AUTH_PATHS.requires_sponsorship_now] = false;
    answers[WORK_AUTH_PATHS.requires_sponsorship_future] = false;
    answers[WORK_AUTH_PATHS.visa_status] = VISA_STATUS_LABELS.citizen_or_green_card;
  } else if (situation === 'f1_with_permission') {
    answers[WORK_AUTH_PATHS.authorized_to_work_us] = true;
    answers[WORK_AUTH_PATHS.requires_sponsorship_now] = false;
    answers[WORK_AUTH_PATHS.requires_sponsorship_future] = true;
    answers[WORK_AUTH_PATHS.visa_status] = VISA_STATUS_LABELS.f1_with_permission;
  } else if (situation === 'f1_without_permission') {
    // authorized_to_work_us and requires_sponsorship_now stay untouched on
    // purpose — see rule 1 at the top of this file.
    answers[WORK_AUTH_PATHS.requires_sponsorship_future] = true;
    answers[WORK_AUTH_PATHS.visa_status] = VISA_STATUS_LABELS.f1_without_permission;
  } else if (words) {
    // 'f1_permission_unclear' / 'other_status': nothing is derivable. His own
    // words are the only thing we have, and only if he gave any — inventing a
    // label for "I don't know" would put a status on file that he never stated.
    answers[WORK_AUTH_PATHS.visa_status] = words;
  }

  const unwritten_paths = Object.values(WORK_AUTH_PATHS).filter((path) => !(path in answers));
  // The gate opens on these two only, so "did this answer actually unblock him"
  // has exactly one honest definition.
  const needs_lookup = typeof answers[WORK_AUTH_PATHS.authorized_to_work_us] !== 'boolean'
    || typeof answers[WORK_AUTH_PATHS.requires_sponsorship_future] !== 'boolean';

  return { situation, answers, unwritten_paths, needs_lookup };
}
