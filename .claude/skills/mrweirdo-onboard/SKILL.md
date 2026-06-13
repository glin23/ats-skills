---
name: mrweirdo-onboard
description: Main entry skill for Mr. Weirdo Jobs after install. Trigger for first-run setup, resume intake, optional self-introduction intake, student job/internship discovery, scoring, guarded queue preview, and explicit-gated auto-apply. Uses one intake prompt, one hard-boundary AskUserQuestion call, a soft parse correction window, and one queue gate before any real submissions. Do NOT trigger for a single URL/manual application; route those internally to the dedicated ATS skill.
---

# Mr. Weirdo Jobs Onboard

This is the main local skill after install. Every run belongs to the person
running the skill; all state stays on this machine.

State defaults:

- `$MRWEIRDO_HOME`, usually `~/.mrweirdo-jobs`
- `$MRWEIRDO_HOME/jobs.db`
- `$MRWEIRDO_HOME/source_cursor.json`
- temporary run artifacts in `/tmp/mrweirdo-onboard`

The flow is: intake -> parse soft window -> discovery/scoring -> queue gate ->
guarded apply -> missing-info retry -> report/prune. The only hard business
confirmation before spending applications is the queue gate in Step 5.

## Trigger

Use this skill when:

- first-run sentinel `~/.mrweirdo-jobs/.first_run` exists and the user asks how
  to start, says "start", "next step", "找实习", "投实习", or similar;
- user explicitly invokes `/mrweirdo-onboard` or `/mrweirdo-jobskill`;
- user wants the end-to-end resume-driven discovery + scoring + guarded batch
  apply loop.

When invoked with no concrete request yet, show a single AskUserQuestion main
menu with exactly these five choices and no slash commands:

1. `开始找实习 / Onboard` (recommended): continue directly into the full
   onboard flow, starting at Step 0/Step 1, with no command for the user to type.
2. `进度跟踪 / Tracker`: route internally to `mrweirdo-tracker`.
3. `扩充写作画像 / Expand`: route internally to `mrweirdo-expand`.
4. `技能提升 / Upskill`: route internally to `mrweirdo-upskill`.
5. `起草申请材料 / Materials`: route internally to `mrweirdo-materials`.

Do not show ATS platform commands in this menu. The one-off ATS skills,
confirmation sync, quota cherry-pick, doctor preflight, and `*-auto` engines
remain available for internal routing, but are not user-facing menu items.

Do not use this skill for:

- one URL/manual apply: route internally to the dedicated one-off ATS skill;
- large-company quota slots: route internally to `mrweirdo-cherry-pick`;
- install readiness only: route internally to `mrweirdo-doctor`;
- Gmail confirmation sync only: route internally to `mrweirdo-confirm`.

## Defaults And Safety

- Auto-apply threshold: `fit_score >= 5`.
- Stable batch auto-submit ATS: Greenhouse and Ashby.
- Per-company quota guard stays on for the user's local `company_list.user.json`.
- LinkedIn, Indeed, Glassdoor, non-GH/Ashby platforms, and
  `legitimacy="suspicious"` rows go to manual review.
- Do not invent personal facts. Visa, GPA, demographic, legal attestation,
  background-check, relocation, and salary-acceptance facts require explicit
  user input or must stay null/blocking.
- Do not run real apply batches in background mode. The user should see row
  progress and have an interrupt window.

## References

Read these only when needed:

- `references/intake-and-profile.md`: hard-boundary questions, profile/search
  JSON shape, adaptive follow-up rules, and parse soft-window rules.
- `references/run-and-database.md`: local DB contract, discovery/scoring/store
  commands, auto-apply supervisor, report, and pruning.
- `../../../shared/scoring/score_prompt.md`: required scoring rubric.
- `../../../shared/profile.template.json`: runtime `profile.json` shape.
- `../../../shared/intelligence/intent_schema.json`: `search_intent.json` schema.
- `../../../shared/references/truthfulness.md`: truthfulness rules for any
  agent-drafted open-text answer.

## Step 0 - Preflight

Show a short preamble. For first run:

```text
Welcome to Mr. Weirdo Jobs.

Send me your resume PDF path. You may add one or two optional sentences about
what roles you want, but the resume path is the only required input.
I will ask the hard-boundary questions I must not infer, then start read-only
discovery while you still have a correction window. Before any real submission,
I will show the exact queue and identity block and wait for "开始".
```

Then run:

```bash
cd "$MRWEIRDO_REPO_ROOT"
bash scripts/preflight.sh
```

Stop on any failure and tell the user what to fix.

## Step 1 - Resume, Intro, Hard Boundaries

Ask for one intake message:

```text
Paste the absolute path to your resume PDF. Optional: add one or two sentences
about target roles, preferred industries/functions, or anything applications
should emphasize. If you skip the extra context, I will infer safely from the
resume and leave unknown personal facts blank.
```

Copy the resume:

