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
// Three rules are written into the table below and must stay there:
//
//   1. Only cells we can actually determine get written. The student-without-
//      permission row looks like it could take `authorized_to_work_us: false` —
//      it must not. Whether that student can work is decided case by case by his
//      school and the role; deciding it for him is a fabrication with teeth,
//      because `false` on a form gets him rejected outright. On disk `false` is
//      byte-identical to "the user said no" (PROJECT_MEMORY 长期原则第 2 条), so
//      a guess here can never be walked back by code.
//   2. `requires_sponsorship_future` IS derivable for every student-visa
//      situation, INCLUDING "I can't tell": a student work permission has an end
//      date, so long-term employment needs sponsorship. That follows from the
//      status itself, not from the case. 实测: 补上这一格之后被阻塞的真实投递
//      从 16/72 降到 4/72.
//   3. "不写" ≠ "不能投". An unwritten cell only stops the rows that actually
//      ask that question; it never stops the batch. 关卡 7 推翻的正是这个等号:
//      「先有许可才能投」是反的 —— 常态是先投, 拿到 offer 之后学校才批许可.
//
// 关卡 8 拍板补进来的两题:
//   Q4 (form_answer_policy) —— 那道表单题一开始就问他一句「你要我怎么办」,
//      三档, 默认「别替我答」. 投到一半停下来问, 他掌握的信息一样多, 只是
//      把同一个决定拆成 N 次打扰.
//   Q5 (requires_sponsorship_future) —— 只对「既不是公民/绿卡也不是留学生」
//      的人问, 换回这一整类人的自动投递.
//
// Pure functions, no IO, no imports. The callers (the pre-batch gate, the
// onboarding write-back) decide what to do with the result.

/** The six cells this module is allowed to speak about. */
export const WORK_AUTH_PATHS = {
  visa_status: 'work_authorization.visa_status',
  authorized_to_work_us: 'work_authorization.authorized_to_work_us',
  requires_sponsorship_now: 'work_authorization.requires_sponsorship_now',
  requires_sponsorship_future: 'work_authorization.requires_sponsorship_future',
  form_answer_policy: 'work_authorization.form_answer_policy',
  // Leading underscore = system-only. ADR-12 R4: his own sentence is kept for
  // audit, and NO module that produces employer-facing text may read it.
  user_words: 'work_authorization._user_words',
};

/** What he told us to do when a form asks the work-authorization question. */
export const FORM_ANSWER_POLICIES = {
  answer_yes: 'answer_yes',
  answer_no: 'answer_no',
  defer_to_user: 'defer_to_user',
};

/**
 * ADR-12 R4: `visa_status` is a fixed enum and a SYSTEM-ONLY field. It used to
 * be free text that `answer_templates.mjs` rendered verbatim into English
 * sentences shown to employers — which turned a Chinese sentence the user typed
 * into a claim on a real application form.
 */
export const VISA_STATUS = {
  citizen_or_green_card: 'citizen_or_green_card',
  student_visa_with_permission: 'student_visa_with_permission',
  student_visa_no_permission_yet: 'student_visa_no_permission_yet',
  student_visa_permission_unclear: 'student_visa_permission_unclear',
  other_status: 'other_status',
};

/** 关卡 8 决定一: 不讲这句就是诱导. 一个字都不许省. */
export const Q4_NOTICE = [
  '选「填有」或「填没有」的话，这三个字会被原样打到真实雇主的表单上。',
  '不确定选哪个？你学校的国际学生办公室和就业指导中心对这道题有官方说法，问他们最快。',
  '你也可以先选「别替我答」开跑，随时改。',
].join('');

