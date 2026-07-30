function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value != null && typeof value !== 'object') return String(value);
  }
  return '';
}

// ADR-12 R1/R3: this function produces EMPLOYER-FACING text, so it may not read
// `visa_status` (system-only since ADR-12 — it used to be rendered verbatim,
// which turned a design-invented label, and in two branches the user's own
// Chinese sentence, into a self-declaration on a real English form). Only the
// three-state booleans speak here, and each reads with three branches: `null`
// means the clause does not appear at all — never "does not require", which is
// a claim nobody made and the I-9 employment-verification step can contradict.
function authSummary(profile = {}) {
  const auth = profile.work_authorization || {};
  const parts = [];
  if (auth.authorized_to_work_us === true) parts.push('authorized to work in the United States');
  if (auth.requires_sponsorship_future === true) {
    parts.push('may require future sponsorship depending on the role');
  } else if (auth.requires_sponsorship_future === false) {
    parts.push('does not require future sponsorship based on the current profile');
  }
  return parts.join('; ');
}

export function renderAnswerTemplate(template, { profile = {}, companyPretty = '', searchIntent = {} } = {}) {
  const personal = profile.personal || {};
  const education = profile.education || {};
  const standard = profile.standard_qa || {};
  const latestExperience = Array.isArray(profile.experience_summary) ? profile.experience_summary[0] : null;
  const roleCategories = searchIntent.search_intent?.role_categories || [];
  const roleTargets = roleCategories.map((r) => r.title_pattern).filter(Boolean).slice(0, 3).join(', ');

  const values = {
    COMPANY_PRETTY: companyPretty,
    SCHOOL: firstNonEmpty(education.school),
    DEGREE: firstNonEmpty(education.degree),
    MAJOR: firstNonEmpty(education.major),
    GRADUATION_DATE: firstNonEmpty(education.graduation_date),
    LINKEDIN: firstNonEmpty(personal.linkedin),
    PORTFOLIO: firstNonEmpty(personal.portfolio, personal.website, personal.github, personal.linkedin),
    GITHUB: firstNonEmpty(personal.github),
    FAVORITE_PROJECT: firstNonEmpty(standard.favorite_project, standard.why_role, 'a recent project where I owned research, execution, and iteration'),
    WHY_COMPANY: firstNonEmpty(standard.why_company, `the opportunity to contribute practical work at ${companyPretty}`),
    WHY_ROLE: firstNonEmpty(standard.why_role, roleTargets, 'the responsibilities match my academic and project background'),
    BIGGEST_STRENGTH: firstNonEmpty(standard.biggest_strength, 'learning quickly, taking ownership, and communicating clearly'),
    BIGGEST_WEAKNESS: firstNonEmpty(standard.biggest_weakness, 'continuing to improve documentation and handoffs as projects grow'),
    EARLIEST_START_DATE: firstNonEmpty(standard.earliest_start_date, 'the internship start date listed for the role'),
    HOURS_PER_WEEK: firstNonEmpty(standard.hours_per_week, '20'),
    WORK_AUTH_SUMMARY: authSummary(profile),
    LATEST_COMPANY: firstNonEmpty(latestExperience?.company),
    LATEST_TITLE: firstNonEmpty(latestExperience?.title),
  };

  return String(template || '')
    .replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_, key) => values[key] || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
