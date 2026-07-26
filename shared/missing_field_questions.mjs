// QUESTION_TEMPLATES is the single source of truth for "a fact we were never
// told". One entry decides four things at once: what we ask the user, which
// profile paths that answer is allowed to write, how the answer is condensed
// into a group, and whether the blocked rows get retried. It used to live in
// shared/apply_gap_report.mjs, which is a CLI that reads files at import time
// and therefore cannot be imported by the writer CLI or by unit tests.
//
// value_type / path_value_types drive the write-back validator: three-state
// booleans refuse "yes"/"true"/1 rather than coercing them, because a coerced
// value about immigration status ends up typed onto a real form.
export const QUESTION_TEMPLATES = {
  user_work_authorization: {
    // Deliberately below user_full_address (1): a missing work-authorization
    // answer blocks nearly every row, so it outranks everything else. It is not
    // 0 — categoryPriority() falls back with `|| 99`, so 0 would sort last.
    priority: 0.5,
    profile_paths: [
      'work_authorization.visa_status',
      'work_authorization.authorized_to_work_us',
      'work_authorization.requires_sponsorship_now',
      'work_authorization.requires_sponsorship_future',
    ],
    question: '你在美国的工作授权属于哪一种？（A）美国公民或绿卡持有者；（B）F-1 学生签证，已经有 CPT/OPT，现在就能工作；（C）F-1 学生签证，现在和将来都需要公司担保；（D）其他或不确定（请补一句说明）。这一格空着，几乎每一份投递表单都会卡住。',
    answer_type: 'single_choice',
    value_type: 'boolean',
    path_value_types: { 'work_authorization.visa_status': 'string' },
    enum_values: null,
  },
  user_full_address: {
    priority: 1,
    profile_paths: ['personal.address_street', 'personal.address_city', 'personal.address_state', 'personal.address_zip', 'personal.address_country'],
    question: '请提供你的完整永久/邮寄地址：街道、城市、州、ZIP、国家。这个只保存在本地 profile，用来填写 ATS 地址题。',
    answer_type: 'short_text',
    value_type: 'string',
    enum_values: null,
  },
  user_earliest_start_date: {
    priority: 2,
    profile_paths: ['standard_qa.earliest_start_date'],
    question: '你最早可以开始实习/part-time 的日期是什么？请给一个具体日期或月份，例如 2026-05-15 / May 2026。',
    answer_type: 'short_text',
    value_type: 'string',
    enum_values: null,
  },
  user_high_school_location: {
    priority: 3,
    profile_paths: ['standard_qa.high_school_location'],
    question: '你的高中所在城市和州/国家是什么？例如 Beijing, China 或 Seattle, WA。',
    answer_type: 'short_text',
    value_type: 'string',
    enum_values: null,
  },
  user_government_relative_compliance: {
    priority: 4,
    profile_paths: ['legal_attestations.relatives_in_federal_government_or_contractors'],
    question: '你是否有亲属目前在美国联邦政府、HHS/CDC、DoD/军方、相关政府 contractor，或政治任命岗位工作？请回答 Yes/No；如果 Yes，请简短说明。',
    answer_type: 'yes_no_plus_detail',
    value_type: 'boolean',
    enum_values: null,
  },
  user_language_or_skill_level: {
    priority: 5,
    profile_paths: ['standard_qa.language_proficiency'],
    question: '表单问到了语言或技能水平。请列出你的真实水平，例如 Spanish: none/beginner/intermediate/fluent；或按题目说明回答。',
    answer_type: 'short_text',
    value_type: 'object',
    enum_values: null,
  },
  user_legal_attestation: {
    priority: 5.5,
    profile_paths: ['legal_attestations.no_prohibited_possessor_status'],
    question: '联邦表单里有一组固定的法律声明题（是否逃犯、是否非法居留、是否管制药物成瘾者、是否在受限制令期间等）。档案里它们对应同一个确认。请回答：这一整组是否都不适用于你？Yes = 都不适用；No 或不确定 = 我会跳过问到这组题的岗位，不替你回答。',
    answer_type: 'yes_no',
    value_type: 'boolean',
    enum_values: null,
  },
  user_compliance_relationship_or_restriction: {
    priority: 6,
    profile_paths: ['legal_attestations.conflicting_obligations', 'standard_qa.company_relationships'],
    question: '表单问到了 non-compete、供应商/合作伙伴/经销商关系或其他可能限制工作的合规事实。请按真实情况回答 Yes/No；如果 Yes，请简短说明。',
    answer_type: 'yes_no_plus_detail',
    value_type: 'object',
    path_value_types: { 'legal_attestations.conflicting_obligations': 'boolean' },
    enum_values: null,
  },
  user_gpa: {
    priority: 7,
    profile_paths: ['education.gpa'],
    question: '你的本科 cumulative GPA 是多少？如果不想自动填写 GPA，也可以说“不填 GPA”。',
    answer_type: 'short_text',
    value_type: 'string',
    enum_values: null,
  },
  user_logistics_fact: {
    priority: 8,
    profile_paths: ['standard_qa.location_logistics'],
    question: '表单问到了具体通勤/驾照/交通事实。请按真实情况回答该题；这类事实不能由系统猜。',
    answer_type: 'short_text',
    value_type: 'object',
    enum_values: null,
  },
  user_work_location_commitment: {
    priority: 9,
    profile_paths: ['standard_qa.work_location_commitments'],
    question: '你是否愿意/能够按岗位要求到指定城市 onsite/hybrid 工作？请按城市回答 Yes/No，例如 Bay Area: Yes。',
    answer_type: 'short_text',
    value_type: 'object',
    enum_values: null,
  },
  user_external_form_completion: {
    priority: 10,
    profile_paths: ['standard_qa.external_form_confirmations'],
    question: '有些岗位要求先完成一个外部表单，然后在 ATS 里确认。请打开对应岗位页面完成外部表单后告诉我 Yes；如果你不想做这个额外表单，我会跳过该岗位。',
    answer_type: 'yes_no',
    value_type: 'object',
    enum_values: null,
  },
  user_demographics_eeo: {
    // Ranked last on purpose: it unlocks nothing on its own and only surfaces
    // when a form offers no "decline to answer" option. Step 6 spends its
    // four-question budget on facts that actually unblock rows first.
    priority: 15,
    profile_paths: [
      'demographics.race',
      'demographics.hispanic_or_latino',
      'demographics.gender',
      'demographics.veteran_status',
      'demographics.disability_status',
    ],
    question: '这张表单问到了 EEO（Equal Employment Opportunity，平等就业机会）自愿披露：种族 / 民族 / 性别 / 退伍军人身份 / 残障状况。这几题完全自愿，默认就是“不愿回答”，只有你主动说我才会填。如果某张表单连“不愿回答”这个选项都没有，你也可以让我直接跳过那些岗位。',
    answer_type: 'short_text',
    value_type: 'string',
    enum_values: null,
  },
  unknown_user_fact: {
    priority: 20,
    profile_paths: ['standard_qa.custom_facts'],
    question: '有表单问到了系统无法安全推断的事实。请看下面原题，逐题给真实答案。',
    answer_type: 'short_text',
    value_type: 'object',
    enum_values: null,
  },
};

