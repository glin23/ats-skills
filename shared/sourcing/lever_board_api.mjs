/**
 * lever_board_api.mjs — Lever Postings API client (zero npm dep, Node 24 ESM)
 *
 * Public endpoint (no auth):
 *   https://api.lever.co/v0/postings/{site}?mode=json
 *
 * Lever returns a flat JSON array of postings. Each posting carries:
 *   - id, text (title)
 *   - categories: { location, department, team, commitment }
 *     `commitment` is the closest thing to an employment-type enum
 *     ("Intern" / "Full-time" / "Contract" / ...).
 *   - description / descriptionPlain (the latter is plain text — preferred)
 *   - hostedUrl (canonical job page) / applyUrl (the form)
 *   - createdAt (epoch ms)
 *   - salaryRange: { min, max, currency, interval } — Lever surfaces salary
 *     more often than Greenhouse, so the dashboard `hourly_rate` column has
 *     a real value to render here.
 *
 * Interface mirrors greenhouse_board_api.mjs / ashby_board_api.mjs so the
 * sourcing pipeline can route to whichever client matches the slug.
 *
 * Throttling: shared 1 req/sec gate across all fetchJobs() calls in this
 * module — callers can Promise.all() across N companies and still produce
 * polite traffic.
 *
 * Error policy:
 *   - 404 (board does not exist) → return [] + warn, no throw
 *   - 5xx → retry once with 2s backoff, then throw
 *   - Network errors → throw (caller decides retry semantics)
 */

const BASE = 'https://api.lever.co/v0/postings';
const DEFAULT_TIMEOUT_MS = 12000;
const MIN_INTERVAL_MS = 1000; // 1 req/sec
const RETRY_BACKOFF_MS = 2000;
const USER_AGENT = 'ats-skills/0.8 (+sourcing/lever)';

let _lastFetchAt = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function _rateLimitGate() {
  const now = Date.now();
  const delta = now - _lastFetchAt;
  if (delta < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - delta);
  }
  _lastFetchAt = Date.now();
}

async function _doFetch(url, { timeout, abort } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(new Error('timeout')), timeout ?? DEFAULT_TIMEOUT_MS);
  if (abort) {
    if (abort.aborted) ctrl.abort(abort.reason);
    else abort.addEventListener('abort', () => ctrl.abort(abort.reason), { once: true });
  }
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
  } finally {
    clearTimeout(to);
  }
}

/**
 * Normalize a Lever raw posting to the shared sourcing shape.
 *
 * Note: `salary` is included as a structured `{min, max, currency, interval}`
 * sub-object only when Lever surfaces it. Other ATS clients (Greenhouse) may
 * not have this field — downstream code should treat it as optional.
 */
function _normalizeJob(slug, raw) {
  const cats = raw.categories || {};
  const sr = raw.salaryRange;
  const salary =
    sr && (sr.min != null || sr.max != null)
      ? {
          min: sr.min ?? null,
          max: sr.max ?? null,
          currency: sr.currency || 'USD',
          interval: sr.interval || 'year',
        }
      : null;
  return {
    source: 'lever',
    company: slug,
    title: raw.text || '',
    url: raw.hostedUrl || raw.applyUrl || '',
    apply_url: raw.applyUrl || raw.hostedUrl || '',
    location: cats.location || '',
    description: raw.descriptionPlain || raw.description || '',
    department: cats.department || cats.team || '',
    team: cats.team || '',
    commitment: cats.commitment || '', // "Intern" / "Full-time" / "Contract"
    updated_at: raw.createdAt ? new Date(raw.createdAt).toISOString() : '',
    salary, // {min, max, currency, interval} or null
    raw_id: raw.id,
  };
}

/**
 * fetchJobs(slug, opts?) — fetch + normalize the entire Lever board for `slug`.
 *
 * Returns: Promise<Array<NormalizedJob>>
 * 404 → [] (warn-and-continue, lets curated company lists degrade gracefully).
 */
export async function fetchJobs(slug, opts = {}) {
  if (!slug || typeof slug !== 'string') {
    throw new TypeError('fetchJobs(slug): slug must be a non-empty string');
  }
  const url = `${BASE}/${encodeURIComponent(slug)}?mode=json`;
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS;
  const abort = opts.abort ?? null;

  await _rateLimitGate();

  let res;
  try {
    res = await _doFetch(url, { timeout, abort });
  } catch (err) {
    throw new Error(`lever fetchJobs(${slug}) network error: ${err.message}`);
  }

  if (res.status === 404) {
    console.warn(`[lever] 404 for slug "${slug}" — no job board found`);
    return [];
  }

  if (res.status >= 500 && res.status < 600) {
    await sleep(RETRY_BACKOFF_MS);
    await _rateLimitGate();
    res = await _doFetch(url, { timeout, abort });
    if (!res.ok) {
      throw new Error(`lever fetchJobs(${slug}) HTTP ${res.status} after retry`);
    }
  } else if (!res.ok) {
    throw new Error(`lever fetchJobs(${slug}) HTTP ${res.status}`);
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw new Error(`lever fetchJobs(${slug}) JSON parse error: ${err.message}`);
  }

  // Lever returns a top-level array, not a `{jobs: [...]}` envelope.
  const postings = Array.isArray(body) ? body : [];
  return postings.map((p) => _normalizeJob(slug, p));
}

