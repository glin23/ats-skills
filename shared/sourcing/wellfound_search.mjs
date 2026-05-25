/**
 * wellfound_search.mjs — Wellfound (AngelList Talent) job search (v0.9 GATED STUB)
 *
 * STATUS: APPROACH (d) — DataDome-gated. No zero-dep HTTP path is viable.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  USAGE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   import { fetchWellfoundJobs } from './wellfound_search.mjs';
 *
 *   const result = await fetchWellfoundJobs({
 *     keywords: ['Product Manager Intern'],
 *     limit: 200,
 *   });
 *
 *   // result is ALWAYS an array (matches RemoteOK / Greenhouse / Ashby contract).
 *   // When the live path is gated, the array is EMPTY but result.implemented === false
 *   // is exposed via the named export `lastFetchStatus()` so the orchestrator can
 *   // log "wellfound deferred" without crashing the pipeline.
 *
 *   const status = lastFetchStatus();
 *   //  → { implemented: false,
 *   //       reason: 'datadome-blocked',
 *   //       recommended_next_step: '...' }
 *
 *   // CLI smoke test:
 *   //   node shared/sourcing/wellfound_search.mjs --keywords "Product Manager Intern"
 *   //   node shared/sourcing/wellfound_search.mjs --keywords "Product Manager Intern,Operations Intern,Growth Intern"
 *
 * Job shape (when populated) matches the unified contract used by
 * remoteok_api.mjs / greenhouse_board_api.mjs:
 *
 *   { apply_url, company, title, location, description,
 *     source: 'wellfound', raw_tags, salary_min, salary_max,
 *     // plus: url, raw_id, department, updated_at, salary_currency, salary_interval }
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  INVESTIGATION NOTES (2026-05-25)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Wellfound retired the v1 public AngelList API circa 2019. Every public
 * surface is now behind DataDome bot detection. Probed during this build:
 *
 *   GET https://wellfound.com/jobs                       → 403 DataDome challenge (1.7 KB)
 *   GET https://wellfound.com/jobs?role=product-manager  → 403 DataDome
 *   GET https://wellfound.com/role/product-manager       → 403 DataDome
 *   GET https://wellfound.com/role/l/pm/san-francisco    → 403 DataDome
 *   GET https://wellfound.com/sitemap.xml                → 403 DataDome
 *   GET https://wellfound.com/sitemaps/v1                → 403 DataDome
 *   GET https://wellfound.com/jobs (UA: Googlebot/2.1)   → 403 DataDome
 *
 * Body signature on every 403:
 *   <p id="cmsg">Please enable JS and disable any ad blocker</p>
 *   var dd={'rt':'c','cid':'...','host':'geo.captcha-delivery.com',...}
 *
 * robots.txt (HTTP 200, the ONLY unauth-readable endpoint) explicitly
 * disallows the relevant patterns to *all* user-agents:
 *
 *     Disallow: /*?role=*
 *     Disallow: /*?jobId=*
 *     Disallow: /*?jobSlug=*
 *     Disallow: /_jobs/
 *     Disallow: /embed/
 *
 * Options evaluated:
 *
 *   (a) Public HTML + __NEXT_DATA__ scrape
 *       Theoretically the cleanest path — Wellfound's Next.js app embeds the
 *       full Apollo graph in <script id="__NEXT_DATA__">. Confirmed by the
 *       Scrapfly tutorial (April 2026). BUT: HTML never returns 200 from a
 *       vanilla fetch. DataDome fingerprints TLS (JA3), HTTP/2 frame order,
 *       Accept-Language entropy, and runs a JS interrogation challenge
 *       (`geo.captcha-delivery.com`). Zero-dep node:fetch cannot pass this.
 *       Commercial unlockers (ScrapFly asp=True, Bright Data Web Unlocker,
 *       ZenRows) all advertise Wellfound specifically as a paid bypass target.
 *
 *   (b) Internal GraphQL endpoint (wellfound.com/graphql)
 *       Same DataDome shield + requires CSRF token from a successful HTML load.
 *       Not reachable without first solving (a).
 *
 *   (c) Sitemap-driven crawl
 *       Sitemaps return 403 too. Dead end.
 *
 *   (d) Authenticated CDP-driven browser (CHOSEN — deferred to runtime)
 *       Drive the existing logged-in Chrome (Lily profile, port 9222) via
 *       shared/cdp.mjs. This is the same pattern Ashby / Workday / Handshake
 *       apply skills use. 用户 logs in once; the scraper reuses the session.
 *       NOT implemented in this file because (1) it requires a live Chrome
 *       instance with the Lily profile active, (2) it cannot run in CI / from
 *       a cold smoke test, and (3) the parent v2 PRD treats Wellfound sourcing
 *       as a P3 item.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  FUTURE COMPUTER-USE IMPLEMENTATION (the contract for v0.9 → v1.0)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Concrete steps when the orchestrator is ready to dogfood:
 *
 *   1. Caller ensures the Lily Chrome profile is running:
 *        sh shared/chrome-cdp-launcher.sh   (already in repo)
 *      用户 manually completes Wellfound login once; cookies persist in Profile 7.
 *
 *   2. import { goto, evalInTab, waitFor } from '../cdp.mjs';
 *      const tab = await goto(`https://wellfound.com/jobs?keywords=${enc(kw)}`,
 *                             { cdp_port: opts.cdp_port ?? 9222 });
 *
 *   3. await waitFor(tab, () =>
 *        document.querySelector('script#__NEXT_DATA__') ||
 *        document.querySelector('[data-test="JobSearchResults"]'),
 *        { timeout_ms: 8000 });
 *
 *   4. Pull __NEXT_DATA__ JSON (preferred — gives all fields at once):
 *        const nextData = await evalInTab(tab, () => {
 *          const el = document.getElementById('__NEXT_DATA__');
 *          return el ? JSON.parse(el.textContent) : null;
 *        });
 *      Walk nextData.props.pageProps.apolloState — Wellfound stores entries
 *      keyed as `JobListingSearchResult:{id}` and `Startup:{id}` with refs
 *      (`__ref`) between them. Unpack like Scrapfly's `unpack_apollo` helper:
 *      resolve every `{__ref}` to the referenced node, recursively.
 *
 *   5. Map each JobListingSearchResult to the unified shape:
 *        company       ← startup.name                (via ref)
 *        title         ← title
 *        location      ← locationNames.join(', ') || 'Remote'
 *        url           ← `https://wellfound.com/jobs/${slug}-${id}`
 *        apply_url     ← same (the orchestrator detects external-ATS
 *                              redirects on click and re-routes)
 *        description   ← descriptionHtml stripped (use stripHtml from remoteok)
 *        raw_tags      ← startup.markets + roleType + remote ? ['remote'] : []
 *        salary_min/max ← compensation.{min,max} (often null on listing)
 *        source        ← 'wellfound'
 *
 *   6. Pagination: Wellfound uses cursor pagination inside Apollo. The
 *      simplest reliable path is to scroll the results container 5–10 times
 *      with 2s waits, re-read __NEXT_DATA__ (it gets patched in place), and
 *      dedupe by JobListingSearchResult id. Cap at `limit`.
 *
 *   7. Politeness: max 1 navigation / 3s (DataDome ramps challenges quickly
 *      under load even for authed sessions). Single-digit requests/min.
 *
 *   8. Optional second pass: navigate to `/jobs/{id}` for top-K results to
 *      get the full descriptionHtml. Defer unless scoring needs it.
 *
 * Apply automation is intentionally NOT in scope. Wellfound "Apply" buttons
 * mostly redirect to the company's primary ATS (Greenhouse / Lever / Ashby)
 * OR open a recruiter-message thread. Sourcing-only — orchestrator re-routes
 * by destination ATS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 */

