// remoteok_api.mjs — RemoteOK public JSON feed (no auth, no API key).
// Endpoint: https://remoteok.com/api  (returns array; first entry is metadata)
// Note: the historical remoteok.io domain 301s to remoteok.com; use .com directly.
// Free + open. Attribution recommended in any UI (we don't render a UI; SQLite + Datasette).
// Cloudflare-fronted: must send a browser-like User-Agent or it returns the HTML challenge.
// Rate-limit polite: 1 req/run is fine, board updates ~daily.
//
// Usage:
//   import { fetchRemoteOk, filterByKeywords, filterByExclude } from './remoteok_api.mjs';
//   const jobs = await fetchRemoteOk({ tags: ['ai', 'data', 'product'] });

const BASE = 'https://remoteok.com/api';
const DEFAULT_TIMEOUT_MS = 12000;

async function fetchWithTimeout(url, opts = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

// Map a RemoteOK raw entry to mrweirdo-jobs unified job shape.
function normalize(entry) {
  // RemoteOK fields: id, slug, epoch, date, company, position, tags[],
  //                  logo, description (html), url, apply_url, location,
  //                  salary_min, salary_max, ...
  if (!entry?.id || !entry?.position) return null;
  return {
    raw_id: String(entry.id),
    company: entry.company || '(unknown)',
    title: entry.position,
    url: entry.url || entry.apply_url || `https://remoteok.com/remote-jobs/${entry.id}`,
    apply_url: entry.apply_url || entry.url || null,
    location: entry.location || 'Remote',
    department: null,
    description: stripHtml(entry.description || ''),
    updated_at: entry.date || null,
    raw_tags: Array.isArray(entry.tags) ? entry.tags : [],
    salary_min: entry.salary_min || null,
    salary_max: entry.salary_max || null,
    salary_currency: entry.salary_min ? 'USD' : null,
    salary_interval: entry.salary_min ? 'year' : null,
    source: 'remoteok',
  };
}

export function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchRemoteOk(opts = {}) {
  const { tags = [], timeoutMs = DEFAULT_TIMEOUT_MS, limit = 500 } = opts;
  const url = tags.length
    ? `${BASE}?tags=${encodeURIComponent(tags.join(','))}`
    : BASE;
  const res = await fetchWithTimeout(url, {
    headers: {
      // RemoteOK rejects empty UA / generic curl on some paths
      // Cloudflare requires a browser-like UA; bare "curl/8.x" or library UA returns the JS challenge.
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) mrweirdo-jobs/1.3 Safari/537.36',
      accept: 'application/json',
    },
  }, timeoutMs);
  if (!res.ok) {
    throw new Error(`remoteok ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error('remoteok returned non-array');
  }
  // First entry is metadata (legal/attribution) — skip if not a job
  const jobs = data.filter((d) => d?.id && d?.position).map(normalize).filter(Boolean);
  return jobs.slice(0, limit);
}

// Filter jobs by including ANY of `tags` (case-insensitive substring match on
// position/title/description/tags). Useful when you want to narrow by domain
// (e.g., "ai", "product", "marketing").
export function filterByKeywords(jobs, keywords = []) {
  if (!keywords.length) return jobs;
  const needles = keywords.map((k) => k.toLowerCase());
  return jobs.filter((j) => {
    const hay = [
      j.title,
      j.description,
      ...(j.raw_tags || []),
    ].filter(Boolean).join(' ').toLowerCase();
    return needles.some((n) => hay.includes(n));
  });
}

// Exclude jobs whose title or tags match excludeKeywords (case-insensitive word-boundary).
export function filterByExclude(jobs, excludeKeywords = []) {
  if (!excludeKeywords.length) return jobs;
  const patterns = excludeKeywords.map((k) => new RegExp(`\\b${escapeRegex(k)}\\b`, 'i'));
  return jobs.filter((j) => {
    const hay = [j.title, ...(j.raw_tags || [])].filter(Boolean).join(' ');
    return !patterns.some((p) => p.test(hay));
  });
}

// Filter by role-type — RemoteOK doesn't expose role-type fields, so this is
// a best-effort title-substring check matching the same heuristic as
// greenhouse_board_api.classifyRoleType.
export function filterByRoleType(jobs, roleTypes = ['intern', 'new_grad_FT']) {
  if (!roleTypes.length) return jobs;
  return jobs.filter((j) => roleTypes.includes(classifyRoleType(j.title)));
}

export function classifyRoleType(title) {
  if (!title) return 'other';
  const t = title.toLowerCase();
  if (/\b(intern|internship|co[\s-]?op)\b/.test(t)) return 'intern';
  if (/\b(new[\s-]?grad|university|new[\s-]?graduate|early[\s-]?career|junior|associate)\b/.test(t)) {
    return 'new_grad_FT';
  }
  return 'other';
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Filter by location strings (whitelist substring match).
// RemoteOK is mostly remote-friendly, so most jobs say "Remote" or include "US Only".
export function filterByLocation(jobs, allowedPatterns = []) {
  if (!allowedPatterns.length) return jobs;
  const lc = allowedPatterns.map((p) => p.toLowerCase());
  return jobs.filter((j) => {
    const loc = (j.location || '').toLowerCase();
    if (!loc.trim()) return true; // empty location → keep, downstream will judge
    return lc.some((p) => loc.includes(p));
  });
}

// ---------- CLI ----------
const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'fetch') {
      const tagArg = process.argv[3]; // optional comma-separated tags
      const tags = tagArg ? tagArg.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const jobs = await fetchRemoteOk({ tags, limit: 50 });
      console.log(JSON.stringify({ count: jobs.length, sample: jobs.slice(0, 5) }, null, 2));
    } else {
      console.error('Usage: node shared/sourcing/remoteok_api.mjs fetch [tag1,tag2,...]');
      process.exit(1);
    }
  } catch (e) {
    console.error('remoteok error:', e.message);
    process.exit(1);
  }
}
