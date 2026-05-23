# ats-skills

> v0.7 (sourcing + dashboard + batch + feedback loop + Handshake beta + Workday config-driven). First dogfood: NiCE SDR + Cresta DS + Crusoe Motion Design (2026-05-23). v0.5 batch + feedback dogfooded. v0.6/v0.7 alpha — needs real-platform verification.

Claude Code skills for automating Greenhouse and Ashby application form filling on your own browser.

This is a personal learning tool. It is not a SaaS, not a recruiting product, and not a mass-application bot. It drives a real Chrome instance you control, fills in your standard answers from a local JSON file, and stops before submit so you can review every application yourself.

## What it does

- Two skills, one per ATS: `ats-greenhouse` and `ats-ashby`.
- Drives your real Chrome via the DevTools Protocol on port 9222, using a separate Chrome profile so your daily browser is not affected.
- Reads your personal info (name, email, phone, LinkedIn, work authorization, standard short answers) from `shared/profile.json`.
- Uploads your resume PDF, picks the obvious select-options, fills text fields, ticks the obvious yes/no widgets.
- Takes a pre-submit screenshot and hands control back to you. The skill never clicks the submit button on its own.

## What it does not do

- It does not submit. Submitting an application is always a manual action you take, after reviewing the form.
- It does not support Workday, Lever, Handshake, or LinkedIn Easy Apply. Form variance and platform policies make a single small implementation unreliable. Maybe later, maybe not.
- It does not batch apply. One URL, one filled form, one human review.
- It does not bypass any ATS anti-bot system. It uses a real browser with a real user profile. If a site blocks you, that is the site telling you to stop, and you should stop.
- It does not generate or rewrite resumes. You bring your own PDF.

## Requirements

- macOS. Linux and Windows are untested; the launcher script is macOS-specific (uses `open -na`).
- Node.js 24 or later. The CDP driver uses Node's built-in `WebSocket` global, available in 24+.
- Google Chrome installed at the default path (`/Applications/Google Chrome.app`).
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and working.
- A resume PDF somewhere on disk.

## Install

```bash
git clone https://github.com/glin23/ats-skills ~/.claude/skills/ats-skills
cd ~/.claude/skills/ats-skills
./setup.sh
```

`setup.sh` will:

1. Check your Node version (must be 24+).
2. Check Chrome is installed.
3. Copy `shared/profile.template.json` to `shared/profile.json` if it does not exist.
4. Tell you to edit `shared/profile.json` and point `resume_path` at your actual resume PDF.

After editing `profile.json`, launch the dedicated Chrome instance once to verify the CDP connection:

```bash
./shared/chrome-cdp-launcher.sh
```

This opens a separate Chrome window with debugging on port 9222 and a profile stored at `~/.ats-skills/chrome-profile`. Log into LinkedIn (and anything else you want autofilled by Chrome) inside this window. Your normal Chrome is untouched.

## Quick start

```bash
# First-time setup (once)
./setup.sh
# edit shared/profile.json with your info (including target_filters)
bash shared/chrome-cdp-launcher.sh
# log into your CV uploads / linkedin etc on the new Chrome window if needed

# Batch apply (each time)
# In Claude Code: "用 ats-skills 投待投队列" or "/ats-skills"
# Skill loads your Notion 「🔵 未投」queue → confirms once → applies all → marks Notion
```

```bash
# Sourcing (v0.3+)
export ANTHROPIC_API_KEY=sk-ant-...
export NOTION_API_KEY=secret_...
# 在 Claude Code: "用 ats-source 找新岗位" → Notion 出 50 个 AI scored jobs
# 在 Notion DB 拖卡 approve / skip + reason
# 再说 "/ats-skills" → batch 投 Approved 全部
```

## Supported flows

| Flow | Trigger | Best for |
| --- | --- | --- |
| AI Sourcing (v0.3) | `/ats-source` or "找新岗位" | 一句话拉 50+ AI scored jobs 进 Notion |
| Batch Apply (v0.5) | `/ats-skills` or "投我的 Approved" | 跑完整 Approved 队列 + 自动 mark Notion + feedback loop |
| Single Greenhouse (v0.1) | `/ats-greenhouse <url>` | 1-off Greenhouse |
| Single Ashby (v0.1) | `/ats-ashby <url>` | 1-off Ashby |
| Single Handshake (v0.6 beta) | `/ats-handshake <url>` | 1-off Handshake (beta) |
| Single Workday (v0.7 stretch) | `/ats-workday <url>` | 1-off Workday with per-company config |

## Configurable Filters (profile.json `target_filters`)

v0.3+ profile.json has a `target_filters` block that the AI scorer and batch orchestrator both read:

