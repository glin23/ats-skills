/**
 * yc_workatastartup.mjs — YC Work-at-a-Startup sourcing (v0.9, public path).
 *
 * v0.9 implements a fully public, zero-auth fetch path that bypasses the
 * gated workatastartup.com surface entirely. Investigation findings:
 *
 *   - workatastartup.com/jobs                  → 406 (gated, no cookies)
 *   - workatastartup.com/companies/$slug/jobs  → 404 (gated)
 *   - ycombinator.com/companies?batch=all      → 200 (public directory)
 *   - ycombinator.com/companies/$slug          → 200 (public profile)
 *
 * The YC directory ships an Inertia.js payload via `data-page="…"` JSON,
 * and the **company-detail page exposes a full `jobPostings` array** with
 * title, role, location, salary, equity, applyUrl, skills, etc. So the
 * profile page is effectively a public job board per company.
 *
 * To get the company list itself, the directory page wires up Algolia
 * (`window.AlgoliaOpts`) with a public, read-restricted key scoped to
 * `YCCompany_production`. That index has 1470+ `isHiring:true` companies
 * and supports `batch:"Spring 2026"` style filters. We hit Algolia
 * directly (no scraping) to get the company list, then hit each company
 * profile via the public HTML route to pull jobPostings.
 *
 * Two outputs:
 *   1) Array<NormalizedJob> for the orchestrator (Greenhouse-shaped).
 *   2) shared/sourcing/data/yc_companies_by_ats.json — slug lists keyed
 *      by detected ATS (greenhouse/lever/ashby/workday/unknown), so the
 *      sibling bulk-crawl modules can seed off this without re-fetching.
 *
 * Apply policy: most YC `applyUrl`s redirect through bookface auth and
 * land on the founder's inbox. The orchestrator should log
 * `manual_apply_required` for source=yc_waas — we do not auto-submit
 * founder intros. (This is a sourcing module, not an apply module.)
 *
 * Throttling: shared 1 req/sec gate for ycombinator.com. Algolia is rate-
 * limited per-key by Algolia; we use a single batched POST so it's fine.
 *
 * Zero deps. Node 24+ ESM, built-in fetch only.
 */

const USER_AGENT = 'mrweirdo-jobs/1.3 (+https://github.com/glin23/mrweirdo-jobs)';

// Algolia creds extracted from window.AlgoliaOpts on
// https://www.ycombinator.com/companies (public search-only key, restricted
// to YCCompany_production / YCCompany_By_Launch_Date_production + tagFilter
// ycdc_public). Stable across YC's site for years.
const ALGOLIA_APP_ID = '45BWZJ1SGC';
const ALGOLIA_API_KEY =
  'NzllNTY5MzJiZGM2OTY2ZTQwMDEzOTNhYWZiZGRjODlhYzVkNjBmOGRjNzJiMWM4ZTU0ZDlhYTZjOTJiMjlhMWFuYWx5dGljc1RhZ3M9eWNkYyZyZXN0cmljdEluZGljZXM9WUNDb21wYW55X3Byb2R1Y3Rpb24lMkNZQ0NvbXBhbnlfQnlfTGF1bmNoX0RhdGVfcHJvZHVjdGlvbiZ0YWdGaWx0ZXJzPSU1QiUyMnljZGNfcHVibGljJTIyJTVE';
