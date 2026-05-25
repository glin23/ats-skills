/**
 * bamboohr_board_api.mjs — BambooHR career portal scraper (zero npm dep, Node 24 ESM)
 *
 * ⚠️  v0.8 ALPHA — DOGFOOD NEEDED. Sourcing only (no apply skill).
 *
 * BambooHR is an SMB-focused ATS. Each tenant exposes a public career page at
 *   https://{tenant}.bamboohr.com/careers
 * which renders an HTML list of open positions. There is no documented JSON
 * Job Board API (BambooHR has a private REST API for paying customers, but
 * candidate-side discovery is HTML only).
 *
 * Why no apply skill? BambooHR's apply form is a generic multi-step modal
 * (resume upload + form fields + EEO). Coverage across all BambooHR tenants
 * varies wildly because customers can toggle which fields are shown.
 * Auto-apply would need a Workday-style adaptive helper — too much surface
 * area for the long tail of small companies on BambooHR. The orchestrator
 * dispatches `ats=bamboohr` rows as "manual apply required."
 *
 * HTML structure observed (2026-05, may drift — re-verify if regex breaks):
 *   <ul class="BambooHR-ATS-Jobs-List">
 *     <li class="BambooHR-ATS-Jobs-Item">
 *       <a href="/careers/123">Senior AI Engineer</a>
 *       <span class="BambooHR-ATS-Location">San Francisco, CA · Full-Time</span>
 *     </li>
 *     ...
 *   </ul>
 *
 * Newer tenants embed listings via a JS widget that fetches
 * `https://{tenant}.bamboohr.com/careers/list` and returns JSON. We try the
 * JSON endpoint first (it's the same data, cleaner to parse) and fall back to
 * HTML regex if the endpoint 404s.
 *
 * Interface mirrors recruitee_board_api.mjs / ashby_board_api.mjs so the
 * sourcing pipeline routes by board kind.
 */

const REQ_INTERVAL_MS = 1000; // 1 req/sec throttle
const RETRY_BACKOFF_MS = 2000;
const USER_AGENT = 'ats-skills/0.8 (+https://github.com/glin23/mrweirdo-jobs)';

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
    .replace(/\.bamboohr\.com.*$/, '')
    .replace(/\/+$/, '');
}

function buildJsonUrl(tenant) {
  return `https://${cleanTenant(tenant)}.bamboohr.com/careers/list`;
}

function buildHtmlUrl(tenant) {
  return `https://${cleanTenant(tenant)}.bamboohr.com/careers`;
}

/**
 * Fetch with throttle + one retry on 5xx / network error. Returns
 * { status, body } or null on 404.
 */
async function fetchWithRetry(url, accept) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await throttle();
    let resp;
    try {
      resp = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: accept },
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
      throw new Error(`BambooHR ${url}: HTTP ${resp.status}`);
    }
    if (!resp.ok) throw new Error(`BambooHR ${url}: HTTP ${resp.status}`);
    const body = await resp.text();
    return { status: resp.status, body };
  }
  return null;
}

/**
 * Decode a small set of HTML entities found in BambooHR titles / locations.
 */
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Parse the JSON variant (newer tenants). Shape per observation:
 *   { result: [{ id, jobOpeningName, locationCity, locationState,
 *                locationCountry, employmentStatusLabel, departmentLabel, ... }] }
 */
function parseJson(body, tenant) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return null; // signal "fall back to HTML"
  }
  const list = Array.isArray(data?.result) ? data.result : Array.isArray(data) ? data : null;
  if (!list) return null;
  return list.map((r) => {
    const id = r.id != null ? String(r.id) : '';
    const locParts = [r.locationCity, r.locationState, r.locationCountry].filter(Boolean);
    return {
      _raw: r,
      _id: id,
      title: decodeEntities(r.jobOpeningName || r.title || ''),
      url: id
        ? `https://${cleanTenant(tenant)}.bamboohr.com/careers/${id}`
        : `https://${cleanTenant(tenant)}.bamboohr.com/careers`,
      location: locParts.join(', '),
      department: r.departmentLabel || r.department || '',
      employment_type: r.employmentStatusLabel || r.employmentStatus || '',
      updated_at: r.datePosted || r.createdDate || '',
    };
  });
}