export const QUESTION_GROUPS = [
  {
    group_id: 'location_and_logistics',
    covers_categories: [
      'user_full_address',
      'user_work_location_commitment',
      'user_logistics_fact',
    ],
    profile_paths: [
      'personal.address_street',
      'personal.address_city',
      'personal.address_state',
      'personal.address_zip',
      'personal.address_country',
      'standard_qa.work_location_commitments',
      'standard_qa.location_logistics',
    ],
    question: '请一次补充这批申请实际问到的地址、onsite/hybrid 地点承诺、通勤/驾照/交通等真实事实；没有被问到的部分不用额外提供。',
    answer_type: 'multi_fact_text',
  },
  {
    group_id: 'compliance_facts',
    covers_categories: [
      'user_government_relative_compliance',
      'user_compliance_relationship_or_restriction',
    ],
    profile_paths: [
      'legal_attestations.relatives_in_federal_government_or_contractors',
      'legal_attestations.conflicting_obligations',
      'standard_qa.company_relationships',
    ],
    question: '请一次补充这批申请实际问到的政府亲属、non-compete、供应商/合作伙伴/经销商关系或其他限制性义务；按真实情况回答 Yes/No，如 Yes 请简短说明。',
    answer_type: 'yes_no_plus_detail',
  },
];

/**
 * The write-back whitelist, derived from the questions themselves: a path is
 * writable exactly when some question declares it. "What we ask" and "what we
 * may write" cannot drift apart, because they are the same list read twice.
 * Everything else — email, phone, resume_path, the resume-derived experience
 * blocks — stays out of reach of an answer.
 * @param {object} templates
 * @returns {Map<string, {value_type: string, categories: string[]}>}
 */
export function answerWritePaths(templates = QUESTION_TEMPLATES) {
  const paths = new Map();
  for (const [category, template] of Object.entries(templates)) {
    for (const path of template.profile_paths || []) {
      const value_type = template.path_value_types?.[path] || template.value_type || 'string';
      const existing = paths.get(path);
      if (!existing) {
        paths.set(path, { value_type, categories: [category] });
        continue;
      }
      if (existing.value_type !== value_type) {
        throw new Error(`answerWritePaths: ${path} is declared as both ${existing.value_type} and ${value_type}`);
      }
      existing.categories.push(category);
    }
  }
  return paths;
}

export function isUserFillableCategory(category, questionTemplates) {
  return (category.startsWith('user_') || category === 'unknown_user_fact') &&
    Array.isArray(questionTemplates[category]?.profile_paths) &&
    questionTemplates[category].profile_paths.length > 0;
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function profilePathsForCategories(categories, questionTemplates) {
  const paths = [];
  for (const category of categories) {
    paths.push(...(questionTemplates[category]?.profile_paths || []));
  }
  return sortedUnique(paths);
}

function setEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((value, idx) => value === b[idx]);
}

