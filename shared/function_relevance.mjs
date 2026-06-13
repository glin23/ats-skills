export const FUNCTION_RELEVANCE_TOO_DISTANT_REASON = 'function_relevance_too_distant';

// The deterministic named anchor map is intentionally high-confidence:
// ops_pm and swe currently have named anchor families. Other target functions
// rely on explicit target_function_anchor.excluded_functions plus the scorer;
// unknown relevance remains non-blocking.
const FAMILY_PATTERNS = {
  ops_pm: [
    /\b(product management|product manager|associate product manager|apm)\b/i,
    /\b(program management|program manager)\b/i,
    /\b(business operations|bizops|biz ops|strategic operations)\b/i,
    /\b(strategy|strategic initiatives|chief of staff)\b/i,
    /\boperations (intern|associate|coordinator|analyst|specialist|manager|management)\b/i,
  ],
  swe: [
    /\b(swe|software engineering|software engineer|software developer|software development)\b/i,
    /\b(back[-\s]?end|front[-\s]?end|full[-\s]?stack|fullstack|platform|devops|site reliability|sre|mobile|ios|android|web) (engineer|developer|intern|co[-\s]?op)\b/i,
    /\b(qa|quality assurance) (engineer|analyst|intern|co[-\s]?op)\b/i,
    /\b(cloud|infrastructure) (engineer|developer|intern|co[-\s]?op)\b/i,
  ],
  data: [
    /\b(data analyst|data analytics|data science|data scientist|business intelligence|bi analyst|analytics intern)\b/i,
    /\b(machine learning|ml engineer|ai engineer)\b/i,
  ],
  design: [
    /\b(product designer|ux designer|ui designer|graphic designer|visual designer|design intern|design internship)\b/i,
    /\b(ux|ui|user experience|user interface) (design|designer|intern)\b/i,
  ],
  nursing: [
    /\b(nursing|nurse|registered nurse|rn|lpn|cna|clinical nurse)\b/i,
  ],
  marketing: [
    /\b(marketing|growth marketing|brand marketing|content marketing|demand generation|social media|seo|sem)\b/i,
  ],
  accounting: [
    /\b(accounting|accountant|audit|auditor|tax intern|tax associate|cpa)\b/i,
  ],
  consulting: [
    /\b(consulting|consultant|advisory intern|management consulting)\b/i,
  ],
};

const ANCHOR_PATTERNS = {
  ops_pm: [
    /\b(operations|ops|product management|product manager|pm|apm|bizops|biz ops|strategy|program management|program manager)\b/i,
  ],
  swe: [
    /\b(swe|software engineering|software engineer|software developer|backend|back[-\s]?end|frontend|front[-\s]?end|full[-\s]?stack|fullstack|platform|devops|qa|quality assurance|mobile|ios|android)\b/i,
  ],
};

const DISTANT_BY_ALLOWED_FAMILY = {
  ops_pm: new Set(['swe', 'data', 'design', 'nursing']),
  swe: new Set(['marketing', 'accounting', 'nursing', 'design', 'consulting', 'ops_pm']),
};

