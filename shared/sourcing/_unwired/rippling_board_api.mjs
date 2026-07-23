/**
 * rippling_board_api.mjs — Rippling ATS career portal scraper (zero npm dep, Node 24 ESM)
 *
 * ⚠️  v0.8 ALPHA — DOGFOOD NEEDED. Sourcing only (no apply skill).
 *
 * Rippling runs both their own jobs page (rippling.com/careers) and an ATS
 * offering for customers. Customer-tenant career portals are served from
 *   https://ats.rippling.com/{tenant}/jobs
 * (e.g. https://ats.rippling.com/acme/jobs). The list page is server-rendered
 * HTML with a JSON blob embedded via Next.js `__NEXT_DATA__` — much cleaner
 * to parse than the rendered DOM.
 *
 * Why no apply skill? Rippling ATS uses a multi-step React form with file
 * upload + dynamic custom fields per tenant. Coverage would require a
 * Workday-style adaptive helper across each tenant config — too much surface
 * for the long tail. Orchestrator dispatches `ats=rippling` as "manual apply
 * required."
 *
 * Strategy:
 *   1) GET https://ats.rippling.com/{tenant}/jobs
 *   2) Extract the `<script id="__NEXT_DATA__">{...}</script>` JSON blob.
 *   3) Walk `props.pageProps.jobs` (or similar — confirm via live verification) and
 *      normalize each entry.
 *   4) If __NEXT_DATA__ is absent (older tenant pages without Next.js),
 *      fall back to anchor-tag regex over the HTML.
 *
 * Interface mirrors recruitee_board_api.mjs / bamboohr_board_api.mjs so the
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

function cleanTenant(tenant) {
  return String(tenant)
    .replace(/^https?:\/\//, '')
    .replace(/^ats\.rippling\.com\//, '')
    .replace(/\.rippling\.com.*$/, '')
    .replace(/\/+$/, '')
    .replace(/^\/+/, '');
}

function buildUrl(tenant) {
  const slug = cleanTenant(tenant);
  return `https://ats.rippling.com/${slug}/jobs`;
}

async function fetchHtml(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await throttle();
    let resp;
    try {
      resp = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
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
      throw new Error(`Rippling ${url}: HTTP ${resp.status}`);
    }
    if (!resp.ok) throw new Error(`Rippling ${url}: HTTP ${resp.status}`);
    return await resp.text();
  }
  return null;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Extract and parse the __NEXT_DATA__ JSON blob from a Next.js HTML page.
 * Returns the parsed object or null if not found / unparseable.
 */
function extractNextData(html) {
  const m = html.match(
    /<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/**
 * Walk a parsed __NEXT_DATA__ object to find the jobs array. The exact key
 * path may drift across tenant template versions, so we probe a few common
 * shapes before giving up.
 */
function jobsFromNextData(data) {
  if (!data || typeof data !== 'object') return null;
  const candidates = [
    data?.props?.pageProps?.jobs,
    data?.props?.pageProps?.openJobs,
    data?.props?.pageProps?.jobPostings,
    data?.props?.pageProps?.initialJobs,
    data?.props?.pageProps?.data?.jobs,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length >= 0) return c;
  }
  return null;
}

function normalizeFromNext(raw, tenant) {
  const id =
    raw.id != null
      ? String(raw.id)
      : raw.jobId != null
      ? String(raw.jobId)
      : raw.slug || '';
  // URL: prefer a tenant-relative job slug; fall back to id.
  let url = '';
  if (raw.url) {
    url = raw.url.startsWith('http')
      ? raw.url
      : `https://ats.rippling.com${raw.url.startsWith('/') ? '' : '/'}${raw.url}`;
  } else if (id) {
    url = `https://ats.rippling.com/${cleanTenant(tenant)}/jobs/${encodeURIComponent(id)}`;
  } else {
    url = `https://ats.rippling.com/${cleanTenant(tenant)}/jobs`;
  }
  const locObj = raw.location || raw.workLocation || {};
  let location = '';
  if (typeof locObj === 'string') location = locObj;
  else if (locObj && typeof locObj === 'object') {
    location = [locObj.city, locObj.state, locObj.country].filter(Boolean).join(', ');
  }
  if (!location && Array.isArray(raw.locations) && raw.locations.length > 0) {
    location = raw.locations
      .map((l) => (typeof l === 'string' ? l : [l.city, l.state, l.country].filter(Boolean).join(', ')))
      .filter(Boolean)
      .join(' | ');
  }
  const employmentType = raw.employmentType || raw.jobType || raw.type || '';
  return {
    company: tenant,
    title: decodeEntities(raw.title || raw.name || ''),
    url,
    apply_url: url,
    location,
    description: '', // detail-only; skip on list pass
    department: raw.department || raw.departmentName || '',
    updated_at: raw.updatedAt || raw.postedAt || raw.createdAt || '',
    employment_type: employmentType,
    is_remote:
      Boolean(raw.isRemote) || /remote/i.test(location) || /remote/i.test(employmentType),
    compensation: raw.compensation || raw.salary || '',
    _source: 'rippling',
    _id: id,
  };
}

/**
 * HTML fallback parser — used when __NEXT_DATA__ is missing. Matches anchors
 * that point at `/jobs/<id>` within the same tenant slug. Less reliable;
 * live verification and iterate the regex.
 */
function parseHtmlFallback(html, tenant) {
  const slug = cleanTenant(tenant);
  const re = new RegExp(
    `<a[^>]+href="(\\/${slug}\\/jobs\\/([^"\\?#]+))[^"]*"[^>]*>([\\s\\S]*?)<\\/a>`,
    'gi',
  );
  const seen = new Set();
  const jobs = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const path = m[1];
    const id = m[2];
    if (seen.has(id)) continue;
    seen.add(id);
    const title = decodeEntities(m[3].replace(/<[^>]+>/g, ''));
    if (!title) continue;
    jobs.push({
      company: tenant,
      title,
      url: `https://ats.rippling.com${path}`,
      apply_url: `https://ats.rippling.com${path}`,
      location: '',
      description: '',
      department: '',
      updated_at: '',
      employment_type: '',
      is_remote: false,
      compensation: '',
      _source: 'rippling',
      _id: id,
    });
  }
  return jobs;
}

