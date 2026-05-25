/**
 * ashby_board_api.mjs — Ashby Job Board API client (zero npm dep, Node 24 ESM)
 *
 * Public endpoint (no auth):
 *   https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true
 *
 * Ashby returns clean JSON with `descriptionPlain` (already plain text) and an
 * explicit `employmentType` enum ("Internship" / "FullTime" / "Contract" / ...).
 * That makes role-type filtering more reliable than Greenhouse (which only has
 * the title to go on).
 *
 * Interface mirrors greenhouse_board_api.mjs so the sourcing pipeline can route
 * to whichever client matches the board slug.
 *
 * Reference: devlog-2026-05-18.md L27 — 用户 verified this endpoint 2026-05-18.
 */

const ASHBY_ENDPOINT = 'https://api.ashbyhq.com/posting-api/job-board';
const REQ_INTERVAL_MS = 1000; // 1 req/sec throttle
const RETRY_BACKOFF_MS = 2000;
const USER_AGENT = 'mrweirdo-jobs/1.3 (+https://github.com/glin23/mrweirdo-jobs)';

let _lastRequestAt = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle() {
  const now = Date.now();
  const elapsed = now - _lastRequestAt;
  if (elapsed < REQ_INTERVAL_MS) {
    await sleep(REQ_INTERVAL_MS - elapsed);
  }
  _lastRequestAt = Date.now();
}

/**
 * Fetch raw Ashby job board JSON for a single slug, with 1 req/sec throttle
 * and one retry on 5xx. 404 returns null (caller treats as empty).
 */
async function fetchRaw(slug) {
  const url = `${ASHBY_ENDPOINT}/${encodeURIComponent(slug)}?includeCompensation=true`;
  for (let attempt = 0; attempt < 2; attempt++) {
    await throttle();
    let resp;
    try {
      resp = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
    } catch (err) {
      if (attempt === 0) {
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      throw err;
    }
    if (resp.status === 404) return null;
    if (resp.status >= 500 && resp.status < 600) {
      if (attempt === 0) {
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      throw new Error(`Ashby ${slug}: HTTP ${resp.status}`);
    }
    if (!resp.ok) throw new Error(`Ashby ${slug}: HTTP ${resp.status}`);
    return await resp.json();
  }
  return null;
}

/**
 * Normalize one Ashby job record to the shared sourcing shape.
 */
function normalizeJob(raw, slug) {
  const loc =
    raw.location ||
    (Array.isArray(raw.secondaryLocations) && raw.secondaryLocations[0]) ||
    '';
  return {
    company: slug,
    title: raw.title || '',
    url: raw.jobUrl || raw.applyUrl || '',
    apply_url: raw.applyUrl || raw.jobUrl || '',
    location: loc,
    description: raw.descriptionPlain || '', // Ashby gives plain text directly
    department: raw.department || raw.team || '',
    updated_at: raw.publishedAt || raw.updatedAt || '',
    employment_type: raw.employmentType || '',
    is_remote: !!raw.isRemote,
    compensation:
      (raw.compensation &&
        (raw.compensation.compensationTierSummary || raw.compensation.summary)) ||
      '',
    _source: 'ashby',
    _id: raw.id || '',
  };
}

/**
 * fetchJobs(slug, opts) — returns array of normalized jobs.
 *   opts.companyName: override `company` field on returned jobs.
 */
export async function fetchJobs(slug, opts = {}) {
  if (!slug || typeof slug !== 'string') {
    throw new Error('fetchJobs: slug required');
  }
  const data = await fetchRaw(slug);
  if (!data || !Array.isArray(data.jobs)) return [];
  const company = opts.companyName || slug;
  return data.jobs.map((j) => {
    const norm = normalizeJob(j, slug);
    norm.company = company;
    return norm;
  });
}

/**
 * fetchJobsForCompany(companyName, slugCandidates, opts) — try multiple slugs
 * (e.g. "ramp", "ramp-careers") until one returns a non-empty board.
 * 404 / empty boards are silently skipped.
 */
export async function fetchJobsForCompany(companyName, slugCandidates, opts = {}) {
  const candidates = Array.isArray(slugCandidates)
    ? slugCandidates
    : [slugCandidates];
  for (const slug of candidates) {
    if (!slug) continue;
    try {
      const jobs = await fetchJobs(slug, { ...opts, companyName });
      if (jobs.length > 0) return jobs;
    } catch (err) {
      if (opts.verbose) console.error(`[ashby] ${slug} error:`, err.message);
    }
  }
  return [];
}

// ---------- role-type filtering ----------

const INTERN_TITLE_RE = /\b(intern|internship)\b/i;
const NEW_GRAD_TITLE_RE =
  /\b(new\s?grad|new\s?graduate|university\s?grad|university\s?graduate|early\s?career|recent\s?graduate|associate\s*\(new\s?graduate\)|college\s?grad)\b/i;

function matchesIntern(job) {
  if ((job.employment_type || '').toLowerCase() === 'internship') return true;
  return INTERN_TITLE_RE.test(job.title || '');
}

function matchesNewGradFT(job) {
  const et = (job.employment_type || '').toLowerCase();
  // Ashby uses "FullTime"; be lenient about formatting.
  const isFT = et === 'fulltime' || et === 'full_time' || et === 'full-time';
  if (!isFT) return false;
  return NEW_GRAD_TITLE_RE.test(job.title || '');
}

/**
 * filterByRoleType(jobs, roleTypes) — uses both employmentType field AND title.
 * Supported roleTypes: 'intern', 'new_grad_FT'.
 */
export function filterByRoleType(jobs, roleTypes = ['intern', 'new_grad_FT']) {
  if (!Array.isArray(jobs)) return [];
  const wantIntern = roleTypes.includes('intern');
  const wantNewGrad = roleTypes.includes('new_grad_FT');
  if (!wantIntern && !wantNewGrad) return [];
  return jobs.filter((j) => {
    if (wantIntern && matchesIntern(j)) return true;
    if (wantNewGrad && matchesNewGradFT(j)) return true;
    return false;
  });
}

/**
 * filterByExcludeKeywords(jobs, excludeKeywords) — drop jobs whose title
 * matches any keyword. See greenhouse_board_api.mjs for full doc.
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
 * locations are kept. See greenhouse_board_api.mjs for full doc.
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

// ---------- CLI smoke test ----------
// Usage: node shared/sourcing/ashby_board_api.mjs <slug>
if (import.meta.url === `file://${process.argv[1]}`) {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: node ashby_board_api.mjs <slug>');
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
          employment_type: j.employment_type,
          location: j.location,
          url: j.url,
        })),
      },
      null,
      2,
    ),
  );
}
