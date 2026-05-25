/**
 * greenhouse_board_api.mjs — Greenhouse public Job Board API client.
 *
 * Greenhouse exposes an unauthenticated JSON endpoint per customer:
 *   https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
 *
 * This module is the L1 sourcing layer for v0.3 (see Phase Plan v0.3).
 * It is zero-dep — uses Node 24 built-in `fetch` only — so the skill
 * does not need an npm install / package.json. Intended to be imported
 * from `shared/sourcing/source_runner.mjs` (later phase).
 *
 * Throttling: a single shared 1 req/sec gate is enforced across all
 * `fetchJobs()` calls in this module, so callers can `Promise.all(...)`
 * across 15 companies and still get sequential, polite traffic.
 *
 * Error policy:
 *   - 404 (board does not exist for slug) → return [] + log warn, no throw
 *   - 5xx → retry once with 2s backoff, then throw
 *   - Network/AbortError → throw (caller decides retry semantics)
 *
 * The returned job shape is normalized so Greenhouse + Ashby (sibling
 * module) jobs can be merged into one feed downstream:
 *   {
 *     source: 'greenhouse',
 *     company, title, url, location, description, department,
 *     updated_at, raw_id
 *   }
 */

const BASE = 'https://boards-api.greenhouse.io/v1/boards';
const DEFAULT_TIMEOUT_MS = 12000;

// Shared rate-limit gate: at most 1 fetch every 1000ms across all calls.
let _lastFetchAt = 0;
const MIN_INTERVAL_MS = 1000;

async function _rateLimitGate() {
  const now = Date.now();
  const delta = now - _lastFetchAt;
  if (delta < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - delta));
  }
  _lastFetchAt = Date.now();
}

/**
 * stripHtml(html) — turn Greenhouse `content` HTML into plain text.
 *
 * Greenhouse returns `content` as escaped HTML (e.g. "&lt;p&gt;..."). We
 * decode the most common entities, strip tags via a permissive regex,
 * and collapse whitespace. This is intentionally dependency-free —
 * good enough for feeding into the AI scorer. Not a security boundary.
 */
export function stripHtml(html) {
  if (html == null) return '';
  let s = String(html);
  // Decode the entities Greenhouse actually emits.
  s = s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  // Drop all tags.
  s = s.replace(/<[^>]*>/g, ' ');
  // Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function _normalizeJob(slug, raw) {
  const location =
    (raw.location && raw.location.name) ||
    (Array.isArray(raw.offices) && raw.offices[0] && raw.offices[0].name) ||
    '';
  const department =
    Array.isArray(raw.departments) && raw.departments[0] && raw.departments[0].name
      ? raw.departments[0].name
      : '';
  return {
    source: 'greenhouse',
    company: slug,
    title: raw.title || '',
    url: raw.absolute_url || '',
    location,
    description: stripHtml(raw.content || ''),
    department,
    updated_at: raw.updated_at || '',
    raw_id: raw.id,
  };
}

async function _doFetch(url, { timeout, abort } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(new Error('timeout')), timeout ?? DEFAULT_TIMEOUT_MS);
  // Chain caller-provided abort signal, if any.
  if (abort) {
    if (abort.aborted) ctrl.abort(abort.reason);
    else abort.addEventListener('abort', () => ctrl.abort(abort.reason), { once: true });
  }
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'mrweirdo-jobs/1.3 (+sourcing)' },
    });
  } finally {
    clearTimeout(to);
  }
}

/**
 * fetchJobs(slug, opts?) — fetch + normalize the entire job board for a slug.
 *
 * Returns: Promise<Array<NormalizedJob>>
 *
 * 404 → [] (silent-ish — logs a warning, does not throw, so a curated
 * company list with stale slugs degrades gracefully).
 */
export async function fetchJobs(slug, opts = {}) {
  if (!slug || typeof slug !== 'string') {
    throw new TypeError('fetchJobs(slug): slug must be a non-empty string');
  }
  const url = `${BASE}/${encodeURIComponent(slug)}/jobs?content=true`;
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS;
  const abort = opts.abort ?? null;

  await _rateLimitGate();

  let res;
  try {
    res = await _doFetch(url, { timeout, abort });
  } catch (err) {
    throw new Error(`greenhouse fetchJobs(${slug}) network error: ${err.message}`);
  }

  if (res.status === 404) {
    // Board does not exist for this slug — common when company_list.json has
    // a guess. Treat as "no jobs", let caller move on.
    console.warn(`[greenhouse] 404 for slug "${slug}" — no job board found`);
    return [];
  }

  if (res.status >= 500 && res.status < 600) {
    // Single retry with 2s backoff.
    await new Promise((r) => setTimeout(r, 2000));
    await _rateLimitGate();
    res = await _doFetch(url, { timeout, abort });
    if (!res.ok) {
      throw new Error(`greenhouse fetchJobs(${slug}) HTTP ${res.status} after retry`);
    }
  } else if (!res.ok) {
    throw new Error(`greenhouse fetchJobs(${slug}) HTTP ${res.status}`);
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw new Error(`greenhouse fetchJobs(${slug}) JSON parse error: ${err.message}`);
  }

  const jobs = Array.isArray(body.jobs) ? body.jobs : [];
  return jobs.map((j) => _normalizeJob(slug, j));
}

