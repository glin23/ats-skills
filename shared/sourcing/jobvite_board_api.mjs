/**
 * jobvite_board_api.mjs — JobVite career portal scraper (v0.8 ALPHA, zero npm dep)
 *
 * ⚠️  v0.8 ALPHA — NOT DOGFOOD-VERIFIED. JobVite has NO public Job Board API,
 * so we scrape the public career portal HTML. Two URL patterns exist:
 *
 *   Pattern A (modern):   https://jobs.jobvite.com/{tenant}/jobs
 *   Pattern B (legacy):   https://jobs.jobvite.com/careers/{tenant}/jobs
 *
 * Some tenants also host on custom subdomains (`careers.<company>.com` redirect-
 * proxying to jobvite) — those are out of scope for v0.8 (caller must supply the
 * canonical `jobs.jobvite.com` URL).
 *
 * Selector patterns below are inferred from:
 *   - JobVite's documented HTML class conventions (jv-* prefix)
 *   - Sampling live boards (e.g. RingCentral, Postmates-era, Cloudera)
 *   - Pattern transfer from iCIMS / Greenhouse scrapers
 *
 * Standard JobVite list-page DOM (per `.jv-careersite` template):
 *
 *   <ul class="jv-job-list">
 *     <li class="jv-job-list-item">
 *       <a class="jv-job-list-name" href="/{tenant}/job/{jvId}">AI Intern</a>
 *       <span class="jv-job-list-location">San Francisco, CA</span>
 *       <span class="jv-job-list-category">Engineering</span>
 *     </li>
 *
 * Every selector marked `// TODO-verify` MUST be confirmed against a real
 * tenant's HTML before relying on this client.
 *
 * Interface mirrors greenhouse_board_api.mjs / ashby_board_api.mjs.
 *
 * v0.8 limitations:
 *   - List page only contains title + location + category. Full description
 *     lives on `/job/{jvId}` detail pages — NOT fetched in v0.8.
 *   - Pagination not implemented. JobVite default is 25/page; bigger boards
 *     need `?page=2` (some) or infinite-scroll (others) — TODO-verify.
 *   - Some tenants embed JobVite via JS widget (jv-widget.js) that renders
 *     client-side from an internal API. If `fetchJobs` returns 0 rows from
 *     a board that DOES have jobs, suspect this — fall back to CDP-based
 *     fetch via shared/cdp.mjs.
 */

const REQ_INTERVAL_MS = 1500; // 1.5s — slightly slower than Greenhouse, faster than iCIMS
const RETRY_BACKOFF_MS = 3000;
const DEFAULT_TIMEOUT_MS = 12000;
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

function buildPortalUrls(tenant) {
  const t = encodeURIComponent(tenant);
  return [
    `https://jobs.jobvite.com/${t}/jobs`,
    `https://jobs.jobvite.com/careers/${t}/jobs`,
  ];
}

async function fetchHtml(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(new Error('timeout')), DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (resp.status === 404) return { html: null, status: 404 };
    if (resp.status === 403) {
      throw new Error(`JobVite ${url}: HTTP 403 — fall back to CDP-based fetch`);
    }
    if (!resp.ok) throw new Error(`JobVite ${url}: HTTP ${resp.status}`);
    const html = await resp.text();
    return { html, status: resp.status };
  } finally {
    clearTimeout(to);
  }
}

// ---------- zero-dep HTML parsing ----------

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
 * Parse JobVite list HTML. Pattern (per `.jv-careersite` template):
 *
 *   <li class="jv-job-list-item" data-id="...">
 *     <a class="jv-job-list-name" href="/{tenant}/job/{jvId}">Title</a>
 *     <span class="jv-job-list-location">Location</span>
 *     <span class="jv-job-list-category">Department</span>
 *   </li>
 *
 * Some templates render jobs in a flat `<div class="jv-job-list-item">` instead
 * of `<li>`. Regex below tolerates both.
 */
function parseJobViteListHtml(html, tenant) {
  if (!html || typeof html !== 'string') return [];
  const rows = [];

  // Match each <li|div> block carrying class "jv-job-list-item"
  const itemRe =
    /<(li|div)\b[^>]*class\s*=\s*"[^"]*\bjv-job-list-item\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi;

  let m;
  while ((m = itemRe.exec(html)) !== null) {
    const block = m[2];

    // Title + href
    const linkMatch = block.match(
      /<a\b[^>]*class\s*=\s*"[^"]*\bjv-job-list-name\b[^"]*"[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
    );
    if (!linkMatch) continue;

    const href = linkMatch[1];
    const title = stripTags(linkMatch[2]);
    if (!title) continue;

    // JobVite job ID — last path segment of `/job/{id}` (UUID-ish or numeric)
    const idMatch = href.match(/\/job\/([A-Za-z0-9_-]+)/);
    const jvId = idMatch ? idMatch[1] : '';

    // Location
    let location = '';
    const locMatch = block.match(
      /class\s*=\s*"[^"]*\bjv-job-list-location\b[^"]*"[^>]*>([\s\S]*?)</i
    );
    if (locMatch) location = stripTags(locMatch[1]);

    // Department / category
    let department = '';
    const deptMatch = block.match(
      /class\s*=\s*"[^"]*\bjv-job-list-category\b[^"]*"[^>]*>([\s\S]*?)</i
    );
    if (deptMatch) department = stripTags(deptMatch[1]);

    rows.push({ title, href, jvId, location, department });
  }

  // Fallback: scan all anchors with `/job/` in href if structured parse missed.
  if (rows.length === 0) {
    const linkRe = /<a\b[^>]*href\s*=\s*"([^"]*\/job\/([A-Za-z0-9_-]+))"[^>]*>([\s\S]*?)<\/a>/gi;
    const seen = new Set();
    let lm;
    while ((lm = linkRe.exec(html)) !== null) {
      const jvId = lm[2];
      if (seen.has(jvId)) continue;
      const title = stripTags(lm[3]);
      if (!title || title.length > 200) continue;
      seen.add(jvId);
      rows.push({
        title,
        href: lm[1],
        jvId,
        location: '',
        department: '',
      });
    }
  }

  void tenant;
  return rows;
}

