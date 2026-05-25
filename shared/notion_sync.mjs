#!/usr/bin/env node
// notion_sync.mjs — Notion HTTP API client (v0.3 / v0.8 / v1.0 era)
//
// ⚠️ v1.1 NOTICE: This file is no longer the primary job tracker. mrweirdo-jobs
// v1.1+ uses shared/local_db.mjs (SQLite + Datasette) instead. notion_sync is
// retained for:
//   1. v0.9 / v1.0 users who already have Notion DB data (migration tool)
//   2. Anyone who explicitly wants a Notion mirror of their local jobs.db
// New users should use local_db.mjs and ignore this file.
//
// Node 24+ required (uses global fetch). Zero deps by design.
// Direct REST calls so open-source users don't need our private MCP setup.
//
// =============================================================================
// FIRST-TIME SETUP — DO THIS BEFORE RUNNING ANY SYNC
// =============================================================================
// 1. Create a Notion integration at https://www.notion.so/my-integrations
//    Copy the secret token (starts with `secret_...` or `ntn_...`).
// 2. Share your "📋 岗位追踪" database with the integration (Share → Invite).
// 3. Export NOTION_API_KEY=<your-token>  (setup.sh will help you persist this)
// 4. (Optional) Override NOTION_JOB_DB_ID if your DB id differs from the default.
//
// 5. Manually add these properties to the Notion DB — this script will NOT
//    create them for you (Notion API can but we skip that until v0.4):
//
//      • fit_score          (Number)
//      • key_gaps           (Text)              — multi-line OK
//      • role_type_match    (Select)            options: intern / new_grad_FT / other
//      • skip_reason        (Select)            options: Wrong Role / Wrong Location /
//                                                        No Sponsor / Salary / Other
//      • user_note          (Text)
//      • dim_scores         (Text)              — stores JSON string
//
//    Also add these options to the existing "状态" (Status) Select:
//      • "🤖 AI sourced"
//      • "✅ Approved"
//
//    v0.8 additions (salary / comp tracking — required for 用户's 2026-05-23 vision):
//
//      • salary_min         (Number)            — lower bound of comp band
//      • salary_max         (Number)            — upper bound of comp band
//      • salary_currency    (Select)            options: USD / EUR / GBP / CAD / AUD / SGD / INR / CNY / Other
//      • salary_interval    (Select)            options: hour / year / month / week
//      • hourly_rate        (Number)            — auto-computed from salary band
//                                                  (year → /2080, month → /173, week → /40, hour passthrough)
//
// If a property is missing, page create/update will fail with a 400 from
// Notion telling you which property is unknown — add it and retry.
// =============================================================================

import { notionDbId, notionDataSourceId, notionViewId, loadEnv } from './paths.mjs';

// load ~/.mrweirdo-jobs/.env into process.env on import (no-op if already set)
loadEnv();

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const DATABASE_ID = notionDbId();
const NOTION_VERSION = '2022-06-28';
const API_BASE = 'https://api.notion.com/v1';

// Notion published rate limit is ~3 req/sec average. We throttle to that.
const RATE_LIMIT_RPS = 3;
const MIN_INTERVAL_MS = Math.ceil(1000 / RATE_LIMIT_RPS);

// ---------- low-level HTTP ----------

let _lastRequestAt = 0;

