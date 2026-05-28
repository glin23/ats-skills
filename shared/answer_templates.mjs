function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value != null && typeof value !== 'object') return String(value);
  }
  return '';
}

function authSummary(profile = {}) {
  const auth = profile.work_authorization || {};
  if (auth.visa_status) {
    const needsFuture = auth.requires_sponsorship_future === true
      ? 'may require future sponsorship depending on the role'
      : 'does not require future sponsorship based on the current profile';
    return `${auth.visa_status}; ${needsFuture}`;
  }
  if (auth.authorized_to_work_us === true) return 'authorized to work in the United States';
  return '';
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
