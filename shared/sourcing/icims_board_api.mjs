/**
 * icims_board_api.mjs — iCIMS career portal scraper (v0.8 ALPHA, zero npm dep)
 *
 * ⚠️  v0.8 ALPHA — NOT DOGFOOD-VERIFIED. iCIMS has NO public Job Board API,
 * so we scrape the public career portal HTML at:
 *
 *     https://careers-{tenant}.icims.com/jobs/search?ss=1
 *
 * (`ss=1` is the "show search" / "show all" parameter — keeps the page on
 *  the default listing rather than redirecting to a job detail.)
 *
 * Each enterprise customer gets their own subdomain (`careers-acme.icims.com`,
 * `careers-thermofisher.icims.com`, etc.). There is no central registry of
 * tenants — caller must supply the subdomain slug.
 *
 * Selector patterns below are inferred from:
 *   - iCIMS Career Connector public documentation
 *   - Open-source iCIMS scrapers on GitHub (search for `iCIMS_JobsTable`)
 *   - Sampling of live portals (careers-thermofisher, careers-cintas, careers-ross)
 *
 * Every selector marked `// TODO-verify` MUST be confirmed against a real
 * tenant's HTML before relying on this client. iCIMS templates have drifted
 * substantially between v15 / v20 / Refresh / TextKernel — some tenants use
 * SAP-style table markup, others use card grids.
 *
 * Interface mirrors greenhouse_board_api.mjs / ashby_board_api.mjs so the
 * sourcing pipeline can route to whichever client matches the URL pattern.
 *
 * v0.8 limitations:
 *   - List page only contains title + req number + sometimes location. The
 *     full job description lives on `/jobs/{reqId}/` detail pages, which we
 *     do NOT fetch (would 2x request count + trigger anti-scrape). `description`
 *     is therefore always `''` — AI scorer / Notion sync must tolerate empty.
 *   - No pagination implemented. Most iCIMS portals show 25-50 jobs per page;
 *     `?searchPage=2&searchRelation=keyword_all` etc. paginate but we only
 *     hit page 1 in v0.8.
 *   - iCIMS uses CloudFront + sometimes Akamai Bot Manager. Throttling is
 *     1 req/2s and we send a real-browser User-Agent — but if iCIMS starts
 *     returning HTTP 403 / interstitial HTML, switch to CDP-based fetch via
 *     shared/cdp.mjs.
 */

const REQ_INTERVAL_MS = 2000; // 2 req/sec — slower than Ashby/Greenhouse (no API contract)
const RETRY_BACKOFF_MS = 3000;
const DEFAULT_TIMEOUT_MS = 15000;
// Use a real-browser User-Agent — iCIMS portals 403 on common scraper UAs.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 ats-skills/0.8';

let _lastRequestAt = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle() {
  const now = Date.now();
  const elapsed = now - _lastRequestAt;
  if (elapsed < REQ_INTERVAL_MS) await sleep(REQ_INTERVAL_MS - elapsed);
  _lastRequestAt = Date.now();
}

function buildPortalUrl(tenant) {
  return `https://careers-${encodeURIComponent(tenant)}.icims.com/jobs/search?ss=1`;
}

async function fetchHtml(tenant) {
  const url = buildPortalUrl(tenant);
  for (let attempt = 0; attempt < 2; attempt++) {
    await throttle();
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(new Error('timeout')), DEFAULT_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: ctrl.signal,
        redirect: 'follow',
      });
    } catch (err) {
      clearTimeout(to);
      if (attempt === 0) {
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      throw new Error(`iCIMS ${tenant}: network error: ${err.message}`);
    }
    clearTimeout(to);
    if (resp.status === 404) return { url, html: null, status: 404 };
    if (resp.status === 403) {
      // Bot manager block — caller should fall back to CDP path.
      throw new Error(
        `iCIMS ${tenant}: HTTP 403 (anti-bot) — fall back to CDP-based fetch via shared/cdp.mjs`
      );
    }
    if (resp.status >= 500 && resp.status < 600) {
      if (attempt === 0) {
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      throw new Error(`iCIMS ${tenant}: HTTP ${resp.status}`);
    }
    if (!resp.ok) throw new Error(`iCIMS ${tenant}: HTTP ${resp.status}`);
    const html = await resp.text();
    return { url, html, status: resp.status };
  }
  return { url, html: null, status: -1 };
}

// ---------- zero-dep HTML parsing ----------

