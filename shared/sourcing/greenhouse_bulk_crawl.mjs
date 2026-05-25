/**
 * greenhouse_bulk_crawl.mjs — Bulk Greenhouse Job Board crawler across all
 * known public board slugs.
 *
 * v2 discovery layer (see PRD §"Roadmap" v2.3). Unlike the v1 path which
 * queries `examples/lee_company_list.json` (~145 curated Greenhouse slugs),
 * this module reads `shared/sourcing/data/greenhouse_companies.json` —
 * a community-maintained list of ~8,200 known Greenhouse boards — and
 * fans out parallel fetches with a bounded concurrency pool.
 *
 * Zero deps. Pure Node 24 stdlib. Reuses `fetchJobs()` from the sibling
 * `greenhouse_board_api.mjs` so the 1 req/s polite-throttle gate, retry
 * policy, and normalized job shape are inherited unchanged.
 *
 * ── Usage (programmatic) ──────────────────────────────────────────────
 *   import { bulkFetchGreenhouse } from './greenhouse_bulk_crawl.mjs';
 *   const { jobs, errors, companies_attempted, companies_with_jobs } =
 *     await bulkFetchGreenhouse({
 *       keywords: ['Product Manager Intern', 'APM Intern', 'Operations Intern'],
 *       concurrency: 10,
 *       limit: 5000,
 *       onProgress: ({ done, total, found }) =>
 *         console.error(`[gh-bulk] ${done}/${total} (${found} jobs)`),
 *     });
 *
 * ── Usage (CLI smoke test) ────────────────────────────────────────────
 *   node shared/sourcing/greenhouse_bulk_crawl.mjs \
 *     --keywords "Product Manager Intern,APM Intern,Operations Intern" \
 *     --max-companies 200 \
 *     --concurrency 10
 *
 *   stderr: progress + summary
 *   stdout: JSON { jobs, errors, companies_attempted, companies_with_jobs }
 *
 * ── Regenerating the company slug list ───────────────────────────────
 *   The checked-in list at `shared/sourcing/data/greenhouse_companies.json`
 *   was built from `github.com/Feashliaa/job-board-aggregator` (their
 *   `data/greenhouse_companies.json`, scraped from Greenhouse via Common
 *   Crawl), merged with curated slugs from `examples/lee_company_list.json`.
 *   To refresh:
 *     curl -sL https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data/greenhouse_companies.json
 *     and merge with current curated list (preserve any slugs not in upstream).
 *   Coverage is necessarily incomplete — Greenhouse does not publish an
 *   official directory. Expect a ~30-60% hit-rate on stale/private/empty
 *   slugs; bulkFetchGreenhouse() returns those in `errors`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchJobs } from './greenhouse_board_api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANIES_FILE = path.join(__dirname, 'data', 'greenhouse_companies.json');

/**
 * loadCompanyList() — read + parse the bundled slug list.
 * Returns Array<string> of Greenhouse board slugs.
 */
export async function loadCompanyList() {
  const raw = await fs.readFile(COMPANIES_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed; // legacy flat-array shape
  if (Array.isArray(parsed.slugs)) return parsed.slugs;
  throw new Error(`Unexpected company list shape in ${COMPANIES_FILE}`);
}

/**
 * _matchesKeywords(title, patterns) — title contains any keyword phrase,
 * matched case-insensitive with word boundaries on both ends.
 *
 * Word-boundary trick mirrors greenhouse_board_api.filterByExcludeKeywords —
 * avoids "Internal" matching "Intern" etc.
 */
function _matchesKeywords(title, patterns) {
  if (!patterns.length) return true;
  const t = title || '';
  return patterns.some((re) => re.test(t));
}

function _buildKeywordPatterns(keywords) {
  return (keywords || [])
    .map((kw) => String(kw).trim())
    .filter(Boolean)
    .map((kw) => {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'i');
    });
}

/**
 * Concurrency-bounded async pool. Generic; no third-party dep.
 *
 * `worker(item, index)` may resolve or reject; rejections are captured
 * via `onError(err, item)` rather than rejecting the whole pool, so one
 * bad slug doesn't kill the run.
 */
async function _pool(items, concurrency, worker, onError) {
  const n = items.length;
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, n) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= n) return;
      try {
        await worker(items[i], i);
      } catch (err) {
        if (onError) onError(err, items[i]);
      }
    }
  });
  await Promise.all(runners);
}