async function _throttle() {
  const now = Date.now();
  const wait = Math.max(0, _lastRequestAt + MIN_INTERVAL_MS - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  _lastRequestAt = Date.now();
}

async function notionFetch(method, path, body, { retried = false } = {}) {
  if (!NOTION_API_KEY) {
    throw new Error(
      'NOTION_API_KEY env var not set. See header of notion_sync.mjs for setup.'
    );
  }
  await _throttle();
  const res = await fetch(`${API_BASE}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429) {
    if (retried) {
      const text = await res.text().catch(() => '');
      throw new Error(`Notion 429 rate-limited after retry: ${text}`);
    }
    const retryAfter = Number(res.headers.get('retry-after') || 5);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return notionFetch(method, path, body, { retried: true });
  }

  if (res.status >= 500 && res.status < 600 && !retried) {
    await new Promise((r) => setTimeout(r, 1500));
    return notionFetch(method, path, body, { retried: true });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Notion ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ---------- property helpers ----------

function titleProp(text) {
  return { title: [{ text: { content: String(text ?? '') } }] };
}
function richTextProp(text) {
  return { rich_text: [{ text: { content: String(text ?? '') } }] };
}
function selectProp(name) {
  if (name == null || name === '') return { select: null };
  return { select: { name: String(name) } };
}
function urlProp(url) {
  return { url: url || null };
}
function numberProp(n) {
  return { number: typeof n === 'number' && Number.isFinite(n) ? n : null };
}
function dateProp(iso) {
  return iso ? { date: { start: iso } } : { date: null };
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ---------- property extraction (for queries) ----------

function readTitle(prop) {
  return prop?.title?.map((t) => t.plain_text).join('') || '';
}
function readRichText(prop) {
  return prop?.rich_text?.map((t) => t.plain_text).join('') || '';
}
function readSelect(prop) {
  return prop?.select?.name || '';
}
function readUrl(prop) {
  return prop?.url || '';
}
function readNumber(prop) {
  return typeof prop?.number === 'number' ? prop.number : null;
}

// ---------- salary helpers (v0.8) ----------

// Convert a salary band into an hourly rate (USD-equivalent unit-wise — caller
// is responsible for currency conversion; we only normalize interval).
// Returns null when interval/value missing.
//
// Conventions:
//   year   → /2080  (52 wk × 40 hr)
//   month  → /173   (2080 / 12, rounded)
//   week   → /40    (40-hr work week)
//   hour   → passthrough
function computeHourlyRate({ min, max, interval } = {}) {
  if (interval == null) return null;
  // Use the midpoint of the band when both bounds present, else whichever is set.
  let amount = null;
  if (typeof min === 'number' && typeof max === 'number') amount = (min + max) / 2;
  else if (typeof min === 'number') amount = min;
  else if (typeof max === 'number') amount = max;
  if (amount == null || !Number.isFinite(amount)) return null;
  const divisor = { year: 2080, month: 173, week: 40, hour: 1 }[interval];
  if (!divisor) return null;
  return Math.round((amount / divisor) * 100) / 100; // 2 decimals
}

// ---------- build properties payload from jobScored ----------

function buildProperties(job, { forCreate = false } = {}) {
  const props = {};
  if (job.company != null) props['公司'] = titleProp(job.company);
  if (job.title != null) props['岗位'] = richTextProp(job.title);
  if (job.location != null) props['城市'] = richTextProp(job.location);
  if (job.url != null) props['Apply URL'] = urlProp(job.url);
  if (job.ats != null) props['ATS 平台'] = selectProp(job.ats);

  if (job.fit_score != null) props['fit_score'] = numberProp(job.fit_score);
  if (job.key_gaps != null) props['key_gaps'] = richTextProp(job.key_gaps);
  if (job.role_type_match != null)
    props['role_type_match'] = selectProp(job.role_type_match);
  if (job.dim_scores != null) {
    const jsonStr =
      typeof job.dim_scores === 'string'
        ? job.dim_scores
        : JSON.stringify(job.dim_scores);
    props['dim_scores'] = richTextProp(jsonStr);
  }
  if (job.user_note != null) props['user_note'] = richTextProp(job.user_note);
  if (job.skip_reason != null) props['skip_reason'] = selectProp(job.skip_reason);
  if (job.bot_note != null) props['Bot 备注'] = richTextProp(job.bot_note);

  // v0.8 — salary / comp band
  // jobScored.salary = { min: 25, max: 35, currency: 'USD', interval: 'hour' }
  if (job.salary && typeof job.salary === 'object') {
    const s = job.salary;
    if (s.min != null) props['salary_min'] = numberProp(s.min);
    if (s.max != null) props['salary_max'] = numberProp(s.max);
    if (s.currency != null) props['salary_currency'] = selectProp(s.currency);
    if (s.interval != null) props['salary_interval'] = selectProp(s.interval);
    const hr = computeHourlyRate(s);
    if (hr != null) props['hourly_rate'] = numberProp(hr);
  }
  // Allow direct override of hourly_rate if caller already computed it (e.g. with currency conversion).
  if (job.hourly_rate != null) props['hourly_rate'] = numberProp(job.hourly_rate);

  if (forCreate) {
    // Default state for newly-created AI-sourced rows.
    if (!props['状态']) props['状态'] = selectProp('🤖 AI sourced');
  }
  return props;
}

// ---------- query helpers ----------

async function findByUrl(url) {
  if (!url) return null;
  const data = await notionFetch('POST', `databases/${DATABASE_ID}/query`, {
    filter: { property: 'Apply URL', url: { equals: url } },
    page_size: 1,
  });
  return data.results?.[0] || null;
}

async function queryByStatus(statusName, { pageSize = 100 } = {}) {
  const out = [];
  let cursor;
  do {
    const body = {
      filter: { property: '状态', select: { equals: statusName } },
      page_size: pageSize,
    };
    if (cursor) body.start_cursor = cursor;
    const data = await notionFetch('POST', `databases/${DATABASE_ID}/query`, body);
    for (const row of data.results || []) {
      const p = row.properties || {};
      out.push({
        page_id: row.id,
        company: readTitle(p['公司']),
        role: readRichText(p['岗位']),
        url: readUrl(p['Apply URL']),
        ats: readSelect(p['ATS 平台']),
        fit_score: readNumber(p['fit_score']),
        location: readRichText(p['城市']),
        status: readSelect(p['状态']),
      });
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return out;
}

// ---------- public API ----------

export async function upsertJob(jobScored, _opts = {}) {
  try {
    if (!jobScored || !jobScored.url) {
      return { ok: false, error: 'jobScored.url required for upsert' };
    }
    const existing = await findByUrl(jobScored.url);
    if (existing) {
      const props = buildProperties(jobScored, { forCreate: false });
      // Don't clobber 状态 on existing rows — preserve 用户's manual edits
      // (e.g. ✅ Approved, ✅ 已投, ⚠️ 跳过未投).
      delete props['状态'];
      const updated = await notionFetch('PATCH', `pages/${existing.id}`, {
        properties: props,
      });
      return { ok: true, page_id: updated.id, created: false };
    }
    const props = buildProperties(jobScored, { forCreate: true });
    const created = await notionFetch('POST', 'pages', {
      parent: { database_id: DATABASE_ID },
      properties: props,
    });
    return { ok: true, page_id: created.id, created: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

export async function batchUpsert(jobs, opts = {}) {
  const { concurrency = 3, onProgress } = opts;
  const results = { created: 0, updated: 0, errors: [] };
  let cursor = 0;
  let done = 0;
  const total = jobs.length;

  async function worker() {
    while (cursor < jobs.length) {
      const idx = cursor++;
      const job = jobs[idx];
      const r = await upsertJob(job);
      if (r.ok) {
        if (r.created) results.created++;
        else results.updated++;
      } else {
        results.errors.push({
          index: idx,
          company: job?.company,
          url: job?.url,
          error: r.error,
        });
      }
      done++;
      if (onProgress) {
        try {
          onProgress({ done, total, last: { ...r, index: idx } });
        } catch (_) {
          /* ignore onProgress errors */
        }
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, jobs.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function markApplied(pageId, info = {}) {
  if (!pageId) return { ok: false, error: 'pageId required' };
  const props = {
    状态: selectProp('✅ 已投'),
    投递日期: dateProp(todayIso()),
    链接质量: selectProp('submitted'),
    来源: selectProp('ATS 直投'),
  };
  if (info.bot_note) props['Bot 备注'] = richTextProp(info.bot_note);
  if (info.confirmation_url) {
    // Stash confirmation URL inside Bot 备注 if no dedicated field, else append.
    const extra = info.bot_note
      ? `${info.bot_note}\nconfirmation: ${info.confirmation_url}`
      : `confirmation: ${info.confirmation_url}`;
    props['Bot 备注'] = richTextProp(extra);
  }
  try {
    const updated = await notionFetch('PATCH', `pages/${pageId}`, {
      properties: props,
    });
    return { ok: true, page_id: updated.id };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

export async function markConfirmed(pageId, info = {}) {
  if (!pageId) return { ok: false, error: 'pageId required' };
  const props = {
    状态: selectProp('✅ 已确认'),
  };
  if (info.confirmed_at) props['confirmed_at'] = dateProp(info.confirmed_at);
  else props['confirmed_at'] = dateProp(todayIso());
  if (info.email_id) props['confirmation_email_id'] = richTextProp(info.email_id);
  try {
    const updated = await notionFetch('PATCH', `pages/${pageId}`, { properties: props });
    return { ok: true, page_id: updated.id };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

// Query rows recently marked "✅ 已投" (last N days) for confirmation matching.
export async function queryRecentlyApplied(days = 14) {
  const sinceIso = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const result = await notionFetch('POST', `databases/${DATABASE_ID}/query`, {
    filter: {
      and: [
        { property: '状态', select: { equals: '✅ 已投' } },
        { property: '投递日期', date: { on_or_after: sinceIso } },
      ],
    },
    page_size: 100,
  });
  return (result.results || []).map((row) => ({
    page_id: row.id,
    company: row.properties?.['公司']?.title?.[0]?.plain_text || '',
    title: row.properties?.['岗位']?.rich_text?.[0]?.plain_text || row.properties?.['职位']?.rich_text?.[0]?.plain_text || '',
    apply_url: row.properties?.['Apply URL']?.url || '',
    submitted_at: row.properties?.['投递日期']?.date?.start || null,
  }));
}

export async function markSkipped(pageId, reason, userNote = '') {
  if (!pageId) return { ok: false, error: 'pageId required' };
  const props = {
    状态: selectProp('⚠️ 跳过未投'),
  };
  if (reason) props['skip_reason'] = selectProp(reason);
  if (userNote) props['user_note'] = richTextProp(userNote);
  try {
    const updated = await notionFetch('PATCH', `pages/${pageId}`, {
      properties: props,
    });
    return { ok: true, page_id: updated.id };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

export async function queryApprovedView(_opts = {}) {
  return queryByStatus('✅ Approved');
}

export async function queryAiSourcedPending(_opts = {}) {
  return queryByStatus('🤖 AI sourced');
}

// ---------- CLI entrypoint (sanity ping) ----------

const isCli =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('notion_sync.mjs');

if (isCli) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'ping') {
      const data = await notionFetch('GET', `databases/${DATABASE_ID}`);
      console.log(JSON.stringify({ ok: true, title: data?.title?.[0]?.plain_text || '(untitled)', id: data?.id }, null, 2));
    } else if (cmd === 'approved') {
      const rows = await queryApprovedView();
      console.log(JSON.stringify(rows, null, 2));
    } else if (cmd === 'ai-sourced') {
      const rows = await queryAiSourcedPending();
      console.log(JSON.stringify(rows, null, 2));
    } else {
      console.error(
        'Usage: node notion_sync.mjs <ping|approved|ai-sourced>\n' +
          '  ping        — fetch DB metadata to verify auth + DB id\n' +
          '  approved    — list rows with 状态="✅ Approved"\n' +
          '  ai-sourced  — list rows with 状态="🤖 AI sourced"\n'
      );
      process.exit(1);
    }
  } catch (err) {
    console.error('ERROR:', err.message || err);
    process.exit(1);
  }
}
