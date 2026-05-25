#!/usr/bin/env node
// coverage_matrix_check.mjs — v2.0 launch gate.
//
// Per PRD §"Discovery sources & coverage matrix": v2.0 will not be tagged
// unless each of 7 major-bucket fixture intents surfaces ≥ threshold jobs
// after dispatcher → hard-filter → score (fit_score ≥ 7).
//
// This harness handles the dispatcher + hard-filter halves automatically;
// the score step is offloaded to the main Claude session (the score model
// is conversational, not a fetch API). The harness writes a candidates
// file per bucket and emits a comma-separated summary so a wrapping
// orchestrator (or human) can hand each candidate set to main Claude for
// scoring, then re-run with --score-mode=verify to grade pass/fail.
//
// Usage:
//   # 1. Discover + hard-filter only (per-bucket)
//   node scripts/coverage_matrix_check.mjs --bucket business
//   node scripts/coverage_matrix_check.mjs --bucket all
//
//   # 2. After main Claude has scored every bucket's candidates and
//   #    written /tmp/coverage_<bucket>_scores.json, verify pass/fail:
//   node scripts/coverage_matrix_check.mjs --score-mode=verify
//
// Output: /tmp/coverage_<bucket>_candidates.json (post-hard-filter)
//         /tmp/coverage_matrix_report.json (summary)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// PRD §"Discovery sources & coverage matrix" thresholds.
const BUCKETS = {
  business: {
    threshold: 15,
    fixture: 'examples/coverage_fixtures/business_intent.json',
    sources: ['greenhouse_bulk', 'ashby_bulk', 'lever_bulk', 'yc_waas', 'remoteok'],
  },
  tech: {
    threshold: 20,
    fixture: 'examples/coverage_fixtures/tech_intent.json',
    sources: ['greenhouse_bulk', 'ashby_bulk', 'lever_bulk', 'yc_waas', 'remoteok'],
  },
  healthcare: {
    threshold: 8,
    fixture: 'examples/coverage_fixtures/healthcare_intent.json',
    sources: ['greenhouse_bulk', 'ashby_bulk', 'yc_waas'],
  },
  arts: {
    threshold: 10,
    fixture: 'examples/coverage_fixtures/arts_intent.json',
    sources: ['greenhouse_bulk', 'ashby_bulk', 'remoteok', 'yc_waas'],
  },
  mech: {
    threshold: 8,
    fixture: 'examples/coverage_fixtures/mech_intent.json',
    sources: ['greenhouse_bulk', 'lever_bulk', 'yc_waas'],
  },
  liberalarts: {
    threshold: 8,
    fixture: 'examples/coverage_fixtures/liberalarts_intent.json',
    sources: ['greenhouse_bulk', 'ashby_bulk', 'yc_waas'],
  },
  sciences: {
    threshold: 8,
    fixture: 'examples/coverage_fixtures/sciences_intent.json',
    sources: ['greenhouse_bulk', 'ashby_bulk', 'yc_waas'],
  },
};

// CLI
const argv = process.argv.slice(2);
const arg = (k, def) => {
  const i = argv.findIndex((a) => a === `--${k}` || a.startsWith(`--${k}=`));
  if (i < 0) return def;
  const v = argv[i].includes('=') ? argv[i].split('=')[1] : argv[i + 1];
  return v ?? def;
};
const bucket = arg('bucket', 'all');
const scoreMode = arg('score-mode', 'discover');
const tenantLimit = parseInt(arg('tenant-limit', '2000'), 10);
const limit = parseInt(arg('limit', '2000'), 10);

if (scoreMode === 'verify') {
  await verifyMode();
  process.exit(0);
}

const targets = bucket === 'all' ? Object.keys(BUCKETS) : [bucket];
for (const b of targets) {
  if (!BUCKETS[b]) {
    console.error(`Unknown bucket "${b}". Available: ${Object.keys(BUCKETS).join(', ')}`);
    process.exit(2);
  }
  await runBucket(b);
}