- `role_types` — e.g. `["intern", "new_grad_FT"]`. Anything else gets scored down or filtered out.
- `locations` — e.g. `["US", "Remote-US"]`. JD locations outside this list are penalized.
- `exclude_keywords` — e.g. `["SWE", "Software Engineer", "Sales Engineer"]`. Title or description hits get filtered.
- `min_fit_score` — integer 0-10. Below this, the row is skipped before AI sync to Notion.
- `visa_must_sponsor` — boolean. If true, JD without sponsorship language gets down-ranked.

## Notion Setup

```
v0.3+ requires writing to your Notion 「📋 岗位追踪」 DB.
First-time setup:
1. Create Notion integration → get NOTION_API_KEY
2. Share your job tracking DB with the integration
3. Add these properties (matching ats-skills schema):
   - fit_score (NUMBER)
   - key_gaps (TEXT)
   - role_type_match (SELECT: intern / new_grad_FT / other)
   - skip_reason (SELECT: Wrong Role / Wrong Location / No Sponsor / Salary / Other)
   - user_note (TEXT)
   - dim_scores (TEXT, JSON-encoded)
4. Add to 「状态」 SELECT: "🤖 AI sourced" and "✅ Approved" options
```

## Queue source

In v0.2 batch mode, the queue is auto-loaded from your Notion 「🔵 未投」 view, filtered to `alive_exact` rows whose ATS is Greenhouse or Ashby. You can also hand the skill an explicit list of URLs instead — it will skip the Notion load and just iterate over what you gave it.

## Use

In Claude Code, paste the apply URL:

> Use ats-greenhouse to fill in this application: https://boards.greenhouse.io/example/jobs/12345

The skill will:

1. Check Chrome is running with CDP 9222 open (and launch it if not).
2. Navigate to the URL.
3. Fill the form from `profile.json`.
4. Upload the resume PDF.
5. Take a pre-submit screenshot.
6. Stop and show you the screenshot.

You then either submit manually in the browser, or ask Claude Code to submit. The skill will not submit unless you give explicit per-application authorization.

### Submit behavior

- Single-URL skills (`/ats-greenhouse`, `/ats-ashby`): explicit per-application authorization. The skill stops at the pre-submit screenshot and waits for you to say go on that specific application.
- Batch skill (`/ats-skills`, v0.2): **upfront authorization**. The skill prints the queue and waits for your "go" once. That single explicit confirmation is what Claude Code's safety classifier checks against — every URL in the batch counts as per-application authorized. If a submit is blocked, the skill aborts and you can fall back to `/ats-greenhouse` / `/ats-ashby` for one URL at a time.

## Supported ATS

| ATS | Status | Notes |
| --- | --- | --- |
| Greenhouse | Working | react-select v5 pickers require `mousedown` event dispatch, handled in `shared/greenhouse_helpers.js`. |
| Ashby | Working | react-hook-form text fields require real keyboard input via CDP `Input.insertText`. Yes/No buttons use a single `click()`. Handled in `shared/ashby_helpers.js`. |
| Workday | Not supported | Form variance is too high to cover with a single script. |
| Lever | Not supported | The CDP file-upload path hit a 50MB bug during testing. |
| Handshake | Not supported | No working implementation. |
| LinkedIn Easy Apply | Will not be supported | Out of scope. |

## Layout

```
ats-skills/
  README.md
  LICENSE
  DISCLAIMER.md
  setup.sh
  shared/
    cdp.mjs                  # Node 24 WebSocket CDP driver
    chrome-cdp-launcher.sh   # Launches isolated Chrome with CDP 9222
    greenhouse_helpers.js    # In-page helpers for Greenhouse forms
    ashby_helpers.js         # In-page helpers for Ashby forms
    profile.template.json    # Schema for your profile data
    profile.json             # Created by setup.sh, gitignored
  .claude/skills/
    ats-greenhouse/SKILL.md
    ats-ashby/SKILL.md
  examples/
    walkthrough.md
```

## Disclaimer

See [DISCLAIMER.md](DISCLAIMER.md). Short version: this is a tool for your own job search. You are responsible for following the ATS platforms' terms of service. If a platform asks you to stop, stop.

## Contributing

Issues and PRs welcome, especially:

- Fixes when an ATS frontend changes and a helper breaks.
- New profile fields that appear on real applications and are missing from the schema.
- Documentation improvements.

Not accepted:

- Feature requests that turn this into a batch-application tool.
- Anything that auto-submits without per-application user authorization.
- Paid hosting, "as a service" wrappers, or anything that takes money for using this.

If you fork this and run a service on top of it, please give it a different name.

## Roadmap

- v0.3 ✓ Sourcing + AI matching
- v0.5 ✓ Batch + feedback loop
- v0.6 (alpha) Handshake support
- v0.7 (stretch) Workday config-driven, per-company JSON adapter
- v1.0 GitHub public release; CDP + Computer Use hybrid stable

## License

MIT. See [LICENSE](LICENSE).