/**
 * bulkFetchGreenhouse(opts) — fan out fetchJobs() across all known
 * Greenhouse board slugs, optionally filter by title keyword, and
 * return a flat normalized job array.
 *
 * opts:
 *   - keywords:    Array<string> — keep job iff title \bcontains\b any
 *                  (case-insensitive). Empty/missing = no filter.
 *   - concurrency: number = 10  — parallel in-flight fetches. The shared
 *                  1 req/s gate inside greenhouse_board_api.mjs still
 *                  enforces global polite throughput; concurrency just
 *                  controls how many requests queue at the gate.
 *   - limit:       number = 5000 — stop adding jobs once this many
 *                  matched. Companies still attempted = unbounded.
 *   - slugs:       Array<string> = (bundled list) — override the slug
 *                  source (useful for testing / subset crawls).
 *   - maxCompanies:number = (all) — only attempt the first N slugs.
 *                  Useful for smoke tests.
 *   - onProgress:  ({ done, total, found, errors }) => void
 *                  Called after each company finishes (success or fail).
 *   - timeout:     number = 12000 — per-request timeout (ms), forwarded
 *                  to fetchJobs.
 *
 * returns: { jobs, errors, companies_attempted, companies_with_jobs }
 *   - jobs:                 Array<NormalizedJob> (same shape as
 *                           greenhouse_board_api.fetchJobs returns)
 *   - errors:               Array<{ slug, message }>
 *   - companies_attempted:  number of slugs requested
 *   - companies_with_jobs:  number of slugs that returned ≥1 job
 *                           (post-keyword-filter)
 */
export async function bulkFetchGreenhouse({
  keywords = [],
  concurrency = 10,
  limit = 5000,
  slugs = null,
  maxCompanies = null,
  onProgress = null,
  timeout = 12000,
} = {}) {
  const allSlugs = slugs || (await loadCompanyList());
  const targets = maxCompanies ? allSlugs.slice(0, maxCompanies) : allSlugs;
  const patterns = _buildKeywordPatterns(keywords);

  const jobs = [];
  const errors = [];
  let done = 0;
  let companies_with_jobs = 0;
  let limitReached = false;

  await _pool(
    targets,
    concurrency,
    async (slug) => {
      if (limitReached) {
        done++;
        return;
      }
      let companyJobs;
      try {
        companyJobs = await fetchJobs(slug, { timeout });
      } catch (err) {
        errors.push({ slug, message: err.message });
        done++;
        if (onProgress) onProgress({ done, total: targets.length, found: jobs.length, errors: errors.length });
        return;
      }
      // Apply keyword filter (post-fetch, client-side).
      const matched = patterns.length
        ? companyJobs.filter((j) => _matchesKeywords(j.title, patterns))
        : companyJobs;
      if (matched.length) {
        companies_with_jobs++;
        for (const j of matched) {
          if (jobs.length >= limit) {
            limitReached = true;
            break;
          }
          jobs.push(j);
        }
      }
      done++;
      if (onProgress) onProgress({ done, total: targets.length, found: jobs.length, errors: errors.length });
    },
    (err, slug) => {
      // Caught by inner try, but defensive: if _pool catches anything,
      // funnel into errors[] so the run never fatals.
      errors.push({ slug, message: err?.message || String(err) });
    },
  );

  return {
    jobs,
    errors,
    companies_attempted: targets.length,
    companies_with_jobs,
  };
}

// ─── CLI smoke test ──────────────────────────────────────────────────
// node greenhouse_bulk_crawl.mjs --keywords "..." --max-companies 200 --concurrency 10
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const argMap = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      argMap[key] = val;
    }
  }
  const keywords = (argMap.keywords || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const concurrency = parseInt(argMap.concurrency || '10', 10);
  const maxCompanies = argMap['max-companies'] ? parseInt(argMap['max-companies'], 10) : null;
  const limit = argMap.limit ? parseInt(argMap.limit, 10) : 5000;

  console.error('[gh-bulk] starting bulk crawl');
  console.error(`[gh-bulk] keywords: ${keywords.length ? keywords.join(' | ') : '(none — pulling all jobs)'}`);
  console.error(`[gh-bulk] concurrency: ${concurrency}  maxCompanies: ${maxCompanies ?? 'all'}  limit: ${limit}`);

  const t0 = Date.now();
  let lastLogAt = 0;
  const result = await bulkFetchGreenhouse({
    keywords,
    concurrency,
    limit,
    maxCompanies,
    onProgress: ({ done, total, found, errors }) => {
      const now = Date.now();
      // Log every 2s or at end.
      if (now - lastLogAt > 2000 || done === total) {
        lastLogAt = now;
        console.error(`[gh-bulk] ${done}/${total} companies  matched=${found}  errors=${errors}`);
      }
    },
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.error('---');
  console.error(`[gh-bulk] done in ${secs}s`);
  console.error(`[gh-bulk] companies_attempted:  ${result.companies_attempted}`);
  console.error(`[gh-bulk] companies_with_jobs:  ${result.companies_with_jobs}`);
  console.error(`[gh-bulk] jobs matched:         ${result.jobs.length}`);
  console.error(`[gh-bulk] errors:               ${result.errors.length}`);
  if (result.errors.length) {
    const sample = result.errors.slice(0, 3).map((e) => `${e.slug}: ${e.message}`);
    console.error(`[gh-bulk] sample errors: ${sample.join(' | ')}`);
  }

  // stdout: JSON for downstream piping
  process.stdout.write(JSON.stringify(result));
}
