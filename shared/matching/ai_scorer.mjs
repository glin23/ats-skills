// AI job fit scorer — Anthropic Messages API via Node 24 fetch (zero npm deps)
//
// Exports:
//   scoreFit(profile, job, opts)           — score a single job
//   scoreBatch(profile, jobs, opts)        — score N jobs with concurrency control
//   buildProfileSummary(profile)           — extract a compact markdown profile excerpt
//
// Usage:
//   import { scoreFit, scoreBatch, buildProfileSummary } from './ai_scorer.mjs';
//   const result = await scoreFit(profile, job, { recentFeedback: [] });

import { readFile } from 'node:fs/promises';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 1024;
const PROMPT_TEMPLATE_PATH = new URL('./prompt_template.md', import.meta.url);

// Rough Sonnet pricing — input $3/MTok, output $15/MTok (2026 reference).
// We do not have real token counts on success without usage in response; we use the
// response.usage block when present and fall back to a static estimate.
const PRICE_INPUT_PER_MTOK = 3.0;
const PRICE_OUTPUT_PER_MTOK = 15.0;
const FALLBACK_COST_USD = 0.003;

let _templateCache = null;

async function loadTemplate() {
  if (_templateCache === null) {
    _templateCache = await readFile(PROMPT_TEMPLATE_PATH, 'utf8');
  }
  return _templateCache;
}

/**
 * Build a compact markdown summary of the profile for injection into the prompt.
 * Pulls only the fields the scorer needs — avoids dumping the full JSON.
 * Returns ~300-500 chars of markdown.
 */
export function buildProfileSummary(profile) {
  const p = profile || {};
  const personal = p.personal || {};
  const education = p.education || {};
  const wa = p.work_authorization || {};
  const qa = p.standard_qa || {};

  const name = personal.full_name || `${personal.first_name || ''} ${personal.last_name || ''}`.trim() || 'Candidate';
  const school = education.school || 'Unknown school';
  const degree = education.degree || education.major || 'Unknown degree';
  const grad = education.graduation_date || 'unknown';
  const gpa = education.gpa ? `, GPA ${education.gpa}` : '';

  const visa = wa.visa_status || 'unknown';
  const authNow = wa.authorized_to_work_us ? 'authorized to work in US' : 'not authorized to work in US';
  const sponsorNow = wa.requires_sponsorship_now ? 'needs sponsorship now' : 'no sponsorship needed now';
  const sponsorFuture = wa.requires_sponsorship_future ? 'will need sponsorship in future' : 'no future sponsorship needed';

  const whyCompany = (qa.why_company || '').slice(0, 200).trim();
  const whyRole = (qa.why_role || '').slice(0, 200).trim();

  const lines = [
    `**Name**: ${name}`,
    `**Education**: ${degree} @ ${school} (graduating ${grad}${gpa})`,
    `**Work authorization**: ${visa}; ${authNow}; ${sponsorNow}; ${sponsorFuture}`,
  ];
  if (whyCompany) lines.push(`**Career interest (why_company default)**: ${whyCompany}`);
  if (whyRole) lines.push(`**Role interest (why_role default)**: ${whyRole}`);

  return lines.join('\n');
}

function formatTargetFilters(profile) {
  const tf = (profile && profile.target_filters) || {};
  const roleTypes = Array.isArray(tf.role_types) ? tf.role_types : [];
  const locations = Array.isArray(tf.locations) ? tf.locations : [];
  const excludes = Array.isArray(tf.exclude_keywords) ? tf.exclude_keywords : [];
  const minFit = typeof tf.min_fit_score === 'number' ? tf.min_fit_score : 6;
  const visaMust = !!tf.visa_must_sponsor;

  const lines = [
    `- role_types: [${roleTypes.join(', ')}]`,
    `- locations: [${locations.join(', ')}]`,
    `- exclude_keywords: [${excludes.join(', ')}]`,
    `- min_fit_score: ${minFit}`,
    `- visa_must_sponsor: ${visaMust}`,
  ];
  return lines.join('\n');
}

function formatSkipFeedback(recentFeedback) {
  if (!Array.isArray(recentFeedback) || recentFeedback.length === 0) {
    return '(no recent skip feedback)';
  }
  const items = recentFeedback.slice(-20).map((f) => {
    const company = f.company || 'Unknown';
    const reason = f.skip_reason || 'unspecified';
    const note = f.user_note ? ` — ${f.user_note}` : '';
    return `- ${company} (${reason}${note})`;
  });
  return items.join('\n');
}

function interpolate(template, vars) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return String(vars[key]);
    }
    return `{{${key}}}`;
  });
}

