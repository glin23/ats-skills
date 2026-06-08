const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthYear(value, fallback = 'May 2027') {
  const raw = String(value || '').trim();
  let m = raw.match(/^(\d{1,2})[/-](\d{4})$/);
  if (m) {
    const month = Number(m[1]);
    if (month >= 1 && month <= 12) return `${MONTHS[month - 1]} ${m[2]}`;
  }
  m = raw.match(/^(\d{4})[/-](\d{1,2})$/);
  if (m) {
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) return `${MONTHS[month - 1]} ${m[1]}`;
  }
  return raw || fallback;
}

export function graduationSelectValues(value, fallback = 'May 2027') {
  const primary = monthYear(value, fallback);
  const year = primary.match(/\b(20\d{2})\b/)?.[1];
  const lower = primary.toLowerCase();
  const values = [primary];
  if (year) {
    const termFallbacks = /december|fall|winter/.test(lower)
      ? [`December ${year}`, `June ${year}`]
      : [`June ${year}`, `December ${year}`];
    values.push(...termFallbacks, year);
  }
  return [...new Set(values.filter(Boolean))];
}

export function hoursPerWeekAnswer({ searchIntent = {}, profile = {}, bank = {} } = {}) {
  const candidates = [
    searchIntent.search_intent?.availability?.hours_per_week,
    searchIntent.search_intent?.hours_per_week,
    profile.standard_qa?.hours_per_week,
    profile.standard_qa?.hours_per_week_available,
    profile.target_filters?.hours_per_week,
    bank.fallback_text?.hours_per_week,
  ];
  for (const v of candidates) {
    if (typeof v === 'number' && Number.isFinite(v)) return String(Math.round(v));
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const targets = searchIntent.search_intent?.role_type_targets || [];
  if (targets.includes('part_time')) return '20';
  return '40';
}

export function gpaValue(profile = {}) {
  const raw = profile.education?.gpa ?? profile.standard_qa?.gpa ?? '';
  const value = String(raw || '').trim();
  return value;
}

export function gpaRangeCandidates(profile = {}) {
  const value = gpaValue(profile);
  const numeric = Number(value.match(/\d+(?:\.\d+)?/)?.[0] || NaN);
  if (!Number.isFinite(numeric)) return [];
  if (numeric >= 3.8) return ['3.8 - 4.0', '3.8-4.0'];
  if (numeric >= 3.6) return ['3.6 - 3.7', '3.6-3.7'];
  if (numeric >= 3.3) return ['3.3 - 3.5', '3.3-3.5'];
  if (numeric >= 3.0) return ['3.0 - 3.2', '3.0-3.2'];
  return ['Below 3.0', '< 3.0'];
}

export function bachelorProgressCandidates(profile = {}) {
  const education = profile.education || {};
  const degree = String(education.degree || '').toLowerCase();
  const enrolled = education.currently_enrolled === true;
  const bachelor = /bachelor|b\.?\s?[as]\.?|undergrad/.test(degree) || enrolled;
  if (!bachelor) return [];
  if (enrolled) {
    return [
      "Bachelor's Degree in Progress",
      'Bachelor’s Degree in Progress',
      'Bachelor Degree in Progress',
      'Currently pursuing',
      'In Progress',
      'Yes',
    ];
  }
  return [
    "Bachelor's Degree Completed",
    'Bachelor’s Degree Completed',
    'Bachelor Degree Completed',
    'Completed',
    'Yes',
  ];
}
