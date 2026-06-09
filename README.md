# Mr. Weirdo Jobs

> **v2.2.0 public alpha — resume-driven job search automation for US college students.**
> A Claude Code + Codex Skill collection with a Node 24/CDP backend:
> resume intake → job discovery → fit scoring → ATS form filling →
> submission audit → Gmail confirmation loop.
>
> **This tool can auto-submit real job applications.** Read
> [DISCLAIMER.md](DISCLAIMER.md) before installing. Auto-apply carries
> ATS account, accuracy, and Terms-of-Service risk. Manual single-URL
> skills with a Submit gate are preserved for users who want more control.

---

## Quick Start

Install on macOS with one command:

```bash
npx -y mrweirdo-jobs
```

Then open Claude Code or Codex and run:

```text
/mrweirdo-jobskill
```

Requirements: macOS, Node 24+, Google Chrome, and Claude Code or Codex.
The installer verifies your machine, links the skills, and keeps private state
under `~/.mrweirdo-jobs/`.

---

## What it does

```
你 → 上传简历 + 自我介绍 → /mrweirdo-jobskill
                ↓
       agent 前台执行:
         · 读简历/自我介绍 → AI 推 search intent + profile + essay profile
         · 问 3 个硬边界问题：工签、地点、法律/证明类问题策略
         · 跨平台 discovery：Greenhouse / Ashby / Lever / YC / RemoteOK 等
         · Hard filter + AI score
         · 遇到 cover letter / essay 时用 essay profile 生成真实定制答案
         · 默认保护：大公司限投、LinkedIn/Indeed 不自动化
         · Auto-submit 主要覆盖 Greenhouse / Ashby
                ↓
你 → 看本地 DB / Datasette / optional review UI + Gmail confirmation
```

Mr. Weirdo Jobs is the project name and public brand. The repo slug,
commands, and local state directory use `mrweirdo-jobs` / `mrweirdo-*`
for compatibility. The main product is a Skill collection, not a SaaS.
All private state stays on the user's machine under `~/.mrweirdo-jobs/`.

## Public Alpha Status

This repo is ready for **public alpha** testing, not broad beta yet.
Use it if you are comfortable running a local developer tool, reading warnings,
and reviewing the first few submissions carefully.

Alpha success means:

- a fresh install completes on macOS;
- `/mrweirdo-jobskill` creates this user's local profile/search files;
- each run performs fresh discovery and updates local history;
- supported Greenhouse/Ashby rows can submit after the user
  confirms the parsed profile/search intent;
- if no rows are ready, the tool explains why and points to the next realtime
  discovery/review step.

Before inviting classmates, run:

```bash
cd ~/.mrweirdo-jobs/repo
npm run release:alpha
```

Before a live demo on your own machine, run:

```bash
cd ~/.mrweirdo-jobs/repo
npm run demo:check
```

Then open Claude Code or Codex and type:

```text
/mrweirdo-jobskill
```

The live flow is: resume PDF path → short self-introduction → hard-boundary
questions → parsed profile confirmation → realtime discovery/scoring → queue
preview → up to 10 guarded Greenhouse/Ashby auto-submissions.

## Database model

The database is **local to the person running the skill**, not a shared
demo corpus and not any remote backend.

- Default local install state lives in `~/.mrweirdo-jobs/`.
- `jobs.db` is this user's local history and de-dupe ledger. Submitted /
  confirmed rows are kept as history. Each run performs fresh discovery:
  newly discovered postings are inserted, re-seen postings update
  `last_seen_at` + `seen_count`, and stale / low-fit / skipped / repeatedly
  failed rows are pruned after the run report.
- `source_cursor.json` is this user's local discovery cursor. It advances after
  each discovery run so the next run crawls a new slice of public board sources.

In other words, users should not keep seeing the same frozen 1000-company dump
forever. Each run should discover again, insert newly seen postings, apply to
fresh eligible rows, and remove dead discovered rows that are no longer useful.

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

## Role-Type Isolation

Internship, part-time, and new-grad/full-time are separate targets. During
onboarding the user chooses `role_type_targets`; auto-apply only dispatches
rows that match those selected targets. Internship runs do not auto-apply
full-time roles, and full-time runs do not auto-apply internships. When a user
wants both internship and part-time, pass or store `["intern", "part_time"]`.

