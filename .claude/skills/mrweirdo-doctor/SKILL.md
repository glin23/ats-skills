---
name: mrweirdo-doctor
description: Check whether mrweirdo-jobs is installed and ready before a real run. Trigger when the user asks to verify setup, debug install, confirm Codex/Claude Code skill links, check Chrome CDP, or ask "can I use it now?" Does not discover jobs or submit applications.
---

# mrweirdo-doctor

Use this skill as the pre-flight gate before a first real user run.

## What It Does

- Verifies Node 24+, git, Chrome, repo layout, Skill links, and user-state files.
- Optionally verifies Chrome DevTools Protocol, normally `localhost:9222` or the host recorded in `~/.mrweirdo-jobs/cdp_host`.
- Never opens ATS pages, discovers jobs, scores jobs, or submits applications.

## Run The Check

From the repo checkout:

```bash
node shared/doctor.mjs
```

If the user is about to run `/mrweirdo-onboard` or asks whether Chrome is ready:

```bash
node shared/doctor.mjs --cdp
```

If the command is being run from outside the repo:

```bash
node ~/.mrweirdo-jobs/repo/shared/doctor.mjs --cdp
```

## How To Respond

- If there are `FAIL` rows: tell the user not to run real applications yet and give the listed fixes.
- If there are only `WARN` rows: explain which warnings are normal before first onboarding, such as missing `profile.json`, `search_intent.json`, `resume.pdf`, or `jobs.db`.
- If CDP is missing and the user is ready to apply, tell them to run:

```bash
bash ~/.mrweirdo-jobs/repo/shared/chrome-cdp-launcher.sh
```

If port `9222` is occupied by a non-CDP process, use:

```bash
ATS_CDP_PORT=9223 bash ~/.mrweirdo-jobs/repo/shared/chrome-cdp-launcher.sh
```

Then rerun:

```bash
node ~/.mrweirdo-jobs/repo/shared/doctor.mjs --cdp
```
