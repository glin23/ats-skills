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