async function runBucket(b) {
  const cfg = BUCKETS[b];
  const intentPath = path.join(REPO_ROOT, cfg.fixture);
  const intent = JSON.parse(await fs.readFile(intentPath, 'utf8'));
  const keywords = (intent.search_intent.role_categories || [])
    .map((r) => r.title_pattern)
    .filter(Boolean);

  console.error(`\n=== bucket=${b}  threshold=${cfg.threshold}  keywords=${keywords.length}  sources=${cfg.sources.join('+')} ===`);

  const { bulkFetchGreenhouse } = await import(path.join(REPO_ROOT, 'shared/sourcing/greenhouse_bulk_crawl.mjs'));
  const { bulkFetchAshby } = await import(path.join(REPO_ROOT, 'shared/sourcing/ashby_bulk_crawl.mjs'));
  const { bulkFetchLever } = await import(path.join(REPO_ROOT, 'shared/sourcing/lever_bulk_crawl.mjs'));
  const { discoverAll } = await import(path.join(REPO_ROOT, 'shared/sourcing/dispatcher.mjs'));

  const t0 = Date.now();
  const tasks = [];
  if (cfg.sources.includes('greenhouse_bulk')) {
    tasks.push(bulkFetchGreenhouse({ keywords, concurrency: 15, limit, maxCompanies: tenantLimit, onProgress: ({ done, total, found }) => done % 500 === 0 && process.stderr.write(`  [gh] ${done}/${total} (${found})\n`) }).then((r) => r.jobs).catch((e) => { console.error(`  [gh] ERROR ${e.message}`); return []; }));
  }
  if (cfg.sources.includes('ashby_bulk')) {
    tasks.push(bulkFetchAshby({ keywords, concurrency: 15, limit, tenantLimit, onProgress: ({ done, total, found }) => done % 500 === 0 && process.stderr.write(`  [ashby] ${done}/${total} (${found})\n`) }).then((r) => r.jobs).catch((e) => { console.error(`  [ashby] ERROR ${e.message}`); return []; }));
  }
  if (cfg.sources.includes('lever_bulk')) {
    tasks.push(bulkFetchLever({ keywords, concurrency: 15, limit, tenantLimit: 315, onProgress: ({ done, total, found }) => done % 100 === 0 && process.stderr.write(`  [lever] ${done}/${total} (${found})\n`) }).then((r) => r.jobs).catch((e) => { console.error(`  [lever] ERROR ${e.message}`); return []; }));
  }
  const lightSources = cfg.sources.filter((s) => s === 'yc_waas' || s === 'remoteok');
  if (lightSources.length) {
    tasks.push(discoverAll({ keywords, sources: lightSources, concurrency_per_source: 10, limit_per_source: 200 }).then((r) => r.jobs).catch((e) => { console.error(`  [light] ERROR ${e.message}`); return []; }));
  }

  const allRaw = (await Promise.all(tasks)).flat();
  const seen = new Set();
  const merged = [];
  for (const j of allRaw) {
    const k = ((j.apply_url || j.url || '') + '').toLowerCase().trim();
    if (!k || seen.has(k)) continue;
    seen.add(k); merged.push(j);
  }
  console.error(`  raw=${allRaw.length} unique=${merged.length}`);

  const kept = hardFilter(merged, intent);
  console.error(`  post-hard-filter=${kept.length}  (duration ${Math.round((Date.now() - t0) / 1000)}s)`);

  const outPath = `/tmp/coverage_${b}_candidates.json`;
  await fs.writeFile(outPath, JSON.stringify(kept, null, 2));
  console.error(`  → ${outPath}`);
  console.error(`  next: main Claude scores these per shared/scoring/score_prompt.md, writes /tmp/coverage_${b}_scores.json`);
}

