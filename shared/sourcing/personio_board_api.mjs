/**
 * personio_board_api.mjs — Personio Job Board API client (zero npm dep, Node 24 ESM)
 *
 * Public endpoint (no auth):
 *   https://{tenant}.jobs.personio.de/xml
 *
 * Unlike Greenhouse/Ashby/Recruitee, Personio returns **XML** (not JSON), shape:
 *
 *   <workzag-jobs>
 *     <position>
 *       <id>...</id><subcompany>...</subcompany><office>...</office>
 *       <department>...</department><name language="en">...</name>
 *       <employmentType>...</employmentType><schedule>...</schedule>
 *       <seniority>...</seniority><yearsOfExperience>...</yearsOfExperience>
 *       <jobDescriptions>...</jobDescriptions><createdAt>...</createdAt>
 *     </position>
 *   </workzag-jobs>
 *
 * Node has no built-in XML parser. To stay zero-dep we use a deliberately
 * narrow regex parser:
 *
 *   1. Split on `<position>...</position>` block boundaries.
 *   2. Inside each block, pull `<field>value</field>` pairs with a flat regex.
 *
 * This is GOOD ENOUGH for Personio because (a) the schema is shallow — every
 * top-level field is a single text element directly under <position>, (b)
 * Personio does not nest tags of the same name, and (c) CDATA sections are
 * handled by stripping the wrapper.
 *
 * LIMITATIONS of the regex approach (deliberate trade-offs):
 *   - `<jobDescriptions>` contains nested `<jobDescription>` children with HTML
 *     inside CDATA. We capture the whole inner string as `description` raw —
 *     downstream callers should treat it as HTML, not plain text.
 *   - HTML entities (`&amp;` `&lt;` `&gt;` `&quot;` `&#xx;`) are unescaped
 *     manually; anything more exotic is left as-is.
 *   - If Personio ever changes the schema to nest `<position>` inside
 *     `<position>` (it doesn't today), this parser would mis-split. Migrating
 *     to `fast-xml-parser` would be a 2-line swap.
 *
 * Interface mirrors ashby_board_api.mjs / recruitee_board_api.mjs.
 *
 * Sourcing only — Lee hand-submits Personio applications.
 */

const REQ_INTERVAL_MS = 1000; // 1 req/sec throttle
const RETRY_BACKOFF_MS = 2000;
const USER_AGENT = 'ats-skills/0.8 (+https://github.com/glin23/ats-skills)';

let _lastRequestAt = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle() {
  const now = Date.now();
  const elapsed = now - _lastRequestAt;
  if (elapsed < REQ_INTERVAL_MS) {
    await sleep(REQ_INTERVAL_MS - elapsed);
  }
  _lastRequestAt = Date.now();
}

