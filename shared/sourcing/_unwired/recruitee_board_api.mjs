/**
 * recruitee_board_api.mjs — Recruitee Job Board API client (zero npm dep, Node 24 ESM)
 *
 * Public endpoint (no auth):
 *   https://{tenant}.recruitee.com/api/offers/
 *
 * Recruitee is EU-leaning (NL HQ) but covers some NA startups too. Sourcing
 * only — 用户 will hand-submit applications (no auto-apply for Recruitee in
 * v0.8). The orchestrator dispatches by `ats=recruitee` on the Notion row and
 * logs "manual apply required" without touching the apply flow.
 *
 * Response is clean JSON. `employment_type_code` is an explicit enum
 * ("intern" / "permanent" / "contract" / "freelance" / "temporary"), so role
 * filtering can lean on that field first and fall back to title regex.
 *
 * Interface mirrors ashby_board_api.mjs / greenhouse_board_api.mjs so the
 * sourcing pipeline routes by board kind.
 */

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

function buildUrl(tenant) {
  // tenant is the subdomain piece, e.g. "examplecompany" from
  // examplecompany.recruitee.com. Strip any accidental trailing slash or
  // scheme so callers can pass either form.
  const clean = String(tenant)
    .replace(/^https?:\/\//, '')
    .replace(/\.recruitee\.com.*$/, '')
    .replace(/\/+$/, '');
  return `https://${clean}.recruitee.com/api/offers/`;
}

/**
 * Fetch raw Recruitee offers JSON for a single tenant, with 1 req/sec throttle
 * and one retry on 5xx. 404 returns null (caller treats as empty).
 */
async function fetchRaw(tenant) {
  const url = buildUrl(tenant);
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
      throw new Error(`Recruitee ${tenant}: HTTP ${resp.status}`);
    }
    if (!resp.ok) throw new Error(`Recruitee ${tenant}: HTTP ${resp.status}`);
    return await resp.json();
  }
  return null;
}

/**
 * Format the salary subobject into a single display string + structured fields.
 * Recruitee returns `{ min, max, currency, interval_code }` — any of those may
 * be missing, so handle partial data gracefully.
 */
function extractSalary(raw) {
  const s = raw && raw.salary;
  if (!s || typeof s !== 'object') {
    return { compensation: '', salary_min: null, salary_max: null, salary_currency: '', salary_interval: '' };
  }
  const min = typeof s.min === 'number' ? s.min : null;
  const max = typeof s.max === 'number' ? s.max : null;
  const currency = s.currency || '';
  const interval = s.interval_code || '';
  let compensation = '';
  if (min != null && max != null) compensation = `${min}-${max} ${currency} / ${interval}`.trim();
  else if (min != null) compensation = `${min}+ ${currency} / ${interval}`.trim();
  else if (max != null) compensation = `up to ${max} ${currency} / ${interval}`.trim();
  return {
    compensation,
    salary_min: min,
    salary_max: max,
    salary_currency: currency,
    salary_interval: interval,
  };
}

function joinLocation(raw) {
  const parts = [];
  if (raw.city) parts.push(raw.city);
  if (raw.country_code) parts.push(String(raw.country_code).toUpperCase());
  if (parts.length > 0) return parts.join(', ');
  return raw.location || '';
}

/**
 * Normalize one Recruitee offer to the shared sourcing shape.
 */
