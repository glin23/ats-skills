/**
 * yc_workatastartup.mjs — YC Work at a Startup job fetcher (v0.8 STUB)
 *
 * ⚠️  v0.8 STUB — NOT YET IMPLEMENTED. Sourcing only (no apply skill).
 *
 * YC Work at a Startup (workatastartup.com) aggregates 5700+ roles across
 * 1000+ YC-funded companies. There are two data sources to consider:
 *
 *   Strategy 1 (preferred, public):
 *     https://www.ycombinator.com/companies?batch={batch}
 *     YC's company directory. Returns paginated company cards with name,
 *     batch, status, tags, website. Does NOT include open roles, but gives
 *     us the canonical company list per batch (useful for cross-referencing
 *     Greenhouse/Lever/Ashby boards via shared/sourcing/company_list.json).
 *
 *   Strategy 2 (jobs, requires login):
 *     https://www.workatastartup.com/jobs
 *     Authenticated student-facing job list. 用户 logs in once via the
 *     existing Lily Profile (port 9222), and we scrape via cdp.mjs the same
 *     way handshake_search.mjs / wellfound_search.mjs will.
 *
 * Why no apply skill? WaaS "Apply" routes to the founder's inbox (a freeform
 * intro message + resume upload), or redirects to the company's primary ATS.
 * Both cases are unfit for auto-apply: founder intros need a tailored
 * pitch (用户 writes those by hand), and ATS redirects are already covered
 * by the Greenhouse/Lever/Ashby helpers. Keep this sourcing-only and let
 * the orchestrator log "manual apply required" for `ats=yc` rows.
 *
 * Implementation must wait until a real dogfood pass captures:
 *   1) The exact `workatastartup.com/jobs` filter URL pattern (role type,
 *      remote, location, batch, keywords).
 *   2) The DOM structure of job cards — likely a list of
 *      `[data-page="JobList"] .job-listing-card` (guessing — confirm).
 *   3) Whether the `/jobs.json` endpoint exists and accepts the auth cookie
 *      (some Rails apps expose a JSON variant of any HTML route).
 *   4) Pagination — appears to be `?page=N` with ~25 results per page.
 *   5) For Strategy 1: confirm `https://www.ycombinator.com/companies/api`
 *      (or whichever JSON endpoint powers the directory) is still public.
 *
 * Return shape (when implemented) matches recruitee_board_api.fetchJobs():
 *   { company, title, url, apply_url, location, description, department,
 *     updated_at, employment_type, is_remote, compensation, batch,
 *     _source: 'yc', _id: string }
 *
 * TODO (implementation steps when ready to dogfood):
 *   1. Try the public `ycombinator.com/companies?batch=<batch>` endpoint
 *      first. If it returns JSON, parse and return company stubs (no jobs
 *      yet — caller would then hit the company's own ATS).
 *   2. If `batches` is empty AND `opts.fetch_jobs` is true, fall back to
 *      authenticated workatastartup.com via cdp.mjs:
 *        - Navigate to `https://www.workatastartup.com/jobs?role_type=intern`.
 *        - Wait for `.job-listing-card` (TODO-verify) up to ~5s.
 *        - Extract per-card fields via in-page eval.
 *        - Page through with `?page=N` until empty or `page_limit` reached.
 *   3. Normalize. `apply_url` = workatastartup.com URL; orchestrator detects
 *      ATS redirects on click-through.
 *   4. Throttle: 1 req/sec for the public endpoint, 1 nav per 3s for CDP.
 *
 * Until then, the public functions below throw a clear "not yet implemented"
 * error so callers fail fast.
 */

const USER_AGENT = 'ats-skills/0.8 (+https://github.com/glin23/mrweirdo-jobs)';
const NOT_IMPLEMENTED_MSG =
  'yc_workatastartup.mjs is a v0.8 stub — real implementation requires either a public ycombinator.com/companies endpoint check or CDP scraping of authenticated workatastartup.com. See file header TODO.';

/**
 * fetchYCJobs(batches, opts)
 *
 * batches: string[]  // YC batch codes, e.g. ['W26', 'S25', 'W25', 'S24']
 *                    // Empty = "all batches" (will hit /jobs feed directly
 *                    // rather than per-batch directory).
 *
 * opts: {
 *   fetch_jobs?: boolean,    // if true, scrape workatastartup.com (auth);
 *                            // if false (default), only fetch company list
 *                            // from public ycombinator.com directory.
 *   keywords?: string,
 *   role_types?: string[],   // ['intern', 'new_grad_FT']
 *   page_limit?: number,     // default 5
 *   tab_id?: string,         // existing CDP tab id
 *   cdp_port?: number,       // default 9222
 *   verbose?: boolean,
 * }
 *
 * Returns: Array<NormalizedJob> matching recruitee_board_api shape.
 *
 * v0.8: throws NOT_IMPLEMENTED.
 */
export async function fetchYCJobs(batches = [], opts = {}) {
  void batches;
  void opts;
  throw new Error(NOT_IMPLEMENTED_MSG);
}

/**
 * filterByRoleType(jobs, roleTypes) — pass-through shim. Pre-implementation,
 * returns input unchanged.
 */
export function filterByRoleType(jobs, roleTypes = ['intern', 'new_grad_FT']) {
  if (!Array.isArray(jobs)) return [];
  if (jobs.length === 0) return [];
  // TODO: when fetchYCJobs returns real data, port Recruitee filter logic.
  // WaaS exposes `role_type` ("Intern" / "Full-time" / "Contract") on each
  // card — use that primarily and fall back to title regex.
  void roleTypes;
  return jobs;
}

// ---------- CLI smoke test ----------
// Usage: node shared/sourcing/yc_workatastartup.mjs W26 S25
if (import.meta.url === `file://${process.argv[1]}`) {
  const batches = process.argv.slice(2);
  try {
    const jobs = await fetchYCJobs(batches);
    console.log(JSON.stringify({ total: jobs.length, sample: jobs.slice(0, 3) }, null, 2));
  } catch (err) {
    console.error('[yc_workatastartup v0.8 stub] ' + err.message);
    console.error('User-Agent that real impl would use:', USER_AGENT);
    process.exit(2);
  }
}
