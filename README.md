# mrweirdo-jobs

> **v1.1 — open OSS, self-host, zero cloud.** A Claude Code skill collection that turns job hunting into a single pipeline:
> AI sourcing → local SQLite dashboard (Datasette web UI) → batch auto-apply (hard pre-Submit human gate) → Gmail confirmation loop.
>
> Zero npm deps. Zero cloud DB. Driven by your own Chrome. Submits never happen without your explicit per-batch authorization.
> Multi-tenant: any user can install + bring their own resume, Anthropic API key. **No Notion / Airtable / Google account required.**

---

## Install (one command)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/glin23/mrweirdo-jobs/main/setup.sh)
```

This will:
1. Verify Node 24+, Chrome, git
2. Clone the repo to `~/.mrweirdo-jobs/repo`
3. Symlink `.claude/skills/*` into `~/.claude/skills/` so Claude Code picks them up
4. Create `~/.mrweirdo-jobs/{log,.env}` layout

Then open Claude Code (any directory) and run:

```
/mrweirdo-init
```

`/mrweirdo-init` walks you through:
- Anthropic API key (paste; written to `~/.mrweirdo-jobs/.env`, chmod 600)
- Resume PDF → Claude Sonnet parses out personal/education/work_auth
- 4 questions → `target_filters` (role types, locations, exclude keywords, min fit score)
- Local SQLite DB auto-created at `~/.mrweirdo-jobs/jobs.db` (zero schema config required)
- Smoke test 1 Greenhouse fetch

After `/mrweirdo-init` everything is ready. **No Notion / cloud account anywhere in the loop.**

### Optional: Datasette web UI

To browse / filter / approve jobs visually:

```bash
pip install datasette
datasette serve ~/.mrweirdo-jobs/jobs.db --open --port 8001
```

Opens a local web UI showing 5 pre-built views:
- `v_ai_sourced` — AI-evaluated jobs waiting for your review
- `v_approved` — Jobs you marked ✅ Approved; `/mrweirdo-jobs` reads from here
- `v_submitted` — Submitted / confirmed jobs
- `v_skipped` — Skipped or rejected
- `v_large_company_pending` — Quota-capped companies waiting for manual cherry-pick

Datasette supports SQL queries, CSV / JSON export, link-shareable filters. You can also use TablePlus / DBeaver / DataGrip / `sqlite3` CLI — any SQLite client works.

---

## What it does

| Command | Purpose |
|---|---|
| `/mrweirdo-init` | First-run setup. Run once. |
| `/mrweirdo-source` | Pull jobs from ~250 companies' Greenhouse / Ashby / Lever / SmartRecruiters / iCIMS / JobVite boards → AI score (Sonnet, ~$0.003/job) → write `~/.mrweirdo-jobs/jobs.db`. |
| `/mrweirdo-jobs` | Read `✅ Approved` rows from local DB → batch CDP fill each application form → human Submit per app → mark `✅ 已投`. |
| `/mrweirdo-greenhouse <url>` | Single Greenhouse application. |
| `/mrweirdo-ashby <url>` | Single Ashby application. |
| `/mrweirdo-lever <url>` | Single Lever application. |
| `/mrweirdo-smartrecruiters <url>` | Single SmartRecruiters (beta). |
| `/mrweirdo-icims <url>` | Single iCIMS (alpha). |
| `/mrweirdo-jobvite <url>` | Single JobVite (alpha). |
| `/mrweirdo-handshake <url>` | Single Handshake (beta). |
| `/mrweirdo-workday <url>` | Single Workday (per-company JSON config). |
| `/mrweirdo-confirm` | Read Gmail threads labeled `applied-jobs` → match to `✅ 已投` DB rows → mark `✅ 已确认`. |

---

## What it does NOT do

- **Does not submit on its own.** Every form is filled, screenshotted, and handed back to you. You click Submit.
- **Does not touch LinkedIn / Indeed / Glassdoor.** Auto-apply on those platforms violates ToS + their anti-bot is on the network layer. They stay manual.
- **Does not run a hosted SaaS.** All keys + resume + Notion stay on your machine. There is no cloud service to sign up for.
- **Does not bypass anti-bot.** It drives a real Chrome you own. If a site flags you, stop.
- **Does not rewrite your resume per JD.** Bring your own PDF.

---

## How sourcing works

Per-company public API. ~250 companies seeded in `shared/sourcing/company_list.json` across AI, B2B SaaS, fintech, consumer, health, dev tools. Each entry maps to multiple ATS slugs:

| ATS | Sourcing | Apply |
|---|---|---|
| Greenhouse | ✅ public API `boards-api.greenhouse.io` | ✅ stable |
| Ashby | ✅ public API `api.ashbyhq.com/posting-api` | ✅ stable |
| Lever | ✅ public API | ✅ stable |
| SmartRecruiters | ✅ public API | ⚠️ beta |
| iCIMS | ✅ HTML scrape | ⚠️ alpha |
| JobVite | ✅ HTML scrape | ⚠️ alpha |
| Handshake | ⚠️ stub | ⚠️ beta |
| Workday | ❌ (per-company config) | ⚠️ config-driven |
| Recruitee / Personio / BambooHR / Rippling | ✅ | manual |
| Wellfound / YC WAAS | ⚠️ stub | manual |

You add your own companies to `~/.mrweirdo-jobs/company_list.user.json` — they merge on top of the baseline (no need to fork the repo).

Sourcing uses 6 AI dimensions (role_fit / skills_match / location_fit / visa_compatible / seniority_match / exclude_check) and feeds the last 20 skip reasons back into the prompt so the recommender learns from your taste.

---

## Large-company submission quota guard

Google, Meta, Microsoft, Stripe, Anthropic, OpenAI, etc. typically cap how many roles you can apply to per cycle. Auto-apply burning that quota on a non-dream role = wasted shot.

`shared/sourcing/company_list.json` flags 25 companies with `apply_quota`. `/mrweirdo-jobs` batch detects these and **always skips** them — it sources them to a separate Notion view 「🏢 大公司限投」 so you can hand-pick which 2-3 roles to apply to manually.

---

## Local SQLite dashboard

`/mrweirdo-init` creates `~/.mrweirdo-jobs/jobs.db` with the `jobs` table (25+ columns) plus 5 pre-built views (see Datasette section above). Status transitions:

```
🤖 AI sourced  →  ✅ Approved  →  ✅ 已投  →  ✅ 已确认
                  ↘  ⚠️ 跳过未投 / ❌ Rejected
```

Approve jobs by setting status to `✅ Approved` in Datasette (or any SQLite client). `/mrweirdo-jobs` reads `v_approved` view to drive batch apply.

---

## Gmail confirmation loop (optional)

Once you batch-apply, ATS confirmation emails arrive. To close the loop:

1. **In Gmail, build a filter** (one-time, ~30s):
   - Settings → Filters and Blocked Addresses → Create new filter
   - Subject contains: `thanks for applying OR application received OR application confirmed`
   - From contains: `noreply@greenhouse.io OR noreply@ashbyhq.com OR jobs@lever.co OR noreply@workday.com OR mailer@jobvite.com`
   - Action: Apply label `applied-jobs`
2. **In Claude Code**: run `/mrweirdo-confirm`

The skill uses the Anthropic-bundled Gmail MCP (`mcp__claude_ai_Gmail__`) to read only threads matching `label:applied-jobs newer_than:7d` — your full inbox is never scanned. Each thread is parsed by Sonnet (~$0.0003/email) to extract `{company, role, ats, is_confirmation}` then matched to a `✅ 已投` row in `jobs.db` and flipped to `✅ 已确认`.

Idempotent — safe to re-run.

---

## Requirements

- macOS (launcher uses `open -na`; Linux symlinks work fine but Chrome launcher needs editing)
- Node 24+ (built-in `WebSocket` + `fetch` + PDF base64)
- Google Chrome (default location, or edit `shared/chrome-cdp-launcher.sh`)
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed
- Anthropic API key (~$0.50–$2/month at typical usage)
- A resume PDF
- (Optional) `pip install datasette` for the local web UI
- (Optional) Gmail filter for `/mrweirdo-confirm` loop

---

## File layout

```
~/.mrweirdo-jobs/                  # All user state (never committed)
├── .env                        # ANTHROPIC_API_KEY (chmod 600)
├── profile.json                # Your parsed resume + target_filters
├── jobs.db                     # SQLite — main job tracker (queryable via Datasette)
├── company_list.user.json      # Your custom companies (optional)
├── resume.pdf                  # Copy of your resume
├── feedback.jsonl              # Per-apply outcome log → next sourcing prompt
├── quota.jsonl                 # Large-company submit counter
├── log/                        # Per-skill jsonl logs
└── repo/                       # git clone of mrweirdo-jobs

~/.claude/skills/               # Symlinks → ~/.mrweirdo-jobs/repo/.claude/skills/*
├── ats-init/SKILL.md
├── ats-source/SKILL.md
├── ats-skills/SKILL.md
├── ats-greenhouse/SKILL.md
├── ats-ashby/SKILL.md
├── ats-lever/SKILL.md
├── ats-smartrecruiters/SKILL.md
├── ats-icims/SKILL.md
├── ats-jobvite/SKILL.md
├── ats-handshake/SKILL.md
├── ats-workday/SKILL.md
└── ats-confirm/SKILL.md
```

---

## Updating

```bash
git -C ~/.mrweirdo-jobs/repo pull
```

Or re-run the install command — `setup.sh` is idempotent and will fast-forward your checkout.

---

## Privacy

- All API keys live in `~/.mrweirdo-jobs/.env` (chmod 600). Never leaves your machine.
- **Job data stays on your machine in `~/.mrweirdo-jobs/jobs.db`** (SQLite). No cloud DB. Zero network egress for job tracking.
- Anthropic API calls (resume parse, AI scoring, confirmation email parse) go directly to `api.anthropic.com`. No proxy.
- Gmail reading uses Anthropic's bundled Gmail MCP under the same OAuth you already granted Claude. The skill only reads threads with the `applied-jobs` label.

If you want to read what we actually send to each API, the source is in `shared/` — zero deps, 100% Node 24 stdlib.

---

## Disclaimer

See [DISCLAIMER.md](DISCLAIMER.md). Short version: this is a tool for your own job search. You are responsible for following the ATS platforms' terms of service. If a platform asks you to stop, stop.

---

## Contributing

Issues + PRs welcome, especially:

- Helper fixes when an ATS frontend changes
- Company seed list additions (PR to `shared/sourcing/company_list.json`)
- Workday per-company configs in `shared/workday/companies/`
- New ATS support
- Translations / docs

NOT accepted:

- Anything that auto-submits without per-batch human authorization
- LinkedIn / Indeed / Glassdoor scrapers
- "As a service" wrappers
- Paid hosting

If you fork and run a service, please rename it.

---

## License

MIT. See [LICENSE](LICENSE).