const AMBIGUOUS_TITLE_PATTERNS = [
  /\bbusiness analyst\b/i,
  /\bproduct analyst\b/i,
  /\boperations engineer\b/i,
  /\bsales engineer\b/i,
  /\bsolutions engineer\b/i,
  /\bproduct engineer\b/i,
];

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function norm(value) {
  return compact(value).toLowerCase();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asSearchIntent(intentDoc = {}) {
  return intentDoc.search_intent || intentDoc || {};
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(compact).filter(Boolean);
}

function roleCategoryTitles(searchIntent = {}) {
  return Array.isArray(searchIntent.role_categories)
    ? searchIntent.role_categories.map((item) => compact(item?.title_pattern)).filter(Boolean)
    : [];
}

function anchorTerms(intentDoc = {}) {
  const searchIntent = asSearchIntent(intentDoc);
  const anchor = searchIntent.target_function_anchor || {};
  return [
    ...stringList(anchor.self_reported_target_functions),
    ...stringList(anchor.adjacent_functions),
    ...stringList(anchor.resume_supported_functions),
    ...stringList(searchIntent.function_area),
    ...roleCategoryTitles(searchIntent),
  ];
}

function excludedTerms(intentDoc = {}) {
  const searchIntent = asSearchIntent(intentDoc);
  const anchor = searchIntent.target_function_anchor || {};
  return [
    ...stringList(anchor.excluded_functions),
    ...stringList(searchIntent.exclude_role_keywords),
  ];
}

function familiesForText(value, patternMap = FAMILY_PATTERNS) {
  const text = compact(value);
  const families = new Set();
  if (!text) return families;
  for (const [family, patterns] of Object.entries(patternMap)) {
    if (patterns.some((pattern) => pattern.test(text))) families.add(family);
  }
  return families;
}

function allowedFamiliesForIntent(intentDoc = {}) {
  const allowed = new Set();
  for (const term of anchorTerms(intentDoc)) {
    for (const [family, patterns] of Object.entries(ANCHOR_PATTERNS)) {
      if (patterns.some((pattern) => pattern.test(term))) allowed.add(family);
    }
  }
  return allowed;
}

function excludedFamiliesForIntent(intentDoc = {}) {
  const excluded = new Set();
  for (const term of excludedTerms(intentDoc)) {
    for (const family of familiesForText(term)) excluded.add(family);
    for (const [family, patterns] of Object.entries(ANCHOR_PATTERNS)) {
      if (patterns.some((pattern) => pattern.test(term))) excluded.add(family);
    }
  }
  return excluded;
}

function directAnchorMatchesTitle(title, intentDoc = {}) {
  const text = ` ${norm(title)} `;
  const matches = [];
  for (const raw of anchorTerms(intentDoc)) {
    const term = norm(raw)
      .replace(/\b(internship|intern|co-?op|part[\s-]?time|new\s?grad|new\s?graduate|associate)\b/g, ' ')
      .replace(/[^a-z0-9+#.\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!term) continue;
    if (term.length < 3 && !['pm', 'qa', 'ui', 'ux'].includes(term)) continue;
    const pattern = new RegExp(`\\b${escapeRegex(term).replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (pattern.test(text)) matches.push(raw);
  }
  return matches;
}

function titleFamilies(row = {}) {
  const title = compact(row.title);
  if (!title) return { families: new Set(), ambiguous: false, ambiguous_reason: '' };
  const ambiguous = AMBIGUOUS_TITLE_PATTERNS.find((pattern) => pattern.test(title));
  if (ambiguous) {
    return {
      families: new Set(),
      ambiguous: true,
      ambiguous_reason: `ambiguous_title:${ambiguous.source}`,
    };
  }
  return { families: familiesForText(title), ambiguous: false, ambiguous_reason: '' };
}

function unionDistantFamilies(allowedFamilies) {
  const distant = new Set();
  for (const family of allowedFamilies) {
    for (const blocked of DISTANT_BY_ALLOWED_FAMILY[family] || []) distant.add(blocked);
  }
  return distant;
}

export function assessFunctionRelevance(row = {}, intentDoc = {}) {
  const title = compact(row.title);
  const allowed = allowedFamiliesForIntent(intentDoc);
  const excluded = excludedFamiliesForIntent(intentDoc);
  const directMatches = directAnchorMatchesTitle(title, intentDoc);
  const titleInfo = titleFamilies(row);
  const families = titleInfo.families;

  const base = {
    status: 'unknown',
    reason: 'no_high_confidence_function_boundary',
    title,
    allowed_families: [...allowed].sort(),
    title_families: [...families].sort(),
    excluded_families: [...excluded].sort(),
    direct_anchor_matches: directMatches,
  };

  if (!title) return { ...base, reason: 'missing_title' };
  if (titleInfo.ambiguous) return { ...base, reason: titleInfo.ambiguous_reason };
  if (directMatches.length > 0) {
    return { ...base, status: 'direct', reason: 'title_matches_target_function_anchor' };
  }
  if (families.size === 0) return base;

  for (const family of families) {
    if (allowed.has(family)) {
      return { ...base, status: 'adjacent', reason: `title_family_allowed:${family}` };
    }
  }

  for (const family of families) {
    if (excluded.has(family)) {
      return { ...base, status: 'too_distant', reason: `title_family_explicitly_excluded:${family}` };
    }
  }

  if (allowed.size === 0) return base;

  const distant = unionDistantFamilies(allowed);
  for (const family of families) {
    if (distant.has(family)) {
      return { ...base, status: 'too_distant', reason: `title_family_too_distant:${family}` };
    }
  }

  return base;
}

export function functionRelevanceBlockReason(row = {}, intentDoc = {}) {
  return assessFunctionRelevance(row, intentDoc).status === 'too_distant'
    ? FUNCTION_RELEVANCE_TOO_DISTANT_REASON
    : null;
}
