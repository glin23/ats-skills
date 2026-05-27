# mrweirdo-jobs

> **v2.1.5 — resume-driven job search agent for US college students.**
> A Claude Code + Codex Skill collection with a Node 24/CDP backend:
> resume intake → job discovery → fit scoring → ATS form filling →
> submission audit → Gmail confirmation loop.
>
> **This tool can auto-submit real job applications.** Read
> [DISCLAIMER.md](DISCLAIMER.md) before installing. Auto-apply carries
> ATS account, accuracy, and Terms-of-Service risk. Manual single-URL
> skills with a Submit gate are preserved for users who want more control.

---

## What it does

```
你 → 上传简历 → /mrweirdo-onboard
                ↓
       agent 前台执行:
         · 读简历 → AI 推 search intent + profile
         · 问几个关键问题：目标岗位、地点、周期、授权状态
         · 跨平台 discovery：Greenhouse / Ashby / Lever / YC / RemoteOK 等
         · Hard filter + AI score
         · 默认保护：大公司限投、LinkedIn/Indeed 不自动化
         · Auto-submit 主要覆盖 Greenhouse / Ashby
                ↓
你 → 看本地 DB / Datasette / optional review UI + Gmail confirmation
```

The main product is a Skill collection, not a SaaS. All private state
stays on the user's machine under `~/.mrweirdo-jobs/`.

## Who this is for

US college students looking for internships or new-grad full-time roles,
especially startup/tech-adjacent PM, growth, ops, business, data, and
similar paths on public ATS boards. The system is designed to avoid
hard-coded majors — it reads the resume and adapts — but source coverage
is still uneven:
- A business major with marketing internships gets recommended marketing/PM/Ops intern roles.
- A mechanical engineering student may get hardware/ops roles when those appear on supported boards.
- A nursing, public-health, government, arts, or education student will need more industry-specific sources before coverage feels good.

No hard-coded major or industry preferences exist in the code.

**Not for**: senior career changers, non-US job searches, people who want hands-on control of every submission.

## Current support level — read before installing

The code is already dogfooded on real applications, but it is still an
early, self-hosted agent. Treat the support matrix honestly:

- **Best-tested auto-submit**: Greenhouse and Ashby. v2.1.1 field
  testing includes 38 submitted rows in the author's local database,
  including Cloudflare Greenhouse and multiple Ashby essay flows.
- **Known weak spot**: Lever upload can trigger a bogus "100MB" error
  under CDP. It is kept for manual/single-URL experimentation, not
  treated as reliable batch infrastructure.
- **Discovery sources**: Greenhouse, Ashby, Lever, YC Work-At-A-Startup,
  RemoteOK, and several ATS board APIs exist in `shared/sourcing/`.
  Coverage varies by industry; non-tech majors still need more sources.
- **Manual / beta ATS skills**: SmartRecruiters, iCIMS, JobVite,
  Handshake, and Workday are available as single-URL helpers, but are
  not the stable batch path.
- **Large companies are deliberately skipped from auto-apply.** Google, Meta, Microsoft, Amazon, Apple, Stripe, Anthropic, OpenAI, and ~17 others have hard per-cycle submission caps. The auto-apply skips them; use `/mrweirdo-cherry-pick` to manually invest your limited quota in dream roles.
- **LinkedIn and Indeed are off-limits**, permanently. Use them manually.
- **Not all fields can be safely inferred.** GPA, transcripts, video
  answers, location commitments, and visa/sponsorship wording may push a
  row into a skip/manual queue. That is intentional.

---

