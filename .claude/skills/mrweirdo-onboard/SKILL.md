---
name: mrweirdo-onboard
description: Main entry skill for Mr. Weirdo Jobs after install. Trigger for first-run setup, resume intake, self-introduction intake, student job/internship discovery, scoring, essay/cover-letter material drafting, and guarded auto-apply. Collects resume + a lightweight self-introduction + three hard-boundary questions + explicit parse confirmation, then discovers jobs across public ATS boards, scores them, skips large-company quota rows, and auto-submits supported Greenhouse/Ashby rows. Do NOT trigger for a single URL/manual application; route those to mrweirdo-greenhouse, mrweirdo-ashby, or mrweirdo-lever.
---

# Mr. Weirdo Jobs Onboard

This is the main local skill after install. It is not a platform flow and does
not use a shared database. Every run belongs to the person running the skill.

State defaults to:

- `$MRWEIRDO_HOME`, usually `~/.mrweirdo-jobs`
- `$MRWEIRDO_HOME/jobs.db`
- `$MRWEIRDO_HOME/source_cursor.json`
- temporary run artifacts in `/tmp/mrweirdo-onboard`

The skill's job is:

1. collect a resume, self-introduction, and a few hard boundaries;
2. generate local `profile.json`, `search_intent.json`, and `essay_profile.json`;
3. confirm the parse before spending applications;
4. run fresh discovery, score jobs, and update the local history ledger;
5. auto-submit only guarded Greenhouse/Ashby matches;
6. generate a report and prune disposable discovered rows.

## Trigger

Use this skill when:

- first-run sentinel `~/.mrweirdo-jobs/.first_run` exists and the user asks how
  to start, says "start", "next step", "找实习", "投实习", or similar;
- user explicitly invokes `/mrweirdo-onboard` or `/mrweirdo-jobskill`;
- user wants the end-to-end resume-driven discovery + scoring + guarded batch
  apply loop.

Do not use this skill for:

- one URL/manual apply: route to `mrweirdo-greenhouse`, `mrweirdo-ashby`, or
  `mrweirdo-lever`;
- large-company quota slots: route to `mrweirdo-cherry-pick`;
- install readiness only: route to `mrweirdo-doctor`;
- Gmail confirmation sync only: route to `mrweirdo-confirm`.

## Defaults

- Auto-apply threshold: `fit_score >= 5`.
- Stable batch auto-submit ATS: Greenhouse and Ashby.
- Per-company quota guard stays on for the user's local `company_list.user.json`.
- Public default batch size: `MRWEIRDO_MAX_AUTO_APPLY=10`.
- LinkedIn, Indeed, and Glassdoor are never automated.
- Do not invent personal facts. Unknowns stay null or become blockers.

## References

Read these only when needed:

- `references/intake-and-profile.md`: hard-boundary questions, profile/search
  JSON shape, adaptive follow-up rules, and parse confirmation.
- `references/run-and-database.md`: local DB contract, discovery/scoring/store
  commands, auto-apply supervisor, report, and pruning.
- `shared/scoring/score_prompt.md`: required scoring rubric.
- `shared/profile.template.json`: runtime `profile.json` shape.
- `shared/intelligence/intent_schema.json`: `search_intent.json` schema.

## Step 0 - Preflight

Show a short user-facing preamble. For first run:

```text
Welcome to Mr. Weirdo Jobs.

First of all, upload your resume PDF.

Then talk to us about yourself: who you are, what kind of internship or
part-time role you want, what experiences you want companies to notice, and
what industries/functions you care about.

I will turn that into a local profile, ask only the hard-boundary questions I
must not infer, show you the parsed profile once, then discover, score, and
submit a small guarded batch of US student roles. Stable batch auto-submit is
Greenhouse/Ashby. All state stays on this machine at ~/.mrweirdo-jobs.
```

For returning runs:

```text
mrweirdo jobskill: realtime discovery -> score -> guarded auto-apply -> report.
All state is local; jobs.db only remembers this user's seen/applied history.
```

