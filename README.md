# mrweirdo-jobs

> **v2 — resume-driven autonomous job search agent.** A Claude Code skill collection that turns the US college internship hunt into one command. Upload your resume, the agent does the rest. **Reads → infers → discovers → scores → auto-applies.** Your feedback channel is your Gmail inbox.
>
> **v2 auto-submits applications.** Read [DISCLAIMER.md](DISCLAIMER.md) before installing — there are real ATS-account and Terms-of-Service risks. The v1 single-URL skills with manual Submit gate are preserved if you want that mode instead.

---

## What it does (v2 — zero-touch)

```
你 → 上传简历 → /mrweirdo-onboard
                ↓
       agent 自动 (~10 min):
         · 读简历 → AI 推 search intent + profile
         · 问 5-8 道 ABCD 题 (single round, multi-select where it makes sense)
         · 5s "informed display" — 让你 spot 简历 parse 错误
         · 跨平台 discovery (v2 MVP: RemoteOK)
         · Hard filter + AI score (主 Claude session, 零额外 API key)
         · Auto-submit to Greenhouse / Ashby / Lever
                ↓
你 → 等 Gmail confirmation 邮件
```

The user's only mandatory action is uploading the resume. The ABCD questions take ~30 seconds and have AI-inferred defaults (you can rapid-accept all). The 5-second informed display is a safety check, not a decision point.

## Who this is for

US college students (any major, any year) looking for internships or new-grad full-time roles. v2 makes zero assumptions about your major — the AI reads your resume and adapts:
- A business major with marketing internships gets recommended marketing/PM/Ops intern roles.
- A nursing student gets clinical research intern roles (when v2.1+ adds healthcare-specific sources).
- A mechanical engineering student gets mechanical/hardware intern roles.
- A liberal arts student with prior internships in publishing gets publishing/editorial intern roles.

No hard-coded major or industry preferences exist in the code.

**Not for**: senior career changers, non-US job searches, people who want hands-on control of every submission.

## v2 MVP limitations — read before installing

This is the first public release of v2. Things it does NOT do well yet:

- **Discovery is RemoteOK-only.** RemoteOK is heavily weighted toward remote tech jobs. Business, healthcare, arts, education, government, and other non-tech students will find **very few matches** until v2.1+ adds Wellfound, YC Work-At-A-Startup, and ATS bulk crawl. If your field is non-tech, **wait for v2.1+ before installing**.
- **Auto-apply on 3 platforms only.** Greenhouse / Ashby / Lever. Discovered jobs on SmartRecruiters / iCIMS / JobVite / Handshake / Workday are recorded in the local database but not auto-submitted. The v1 single-URL skills (`/mrweirdo-smartrecruiters` etc.) still exist for manual one-at-a-time submission of those.
- **Large companies are deliberately skipped from auto-apply.** Google, Meta, Microsoft, Amazon, Apple, Stripe, Anthropic, OpenAI, and ~17 others have hard per-cycle submission caps. The auto-apply skips them; use `/mrweirdo-cherry-pick` to manually invest your limited quota in dream roles.
- **LinkedIn and Indeed are off-limits**, permanently. Use them manually.
- **The author has dogfooded the GH/Ashby/Lever auto-apply flow on his own applications.** v2 has not had non-author testers yet. Expect bugs.

---

## Install (one command, macOS)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/glin23/mrweirdo-jobs/main/setup.sh)
```

This will:

1. Verify Node 24+, Chrome, git.
2. Clone the repo to `~/.mrweirdo-jobs/repo`.
3. Symlink `.claude/skills/*` into `~/.claude/skills/` so Claude Code picks them up.
4. Create `~/.mrweirdo-jobs/{log,chrome-profile}/` layout.

Then in any Claude Code session:

```
/mrweirdo-onboard
```

The skill will ask you for your resume PDF path. After ~10 minutes, the run reports what it submitted and tells you to watch Gmail.

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

---

## Commands

| Command | Purpose | Mode |
|---|---|---|
| `/mrweirdo-onboard` | The main entry. Resume → intent → discovery → score → auto-apply. Run once per cycle. | v2 zero-touch |
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

## How the AI work happens — and what you don't need

Everything that requires AI reasoning in v2 runs through the main Claude session that you already started when you ran the slash command. **There is no separate Anthropic API key requirement.** v1 used a fetch-based scorer that required `ANTHROPIC_API_KEY`; v2 does not. Your Claude Code subscription covers the cost.

Concretely:

| Stage | LLM source |
|---|---|
| Resume PDF parse → profile + search_intent | Main Claude session (uses the Read tool's PDF support) |
| Cross-platform job filtering (semantic) | Main Claude session |
| 6-dimension scoring (50 jobs / turn) | Main Claude session |
| Per-form field reasoning during auto-apply | Main Claude session |
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
├── daily_count.jsonl                   # daily cap enforcement
├── company_list.user.json              # (optional) your custom companies overlay
├── log/                                # per-skill logs + screenshots
└── chrome-profile/                     # CDP isolated Chrome (your real Chrome is untouched)

~/.claude/skills/                       # symlinks → repo/.claude/skills/*
├── mrweirdo-onboard/                   # v2 main entry
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
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed
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
  - HTTP requests to ATS platforms (Greenhouse / Ashby / Lever / RemoteOK) to fetch listings and submit your application
  - Anthropic API calls via your Claude Code session (covered by your subscription)
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
