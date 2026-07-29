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
import {
  FORM_ANSWER_POLICIES, IDENTITY_QUESTIONS, Q4_NOTICE, VISA_STATUS,
} from './work_auth_identity.mjs';

// ---------------------------------------------------------------------------
// standard_qa.custom_facts — the bucket for facts that have no bucket of their
// own. "Is the bucket non-empty?" is not an answer to any one question: a user
// who told us his current city has said nothing about his preferred name, and
// reading the bucket as an answer is how a question nobody was ever asked comes
// back as "fill it from the profile" — the driver has nothing to type, the
// report says the profile holds it, and the row sticks with no one to unstick
// it. The real profile holds 11 such facts, which cancelled the rule outright.
//
// So the key IS the question: customFactKey() turns a form label into the key
// the answer is written under, customFactAnswered() looks for exactly such a
// key, and the report publishes the key next to the question. Both halves read
// the same string the same way, so "what we ask" and "where the answer lands"
// cannot drift apart — which is what closes the loop (ask → answer → never
// asked again) instead of asking the same question forever.
// ---------------------------------------------------------------------------

// Leading words that belong to the phrasing of a question rather than to the
// fact it asks about. Dropping them keeps the key readable (`preferred_name`,
// not `what_is_your_preferred_name`) without breaking the match: what is left
// is still a contiguous run of words taken from the label itself.
const LABEL_LEAD_INS = new Set([
  'what', 'whats', 'which', 'is', 'are', 'do', 'does', 'did', 'have', 'has',
  'can', 'could', 'will', 'would', 'please', 'provide', 'enter', 'tell',
  'you', 'your', 'the', 'a', 'an',
]);

const factWords = (text) => String(text ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .split(' ')
  .filter(Boolean);

/**
 * The custom_facts key a given form label's answer is written under.
 * @param {string} label form label, as it appeared on the application
 * @returns {string} snake_case key, always a word run of the label
 */
export function customFactKey(label) {
  const words = factWords(label);
  let start = 0;
  while (start < words.length && LABEL_LEAD_INS.has(words[start])) start += 1;
  // A label made of nothing but lead-ins keeps all of its words: an empty key
  // would match every question at once.
  return (start < words.length ? words.slice(start) : words).join('_');
}

/**
 * Has THIS question's fact been answered — not "does the bucket hold anything".
 * Matches whole words only, so `us` does not answer a question about a `bonus`.
 * @param {string} label form label
 * @param {object} facts standard_qa.custom_facts
 * @returns {boolean}
 */
export function customFactAnswered(label, facts) {
  const haystack = ` ${factWords(label).join(' ')} `;
  return Object.entries(facts || {}).some(([key, value]) => {
    // `false` is an answer ("no, I never worked there"). Empty is not.
    if (value === null || value === undefined || value === '') return false;
    const phrase = factWords(key).join(' ');
    return phrase !== '' && haystack.includes(` ${phrase} `);
  });
}

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
      // Q4 的答案. 声明在这里才写得进档案 (ADR-5「模板即权限」) —— 少了这一行,
      // 漏斗问出来的「碰到那道题你要我怎么办」落不了盘, 等于没问.
      'work_authorization.form_answer_policy',
      // 他自己的原话. 下划线开头 = 只给系统看; ADR-12 R4 把它从 visa_status 里
      // 搬出来, 因为 visa_status 会被逐字渲染给雇主.
      'work_authorization._user_words',
    ],
    // 关卡 3 ① 拍板：不问「你有没有工作授权」——那是一个法律结论，「这没人能知道」。
    // 只问他从自己的证件和生活里读得出来的事实，结论由 work_auth_identity.mjs 去推。
    // 两句被关卡 7 推翻的话（「几乎每一份都会卡住」「这一批先不投」）已删：实测被
    // 阻塞的真实投递是 4/72 = 5.6%，而且不写一格只停问到那道题的那几行。
    // Q4 的必带提示（关卡 8 决定一）跟着问句走，不许省——省了就是诱导。
    question: `我需要知道你是哪一种人（法律结论由代码去推，不用你判断）。请按顺序回答，答到能定案就停：${
      IDENTITY_QUESTIONS.map((q) => `${q.id}（${q.ask_when}）${q.question}${
        q.options ? `【${q.options.map((o) => o.label).join(' / ')}】` : ''
      }`).join(' ')
    } 第 4 题必看：${Q4_NOTICE}`,
    answer_type: 'yes_no_sequence',
    value_type: 'boolean',
    path_value_types: {
      'work_authorization.visa_status': 'string',
      'work_authorization.form_answer_policy': 'string',
      'work_authorization._user_words': 'string',
    },
    // 「模板即权限」原来只管到路径这一层，一条声明过的路径能收下任何同类型的值。
    // 这两格必须再收一层：form_answer_policy 错一个字符，「别替我答」就静默退化成
    // 「没答过」，于是他答过的问题被再问一遍；visa_status 收下一句自由文本，
    // ADR-12 那条「中文原话被打给雇主」的路就重新长出来了。他自己的原话有它自己的
    // 格子（`_user_words`），那一格不设枚举。
    path_enum_values: {
      'work_authorization.visa_status': Object.values(VISA_STATUS),
      'work_authorization.form_answer_policy': Object.values(FORM_ANSWER_POLICIES),
    },
    enum_values: null,
    // The subset that stops a batch before it opens a single browser tab. It is
    // declared here, next to the question, so the gate cannot ask for a path the
    // write-back command has no permission to store. No other template has one:
    // every other fact blocks some rows, this one blocks essentially all of them.
    gate_paths: [
      'work_authorization.authorized_to_work_us',
      'work_authorization.requires_sponsorship_future',
    ],
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
    // The write-back key is not left to the writer's imagination: each example
    // carries its own `profile_key`, and that same key is what the next run
    // looks for. Answer under a key of your own choosing and the question comes
    // back next run, which is the loop this category kept falling into.
    question: '有表单问到了系统无法安全推断的事实。请看下面原题，逐题给真实答案；写回 standard_qa.custom_facts 时，每一题都用它自己那条 profile_key 当键（换个键写＝下次还会问同一题）。',
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
 * @returns {Map<string, {value_type: string, enum_values: string[]|null, categories: string[]}>}
 */
export function answerWritePaths(templates = QUESTION_TEMPLATES) {
  const paths = new Map();
  for (const [category, template] of Object.entries(templates)) {
    for (const path of template.profile_paths || []) {
      const value_type = template.path_value_types?.[path] || template.value_type || 'string';
      const enum_values = template.path_enum_values?.[path] || null;
      const existing = paths.get(path);
      if (!existing) {
        paths.set(path, { value_type, enum_values, categories: [category] });
        continue;
      }
      if (existing.value_type !== value_type) {
        throw new Error(`answerWritePaths: ${path} is declared as both ${existing.value_type} and ${value_type}`);
      }
      if (JSON.stringify(existing.enum_values) !== JSON.stringify(enum_values)) {
        throw new Error(`answerWritePaths: ${path} is declared with two different enums`);
      }
      existing.categories.push(category);
    }
  }
  // A gated path is one the batch refuses to start without, so it must also be
  // one the write-back command can store, or the gate is a dead end. gate_paths
  // are declared as a subset of profile_paths, which makes this a check rather
  // than a merge — if it ever fires, the template is inconsistent with itself.
  for (const [category, template] of Object.entries(templates)) {
    for (const path of template.gate_paths || []) {
      if (!paths.has(path)) {
        throw new Error(`answerWritePaths: ${category} gates ${path} but does not declare it in profile_paths`);
      }
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