Then run:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"
export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$HOME/.mrweirdo-jobs/repo}"
[ -d "$MRWEIRDO_REPO_ROOT" ] || MRWEIRDO_REPO_ROOT="$(pwd)"
mkdir -p "$MRWEIRDO_HOME/log" /tmp/mrweirdo-onboard

if [ -z "${CDP_HOST:-}" ] && [ -f "$MRWEIRDO_HOME/cdp_host" ]; then
  export CDP_HOST="$(cat "$MRWEIRDO_HOME/cdp_host")"
fi
export ATS_CDP_PORT="${ATS_CDP_PORT:-${CDP_HOST##*:}}"
[ -n "$ATS_CDP_PORT" ] || ATS_CDP_PORT=9222
export CDP_HOST="${CDP_HOST:-localhost:$ATS_CDP_PORT}"

if ! curl -sf "http://$CDP_HOST/json/version" >/dev/null 2>&1; then
  ATS_CDP_PORT="$ATS_CDP_PORT" bash "$MRWEIRDO_REPO_ROOT/shared/chrome-cdp-launcher.sh"
fi

node "$MRWEIRDO_REPO_ROOT/shared/doctor.mjs" --cdp
NODE_MAJOR=$(node --version | sed -E 's/^v([0-9]+).*/\1/')
[ "$NODE_MAJOR" -ge 24 ] || { echo "Node 24+ required, found $(node --version)"; exit 1; }
```

Stop on any failure and tell the user what to fix.

## Step 1 - Resume And Short Intro

Ask:

```text
First of all, upload your resume PDF. Paste the absolute file path here.

Then talk to us about yourself in 5-10 sentences:
who you are, what kind of internship or part-time role you want, what
experiences you want companies to notice, preferred industries/functions, and
anything you want the applications to emphasize.

Before any real application is submitted, I will show you the parsed profile
and ask for one explicit confirmation.
```

Validate and copy:

```bash
RESUME_PATH="<path from user>"
[ -f "$RESUME_PATH" ] || { echo "Resume not found: $RESUME_PATH"; exit 1; }
file "$RESUME_PATH" | grep -qi "pdf" || { echo "Not a PDF: $RESUME_PATH"; exit 1; }
cp "$RESUME_PATH" "$MRWEIRDO_HOME/resume.pdf"
chmod 600 "$MRWEIRDO_HOME/resume.pdf"
```

Read `references/intake-and-profile.md`, then ask only the three hard-boundary
questions from that reference: work authorization, geography/relocation, and
legal/regulated-role attestations. Use the user's free-form self-introduction
for softer preferences instead of a long questionnaire.

## Step 2 - Generate Local JSON

Read the resume PDF in the main agent session. Generate three JSON artifacts:

- `$MRWEIRDO_HOME/profile.json`
- `$MRWEIRDO_HOME/search_intent.json`
- `$MRWEIRDO_HOME/essay_profile.json`

Use `references/intake-and-profile.md`, `shared/profile.template.json`, and
`shared/intelligence/intent_schema.json`.

Important runtime shape:

```json
"work_authorization": {
  "visa_status": "F-1 OPT eligible",
  "authorized_to_work_us": true,
  "requires_sponsorship_now": false,
  "requires_sponsorship_future": true
}
```

Do not emit only `status`, `needs_sponsor`, or `sponsor_when`; the application
drivers read the canonical keys above.

After writing the files:

```bash
chmod 600 "$MRWEIRDO_HOME"/profile.json "$MRWEIRDO_HOME"/search_intent.json "$MRWEIRDO_HOME"/essay_profile.json
node "$MRWEIRDO_REPO_ROOT/shared/validate_user_profile.mjs"
```

If validation fails, stop and correct the generated JSON before continuing.

## Step 3 - Parse Confirmation

Show a concise summary before any discovery or auto-apply:

- name, email, phone;
- school, major, graduation date;
- work authorization and sponsorship values;
- top role directions and industries;
- geography and relocation policy;
- writing themes and hard no-claims;
- exclude keywords.

Ask once whether the parse is correct. Continue only after explicit
confirmation. If the user says it is wrong, stop and tell them to edit
`$MRWEIRDO_HOME/profile.json`, `$MRWEIRDO_HOME/search_intent.json`, or
`$MRWEIRDO_HOME/essay_profile.json`, then rerun.

## Step 4 - Refresh Discovery And DB

Read `references/run-and-database.md`.

Initialize the local database and create a run ID:

```bash
node -e "import('$MRWEIRDO_REPO_ROOT/shared/local_db.mjs').then(m => m.initDb()).then(r => console.log(JSON.stringify(r)))"
export RUN_ID="run-$(date -u +%Y%m%dT%H%M%S)-$(openssl rand -hex 4)"
```

Run discovery:

```bash
node "$MRWEIRDO_REPO_ROOT/shared/discover_candidates.mjs" --plan
node "$MRWEIRDO_REPO_ROOT/shared/discover_candidates.mjs" \
  --run \
  --run-id "$RUN_ID" \
  --source-window-size "${MRWEIRDO_SOURCE_WINDOW_SIZE:-1000}"