// Browser UA — used for the SOLE unauth probe we make (robots.txt) and would
// be used by a future CDP impl as a sanity-check headers map.
// (We do NOT issue any other unauthenticated requests from this file — every
//  other Wellfound endpoint 403s with DataDome.)
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 mrweirdo-jobs/1.3';

const REASON_DATADOME =
  'wellfound.com is fully gated by DataDome bot detection — every public ' +
  'HTML/sitemap/GraphQL endpoint returns HTTP 403 with a JS challenge from ' +
  'geo.captcha-delivery.com. Zero-dep node:fetch cannot bypass this.';

const NEXT_STEP =
  'Implement via shared/cdp.mjs against an authenticated Chrome tab on the ' +
  'Lily profile (Profile 7, port 9222). Read window.__NEXT_DATA__ from ' +
  'https://wellfound.com/jobs?keywords=<kw>, unpack the Apollo graph, map ' +
  'JobListingSearchResult nodes to the unified job shape. Full step-by-step ' +
  'in this file header. Estimated 2–3h to dogfood once 用户 logs in once.';

let _lastStatus = {
  implemented: false,
  reason: 'not-attempted',
  recommended_next_step: NEXT_STEP,
  matches: 0,
  keywords: [],
  attempted_at: null,
};

/**
 * lastFetchStatus()
 *
 * Returns the gate status from the most recent fetchWellfoundJobs() call.
 * Use this from the sourcing orchestrator to distinguish "Wellfound returned
 * zero matches" from "Wellfound is currently un-fetchable". Mirrors the
 * pattern v0.9 uses for handshake_search.mjs.
 */