/** Asked in order; stop as soon as the answers settle the case. */
export const IDENTITY_QUESTIONS = [
  {
    id: 'Q1',
    ask_when: 'always',
    question: '你是美国公民，或者持有绿卡（永久居民卡）吗？',
    options: [
      { value: true, label: '是' },
      { value: false, label: '不是' },
    ],
  },
  {
    id: 'Q2',
    ask_when: 'Q1 = 否',
    question: '你是持学生签证在美国读书的留学生吗？（就是学校给你办的那种身份）',
    options: [
      { value: true, label: '是' },
      { value: false, label: '不是' },
    ],
  },
  {
    id: 'Q3',
    ask_when: 'Q2 = 是',
    // 换问法的理由: 上一版问「学校已经给你批下来了吗」, 把一个常态问成了
    // 一道资格审查 —— 用户读到的暗示是「答『还没有』我大概不行」. 而实情
    // 恰恰相反: 还没批下来是正在找实习的留学生的常态, 也正是该投的阶段.
    // 术语 (CPT / EAD) 一并删掉: 关卡 3 ① 的第一条硬约束.
    question: '你现在手上已经有一份批下来的、允许你在美国工作的证件吗？',
    options: [
      { value: true, label: '有' },
      { value: false, label: '还没有（正常，大多数人在这一档）' },
      { value: 'unclear', label: '说不清楚' },
    ],
  },
  {
    id: 'Q4',
    ask_when: 'Q3 = 还没有 / 说不清楚，或 Q2 = 否（紧接 Q5 之后）',
    question: '投递表单会问一句「你现在有在美国工作的许可吗」。这道题我不能替你判断——没有人能替别人下这个判断。所以我只问你一句：碰到这道题，你要我怎么办？',
    notice: Q4_NOTICE,
    options: [
      { value: FORM_ANSWER_POLICIES.answer_yes, label: '填「有」' },
      { value: FORM_ANSWER_POLICIES.answer_no, label: '填「没有」' },
      {
        value: FORM_ANSWER_POLICIES.defer_to_user,
        label: '这类题别替我答——碰到就停下，把这些岗位单独列给我',
        default: true,
      },
    ],
    where_to_check_ref: 'WHERE_TO_CHECK',
  },
  {
    id: 'Q5',
    ask_when: 'Q2 = 否',
    // 与禁区的分界线: 「你有没有工作授权」要他给出一个法律结论 (同一个人在
    // 不同岗位上答案可能不同); 这一题要他说出一个他自己的打算, 而且雇主表单
    // 自己就是这么问的 —— 我们只是把表单的问法搬到前面.
    question: '将来你想在美国长期工作的话，需要公司帮你办手续吗？',
    options: [
      { value: true, label: '需要' },
      { value: false, label: '不需要' },
      { value: 'unclear', label: '说不清楚' },
    ],
  },
];

/** Why the batch stopped. It now has exactly one reason: 引导没跑过. */
export const BLOCKED_BECAUSE = '引导里那几个身份问题一次都没问过——这不是你答不上来，是这一步还没走完。照着示例档案直接开跑的话，要等浏览器开完一整轮你才会发现什么都没配。';

/** Three places that actually hold the answer. Not "please confirm yourself".
 *  They sit next to Q4 (see `where_to_check_ref`), not in front of a gate:
 *  every one of them tells you whether you HAVE a permission, and none of them
 *  can get a permission for someone who has not applied for a job yet. */
export const WHERE_TO_CHECK = [
  '你学校的国际学生办公室（International Student Office / OISS，管留学生身份的那个办公室）——最快，一封邮件就能问清；就业指导中心（career center）对这道题也有官方说法',
  '你自己的 I-20 表（学校发的入学身份证明）：第 2 页 Employment Authorization（工作许可）那一栏',
  'EAD 卡（Employment Authorization Document，联邦发的工作许可实体卡）——正在校外实习或打工的人手里会有',
];

/** What happens meanwhile. 「这一批先不投」已按关卡 7 删除, 不保留为备选. */
export const WHAT_HAPPENS_NEXT = '答完下面这几题这一批就能开跑（公民或绿卡一题就完）。答不上来的格子我一个都不替你填——只在真问到那道题的那几行停下，其余照投。';

export const SITUATIONS = Object.values(VISA_STATUS);

function fail(message) {
  throw new Error(`work_auth_identity: ${message}`);
}