function buildUrl(tenant) {
  const clean = String(tenant)
    .replace(/^https?:\/\//, '')
    .replace(/\.jobs\.personio\.(de|com).*$/, '')
    .replace(/\/+$/, '');
  return `https://${clean}.jobs.personio.de/xml`;
}

/**
 * Fetch raw Personio XML text for a single tenant, with 1 req/sec throttle and
 * one retry on 5xx. 404 returns null (caller treats as empty).
 */
async function fetchRaw(tenant) {
  const url = buildUrl(tenant);
  for (let attempt = 0; attempt < 2; attempt++) {
    await throttle();
    let resp;
    try {
      resp = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml, text/xml' },
      });
    } catch (err) {
      if (attempt === 0) {
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      throw err;
    }
    if (resp.status === 404) return null;
    if (resp.status >= 500 && resp.status < 600) {
      if (attempt === 0) {
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      throw new Error(`Personio ${tenant}: HTTP ${resp.status}`);
    }
    if (!resp.ok) throw new Error(`Personio ${tenant}: HTTP ${resp.status}`);
    return await resp.text();
  }
  return null;
}

// ---------- regex XML helpers ----------

function unescapeEntities(s) {
  if (s == null) return '';
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

/**
 * Pull the *first* `<tag>...</tag>` inner string from `block`, or '' if none.
 * Strips CDATA wrappers and unescapes basic entities. Tag-name-only — does not
 * filter by attribute (so `<name language="en">X</name>` matches via `name`).
 */
function pickTag(block, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return unescapeEntities(m[1]).trim();
}

/**
 * Like pickTag, but prefers `language="en"` if present (Personio jobs often
 * have <name language="de"> + <name language="en">).
 */
function pickLocalized(block, tag) {
  const enRe = new RegExp(`<${tag}\\b[^>]*language=["']en["'][^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const enMatch = block.match(enRe);
  if (enMatch) return unescapeEntities(enMatch[1]).trim();
  return pickTag(block, tag);
}

/**
 * Split raw XML into individual <position>...</position> blocks.
 */
function splitPositions(xml) {
  if (!xml || typeof xml !== 'string') return [];
  const out = [];
  const re = /<position\b[^>]*>([\s\S]*?)<\/position>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1]);
  }
  return out;
}

/**
 * Build a careers-page URL for a Personio position. Personio doesn't include a
 * canonical URL in the XML — by convention, the job lives at:
 *   https://{tenant}.jobs.personio.de/job/{id}
 */
function buildJobUrl(tenant, id) {
  if (!id) return '';
  const clean = String(tenant)
    .replace(/^https?:\/\//, '')
    .replace(/\.jobs\.personio\.(de|com).*$/, '')
    .replace(/\/+$/, '');
  return `https://${clean}.jobs.personio.de/job/${id}`;
}

/**
 * Normalize one Personio <position> block to the shared sourcing shape.
 */
function normalizePosition(block, tenant) {
  const id = pickTag(block, 'id');
  const title = pickLocalized(block, 'name');
  const office = pickTag(block, 'office');
  const department = pickTag(block, 'department');
  const employmentType = pickTag(block, 'employmentType');
  const schedule = pickTag(block, 'schedule');
  const seniority = pickTag(block, 'seniority');
  const years = pickTag(block, 'yearsOfExperience');
  const createdAt = pickTag(block, 'createdAt');
  const subcompany = pickTag(block, 'subcompany');
  const recruitingCategory = pickTag(block, 'recruitingCategory');
  // Capture the full jobDescriptions block raw (HTML inside) — see header note.
  const description = pickTag(block, 'jobDescriptions');
  const url = buildJobUrl(tenant, id);
  return {
    company: tenant,
    title,
    url,
    apply_url: url, // Personio uses the same page for view + apply
    location: office,
    description,
    department,
    updated_at: createdAt,
    employment_type: employmentType,
    schedule, // "full-time" / "part-time"
    seniority, // "entry-level" / "experienced" / "student" / ...
    years_of_experience: years,
    recruiting_category: recruitingCategory,
    is_remote: /remote/i.test(office || ''),
    subcompany,
    compensation: '', // Personio XML does not expose salary
    _source: 'personio',
    _id: id,
  };
}

/**
 * fetchJobs(tenant, opts) — returns array of normalized jobs.
 *   opts.companyName: override `company` field on returned jobs.
 */
export async function fetchJobs(tenant, opts = {}) {
  if (!tenant || typeof tenant !== 'string') {
    throw new Error('fetchJobs: tenant required');
  }
  const xml = await fetchRaw(tenant);
  if (!xml) return [];
  const blocks = splitPositions(xml);
  if (blocks.length === 0) return [];
  const company = opts.companyName || tenant;
  return blocks.map((b) => {
    const norm = normalizePosition(b, tenant);
    norm.company = company;
    return norm;
  });
}

/**
 * fetchJobsForCompany(companyName, tenantCandidates, opts) — try multiple
 * tenants until one returns a non-empty board.
 */
export async function fetchJobsForCompany(companyName, tenantCandidates, opts = {}) {
  const candidates = Array.isArray(tenantCandidates)
    ? tenantCandidates
    : [tenantCandidates];
  for (const tenant of candidates) {
    if (!tenant) continue;
    try {
      const jobs = await fetchJobs(tenant, { ...opts, companyName });
      if (jobs.length > 0) return jobs;
    } catch (err) {
      if (opts.verbose) console.error(`[personio] ${tenant} error:`, err.message);
    }
  }
  return [];
}

// ---------- role-type filtering ----------

const INTERN_TITLE_RE = /\b(intern|internship|praktikant|praktikum|werkstudent|stage|stagiaire)\b/i;
const NEW_GRAD_TITLE_RE =
  /\b(new\s?grad|new\s?graduate|university\s?grad|university\s?graduate|early\s?career|recent\s?graduate|graduate\s?program|junior|absolvent)\b/i;

function matchesIntern(job) {
  const et = (job.employment_type || '').toLowerCase();
  const sen = (job.seniority || '').toLowerCase();
  // Personio employmentType values include: "permanent", "intern", "trainee",
  // "freelance", "part_time". Seniority "student" also signals an intern role.
  if (et === 'intern' || et === 'internship' || et === 'trainee') return true;
  if (sen === 'student') return true;
  return INTERN_TITLE_RE.test(job.title || '');
}

function matchesNewGradFT(job) {
  const et = (job.employment_type || '').toLowerCase();
  const sched = (job.schedule || '').toLowerCase();
  const sen = (job.seniority || '').toLowerCase();
  // Personio "permanent" = regular FT/PT role. Require schedule full-time when
  // present; if schedule missing, fall back to permanent.
  const isFT =
    (et === 'permanent' && (sched === 'full-time' || sched === 'fulltime' || sched === '')) ||
    et === 'full_time' ||
    et === 'fulltime';
  if (!isFT) return false;
  // Entry-level/junior signals from seniority field OR title.
  if (sen === 'entry-level' || sen === 'entry_level' || sen === 'junior') {
    if (NEW_GRAD_TITLE_RE.test(job.title || '')) return true;
    if (sen === 'entry-level' || sen === 'entry_level') return true;
  }
  return NEW_GRAD_TITLE_RE.test(job.title || '');
}

/**
 * filterByRoleType(jobs, roleTypes) — uses employmentType + schedule + seniority
 * + title. Supported roleTypes: 'intern', 'new_grad_FT'.
 */
export function filterByRoleType(jobs, roleTypes = ['intern', 'new_grad_FT']) {
  if (!Array.isArray(jobs)) return [];
  const wantIntern = roleTypes.includes('intern');
  const wantNewGrad = roleTypes.includes('new_grad_FT');
  if (!wantIntern && !wantNewGrad) return [];
  return jobs.filter((j) => {
    if (wantIntern && matchesIntern(j)) return true;
    if (wantNewGrad && matchesNewGradFT(j)) return true;
    return false;
  });
}

// ---------- CLI smoke test ----------
// Usage: node shared/sourcing/personio_board_api.mjs <tenant>
if (import.meta.url === `file://${process.argv[1]}`) {
  const tenant = process.argv[2];
  if (!tenant) {
    console.error('Usage: node personio_board_api.mjs <tenant>');
    process.exit(1);
  }
  const jobs = await fetchJobs(tenant);
  const filtered = filterByRoleType(jobs);
  console.log(
    JSON.stringify(
      {
        tenant,
        total: jobs.length,
        filtered: filtered.length,
        sample: filtered.slice(0, 3).map((j) => ({
          title: j.title,
          employment_type: j.employment_type,
          schedule: j.schedule,
          seniority: j.seniority,
          location: j.location,
          url: j.url,
        })),
      },
      null,
      2,
    ),
  );
}