```

When `--source-window-offset` is omitted, discovery uses the user's local
`source_cursor.json` and advances it only after a run finishes. The cursor is
not shared. `to_score.json` contains currently auto-supported job rows only;
manual or unsupported URLs are written to `manual_or_unsupported.json`.
Discovery also writes `/tmp/mrweirdo-onboard/discovery_funnel.json`, which
summarizes raw discovery, hard-filter drops, auto-supported rows, manual rows,
and score-cap drops for the current run.

Score `/tmp/mrweirdo-onboard/to_score.json` in batches of 50 using
`shared/scoring/score_prompt.md`, then write merged scoring results to:

```text
/tmp/mrweirdo-onboard/scored.json
```

Do not continue until every usable row in `to_score.json` has a complete score
object in `scored.json` (`apply_url`, numeric `fit_score`, boolean
`recommended`, and `role_type_match`). If scoring was interrupted, finish the
missing rows first; do not store partial scoring output.

Store the scored job rows:

```bash
node "$MRWEIRDO_REPO_ROOT/shared/store_scored_jobs.mjs" \
  --run-id "$RUN_ID" \
  --to-score /tmp/mrweirdo-onboard/to_score.json \
  --scored /tmp/mrweirdo-onboard/scored.json \
  > /tmp/mrweirdo-onboard/db_result.json
```

This updates existing rows instead of freezing an old company list. Re-seen
rows get fresh `last_seen_at`, `seen_count`, and `discovery_run_id`.

## Step 5 - Guarded Auto-Apply

Before a real batch, surface the queue to the user as a compact table:
company, title, fit score, ATS, and location. Let the user drop rows before the
batch starts. Do not re-confirm every individual row after the batch begins.

Run:

```bash
MRWEIRDO_MAX_AUTO_APPLY="${MRWEIRDO_MAX_AUTO_APPLY:-10}" \
  node "$MRWEIRDO_REPO_ROOT/shared/apply_supervisor.mjs" \
    --real \
    --max "${MRWEIRDO_MAX_AUTO_APPLY:-10}"