## Current support level — read before installing

This is still an early, self-hosted agent. Treat the support matrix honestly:

- **Best-tested auto-submit**: Greenhouse and Ashby. These paths have
  end-to-end real-form validation, including Cloudflare Greenhouse and
  Ashby essay flows.
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

## Install (macOS)

Preferred:

```bash
npx -y mrweirdo-jobs
```

Fallback without npm package resolution:

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
/mrweirdo-jobskill
```

The skill will ask you for your resume PDF path and a short self-introduction,
then three hard-boundary questions (work authorization, location flexibility,
and legal/attestation policy). First-run timing depends on discovery volume
and how many eligible rows are ready; by default it processes every currently
eligible queued row unless you set `MRWEIRDO_MAX_AUTO_APPLY` to cap the run.

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

The current Notion client lives in `shared/notion_sync.mjs`. It is retained as
an optional user-owned mirror, off by default. It only runs after the user
explicitly configures their own `NOTION_API_KEY` and `NOTION_JOB_DB_ID`; there is
no default Notion database.

---

## Commands

| Command | Purpose | Mode |
|---|---|---|
| `/mrweirdo-jobskill` | Demo-friendly main entry. Resume → intent → discovery → score → guarded auto-apply. | v2 batch |
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

`/mrweirdo-jobskill` is the v2 product entry for demos and new users. `/mrweirdo-onboard`
is the same production workflow with the older internal name. Everything else is preserved
for cases where you want manual control.

---

## v2.1 driver model (submit-error-driven)

v2.1 introduces `shared/ashby_apply_driver.mjs` and `shared/greenhouse_apply_driver.mjs` — submit-error-driven drivers that fill what they can, hit Submit, parse the form's own validation errors, then loop. Compared to the v2.0 pre-emptive `fillForm` approach this is more resilient to per-tenant form variance. The most reliable validated path remains Greenhouse + Ashby.

Architecture:

1. Open URL via CDP. Upload resume + dispatch React `change` event.
2. Fill standard fields (`_systemfield_name`, `_systemfield_email`, any visible `tel`).
3. Pre-fill Country (US) and profile-derived location via `reactSelect()` where needed.
4. Click Submit. Parse validation errors. Match each missing field to an answer in `shared/answer_bank.json`.
5. Up to 5 attempts; if errors don't change between rounds, emit `outcome: stuck_on_same_missing` and skip.
6. On `outcome: essay_pending`, surface the questions to the main agent. The agent uses `~/.mrweirdo-jobs/essay_profile.json` plus job context to draft truthful, tailored answers; it asks the user only for missing batch-level facts or legal-sensitive answers.

Tabs are auto-closed on submit/skip. Background batches are deprecated in favor of foreground per-row execution for visibility; real apply batches should not be launched in Claude Code background mode. Public alpha onboarding processes all currently eligible queued rows by default; set `MRWEIRDO_MAX_AUTO_APPLY=50` only when the user deliberately asks to cap a run. The simplest guarded entrypoint is `shared/apply_supervisor.mjs`: run it with `--dry-run` to validate the queue without submitting, or with `--real` after the user explicitly asks to apply. It verifies or launches Chrome CDP, then delegates to `shared/apply_batch.mjs`, which performs preflight, queue validation, driver execution, evidence-bound DB recording, pacing, report generation, and a local batch lock so two apply batches cannot run concurrently against the same user data. If a requested cap is larger than the current eligible queue, `shared/queue_diagnostics.mjs` explains whether the gap is low fit score, unsupported ATS, quota, role boundary, or duplicate submissions. `shared/queue_review_report.mjs` generates a local HTML review page with ready-to-apply rows, one-point-below-threshold rows for human re-scoring, and unsupported ATS rows. `shared/rescore_review.mjs` exports the fit-one-below rows and can promote only user-selected IDs with `--promote ... --apply`. `shared/apply_readiness_plan.mjs` writes a readiness report for the current local history, so users can see how many rows are immediately submittable, how many need review, and how many new supported-ATS rows the next realtime discovery run should find. Essay templates and Yes/No defaults live in `shared/answer_bank.json` — edit that file to update answers without touching driver source.

For the next realtime discovery run, `shared/discover_candidates.mjs --plan` shows the target-role-safe discovery keywords and sources without touching the network; `--run` performs fresh discovery for the current user, hard-filters the results, and writes `/tmp/mrweirdo-onboard/to_score.json` for the main agent's scoring pass.

For a one-command local health snapshot, run `node shared/supervisor_status.mjs --target 100`. It derives role targets from `~/.mrweirdo-jobs/search_intent.json` unless you explicitly pass `--role-targets`. It reports CDP state, whether a real apply batch is currently ready, latest application report, ready row count, current remaining target, and the next safe commands. If CDP is down, the first commands are the visible-terminal recovery commands to start Chrome CDP before applying.

---

## How the AI work happens — and what you don't need

Everything that requires AI reasoning in v2 runs through the active Claude Code or Codex session that you already started when you ran the slash command. **There is no separate Anthropic API key requirement for interactive runs.** v1 used a fetch-based scorer that required `ANTHROPIC_API_KEY`; v2 does not.

Concretely:

| Stage | LLM source |
|---|---|
| Resume PDF + self-introduction parse → profile + search_intent + essay_profile | Main agent session |
| Cross-platform job filtering (semantic) | Main agent session |
| 6-dimension scoring (50 jobs / turn) | Main agent session |
| Per-form field reasoning during auto-apply | Main agent session |
| Discovery API fetches (RemoteOK etc.) | No LLM, plain HTTP |

The exception: if you want background scheduled runs (future v2.4 cron mode), you would need an API key. But for one-shot interactive use, no key.

---

## File layout

```
~/.mrweirdo-jobs/                       # all local state for the person running the skill
├── profile.json                        # form-fill data, generated by /mrweirdo-jobskill from resume
├── search_intent.json                  # AI-derived search params, generated by /mrweirdo-jobskill
├── essay_profile.json                  # reusable writing memory for cover letters + essay questions
├── generated_materials/                # local generated cover letters / essay drafts when needed
├── resume.pdf                          # your resume copy
├── jobs.db                             # SQLite — local job history + application ledger
├── source_cursor.json                  # local discovery cursor, advances after each run
├── feedback.jsonl                      # per-apply outcome log (audit)
├── quota.jsonl                         # large-company submit counter (for cherry-pick)
├── daily_count.jsonl                   # historical submission counter (informational; no blanket daily cap)
├── company_list.user.json              # (optional) your custom companies overlay
├── log/                                # per-skill logs + screenshots
└── chrome-profile/                     # CDP isolated Chrome (your real Chrome is untouched)