function normalizeJob(raw, tenant) {
  const sal = extractSalary(raw);
  return {
    company: tenant,
    title: raw.title || '',
    url: raw.careers_url || raw.url || '',
    apply_url: raw.url || raw.careers_url || '',
    location: joinLocation(raw),
    description: raw.description || '', // already plain-ish text
    department: raw.department || '',
    updated_at: raw.published_at || raw.updated_at || raw.created_at || '',
    employment_type: raw.employment_type_code || '',
    is_remote: /remote/i.test(raw.location || '') || /remote/i.test(raw.city || ''),
    compensation: sal.compensation,
    salary_min: sal.salary_min,
    salary_max: sal.salary_max,
    salary_currency: sal.salary_currency,
    salary_interval: sal.salary_interval,
    min_hours: typeof raw.min_hours === 'number' ? raw.min_hours : null,
    max_hours: typeof raw.max_hours === 'number' ? raw.max_hours : null,
    _source: 'recruitee',
    _id: raw.id != null ? String(raw.id) : '',
    _slug: raw.slug || '',
  };
}

/**
 * fetchJobs(tenant, opts) — returns array of normalized jobs.
 *   opts.companyName: override `company` field on returned jobs.
 */
export async function fetchJobs(tenant, opts = {}) {
  if (!tenant || typeof tenant !== 'string') {
    throw new Error('fetchJobs: tenant required');
  }
  const data = await fetchRaw(tenant);
  if (!data || !Array.isArray(data.offers)) return [];
  const company = opts.companyName || tenant;
  return data.offers.map((j) => {
    const norm = normalizeJob(j, tenant);
    norm.company = company;
    return norm;
  });
}

/**
 * fetchJobsForCompany(companyName, tenantCandidates, opts) — try multiple
 * tenants until one returns a non-empty board. 404 / empty are skipped.
 */
export async function fetchJobsForCompany(companyName, tenantCandidates, opts = {}) {
  const candidates = Array.isArray(tenantCandidates)
    ? tenantCandidates
    : [tenantCandidates];
  for (const tenant of candidates) {
    if (!tenant) continue;
    try {
      const jobs = await fetchJobs(tenant, { ...opts, companyName });
      if (jobs.length > 0) return jobs;
    } catch (err) {
      if (opts.verbose) console.error(`[recruitee] ${tenant} error:`, err.message);
    }
  }
  return [];
}

// ---------- role-type filtering ----------

const INTERN_TITLE_RE = /\b(intern|internship|stage|stagiaire|praktikant|werkstudent)\b/i;
const NEW_GRAD_TITLE_RE =
  /\b(new\s?grad|new\s?graduate|university\s?grad|university\s?graduate|early\s?career|recent\s?graduate|graduate\s?program|junior)\b/i;

function matchesIntern(job) {
  const et = (job.employment_type || '').toLowerCase();
  if (et === 'intern' || et === 'internship' || et === 'temporary') {
    if (INTERN_TITLE_RE.test(job.title || '')) return true;
    if (et === 'intern' || et === 'internship') return true;
  }
  return INTERN_TITLE_RE.test(job.title || '');
}

function matchesNewGradFT(job) {
  const et = (job.employment_type || '').toLowerCase();
  // Recruitee uses "permanent" for full-time/regular roles.
  const isFT = et === 'permanent' || et === 'full_time' || et === 'fulltime' || et === '';
  if (!isFT) return false;
  return NEW_GRAD_TITLE_RE.test(job.title || '');
}

/**
 * filterByRoleType(jobs, roleTypes) — uses both employment_type_code AND title.
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

// ---------- CLI smoke test ----------
// Usage: node shared/sourcing/_unwired/recruitee_board_api.mjs <tenant>
if (import.meta.url === `file://${process.argv[1]}`) {
  const tenant = process.argv[2];
  if (!tenant) {
    console.error('Usage: node recruitee_board_api.mjs <tenant>');
    process.exit(1);
  }
  const jobs = await fetchJobs(tenant);
  const filtered = filterByRoleType(jobs);
  console.log(
    JSON.stringify(
      {
        tenant,
        total: jobs.length,
        filtered: filtered.length,
        sample: filtered.slice(0, 3).map((j) => ({
          title: j.title,
          employment_type: j.employment_type,
          location: j.location,
          compensation: j.compensation,
          url: j.url,
        })),
      },
      null,
      2,
    ),
  );
}