export function lastFetchStatus() {
  return { ..._lastStatus };
}

/**
 * fetchWellfoundJobs({ keywords, limit, ...filters })
 *
 * Primary entry point. ALWAYS returns an array (possibly empty) — never
 * throws on the gate condition, so the sourcing pipeline can call it in
 * parallel with the other 14 boards without try/catch.
 *
 * Side-effect: updates the module-level status readable via lastFetchStatus().
 *
 * filters (forwarded to future CDP impl, currently unused):
 *   location?: string          // e.g. 'San Francisco' | 'Remote'
 *   role_types?: string[]      // ['intern', 'new_grad_FT']
 *   remote_only?: boolean
 *
 * @returns {Promise<Array<UnifiedJob>>}
 */
export async function fetchWellfoundJobs(opts = {}) {
  const { keywords = [], limit = 200, ...filters } = opts;
  const kwArray = Array.isArray(keywords)
    ? keywords
    : String(keywords || '').split(',').map((s) => s.trim()).filter(Boolean);

  _lastStatus = {
    implemented: false,
    reason: 'datadome-blocked',
    detail: REASON_DATADOME,
    recommended_next_step: NEXT_STEP,
    matches: 0,
    keywords: kwArray,
    limit,
    filters,
    attempted_at: new Date().toISOString(),
    user_agent: USER_AGENT,
  };

  // No network call. The probe was performed during file authoring; every
  // public endpoint returns DataDome 403. Making a request here would only
  // burn rate-limit budget on a known-failing host.
  return [];
}

/**
 * Back-compat shim: the previous v0.8 stub exported searchWellfoundJobs().
 * Some early callers may still reference it. Delegate to the new API and
 * surface the same gated result.
 */
export async function searchWellfoundJobs(searchOpts = {}, _opts = {}) {
  const keywords = searchOpts.keywords
    ? (Array.isArray(searchOpts.keywords) ? searchOpts.keywords : [searchOpts.keywords])
    : [];
  return fetchWellfoundJobs({
    keywords,
    limit: searchOpts.page_limit ? searchOpts.page_limit * 20 : 200,
    location: searchOpts.location,
    role_types: searchOpts.role_types,
    remote_only: searchOpts.remote_only,
  });
}

/**
 * filterByRoleType — pass-through shim mirroring the other sourcing clients.
 * Will gain real logic once searchWellfoundJobs returns populated arrays.
 */
export function filterByRoleType(jobs, roleTypes = ['intern', 'new_grad_FT']) {
  if (!Array.isArray(jobs) || jobs.length === 0) return [];
  void roleTypes;
  return jobs;
}

// ─────────────────────────────────────────────────────────────────────────
// CLI smoke test
//   node shared/sourcing/wellfound_search.mjs --keywords "Product Manager Intern"
//   node shared/sourcing/wellfound_search.mjs --keywords "PM Intern,Ops Intern,Growth Intern"
// stderr: human-readable progress + gate diagnosis
// stdout: JSON { total, status, sample }
// Exit codes:
//   0  → array returned (possibly empty, status.implemented=true)
//   2  → gated (status.implemented=false) — for shell `&&` chaining
// ─────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let keywordsRaw = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--keywords' && args[i + 1]) {
      keywordsRaw = args[i + 1];
      i++;
    } else if (args[i].startsWith('--keywords=')) {
      keywordsRaw = args[i].slice('--keywords='.length);
    } else if (!keywordsRaw && !args[i].startsWith('--')) {
      keywordsRaw = args[i];
    }
  }
  const keywords = keywordsRaw
    ? keywordsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : ['Product Manager Intern', 'Operations Intern', 'Growth Intern'];

  process.stderr.write(`[wellfound] smoke test — keywords: ${JSON.stringify(keywords)}\n`);
  process.stderr.write(`[wellfound] User-Agent that future CDP impl will use:\n  ${USER_AGENT}\n`);

  const jobs = await fetchWellfoundJobs({ keywords, limit: 200 });
  const status = lastFetchStatus();

  if (!status.implemented) {
    process.stderr.write(`[wellfound] GATED — ${status.reason}\n`);
    process.stderr.write(`[wellfound] ${status.detail}\n`);
    process.stderr.write(`[wellfound] Next step: ${status.recommended_next_step}\n`);
  } else {
    process.stderr.write(`[wellfound] OK — ${jobs.length} raw matches\n`);
  }

  process.stdout.write(
    JSON.stringify(
      {
        total: jobs.length,
        status,
        sample: jobs.slice(0, 3),
      },
      null,
      2
    ) + '\n'
  );

  process.exit(status.implemented ? 0 : 2);
}
