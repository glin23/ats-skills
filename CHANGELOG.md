# Changelog

## [2.1.4] - 2026-05-27 — Duplicate guard and Greenhouse postmortem fixes

This patch is a direct response to the first public-beta-style 10-row
apply run, which produced 1 verified submission and exposed repeat
queueing plus several Greenhouse form gaps.

### Added
- `shared/dedupe_jobs.mjs`, an idempotent jobs.db guard that marks
  duplicate pending rows as skipped by normalized company + title before
  the auto-apply queue is selected.
- Feedback-table audit rows for duplicate skips so repeat prevention is
  visible in local history.

### Fixed
- `/mrweirdo-onboard` Step 10 now runs the duplicate guard before queue
  selection, enforces the fit≥7 threshold at queue time, and ranks only
  one row per company/title fingerprint.
- Greenhouse success detection now accepts `/confirmation` pages with
  Greenhouse's "Thank you for your interest / next steps email" copy,
  which prevents real confirmations from being misclassified as
  `no_errors_no_success`.
- Greenhouse custom-field handling now covers common school, degree,
  major/discipline, project/portfolio URL, employer/title, graduation
  date, and earliest-start-date fields.
- Greenhouse location-specific questions are more conservative: the
  driver no longer answers city-specific onsite/relocation/enrollment
  questions when the city is outside the user's profile/search intent.

### Field notes
- The 10-row run had one verified submission (`attentive` row 432).
  Most failures were not caused by CDP itself; they clustered around
  unsupported custom questions, non-standard Greenhouse landing pages
  with no file input, and location/profile-specific requirements.

## [2.1.3] - 2026-05-27 — Public beta readiness pass

This release tightens the first-user path so the project can be tested
by real students without immediately falling into avoidable setup or
risk-boundary failures.

### Added
- `shared/doctor.mjs`, a local install/runtime readiness checker for
  Node 24, git, Chrome, Skill links, user-state files, and optional
  Chrome CDP connectivity.
- `/mrweirdo-doctor`, a non-submitting Skill wrapper around the doctor
  script for users who ask "can I use it now?" or need install help.
- Codex UI metadata (`agents/openai.yaml`) for the main onboard and
  doctor skills.

### Changed
- `setup.sh` now runs the install doctor and tells first-time users to
  start the dedicated Chrome CDP window before onboarding.
- `/mrweirdo-onboard` now launches Chrome CDP when missing, runs the
  doctor pre-flight, and gives a clearer recovery path.
- Chrome CDP tooling now supports alternate ports via `ATS_CDP_PORT`
  and records the active host in `~/.mrweirdo-jobs/cdp_host`; the CDP
  CLI and drivers read that host automatically.
- `shared/chrome-cdp-launcher.sh` now falls back to launching the Chrome
  binary directly if macOS `open -na` fails.
- Public beta auto-submit is capped at 10 rows per run by default.
  Maintainers can raise it deliberately with `MRWEIRDO_MAX_AUTO_APPLY`.
- Lever remains discoverable/scored but is excluded from stable batch
  auto-submit until the CDP upload issue is fixed.
- Discovery audit fields now preserve each row's real source instead of
  labeling every job as `remoteok`.
- README and DISCLAIMER now align on sources, timing, caps, Lever
  stability, and the optional nature of Notion.

## [2.1.2] - 2026-05-27 — Productize Skill packaging for Claude Code + Codex

This release starts turning the repo from Lee's personal job agent into
a cleaner, installable Skill collection for both Claude Code and Codex.

### Changed
- `setup.sh` now links the tracked `.claude/skills/*` source into
  Claude Code (`~/.claude/skills`), Codex user skills
  (`~/.codex/skills`), and a generated workspace-local
  `.agents/skills` mirror for Codex desktop.
- `.agents/` is now explicitly gitignored and treated as generated
  compatibility output rather than a second source of truth.
- `setup.sh` symlink collision handling is conservative by default:
  existing links/files are skipped unless `MRWEIRDO_FORCE_LINK=1` is set.
- README positioning now reflects v2.1.1 field reality: Greenhouse/Ashby
  are the best-tested auto-submit path, Lever remains experimental, and
  SQLite is the source of truth while Notion is an optional review mirror.
- Skill docs use more host-neutral wording ("main agent session") and
  clarify the onboarding contract: resume + questionnaire + parse
  confirmation first, then no per-application approval for supported
  auto-submit rows.