/**
 * fetchJobs(tenant, opts) — returns array of normalized jobs.
 *   opts.companyName: override `company` field.
 */
export async function fetchJobs(tenant, opts = {}) {
  if (!tenant || typeof tenant !== 'string') {
    throw new Error('fetchJobs: tenant required');
  }
  const html = await fetchHtml(buildUrl(tenant));
  if (!html) return [];
  const company = opts.companyName || tenant;
  // Prefer __NEXT_DATA__ — structured, reliable.
  const nextData = extractNextData(html);
  const rawJobs = jobsFromNextData(nextData);
  if (Array.isArray(rawJobs)) {
    return rawJobs.map((r) => {
      const norm = normalizeFromNext(r, tenant);
      norm.company = company;
      return norm;
    });
  }
  // Fallback: HTML anchor scrape.
  if (opts.verbose) {
    console.error(`[rippling] ${tenant}: __NEXT_DATA__ absent, falling back to HTML scrape`);
  }
  return parseHtmlFallback(html, tenant).map((j) => {
    j.company = company;
    return j;
  });
}

/**
 * fetchJobsForCompany(companyName, tenantCandidates, opts) — try multiple
 * tenant slugs until one returns non-empty.
 */
export async function fetchJobsForCompany(companyName, tenantCandidates, opts = {}) {
  const candidates = Array.isArray(tenantCandidates) ? tenantCandidates : [tenantCandidates];
  for (const tenant of candidates) {
    if (!tenant) continue;
    try {
      const jobs = await fetchJobs(tenant, { ...opts, companyName });
      if (jobs.length > 0) return jobs;
    } catch (err) {
      if (opts.verbose) console.error(`[rippling] ${tenant} error:`, err.message);
    }
  }
  return [];
}

// ---------- role-type filtering ----------

const INTERN_TITLE_RE = /\b(intern|internship)\b/i;
const NEW_GRAD_TITLE_RE =
  /\b(new\s?grad|new\s?graduate|university\s?grad|university\s?graduate|early\s?career|recent\s?graduate|graduate\s?program|junior)\b/i;

function matchesIntern(job) {
  const et = (job.employment_type || '').toLowerCase();
  if (et.includes('intern')) return true;
  return INTERN_TITLE_RE.test(job.title || '');
}

function matchesNewGradFT(job) {
  const et = (job.employment_type || '').toLowerCase();
  // Rippling uses "Full Time" / "FullTime" / sometimes blank.
  const isFT = et === '' || et.includes('full');
  if (!isFT) return false;
  return NEW_GRAD_TITLE_RE.test(job.title || '');
}

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
// Usage: node shared/sourcing/rippling_board_api.mjs <tenant>
if (import.meta.url === `file://${process.argv[1]}`) {
  const tenant = process.argv[2];
  if (!tenant) {
    console.error('Usage: node rippling_board_api.mjs <tenant>');
    process.exit(1);
  }
  const jobs = await fetchJobs(tenant, { verbose: true });
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
          url: j.url,
        })),
      },
      null,
      2,
    ),
  );
}
