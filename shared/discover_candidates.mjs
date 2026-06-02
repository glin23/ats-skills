#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { discoverAll, DEFAULT_SOURCES } from './sourcing/dispatcher.mjs';
import { discoveryApplyBucket, isAutoSupportedCandidate } from './sourcing/apply_url_classification.mjs';
import { hasUsableApplyUrl } from './sourcing/usable_apply_url.mjs';
import { passesAllowedRoleType, roleTypesFromSearchIntent, roleTypeConflict } from './role_types.mjs';
import { atsHome } from './paths.mjs';

const HOME = atsHome();
const TMP_DIR = '/tmp/mrweirdo-onboard';
const DEFAULT_EXCLUDE_ROLE_KEYWORDS = [
  'BCBA',
  'occupational therapist',
  'physical therapist',
  'speech therapist',
  'therapist',
  'clinician',
  'clinical supervisor',
  'registered nurse',
  'nurse',
  'pharmacist',
  'physician',
  'veterinarian',
];

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function parseNonNegativeInt(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function derivedKeywords(roleTypes) {
  const internKws = ['Intern', 'Internship', 'Co-op', 'Coop', 'APM Intern', 'Summer'];
  const partTimeKws = ['Part-time', 'Part time', 'Working Student', 'Student Assistant'];
  const fullTimeKws = ['New Grad', 'New Graduate', 'Early Career', 'Associate', 'Graduate'];
  return [
    ...(roleTypes.includes('intern') ? internKws : []),
    ...(roleTypes.includes('part_time') ? partTimeKws : []),
    ...(roleTypes.includes('new_grad_FT') ? fullTimeKws : []),
  ];
}

function passesExclude(title, excludes) {
  const t = String(title || '');
  return !excludes.some((kw) => new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i').test(t));
}

function passesLocation(loc, intent) {
  if (!loc) return true;
  const l = String(loc).toLowerCase();
  const geo = intent.geographic_preference || {};
  const allowedCountry = String(geo.primary_country || 'US').toLowerCase();
  const countriesOpenTo = new Set((geo.countries_open_to || [geo.primary_country || 'US']).map((s) => String(s).toUpperCase()));
  const relocationPolicy = geo.relocation_policy || 'selected_metros';
  const broadRelocation = relocationPolicy === 'anywhere_primary_country' || relocationPolicy === 'anywhere_legal_work';
  const remoteOK = geo.remote_acceptable !== false;
  const preferredMetros = (geo.preferred_metros || []).map((s) => String(s).toLowerCase());

  if (remoteOK && (l.includes('remote') || l.includes('anywhere') || l.includes('worldwide'))) return true;
  if (preferredMetros.some((m) => l.includes(m))) return true;

  const usLocation = l.includes('united states') || l.includes('usa') || /\bu\.s\.?\b/.test(l) ||
    ['austin', 'new york', 'nyc', 'san francisco', 'bay area', 'boston', 'cambridge', 'seattle', 'chicago', 'los angeles', 'denver', 'menlo park', 'palo alto', 'cincinnati'].some((c) => l.includes(c));
  const chinaLocation = l.includes('china') || ['beijing', 'shanghai', 'shenzhen', 'hong kong', 'guangzhou', 'hangzhou'].some((c) => l.includes(c));

  if (broadRelocation && countriesOpenTo.has('US') && usLocation) return true;
  if (broadRelocation && countriesOpenTo.has('CN') && chinaLocation) return true;
  if (allowedCountry === 'us' && countriesOpenTo.has('US') && (l.includes('united states') || l.includes('usa') || /\bu\.s\.?\b/.test(l))) return true;

  const foreignCities = [
    'berlin', 'london', 'paris', 'amsterdam', 'madrid', 'barcelona', 'rome', 'milan',
    'lisbon', 'warsaw', 'prague', 'vienna', 'zurich', 'stockholm', 'copenhagen',
    'dublin', 'manchester', 'edinburgh', 'helsinki', 'oslo', 'budapest',
    'tokyo', 'osaka', 'shanghai', 'beijing', 'shenzhen', 'hong kong', 'taipei',
    'seoul', 'singapore', 'bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad',
    'pune', 'chennai', 'kuala lumpur', 'jakarta', 'manila', 'bangkok', 'dubai',
    'abu dhabi', 'tel aviv', 'riyadh', 'doha', 'jeddah', 'kuwait', 'sao paulo',
    'são paulo', 'rio de janeiro', 'brasil', 'brazil', 'mexico city',
    'buenos aires', 'lima', 'bogota', 'santiago', 'monterrey', 'guatemala',
    'toronto', 'vancouver', 'montreal', 'calgary', 'ottawa', 'sydney', 'melbourne',
    'brisbane', 'auckland', 'lagos', 'nairobi', 'cairo', 'cape town', 'johannesburg',
  ];
  if (foreignCities.some((f) => l.includes(f))) {
    if (countriesOpenTo.has('CN') && chinaLocation) return true;
    return false;
  }

  const foreignCountries = [
    ' uae', 'united arab emirates', 'india', 'germany', 'france', 'spain', 'italy',
    'netherlands', 'sweden', 'norway', 'denmark', 'finland', 'poland', 'mexico',
    'colombia', 'argentina', 'chile', 'peru', 'japan', 'china', 'south korea',
    'thailand', 'vietnam', 'philippines', 'indonesia', 'malaysia', 'pakistan',
    'bangladesh', 'south africa', 'kenya', 'nigeria', 'egypt', 'saudi arabia',
    'qatar', 'turkey', 'israel', 'canada', 'australia', 'new zealand', 'austria',
    'ireland', 'belgium', 'switzerland', 'portugal', 'czechia', 'czech republic',
    'hungary', 'greece', 'romania',
  ];
  if (foreignCountries.some((c) => l.includes(c))) {
    if (countriesOpenTo.has('CN') && chinaLocation) return true;
    return false;
  }
  return true;
}

function hardFilter(jobs, intent, roleTypes) {
  const excludes = [
    ...DEFAULT_EXCLUDE_ROLE_KEYWORDS,
    ...(intent.exclude_role_keywords || []),
  ].map((s) => String(s).toLowerCase());
  return jobs.filter((job) => (
    hasUsableApplyUrl(job)
    && passesExclude(job.title, excludes)
    && passesLocation(job.location, intent)
    && passesAllowedRoleType(job, roleTypes)
  ));
}

// Annotate (but never drop) intern-titled candidates whose structured
// employment_type looks permanent. The row stays eligible — we only attach a
// free-text bot_note + a flag so a human can glance before submit. This is the
// only stage where employment_type is available; DB rows don't carry it.
const ROLE_CONFLICT_NOTE_PREFIX = 'role-type conflict:';
function annotateRoleTypeConflicts(jobs) {
  let conflictCount = 0;
  for (const job of jobs) {
    const { conflict, reason } = roleTypeConflict(job);
    if (!conflict) continue;
    conflictCount += 1;
    job.role_type_conflict = true;
    const note = `${ROLE_CONFLICT_NOTE_PREFIX} ${reason}`;
    job.bot_note = job.bot_note ? `${job.bot_note}\n${note}` : note;
  }
  return conflictCount;
}

const intentDoc = readJson(path.join(HOME, 'search_intent.json'), { search_intent: { seniority: 'intern' } });
const intent = intentDoc.search_intent || {};
const roleTypes = roleTypesFromSearchIntent(intent);
const keywords = derivedKeywords(roleTypes);
const sources = (argValue('--sources') || DEFAULT_SOURCES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const outputDir = argValue('--output-dir', TMP_DIR);
const limitPerSource = Math.max(1, Number(argValue('--limit-per-source', '500')));
const concurrency = Math.max(1, Number(argValue('--concurrency', '10')));
const capToScore = Math.max(1, Number(argValue('--cap-to-score', '300')));
const runId = argValue('--run-id', process.env.RUN_ID || `discovery-${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z`);
const sourceCursorFile = path.join(HOME, 'source_cursor.json');
const sourceWindowSizeRaw = argValue('--source-window-size', process.env.MRWEIRDO_SOURCE_WINDOW_SIZE || '1000');
const sourceWindowSize = parseNonNegativeInt(sourceWindowSizeRaw, 1000);
const explicitSourceWindowOffset = argValue('--source-window-offset', process.env.MRWEIRDO_SOURCE_WINDOW_OFFSET || null);
const sourceCursor = readJson(sourceCursorFile, {});
const sourceWindowEnabled = sourceWindowSize > 0;
const sourceWindowOffset = sourceWindowEnabled
  ? parseNonNegativeInt(explicitSourceWindowOffset ?? sourceCursor.next_offset ?? 0, 0)
  : null;
const sourceWindowOffsetSource = !sourceWindowEnabled
  ? 'disabled'
  : explicitSourceWindowOffset != null
    ? 'explicit'
    : 'local_cursor';

const plan = {
  run_id: runId,
  role_type_targets: roleTypes,
  keywords,
  sources,
  limit_per_source: limitPerSource,
  concurrency_per_source: concurrency,
  source_window: {
    enabled: sourceWindowEnabled,
    size: sourceWindowEnabled ? sourceWindowSize : null,
    offset: sourceWindowOffset,
    offset_source: sourceWindowOffsetSource,
    cursor_file: sourceCursorFile,
    advances_cursor_on_run: sourceWindowEnabled && explicitSourceWindowOffset == null,
  },
  output_dir: outputDir,
  output_files: {
    discovered: path.join(outputDir, 'discovered.json'),
    filtered: path.join(outputDir, 'filtered.json'),
    to_score: path.join(outputDir, 'to_score.json'),
    manual_or_unsupported: path.join(outputDir, 'manual_or_unsupported.json'),
  },
};

if (hasArg('--help') || hasArg('-h')) {
  console.log(`Usage:
  node shared/discover_candidates.mjs --plan
  node shared/discover_candidates.mjs --run --sources greenhouse_bulk,ashby_bulk --limit-per-source 500
  node shared/discover_candidates.mjs --run --source-window-size 1000
  node shared/discover_candidates.mjs --run --source-window-size 0 # full source lists
  node shared/discover_candidates.mjs --run --run-id "$RUN_ID"

Defaults read ~/.mrweirdo-jobs/search_intent.json and preserve the selected role boundary.
Bulk sources use a local rotating source window by default so each run crawls a new slice.`);
  process.exit(0);
}

if (!hasArg('--run')) {
  console.log(JSON.stringify({ ok: true, mode: 'plan', ...plan }, null, 2));
  process.exit(0);
}

fs.mkdirSync(outputDir, { recursive: true });
console.error(`[discover-candidates] sources=${sources.join(',')} keywords=${keywords.join(' | ')}`);
const result = await discoverAll({
  keywords,
  sources,
  concurrency_per_source: concurrency,
  limit_per_source: limitPerSource,
  source_window_size: sourceWindowEnabled ? sourceWindowSize : null,
  source_window_offset: sourceWindowEnabled ? sourceWindowOffset : 0,
  onProgress: (src, count) => console.error(`  [${src}] ${count} jobs`),
});

const discovered = result.jobs.map((job) => ({ ...job, discovery_run_id: runId }));
const unusableApplyUrlDropped = discovered.filter((job) => !hasUsableApplyUrl(job)).length;
const filtered = hardFilter(discovered, intent, roleTypes);
const roleTypeConflicts = annotateRoleTypeConflicts(filtered);
if (roleTypeConflicts > 0) {
  console.error(`[discover-candidates] role_type_conflicts=${roleTypeConflicts} (intern-titled rows with permanent-looking employment_type; flagged via bot_note, still eligible — human glance advised)`);
}
const manualOrUnsupported = filtered
  .filter((job) => !isAutoSupportedCandidate(job))
  .map((job) => ({ ...job, discovery_apply_bucket: discoveryApplyBucket(job) }));
let toScore = filtered
  .filter((job) => isAutoSupportedCandidate(job))
  .map((job) => ({ ...job, discovery_apply_bucket: 'auto_supported' }));
if (toScore.length > capToScore) {
  toScore.sort((a, b) => (b.description?.length || 0) - (a.description?.length || 0));
  toScore = toScore.slice(0, capToScore);
}

fs.writeFileSync(plan.output_files.discovered, JSON.stringify(discovered, null, 2));
fs.writeFileSync(plan.output_files.filtered, JSON.stringify(filtered, null, 2));
fs.writeFileSync(plan.output_files.to_score, JSON.stringify(toScore, null, 2));
fs.writeFileSync(plan.output_files.manual_or_unsupported, JSON.stringify(manualOrUnsupported, null, 2));

let nextSourceWindowOffset = null;
if (sourceWindowEnabled && explicitSourceWindowOffset == null) {
  nextSourceWindowOffset = sourceWindowOffset + sourceWindowSize;
  writeJson(sourceCursorFile, {
    next_offset: nextSourceWindowOffset,
    last_offset: sourceWindowOffset,
    window_size: sourceWindowSize,
    last_run_id: runId,
    updated_at: new Date().toISOString(),
  });
}

console.log(JSON.stringify({
  ok: true,
  mode: 'run',
  ...plan,
  discovered: discovered.length,
  filtered: filtered.length,
  to_score: toScore.length,
  manual_or_unsupported: manualOrUnsupported.length,
  unusable_apply_url_dropped: unusableApplyUrlDropped,
  role_type_conflicts: roleTypeConflicts,
  by_source: result.by_source,
  errors: result.errors,
  source_window_cursor_next_offset: nextSourceWindowOffset,
}, null, 2));
