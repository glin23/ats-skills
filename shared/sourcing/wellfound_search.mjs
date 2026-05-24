/**
 * wellfound_search.mjs — Wellfound (AngelList Talent) job search (v0.8 STUB)
 *
 * ⚠️  v0.8 STUB — NOT YET IMPLEMENTED. Sourcing only (no apply skill).
 *
 * Wellfound (formerly AngelList Talent) lists ~130k startup jobs at
 * https://wellfound.com/jobs. There is no public board API. Their internal
 * GraphQL endpoint (`https://wellfound.com/graphql`) is bot-protected and
 * requires a CSRF token + cookie session.
 *
 * Strategy: drive an authenticated Chrome tab via shared/cdp.mjs (same Lily
 * Profile / port 9222 setup the apply skills use). 用户 logs in once; the
 * scraper reuses the session.
 *
 * Why no apply skill? Wellfound "Apply" buttons mostly redirect to the
 * company's primary ATS (Greenhouse / Lever / Ashby) OR open a Wellfound
 * recruiter-message thread that is fundamentally a human reply, not a
 * structured form. Auto-apply is not a win here — keep this sourcing-only
 * and let the batch orchestrator re-route by detected destination ATS.
 *
 * Implementation must wait until a real dogfood pass captures:
 *   1) The exact `wellfound.com/jobs?...` URL pattern for the filters we want
 *      (role_types / location / remote / keywords). The current SPA encodes
 *      filters as URL hash fragments — needs verification.
 *   2) The DOM structure of the job cards on the search results page. Likely
 *      a virtualized list under a `[data-test="JobSearchResults"]` container
 *      with `[data-test="StartupResult"]` cards (guessing from Wellfound's
 *      `data-test` convention — confirm in DevTools).
 *   3) Pagination — infinite scroll vs. `?page=N`. Confirm.
 *   4) Whether logged-out browsing returns enough data (location + title +
 *      company + url). Some fields are gated behind login.
 *   5) Whether Wellfound throttles automated scrolling. Their bot detection
 *      is moderate; expect to need 2s between scrolls.
 *
 * Return shape (when implemented) matches recruitee_board_api.fetchJobs():
 *   { company, title, url, apply_url, location, description, department,
 *     updated_at, employment_type, is_remote, compensation,
 *     _source: 'wellfound', _id: string }
 *
 * TODO (implementation steps when ready to dogfood):
 *   1. Use shared/cdp.mjs `goto` to navigate the authenticated Chrome tab to
 *      `https://wellfound.com/jobs?keywords=<kw>&remote=true&...`.
 *   2. Wait for the result list to render — poll for
 *      `[data-test="JobSearchResults"] [data-test="StartupResult"]` (TODO-verify) up to ~5s.
 *   3. Run an in-page extractor via `cdp.mjs eval` that returns
 *      `Array<{title, company, location, url, role_type, id}>` per card.
 *   4. Scroll to load more (Wellfound uses infinite scroll for results) —
 *      cap at `searchOpts.page_limit` scrolls (default 5).
 *   5. Optionally fetch full job descriptions by navigating to `/jobs/<id>`
 *      for the top-K results. Defer for v0.9.
 *   6. Normalize. Set `apply_url` to the Wellfound URL; orchestrator detects
 *      external-ATS redirects and re-dispatches.
 *   7. Throttle: 1 navigation per 3s. No daily cap, but stay polite.
 *
 * Until then, the public functions below throw a clear "not yet implemented"
 * error so callers fail fast rather than silently treat Wellfound as empty.
 */

const USER_AGENT = 'ats-skills/0.8 (+https://github.com/glin23/ats-skills)';
const NOT_IMPLEMENTED_MSG =
  'wellfound_search.mjs is a v0.8 stub — real implementation requires CDP-driven scraping of authenticated Wellfound UI. See file header TODO for implementation steps.';

/**
 * searchWellfoundJobs(searchOpts, opts)
 *
 * searchOpts: {
 *   keywords?: string,
 *   location?: string,           // e.g. "San Francisco" or "Remote"
 *   role_types?: string[],       // e.g. ['intern', 'new_grad_FT']
 *   remote_only?: boolean,
 *   page_limit?: number,         // max scroll-pages (default 5)
 * }
 *
 * opts: {
 *   tab_id?: string,             // existing CDP tab id
 *   cdp_port?: number,           // default 9222
 *   verbose?: boolean,
 * }
 *
 * Returns: Array<NormalizedJob> matching recruitee_board_api shape.
 *
 * v0.8: throws NOT_IMPLEMENTED. Caller should catch and log "wellfound
 * sourcing deferred" rather than crash the sourcing pipeline.
 */
export async function searchWellfoundJobs(searchOpts = {}, opts = {}) {
  void searchOpts;
  void opts;
  throw new Error(NOT_IMPLEMENTED_MSG);
}

/**
 * filterByRoleType(jobs, roleTypes) — pass-through shim mirroring the other
 * sourcing clients. Pre-implementation: returns input unchanged.
 */
export function filterByRoleType(jobs, roleTypes = ['intern', 'new_grad_FT']) {
  if (!Array.isArray(jobs)) return [];
  if (jobs.length === 0) return [];
  // TODO: when searchWellfoundJobs returns real data, port the Recruitee
  // filter logic (matchesIntern / matchesNewGradFT) here. Wellfound exposes
  // `role_type` on cards ("Full-Time" / "Internship" / "Contract") which we
  // can use directly alongside title regex.
  void roleTypes;
  return jobs;
}

// ---------- CLI smoke test ----------
// Usage: node shared/sourcing/wellfound_search.mjs "AI intern"
if (import.meta.url === `file://${process.argv[1]}`) {
  const kw = process.argv[2] || '';
  try {
    const jobs = await searchWellfoundJobs({ keywords: kw });
    console.log(JSON.stringify({ total: jobs.length, sample: jobs.slice(0, 3) }, null, 2));
  } catch (err) {
    console.error('[wellfound_search v0.8 stub] ' + err.message);
    console.error('User-Agent that real impl would use:', USER_AGENT);
    process.exit(2);
  }
}