/**
 * Parse HTML list-page fallback. Two patterns seen in the wild:
 *   - <li class="BambooHR-ATS-Jobs-Item"><a href="/careers/123">Title</a>...
 *   - Inline `<script>var jobs = [...]</script>` (rare; not handled here —
 *     punt to dogfood feedback).
 */
function parseHtml(body, tenant) {
  const jobs = [];
  // Match each <li class="BambooHR-ATS-Jobs-Item">...</li> block.
  const itemRe = /<li[^>]*class="[^"]*BambooHR-ATS-Jobs-Item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = itemRe.exec(body)) !== null) {
    const block = m[1];
    const aMatch = block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!aMatch) continue;
    const href = aMatch[1];
    const titleRaw = aMatch[2].replace(/<[^>]+>/g, '');
    const title = decodeEntities(titleRaw);
    // Location span — both `BambooHR-ATS-Location` and `BambooHR-ATS-Department`
    // variants exist depending on tenant theme.
    const locMatch =
      block.match(/<span[^>]*class="[^"]*BambooHR-ATS-Location[^"]*"[^>]*>([\s\S]*?)<\/span>/i) ||
      block.match(/<span[^>]*class="[^"]*BambooHR-ATS-Department[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const location = locMatch ? decodeEntities(locMatch[1].replace(/<[^>]+>/g, '')) : '';
    const idMatch = href.match(/\/careers\/(\d+)/);
    const id = idMatch ? idMatch[1] : '';
    const url = href.startsWith('http')
      ? href
      : `https://${cleanTenant(tenant)}.bamboohr.com${href}`;
    jobs.push({
      _raw: null,
      _id: id,
      title,
      url,
      location,
      department: '',
      employment_type: '',
      updated_at: '',
    });
  }
  return jobs;
}

function normalizeJob(parsed, tenant) {
  const loc = parsed.location || '';
  return {
    company: tenant,
    title: parsed.title,
    url: parsed.url,
    apply_url: parsed.url, // BambooHR apply lives on the same detail page
    location: loc,
    description: '', // not on list view; would need a detail-page fetch
    department: parsed.department,
    updated_at: parsed.updated_at,
    employment_type: parsed.employment_type,
    is_remote: /remote/i.test(loc),
    compensation: '',
    _source: 'bamboohr',
    _id: parsed._id,
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
  // 1) Try the JSON list endpoint first (cleaner; available on newer tenants).
  let parsedList = null;
  const jsonResp = await fetchWithRetry(buildJsonUrl(tenant), 'application/json');
  if (jsonResp && jsonResp.body) {
    parsedList = parseJson(jsonResp.body, tenant);
  }
  // 2) Fall back to HTML scraping.
  if (!parsedList) {
    const htmlResp = await fetchWithRetry(buildHtmlUrl(tenant), 'text/html');
    if (!htmlResp) return [];
    parsedList = parseHtml(htmlResp.body, tenant);
  }
  if (!parsedList || parsedList.length === 0) return [];
  const company = opts.companyName || tenant;
  return parsedList.map((p) => {
    const norm = normalizeJob(p, tenant);
    norm.company = company;
    return norm;
  });
}

/**
 * fetchJobsForCompany(companyName, tenantCandidates, opts) — try multiple
 * tenant subdomains until one returns a non-empty board.
 */
export async function fetchJobsForCompany(companyName, tenantCandidates, opts = {}) {
  const candidates = Array.isArray(tenantCandidates) ? tenantCandidates : [tenantCandidates];
  for (const tenant of candidates) {
    if (!tenant) continue;
    try {
      const jobs = await fetchJobs(tenant, { ...opts, companyName });
      if (jobs.length > 0) return jobs;
    } catch (err) {
      if (opts.verbose) console.error(`[bamboohr] ${tenant} error:`, err.message);
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
  // BambooHR uses "Full-Time" / "Full Time" / sometimes blank.
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
// Usage: node shared/sourcing/bamboohr_board_api.mjs <tenant>
if (import.meta.url === `file://${process.argv[1]}`) {
  const tenant = process.argv[2];
  if (!tenant) {
    console.error('Usage: node bamboohr_board_api.mjs <tenant>');
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
          url: j.url,
        })),
      },
      null,
      2,
    ),
  );
}