~/.claude/skills/                       # Claude Code symlinks → repo/.claude/skills/*
~/.codex/skills/                        # Codex user-skill symlinks → repo/.claude/skills/*
repo/.agents/skills/                    # Codex workspace-local symlinks, generated by setup.sh
├── mrweirdo-jobskill/                  # demo-friendly v2 main entry
├── mrweirdo-onboard/                   # same v2 workflow, older internal entry
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
└── example_company_list.json           # optional example format — NOT used by default in v2
```

---

## Requirements

- macOS (the Chrome launcher uses `open -na`; Linux symlinks work but the launcher needs editing)
- Node 24+ (for built-in `node:sqlite`, `fetch`, and `WebSocket`)
- Google Chrome (default install location, or edit `shared/chrome-cdp-launcher.sh`)
- Claude Code or Codex installed
- A resume PDF and a short self-introduction for writing/search intent
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
- No cloud database by default. Notion is optional and only uses the user's own
  explicitly configured Notion database if they turn that mirror on.
- No telemetry. Project maintainers do not see your applications, your resume, or your Gmail.

---

## Contributing

Issues and pull requests welcome, especially:

- ATS helper fixes when a platform's DOM changes
- New discovery sources (Wellfound, YC, Hacker News Who's Hiring archive, industry-specific boards)
- Per-company Workday configs in `shared/workday/companies/`
- Translations and docs improvements
- New auto-submit platform helpers, **but only with**:
  1. A clear pre-submit safety net (CAPTCHA detection at minimum)
  2. Documented end-to-end verification evidence from real submission flows
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

See [DISCLAIMER.md](DISCLAIMER.md). v2 auto-submits applications — this is a real ATS Terms-of-Service issue and a real risk to your account at each platform. The disclaimer spells out the risks, what is and isn't protected by built-in safeguards, and what your responsibilities as a user are. Read it before running `/mrweirdo-jobskill`.