/**
 * fetchJobsForCompany(companyName, slugCandidates, opts?) — try each slug
 * until one returns a non-empty board. Useful when Greenhouse slugs are
 * inconsistent (e.g. "openai" vs "openai-1" vs "openaicareers").
 *
 * Returns the first non-empty result. If all slugs 404 / are empty, returns
 * an empty array tagged with the candidates attempted (for logging upstream).
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
        // Overwrite the slug-as-company with the human name caller provided.
        return jobs.map((j) => ({ ...j, company: companyName, slug }));
      }
    } catch (err) {
      console.warn(`[greenhouse] ${companyName} via "${slug}" failed: ${err.message}`);
    }
  }
  console.warn(`[greenhouse] no jobs found for ${companyName} (tried: ${tried.join(', ')})`);
  return [];
}

/**
 * Title heuristics — classify a Greenhouse job as 'intern', 'new_grad_FT',
 * or 'other'. Conservative: prefer false negatives over polluting the
 * sourced feed with FT roles labeled as new-grad.
 *
 * Word boundaries (\b) required: without them, "Internal Audit" / "International X"
 * match /intern/i. Dry-run 2026-05-23 showed 61/168 (36%) false positives without \b.
 */
export function classifyRoleType(title) {
  if (!title) return 'other';
  const t = String(title);
  const internRe = /\b(intern|internship|co-?op)\b|\bsummer\s+202[5-7]\b/i;
  const newGradRe = /\b(new\s+grad|new\s+graduate|university\s+grad|early\s+career)\b|\bassociate\s*\([^)]*new/i;
  if (internRe.test(t)) return 'intern';
  if (newGradRe.test(t)) return 'new_grad_FT';
  return 'other';
}

/**
 * filterByRoleType(jobs, roleTypes) — keep only jobs whose classified
 * role type is in `roleTypes`. Default: intern + new_grad_FT.
 *
 * Mutates nothing; returns a new array. Adds `role_type` field on the
 * returned jobs so downstream stages (AI scorer / Notion sync) don't
 * have to re-classify.
 */
export function filterByRoleType(jobs, roleTypes = ['intern', 'new_grad_FT']) {
  if (!Array.isArray(jobs)) return [];
  const allowed = new Set(roleTypes);
  const out = [];
  for (const j of jobs) {
    const role_type = classifyRoleType(j.title);
    if (allowed.has(role_type)) {
      out.push({ ...j, role_type });
    }
  }
  return out;
}

/**
 * filterByExcludeKeywords(jobs, excludeKeywords) — drop jobs whose title
 * matches any keyword (substring, case-insensitive, word-boundary aware).
 * Used to strip SWE / ML / Backend / Security Engineer etc. before AI scoring.
 *
 * Each keyword is matched as a whole phrase with word boundaries on both
 * ends, so "swe" won't match "answer" and "data engineer" only matches
 * the literal phrase.
 */
export function filterByExcludeKeywords(jobs, excludeKeywords = []) {
  if (!Array.isArray(jobs)) return [];
  if (!Array.isArray(excludeKeywords) || excludeKeywords.length === 0) return jobs;
  const patterns = excludeKeywords.map((kw) => {
    const escaped = String(kw).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i');
  });
  return jobs.filter((j) => {
    const t = j.title || '';
    return !patterns.some((re) => re.test(t));
  });
}

/**
 * filterByLocation(jobs, allowedPatterns) — keep jobs whose location field
 * contains at least one allowed substring (case-insensitive). Empty / null
 * locations are kept (some boards omit location at the API level).
 *
 * Cloudflare returns the literal string "In-Office" for many jobs — include
 * "In-Office" in allowedPatterns to keep those rather than drop them.
 */
export function filterByLocation(jobs, allowedPatterns = []) {
  if (!Array.isArray(jobs)) return [];
  if (!Array.isArray(allowedPatterns) || allowedPatterns.length === 0) return jobs;
  const lc = allowedPatterns.map((p) => String(p).toLowerCase());
  return jobs.filter((j) => {
    const loc = (j.location || '').toLowerCase();
    if (!loc) return true;
    return lc.some((p) => loc.includes(p));
  });
}
