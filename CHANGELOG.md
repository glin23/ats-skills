# Changelog

## [1.0.0] - 2026-05-24 — Open OSS, self-host

The project moves from "用户's private daily-driver" to "anyone can install + run."

### Added
- **`/ats-init`** skill — 9-step onboarding orchestrator. Collects API keys
  (writes `~/.ats-skills/.env` chmod 600), parses resume PDF via Anthropic
  native PDF support, asks 4 questions to build target_filters, provisions a
  Notion 「📋 岗位追踪」 database with 20+ properties + 4 views, smoke-tests
  one Greenhouse fetch.
- **`/ats-confirm`** skill — Gmail confirmation loop. Reads threads labeled
  `applied-jobs` (user-built filter), Sonnet-parses each into
  {company, role, ats, is_confirmation}, matches to ✅ 已投 Notion rows,
  marks them ✅ 已确认. Uses the Anthropic-bundled
  `mcp__claude_ai_Gmail__*` MCP — never scans the full inbox.
- `shared/paths.mjs` — central path / config resolver. ATS_HOME / ATS_REPO_ROOT
  env, profilePath() / configPath() / loadProfile() / loadConfig() /
  loadCompanyList() / loadEnv() / notionDbId() / notionViewId(). All other
  modules + skills import from here.
- `shared/onboarding/resume_parser.mjs` — Anthropic native PDF → structured
  JSON (personal / education / work_authorization / demographics /
  experience_summary / skills / languages).
- `shared/onboarding/notion_setup.mjs` — Notion DB + full schema creator
  via REST API.
- `shared/config.template.json` — schema for `~/.ats-skills/config.json`.
- `shared/notion_sync.mjs`: `markConfirmed(pageId, {confirmed_at, email_id})`
  + `queryRecentlyApplied(days=14)` helpers.

### Changed
- **`setup.sh`** is now a curl-pipe bootstrap:
  `bash <(curl -fsSL https://raw.githubusercontent.com/glin23/ats-skills/main/setup.sh)`.
  Clones to `~/.ats-skills/repo`, symlinks `.claude/skills/*` into
  `~/.claude/skills/` so Claude Code globally picks them up, creates
  `~/.ats-skills/{log,.env}`. Idempotent + re-runnable for updates.
- All `.claude/skills/*/SKILL.md` files: removed hardcoded
  `/Users/lee/Projects/ats-skills/` paths and `/Users/lee/Desktop/用户_Lin_Resume.pdf`
  resume path. New pattern:
  ```bash
  export ATS_HOME="${ATS_HOME:-$HOME/.ats-skills}"
  export ATS_REPO_ROOT="${ATS_REPO_ROOT:-$ATS_HOME/repo}"
  PROFILE="$ATS_HOME/profile.json"
  RESUME=$(jq -r .resume_path "$ATS_HOME/config.json")
  ```
  Legacy `shared/profile.json` fallback retained so 用户's v0.9.1 setup keeps
  working unchanged.
- `shared/notion_sync.mjs:45` — DATABASE_ID now resolves through
  `paths.mjs.notionDbId()` (env → config.json → legacy default).
- `README.md` — rewritten for v1.0 audience. One-line install command.
  Per-skill descriptions. Privacy note. Gmail filter tutorial.

### Migration for existing users (用户)
用户's `v0.9.1` setup keeps working:
- If `~/.ats-skills/profile.json` missing, code falls back to
  `<repo>/shared/profile.json`
- If `~/.ats-skills/config.json` missing, hardcoded Notion DB id 94b728d7
  (用户's actual DB) is used as fallback
- All view IDs default to 用户's existing 36a1e8ce-prefixed ids

To migrate to the v1.0 path layout: run `/ats-init` (it preserves nothing —
generates fresh config + profile). Or copy `~/Projects/ats-skills/shared/profile.json`
to `~/.ats-skills/profile.json` and write a minimal `~/.ats-skills/config.json`
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
  - feedback.jsonl write on success+fail (~/.ats-skills/feedback.jsonl)
  - Computer Use visual fallback via computer_use_locator.mjs (vision-based element ID when CDP selector fails)
- `shared/feedback.mjs` — load/append/format ~/.ats-skills/feedback.jsonl
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
- shared/chrome-cdp-launcher.sh — Dedicated Chrome instance via `open -na` with isolated ~/.ats-skills/chrome-profile.
- shared/greenhouse_helpers.js — react-select v5 mousedown picker, iti country, custom_answers/picker_answers by label.
- shared/ashby_helpers.js — react-hook-form text via CDP typetext, Yes/No buttons, _systemfield combined name, date picker.
- .claude/skills/ats-greenhouse/SKILL.md + .claude/skills/ats-ashby/SKILL.md — per-ATS single-URL flows (kept in v0.2 as power-user shortcuts).
- README.md, LICENSE (MIT), DISCLAIMER.md, setup.sh, shared/profile.template.json.

### Not supported
- Workday (form variants too high; per-company breakage)
- Lever (no working code yet)
- Handshake (no working code yet)
- LinkedIn Easy Apply (TOS red line)

[0.7.0]: https://github.com/glin23/ats-skills/releases/tag/v0.7.0
[0.6.0]: https://github.com/glin23/ats-skills/releases/tag/v0.6.0
[0.5.0]: https://github.com/glin23/ats-skills/releases/tag/v0.5.0
[0.3.0]: https://github.com/glin23/ats-skills/releases/tag/v0.3.0
[0.2.0]: https://github.com/glin23/ats-skills/releases/tag/v0.2.0
[0.1.0]: https://github.com/glin23/ats-skills/releases/tag/v0.1.0
