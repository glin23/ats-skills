// dispatcher.mjs — v2 multi-source discovery dispatcher.
//
// Fans out a single search intent to every registered source adapter in
// parallel, merges + dedupes the unified job shape, returns aggregate.
//
// Per v2 PRD §"System Architecture" Stage 2 (Discovery):
//   keyword intent → parallel sources → merge + dedupe → return
// The platform list is FIXED-BROAD; the intent does the filtering.
//
// Usage:
//   import { discoverAll, ALL_SOURCES } from './dispatcher.mjs';
//   const result = await discoverAll({
//     keywords: ['Product Manager Intern', 'APM Intern'],
//     intent,
//     sources: ['remoteok', 'greenhouse_bulk', 'ashby_bulk', 'lever_bulk', 'yc_waas'],
//     concurrency_per_source: 10,
//     limit_per_source: 500,
//     source_window_size: 1000,
//     source_window_offset: 0,
//     onProgress: (src, count) => console.error(`[${src}] ${count}`),
//   });
//   // result.jobs = merged + deduped unified jobs
//   // result.by_source = { remoteok: 12, greenhouse_bulk: 200, ... }
//   // result.errors = [{ source, error }, ...]

import { classifyRoleType } from '../role_types.mjs';

// Source adapter registry. Each adapter normalizes a different module's
// signature to a common `{ fetch(opts) → jobs[] }` shape so the dispatcher
// doesn't care about per-source quirks.
const ADAPTERS = {
  remoteok: {
    module: '../sourcing/remoteok_api.mjs',
    async fetch({ keywords, limit }) {
      const m = await import('./remoteok_api.mjs');
      // RemoteOK doesn't natively keyword-filter; pull a page, filter client-side.
      const jobs = await m.fetchRemoteOk({ limit: 500 });
      return _clientSideKeywordFilter(jobs, keywords).slice(0, limit);
    },
  },

  greenhouse_bulk: {
    module: '../sourcing/greenhouse_bulk_crawl.mjs',
    async fetch({ keywords, concurrency, limit, sourceWindowSize, sourceWindowOffset }) {
      const m = await import('./greenhouse_bulk_crawl.mjs');
      const { jobs } = await m.bulkFetchGreenhouse({
        keywords,
        concurrency,
        limit,
        maxCompanies: sourceWindowSize,
        companyOffset: sourceWindowOffset,
      });
      return jobs;
    },
  },

  ashby_bulk: {
    module: '../sourcing/ashby_bulk_crawl.mjs',
    async fetch({ keywords, concurrency, limit, sourceWindowSize, sourceWindowOffset }) {
      const m = await import('./ashby_bulk_crawl.mjs');
      const { jobs } = await m.bulkFetchAshby({
        keywords,
        concurrency,
        limit,
        tenantLimit: sourceWindowSize,
        tenantOffset: sourceWindowOffset,
      });
      return jobs;
    },
  },

  lever_bulk: {
    module: '../sourcing/lever_bulk_crawl.mjs',
    async fetch({ keywords, concurrency, limit, sourceWindowSize, sourceWindowOffset }) {
      const m = await import('./lever_bulk_crawl.mjs');
      const { jobs } = await m.bulkFetchLever({
        keywords,
        concurrency,
        limit,
        maxTenants: sourceWindowSize,
        tenantOffset: sourceWindowOffset,
      });
      return jobs;
    },
  },

  wellfound: {
    module: '../sourcing/wellfound_search.mjs',
    async fetch({ keywords, limit }) {
      const m = await import('./wellfound_search.mjs');
      // Wellfound is currently a gated stub (DataDome). Returns [] but
      // populates lastFetchStatus() with the deferred reason. The dispatcher
      // treats this as a soft failure (no error, just zero jobs).
      const jobs = await m.fetchWellfoundJobs({ keywords, limit });
      return jobs;
    },
  },

  yc_waas: {
    module: '../sourcing/yc_workatastartup.mjs',
    async fetch({ keywords, limit }) {
      const m = await import('./yc_workatastartup.mjs');
      const jobs = await m.fetchYcJobs({ keywords, limit });
      return jobs;
    },
  },
};

export const ALL_SOURCES = Object.keys(ADAPTERS);

