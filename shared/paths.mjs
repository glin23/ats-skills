// paths.mjs — central path / config resolver for mrweirdo-jobs (v1.0+ multi-tenant)
// Node 24+. Zero deps.
//
// Layout (after `/mrweirdo-init`):
//   $HOME/.mrweirdo-jobs/
//   ├── .env                # ANTHROPIC_API_KEY (NOTION_API_KEY only for v0.9 era migrations)
//   ├── profile.json        # user's resume-derived profile + target_filters
//   ├── jobs.db             # v1.1+ SQLite state (primary)
//   ├── config.json         # v0.9 era Notion config (deprecated)
//   ├── company_list.user.json  # optional user-specific company increments
//   ├── feedback.jsonl      # per-apply outcome log
//   ├── quota.jsonl         # large-company submission counter
//   ├── log/                # per-skill jsonl logs
//   └── repo/               # git clone of mrweirdo-jobs repo
//
// All `shared/*.mjs` should import from this module instead of hard-coding paths.
// SKILL.md files set `MRWEIRDO_HOME` + `MRWEIRDO_REPO_ROOT` env at top and pass via process.env.

import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// repo root = parent of /shared
export const repoRoot = () => process.env.MRWEIRDO_REPO_ROOT || resolve(__dirname, '..');

// user state dir
export const atsHome = () => process.env.MRWEIRDO_HOME || join(homedir(), '.mrweirdo-jobs');

// profile.json — prefer ~/.mrweirdo-jobs/profile.json, fall back to in-repo (用户's legacy setup)
export const profilePath = () => {
  const userPath = join(atsHome(), 'profile.json');
  if (existsSync(userPath)) return userPath;
  const legacyPath = join(repoRoot(), 'shared', 'profile.json');
  return existsSync(legacyPath) ? legacyPath : userPath; // returns userPath even if missing — caller will error
};

// config.json — only lives in ~/.mrweirdo-jobs (no in-repo fallback)
export const configPath = () => join(atsHome(), 'config.json');

// resume PDF path comes from config.json.resume_path
export const resumePath = () => {
  const cfg = loadConfig();
  return cfg.resume_path || join(atsHome(), 'resume.pdf');
};

// ---------- loaders ----------

export const loadProfile = () => {
  const p = profilePath();
  if (!existsSync(p)) {
    throw new Error(
      `profile.json not found at ${p}. Run /mrweirdo-init to create it.`
    );
  }
  return JSON.parse(readFileSync(p, 'utf8'));
};

export const loadConfig = () => {
  const p = configPath();
  if (!existsSync(p)) {
    return {}; // empty config is OK — callers should env-fallback or error
  }
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to parse ${p}: ${e.message}`);
  }
};

// company_list — merge baseline (in-repo) with user increment (in ~/.mrweirdo-jobs)
// `user` entries override `baseline` by name (case-insensitive).
// Returns { _notes, companies: [...] } matching the on-disk schema.
export const loadCompanyList = () => {
  const baseline = JSON.parse(
    readFileSync(join(repoRoot(), 'shared', 'sourcing', 'company_list.json'), 'utf8')
  );
  const userListPath = join(atsHome(), 'company_list.user.json');
  if (!existsSync(userListPath)) return baseline;
  let user;
  try {
    user = JSON.parse(readFileSync(userListPath, 'utf8'));
  } catch {
    return baseline;
  }
  // Accept user file as either {companies: [...]} or bare [...]
  const userCompanies = Array.isArray(user) ? user : (user.companies || []);
  const byName = new Map((baseline.companies || []).map((c) => [c.name.toLowerCase(), c]));
  for (const c of userCompanies) {
    if (!c?.name) continue;
    const k = c.name.toLowerCase();
    byName.set(k, { ...(byName.get(k) || {}), ...c });
  }
  return {
    _notes: baseline._notes,
    _user_overlay_path: userListPath,
    companies: [...byName.values()],
  };
};

// ---------- env loader ----------
// Reads ~/.mrweirdo-jobs/.env (KEY=value, one per line) into process.env unless already set.
// Idempotent.
export const loadEnv = () => {
  const envPath = join(atsHome(), '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
};

// ---------- convenience for Notion config ----------

export const notionDbId = () => {
  loadEnv();
  return (
    process.env.NOTION_JOB_DB_ID ||
    loadConfig().notion_db_id ||
    '94b728d7-526d-4c9f-96f4-a8cb92c0f5fe' // 用户's legacy default — Phase 1 backwards-compat
  );
};

export const notionDataSourceId = () => {
  loadEnv();
  return (
    process.env.NOTION_JOB_DATA_SOURCE_ID ||
    loadConfig().notion_data_source_id ||
    '6995653c-4fab-4622-b174-d10892620ad8'
  );
};

export const notionViewId = (viewName) => {
  // viewName ∈ {'ai_sourced', 'approved', 'skipped', 'large_company'}
  const cfg = loadConfig();
  const fromConfig = cfg.views?.[viewName];
  if (fromConfig) return fromConfig;
  // Legacy fallback to 用户's known view IDs
  const legacy = {
    ai_sourced: '36a1e8ce-8185-8167-b7c7-000c46b5a2cc',
    approved: '36a1e8ce-8185-81f2-acf3-000c6672a718',
    skipped: '36a1e8ce-8185-8133-85df-000c2ecfd75a',
    large_company: '36a1e8ce-8185-814a-a067-000c6162b627',
  };
  return legacy[viewName] || null;
};