## Install (one command, macOS)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/glin23/mrweirdo-jobs/main/setup.sh)
```

This will:

1. Verify Node 24+, Chrome, git.
2. Clone the repo to `~/.mrweirdo-jobs/repo`.
3. Symlink `.claude/skills/*` into:
   - `~/.claude/skills/` for Claude Code
   - `~/.codex/skills/` for Codex
   - `~/.mrweirdo-jobs/repo/.agents/skills/` for Codex workspace-local discovery
4. Create `~/.mrweirdo-jobs/{log,chrome-profile}/` layout.
5. Run a local install doctor and print any fixable warnings.

Before the first real run, start the dedicated Chrome used for ATS pages:

```bash
bash ~/.mrweirdo-jobs/repo/shared/chrome-cdp-launcher.sh
node ~/.mrweirdo-jobs/repo/shared/doctor.mjs --cdp
```

If port `9222` is already occupied, start Chrome on another port:

```bash
ATS_CDP_PORT=9223 bash ~/.mrweirdo-jobs/repo/shared/chrome-cdp-launcher.sh
node ~/.mrweirdo-jobs/repo/shared/doctor.mjs --cdp
```

The launcher records the active CDP host in `~/.mrweirdo-jobs/cdp_host`,
so later driver commands can reuse it.

Then in Claude Code or Codex:

```
/mrweirdo-onboard
```

The skill will ask you for your resume PDF path. First-run timing depends
on discovery volume and how many rows you allow it to submit; the public
beta default is 10 auto-submit rows per run, usually tens of minutes
rather than a 10-minute promise.

### Optional: Datasette audit UI

To inspect what the agent did (and which jobs got skipped vs. submitted vs. confirmed):

```bash
pip install datasette
datasette serve ~/.mrweirdo-jobs/jobs.db --open --port 8001
```

Datasette renders the SQLite job database with 8 pre-built views:

- `v_ai_sourced` — all discovered jobs, ranked by `fit_score`
- `v_auto_apply_eligible` — qualified jobs awaiting auto-submit (or already submitted)
- `v_auto_submitted` — what the agent actually submitted, with timestamps
- `v_skipped` — what the agent decided NOT to submit, with reason
- `v_large_company_pending` — quota-capped companies (use `/mrweirdo-cherry-pick`)
- `v_submitted` — manual + auto submissions combined
- `v_approved` / `v_unscored` — internal staging views

You can also use TablePlus, DBeaver, DataGrip, or the `sqlite3` CLI — any SQLite client works.

### Review UI options

SQLite is the source of truth. The review surface can be swapped:

- **Datasette**: easiest today, local, no API keys, works directly on `jobs.db`.
- **Notion**: useful if the student wants a familiar table UI and manual review column.
- **Google Sheets / Airtable / custom web UI**: reasonable future mirrors, but should sync back to SQLite rather than replace it.

If using Notion, treat it as a human review mirror:

1. The agent discovers/scores jobs into `~/.mrweirdo-jobs/jobs.db`.
2. A Notion mirror can show the queue in a friendlier table.
3. The student can mark rows as "want to apply", "skip", or adjust priority.
4. The agent syncs those decisions back before applying, then writes
   submitted/skipped/confirmed status back out.

The current Notion client lives in `shared/notion_sync.mjs`. It is
retained as an optional mirror, not the primary database, because Notion
API latency and schema drift are bad foundations for an audit log.

---

## Commands

| Command | Purpose | Mode |
|---|---|---|
| `/mrweirdo-onboard` | The main entry. Resume → intent → discovery → score → guarded auto-apply. Run once per cycle. | v2 batch |
| `/mrweirdo-doctor` | Checks install, Skill links, user-state files, and Chrome CDP readiness. Never submits applications. | safety |
| `/mrweirdo-cherry-pick` | Large-company opt-in flow. Lets you pick which 大公司 to invest quota slots in. **Preserves Submit gate.** | v1 manual-confirm |
| `/mrweirdo-confirm` | Reads Gmail `applied-jobs` label, marks jobs.db rows as ✅ 已确认. Optional, run later. | background |
| `/mrweirdo-greenhouse <url>` | Manual single-URL apply via Greenhouse, with Submit gate. | v1 manual |
| `/mrweirdo-ashby <url>` | Same, for Ashby. | v1 manual |
| `/mrweirdo-lever <url>` | Same, for Lever. | v1 manual |
| `/mrweirdo-smartrecruiters <url>` | Single-URL apply, beta. Use own risk. | v1 manual |
| `/mrweirdo-icims <url>` | Single-URL apply, alpha. Use own risk. | v1 manual |
| `/mrweirdo-jobvite <url>` | Single-URL apply, alpha. Use own risk. | v1 manual |
| `/mrweirdo-handshake <url>` | Single-URL apply via Handshake (you must be logged in). | v1 manual |
| `/mrweirdo-workday <url>` | Single-URL apply via Workday (requires per-company JSON config). | v1 manual |

`/mrweirdo-onboard` is the v2 product. Everything else is preserved for cases where you want manual control.

---

## v2.1 driver model (submit-error-driven)

v2.1 introduces `shared/ashby_apply_driver.mjs` and `shared/greenhouse_apply_driver.mjs` — submit-error-driven drivers that fill what they can, hit Submit, parse the form's own validation errors, then loop. Compared to the v2.0 pre-emptive `fillForm` approach this is more resilient to per-tenant form variance. In field testing on 2026-05-26 the local database reached 38 submitted rows, with the most reliable path being Greenhouse + Ashby.

Architecture:

1. Open URL via CDP. Upload resume + dispatch React `change` event.
2. Fill standard fields (`_systemfield_name`, `_systemfield_email`, any visible `tel`).
3. Pre-fill Country (US) and profile-derived location via `reactSelect()` where needed.
4. Click Submit. Parse validation errors. Match each missing field to an answer in `shared/answer_bank.json`.
5. Up to 5 attempts; if errors don't change between rounds, emit `outcome: stuck_on_same_missing` and skip.
6. On `outcome: essay_pending`, surface the questions to the main agent for human-in-the-loop essay writing.

Tabs are auto-closed on submit/skip. Background batches are deprecated in favor of foreground per-row execution for visibility. Public beta onboarding caps auto-submit at 10 rows per run by default; set `MRWEIRDO_MAX_AUTO_APPLY=50` only when the user deliberately asks for a bigger batch. Essay templates and Yes/No defaults live in `shared/answer_bank.json` — edit that file to update answers without touching driver source.

---

## How the AI work happens — and what you don't need

Everything that requires AI reasoning in v2 runs through the active Claude Code or Codex session that you already started when you ran the slash command. **There is no separate Anthropic API key requirement for interactive runs.** v1 used a fetch-based scorer that required `ANTHROPIC_API_KEY`; v2 does not.

Concretely:

| Stage | LLM source |
|---|---|
| Resume PDF parse → profile + search_intent | Main agent session |
| Cross-platform job filtering (semantic) | Main agent session |
| 6-dimension scoring (50 jobs / turn) | Main agent session |
| Per-form field reasoning during auto-apply | Main agent session |
| Discovery API fetches (RemoteOK etc.) | No LLM, plain HTTP |

The exception: if you want background scheduled runs (future v2.4 cron mode), you would need an API key. But for one-shot interactive use, no key.

---

## File layout

```
~/.mrweirdo-jobs/                       # all per-user state
├── profile.json                        # form-fill data, generated by /mrweirdo-onboard from resume
├── search_intent.json                  # AI-derived search params, generated by /mrweirdo-onboard
├── resume.pdf                          # your resume copy
├── jobs.db                             # SQLite — every discovered + scored + applied job
├── feedback.jsonl                      # per-apply outcome log (audit)
├── quota.jsonl                         # large-company submit counter (for cherry-pick)
├── daily_count.jsonl                   # historical submission counter (informational; no blanket daily cap)
├── company_list.user.json              # (optional) your custom companies overlay
├── log/                                # per-skill logs + screenshots
└── chrome-profile/                     # CDP isolated Chrome (your real Chrome is untouched)

~/.claude/skills/                       # Claude Code symlinks → repo/.claude/skills/*
~/.codex/skills/                        # Codex user-skill symlinks → repo/.claude/skills/*
repo/.agents/skills/                    # Codex workspace-local symlinks, generated by setup.sh
├── mrweirdo-onboard/                   # v2 main entry
├── mrweirdo-doctor/                    # install/runtime readiness check
├── mrweirdo-greenhouse-auto/           # v2 auto-submit helper (called by onboard)
├── mrweirdo-ashby-auto/                # v2 auto-submit helper
├── mrweirdo-lever-auto/                # v2 auto-submit helper
├── mrweirdo-cherry-pick/               # large-company opt-in (with Submit gate)
├── mrweirdo-confirm/                   # Gmail confirmation loop
├── mrweirdo-greenhouse/                # v1 single-URL with Submit gate
├── mrweirdo-ashby/                     # v1
├── mrweirdo-lever/                     # v1
├── mrweirdo-smartrecruiters/           # v1, beta
├── mrweirdo-icims/                     # v1, alpha
├── mrweirdo-jobvite/                   # v1, alpha
├── mrweirdo-handshake/                 # v1
└── mrweirdo-workday/                   # v1, per-company config

examples/
└── lee_company_list.json               # reference company list (the author's curated 248 — NOT used by default in v2; example only)
```

---

## Requirements

- macOS (the Chrome launcher uses `open -na`; Linux symlinks work but the launcher needs editing)
- Node 24+ (for built-in `node:sqlite`, `fetch`, and `WebSocket`)
- Google Chrome (default install location, or edit `shared/chrome-cdp-launcher.sh`)
- Claude Code or Codex installed
- A US-based resume PDF
- (Optional) `pip install datasette` for the audit UI
- (Optional) Gmail filter for `/mrweirdo-confirm` (one-time, ~30 seconds setup)

---

## Updating

```bash
git -C ~/.mrweirdo-jobs/repo pull
```

Or re-run the install command — `setup.sh` is idempotent.

---

## Privacy and where your data goes

- All your data lives on your local machine in `~/.mrweirdo-jobs/`. **Nothing leaves your machine except for**:
  - HTTP requests to ATS platforms (Greenhouse / Ashby / Lever / RemoteOK / YC / other public boards) to fetch listings and submit your application
  - Model calls via your active Claude Code or Codex session
  - Gmail API calls via the Anthropic-bundled Gmail MCP, only for threads with the `applied-jobs` label
- No cloud database. No "your data on our servers". This is self-host only.
- No telemetry. The author does not see your applications, your resume, or your Gmail.

---

## Contributing

Issues and pull requests welcome, especially:

- ATS helper fixes when a platform's DOM changes
- New discovery sources (Wellfound, YC, Hacker News Who's Hiring archive, industry-specific boards)
- Per-company Workday configs in `shared/workday/companies/`
- Translations and docs improvements
- New auto-submit platform helpers, **but only with**:
  1. A clear pre-submit safety net (CAPTCHA detection at minimum)
  2. Documented dogfood evidence of ≥3 successful real submissions
  3. Acknowledgment of the platform's ToS auto-submit prohibition

What will NOT be accepted:

- LinkedIn / Indeed / Glassdoor automation of any kind
- Anything that removes the LinkedIn red line or the large-company quota guard
- A version that auto-submits to large-capped companies without going through `/mrweirdo-cherry-pick`
- Paid-hosting wrappers, "SaaS-ification" forks
- CAPTCHA-bypass code

If you fork and run a service, please rename it so users don't confuse your fork with this self-host tool.

---

## License

MIT. See [LICENSE](LICENSE).

---

## Disclaimer (READ BEFORE INSTALLING)

See [DISCLAIMER.md](DISCLAIMER.md). v2 auto-submits applications — this is a real ATS Terms-of-Service issue and a real risk to your account at each platform. The disclaimer spells out the risks, what is and isn't protected by built-in safeguards, and what your responsibilities as a user are. Read it before running `/mrweirdo-onboard`.