function normalizeJob(parsedRow, tenant, companyName) {
  // Resolve relative `/{tenant}/job/{id}` to absolute URL
  let url = parsedRow.href || '';
  if (url.startsWith('/')) url = `https://jobs.jobvite.com${url}`;
  else if (!/^https?:/i.test(url)) url = `https://jobs.jobvite.com/${tenant}/job/${parsedRow.jvId}`;

  return {
    source: 'jobvite',
    company: companyName || tenant,
    title: parsedRow.title,
    url,
    apply_url: url,
    location: parsedRow.location || '',
    description: '', // v0.8: list page only
    department: parsedRow.department || '',
    updated_at: '',
    employment_type: '',
    is_remote: /\bremote\b/i.test(parsedRow.location || ''),
    compensation: '',
    _source: 'jobvite',
    _tenant: tenant,
    _id: parsedRow.jvId,
    _disclaimer: 'v0.8 alpha — list-only, no description',
  };
}

// ---------- public API ----------

/**
 * fetchJobs(tenant, opts?) — fetch + normalize JobVite tenant board.
 *
 * Tries both URL patterns (modern + legacy) until one returns parseable rows.
 *
 *   tenant: e.g. "ringcentral", "cloudera"
 *   opts.companyName: override human-readable company name
 *
 * Returns: Promise<Array<NormalizedJob>>; [] on 404 or empty parse.
 */
export async function fetchJobs(tenant, opts = {}) {
  if (!tenant || typeof tenant !== 'string') {
    throw new TypeError('fetchJobs(tenant): tenant slug required');
  }
  const companyName = opts.companyName || tenant;
  const urls = buildPortalUrls(tenant);

  for (const url of urls) {
    await throttle();
    let result;
    try {
      result = await fetchHtml(url);
    } catch (err) {
      if (opts.verbose) console.warn(`[jobvite] ${url} fetch error: ${err.message}`);
      // retry once on transient
      await sleep(RETRY_BACKOFF_MS);
      try {
        result = await fetchHtml(url);
      } catch (err2) {
        if (opts.verbose) console.warn(`[jobvite] ${url} retry failed: ${err2.message}`);
        continue;
      }
    }
    if (!result.html) continue;
    const rows = parseJobViteListHtml(result.html, tenant);
    if (rows.length > 0) {
      return rows.map((r) => normalizeJob(r, tenant, companyName));
    }
    if (opts.verbose) {
      console.warn(
        `[jobvite] ${tenant} via ${url}: 0 rows parsed — likely JS-rendered widget. ` +
          `Try CDP fallback via shared/cdp.mjs.`
      );
    }
  }
  return [];
}

/**
 * fetchJobsForCompany(companyName, tenantCandidates, opts?) — try multiple
 * tenant slugs (e.g. "ringcentral", "ringcentral-careers") until one returns
 * non-empty. JobVite slugs are NOT predictable from company name.
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
      if (opts.verbose) console.warn(`[jobvite] ${companyName} via "${tenant}" failed: ${err.message}`);
    }
  }
  if (opts.verbose) {
    console.warn(`[jobvite] no jobs found for ${companyName} (tried: ${tried.join(', ')})`);
  }
  return [];
}

// ---------- role-type filtering ----------

const INTERN_TITLE_RE = /\b(intern|internship|co-?op|summer\s+202[5-7])\b/i;
const NEW_GRAD_TITLE_RE =
  /\b(new\s?grad|new\s?graduate|university\s?grad|university\s?graduate|early\s?career|recent\s?graduate|college\s?grad|entry\s?level)\b/i;

function matchesIntern(job) {
  return INTERN_TITLE_RE.test(job.title || '');
}

function matchesNewGradFT(job) {
  if (INTERN_TITLE_RE.test(job.title || '')) return false;
  return NEW_GRAD_TITLE_RE.test(job.title || '');
}

/**
 * filterByRoleType(jobs, roleTypes) — title-only filter (no employment_type
 * surfaced on JobVite list page). Caller should run AI scoring after to catch
 * mistitled roles.
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
// Usage: node shared/sourcing/jobvite_board_api.mjs <tenant>
if (import.meta.url === `file://${process.argv[1]}`) {
  const tenant = process.argv[2];
  if (!tenant) {
    console.error('Usage: node jobvite_board_api.mjs <tenant-slug>');
    console.error('Example: node jobvite_board_api.mjs ringcentral');
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
            department: j.department,
            url: j.url,
            jvId: j._id,
          })),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error('[jobvite v0.8 alpha] ' + err.message);
    process.exit(2);
  }
}