/**
 * fetchJobsForCompany(companyName, slugCandidates, opts?) — try each candidate
 * slug until one returns a non-empty board. Lever slugs are usually the company
 * name lowercased (e.g. "palantir", "scaleai"), but some shops have suffixes.
 *
 * Returns the first non-empty result, with `company` overwritten to the
 * caller-supplied human name. Returns [] when all candidates 404 / are empty.
 */
export async function fetchJobsForCompany(companyName, slugCandidates, opts = {}) {
  const candidates = Array.isArray(slugCandidates)
    ? slugCandidates.filter(Boolean)
    : [slugCandidates].filter(Boolean);
  if (!candidates.length) {
    throw new TypeError('fetchJobsForCompany: at least one slug candidate required');
  }

  const tried = [];
  for (const slug of candidates) {
    tried.push(slug);
    try {
      const jobs = await fetchJobs(slug, opts);
      if (jobs.length) {
        return jobs.map((j) => ({ ...j, company: companyName, slug }));
      }
    } catch (err) {
      console.warn(`[lever] ${companyName} via "${slug}" failed: ${err.message}`);
    }
  }
  console.warn(`[lever] no jobs found for ${companyName} (tried: ${tried.join(', ')})`);
  return [];
}

// ---------- role-type filtering ----------

const INTERN_TITLE_RE = /\b(intern|internship|co-?op|summer\s+202[5-7])\b/i;
const NEW_GRAD_TITLE_RE =
  /\b(new\s?grad|new\s?graduate|university\s?grad|university\s?graduate|early\s?career|recent\s?graduate|college\s?grad)\b/i;

function _normalizeCommitment(c) {
  return String(c || '').trim().toLowerCase();
}

function matchesIntern(job) {
  const c = _normalizeCommitment(job.commitment);
  if (c === 'intern' || c === 'internship') return true;
  return INTERN_TITLE_RE.test(job.title || '');
}

function matchesNewGradFT(job) {
  const c = _normalizeCommitment(job.commitment);
  // Lever's "Full-time" includes the hyphen; be lenient.
  const isFT = c === 'full-time' || c === 'fulltime' || c === 'full time';
  if (!isFT) return false;
  if (INTERN_TITLE_RE.test(job.title || '')) return false; // never double-count
  return NEW_GRAD_TITLE_RE.test(job.title || '');
}

/**
 * classifyRoleType(job) — convenience for callers that want a single label.
 * Returns 'intern' | 'new_grad_FT' | 'other'.
 */
export function classifyRoleType(job) {
  if (!job) return 'other';
  if (matchesIntern(job)) return 'intern';
  if (matchesNewGradFT(job)) return 'new_grad_FT';
  return 'other';
}

/**
 * filterByRoleType(jobs, roleTypes) — keep only intern / new_grad_FT jobs.
 * Uses BOTH `categories.commitment` AND title regex for resilience (some Lever
 * shops mis-tag their intern roles as "Full-time").
 *
 * Returns new array with `role_type` attached so downstream stages (AI scorer,
 * Notion sync) don't have to re-classify.
 */
export function filterByRoleType(jobs, roleTypes = ['intern', 'new_grad_FT']) {
  if (!Array.isArray(jobs)) return [];
  const wantIntern = roleTypes.includes('intern');
  const wantNewGrad = roleTypes.includes('new_grad_FT');
  if (!wantIntern && !wantNewGrad) return [];
  const out = [];
  for (const j of jobs) {
    if (wantIntern && matchesIntern(j)) {
      out.push({ ...j, role_type: 'intern' });
      continue;
    }
    if (wantNewGrad && matchesNewGradFT(j)) {
      out.push({ ...j, role_type: 'new_grad_FT' });
    }
  }
  return out;
}

// ---------- CLI smoke test ----------
// Usage: node shared/sourcing/lever_board_api.mjs <slug>
if (import.meta.url === `file://${process.argv[1]}`) {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: node lever_board_api.mjs <slug>');
    process.exit(1);
  }
  const jobs = await fetchJobs(slug);
  const filtered = filterByRoleType(jobs);
  console.log(
    JSON.stringify(
      {
        slug,
        total: jobs.length,
        filtered: filtered.length,
        sample: filtered.slice(0, 3).map((j) => ({
          title: j.title,
          commitment: j.commitment,
          location: j.location,
          salary: j.salary,
          url: j.url,
        })),
      },
      null,
      2,
    ),
  );
}