```bash
cd "$MRWEIRDO_REPO_ROOT"
bash scripts/intake_resume.sh "<path from user>"
```

Read `references/intake-and-profile.md`. Use exactly one AskUserQuestion call
with the three hard-boundary questions A0/A1/A2. For A2, the recommended
default is ask/skip sensitive legal questions when a form actually needs them.
Do not require a self-introduction. Treat `self_intro_raw` as optional and allow
it to be empty. Do not ask soft preference questions here unless the answer
would materially change discovery keywords and fits the one adaptive follow-up
call budget.

If `~/.mrweirdo-jobs/documents/` exists and is non-empty, mention that
`/mrweirdo-expand` can enrich writing memory later. Do not block onboarding on
that branch.

## Step 2 - Generate Local JSON

Read the resume PDF in the main agent session. Use any optional self-introduction
only as extra evidence. Generate:

- `$MRWEIRDO_HOME/profile.json`
- `$MRWEIRDO_HOME/search_intent.json` with required `target_function_anchor`
  (`self_reported_target_functions`, `resume_supported_functions`,
  `adjacent_functions`, `excluded_functions`, `rationale`)
- `$MRWEIRDO_HOME/essay_profile.json`

Use `references/intake-and-profile.md`, `shared/profile.template.json`, and
`shared/intelligence/intent_schema.json`. Mark inferred soft fields in your
summary as `[推断，可改]`; do not mark hard-boundary facts as inferred.
When no self-introduction was provided, generate `essay_profile.json` from the
resume only: infer writing voice, positioning, and proof points only where the
resume supports them; put genuinely unknown writing facts in
`dynamic_questions_to_ask_later` and sensitive/unverified claims in
`hard_no_claims`. Do not block onboarding just because `self_intro_raw` is empty.

Important runtime shape:

```json
"work_authorization": {
  "visa_status": "F-1 OPT eligible",
  "authorized_to_work_us": true,
  "requires_sponsorship_now": false,
  "requires_sponsorship_future": true
}
```

After writing:

```bash
cd "$MRWEIRDO_REPO_ROOT"
bash scripts/secure_profile_files.sh
node shared/validate_user_profile.mjs
```

If validation fails, correct the generated JSON before continuing.

## Step 3 - Parse Soft Window

Show a concise parse summary before discovery:

- name, email, phone;
- school, major, graduation date;
- work authorization and sponsorship values;
- top role directions and industries;
- geography and relocation policy;
- writing themes and hard no-claims;
- exclude keywords.

Do not wait for a separate parse confirmation. Say:

```text
我会先开始只读 discovery；你现在或 discovery 期间都可以纠正。身份事实改完会在
queue gate 再复核；方向类字段如果改动，我会重跑 discovery。
```

If the user corrects identity facts, update the JSON and continue. If they
change target direction, update JSON and restart Step 4.

## Step 4 - Refresh Discovery, Score, Store

Read `references/run-and-database.md`.

```bash
cd "$MRWEIRDO_REPO_ROOT"
node shared/init_db_cli.mjs
node shared/discover_candidates.mjs --plan
node shared/discover_candidates.mjs \
  --run \
  --source-window-size "${MRWEIRDO_SOURCE_WINDOW_SIZE:-1000}"
```

After discovery, summarize the funnel in Chinese: raw discovered, hard-filter
dropped, auto-supported rows, manual rows, and rows to score. Tell the user
they can watch the live dashboard with:

```bash
cd "$MRWEIRDO_REPO_ROOT"
npm run status
```

Score `/tmp/mrweirdo-onboard/to_score.json` in batches of 50 using
`shared/scoring/score_prompt.md`. After each batch, output one line:

```text
评分进度: 100/216（fit≥5 暂计 N）
```

Do not continue until every usable row has a complete score object in
`/tmp/mrweirdo-onboard/scored.json`: `apply_url`, numeric `fit_score`, boolean
`recommended`, `role_type_match`, `dim_scores`, `legitimacy`, and
`legitimacy_signals`.

Store:

```bash
cd "$MRWEIRDO_REPO_ROOT"
node shared/store_scored_jobs.mjs \
  --to-score /tmp/mrweirdo-onboard/to_score.json \
  --scored /tmp/mrweirdo-onboard/scored.json \
  > /tmp/mrweirdo-onboard/db_result.json
```

Summarize stored count, eligible count, manual/unsupported count, quota-guarded
count, suspicious count, and the DB path.

## Step 5 - Queue Gate

Before a real batch, run a dry-run and diagnostics:

```bash
cd "$MRWEIRDO_REPO_ROOT"
node shared/apply_supervisor.mjs --dry-run > /tmp/mrweirdo-onboard/dry-run.json
node shared/queue_diagnostics.mjs --json > /tmp/mrweirdo-onboard/queue-diagnostics.json
```

