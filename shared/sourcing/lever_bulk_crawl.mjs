/**
 * lever_bulk_crawl.mjs — bulk crawl ALL known Lever tenants (zero npm dep, Node 24 ESM)
 *
 * Purpose
 *   The v2 discovery layer wants to scale Lever coverage from a hand-curated
 *   ~5-tenant whitelist to "every public Lever board we've ever heard of." This
 *   module loads `./data/lever_tenants.json` (the cached slug list) and fans
 *   out parallel fetches against `https://api.lever.co/v0/postings/<tenant>?mode=json`,
 *   then optionally filters by keyword substrings against the normalized job
 *   title so the caller can do a cheap pre-filter before passing to the AI scorer.
 *
 * Tenant list provenance
 *   `data/lever_tenants.json` is merged from several public sources — see
 *   the `source` array in that file. Refresh policy: regenerate manually when
 *   discovery yield plateaus; nothing in this module mutates the file at runtime.
 *
 * Output shape
 *   Every job is normalized via `_normalizeJob` from `lever_board_api.mjs` —
 *   we re-export that contract by calling `fetchJobs(slug)` directly. Do NOT
 *   invent new fields here; downstream code (AI scorer, Notion sync) assumes
 *   the unified shape.
 *
 *   bulkFetchLever() resolves to:
 *     {
 *       jobs:                Array<NormalizedJob>,   // optionally keyword-filtered
 *       errors:              Array<{tenant, error}>, // 404/timeout/etc., non-fatal
 *       tenants_attempted:   number,
 *       tenants_with_jobs:   number,
 *     }
 *
 * Throttling
 *   `fetchJobs` already enforces a 1 req/sec global gate inside lever_board_api.mjs,
 *   so even with concurrency=10 the actual wire-rate stays polite (~1 req/sec).
 *   The `concurrency` knob just bounds in-flight promises so we don't queue
 *   3000 unresolved fetches in memory.
 *
 * Failure mode
 *   Per-tenant errors (404, timeout, JSON parse, network) are caught and pushed
 *   into `errors[]`. The crawl continues. A single bad tenant never aborts the run.
 *
 * CLI
 *   node shared/sourcing/lever_bulk_crawl.mjs \
 *     --keywords "Software Engineering Intern,Accounting Intern" \
 *     [--limit 5000] [--concurrency 10] [--max-tenants 100]
 *
 *   - stderr: progress + summary
 *   - stdout: JSON { jobs, errors, tenants_attempted, tenants_with_jobs }
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { fetchJobs } from './lever_board_api.mjs';
import { sourceWindow } from './source_window.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_TENANTS_FILE = resolve(__dirname, 'data/lever_tenants.json');

/**
 * Load the cached tenant list. Returns Array<string>.
 * Throws if the file is missing or malformed — this is a build-time artifact,
 * not user input, so loud failure is correct.
 */
export async function loadTenants(path = DEFAULT_TENANTS_FILE) {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.tenants)) {
    throw new Error(`loadTenants: ${path} has no .tenants array`);
  }
  return parsed.tenants.filter((s) => typeof s === 'string' && s.length > 0);
}

/**
 * Normalize a keyword list into lowercased non-empty substrings.
 * Accepts string ("a,b,c") or string[].
 */
function _normalizeKeywords(keywords) {
  let arr;
  if (Array.isArray(keywords)) arr = keywords;
  else if (typeof keywords === 'string') arr = keywords.split(',');
  else arr = [];
  return arr.map((k) => String(k).trim().toLowerCase()).filter(Boolean);
}

/**
 * Match a normalized job against a keyword list. A job matches if ANY keyword
 * is a substring of `title` (case-insensitive). Empty keyword list = match all.
 */
function _matchesKeywords(job, keywordsLower) {
  if (!keywordsLower.length) return true;
  const title = String(job.title || '').toLowerCase();
  for (const kw of keywordsLower) {
    if (title.includes(kw)) return true;
  }
  return false;
}

/**
 * Run `worker(item)` over `items` with bounded concurrency. Each worker
 * resolves to `{ ok, value, error, item }` — we never reject so a single
 * failure can't trip Promise.all.
 */
