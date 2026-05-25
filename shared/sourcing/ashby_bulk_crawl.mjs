/**
 * ashby_bulk_crawl.mjs — Bulk discovery across all known Ashby tenants
 *
 * Wraps `ashby_board_api.fetchJobs` to query the union of community-curated
 * Ashby tenant slugs (~2867 as of 2026-05-25), with bounded concurrency, a
 * 1 req/sec floor, optional client-side title keyword filter, and a hard
 * `limit` cap on total returned jobs. Output is the same normalized shape
 * produced by `ashby_board_api.mjs` — no new shape invented.
 *
 * Tenant list lives in `shared/sourcing/data/ashby_tenants.json` and was
 * stitched from these public sources (see file's _meta for full list):
 *   - kalil0321/ats-scrapers (primary, 2856 verified slugs)
 *   - crypto-jobs-fyi/crawler, dilip-bing/job_marathon, vidip-vb/GradNow,
 *     vanshb03/New-Grad-2027, coreymichaud/first-responder, ...
 *
 * The list is checked in (~46 KB) so users don't need network to re-derive
 * it. To refresh from upstream, re-run the GH search recipe documented in
 * the tenants JSON's `_meta.regen`.
 *
 * ---------- Usage ----------
 *
 * From Node (import):
 *
 *   import { bulkFetchAshby } from './ashby_bulk_crawl.mjs';
 *
 *   const { jobs, errors, tenants_attempted, tenants_with_jobs } =
 *     await bulkFetchAshby({
 *       keywords: ['Product Manager Intern', 'APM Intern', 'Operations Intern'],
 *       concurrency: 10,        // default
 *       limit: 5000,            // hard cap on returned jobs, default 5000
 *       onProgress: (n, total) => process.stderr.write(`\r${n}/${total}`),
 *     });
 *
 * From CLI (smoke test):
 *
 *   node shared/sourcing/ashby_bulk_crawl.mjs \
 *     --keywords "Product Manager Intern,APM,Operations Intern" \
 *     --concurrency 10 \
 *     --tenant-limit 100      # only crawl first N tenants (debugging)
 *
 *   # Summary → stderr, JSON jobs array → stdout (pipe to jq / file).
 *
 * ---------- Failure mode ----------
 *
 * Per-tenant failure (404, timeout, network) → pushed to `errors[]`, crawl
 * continues. A 404 is treated as "tenant no longer hosted on Ashby" and is
 * logged but not counted as error (tenant churn is normal).
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchJobs } from './ashby_board_api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TENANTS_PATH = join(__dirname, 'data', 'ashby_tenants.json');

let _cachedTenants = null;

/**
 * loadTenants() — read & cache the bundled tenant slug list.
 * Returns: { tenants: string[], meta: object }
 */
export async function loadTenants() {
  if (_cachedTenants) return _cachedTenants;
  const raw = await readFile(TENANTS_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  _cachedTenants = {
    tenants: Array.isArray(parsed.tenants) ? parsed.tenants : [],
    meta: parsed._meta || {},
  };
  return _cachedTenants;
}

/**
 * Build a case-insensitive word-boundary regex per keyword. Spaces in the
 * keyword become `\s+` so "Product Manager Intern" still matches "Product
 *  Manager  Intern". Special regex chars are escaped.
 */
function compileKeywordMatchers(keywords) {
  return keywords
    .map((kw) => String(kw).trim())
    .filter(Boolean)
    .map((kw) => {
      const escaped = kw
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\s+/g, '\\s+');
      return new RegExp(`\\b${escaped}\\b`, 'i');
    });
}

/**
 * Title-only keyword filter. Any match → include.
 */
function jobMatchesKeywords(job, matchers) {
  if (matchers.length === 0) return true;
  const title = job.title || '';
  return matchers.some((re) => re.test(title));
}

/**
 * Concurrency-bounded worker pool. Resolves when all tasks finish.
 */
async function runPool(items, concurrency, worker) {
  const queue = items.slice();
  const workers = [];
  let nextIdx = 0;
  const total = queue.length;
  for (let i = 0; i < Math.min(concurrency, total); i++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = nextIdx++;
          if (idx >= total) return;
          await worker(queue[idx], idx, total);
        }
      })(),
    );
  }
  await Promise.all(workers);
}