```

The supervisor handles CDP, queue validation, dedupe, eligibility recompute,
driver execution, recorder updates, pacing, final status, and automatic
missing-info report generation. Do not hand-write submitted statuses in the DB.

## Step 6 - Missing Info Follow-Up And Retry

After every real batch, inspect:

```text
/tmp/mrweirdo-onboard/apply-gap-report.json
/tmp/mrweirdo-onboard/apply-gap-report.md
```

If `user_questions` is non-empty, do not summarize the run as "only N
submitted, the rest failed". Pause before pruning and ask the user the grouped
questions from the report. Ask only key facts that cannot be safely inferred,
such as full address, earliest start date, high-school city/state, government
relative/compliance facts, language or skill level, GPA, logistics, or location
commitments.

Open-text application answers are not user homework. For `agent_open_text`,
draft from the resume, self-introduction, `essay_profile.json`, and
`answer_bank.json`; add a reusable answer-bank template when the same prompt is
recurring. For `agent_attestation` and `agent_profile_backed`, fill from the
local profile or add driver coverage before retrying.

After the user answers, update only that user's local
`$MRWEIRDO_HOME/profile.json` / `essay_profile.json` / answer templates as
needed, validate the profile, then requeue the affected rows:

```bash
node "$MRWEIRDO_REPO_ROOT/shared/validate_user_profile.mjs"
node "$MRWEIRDO_REPO_ROOT/shared/retry_gap_rows.mjs" \
  --apply \
  --gap-report /tmp/mrweirdo-onboard/apply-gap-report.json \
  --max "${MRWEIRDO_MAX_AUTO_APPLY:-10}"
MRWEIRDO_MAX_AUTO_APPLY="${MRWEIRDO_MAX_AUTO_APPLY:-10}" \
  node "$MRWEIRDO_REPO_ROOT/shared/apply_supervisor.mjs" \
    --real \
    --max "${MRWEIRDO_MAX_AUTO_APPLY:-10}"
```

Use the second batch as the conversion-rate check. If the gap report lists
`onboarding_candidates`, tell the maintainer which fields were frequent and
whether they should become onboarding questions. Do not add low-frequency,
one-off facts to onboarding without discussion.

## Step 7 - Report And Prune

Generate the local report:

```bash
REPORT_PATH=$(node "$MRWEIRDO_REPO_ROOT/shared/apply_report.mjs" --since "$(date -u +%Y-%m-%d)")
echo "$REPORT_PATH"
```

Then prune disposable discovered rows:

```bash
node "$MRWEIRDO_REPO_ROOT/shared/prune_discovered_jobs.mjs" \
  --apply \
  --run-id "$RUN_ID" \
  --delete-skipped --skipped-days "${MRWEIRDO_PRUNE_SKIPPED_DAYS:-0}" \
  --delete-unusable-url \
  --delete-low-fit --low-fit-days "${MRWEIRDO_PRUNE_LOW_FIT_DAYS:-0}" \
  --delete-unsupported --unsupported-days "${MRWEIRDO_PRUNE_UNSUPPORTED_DAYS:-14}" \
  --delete-stale --stale-days "${MRWEIRDO_PRUNE_STALE_DAYS:-30}" \
  --retry-limit "${MRWEIRDO_PRUNE_RETRY_LIMIT:-3}" \
  --json > /tmp/mrweirdo-onboard/prune-summary.json
```

Keep submitted/confirmed application history. Prune only disposable discovered
rows that are stale, unusable, low-fit, unsupported, skipped, or repeatedly
failed.

If the run reached the report step, remove the first-run sentinel:

```bash
[ -f "$MRWEIRDO_HOME/.first_run" ] && rm -f "$MRWEIRDO_HOME/.first_run"
```

## Hard Rules

- No shared source cache or platform database.
- No bundled demo database.
- No default company list from the maintainer. Only use the user's local
  `company_list.user.json` for quota guards.
- Every run refreshes discovery and updates local row freshness.
- Keep submitted/confirmed rows; prune stale/low-fit/skipped discovered rows.
- If a batch hits missing personal facts, ask the user, update local profile,
  and retry those rows before treating them as failed.
- Do not make the user write open-text essays when the resume/self-intro can
  support an answer.
- Do not automate LinkedIn, Indeed, or Glassdoor.
- Do not auto-submit large-company quota rows; use `mrweirdo-cherry-pick`.
- Do not invent personal facts, legal facts, work authorization, GPA, relatives
  at company, clearance, background-check answers, or demographic answers.
- Do not run real apply batches in background mode. The user should see row
  progress and have an interrupt window.
