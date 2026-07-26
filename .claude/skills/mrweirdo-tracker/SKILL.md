---
name: mrweirdo-tracker
description: Track post-application outcomes for Mr. Weirdo Jobs. Trigger when the user says a company responded, sent an OA/interview/offer/rejection, wants to view the application funnel, or asks for pattern analysis. Updates outcome metadata only; never submits applications and never changes the emoji status column.
---

# Mr. Weirdo Tracker

Use this skill after applications have been submitted. It records lifecycle
events and analyzes patterns from the local SQLite DB.

State stays local:

- `$MRWEIRDO_HOME/jobs.db`
- reports under `$MRWEIRDO_HOME/reports/`
- temporary analysis under `/tmp/mrweirdo-onboard/`

## Trigger

Use this skill when the user says things like:

- "X gave me an OA"
- "Record that Y rejected me"
- "Show my funnel"
- "Analyze what is working"
- `/mrweirdo-tracker`

Do not use this skill for discovering jobs, applying to jobs, confirmation-email
sync, or single-URL ATS filling.

## Hard Rules

- Do not update `jobs.status`; the existing emoji lifecycle remains owned by
  `record_apply_outcome.mjs` and confirmation sync.
- Only update `outcome_status`, `outcome_updated_at`, follow-up metadata, and
  `feedback` events.
- Pattern recommendations are suggestions. Show each proposed config/profile
  change to the user before writing anything.
- Do not trigger auto-apply from tracker.

## Record An Outcome

Map user language to one of:

- `responded`
- `oa`
- `interview`
- `offer`
- `rejected`
- `ghosted`
- `pending`

If the user gives company/title but not row id, look up likely matching rows in
`jobs.db` and ask a short disambiguation question only if there is more than one
plausible match.

Run:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
node shared/tracker_cli.mjs --row-id "<ROW_ID>" --outcome "<OUTCOME>" --note "<short user note>"
```

Then summarize what was recorded.

## View Funnel

Run:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
node shared/tracker_cli.mjs --funnel --json
```

Summarize counts by `outcome_status` plus any follow-up due rows.

## Pattern Analysis

Before running analysis, check whether the user has enough data: at least 15
submitted rows and at least 5 non-pending outcomes. The script enforces this
gate and returns "样本不足" instead of weak conclusions.

Run:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
node shared/analyze_patterns.mjs --json
```

If recommendations are present, show each item with:

- target file;
- proposed change;
- reason;
- what would change for future discovery/scoring.

Write config/profile changes only after the user confirms that specific item.

## Follow-Up Drafts

When the user asks who to follow up with, run:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
node shared/tracker_cli.mjs --funnel --json
```

Use `followup_due` rows only. Draft concise follow-up messages that:

- reference the role and submission date;
- add one specific fit/proof point;
- ask whether there is any update on timeline;
- avoid empty phrases like "just checking in".

Never send a follow-up. Show the draft and wait for the user to send it
manually. After the user confirms they sent it, record:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
node shared/tracker_cli.mjs --row-id "<ROW_ID>" --followup-sent --note "<where/how user sent it>"
```
