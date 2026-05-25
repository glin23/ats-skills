/**
 * handshake_search.mjs — Handshake job search (v0.6 STUB)
 *
 * ⚠️  v0.6 STUB — NOT YET IMPLEMENTED
 *
 * Handshake does NOT publish a public Job Board API (unlike Greenhouse and
 * Ashby). All search must go through the authenticated student-facing
 * web UI on `app.joinhandshake.com/jobs`. That means:
 *
 *   - We need the user's Chrome session (already logged into Handshake
 *     via school SSO) — same isolated Lily Profile (port 9222) used by
 *     the apply skills.
 *   - We can't hit a JSON endpoint blind. We must navigate to the search
 *     URL, wait for the React job list to render, scrape DOM nodes, and
 *     normalize to the shared sourcing shape (matches
 *     greenhouse_board_api / ashby_board_api).
 *
 * Implementation must wait until we've done a real dogfood pass and
 * captured:
 *   1) The actual URL pattern that encodes search keywords + filters
 *      (e.g. `/stu/jobs?employment_types[]=Internship&keywords=AI`).
 *   2) The DOM structure of the job result list — likely a virtualized
 *      list of React cards with `data-hook="job-card"` (guessing based
 *      on Handshake's `data-hook` convention).
 *   3) Pagination — Handshake uses infinite scroll OR offset-based
 *      pagination; needs verification.
 *   4) Whether Handshake throttles automated DOM scraping. Per their
 *      docs daily cap is 300 applications, but read-only browsing
 *      throttles are unknown.
 *
 * Return shape (when implemented) matches ashby_board_api.fetchJobs():
 *   {
 *     company: string,
 *     title: string,
 *     url: string,
 *     apply_url: string,
 *     location: string,
 *     description: string,
 *     department: string,
 *     updated_at: string,
 *     employment_type: string,
 *     is_remote: boolean,
 *     compensation: string,
 *     _source: 'handshake',
 *     _id: string,  // Handshake job id
 *   }
 *
 * TODO (implementation steps when ready to dogfood):
 *   1. Use shared/cdp.mjs `goto` to navigate the authenticated Chrome tab to:
 *      `https://app.joinhandshake.com/stu/jobs?<query>`
 *      where <query> encodes searchOpts (keywords, employment_types, locations).
 *   2. Wait for job cards to render — poll for selector
 *      `[data-hook="jobs-list"] [data-hook="job-card"]` (TODO-verify) up to ~5s.
 *   3. Use `cdp.mjs eval` to run an in-page extractor that returns
 *      `Array<{title, company, location, url, employment_type, id}>` per card.
 *   4. For each result, optionally fetch full description by navigating to
 *      `/jobs/<id>` and scraping the detail page (more expensive — only do
 *      this for top-K results, similar to how Career-Ops 4-level cascade
 *      defers detailed scraping).
 *   5. Normalize to the shared sourcing shape. Set `apply_url` to the
 *      Handshake URL itself — the orchestrator will let ats-handshake skill
 *      decide whether to use it or detect external-ATS redirect.
 *   6. Throttle: 1 navigation per 3s (more conservative than ashby/greenhouse
 *      since we're scraping DOM, not hitting an official API).
 *   7. Honor Handshake daily 300 cap with a per-day request counter persisted
 *      to `~/.ats-skills/handshake_quota.json`.
 *
 * Until then, the public functions below throw a clear "not yet implemented"
 * error so callers fail fast rather than silently treat handshake as empty.
 */

const USER_AGENT = 'ats-skills/0.6 (+https://github.com/glin23/mrweirdo-jobs)';
const NOT_IMPLEMENTED_MSG =
  'handshake_search.mjs is a v0.6 stub — real implementation requires CDP-driven scraping of authenticated Handshake UI. See file header TODO for implementation steps.';

/**
 * searchHandshakeJobs(searchOpts, opts)
 *
 * searchOpts: {
 *   keywords?: string,
 *   employment_types?: string[],   // e.g. ['Internship', 'FullTime']
 *   locations?: string[],          // e.g. ['United States', 'Remote']
 *   page_limit?: number,           // max pages to scrape (default 3)
 * }
 *
 * opts: {
 *   tab_id?: string,               // existing CDP tab id (if caller pre-opened)
 *   cdp_port?: number,             // default 9222
 *   verbose?: boolean,
 * }
 *
 * Returns: Array<NormalizedJob> matching ashby_board_api shape.
 *
 * v0.6: throws NOT_IMPLEMENTED. Caller should catch and log "handshake sourcing
 * deferred to v0.7" rather than crash the whole sourcing pipeline.
 */
export async function searchHandshakeJobs(searchOpts = {}, opts = {}) {
  // No-op references to silence "unused parameter" lints — once implemented,
  // both will drive the CDP navigation + extractor.
  void searchOpts;
  void opts;
  throw new Error(NOT_IMPLEMENTED_MSG);
}

/**
 * filterByRoleType(jobs, roleTypes) — pass-through shim mirroring the Ashby
 * client API. Works on whatever shape searchHandshakeJobs returns (once
 * implemented), filtering by employment_type / title.
 *
 * Pre-implementation: returns the input unchanged. Caller may call this on an
 * empty array safely.
 */
export function filterByRoleType(jobs, roleTypes = ['intern', 'new_grad_FT']) {
  if (!Array.isArray(jobs)) return [];
  if (jobs.length === 0) return [];
  // TODO: when searchHandshakeJobs returns real data, port the Ashby filter
  // (matchesIntern / matchesNewGradFT) here.
  void roleTypes;
  return jobs;
}

// ---------- CLI smoke test ----------
// Usage: node shared/sourcing/handshake_search.mjs "AI intern"
if (import.meta.url === `file://${process.argv[1]}`) {
  const kw = process.argv[2] || '';
  try {
    const jobs = await searchHandshakeJobs({ keywords: kw });
    console.log(JSON.stringify({ total: jobs.length, sample: jobs.slice(0, 3) }, null, 2));
  } catch (err) {
    console.error('[handshake_search v0.6 stub] ' + err.message);
    console.error('User-Agent that real impl would use:', USER_AGENT);
    process.exit(2);
  }
}