export function validateQuestionGroups(questionGroups, questionTemplates) {
  const seenGroupIds = new Set();
  for (const group of questionGroups) {
    if (!group?.group_id || typeof group.group_id !== 'string') {
      throw new Error('QUESTION_GROUPS entry is missing group_id');
    }
    if (seenGroupIds.has(group.group_id)) {
      throw new Error(`QUESTION_GROUPS duplicate group_id: ${group.group_id}`);
    }
    seenGroupIds.add(group.group_id);
    if (!Array.isArray(group.covers_categories) || group.covers_categories.length < 2) {
      throw new Error(`QUESTION_GROUPS ${group.group_id} must cover at least two categories; use singleton fallback otherwise`);
    }

    const uniqueCategories = sortedUnique(group.covers_categories);
    if (uniqueCategories.length !== group.covers_categories.length) {
      throw new Error(`QUESTION_GROUPS ${group.group_id} has duplicate covers_categories`);
    }
    for (const category of group.covers_categories) {
      if (!isUserFillableCategory(category, questionTemplates)) {
        throw new Error(`QUESTION_GROUPS ${group.group_id} covers non-user-fillable category: ${category}`);
      }
    }

    const expectedPaths = profilePathsForCategories(group.covers_categories, questionTemplates);
    const actualPaths = sortedUnique(group.profile_paths || []);
    if (!setEqual(actualPaths, expectedPaths)) {
      throw new Error(`QUESTION_GROUPS ${group.group_id} profile_paths must match covered category profile_paths`);
    }
  }
}

function rowSetsByCategory(entries, questionTemplates) {
  const rowsByCategory = new Map();
  for (const entry of entries) {
    if (!entry.row_id || !isUserFillableCategory(entry.category, questionTemplates)) continue;
    if (!rowsByCategory.has(entry.category)) rowsByCategory.set(entry.category, new Set());
    rowsByCategory.get(entry.category).add(Number(entry.row_id));
  }
  return rowsByCategory;
}

function distinctRowsForCategories(categories, rowsByCategory) {
  const rowIds = new Set();
  for (const category of categories) {
    for (const rowId of rowsByCategory.get(category) || []) rowIds.add(rowId);
  }
  return rowIds;
}

function categoryPriority(category, questionTemplates) {
  return questionTemplates[category]?.priority || 99;
}

function sortQuestionItems(items, questionTemplates) {
  return items.sort((a, b) => {
    if (b.unblocks_n_jobs !== a.unblocks_n_jobs) return b.unblocks_n_jobs - a.unblocks_n_jobs;
    const aPriority = Math.min(...a.covers_categories.map((category) => categoryPriority(category, questionTemplates)));
    const bPriority = Math.min(...b.covers_categories.map((category) => categoryPriority(category, questionTemplates)));
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.group_id.localeCompare(b.group_id);
  });
}

export function buildMissingFieldRanking(entries, questionTemplates) {
  const rowsByCategory = rowSetsByCategory(entries, questionTemplates);
  const items = [...rowsByCategory.entries()].map(([category, rowIds]) => ({
    category,
    question: questionTemplates[category].question,
    profile_paths: questionTemplates[category].profile_paths,
    unblocks_n_jobs: rowIds.size,
    covers_categories: [category],
    group_id: category,
  }));
  return sortQuestionItems(items, questionTemplates).map(({ covers_categories, group_id, ...item }) => item);
}

export function condenseMissingQuestions(entries, questionTemplates, questionGroups = QUESTION_GROUPS) {
  validateQuestionGroups(questionGroups, questionTemplates);

  const rowsByCategory = rowSetsByCategory(entries, questionTemplates);
  const consumed = new Set();
  const condensed = [];

  for (const group of questionGroups) {
    const presentCategories = group.covers_categories.filter((category) => rowsByCategory.has(category));
    if (presentCategories.length < 2) continue;
    const rowIds = distinctRowsForCategories(presentCategories, rowsByCategory);
    condensed.push({
      group_id: group.group_id,
      singleton: false,
      question: group.question,
      answer_type: group.answer_type,
      profile_paths: profilePathsForCategories(presentCategories, questionTemplates),
      covers_categories: presentCategories,
      unblocks_n_jobs: rowIds.size,
    });
    for (const category of presentCategories) consumed.add(category);
  }

  for (const category of rowsByCategory.keys()) {
    if (consumed.has(category)) continue;
    const rowIds = rowsByCategory.get(category);
    condensed.push({
      group_id: category,
      singleton: true,
      question: questionTemplates[category].question,
      answer_type: questionTemplates[category].answer_type,
      profile_paths: questionTemplates[category].profile_paths,
      covers_categories: [category],
      unblocks_n_jobs: rowIds.size,
    });
  }

  const presentCategories = sortedUnique([...rowsByCategory.keys()]);
  const coveredCategories = sortedUnique(condensed.flatMap((item) => item.covers_categories));
  if (!setEqual(coveredCategories, presentCategories)) {
    throw new Error('condensed_missing_questions coverage invariant failed');
  }

  return sortQuestionItems(condensed, questionTemplates);
}
