# Changelog

## [1.2.0] - 2026-05-25 — Rebrand to mrweirdo-jobs

Project rebranded from `ats-skills` to `mrweirdo-jobs` (用户's personal brand).
Everything works the same; the changes are user-facing names only.

### Renamed

- **GitHub repo**: `glin23/ats-skills` → `glin23/mrweirdo-jobs`
  (GitHub auto-redirects old URLs, but new clones / install commands should
  use the new URL).
- **Slash commands** (all 12 skills):
  - `/ats-skills` → `/mrweirdo-jobs` (batch orchestrator — same name as repo)
  - `/ats-init` → `/mrweirdo-init`
  - `/ats-source` → `/mrweirdo-source`
  - `/ats-confirm` → `/mrweirdo-confirm`
  - `/ats-greenhouse` → `/mrweirdo-greenhouse`
  - `/ats-ashby` → `/mrweirdo-ashby`
  - `/ats-lever` → `/mrweirdo-lever`
  - `/ats-smartrecruiters` → `/mrweirdo-smartrecruiters`
  - `/ats-icims` → `/mrweirdo-icims`
  - `/ats-jobvite` → `/mrweirdo-jobvite`
  - `/ats-handshake` → `/mrweirdo-handshake`
  - `/ats-workday` → `/mrweirdo-workday`
- `.claude/skills/ats-*/` directories renamed to `mrweirdo-*/`
- README.md, setup.sh, all SKILL.md frontmatter `name:` fields updated

### Unchanged (deliberately preserved for stability)

- **User data dir**: `~/.mrweirdo-jobs/` stays. Renaming would break existing
  installs and require migration scripts. The data location is internal
  implementation detail; users rarely cd into it.
- **Env vars**: `$MRWEIRDO_HOME`, `$MRWEIRDO_REPO_ROOT`, `MRWEIRDO_DB_PATH` stay.
- **Historical CHANGELOG entries** (v0.x, v1.0, v1.1): keep their original
  `/ats-X` references for historical accuracy. Those slash commands
  worked at the time of those releases.
- **Tags**: v1.0.0 / v1.0.1 / v1.1.0 / v1.1.1 stay as-is (immutable history).

### Install command

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/glin23/mrweirdo-jobs/main/setup.sh)
```

(The old `glin23/ats-skills` URL still 302-redirects to the new repo for
the next ~30 days per GitHub's policy, but new installs should use the
new URL.)

## [1.1.0] - 2026-05-24 — SQLite + Datasette, zero cloud

Replaces Notion as the job-tracking DB with local SQLite. New users no longer
need a Notion account, integration token, or any cloud setup.

### Added
- `shared/local_db.mjs` (~340 lines) — SQLite wrapper using Node 24+
  `node:sqlite`. Same API surface as `notion_sync.mjs` (upsertJob /
  batchUpsert / markApplied / markSkipped / markConfirmed /
  queryApprovedView / queryAiSourcedPending / queryRecentlyApplied) so
  swap is a one-line import change. Schema:
  - `jobs` table: 25+ columns matching v1.0 Notion schema
  - 5 SQL views: `v_ai_sourced` / `v_approved` / `v_submitted` / `v_skipped`
    / `v_large_company_pending` (auto-rendered as Datasette pages)
  - `feedback` table mirrors feedback.jsonl, queryable in Datasette
- Datasette as optional zero-config web UI (`pip install datasette &&
  datasette serve ~/.mrweirdo-jobs/jobs.db --open`).

### Changed
- `/ats-init` SKILL.md: dropped from 9 steps to 6 steps. No more Notion
  integration token, no more parent-page id, no more MCP-driven view
  creation, no more `config.json` writing. Just: API key → resume parse →
  4 questions → SQLite init.
- `/ats-source`, `/ats-skills`, `/ats-confirm` SKILL.md: switched
  `import(... /shared/notion_sync.mjs)` → `local_db.mjs` (one-line change
  per file). Pre-flight checks updated to verify `jobs.db` exists.
- `README.md`: rewritten for v1.1 — emphasizes "zero cloud", documents
  Datasette setup, drops Notion requirement from prerequisites.

### Deprecated (kept for compatibility)
- `shared/notion_sync.mjs` — retained as a Notion mirror tool for v1.0
  users with existing Notion DBs. Header notice now flags it as
  non-primary. Future migration script will let users export Notion → SQLite.
- `shared/onboarding/notion_setup.mjs` — same.

### Why this matters
v1.0 onboarding had 4 Notion-specific steps (build integration, share page,
get parent_page_id, MCP view creation). Each one was a friction point
where non-technical users could fail. v1.1 reduces install + onboarding
total time from ~15 min to ~5 min for a brand-new user, with stricter
privacy: job data never leaves the machine.

## [1.0.0] - 2026-05-24 — Open OSS, self-host

The project moves from "用户's private daily-driver" to "anyone can install + run."

### Added
- **`/ats-init`** skill — 9-step onboarding orchestrator. Collects API keys
  (writes `~/.mrweirdo-jobs/.env` chmod 600), parses resume PDF via Anthropic
  native PDF support, asks 4 questions to build target_filters, provisions a
  Notion 「📋 岗位追踪」 database with 20+ properties + 4 views, smoke-tests
  one Greenhouse fetch.
- **`/ats-confirm`** skill — Gmail confirmation loop. Reads threads labeled
  `applied-jobs` (user-built filter), Sonnet-parses each into
  {company, role, ats, is_confirmation}, matches to ✅ 已投 Notion rows,
  marks them ✅ 已确认. Uses the Anthropic-bundled
  `mcp__claude_ai_Gmail__*` MCP — never scans the full inbox.
- `shared/paths.mjs` — central path / config resolver. MRWEIRDO_HOME / MRWEIRDO_REPO_ROOT
  env, profilePath() / configPath() / loadProfile() / loadConfig() /
  loadCompanyList() / loadEnv() / notionDbId() / notionViewId(). All other
  modules + skills import from here.
- `shared/onboarding/resume_parser.mjs` — Anthropic native PDF → structured
  JSON (personal / education / work_authorization / demographics /
  experience_summary / skills / languages).
- `shared/onboarding/notion_setup.mjs` — Notion DB + full schema creator
  via REST API.
- `shared/config.template.json` — schema for `~/.mrweirdo-jobs/config.json`.
- `shared/notion_sync.mjs`: `markConfirmed(pageId, {confirmed_at, email_id})`
  + `queryRecentlyApplied(days=14)` helpers.

### Changed
- **`setup.sh`** is now a curl-pipe bootstrap:
  `bash <(curl -fsSL https://raw.githubusercontent.com/glin23/mrweirdo-jobs/main/setup.sh)`.
  Clones to `~/.mrweirdo-jobs/repo`, symlinks `.claude/skills/*` into
  `~/.claude/skills/` so Claude Code globally picks them up, creates
  `~/.mrweirdo-jobs/{log,.env}`. Idempotent + re-runnable for updates.
- All `.claude/skills/*/SKILL.md` files: removed hardcoded
  `/Users/lee/Projects/ats-skills/` paths and `/Users/lee/Desktop/用户_Lin_Resume.pdf`
  resume path. New pattern:
  ```bash
  export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"
  export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
  PROFILE="$MRWEIRDO_HOME/profile.json"
  RESUME=$(jq -r .resume_path "$MRWEIRDO_HOME/config.json")
  ```
  Legacy `shared/profile.json` fallback retained so 用户's v0.9.1 setup keeps
  working unchanged.
- `shared/notion_sync.mjs:45` — DATABASE_ID now resolves through
  `paths.mjs.notionDbId()` (env → config.json → legacy default).
- `README.md` — rewritten for v1.0 audience. One-line install command.
  Per-skill descriptions. Privacy note. Gmail filter tutorial.

### Migration for existing users (用户)
用户's `v0.9.1` setup keeps working:
- If `~/.mrweirdo-jobs/profile.json` missing, code falls back to
  `<repo>/shared/profile.json`
- If `~/.mrweirdo-jobs/config.json` missing, hardcoded Notion DB id 94b728d7
  (用户's actual DB) is used as fallback
- All view IDs default to 用户's existing 36a1e8ce-prefixed ids

To migrate to the v1.0 path layout: run `/ats-init` (it preserves nothing —
generates fresh config + profile). Or copy `~/Projects/ats-skills/shared/profile.json`
to `~/.mrweirdo-jobs/profile.json` and write a minimal `~/.mrweirdo-jobs/config.json`
with `notion_db_id` + `resume_path`.

## [0.7.0] - 2026-05-23 (stretch, untested)

### Added
- Workday platform support (per-company config-driven adapter)
- `.claude/skills/ats-workday/SKILL.md`
- `shared/workday/workday_helpers.js` (generic Workday DOM operations)
- `shared/workday/_template.json` + 5 placeholder company configs
- "How to add a new company" PR guide in SKILL.md

### Known limitations
- v0.7 ships scaffolding only — no real company config verified
- Tenant variant problem solved by per-company configs, NOT generic generalization
- Multi-step wizard handling needs dogfood iteration

## [0.6.0] - 2026-05-23 (beta, untested)

### Added
- Handshake platform support (best-guess helpers based on web research)
- `.claude/skills/ats-handshake/SKILL.md`
- `shared/handshake_helpers.js`
- `shared/sourcing/handshake_search.mjs` (stub — needs implementation)
- Auto-detect redirect to external ATS (Greenhouse/Ashby/Workday)

### Known limitations
- v0.6 helpers are best-guess; field selectors will need adjustment after first real submission
- Sourcing stub not implemented

## [0.5.0] - 2026-05-23

### Added
- v0.5 batch orchestrator upgrade:
  - Queue source = Notion "✅ Approved (Ready to Apply)" view
  - URL-based ATS dispatch (regex → ats-greenhouse / ats-ashby helper)
  - feedback.jsonl write on success+fail (~/.mrweirdo-jobs/feedback.jsonl)
  - Computer Use visual fallback via computer_use_locator.mjs (vision-based element ID when CDP selector fails)
- `shared/feedback.mjs` — load/append/format ~/.mrweirdo-jobs/feedback.jsonl
- `shared/patterns.mjs` — analyze skip patterns + suggest profile updates (借鉴 Career-Ops patterns skill)
- `shared/computer_use_locator.mjs` — vision fallback coordinator + JSONL telemetry

### Changed
- Submit success now writes to feedback.jsonl in addition to Notion mark
- v0.5 dashboard shows top-3 skip patterns from feedback summary

## [0.3.0] - 2026-05-23

### Added
- AI sourcing pipeline `/ats-source` skill:
  - Greenhouse Job Board API client (`shared/sourcing/greenhouse_board_api.mjs`)
  - Ashby Job Board API client (`shared/sourcing/ashby_board_api.mjs`)
  - Seed company list with 16 entries (`shared/sourcing/company_list.json`)
- AI scoring with multi-dim output (`shared/matching/ai_scorer.mjs` + `prompt_template.md`):
  - 6 dim_scores: role_fit / skills_match / location_fit / visa_compatible / seniority_match / exclude_check
  - Anthropic SDK via Node 24 built-in fetch (no SDK dep)
  - ~$0.003/job cost
  - Concurrency worker pool with retry + cost log
- Notion HTTP API client (`shared/notion_sync.mjs`):
  - upsertJob / batchUpsert / markApplied / markSkipped
  - queryApprovedView / queryAiSourcedPending
  - 3 req/sec throttle + 429/5xx retry
- Configurable filter schema (profile.template.json `target_filters`):
  - role_types / locations / exclude_keywords / min_fit_score / visa_must_sponsor
- v0.2 bug fixes:
  - Greenhouse `candidate-location` Google Places autocomplete: `prepareLocationCombobox` + `pickLocationOption` 2-step solution
  - Ashby `clickYesNo` verification false negative: wait+retry on _active_ class
  - Ashby `findEmptyRequired` missing Current Location combobox: detect by placeholder + walker pattern

### Notes
- First v0.3 dogfood pending — verify AI sourcing top-10 with 用户's manual pick
- Cost: $0.15/week at 50 sourced jobs/week

## [0.2.0] - 2026-05-23

### Added
- Batch orchestrator skill `/ats-skills` (.claude/skills/ats-skills/SKILL.md)
  - Auto-loads queue from user's Notion 「🔵 未投」 view
  - Filters to alive Greenhouse + Ashby URLs
  - Single upfront authorization ("go") for the whole batch
  - Claude-driven field fallback for unrecognized required fields
  - Auto-marks Notion 「✅ 已投」 on success
  - Dashboard report with per-application status
- `GH.normalizeProfile()` / `Ashby.normalizeProfile()` — transforms nested profile.json to flat fillForm shape
- `GH.findEmptyRequired()` / `Ashby.findEmptyRequired()` — returns required-but-empty fields with labels for Claude reasoning
- `/tmp/ats-skills/log/<date>.jsonl` per-attempt log

### Fixed
- **pickOption 1.5s poll too short** — NiCE picker takes >600ms to render options after openPicker. Bumped to 3s + initial 200ms render wait.
- **Picker out-of-viewport** — React lazy-renders .select__option only when picker is visible. openPicker now scrollIntoView({block: 'center'}) first.
- **Schema mismatch** — profile.template.json was nested but fillForm expected flat. v0.2 normalizers bridge both.

### Notes
- First real dogfood: NiCE SDR Intern Sandy UT (Greenhouse), 2026-05-23. Submitted successfully; confirmation URL /nice/jobs/4754106101/confirmation; "Woohoo! We received your application!"

## [0.1.0] - 2026-05-23

### Added
- Initial release
- shared/cdp.mjs — Node 24 WebSocket CDP driver (zero-dep). Commands: tabs, goto, eval, upload, screenshot, typetext, cdp (raw).
- shared/chrome-cdp-launcher.sh — Dedicated Chrome instance via `open -na` with isolated ~/.mrweirdo-jobs/chrome-profile.
- shared/greenhouse_helpers.js — react-select v5 mousedown picker, iti country, custom_answers/picker_answers by label.
- shared/ashby_helpers.js — react-hook-form text via CDP typetext, Yes/No buttons, _systemfield combined name, date picker.
- .claude/skills/ats-greenhouse/SKILL.md + .claude/skills/ats-ashby/SKILL.md — per-ATS single-URL flows (kept in v0.2 as power-user shortcuts).
- README.md, LICENSE (MIT), DISCLAIMER.md, setup.sh, shared/profile.template.json.

### Not supported
- Workday (form variants too high; per-company breakage)
- Lever (no working code yet)
- Handshake (no working code yet)
- LinkedIn Easy Apply (TOS red line)

[0.7.0]: https://github.com/glin23/mrweirdo-jobs/releases/tag/v0.7.0
[0.6.0]: https://github.com/glin23/mrweirdo-jobs/releases/tag/v0.6.0
[0.5.0]: https://github.com/glin23/mrweirdo-jobs/releases/tag/v0.5.0
[0.3.0]: https://github.com/glin23/mrweirdo-jobs/releases/tag/v0.3.0
[0.2.0]: https://github.com/glin23/mrweirdo-jobs/releases/tag/v0.2.0
[0.1.0]: https://github.com/glin23/mrweirdo-jobs/releases/tag/v0.1.0