/**
 * bulkFetchAshby — main export.
 *
 * @param {object} opts
 * @param {string[]} [opts.keywords]    Title keywords (case-insensitive word match).
 *                                       Empty / omitted → no title filter (return all).
 * @param {number}   [opts.concurrency] Max in-flight requests (default 10).
 * @param {number}   [opts.limit]       Hard cap on returned jobs (default 5000).
 * @param {string[]} [opts.tenants]     Override tenant list (test/debug).
 * @param {number}   [opts.tenantLimit] Only crawl first N tenants (debug).
 * @param {(done:number,total:number,tenant:string)=>void} [opts.onProgress]
 *
 * @returns {Promise<{
 *   jobs: object[],
 *   errors: {tenant:string, message:string}[],
 *   tenants_attempted: number,
 *   tenants_with_jobs: number,
 * }>}
 */
export async function bulkFetchAshby({
  keywords = [],
  concurrency = 10,
  limit = 5000,
  tenants: tenantsOverride,
  tenantLimit,
  onProgress,
} = {}) {
  const tenants = tenantsOverride
    ? tenantsOverride.slice()
    : (await loadTenants()).tenants.slice();
  const slice = tenantLimit ? tenants.slice(0, tenantLimit) : tenants;

  const matchers = compileKeywordMatchers(keywords);
  const jobs = [];
  const errors = [];
  let tenantsWithJobs = 0;
  let done = 0;
  let stopRequested = false;

  await runPool(slice, Math.max(1, concurrency), async (tenant) => {
    if (stopRequested) {
      done++;
      return;
    }
    try {
      const raw = await fetchJobs(tenant);
      const matched = raw.filter((j) => jobMatchesKeywords(j, matchers));
      if (matched.length > 0) {
        tenantsWithJobs++;
        // Push under limit; remainder dropped silently once cap reached.
        for (const j of matched) {
          if (jobs.length >= limit) {
            stopRequested = true;
            break;
          }
          jobs.push(j);
        }
      }
    } catch (err) {
      errors.push({ tenant, message: err?.message || String(err) });
    }
    done++;
    if (onProgress) {
      try {
        onProgress(done, slice.length, tenant);
      } catch {
        /* ignore */
      }
    }
  });

  return {
    jobs,
    errors,
    tenants_attempted: slice.length,
    tenants_with_jobs: tenantsWithJobs,
  };
}

// ---------- CLI smoke test ----------
//
//   node shared/sourcing/ashby_bulk_crawl.mjs \
//     --keywords "Product Manager Intern,APM,Operations Intern" \
//     --concurrency 10 \
//     --tenant-limit 100
//
// Prints a summary line to stderr and the full job array as JSON to stdout.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  function flag(name, dflt) {
    const i = args.findIndex((a) => a === `--${name}`);
    if (i === -1) return dflt;
    return args[i + 1];
  }
  const keywords = (flag('keywords', '') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const concurrency = parseInt(flag('concurrency', '10'), 10);
  const tenantLimit = flag('tenant-limit') ? parseInt(flag('tenant-limit'), 10) : undefined;
  const limit = parseInt(flag('limit', '5000'), 10);

  const t0 = Date.now();
  let lastProgress = 0;
  const result = await bulkFetchAshby({
    keywords,
    concurrency,
    limit,
    tenantLimit,
    onProgress: (d, total, _tenant) => {
      const now = Date.now();
      if (now - lastProgress > 1000 || d === total) {
        lastProgress = now;
        process.stderr.write(`\r[ashby_bulk] ${d}/${total} tenants  jobs=${result?.jobs?.length ?? '?'}`);
      }
    },
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  process.stderr.write('\n');
  console.error(
    JSON.stringify(
      {
        elapsed_seconds: Number(elapsed),
        tenants_attempted: result.tenants_attempted,
        tenants_with_jobs: result.tenants_with_jobs,
        jobs_matched: result.jobs.length,
        errors: result.errors.length,
        keywords,
        sample: result.jobs.slice(0, 5).map((j) => ({
          company: j.company,
          title: j.title,
          location: j.location,
          employment_type: j.employment_type,
        })),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(result.jobs, null, 2));
}
