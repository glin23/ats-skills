# Run And Database Reference

Use this reference during `/mrweirdo-onboard` Steps 4-11.

## Local State Contract

- This is a local skill. State belongs only to the person running it.
- Default state path is `$MRWEIRDO_HOME`, usually `~/.mrweirdo-jobs`.
- The main database is `$MRWEIRDO_HOME/jobs.db`.
- The source window cursor is `$MRWEIRDO_HOME/source_cursor.json`.
- There is no shared company cache, no remote backend, and no bundled demo corpus.
- Checked-in public board slug lists are source enumerators only, not per-user
  job results and not shared company caches.
- Every onboard run is a refresh cycle:
  - bulk discovery crawls the next local source window, not the same first slice;
  - newly found postings are inserted;
  - re-seen postings update `last_seen_at`, `seen_count`, and `discovery_run_id`;
  - submitted and confirmed rows remain as application history;
  - low-fit, skipped, unsupported, repeatedly failed, and stale discovered rows can be pruned after the report.

## Run Commands

Initialize or migrate the local database:

```bash
cd "$MRWEIRDO_REPO_ROOT"
node shared/init_db_cli.mjs
```

Discovery:

```bash
cd "$MRWEIRDO_REPO_ROOT"
node shared/discover_candidates.mjs --plan
node shared/discover_candidates.mjs \
  --run \
  --source-window-size "${MRWEIRDO_SOURCE_WINDOW_SIZE:-1000}"
```

If `--source-window-offset` is omitted, the skill reads
`$MRWEIRDO_HOME/source_cursor.json` and advances it only after a discovery run
finishes. This makes run 2 inspect the next source slice, run 3 the slice after
that, and so on. Use `--source-window-size 0` only for a full source-list crawl.

Scoring is done by the main agent using `shared/scoring/score_prompt.md` over
`/tmp/mrweirdo-onboard/to_score.json`, writing
`/tmp/mrweirdo-onboard/scored.json`. `to_score.json` is limited to currently
auto-supported Greenhouse/Ashby job rows. Manual-only and unsupported URLs
are kept in `/tmp/mrweirdo-onboard/manual_or_unsupported.json` for review, but
they do not consume the batch auto-apply scoring budget.
Discovery also writes `/tmp/mrweirdo-onboard/discovery_funnel.json`, which
shows the run's raw discovery count, hard-filter drops, auto-supported rows,
manual rows, and score-cap drops.

Before storing, make sure every usable row in `to_score.json` has one complete
score object in `scored.json`: `apply_url`, numeric `fit_score`, boolean
`recommended`, `role_type_match`, `dim_scores`, `legitimacy`, and
`legitimacy_signals`. If scoring was interrupted, finish the missing rows
first. The store script intentionally fails on partial scoring unless
`--allow-partial-scores` is passed for an explicit debug run. Old scorer output
without `legitimacy` is accepted as `high`.

Store scored job rows and recompute eligibility:

```bash
cd "$MRWEIRDO_REPO_ROOT"
node shared/store_scored_jobs.mjs \
  --to-score /tmp/mrweirdo-onboard/to_score.json \
  --scored /tmp/mrweirdo-onboard/scored.json \
  > /tmp/mrweirdo-onboard/db_result.json
```

Run the guarded batch apply supervisor:

```bash
cd "$MRWEIRDO_REPO_ROOT"
if [ -n "${MRWEIRDO_MAX_AUTO_APPLY:-}" ]; then
  node shared/apply_supervisor.mjs \
    --real \
    --max "$MRWEIRDO_MAX_AUTO_APPLY"
else
  node shared/apply_supervisor.mjs --real
fi
```

The real supervisor runs `shared/liveness_gate.mjs --batch` before queueing.
Only `liveness_status='expired'` blocks; `uncertain` and `bot_challenge` remain
eligible because the ATS driver still does the page-level verification. Use
`--skip-liveness` only for an explicit recovery run if the liveness checker is
misbehaving.

The real batch writes a JSON summary and generates:

```text
/tmp/mrweirdo-onboard/apply-gap-report.json
/tmp/mrweirdo-onboard/apply-gap-report.md
```

If that report contains `user_questions`, pause before pruning. Ask the user
the grouped factual questions, update this user's local `profile.json` or
`essay_profile.json`, validate the profile, then requeue only the rows from the
gap report and run a retry batch:

```bash
cd "$MRWEIRDO_REPO_ROOT"
node shared/validate_user_profile.mjs
node shared/retry_gap_rows.mjs \
  --apply \
  --gap-report /tmp/mrweirdo-onboard/apply-gap-report.json
if [ -n "${MRWEIRDO_MAX_AUTO_APPLY:-}" ]; then
  node shared/apply_supervisor.mjs \
    --real \
    --max "$MRWEIRDO_MAX_AUTO_APPLY"
else
  node shared/apply_supervisor.mjs --real
fi
```

Do not ask the user to write open-text answers such as ISA/cover-letter style
prompts when the resume and self-introduction contain enough material. Those
belong in the agent work bucket and should be answered or templated before the
retry.

Generate report:

```bash
cd "$MRWEIRDO_REPO_ROOT"
REPORT_PATH=$(node shared/apply_report.mjs --since "$(date -u +%Y-%m-%d)")
echo "$REPORT_PATH"
```

Prune disposable discovered rows after the report:

```bash
cd "$MRWEIRDO_REPO_ROOT"
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

## Eligibility

`store_scored_jobs.mjs` marks a row auto-apply eligible only when:

- fit score is at or above the configured threshold, default 5;
- scorer sets `recommended: true`;
- role type matches the user's `role_type_targets`;
- function relevance is not `function_relevance_too_distant` under
  `shared/function_relevance.mjs`; unknown/ambiguous relevance is held as
  non-blocking and left to the scorer/user-visible review path;
- company is not quota-guarded in the user's local `company_list.user.json`;
- `liveness_status` is not `expired`; `uncertain` and `bot_challenge` are
  visible but not blocking;
- ATS is in the stable auto-submit set, currently Greenhouse and Ashby.
- `legitimacy` is not `suspicious`; suspicious rows keep their fit score but
  are held for manual review.

Lever, Workday, SmartRecruiters, iCIMS, JobVite, and Handshake may be
discovered/scored, but are not part of the stable batch auto-submit path unless
a later skill version explicitly changes that. Lever remains available as a
manual/single-URL helper.

## Queue Visibility

Before a real batch submits, surface the queued rows to the user: company,
title, fit score, ATS, location when available, and any abnormal
legitimacy/liveness signal. This is visibility for the batch, not
per-application confirmation. Honor any rows the user asks to drop before the
loop starts. Always state that manual/unsupported rows are not auto-submitted.

## Final Summary

Report:

- raw discovered count, filtered count, scored count;
- submitted count by ATS;
- skipped counts by reason;
- missing-info questions asked and retry-batch result, if any;
- recurring onboarding candidates from the gap report;
- report path;
- local DB path;
- prune summary;
- reminder that submitted/confirmed history is kept while disposable discovered rows are pruned.