function answered(value) {
  return value !== undefined && value !== null;
}

function requireUnasked(value, questionId, why) {
  if (answered(value)) fail(`${questionId} carries an answer but ${why}; the funnel and the caller disagree`);
}

function requirePolicy(value, why) {
  if (!Object.values(FORM_ANSWER_POLICIES).includes(value)) {
    fail(`Q4 (碰到那道题你要我怎么办) must be one of ${Object.values(FORM_ANSWER_POLICIES).join(' / ')} ${why}, got ${JSON.stringify(value)}`);
  }
}

function requireTriState(value, questionId, label) {
  if (value !== true && value !== false && value !== 'unclear') {
    fail(`${questionId} (${label}) must be true, false or 'unclear', got ${JSON.stringify(value)}`);
  }
}

/**
 * @param {{citizenOrGreenCard?: boolean|null, studentVisa?: boolean|null,
 *          workPermissionGranted?: boolean|'unclear'|null,
 *          formAnswerPolicy?: string|null,
 *          sponsorshipNeededFuture?: boolean|'unclear'|null}} answers
 * @returns {string} one of SITUATIONS (identical to the visa_status enum)
 *
 * Throws rather than assumes. A missing answer here is a bug in the caller's
 * question flow, and the cost of papering over it is a claim about someone's
 * immigration status typed onto a real form.
 */
export function identitySituation({
  citizenOrGreenCard, studentVisa, workPermissionGranted, formAnswerPolicy, sponsorshipNeededFuture,
} = {}) {
  if (typeof citizenOrGreenCard !== 'boolean') {
    fail(`Q1 (公民/绿卡) must be answered true or false, got ${JSON.stringify(citizenOrGreenCard)}`);
  }
  if (citizenOrGreenCard) {
    requireUnasked(studentVisa, 'Q2', 'Q1 already settled the case');
    requireUnasked(workPermissionGranted, 'Q3', 'Q1 already settled the case');
    requireUnasked(formAnswerPolicy, 'Q4', 'Q1 already settled the case');
    requireUnasked(sponsorshipNeededFuture, 'Q5', 'Q1 already settled the case');
    return VISA_STATUS.citizen_or_green_card;
  }
  if (typeof studentVisa !== 'boolean') {
    fail(`Q2 (留学生) must be answered true or false, got ${JSON.stringify(studentVisa)}`);
  }
  if (!studentVisa) {
    requireUnasked(workPermissionGranted, 'Q3', 'Q3 is only asked of students');
    requireTriState(sponsorshipNeededFuture, 'Q5', '将来长期工作要不要公司帮你办手续');
    requirePolicy(formAnswerPolicy, 'for every other-status situation');
    return VISA_STATUS.other_status;
  }
  requireUnasked(sponsorshipNeededFuture, 'Q5', 'Q5 is only asked of the other-status branch');
  if (workPermissionGranted === true) {
    requireUnasked(formAnswerPolicy, 'Q4', 'Q3 already settled the case');
    return VISA_STATUS.student_visa_with_permission;
  }
  if (workPermissionGranted === false) {
    requirePolicy(formAnswerPolicy, 'once Q3 answered 还没有');
    return VISA_STATUS.student_visa_no_permission_yet;
  }
  if (workPermissionGranted === 'unclear') {
    requirePolicy(formAnswerPolicy, 'once Q3 answered 说不清楚');
    return VISA_STATUS.student_visa_permission_unclear;
  }
  return fail(`Q3 (手上有没有批下来的证件) must be true, false or 'unclear', got ${JSON.stringify(workPermissionGranted)}`);
}

// Which cell was DERIVED by us from his identity, and which one is HIS OWN
// STATEMENT. On disk the two are byte-identical (a `true` is a `true`), so this
// map is the only thing that can ever answer "who said this" — the exact defect
// PROJECT_MEMORY 长期原则第 1 条 was written about.
const DERIVED = 'onboarding_a0';
const STATED = 'user_answer';

