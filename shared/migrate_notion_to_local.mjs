#!/usr/bin/env node
// migrate_notion_to_local.mjs — one-shot Notion → SQLite import.
// Useful for v1.0 users who have Notion 「📋 岗位追踪」 data and want to switch
// to v1.1's local SQLite jobs.db without losing history.
//
// Env required (loaded from ~/.mrweirdo-jobs/.env automatically):
//   NOTION_API_KEY        — integration token with read access to your DB
//   NOTION_JOB_DB_ID      — id of your job tracking DB (e.g. 94b728d7-...)
//
// Usage:
//   node --no-warnings shared/migrate_notion_to_local.mjs                 # dry-run (preview, no writes)
//   node --no-warnings shared/migrate_notion_to_local.mjs --apply         # write to jobs.db
//   node --no-warnings shared/migrate_notion_to_local.mjs --apply --reset # wipe jobs.db first
//
// Idempotent: re-running with --apply UPSERTs on apply_url so importing the
// same Notion DB twice doesn't dupe rows.

import { existsSync, unlinkSync } from 'node:fs';
import { loadEnv, atsHome } from './paths.mjs';
import { initDb, batchUpsert, summary, dbPath } from './local_db.mjs';

loadEnv();

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DB_ID = process.env.NOTION_JOB_DB_ID;
const NOTION_VERSION = '2022-06-28';
const API_BASE = 'https://api.notion.com/v1';

if (!NOTION_API_KEY) {
  console.error('Missing NOTION_API_KEY. Add it to ~/.mrweirdo-jobs/.env and re-run.');
  process.exit(1);
}
if (!NOTION_DB_ID) {
  console.error('Missing NOTION_JOB_DB_ID. Add it to ~/.mrweirdo-jobs/.env and re-run.');
  process.exit(1);
}

async function notionFetch(method, path, body) {
  const res = await fetch(`${API_BASE}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json();
  if (!res.ok) {
    throw new Error(`Notion ${method} /${path} ${res.status}: ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return payload;
}

async function fetchAllRows() {
  const rows = [];
  let cursor = undefined;
  let pageCount = 0;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const result = await notionFetch('POST', `databases/${NOTION_DB_ID}/query`, body);
    rows.push(...(result.results || []));
    cursor = result.has_more ? result.next_cursor : null;
    pageCount++;
    process.stderr.write(`  fetched page ${pageCount}, ${rows.length} rows so far\r`);
  } while (cursor);
  process.stderr.write('\n');
  return rows;
}

// Notion property → primitive value extractors
const pick = {
  title: (prop) => prop?.title?.[0]?.plain_text || prop?.title?.map((t) => t.plain_text).join('') || null,
  text: (prop) => prop?.rich_text?.[0]?.plain_text || prop?.rich_text?.map((t) => t.plain_text).join('') || null,
  url: (prop) => prop?.url || null,
  number: (prop) => (typeof prop?.number === 'number' ? prop.number : null),
  select: (prop) => prop?.select?.name || null,
  date: (prop) => prop?.date?.start || null,
};

function mapRow(notionRow) {
  const p = notionRow.properties || {};
  // Tolerant of slightly different property names across 用户's setup vs v1.0 schema
  const company = pick.title(p['公司']) || pick.title(p['Company']) || pick.title(p['company']);
  const apply_url = pick.url(p['Apply URL']) || pick.url(p['apply_url']) || pick.url(p['URL']);
  if (!company || !apply_url) return null;

  // dim_scores may be JSON string; try to parse for round-trip fidelity
  let dim = pick.text(p['dim_scores']) || pick.text(p['dim_scores ']);
  if (dim) {
    try {
      dim = JSON.parse(dim);
    } catch {
      /* keep as string — local_db will store it raw */
    }
  }

  return {
    company,
    title: pick.text(p['职位']) || pick.text(p['岗位']) || pick.text(p['title']) || pick.text(p['Title']),
    apply_url,
    location: pick.text(p['地点']) || pick.text(p['城市']) || pick.text(p['location']),
    source: pick.text(p['来源']) || pick.text(p['source']),
    status: pick.select(p['状态']) || pick.select(p['Status']) || null,
    fit_score: pick.number(p['fit_score']),
    key_gaps: pick.text(p['key_gaps']),
    role_type_match: pick.select(p['role_type_match']),
    skip_reason: pick.select(p['skip_reason']),
    user_note: pick.text(p['user_note']),
    dim_scores: dim,
    salary_min: pick.number(p['salary_min']),
    salary_max: pick.number(p['salary_max']),
    salary_currency: pick.select(p['salary_currency']),
    salary_interval: pick.select(p['salary_interval']),
    hourly_rate: pick.number(p['hourly_rate']),
    ats_platform: pick.select(p['ats 平台']) || pick.select(p['ats_platform']),
    apply_quota_limit: pick.number(p['apply_quota_limit']),
    apply_quota_period: pick.select(p['apply_quota_period']),
    apply_quota_note: pick.text(p['apply_quota_note']),
    submitted_at: pick.date(p['投递日期']) || pick.date(p['submitted_at']),
    confirmed_at: pick.date(p['confirmed_at']),
    confirmation_email_id: pick.text(p['confirmation_email_id']),
    bot_note: pick.text(p['Bot 备注']) || pick.text(p['bot_note']),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const reset = args.includes('--reset');

  console.log('=== Notion → SQLite migrator ===');
  console.log('  DB ID:    ', NOTION_DB_ID);
  console.log('  Target:   ', dbPath());
  console.log('  Mode:     ', apply ? (reset ? 'APPLY + RESET (drop existing rows)' : 'APPLY (upsert)') : 'DRY RUN');
  console.log('');

  if (reset && apply) {
    const p = dbPath();
    if (existsSync(p)) {
      console.log('  reset: removing', p);
      unlinkSync(p);
    }
  }

  console.log('  Fetching Notion rows...');
  const raw = await fetchAllRows();
  console.log(`  Got ${raw.length} Notion rows total`);

  const mapped = raw.map(mapRow).filter(Boolean);
  console.log(`  Mapped to ${mapped.length} valid jobs (skipped ${raw.length - mapped.length} rows missing company/url)`);

  if (!mapped.length) {
    console.log('  Nothing to import. Exiting.');
    return;
  }

  console.log('  Sample 3:');
  mapped.slice(0, 3).forEach((j, i) => {
    console.log(`    [${i + 1}] ${j.company} — ${j.title || '(no title)'} — status=${j.status || '(none)'} — fit=${j.fit_score ?? '-'}`);
  });

  if (!apply) {
    console.log('');
    console.log('  DRY RUN complete. Re-run with --apply to actually write to local jobs.db.');
    return;
  }

  // Real write
  initDb();
  const results = await batchUpsert(mapped);
  const created = results.filter((r) => r.ok && r.created).length;
  const updated = results.filter((r) => r.ok && !r.created).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log('');
  console.log(`  Upsert: ${created} created, ${updated} updated, ${failed} failed`);
  if (failed) {
    console.log('  Failures:');
    results.filter((r) => !r.ok).slice(0, 5).forEach((r) => console.log('   -', r.error));
  }
  console.log('');
  console.log('  Final summary:');
  console.log(JSON.stringify(summary(), null, 2));
}

main().catch((e) => {
  console.error('migrate error:', e.message);
  process.exit(1);
});
