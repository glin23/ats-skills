// paths.mjs — central path / config resolver for mrweirdo-jobs.
// Node 24+. Zero deps.
//
// Layout (after `/mrweirdo-onboard`):
//   $HOME/.mrweirdo-jobs/
//   ├── .env                # optional local integration keys (for mirrors/migrations)
//   ├── profile.json        # user's resume-derived profile + target_filters
//   ├── jobs.db             # v1.1+ SQLite state (primary)
//   ├── config.json         # v0.9 era Notion config (deprecated)
//   ├── source_cursor.json  # local discovery cursor; advances after each run
//   ├── company_list.user.json  # optional user-specific company increments
//   ├── feedback.jsonl      # per-apply outcome log
//   ├── quota.jsonl         # large-company submission counter
//   ├── log/                # per-skill jsonl logs
//   └── repo/               # git clone of mrweirdo-jobs repo
//
// All `shared/*.mjs` should import from this module instead of hard-coding paths.
// SKILL.md files set `MRWEIRDO_HOME` + `MRWEIRDO_REPO_ROOT` env and pass via process.env.
// Each SKILL.md bash block runs in its OWN shell, so every block that needs the repo
// root must re-export both vars itself (`${VAR:-default}` form) before `cd`-ing —
// exporting once at the top of the file does NOT carry over to the next block.

import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// repo root = parent of /shared
export const repoRoot = () => process.env.MRWEIRDO_REPO_ROOT || resolve(__dirname, '..');

// user state dir
//
// A skill is installed and run by one local user. All state is local to that
// install unless the caller explicitly overrides MRWEIRDO_HOME for testing.
export const atsHome = () => process.env.MRWEIRDO_HOME || join(homedir(), '.mrweirdo-jobs');

// profile.json — user-owned runtime profile. Never fall back to repo-local data.
export const profilePath = () => join(atsHome(), 'profile.json');

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
      `profile.json not found at ${p}. Run /mrweirdo-onboard to create it.`
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

// company_list — optional user-owned quota/config overlay.
// There is deliberately no bundled default company list in the local-skill path.
// Returns { _notes, companies: [...] } matching the on-disk schema.
export const loadCompanyList = () => {
  const userListPath = join(atsHome(), 'company_list.user.json');
  if (!existsSync(userListPath)) {
    return {
      _notes: 'No user company list found. Create company_list.user.json to add per-company quotas or preferences.',
      companies: [],
    };
  }
  let user;
  try {
    user = JSON.parse(readFileSync(userListPath, 'utf8'));
  } catch {
    return {
      _notes: `Could not parse ${userListPath}; ignoring user company list.`,
      _user_overlay_path: userListPath,
      companies: [],
    };
  }
  // Accept user file as either {companies: [...]} or bare [...]
  const userCompanies = Array.isArray(user) ? user : (user.companies || []);
  const byName = new Map();
  for (const c of userCompanies) {
    if (!c?.name) continue;
    const k = c.name.toLowerCase();
    byName.set(k, { ...c });
  }
  return {
    _notes: user._notes || 'User-owned company list. Not shared and not loaded by default from the repo.',
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
    null
  );
};

export const notionDataSourceId = () => {
  loadEnv();
  return (
    process.env.NOTION_JOB_DATA_SOURCE_ID ||
    loadConfig().notion_data_source_id ||
    null
  );
};

export const notionViewId = (viewName) => {
  // viewName ∈ {'ai_sourced', 'approved', 'skipped', 'large_company'}
  const cfg = loadConfig();
  const fromConfig = cfg.views?.[viewName];
  if (fromConfig) return fromConfig;
  return null;
};
