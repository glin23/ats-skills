// quota.mjs — track large-company submission quota across sessions
// Append-only JSONL at ~/.ats-skills/quota.jsonl. Each line = one submission.
//
// Usage:
//   import { recordApply, getRemaining, isCapReached } from './quota.mjs';
//   await recordApply({ company: 'Google', apply_quota_limit: 3, apply_quota_period: 'semester' });
//   const left = await getRemaining({ company: 'Google', apply_quota_limit: 3, apply_quota_period: 'semester' });
//   if (await isCapReached(company)) { /* block batch */ }

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { atsHome } from './paths.mjs';

const quotaPath = () => join(atsHome(), 'quota.jsonl');

function ensureFile() {
  const dir = atsHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadAll() {
  const p = quotaPath();
  if (!existsSync(p)) return [];
  const text = readFileSync(p, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// Period boundary — start of current semester / year / forever.
// Semester = approximate: Aug-Dec = fall, Jan-May = spring. Returns ISO start date.
function periodStart(period, now = new Date()) {
  if (period === 'lifetime') return new Date(0).toISOString();
  if (period === 'year') {
    return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();
  }
  if (period === 'semester') {
    const m = now.getUTCMonth(); // 0=Jan, 11=Dec
    const y = now.getUTCFullYear();
    if (m >= 7) {
      // Fall: Aug 1 to Dec 31
      return new Date(Date.UTC(y, 7, 1)).toISOString();
    } else if (m <= 4) {
      // Spring: Jan 1 to May 31
      return new Date(Date.UTC(y, 0, 1)).toISOString();
    } else {
      // Summer (Jun-Jul): roll back to spring start to avoid edge case
      return new Date(Date.UTC(y, 0, 1)).toISOString();
    }
  }
  // Default to year for unknown
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();
}

export async function recordApply({ company, apply_quota_limit, apply_quota_period, apply_url, role_title }) {
  ensureFile();
  const entry = {
    ts: new Date().toISOString(),
    company,
    apply_quota_limit: apply_quota_limit ?? null,
    apply_quota_period: apply_quota_period ?? null,
    apply_url: apply_url ?? null,
    role_title: role_title ?? null,
  };
  appendFileSync(quotaPath(), JSON.stringify(entry) + '\n');
  return entry;
}

export async function getRemaining({ company, apply_quota_limit, apply_quota_period }) {
  if (!apply_quota_limit || apply_quota_limit <= 0) {
    return { unlimited: true };
  }
  const all = loadAll();
  const since = periodStart(apply_quota_period || 'semester');
  const used = all.filter(
    (e) => e.company?.toLowerCase() === company.toLowerCase() && e.ts >= since
  ).length;
  return {
    company,
    period: apply_quota_period || 'semester',
    period_start: since,
    limit: apply_quota_limit,
    used,
    remaining: Math.max(0, apply_quota_limit - used),
    cap_reached: used >= apply_quota_limit,
  };
}

export async function isCapReached(companyEntry) {
  const r = await getRemaining({
    company: companyEntry.name || companyEntry.company,
    apply_quota_limit: companyEntry.apply_quota_limit ?? companyEntry.apply_quota,
    apply_quota_period: companyEntry.apply_quota_period,
  });
  return !!r.cap_reached;
}

export async function summary() {
  const all = loadAll();
  const byCompany = new Map();
  for (const e of all) {
    const key = e.company?.toLowerCase() || '(unknown)';
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(e);
  }
  return [...byCompany.entries()].map(([company, entries]) => ({
    company,
    total_submissions: entries.length,
    most_recent: entries[entries.length - 1]?.ts,
  }));
}

// ---------- CLI ----------
const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'summary') {
      console.log(JSON.stringify(await summary(), null, 2));
    } else if (cmd === 'remaining') {
      const company = process.argv[3];
      const limit = parseInt(process.argv[4] || '3', 10);
      const period = process.argv[5] || 'semester';
      console.log(
        JSON.stringify(
          await getRemaining({ company, apply_quota_limit: limit, apply_quota_period: period }),
          null,
          2
        )
      );
    } else if (cmd === 'record') {
      const company = process.argv[3];
      const limit = parseInt(process.argv[4] || '3', 10);
      const period = process.argv[5] || 'semester';
      console.log(
        JSON.stringify(
          await recordApply({ company, apply_quota_limit: limit, apply_quota_period: period }),
          null,
          2
        )
      );
    } else {
      console.error(
        'Usage:\n' +
          '  node shared/quota.mjs summary\n' +
          '  node shared/quota.mjs remaining <company> [limit] [period]\n' +
          '  node shared/quota.mjs record <company> [limit] [period]\n'
      );
      process.exit(1);
    }
  } catch (e) {
    console.error('quota error:', e.message);
    process.exit(1);
  }
}