function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...[truncated]';
}

/**
 * Build the system prompt from a profile, job, and optional recent skip feedback.
 */
async function buildSystemPrompt(profile, job, recentFeedback) {
  const template = await loadTemplate();
  return interpolate(template, {
    PROFILE_SUMMARY: buildProfileSummary(profile),
    TARGET_FILTERS: formatTargetFilters(profile),
    SKIP_FEEDBACK: formatSkipFeedback(recentFeedback),
    COMPANY: job.company || 'Unknown',
    TITLE: job.title || 'Unknown',
    LOCATION: job.location || 'Unknown',
    DEPARTMENT: job.department || 'Unknown',
    EMPLOYMENT_TYPE: job.employment_type || 'Unknown',
    DESCRIPTION: truncate(job.description || '', 6000),
  });
}

function extractJson(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('empty response text');
  }
  // Strip markdown fence if present
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  // Pull first {...} block if there's surrounding prose
  if (!cleaned.startsWith('{')) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
  }
  return JSON.parse(cleaned);
}

function computeCost(usage) {
  if (!usage) return FALLBACK_COST_USD;
  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  const cost = (inTok / 1_000_000) * PRICE_INPUT_PER_MTOK + (outTok / 1_000_000) * PRICE_OUTPUT_PER_MTOK;
  return cost > 0 ? cost : FALLBACK_COST_USD;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callAnthropic({ apiKey, systemPrompt }) {
  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Evaluate this job.' }],
  };

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  const status = res.status;
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // some errors return non-JSON
  }
  return { status, payload };
}

/**
 * Score a single job. Returns the parsed JSON result, or throws on hard failure.
 *
 * opts:
 *   recentFeedback: Array<{ company, skip_reason, user_note }>
 *   apiKey:        string (defaults to process.env.ANTHROPIC_API_KEY)
 *   model:         string (override the default model)
 */
export async function scoreFit(profile, job, opts = {}) {
  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set (pass opts.apiKey or set env var)');

  const recentFeedback = opts.recentFeedback || [];
  const systemPrompt = await buildSystemPrompt(profile, job, recentFeedback);

  let attempt = 0;
  let lastError = null;
  while (attempt < 2) {
    attempt += 1;
    try {
      const { status, payload } = await callAnthropic({ apiKey, systemPrompt });

      if (status >= 200 && status < 300) {
        const text = payload?.content?.[0]?.text;
        const parsed = extractJson(text);
        const cost = computeCost(payload?.usage);
        process.stderr.write(
          `[scorer] $${cost.toFixed(4)} for ${job.company || '?'} ${job.title || '?'}\n`,
        );
        return parsed;
      }

      // Retry on 5xx or 429 (rate limit)
      if (status >= 500 || status === 429) {
        lastError = new Error(`Anthropic API ${status}: ${JSON.stringify(payload)}`);
        if (attempt < 2) {
          await sleep(2000);
          continue;
        }
        throw lastError;
      }

      // 4xx other than 429 — do not retry
      throw new Error(`Anthropic API ${status}: ${JSON.stringify(payload)}`);
    } catch (err) {
      lastError = err;
      // Network error / parse error — retry once
      if (attempt < 2) {
        await sleep(2000);
        continue;
      }
      throw lastError;
    }
  }
  throw lastError || new Error('scoreFit: unknown failure');
}

/**
 * Score N jobs concurrently. Returns an array same length as input; failed entries
 * contain `{ error: <message>, company, title }` instead of a score object.
 *
 * opts:
 *   concurrency:    number (default 5)
 *   recentFeedback: Array (passed through to scoreFit)
 *   apiKey:         string (passed through)
 *   onProgress:     (done, total) => void
 */
export async function scoreBatch(profile, jobs, opts = {}) {
  const concurrency = Math.max(1, Math.min(opts.concurrency || 5, 20));
  const recentFeedback = opts.recentFeedback || [];
  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set (pass opts.apiKey or set env var)');

  const results = new Array(jobs.length);
  let nextIndex = 0;
  let done = 0;
  const total = jobs.length;

  async function worker() {
    while (true) {
      const idx = nextIndex;
      nextIndex += 1;
      if (idx >= total) return;

      const job = jobs[idx];
      try {
        results[idx] = await scoreFit(profile, job, { recentFeedback, apiKey });
      } catch (err) {
        results[idx] = {
          error: String(err?.message || err),
          company: job?.company || null,
          title: job?.title || null,
        };
      }
      done += 1;
      try {
        onProgress(done, total);
      } catch {
        // never let progress callback crash the batch
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, total); i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}
