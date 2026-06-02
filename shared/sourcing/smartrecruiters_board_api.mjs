/**
 * smartrecruiters_board_api.mjs — SmartRecruiters public Postings API client
 *
 * Public endpoint (no auth):
 *   https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100
 *
 * SmartRecruiters returns a paginated envelope:
 *   { offset, limit, totalFound, content: [ posting, ... ] }
 *
 * Per-posting shape (selected fields):
 *   id, name, uuid, refNumber, releasedDate,
 *   company        { name, identifier },
 *   location       { city, region, country, remote },
 *   department     { label }, industry { label }, function { label },
 *   typeOfEmployment { id, label } e.g. "Permanent" / "Intern" / "Contract"
 *   experienceLevel  { id, label } e.g. "Student" / "Entry-Level" / "Mid-Senior"
 *   customField    [ { fieldId, fieldLabel, valueId, valueLabel } ... ]
 *   ref            (API URL),
 *   applyUrl       (https://jobs.smartrecruiters.com/{Slug}/{uuid})
 *   jobAd.sections { jobDescription, qualifications, additionalInformation }
 *
 * Salary info is NOT a standard field — SmartRecruiters customers expose it
 * through `customField[]` entries (look for fieldLabel matching /salary|comp/i).
 *
 * Interface mirrors greenhouse_board_api.mjs / ashby_board_api.mjs so the
 * sourcing pipeline can route by ATS slug.
 *
 * v0.8 — scaffold. Not yet live-verified against a live submit pipeline.
 */

const SR_ENDPOINT = 'https://api.smartrecruiters.com/v1/companies';
const PAGE_LIMIT = 100;
const MAX_JOBS_PER_COMPANY = 300; // safety cap — 3 pages
const REQ_INTERVAL_MS = 1000; // 1 req/sec throttle
const RETRY_BACKOFF_MS = 2000;
const DEFAULT_TIMEOUT_MS = 12000;
const USER_AGENT = 'mrweirdo-jobs/1.3 (+sourcing/smartrecruiters)';

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

/**
 * stripHtml(html) — `jobAd.sections.*.text` is HTML. Same lightweight cleaner
 * used in greenhouse_board_api so the AI scorer sees plain text.
 */