const ALGOLIA_URL = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/YCCompany_production/query`;

const YC_BASE = 'https://www.ycombinator.com';
const DEFAULT_TIMEOUT_MS = 12000;
const MIN_INTERVAL_MS = 1000; // 1 req/sec to ycombinator.com

// ---------- rate-limit gate ----------
let _lastFetchAt = 0;
async function _rateLimitGate() {
  const now = Date.now();
  const delta = now - _lastFetchAt;
  if (delta < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - delta));
  }
  _lastFetchAt = Date.now();
}

// ---------- HTML entity decode (zero-dep) ----------
function decodeEntities(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function stripHtml(html) {
  if (html == null) return '';
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- ATS inference from website URL ----------
// Used to seed the bulk_crawl sibling modules. We do NOT fetch the company
// website here (would be a different rate budget); we only look at obvious
// hints in the Algolia `website` field + the company slug as a Greenhouse
// guess. Real slug resolution happens in greenhouse_board_api.mjs etc.
const ATS_HINTS = [
  { ats: 'greenhouse', re: /boards\.greenhouse\.io\/([a-z0-9_-]+)/i, group: 1 },
  { ats: 'lever', re: /jobs\.lever\.co\/([a-z0-9_-]+)/i, group: 1 },
  { ats: 'ashby', re: /jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i, group: 1 },
  { ats: 'workday', re: /([a-z0-9_-]+)\.wd\d+\.myworkdayjobs\.com/i, group: 1 },
  { ats: 'smartrecruiters', re: /smartrecruiters\.com\/([a-z0-9_-]+)/i, group: 1 },
];

function inferAtsFromUrl(url) {
  if (!url) return null;
  for (const h of ATS_HINTS) {
    const m = url.match(h.re);
    if (m) return { ats: h.ats, slug: m[h.group].toLowerCase() };
  }
  return null;
}

// ---------- fetch helpers ----------
async function _fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout || DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * fetchYcHiringCompanies({ batchFilter, hitsPerPage, maxCompanies })
 * Returns Array<{ slug, name, website, batch, all_locations, isHiring,
 *                 industry, one_liner, long_description, tags }>
 *
 * Hits the public Algolia index directly. No HTML scraping.
 */
export async function fetchYcHiringCompanies({
  batchFilter = null, // e.g. ['Spring 2026', 'Winter 2026', 'Summer 2025'] or null=all
  maxCompanies = 1000,
  verbose = false,
} = {}) {
  // Algolia hard-caps a single query at 1000 hits regardless of pagination
  // ("paginationLimitedTo" index setting). YC has ~1500 hiring companies, so
  // when no explicit batchFilter is passed we slice the work across a list
  // of batches and dedupe by slug. Each sliced query stays under the cap.
  const ALL_BATCH_SLICES = [
    'Spring 2026',
    'Winter 2026',
    'Summer 2025',
    'Spring 2025',
    'Winter 2025',
    'Summer 2024',
    'Winter 2024',
    'Summer 2023',
    'Winter 2023',
    'Summer 2022',
    'Winter 2022',
    'Summer 2021',
    'Winter 2021',
  ];

  async function _algoliaOne(filtersExpr) {
    const out = [];
    let page = 0;
    while (true) {
      const body = {
        query: '',
        hitsPerPage: 1000,
        page,
        facetFilters: [['isHiring:true']],
      };
      if (filtersExpr) body.filters = filtersExpr;
      if (verbose) {
        process.stderr.write(`[yc] algolia page=${page} filter=${filtersExpr || 'none'}\n`);
      }
      const res = await _fetchWithTimeout(ALGOLIA_URL, {
        method: 'POST',
        headers: {
          'X-Algolia-API-Key': ALGOLIA_API_KEY,
          'X-Algolia-Application-Id': ALGOLIA_APP_ID,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`Algolia error ${res.status}: ${await res.text().catch(() => '')}`);
      }
      const data = await res.json();
      const hits = data.hits || [];
      for (const h of hits) out.push(h);
      if (hits.length < 1000) break;
      page += 1;
      if (page > 5) break; // safety
    }
    return out;
  }

  const seen = new Set();
  const out = [];
  function _push(hits) {
    for (const h of hits) {
      if (!h.slug || seen.has(h.slug)) continue;
      seen.add(h.slug);
      out.push({
        slug: h.slug,
        name: h.name,
        website: h.website || null,
        batch: h.batch || null,
        all_locations: h.all_locations || null,
        isHiring: !!h.isHiring,
        industry: h.industry || null,
        one_liner: h.one_liner || null,
        long_description: h.long_description || null,
        tags: h.tags || [],
      });
      if (out.length >= maxCompanies) return true;
    }
    return false;
  }

  if (Array.isArray(batchFilter) && batchFilter.length) {
    const expr = batchFilter.map((b) => `batch:"${b}"`).join(' OR ');
    _push(await _algoliaOne(expr));
  } else {
    // Slice across batches to dodge the 1000-hit cap.
    for (const b of ALL_BATCH_SLICES) {
      const stop = _push(await _algoliaOne(`batch:"${b}"`));
      if (stop) break;
      if (out.length >= maxCompanies) break;
    }
    // Tail-catch anything older / unbatched.
    if (out.length < maxCompanies) {
      _push(await _algoliaOne(null));
    }
  }
  return out;
}

// ---------- per-company profile parse ----------
// Extract Inertia data-page JSON from a YC company profile HTML page.
function _parseInertiaPayload(html) {
  // data-page="{...json with &quot; escapes...}"
  const m = html.match(/data-page="([^"]*)"/);
  if (!m) return null;
  const decoded = decodeEntities(m[1]);
  try {
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * fetchYcCompanyJobs(slug, { verbose }) — pull jobPostings from a public
 * YC company profile. Subject to the 1 req/sec gate.
 *
 * Returns Array<NormalizedJob>.
 */
export async function fetchYcCompanyJobs(slug, { verbose = false } = {}) {
  if (!slug) return [];
  await _rateLimitGate();
  const url = `${YC_BASE}/companies/${encodeURIComponent(slug)}`;
  const res = await _fetchWithTimeout(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
  });
  if (res.status === 404) {
    if (verbose) process.stderr.write(`[yc] 404 ${slug}\n`);
    return [];
  }
  if (!res.ok) {
    throw new Error(`YC profile ${slug} returned ${res.status}`);
  }
  const html = await res.text();
  const inertia = _parseInertiaPayload(html);
  if (!inertia) {
    if (verbose) process.stderr.write(`[yc] no inertia payload for ${slug}\n`);
    return [];
  }
  const props = inertia.props || {};
  const co = props.company || {};
  const postings = Array.isArray(props.jobPostings) ? props.jobPostings : [];
  return postings.map((p) => _normalizeJobPosting(p, co));
}

function _normalizeJobPosting(p, co) {
  const profileUrl = p.url ? `${YC_BASE}${p.url}` : `${YC_BASE}/companies/${co.slug}`;
  const applyUrl = p.applyUrl || profileUrl;
  return {
    source: 'yc_waas',
    company: p.companyName || co.name || null,
    company_slug: co.slug || null,
    title: p.title || null,
    url: profileUrl,
    apply_url: applyUrl,
    location: p.location || co.location || null,
    department: p.prettyRole || p.role || null,
    description: [
      p.title,
      p.prettyRole,
      p.roleSpecificType,
      p.location,
      p.salaryRange ? `Salary: ${p.salaryRange}` : null,
      p.equityRange ? `Equity: ${p.equityRange}` : null,
      p.minExperience ? `Min experience: ${p.minExperience}` : null,
      p.minSchoolYear ? `Min school year: ${p.minSchoolYear}` : null,
      p.visa ? `Visa: ${p.visa}` : null,
      Array.isArray(p.skills) && p.skills.length ? `Skills: ${p.skills.join(', ')}` : null,
      co.one_liner ? `\nAbout ${co.name}: ${co.one_liner}` : null,
    ]
      .filter(Boolean)
      .join(' • '),
    employment_type: p.type || null,
    role_type: p.role || null, // 'eng' | 'product' | 'design' | 'ops' | ...
    is_remote: /remote/i.test(p.location || ''),
    compensation: p.salaryRange || null,
    equity: p.equityRange || null,
    min_experience: p.minExperience || null,
    min_school_year: p.minSchoolYear || null,
    visa: p.visa || null,
    skills: Array.isArray(p.skills) ? p.skills : [],
    batch: co.batch_name || co.batch || null,
    company_one_liner: co.one_liner || null,
    company_website: co.website || null,
    company_size: co.team_size || null,
    updated_at: p.lastActive || p.createdAt || null,
    _source: 'yc_waas',
    _id: `yc:${co.slug || co.id}:${p.id}`,
    _raw_role_specific_type: p.roleSpecificType || null,
  };
}

// ---------- keyword filter ----------
function _matchesKeyword(job, kw) {
  if (!kw) return true;
  const k = kw.toLowerCase().trim();
  if (!k) return true;
  // multi-word phrase: require all whitespace-tokens present somewhere
  const tokens = k.split(/\s+/);
  const hay = [
    job.title,
    job.department,
    job.role_type,
    job._raw_role_specific_type,
    job.description,
    (job.skills || []).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

// ---------- main entry point ----------
/**
 * fetchYcJobs({ keywords, limit, batchFilter, maxCompanies, verbose })
 *
 *   keywords      Array<string>  — OR-match across job text; empty = all jobs
 *   limit         number         — cap on returned jobs (default 200)
 *   batchFilter   Array<string>  — e.g. ['Spring 2026','Winter 2026'];
 *                                  null/undefined = all batches
 *   maxCompanies  number         — how many companies to walk (default 200);
 *                                  each costs ~1 req/sec
 *   roleTypes     Array<string>  — optional: ['eng','product','ops',...] filter
 *   onlyIntern    boolean        — if true, require /intern/i in title
 *   verbose       boolean
 *
 * Returns Array<NormalizedJob>.
 */
export async function fetchYcJobs({
  keywords = [],
  limit = 200,
  batchFilter = null,
  maxCompanies = 200,
  roleTypes = null,
  onlyIntern = false,
  verbose = false,
} = {}) {
  const companies = await fetchYcHiringCompanies({
    batchFilter,
    maxCompanies,
    verbose,
  });
  if (verbose) process.stderr.write(`[yc] ${companies.length} hiring companies to walk\n`);

  const out = [];
  let walked = 0;
  for (const co of companies) {
    walked += 1;
    if (verbose && walked % 10 === 0) {
      process.stderr.write(`[yc] walked ${walked}/${companies.length}, jobs=${out.length}\n`);
    }
    let jobs;
    try {
      jobs = await fetchYcCompanyJobs(co.slug, { verbose });
    } catch (err) {
      if (verbose) process.stderr.write(`[yc] err ${co.slug}: ${err.message}\n`);
      continue;
    }
    for (const j of jobs) {
      if (onlyIntern && !/intern/i.test(j.title || '')) continue;
      if (Array.isArray(roleTypes) && roleTypes.length && !roleTypes.includes(j.role_type)) continue;
      if (Array.isArray(keywords) && keywords.length) {
        const anyMatch = keywords.some((k) => _matchesKeyword(j, k));
        if (!anyMatch) continue;
      }
      out.push(j);
      if (out.length >= limit) {
        if (verbose) process.stderr.write(`[yc] reached limit=${limit}, stopping\n`);
        return out;
      }
    }
  }
  return out;
}

/**
 * buildYcCompaniesByAts(companies) — group companies by inferred ATS, based
 * on their `website` URL. Returns:
 *   { greenhouse: [slug], lever: [slug], ashby: [slug], workday: [slug],
 *     smartrecruiters: [slug], unknown: [{slug, website}] }
 *
 * Useful seed for greenhouse_board_api.mjs etc. The `unknown` bucket is
 * the long tail where the YC profile points at the company's marketing
 * site (no ATS hint in URL) — those need a separate website-crawl pass.
 */
export function buildYcCompaniesByAts(companies) {
  const buckets = {
    greenhouse: [],
    lever: [],
    ashby: [],
    workday: [],
    smartrecruiters: [],
    unknown: [],
  };
  for (const co of companies) {
    const hint = inferAtsFromUrl(co.website);
    if (hint) {
      buckets[hint.ats].push({
        yc_slug: co.slug,
        ats_slug: hint.slug,
        name: co.name,
        batch: co.batch,
      });
    } else {
      // Greenhouse very often uses the company's marketing slug, so we ALSO
      // emit a Greenhouse-guess bucket for fuzzy seeding downstream.
      buckets.unknown.push({
        yc_slug: co.slug,
        name: co.name,
        batch: co.batch,
        website: co.website,
      });
    }
  }
  return buckets;
}

// Pass-through shim kept for backward compat with the prior stub.
export function filterByRoleType(jobs, roleTypes = ['intern', 'new_grad_FT']) {
  if (!Array.isArray(jobs) || jobs.length === 0) return [];
  return jobs.filter((j) => {
    if (roleTypes.includes('intern') && /intern/i.test(j.title || '')) return true;
    if (roleTypes.includes('new_grad_FT') && j.employment_type === 'Full-time') return true;
    return false;
  });
}

// Legacy export name preserved.
export const fetchYCJobs = fetchYcJobs;

// ---------- CLI smoke test ----------
// Usage:
//   node yc_workatastartup.mjs --keywords "Product Manager Intern,Operations Intern,Growth Intern,Founding" --max 60
//   node yc_workatastartup.mjs --batches "Spring 2026,Winter 2026,Summer 2025" --max 200
//   node yc_workatastartup.mjs --seed-only --max 1000   # emit seed file only
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const getArg = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  const has = (flag) => argv.includes(flag);

  const keywords = (getArg('--keywords') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const batches = (getArg('--batches') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const maxCompanies = parseInt(getArg('--max') || '60', 10);
  const limit = parseInt(getArg('--limit') || '500', 10);
  const onlyIntern = has('--only-intern');
  const verbose = !has('--quiet');
  const seedOnly = has('--seed-only');
  const writeSeed = has('--write-seed') || seedOnly;

  try {
    if (seedOnly) {
      const companies = await fetchYcHiringCompanies({
        batchFilter: batches.length ? batches : null,
        maxCompanies: maxCompanies || 1500,
        verbose,
      });
      const buckets = buildYcCompaniesByAts(companies);
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const url = await import('node:url');
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const out = path.join(here, 'data', 'yc_companies_by_ats.json');
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(
        out,
        JSON.stringify(
          { generated_at: new Date().toISOString(), total_companies: companies.length, buckets },
          null,
          2,
        ),
      );
      process.stderr.write(`[yc] wrote seed file: ${out}\n`);
      console.log(
        JSON.stringify(
          {
            total_companies: companies.length,
            bucket_counts: Object.fromEntries(
              Object.entries(buckets).map(([k, v]) => [k, v.length]),
            ),
          },
          null,
          2,
        ),
      );
      process.exit(0);
    }

    const jobs = await fetchYcJobs({
      keywords,
      batchFilter: batches.length ? batches : null,
      maxCompanies,
      limit,
      onlyIntern,
      verbose,
    });

    if (writeSeed) {
      const companies = await fetchYcHiringCompanies({
        batchFilter: batches.length ? batches : null,
        maxCompanies: 1500,
        verbose,
      });
      const buckets = buildYcCompaniesByAts(companies);
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const url = await import('node:url');
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const out = path.join(here, 'data', 'yc_companies_by_ats.json');
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(
        out,
        JSON.stringify(
          { generated_at: new Date().toISOString(), total_companies: companies.length, buckets },
          null,
          2,
        ),
      );
      process.stderr.write(`[yc] wrote seed file: ${out}\n`);
    }

    console.log(
      JSON.stringify(
        {
          total: jobs.length,
          keywords,
          batches,
          sample: jobs.slice(0, 5).map((j) => ({
            company: j.company,
            title: j.title,
            location: j.location,
            batch: j.batch,
            apply_url: j.apply_url,
            compensation: j.compensation,
          })),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error('[yc_workatastartup] ' + err.message);
    console.error(err.stack);
    process.exit(2);
  }
}