### Notes
- The canonical tracked Skill source is still `.claude/skills/*`.
  A future refactor can move it to `skills/*` and make both `.claude`
  and `.agents` pure symlink mirrors.

## [2.1.1] - 2026-05-26 — Directive ack cracked, GH Country verified, essay loop proved

Field follow-up to v2.1.0. This release turns the highest-leverage
unknowns from the handoff into verified behavior: Directive's ack widget
is no longer blocking, Cloudflare's Greenhouse Country select submitted
successfully, and the main-Claude-in-loop essay path processed real
pending rows to submission.

### Field results
- Directive Ashby rows `304-311` moved from
  `directive_still_blocked_after_essay_fill` to `✅ 已投`.
- Cloudflare Greenhouse row `247` submitted successfully; the Country
  sync-select path is verified in the field.
- Six Ashby `essay_pending` rows submitted after main-Claude-authored
  answers were added to the answer bank: `166`, `235`, `345`, `682`,
  `716`, `719`.

### Added
- New answer-bank templates for Base Power-style "good fit", N1, Ready,
  Julius, Blumen GIS, and Chai essay prompts.
- Work-term availability preferences in `shared/answer_bank.json`.

### Fixed
- Directive's "Please confirm..." ack is handled as a single-option
  radio, not as an Ashby Yes/No hidden-checkbox widget.
- Ashby native radio/checkbox choices now use the browser's native
  `checked` setter plus `input`/`change` events, which fixed Chai and
  Julius radio state not sticking in React.
- Ashby location, LinkedIn, portfolio/website, university, degree,
  graduation date, and start-date text fields use the smallest matching
  question container instead of accidentally climbing to the whole form.
- Ashby sponsorship wording is split: current internship work
  authorization can answer "no employer sponsorship" while explicit
  "now or in the future" sponsorship questions still answer truthfully.
- Greenhouse Cloudflare custom fields now cover Country sync-select,
  relocation wording, graduation date, full-time offer timing, and the
  privacy checkbox.

### Known limitations
- Base Power row `122` still needs a specific date-picker/auth-combobox
  fix. The correct auth choice is CPT/OPT, not the first option containing
  "Yes" ("U.S. citizen or permanent resident").
- The essay consumer is proven as a main-Claude-in-loop workflow via
  `answer_bank.json` + driver reruns, but not yet packaged as its own
  standalone CLI/skill.

## [2.1.0] - 2026-05-26 — Submit-error-driven drivers, 80% Ashby success in field

