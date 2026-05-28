export const SUBMITTED_STATUSES = new Set(['✅ 已投', '✅ 已确认']);

export function normalizeCompany(s = '') {
  let n = String(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  n = n.replace(/\b(inc|llc|ltd|corp|corporation|company|co)\b/g, '').trim();
  n = n.replace(/\s+/g, '');
  return n.replace(/(jobs|careers)$/g, '');
}

export function normalizeTitle(s = '') {
  return String(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\u00a0/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(internship)\b/g, 'intern')
    .replace(/\b(co op|coop)\b/g, 'intern')
    .replace(/\bintern\s+intern\b/g, 'intern')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sameCompanyTitle(a = {}, b = {}) {
  return normalizeCompany(a.company) === normalizeCompany(b.company) &&
    normalizeTitle(a.title) === normalizeTitle(b.title);
}