/**
 * @param {object} input the five answers, see identitySituation
 * @returns {{situation: string, answers: Record<string, boolean|string>,
 *            answer_sources: Record<string, string>,
 *            write_groups: {source: string, answers: object}[],
 *            unwritten_paths: string[], defers_form_answer: boolean}}
 *
 * `write_groups` is what the caller feeds shared/record_profile_answers.mjs —
 * one CLI call per source, so a value he stated and a value we derived never
 * collapse into the same provenance entry. A path absent from `answers` is a
 * path this module refuses to derive: leave it null rather than fill it with a
 * "safe" default, because there is no safe default for a fact about a person.
 */
export function workAuthAnswers(input = {}) {
  const situation = identitySituation(input);
  const words = typeof input.userWords === 'string' ? input.userWords.trim() : '';
  const answers = {};
  const answer_sources = {};
  const put = (path, value, source) => {
    answers[path] = value;
    answer_sources[path] = source;
  };

  put(WORK_AUTH_PATHS.visa_status, situation, DERIVED);

  if (situation === VISA_STATUS.citizen_or_green_card) {
    put(WORK_AUTH_PATHS.authorized_to_work_us, true, DERIVED);
    put(WORK_AUTH_PATHS.requires_sponsorship_now, false, DERIVED);
    put(WORK_AUTH_PATHS.requires_sponsorship_future, false, DERIVED);
  } else if (situation === VISA_STATUS.student_visa_with_permission) {
    put(WORK_AUTH_PATHS.authorized_to_work_us, true, DERIVED);
    put(WORK_AUTH_PATHS.requires_sponsorship_now, false, DERIVED);
    put(WORK_AUTH_PATHS.requires_sponsorship_future, true, DERIVED);
  } else {
    // Every remaining situation went through Q4, so the policy is always on
    // file — including for A and B, where the boolean below already carries the
    // answer. 方向 15 想省掉这一格, 否掉的理由是: 「他答了 A」和「我们按身份推出
    // true」在档案里会再次变成同一个字节.
    put(WORK_AUTH_PATHS.form_answer_policy, input.formAnswerPolicy, STATED);
    if (input.formAnswerPolicy === FORM_ANSWER_POLICIES.answer_yes) {
      put(WORK_AUTH_PATHS.authorized_to_work_us, true, STATED);
    } else if (input.formAnswerPolicy === FORM_ANSWER_POLICIES.answer_no) {
      put(WORK_AUTH_PATHS.authorized_to_work_us, false, STATED);
    }
    // requires_sponsorship_now is never derivable here and never asked: it is a
    // per-role legal call, not a fact he can read off a document.
    if (situation === VISA_STATUS.other_status) {
      // 第 9 行: Q5 = 说不清楚 → 一格不写. 绝不许拿 Q4 的答案去补它 —— 「碰到
      // 授权题怎么答」和「将来要不要办手续」是两件事.
      if (typeof input.sponsorshipNeededFuture === 'boolean') {
        put(WORK_AUTH_PATHS.requires_sponsorship_future, input.sponsorshipNeededFuture, STATED);
      }
    } else {
      // Rule 2 at the top: the student status itself decides this one, and it
      // holds for 「说不清楚」 too — Q2 was answered, that fact does not evaporate.
      put(WORK_AUTH_PATHS.requires_sponsorship_future, true, DERIVED);
    }
  }

  if (words) put(WORK_AUTH_PATHS.user_words, words, STATED);

  const unwritten_paths = Object.values(WORK_AUTH_PATHS).filter((path) => !(path in answers));
  const write_groups = [DERIVED, STATED]
    .map((source) => ({
      source,
      answers: Object.fromEntries(
        Object.entries(answers).filter(([path]) => answer_sources[path] === source),
      ),
    }))
    .filter((group) => Object.keys(group.answers).length > 0);

  return {
    situation,
    answers,
    answer_sources,
    write_groups,
    unwritten_paths,
    defers_form_answer: input.formAnswerPolicy === FORM_ANSWER_POLICIES.defer_to_user,
  };
}
