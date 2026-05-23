# Changelog

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

[0.2.0]: https://github.com/glin23/ats-skills/releases/tag/v0.2.0
[0.1.0]: https://github.com/glin23/ats-skills/releases/tag/v0.1.0
