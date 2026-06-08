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
node "$MRWEIRDO_REPO_ROOT/shared/local_db.mjs" init
```

Generate a per-run ID:

```bash
export RUN_ID="run-$(date -u +%Y%m%dT%H%M%S)-$(openssl rand -hex 4)"
```

Discovery:

```bash
node "$MRWEIRDO_REPO_ROOT/shared/discover_candidates.mjs" --plan
node "$MRWEIRDO_REPO_ROOT/shared/discover_candidates.mjs" \
  --run \
  --run-id "$RUN_ID" \
  --source-window-size "${MRWEIRDO_SOURCE_WINDOW_SIZE:-1000}"
```

If `--source-window-offset` is omitted, the skill reads
`$MRWEIRDO_HOME/source_cursor.json` and advances it only after a discovery run
finishes. This makes run 2 inspect the next source slice, run 3 the slice after
that, and so on. Use `--source-window-size 0` only for a full source-list crawl.

Scoring is done by the main agent using `shared/scoring/score_prompt.md` over
`/tmp/mrweirdo-onboard/to_score.json`, writing
`/tmp/mrweirdo-onboard/scored.json`. `to_score.json` is limited to currently
auto-supported Greenhouse/Ashby/Lever job rows. Manual-only and unsupported URLs
are kept in `/tmp/mrweirdo-onboard/manual_or_unsupported.json` for review, but
they do not consume the batch auto-apply scoring budget.
Discovery also writes `/tmp/mrweirdo-onboard/discovery_funnel.json`, which
shows the run's raw discovery count, hard-filter drops, auto-supported rows,
manual rows, and score-cap drops.

Before storing, make sure every usable row in `to_score.json` has one complete
score object in `scored.json`: `apply_url`, numeric `fit_score`, boolean
`recommended`, and `role_type_match`. If scoring was interrupted, finish the
missing rows first. The store script intentionally fails on partial scoring
unless `--allow-partial-scores` is passed for an explicit debug run.

Store scored job rows and recompute eligibility:

```bash
node "$MRWEIRDO_REPO_ROOT/shared/store_scored_jobs.mjs" \
  --run-id "$RUN_ID" \
  --to-score /tmp/mrweirdo-onboard/to_score.json \
  --scored /tmp/mrweirdo-onboard/scored.json \
  > /tmp/mrweirdo-onboard/db_result.json
```

Run the guarded batch apply supervisor:

```bash
MRWEIRDO_MAX_AUTO_APPLY="${MRWEIRDO_MAX_AUTO_APPLY:-10}" \
  node "$MRWEIRDO_REPO_ROOT/shared/apply_supervisor.mjs" \
    --real \
    --max "${MRWEIRDO_MAX_AUTO_APPLY:-10}"
```

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

Do not ask the user to write open-text answers such as ISA/cover-letter style
prompts when the resume and self-introduction contain enough material. Those
belong in the agent work bucket and should be answered or templated before the
retry.

Generate report:

```bash
REPORT_PATH=$(node "$MRWEIRDO_REPO_ROOT/shared/apply_report.mjs" --since "$(date -u +%Y-%m-%d)")
echo "$REPORT_PATH"
```

Prune disposable discovered rows after the report:

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

## Eligibility

`store_scored_jobs.mjs` marks a row auto-apply eligible only when:

- fit score is at or above the configured threshold, default 5;
- scorer sets `recommended: true`;
- role type matches the user's `role_type_targets`;
- company is not quota-guarded in the user's local `company_list.user.json`;
- ATS is in the stable auto-submit set, currently Greenhouse, Ashby, and Lever.

Workday, SmartRecruiters, iCIMS, JobVite, and Handshake may be discovered/scored, but are not part of the stable batch auto-submit path unless a later skill version explicitly changes that.

## Queue Visibility

Before a real batch submits, surface the queued rows to the user: company, title, fit score, ATS, and location. This is visibility for the batch, not per-application confirmation. Honor any rows the user asks to drop before the loop starts.

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
