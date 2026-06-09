# Mr. Weirdo Jobs

[![npm](https://img.shields.io/npm/v/mrweirdo-jobs.svg)](https://www.npmjs.com/package/mrweirdo-jobs)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Local-first Claude Code + Codex skills for resume-driven job discovery,
fit scoring, and guarded ATS application submission.

Mr. Weirdo Jobs reads a student's resume, builds a local job-search profile,
discovers public roles, scores fit, fills supported ATS forms, and writes a
local audit trail. It is a self-hosted developer tool, not a SaaS.

> This tool can submit real job applications. Read [DISCLAIMER.md](DISCLAIMER.md)
> before running it. Public alpha users should review the first few submissions
> carefully and understand each ATS platform's Terms-of-Service risk.

## Quick Start

Install on macOS:

```bash
npx -y mrweirdo-jobs
```

Then open Claude Code or Codex and run:

```text
/mrweirdo-jobskill
```

Requirements: macOS, Node 24+, Google Chrome, and Claude Code or Codex.
Private state stays on your machine under `~/.mrweirdo-jobs/`.

## Public Alpha Status

This repo is ready for careful public alpha demos. The stable path is:

1. Install with `npx -y mrweirdo-jobs`.
2. Run `/mrweirdo-jobskill`.
3. Provide a resume PDF path and a short self-introduction.
4. Confirm the parsed profile/search intent.
5. Let the agent discover, score, preview, and apply to eligible rows.

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

## What It Does

| Stage | What happens |
|---|---|
| Resume intake | Builds local `profile.json`, `search_intent.json`, and `essay_profile.json`. |
| Discovery | Searches public ATS boards and job sources such as Greenhouse, Ashby, Lever, YC, and RemoteOK. |
| Scoring | Uses the active Claude Code or Codex session to rank fit and explain skips. |
| Guarded auto-apply | Auto-submits only supported Greenhouse/Ashby rows after profile confirmation. |
| Audit trail | Records discovered, skipped, submitted, failed, and confirmed rows in local SQLite. |
| Confirmation loop | Optionally reads Gmail threads labeled `applied-jobs` and marks confirmations. |

All AI reasoning runs through your active Claude Code or Codex session. There is
no separate Anthropic API key requirement for normal interactive runs.

## Who It Is For

Best fit:

- US college students looking for internships, part-time roles, or new-grad roles.
- Startup/tech-adjacent business, PM, growth, data, ops, and software paths.
- Users comfortable running a local developer tool and reviewing real applications.

Not a good fit:

- Non-US job searches.
- Senior career changes.
- Users who want manual control over every field and every final submit.

The system reads the resume and adapts; it does not hard-code a major or
industry. Coverage is still uneven outside tech/startup-heavy public boards.

## Safety Boundaries

Built-in red lines:

- LinkedIn and Indeed are never automated.
- Large capped companies are skipped by default; use `/mrweirdo-cherry-pick`
  when you want to spend a quota slot manually.
- Internship, part-time, and full-time/new-grad targets are kept separate.
- Legal, visa, transcript, GPA, video, and ambiguous attestation fields can
  push a row into manual review instead of guessing.
- A local batch lock prevents two apply batches from running against the same
  user data at the same time.
- `jobs.db` acts as the de-dupe ledger, so previously submitted jobs are kept
  as history and not blindly re-submitted.

Manual single-URL skills keep a final Submit gate. The v2 batch flow can
auto-submit supported rows after onboarding/profile confirmation.

## Supported Platforms

| Area | Status |
|---|---|
| Greenhouse auto-submit | Best-tested path. |
| Ashby auto-submit | Best-tested path. |
| Lever | Available for manual/single-URL flows; upload behavior can vary. |
| YC Work at a Startup, RemoteOK, public ATS APIs | Discovery sources. |
| SmartRecruiters, iCIMS, JobVite, Handshake, Workday | Single-URL helpers; beta/alpha depending on platform. |
| LinkedIn, Indeed, Glassdoor | Out of scope. |

## Main Commands

| Command | Use it for |
|---|---|
| `/mrweirdo-jobskill` | Main demo entry: resume -> discovery -> scoring -> guarded apply. |
| `/mrweirdo-doctor` | Install/runtime readiness check. Never submits applications. |
| `/mrweirdo-cherry-pick` | Opt-in flow for quota-capped large companies. |
| `/mrweirdo-confirm` | Gmail confirmation loop for already-submitted rows. |
| `/mrweirdo-greenhouse <url>` | Manual Greenhouse single-URL apply with Submit gate. |
| `/mrweirdo-ashby <url>` | Manual Ashby single-URL apply with Submit gate. |
| `/mrweirdo-lever <url>` | Manual Lever single-URL apply with Submit gate. |

## Install Details

Preferred installer:

```bash
npx -y mrweirdo-jobs
```

Fallback installer:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/glin23/mrweirdo-jobs/main/setup.sh)
```

The installer:

1. Verifies Node 24+, Chrome, and git.
2. Clones this repo to `~/.mrweirdo-jobs/repo`.
3. Links skills into Claude Code and Codex skill directories.
4. Creates local folders for logs, generated materials, and Chrome profile data.
5. Runs a local install doctor.

Before the first real run, start the dedicated Chrome used for ATS pages:

```bash
bash ~/.mrweirdo-jobs/repo/shared/chrome-cdp-launcher.sh
node ~/.mrweirdo-jobs/repo/shared/doctor.mjs --cdp
```

If port `9222` is busy:

```bash
ATS_CDP_PORT=9223 bash ~/.mrweirdo-jobs/repo/shared/chrome-cdp-launcher.sh
node ~/.mrweirdo-jobs/repo/shared/doctor.mjs --cdp
```

## Data And Privacy

- All user state lives under `~/.mrweirdo-jobs/`.
- The project does not run a cloud database.
- The maintainers do not see your resume, applications, Gmail, or local DB.
- External network calls are limited to job boards/ATS platforms, model calls
  through the active agent session, and optional Gmail confirmation lookup.
- Notion is optional and user-owned; it is off by default.

For the technical model, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Useful Links

- [npm package](https://www.npmjs.com/package/mrweirdo-jobs)
- [Public alpha checklist](docs/PUBLIC_ALPHA.md)
- [Architecture notes](docs/ARCHITECTURE.md)
- [Walkthrough](examples/walkthrough.md)
- [Disclaimer](DISCLAIMER.md)
- [Changelog](CHANGELOG.md)

## Contributing

Issues and pull requests are welcome, especially for:

- ATS helper fixes when a platform's DOM changes.
- New discovery sources.
- Per-company Workday configs.
- Docs, examples, and alpha feedback.

Not accepted:

- LinkedIn, Indeed, or Glassdoor automation.
- CAPTCHA bypass code.
- Removing large-company quota guards.
- Hosted SaaS wrappers that confuse users about where their data lives.

## License

MIT. See [LICENSE](LICENSE).