Surface a compact queue preview. Include company, title, fit score, ATS,
location when available, and mark abnormal liveness/legitimacy fields when
present. If more than seven columns would be needed, keep the main table compact
and list only abnormal rows below it.

Always include this identity block and fixed statement:

```text
将以以下身份提交：<name> / <email> / <phone> / <visa 状态>
自动投 <N> 行 | manual 清单 <M> 行（不会替你投）| quota 保护 <Q> 行 | suspicious 待复核 <S> 行
只有标记 auto 的行会被自动提交；manual 清单在 /tmp/mrweirdo-onboard/manual_or_unsupported.json，系统不会替你处理。
回复"开始"执行，或先指出需要修改的行/字段。
```

Honor requested row drops before the batch starts. Continue only after the user
explicitly says "开始" or an equally clear start command. Do not re-confirm each
row after the batch begins.

Run the real foreground batch:

```bash
cd "$MRWEIRDO_REPO_ROOT"
if [ -n "${MRWEIRDO_MAX_AUTO_APPLY:-}" ]; then
  node shared/apply_supervisor.mjs --real --max "$MRWEIRDO_MAX_AUTO_APPLY"
else
  node shared/apply_supervisor.mjs --real
fi
```

The permission prompt for `--real` is intentional and acts as the second
spending gate. Do not add it to `.claude/settings.json`. The real batch runs a
serial liveness gate before queueing and only blocks `expired`; `uncertain` and
`bot_challenge` rows continue to the ATS driver. Use `--skip-liveness` only as
an explicit escape hatch when the check itself is broken.

## Step 6 - Missing Info Follow-Up And Retry

After every real batch, inspect:

```text
/tmp/mrweirdo-onboard/apply-gap-report.json
/tmp/mrweirdo-onboard/apply-gap-report.md
```

Before asking the user anything, handle open-text answers as agent work. Draft
inline essays, cover-letter style prompts, and other `agent_open_text` fields
from the resume, optional self-introduction, local profile,
`essay_profile.json`, `answer_bank.json`, and
`shared/references/truthfulness.md`. Do not invent facts. For
`agent_attestation` and `agent_profile_backed`, fill only from the local profile
or driver coverage.

If `condensed_missing_questions` is non-empty, ask at most four grouped
questions from that list in one AskUserQuestion call. Present them by impact,
using `unblocks_n_jobs`, for example `补 <field> 可解锁 <N> 个岗位`. Ask only
facts that cannot be safely inferred from the resume or existing profile, and
do not use a fixed checklist. If a category appears as a singleton, keep it as
its own clear question instead of forcing it into an unnatural group.

Never list each job's missing fields line by line for the user. The user should
see the minimal cross-application question set, not a manual application audit.
Leave lower-impact grouped questions for a later batch.

After the user answers, update only that user's local profile/essay/answer
templates as needed, validate, then requeue affected rows:

```bash
cd "$MRWEIRDO_REPO_ROOT"
node shared/validate_user_profile.mjs
node shared/retry_gap_rows.mjs \
  --apply \
  --gap-report /tmp/mrweirdo-onboard/apply-gap-report.json
if [ -n "${MRWEIRDO_MAX_AUTO_APPLY:-}" ]; then
  node shared/apply_supervisor.mjs --real --max "$MRWEIRDO_MAX_AUTO_APPLY"
else
  node shared/apply_supervisor.mjs --real
fi
```

Use the second batch as the conversion-rate check. If the gap report lists
`onboarding_candidates`, summarize the recurring fields for the maintainer.

## Step 7 - Report, Prune, Next Steps

Generate the report and prune without an extra pause:

```bash
cd "$MRWEIRDO_REPO_ROOT"
REPORT_PATH=$(node shared/apply_report.mjs --since "$(date -u +%Y-%m-%d)")
echo "$REPORT_PATH"
node shared/prune_discovered_jobs.mjs \
  --apply \
  --delete-skipped --skipped-days "${MRWEIRDO_PRUNE_SKIPPED_DAYS:-0}" \
  --delete-unusable-url \
  --delete-low-fit --low-fit-days "${MRWEIRDO_PRUNE_LOW_FIT_DAYS:-0}" \
  --delete-unsupported --unsupported-days "${MRWEIRDO_PRUNE_UNSUPPORTED_DAYS:-14}" \
  --delete-stale --stale-days "${MRWEIRDO_PRUNE_STALE_DAYS:-30}" \
  --retry-limit "${MRWEIRDO_PRUNE_RETRY_LIMIT:-3}" \
  --clear-first-run \
  --json > /tmp/mrweirdo-onboard/prune-summary.json
```

End with:

- funnel summary from discovery -> scored -> queued -> submitted -> gaps;
- report path, DB path, and prune one-line summary;
- `manual_or_unsupported.json` location;
- next steps: run `/mrweirdo-confirm` after 48h to sync confirmations,
  `/mrweirdo-tracker` to record OA/interview/rejection progress once available,
  and inspect manual rows separately.