function hardFilter(jobs, intent) {
  const excludes = (intent.search_intent.exclude_role_keywords || []).map((s) => s.toLowerCase());
  const allowedCountry = (intent.search_intent.geographic_preference?.primary_country || 'US').toLowerCase();
  const remoteOK = intent.search_intent.geographic_preference?.remote_acceptable !== false;
  const preferredMetros = (intent.search_intent.geographic_preference?.preferred_metros || []).map((s) => s.toLowerCase());

  function passesExclude(title) {
    const t = (title || '').toLowerCase();
    return !excludes.some((kw) => {
      const re = new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      return re.test(t);
    });
  }

  function passesLocation(loc) {
    if (!loc) return true;
    const l = loc.toLowerCase();
    if (remoteOK && (l.includes('remote') || l.includes('anywhere') || l.includes('worldwide'))) return true;
    if (preferredMetros.some((m) => l.includes(m.toLowerCase()))) return true;
    if (allowedCountry === 'us' && (l.includes('united states') || l.includes('usa') || /\bu\.s\.?\b/.test(l))) return true;
    const foreign = ['berlin','london','paris','amsterdam','madrid','barcelona','rome','milan','lisbon','warsaw','prague','vienna','zurich','stockholm','copenhagen','dublin','manchester','edinburgh','helsinki','oslo','budapest','tokyo','osaka','shanghai','beijing','shenzhen','hong kong','taipei','seoul','singapore','bangalore','bengaluru','mumbai','delhi','hyderabad','pune','chennai','kuala lumpur','jakarta','manila','bangkok','dubai','abu dhabi','tel aviv','riyadh','doha','jeddah','kuwait','sao paulo','são paulo','rio de janeiro','brasil','brazil','mexico city','buenos aires','lima','bogota','santiago','monterrey','guatemala','toronto','vancouver','montreal','calgary','ottawa','sydney','melbourne','brisbane','auckland','lagos','nairobi','cairo','cape town','johannesburg'];
    if (foreign.some((f) => l.includes(f))) return false;
    const foreignCountries = [' uae','united arab emirates','india','germany','france','spain','italy','netherlands','sweden','norway','denmark','finland','poland','mexico','colombia','argentina','chile','peru','japan','china','south korea','thailand','vietnam','philippines','indonesia','malaysia','pakistan','bangladesh','south africa','kenya','nigeria','egypt','saudi arabia','qatar','turkey','israel','canada','australia','new zealand','austria','ireland','belgium','switzerland','portugal','czechia','czech republic','hungary','greece','romania'];
    if (foreignCountries.some((c) => l.includes(c))) return false;
    return true;
  }

  function passesSeniority(title) {
    const t = (title || '').toLowerCase();
    if (/\b(senior|staff|principal|director|vp |head of |chief )\b/.test(t)) return false;
    return true;
  }

  return jobs.filter((j) => passesExclude(j.title) && passesLocation(j.location) && passesSeniority(j.title));
}

async function verifyMode() {
  const rows = [];
  let allPass = true;
  for (const [b, cfg] of Object.entries(BUCKETS)) {
    const scorePath = `/tmp/coverage_${b}_scores.json`;
    let scored = null;
    try { scored = JSON.parse(await fs.readFile(scorePath, 'utf8')); }
    catch { rows.push({ bucket: b, threshold: cfg.threshold, fit7_count: null, pass: null, note: 'missing scores file' }); allPass = false; continue; }
    const fit7 = scored.filter((s) => s.fit_score >= 7).length;
    const pass = fit7 >= cfg.threshold;
    rows.push({ bucket: b, threshold: cfg.threshold, fit7_count: fit7, pass, note: pass ? 'OK' : `BELOW threshold` });
    if (!pass) allPass = false;
  }
  const passCount = rows.filter((r) => r.pass === true).length;
  const report = { generated_at: new Date().toISOString(), launch_gate_pass: allPass, buckets_passing: passCount, buckets_total: rows.length, rows };
  await fs.writeFile('/tmp/coverage_matrix_report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