async function _pmap(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function pump() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        const value = await worker(items[i], i);
        results[i] = { ok: true, value, item: items[i] };
      } catch (err) {
        results[i] = { ok: false, error: err, item: items[i] };
      }
    }
  }
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, pump);
  await Promise.all(lanes);
  return results;
}

/**
 * bulkFetchLever — crawl every known Lever tenant, normalize, optionally keyword-filter.
 *
 * @param {object} [opts]
 * @param {string[]|string} [opts.keywords=[]]  Title substring filter (OR).
 * @param {number}   [opts.concurrency=10]      Max in-flight tenant fetches.
 * @param {number}   [opts.limit=5000]          Soft cap on returned jobs.
 * @param {string[]} [opts.tenants]             Override the cached tenant list.
 * @param {number}   [opts.maxTenants]          Crawl a window of N tenants.
 * @param {number}   [opts.tenantOffset=0]      Offset into tenant list when maxTenants is set.
 * @param {(p: {done, total, tenant, jobs, error}) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.abort]
 * @returns {Promise<{ jobs, errors, tenants_attempted, tenants_with_jobs }>}
 */
export async function bulkFetchLever(opts = {}) {
  const {
    keywords = [],
    concurrency = 10,
    limit = 5000,
    tenants,
    maxTenants,
    tenantOffset = 0,
    onProgress,
    abort,
  } = opts;

  const tenantList = tenants ?? (await loadTenants());
  const work = sourceWindow(tenantList, { limit: maxTenants, offset: tenantOffset });
  const keywordsLower = _normalizeKeywords(keywords);

  const errors = [];
  const jobs = [];
  let tenantsWithJobs = 0;
  let done = 0;

  await _pmap(work, concurrency, async (tenant) => {
    if (abort?.aborted) throw new Error('aborted');
    let tenantJobs = [];
    try {
      tenantJobs = await fetchJobs(tenant, { abort });
    } catch (err) {
      errors.push({ tenant, error: err.message || String(err) });
      done += 1;
      onProgress?.({ done, total: work.length, tenant, jobs: 0, error: err.message });
      return;
    }

    let kept = 0;
    if (jobs.length < limit) {
      for (const j of tenantJobs) {
        if (!_matchesKeywords(j, keywordsLower)) continue;
        jobs.push(j);
        kept += 1;
        if (jobs.length >= limit) break;
      }
    }
    if (tenantJobs.length > 0) tenantsWithJobs += 1;
    done += 1;
    onProgress?.({ done, total: work.length, tenant, jobs: kept });
  });

  return {
    jobs,
    errors,
    tenants_attempted: work.length,
    tenants_with_jobs: tenantsWithJobs,
  };
}

// ---------- CLI smoke test ----------
// Usage:
//   node shared/sourcing/lever_bulk_crawl.mjs --keywords "Software Engineering Intern,Accounting Intern"
//   node shared/sourcing/lever_bulk_crawl.mjs --keywords "..." --max-tenants 100

function _parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = _parseArgs(process.argv.slice(2));
  const keywords = args.keywords ? String(args.keywords).split(',') : [];
  const concurrency = args.concurrency ? Number(args.concurrency) : 10;
  const limit = args.limit ? Number(args.limit) : 5000;
  const maxTenants = args['max-tenants'] ? Number(args['max-tenants']) : undefined;
  const tenantOffset = args['tenant-offset'] ? Number(args['tenant-offset']) : 0;

  const t0 = Date.now();
  const result = await bulkFetchLever({
    keywords,
    concurrency,
    limit,
    maxTenants,
    tenantOffset,
    onProgress: ({ done, total, tenant, jobs, error }) => {
      if (done % 10 === 0 || error || jobs > 0) {
        const msg = error
          ? `[${done}/${total}] ${tenant} ERR ${error}`
          : `[${done}/${total}] ${tenant} +${jobs}`;
        process.stderr.write(msg + '\n');
      }
    },
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  process.stderr.write(
    `\nSummary: ${result.jobs.length} matched jobs from ${result.tenants_with_jobs}/${result.tenants_attempted} live tenants ` +
      `(${result.errors.length} errors) in ${elapsed}s\n`,
  );
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