export function stripHtml(html) {
  if (html == null) return '';
  let s = String(html);
  s = s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  s = s.replace(/<[^>]*>/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Fetch one page of postings (limit=100, offset=N) with throttle + one 5xx retry.
 * 404 returns null (caller treats as empty / stop pagination).
 */
async function fetchPage(slug, offset) {
  const url =
    `${SR_ENDPOINT}/${encodeURIComponent(slug)}/postings` +
    `?limit=${PAGE_LIMIT}&offset=${offset}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    await throttle();
    const ctrl = new AbortController();
    const to = setTimeout(
      () => ctrl.abort(new Error('timeout')),
      DEFAULT_TIMEOUT_MS,
    );
    let resp;
    try {
      resp = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
    } catch (err) {
      clearTimeout(to);
      if (attempt === 0) {
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      throw new Error(
        `smartrecruiters fetchPage(${slug}, ${offset}) network: ${err.message}`,
      );
    }
    clearTimeout(to);

    if (resp.status === 404) return null;
    if (resp.status >= 500 && resp.status < 600) {
      if (attempt === 0) {
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      throw new Error(
        `smartrecruiters fetchPage(${slug}, ${offset}) HTTP ${resp.status} after retry`,
      );
    }
    if (!resp.ok) {
      throw new Error(
        `smartrecruiters fetchPage(${slug}, ${offset}) HTTP ${resp.status}`,
      );
    }
    try {
      return await resp.json();
    } catch (err) {
      throw new Error(
        `smartrecruiters fetchPage(${slug}, ${offset}) JSON parse: ${err.message}`,
      );
    }
  }
  return null;
}

/**
 * extractSalary(customField) — best-effort scan of the `customField[]` array
 * for salary / compensation hints. Returns the first match as a string, or ''.
 */
function extractSalary(customField) {
  if (!Array.isArray(customField)) return '';
  for (const f of customField) {
    const label = String(f.fieldLabel || '').toLowerCase();
    if (!label) continue;
    if (/(salary|compensation|pay\s*range|base\s*pay|wage)/.test(label)) {
      const v = f.valueLabel || f.value || '';
      if (v) return String(v);
    }
  }
  return '';
}

/**
 * formatLocation(loc, remote) — SmartRecruiters location is structured.
 * `{ city, region, country, remote }` → "City, Region, Country" or "Remote".
 */
function formatLocation(loc) {
  if (!loc) return '';
  if (loc.remote === true) {
    const parts = [loc.city, loc.region, loc.country].filter(Boolean);
    return parts.length ? `Remote — ${parts.join(', ')}` : 'Remote';
  }
  return [loc.city, loc.region, loc.country].filter(Boolean).join(', ');
}

/**
 * Concatenate `jobAd.sections.*.text` into a single plain-text description.
 */
function buildDescription(jobAd) {
  if (!jobAd || !jobAd.sections) return '';
  const order = ['jobDescription', 'qualifications', 'additionalInformation'];
  const parts = [];
  for (const key of order) {
    const sec = jobAd.sections[key];
    if (!sec) continue;
    const t = stripHtml(sec.text || '');
    if (t) parts.push(t);
  }
  return parts.join('\n\n');
}

/**
 * _normalizePosting(slug, raw) — flatten one SmartRecruiters posting into the
 * shared sourcing shape (same field set as greenhouse / ashby normalizers).
 */
function _normalizePosting(slug, raw) {
  const employment = (raw.typeOfEmployment && raw.typeOfEmployment.label) || '';
  const experience = (raw.experienceLevel && raw.experienceLevel.label) || '';
  const department = (raw.department && raw.department.label) || '';
  const loc = raw.location || {};
  const applyUrl = raw.applyUrl || '';
  return {
    source: 'smartrecruiters',
    company: (raw.company && raw.company.name) || slug,
    title: raw.name || '',
    url: applyUrl,
    apply_url: applyUrl,
    location: formatLocation(loc),
    description: buildDescription(raw.jobAd),
    department,
    updated_at: raw.releasedDate || '',
    employment_type: employment,
    experience_level: experience,
    is_remote: !!loc.remote,
    compensation: extractSalary(raw.customField),
    raw_id: raw.id || raw.uuid || '',
    _slug: slug,
  };
}

/**
 * fetchJobs(slug, opts) — fetch ALL postings for a SmartRecruiters slug.
 * Handles pagination via `totalFound` until exhausted OR MAX_JOBS_PER_COMPANY
 * is hit (safety cap). 404 → []. Returns normalized job objects.
 */
export async function fetchJobs(slug, opts = {}) {
  if (!slug || typeof slug !== 'string') {
    throw new TypeError('fetchJobs(slug): slug must be a non-empty string');
  }

  const all = [];
  let offset = 0;
  // First page tells us totalFound; subsequent pages continue until done or cap.
  while (offset < MAX_JOBS_PER_COMPANY) {
    const data = await fetchPage(slug, offset);
    if (!data) {
      // 404 on first page = no board; on later pages would be unusual but safe.
      break;
    }
    const content = Array.isArray(data.content) ? data.content : [];
    for (const raw of content) {
      all.push(_normalizePosting(slug, raw));
      if (all.length >= MAX_JOBS_PER_COMPANY) break;
    }
    const total = Number.isFinite(data.totalFound) ? data.totalFound : all.length;
    offset += PAGE_LIMIT;
    if (offset >= total) break;
    if (content.length === 0) break; // defensive: avoid infinite loop on weird response
  }

  const companyName = opts.companyName;
  if (companyName) {
    for (const j of all) j.company = companyName;
  }
  return all;
}

/**
 * fetchJobsForCompany(companyName, slugCandidates, opts) — try each slug until
 * one returns a non-empty board. SmartRecruiters slugs are usually the company
 * PascalCase name (e.g. "Bosch", "Square") — try a few variants.
 */
export async function fetchJobsForCompany(
  companyName,
  slugCandidates,
  opts = {},
) {
  const candidates = Array.isArray(slugCandidates)
    ? slugCandidates.filter(Boolean)
    : [slugCandidates].filter(Boolean);
  if (!candidates.length) {
    throw new TypeError(
      'fetchJobsForCompany: at least one slug candidate required',
    );
  }

  const tried = [];
  for (const slug of candidates) {
    tried.push(slug);
    try {
      const jobs = await fetchJobs(slug, { ...opts, companyName });
      if (jobs.length) {
        return jobs.map((j) => ({ ...j, slug }));
      }
    } catch (err) {
      if (opts.verbose) {
        console.warn(
          `[smartrecruiters] ${companyName} via "${slug}" failed: ${err.message}`,
        );
      }
    }
  }
  if (opts.verbose) {
    console.warn(
      `[smartrecruiters] no jobs found for ${companyName} (tried: ${tried.join(', ')})`,
    );
  }
  return [];
}

// ---------- role-type filtering ----------

const INTERN_TITLE_RE = /\b(intern|internship|co-?op|summer\s+202[5-7])\b/i;
const NEW_GRAD_TITLE_RE =
  /\b(new\s?grad|new\s?graduate|university\s?grad|university\s?graduate|early\s?career|recent\s?graduate|college\s?grad|graduate\s+program|associate\s*\(.*new)\b/i;

/**
 * Title-only classifier (used when employment_type / experience_level are
 * missing or ambiguous). Mirrors greenhouse classifyRoleType().
 */
function classifyByTitle(title) {
  if (!title) return 'other';
  if (INTERN_TITLE_RE.test(title)) return 'intern';
  if (NEW_GRAD_TITLE_RE.test(title)) return 'new_grad_FT';
  return 'other';
}

function isInternEmployment(employment_type) {
  const e = (employment_type || '').toLowerCase();
  // SmartRecruiters labels seen in the wild: "Intern", "Internship", "Trainee"
  return e === 'intern' || e === 'internship' || e === 'trainee';
}

function isFullTimeEmployment(employment_type) {
  const e = (employment_type || '').toLowerCase();
  // "Permanent" is SmartRecruiters' canonical full-time label.
  return (
    e === 'permanent' ||
    e === 'full-time' ||
    e === 'full time' ||
    e === 'fulltime' ||
    e === 'regular'
  );
}

function looksEarlyCareer(experience_level) {
  const x = (experience_level || '').toLowerCase();
  return (
    x === 'student' ||
    x === 'entry-level' ||
    x === 'entry level' ||
    x === 'entrylevel' ||
    x === 'graduate' ||
    x === 'associate' ||
    x.includes('entry') ||
    x.includes('student')
  );
}

/**
 * Triple-judgment classifyJob — combines typeOfEmployment.label,
 * experienceLevel.label, and title regex. SmartRecruiters' employment
 * taxonomy is sparser than Ashby's, so title still carries weight.
 */
export function classifyJob(job) {
  if (!job) return 'other';
  const titleHit = classifyByTitle(job.title || '');
  const employment = job.employment_type || '';
  const experience = job.experience_level || '';

  // Intern: employment says intern OR title says intern.
  if (isInternEmployment(employment)) return 'intern';
  if (titleHit === 'intern') return 'intern';

  // New-grad FT: must be FT-flavored employment AND (title says new-grad OR
  // experienceLevel says student/entry-level). The experienceLevel-only path
  // catches roles like "Software Engineer" tagged `Student` without the
  // explicit "new grad" string in the title.
  if (isFullTimeEmployment(employment) || employment === '') {
    if (titleHit === 'new_grad_FT') return 'new_grad_FT';
    if (looksEarlyCareer(experience)) return 'new_grad_FT';
  }

  return 'other';
}

/**
 * filterByRoleType(jobs, roleTypes) — uses classifyJob (triple judgment).
 * Default keeps intern + new_grad_FT, same default as siblings.
 * Tags each returned job with `role_type` for downstream stages.
 */
export function filterByRoleType(jobs, roleTypes = ['intern', 'new_grad_FT']) {
  if (!Array.isArray(jobs)) return [];
  const allowed = new Set(roleTypes);
  const out = [];
  for (const j of jobs) {
    const role_type = classifyJob(j);
    if (allowed.has(role_type)) {
      out.push({ ...j, role_type });
    }
  }
  return out;
}

// ---------- CLI smoke test ----------
// Usage: node shared/sourcing/smartrecruiters_board_api.mjs <slug>
if (import.meta.url === `file://${process.argv[1]}`) {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: node smartrecruiters_board_api.mjs <slug>');
    process.exit(1);
  }
  const jobs = await fetchJobs(slug);
  const filtered = filterByRoleType(jobs);
  console.log(
    JSON.stringify(
      {
        slug,
        total: jobs.length,
        filtered: filtered.length,
        sample: filtered.slice(0, 3).map((j) => ({
          title: j.title,
          employment_type: j.employment_type,
          experience_level: j.experience_level,
          location: j.location,
          compensation: j.compensation,
          url: j.url,
          role_type: j.role_type,
        })),
      },
      null,
      2,
    ),
  );
}
