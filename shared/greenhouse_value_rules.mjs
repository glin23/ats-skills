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

function parseMonthYear(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let m = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return { year: Number(m[1]), month: Number(m[2]) };
  m = raw.match(/^(\d{4})-(\d{1,2})-\d{1,2}$/);
  if (m) return { year: Number(m[1]), month: Number(m[2]) };
  m = raw.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  if (m) return { year: Number(m[2]), month: MONTHS.findIndex((x) => x.toLowerCase() === m[1].toLowerCase()) + 1 };
  m = raw.match(/\b(20\d{2})\b/);
  if (m) return { year: Number(m[1]), month: 12 };
  return null;
}

function monthIndex({ year, month }) {
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return year * 12 + month;
}

function addMonths(ym, months) {
  const idx = monthIndex(ym);
  if (idx == null) return null;
  const next = idx + months;
  return { year: Math.floor((next - 1) / 12), month: ((next - 1) % 12) + 1 };
}

function requestedStartFromLabel(labelText) {
  const raw = String(labelText || '');
  const m = raw.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  if (!m) return null;
  return { year: Number(m[2]), month: MONTHS.findIndex((x) => x.toLowerCase() === m[1].toLowerCase()) + 1 };
}

function requestedDurationMonths(labelText) {
  const raw = String(labelText || '');
  let m = raw.match(/\b(\d+)\s*[-–]\s*(\d+)\s*months?\b/i);
  if (m) return Number(m[2]);
  m = raw.match(/\b(?:period of|for)\s+(\d+)\s*months?\b/i);
  if (m) return Number(m[1]);
  return null;
}

function weeklyHoursFromTimeWindow(labelText) {
  const raw = String(labelText || '');
  const m = raw.match(/\b(\d{1,2})\s*(?::\d{2})?\s*[-–]\s*(\d{1,2})\s*(?::\d{2})?\s*(am|pm)\b/i);
  if (!m) return null;
  let start = Number(m[1]);
  let end = Number(m[2]);
  const meridiem = m[3].toLowerCase();
  if (meridiem === 'pm' && start < 12) start += 12;
  if (meridiem === 'pm' && end < 12) end += 12;
  const daily = Math.max(0, end - start);
  return daily ? daily * 5 : null;
}

function maxHoursPerWeek(value) {
  const nums = String(value || '').match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  if (!nums.length) return null;
  return Math.max(...nums);
}

function explicitHoursPerWeekAnswer({ searchIntent = {}, profile = {}, bank = {} } = {}) {
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
  return '';
}

export function availabilityCommitmentAnswer(labelText, { searchIntent = {}, profile = {}, bank = {} } = {}) {
  const lt = String(labelText || '').toLowerCase();
  if (!/available|availability|commit/.test(lt)) return null;
  if (!/(hours?|months?|period|january|february|march|april|may|june|july|august|september|october|november|december|summer|fall|spring|internship|part[- ]?time)/.test(lt)) {
    return null;
  }

  const hoursText = explicitHoursPerWeekAnswer({ searchIntent, profile, bank });
  const requiredWeeklyHours = weeklyHoursFromTimeWindow(labelText) ||
    (lt.match(/\b(\d+)\s*(?:hours?|hrs?)\b/) ? Number(lt.match(/\b(\d+)\s*(?:hours?|hrs?)\b/)[1]) : null);
  const hasEnoughHours = requiredWeeklyHours == null || (hoursText && (maxHoursPerWeek(hoursText) ?? 0) >= requiredWeeklyHours);

  const requestedStart = requestedStartFromLabel(labelText);
  const earliest = parseMonthYear(profile.standard_qa?.earliest_start_date || searchIntent.search_intent?.availability?.earliest_start_date);
  const startsInTime = !requestedStart || (earliest && monthIndex(earliest) <= monthIndex(requestedStart));

  const duration = requestedDurationMonths(labelText);
  const availableUntil = parseMonthYear(profile.standard_qa?.available_until || searchIntent.search_intent?.availability?.available_until);
  const requestedEnd = requestedStart && duration ? addMonths(requestedStart, duration) : null;
  const lastsLongEnough = !requestedEnd || (availableUntil && monthIndex(availableUntil) >= monthIndex(requestedEnd));

  if (hasEnoughHours && startsInTime && lastsLongEnough) {
    return {
      value: 'Yes',
      candidates: ['Yes', 'Yes, I am available', 'I am available', 'I can commit', 'Available', 'Confirm'],
      note: 'profile_availability_commitment',
    };
  }
  return { needs_user_answer: true, note: 'availability_commitment_answer_required' };
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

// Does the profile's degree string describe a GRADUATE degree (master's /
// MBA / doctorate)? Word-anchored on purpose: an unanchored match would read
// "ms" out of "Information Systems" and "ma" out of "Marketing", making an
// undergraduate claim a master's degree on a real application form.
export function isGraduateDegree(degree = '') {
  const d = String(degree || '').toLowerCase();
  return /\bmaster'?s?\b|\bmba\b|\bm\.?\s?s\.?\b|\bm\.?\s?a\.?\b|\bm\.?eng\b|\bph\.?\s?d\b|\bdoctora(?:l|te)\b/.test(d);
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