// Default source order — best coverage / fewest gates first.
export const DEFAULT_SOURCES = [
  'greenhouse_bulk', // largest coverage, public API
  'ashby_bulk',      // mid coverage, public API
  'lever_bulk',      // smaller but solid, public API
  'yc_waas',         // YC startups via public Algolia
  'remoteok',        // remote-only aggregator
  // 'wellfound',    // gated; opt-in via explicit sources arg until CDP impl ships
];

/**
 * discoverAll({ keywords, intent, sources, concurrency_per_source, limit_per_source, onProgress })
 *
 * Run every requested source in parallel. Merge unified jobs. Dedupe by apply_url.
 *
 * Returns:
 *   {
 *     jobs:      [unified jobs, deduped by apply_url],
 *     by_source: { [source_name]: count },
 *     errors:    [{ source, error }],
 *     duration_ms,
 *   }
 */
export async function discoverAll({
  keywords = [],
  intent = null,
  sources = DEFAULT_SOURCES,
  concurrency_per_source = 10,
  limit_per_source = 500,
  source_window_size = null,
  source_window_offset = 0,
  onProgress = null,
} = {}) {
  const t0 = Date.now();

  const unknown = sources.filter((s) => !ADAPTERS[s]);
  if (unknown.length) {
    throw new Error(`Unknown sources: ${unknown.join(', ')}. Available: ${ALL_SOURCES.join(', ')}`);
  }

  const results = await Promise.all(
    sources.map(async (sourceName) => {
      const adapter = ADAPTERS[sourceName];
      try {
        const jobs = await adapter.fetch({
          keywords,
          intent,
          concurrency: concurrency_per_source,
          limit: limit_per_source,
          sourceWindowSize: source_window_size,
          sourceWindowOffset: source_window_offset,
        });
        if (onProgress) onProgress(sourceName, jobs.length);
        return { source: sourceName, ok: true, jobs: jobs || [] };
      } catch (err) {
        if (onProgress) onProgress(sourceName, 0);
        return { source: sourceName, ok: false, jobs: [], error: err.message || String(err) };
      }
    })
  );

  // Merge + dedupe by apply_url (fallback: url field)
  const seen = new Set();
  const merged = [];
  for (const r of results) {
    for (const j of r.jobs || []) {
      const key = ((j.apply_url || j.url || '') + '').toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      // Attach source + shared role type for downstream hard-filter/scoring.
      merged.push({ ...j, role_type: j.role_type || classifyRoleType(j), _discovery_source: r.source });
    }
  }

  const by_source = Object.fromEntries(results.map((r) => [r.source, (r.jobs || []).length]));
  const errors = results.filter((r) => !r.ok).map((r) => ({ source: r.source, error: r.error }));

  return {
    jobs: merged,
    by_source,
    errors,
    duration_ms: Date.now() - t0,
  };
}

// Client-side title-match filter — used for sources that don't natively
// keyword-filter (RemoteOK). Whole-word, case-insensitive, any-of.
function _clientSideKeywordFilter(jobs, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return jobs;
  const patterns = keywords.map((kw) => {
    const escaped = String(kw).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b' + escaped + '\\b', 'i');
  });
  return jobs.filter((j) => {
    const t = (j.title || '') + ' ' + (j.description || '').slice(0, 500);
    return patterns.some((re) => re.test(t));
  });
}

// CLI entry: smoke-test the dispatcher across all sources.
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  let keywords = ['Product Manager Intern'];
  let sources = DEFAULT_SOURCES;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--keywords') keywords = argv[++i].split(',').map((s) => s.trim());
    else if (argv[i] === '--sources') sources = argv[++i].split(',').map((s) => s.trim());
  }

  process.stderr.write(`[dispatcher] sources=[${sources.join(', ')}] keywords=[${keywords.join(', ')}]\n`);
  const result = await discoverAll({
    keywords,
    sources,
    onProgress: (src, count) => process.stderr.write(`  [${src}] ${count} jobs\n`),
  });
  process.stderr.write(`[dispatcher] total=${result.jobs.length} unique  duration=${result.duration_ms}ms  errors=${result.errors.length}\n`);
  for (const e of result.errors) process.stderr.write(`  ERROR [${e.source}]: ${e.error}\n`);
  process.stdout.write(JSON.stringify({ count: result.jobs.length, by_source: result.by_source, errors: result.errors }, null, 2) + '\n');
}
