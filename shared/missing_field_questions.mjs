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