/**
 * Decode common HTML entities (&amp;, &lt;, &gt;, &quot;, &#39;, &nbsp;, &#NNN;, &#xHHHH;).
 * Sufficient for job title text on iCIMS list pages — full SGML decoder not needed.
 */
function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

/**
 * Parse iCIMS job list HTML into rows. iCIMS uses two main layouts:
 *
 *   Layout A (classic table — `iCIMS_JobsTable`):
 *     <table class="iCIMS_JobsTable">
 *       <tr class="row">
 *         <td class="iCIMS_JobTitle">
 *           <a href="/jobs/12345/intern-ai/job">AI Intern</a>
 *         </td>
 *         <td class="iCIMS_JobLocation">San Francisco, CA</td>
 *         ...
 *       </tr>
 *
 *   Layout B (card / "Refresh" template):
 *     <div class="ais-Hits-item">  (Algolia-backed search on some tenants)
 *       <a class="job-title-link" href="/jobs/12345/...">...</a>
 *
 * v0.8 handles Layout A only — Layout B (Algolia / SAP-Hybris) needs separate
 * parser. TODO-verify on actual tenant samples.
 */
function parseICIMSListHtml(html, tenant) {
  if (!html || typeof html !== 'string') return [];
  const rows = [];

  // Each <tr> with class "row" inside iCIMS_JobsTable. We loop on <tr ...>...</tr> blocks
  // that contain a link to /jobs/<digits>/...
  // Note: real iCIMS HTML is non-trivial; this regex is intentionally tolerant.
  const rowRe =
    /<tr\b[^>]*class\s*=\s*"[^"]*\brow\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;

  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const rowHtml = m[1];

    // Job link — `/jobs/<reqId>/<slug>/job` is the canonical pattern.
    // TODO-verify: some tenants use `/jobs/<reqId>/<slug>` (no `/job`).
    const linkMatch = rowHtml.match(
      /<a\b[^>]*href\s*=\s*"(\/jobs\/(\d+)\/[^"]*?)"[^>]*>([\s\S]*?)<\/a>/i
    );
    if (!linkMatch) continue;

    const relUrl = linkMatch[1];
    const reqId = linkMatch[2];
    const titleRaw = linkMatch[3];
    const title = stripTags(titleRaw);
    if (!title) continue;

    // Location — class `iCIMS_JobLocation` cell, or fallback to any <td> after title.
    let location = '';
    const locMatch = rowHtml.match(
      /<td\b[^>]*class\s*=\s*"[^"]*iCIMS_JobLocation[^"]*"[^>]*>([\s\S]*?)<\/td>/i
    );
    if (locMatch) location = stripTags(locMatch[1]);

    // Department — class `iCIMS_JobCategory` or `iCIMS_JobDepartment`.
    let department = '';
    const deptMatch = rowHtml.match(
      /<td\b[^>]*class\s*=\s*"[^"]*iCIMS_Job(Category|Department)[^"]*"[^>]*>([\s\S]*?)<\/td>/i
    );
    if (deptMatch) department = stripTags(deptMatch[2]);

    rows.push({
      title,
      relUrl,
      reqId,
      location,
      department,
    });
  }

  // Fallback: if zero rows matched the table layout, try the link-only pattern
  // (Refresh template / Algolia output) — captures any `<a href="/jobs/{id}/...">title</a>`.
  if (rows.length === 0) {
    const linkRe =
      /<a\b[^>]*href\s*=\s*"(\/jobs\/(\d+)\/[^"#?]*?)"[^>]*>([\s\S]*?)<\/a>/gi;
    let lm;
    const seen = new Set();
    while ((lm = linkRe.exec(html)) !== null) {
      const reqId = lm[2];
      if (seen.has(reqId)) continue; // de-dupe duplicate links
      const title = stripTags(lm[3]);
      if (!title || title.length > 200) continue; // filter junk
      seen.add(reqId);
      rows.push({
        title,
        relUrl: lm[1],
        reqId,
        location: '',
        department: '',
      });
    }
  }

  void tenant;
  return rows;
}

