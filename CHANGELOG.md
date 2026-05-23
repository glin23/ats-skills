# Changelog

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