The big shift in v2.1 is architectural: instead of pre-emptively filling
every field before clicking Submit (v2.0's `fillForm` model), the new
drivers fill what they can, hit Submit, parse the form's own validation
errors, look up answers in an externalized JSON bank, and retry. This
turned out to be far more resilient to per-tenant form variance.

Field test today (2026-05-26): 23 Ashby submissions in one session via
the new driver, 1 GH submission via its GH sibling. ~80% Ashby success
rate; the failures clustered on a single ack-widget pattern (see Known
limitations) rather than scattering across form shapes.

### Added
- `shared/ashby_apply_driver.mjs` — submit-error-driven Ashby form
  driver. Submits → parses validation errors → looks up answers in
  `shared/answer_bank.json` → retries. Up to 4 retry rounds. Closes
  the tab on submit/skip. 80% success rate in today's field test
  (23/29 Ashby URLs landed; 6 skipped with explicit `skip_reason`).
- `shared/greenhouse_apply_driver.mjs` — GH equivalent. Same retry
  loop, plus react-select handling for Country + Location combobox.
  Newer than the Ashby driver, less battle-tested (1 submit so far).
- `shared/answer_bank.json` — externalized answer templates: 7 essay
  patterns, Yes/No defaults, multichoice prefs. Users edit this file
  directly; no code change needed when form shapes drift.
- `Ashby.clickAckWidget()` in `shared/ashby_helpers.js` — 5-strategy
  fallback for stubborn Yes/No widgets that ignore `.click()`. The
  React-native-setter approach (Strategy 4 — finds the hidden
  `<input type="checkbox">`, calls the native value setter, dispatches
  `change`) is what cracks most of them.
- `--list-pending-essays` CLI mode on `ashby_apply_driver.mjs`. Outputs
  unique pending essay questions across the queue so a future
  main-Claude-in-loop session can batch-author the answers.

### Fixed
- React-select Location combobox now reliably opens via
  `MouseEvent("mousedown", {button: 0, buttons: 1, clientX, clientY})`.
  Plain `.click()` silently failed on the async Google Places picker.
  Reference impl: `reactSelect()` in `greenhouse_apply_driver.mjs`.
- UUID id selectors (e.g. `72b55bca-...`) now use the
  `[id="..."]` attribute selector instead of `#<id>`. Naked `#<id>`
  is invalid CSS when the id starts with a digit. The driver + helper
  modules both handle this — we learned the same lesson twice; do not
  un-fix it.
- File upload race: React unmounts `#resume` immediately after
  `setFileInputFiles` completes. The driver no longer tries to
  re-access the element on the verify step; it checks body text
  instead.
- Driver tabs are now closed on submit/skip. v2.0 was leaking ~18
  stale tabs per batch.
- Ashby Yes/No widget false-positive: `findEmptyRequired` no longer
  flags an `[uploaded]` resume input as required-empty. The check
  is now `el.type === 'file' ? el.files.length > 0 : !!el.value`.

### Changed
- `mrweirdo-onboard/SKILL.md`: removed the `daily_apply_cap: 50`
  blanket cap. Per-company quota (`quota_guard_enabled`) is the only
  rate limit now. Step 9 of the skill is informational rather than
  gating. Users hitting a personal pace limit can cap manually.
- Essay handling is config-driven via `shared/answer_bank.json`
  instead of hardcoded in driver source.

### Known limitations (carry-over to v2.2)
- 8 directive-company variations: the ack-widget click does not
  register despite identical DOM classes to widgets that do work.
  `Ashby.clickAckWidget` Strategy 4 is the closest thing to a fix
  shipped; a separate agent is still investigating.
- Lever forms detect CDP `setFileInputFiles` and report a bogus
  "File exceeds 100MB" error on resumes that are visibly < 200 KB.
  No workaround yet. Drag-drop upload may sidestep it.
- GH `candidate-location` Google Places autocomplete occasionally
  returns 0 options on slow connections. Mitigated by a 3.5s wait,
  not eliminated.
- Forms requiring assets Lee does not currently have (GPA, SAT/ACT
  scores, 1-minute intro video, official transcript) are correctly
  skipped with an explicit `skip_reason`. Profile gap, not bug.

## [1.3.0] - 2026-05-25 — Full namespace migration off `ats`

Completes the v1.2.0 rebrand by moving the user state directory and all
env var names off `ats` entirely. No backward-compat shim — at v1.2.0 no
end-users had installed yet, so a clean break was safer than carrying
two namespaces forever.

### Renamed

- **User state dir**: `~/.ats-skills/` → `~/.mrweirdo-jobs/`
- **Env vars**:
  - `ATS_HOME` → `MRWEIRDO_HOME`
  - `ATS_REPO_ROOT` → `MRWEIRDO_REPO_ROOT`
  - `ATS_DB_PATH` → `MRWEIRDO_DB_PATH`
  - `ATS_SKILLS_REPO_URL` → `MRWEIRDO_REPO_URL`
  - `ATS_SKILLS_BRANCH` → `MRWEIRDO_BRANCH`
  - `ATS_CHROME_PROFILE` → `MRWEIRDO_CHROME_PROFILE`

### Files touched

- `setup.sh`: REPO_URL, all paths, all env refs
- `shared/paths.mjs`: home dir default + all env reads
- `shared/local_db.mjs` / `quota.mjs` / `feedback.mjs` / `computer_use_locator.mjs`
- `shared/chrome-cdp-launcher.sh`
- `shared/migrate_notion_to_local.mjs`
- `shared/onboarding/*.mjs`, `shared/sourcing/*.mjs`, `shared/matching/*.mjs`
- All 12 `.claude/skills/*/SKILL.md`
- `README.md` / `HANDOFF.md` / `DISCLAIMER.md` / `examples/*`

### Preserved (deliberately)

- `/tmp/ats-skills/` — transient scratch, not user state
- Internal function name `atsHome()` in `paths.mjs` — internal API used by
  6 other shared modules; renaming would just churn callers. The public
  surface (env vars + paths) is fully migrated; internal names left alone.
- Historical CHANGELOG entries (v0.x / v1.0 / v1.1) — keep their original
  paths and command names for accuracy.

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