function normalizeJob(parsedRow, tenant, companyName) {
  const url = `https://careers-${tenant}.icims.com${parsedRow.relUrl}`;
  return {
    source: 'icims',
    company: companyName || tenant,
    title: parsedRow.title,
    url,
    apply_url: url, // iCIMS list page has no separate apply URL — same as detail
    location: parsedRow.location || '',
    description: '', // v0.8: list page only; detail-page fetch deferred
    department: parsedRow.department || '',
    updated_at: '', // not surfaced on list page
    employment_type: '', // not surfaced on list page
    is_remote: /\bremote\b/i.test(parsedRow.location || ''),
    compensation: '',
    _source: 'icims',
    _tenant: tenant,
    _id: parsedRow.reqId,
    _disclaimer: 'v0.8 alpha — list-only, no description',
  };
}

// ---------- public API ----------

/**
 * fetchJobs(tenant, opts?) — fetch + normalize all jobs from one iCIMS tenant.
 *
 *   tenant: subdomain slug, e.g. "thermofisher" for careers-thermofisher.icims.com
 *   opts.companyName: override the human-readable company name
 *
 * Returns: Promise<Array<NormalizedJob>>
 * 404 → [] (warn-and-continue).
 */
export async function fetchJobs(tenant, opts = {}) {
  if (!tenant || typeof tenant !== 'string') {
    throw new TypeError('fetchJobs(tenant): tenant subdomain slug required');
  }
  const { url, html, status } = await fetchHtml(tenant);
  if (status === 404 || !html) {
    if (opts.verbose) console.warn(`[icims] 404/empty for tenant "${tenant}" (${url})`);
    return [];
  }
  const rows = parseICIMSListHtml(html, tenant);
  if (rows.length === 0 && opts.verbose) {
    console.warn(
      `[icims] ${tenant}: 0 rows parsed — likely template variant (Refresh/Algolia/SAP) ` +
        `not covered by v0.8 parser. Verify HTML and extend parseICIMSListHtml.`
    );
  }
  const companyName = opts.companyName || tenant;
  return rows.map((r) => normalizeJob(r, tenant, companyName));
}

/**
 * fetchJobsForCompany(companyName, tenantCandidates, opts?) — try multiple
 * tenant subdomains (e.g. "ross", "rossstores") until one returns non-empty.
 *
 * Useful because iCIMS tenant slugs are NOT predictable from company name.
 */
export async function fetchJobsForCompany(companyName, tenantCandidates, opts = {}) {
  const candidates = Array.isArray(tenantCandidates)
    ? tenantCandidates.filter(Boolean)
    : [tenantCandidates].filter(Boolean);
  if (!candidates.length) {
    throw new TypeError('fetchJobsForCompany: at least one tenant candidate required');
  }
  const tried = [];
  for (const tenant of candidates) {
    tried.push(tenant);
    try {
      const jobs = await fetchJobs(tenant, { ...opts, companyName });
      if (jobs.length) return jobs;
    } catch (err) {
      if (opts.verbose) console.warn(`[icims] ${companyName} via "${tenant}" failed: ${err.message}`);
    }
  }
  if (opts.verbose) {
    console.warn(`[icims] no jobs found for ${companyName} (tried: ${tried.join(', ')})`);
  }
  return [];
}

// ---------- role-type filtering ----------

const INTERN_TITLE_RE = /\b(intern|internship|co-?op|summer\s+202[5-7])\b/i;
const NEW_GRAD_TITLE_RE =
  /\b(new\s?grad|new\s?graduate|university\s?grad|university\s?graduate|early\s?career|recent\s?graduate|college\s?grad|entry\s?level)\b/i;

function matchesIntern(job) {
  // iCIMS list page has no employment_type — title-only.
  return INTERN_TITLE_RE.test(job.title || '');
}

function matchesNewGradFT(job) {
  if (INTERN_TITLE_RE.test(job.title || '')) return false;
  return NEW_GRAD_TITLE_RE.test(job.title || '');
}

/**
 * filterByRoleType(jobs, roleTypes) — title-only filter. Less reliable than
 * Ashby/Lever (no employmentType field) so caller should run AI scoring
 * after this to catch mistitled roles.
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
// Usage: node shared/sourcing/icims_board_api.mjs <tenant>
if (import.meta.url === `file://${process.argv[1]}`) {
  const tenant = process.argv[2];
  if (!tenant) {
    console.error('Usage: node icims_board_api.mjs <tenant-subdomain>');
    console.error('Example: node icims_board_api.mjs thermofisher');
    process.exit(1);
  }
  try {
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
            location: j.location,
            url: j.url,
            reqId: j._id,
          })),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error('[icims v0.8 alpha] ' + err.message);
    process.exit(2);
  }
}
