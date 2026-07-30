---
name: mrweirdo-ashby-auto
description: v2 auto-submit version of mrweirdo-ashby. Fills an Ashby ATS application using shared/cdp.mjs + ashby_helpers.js AND auto-clicks Submit (no user gate). Used by /mrweirdo-onboard's auto-apply dispatch loop, one URL per invocation. Logs every step to feedback.jsonl for audit. NEVER triggered directly by user — that would invite mis-application. The user-facing single-URL flow with the submit gate preserved is /mrweirdo-ashby.
---

# Ashby auto-submit (v2 internal helper)

> ⚠️ This skill **auto-clicks Submit**. Per the v2 PRD §"Red lines: retracted vs preserved", the v1 red line "Submit 永远人工" has been retracted for v2's onboard flow. This skill exists to fulfill that contract. It is invoked **by `/mrweirdo-onboard`'s Step 10 dispatch loop**, NOT directly by the user.
>
> If a user invokes this skill directly thinking it's the v1 half-auto Ashby helper, **stop and route them to `/mrweirdo-ashby`** (which preserves the per-app Submit gate).

## When to trigger

- **ONLY** when the main agent session is executing `/mrweirdo-onboard` Step 10 dispatch and routes a row whose `ats_platform == 'ashby'` to this skill.

## When NOT to trigger

- User says "投这个 Ashby URL" (manual single URL) → that's `/mrweirdo-ashby` (v1 with Submit gate)
- URL host is NOT `jobs.ashbyhq.com` → reject (caller bug)

## Pre-conditions (verified by `/mrweirdo-onboard` before invoking)

- Chrome CDP 9222 alive
- `~/.mrweirdo-jobs/profile.json` exists with personal/education/work_authorization populated
- Resume PDF exists at `profile.resume_path`
- `ats_platform == 'ashby'` for the row being processed
- Caller provided a concrete `ROW_ID` from `/mrweirdo-onboard`'s queue
- The DB row still has `auto_apply_eligible=1`, `status='🤖 AI sourced'`,
  `role_type_match IN ('intern','part_time','new_grad_FT')` according to the
  user's selected `role_type_targets`, `apply_quota_limit IS NULL`, and
  `legitimacy != 'suspicious'`, `liveness_status != 'expired'`
- Row passed all gating in onboard Step 8 (fit_score ≥ threshold, recommended, target role type, NOT large-cap, supported platform)

If any pre-condition fails on entry, log skip + return — do NOT attempt to fill.

Run this guard before opening the URL:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
node shared/validate_auto_row.mjs --row-id "$ROW_ID"
```

If it fails, return that reason to the onboard loop and do not navigate.

---

## Ashby-specific notes

- Text fields **MUST** go through `cdp.mjs typetext` (real keyboard, `isTrusted=true`) because Ashby's react-hook-form rejects JS-dispatched InputEvents.
- Yes/No buttons take a single `.click()` (NOT mousedown — that's only for react-select pickers).
- Resume upload typically `input[type=file][name=_systemfield_resume]` or similar — `Ashby.fillForm` discovers selector dynamically.

---

## Steps (8, mirroring mrweirdo-greenhouse-auto)

### 1. Parse URL

Extract company + role from URL slug + `<title>`. Save as `$COMPANY` / `$ROLE` for log naming. Verify host is `jobs.ashbyhq.com`.

### 2. Re-verify CDP 9222

```bash
curl -sf http://localhost:9222/json/version > /dev/null || { echo "CDP died mid-run"; exit 1; }
```

If CDP died → log to feedback.jsonl with `outcome=skip, reason=cdp_down`, return.

### 3. Navigate to URL

```bash
TAB_JSON=$(node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" goto "$URL")
TAB=$(echo "$TAB_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
```

If 404 / DOM contains "Position no longer available" / "Job posting has been removed" → skip + log `reason=job_unavailable`.

### 4. Inject helpers

```bash
node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "$(cat "$MRWEIRDO_REPO_ROOT/shared/ashby_helpers.js")"
```

Expected response contains `"Ashby"` namespace ready. If different → skip + log `reason=helpers_inject_fail`.

### 5. `Ashby.fillForm(profile)` + execute via `ashby_plan_executor.mjs`

```bash
PROFILE=$(cat "$MRWEIRDO_HOME/profile.json")
FILL_PLAN=$(node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "JSON.stringify(Ashby.fillForm($PROFILE))")
```

**Critical Ashby gotcha**: `Ashby.fillForm` returns a **plan** (not a result). Pre-2026-05-26 this skill described what each action *should* do but no caller actually dispatched the plan — every Ashby row silently fell through. Now the executor handles dispatch:

```bash
echo "$FILL_PLAN" > /tmp/mrweirdo-ashby-plan-${RUN_ID}.json
EXEC_RESULT=$(node "$MRWEIRDO_REPO_ROOT/shared/sourcing/_executors/ashby_plan_executor.mjs" "$TAB" /tmp/mrweirdo-ashby-plan-${RUN_ID}.json)
echo "$EXEC_RESULT"
```

The executor dispatches each action via the right driver:
- `typetext` → `cdp.mjs typetext` (CDP `Input.insertText`, `isTrusted=true` — required for Ashby's react-hook-form)
- `upload`   → `cdp.mjs upload` (CDP `DOM.setFileInputFiles`)
- `select`   → in-page `Ashby.pickSelect(fieldId, optionText)`
- `date`     → in-page `Ashby.setDate(fieldId, mmddyyyy)`
- `yesno`    → in-page click on the matching Yes/No button (re-discovers selector by walking up from the checkbox name)

Plan entries with `value: null` (the planner couldn't derive an answer from profile, see BUGS#6) are skipped and reported in `result.skipped[]` for manual handling. Plan entries that fail at dispatch end up in `result.errors[]`.

After execution, run `Ashby.findEmptyRequired()` to confirm zero gaps. If gaps remain → main agent (you) reasons over `profile.json` to fill them semantically (one pass via the same action types above). Still incomplete → skip + log `reason=incomplete_form, remaining=[...]`.

### 6. Upload resume

```bash
RESUME_PATH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$MRWEIRDO_HOME/profile.json')).resume_path || '$MRWEIRDO_HOME/resume.pdf')")
# Ashby selector varies; try common ones
for SEL in 'input[type=file][name=_systemfield_resume]' 'input[type=file][data-testid*=resume]' 'input[type=file]'; do
  node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" upload "$TAB" "$SEL" "$RESUME_PATH" && break
done || { echo "skip: resume_upload_fail"; exit 0; }
```

### 7. Pre-submit evidence (audit only)

```bash
node "$MRWEIRDO_REPO_ROOT/shared/submission_evidence.mjs" --tab "$TAB" --company "$COMPANY" --job "$ROW_ID" --phase before_submit
```

Scrolls to the bottom (so the mid-form answers are actually in frame), captures a FULL-PAGE screenshot into `$MRWEIRDO_HOME/log/screenshots/`, names it `…_before_submit.png`, and locks it to 600. Saved for forensic audit. NOT shown to user.

### 8. CAPTCHA check → auto-click Submit → verify

```bash
# Detect VISIBLE CAPTCHA / bot-check only — invisible reCAPTCHA v3 is signal-only
# and would falsely skip every form (was BUG #4 in pre-2026-05-26 GH skill).
CAPTCHA_CHECK=$(node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "(() => {
  const blockers = [];
  for (const f of document.querySelectorAll('iframe[src*=\"recaptcha\"]')) {
    const src = f.src || '';
    const isInvisible = src.includes('size=invisible') || src.includes('size=invisibl');
    if (!isInvisible) blockers.push('visible_recaptcha');
  }
  if (document.querySelector('iframe[src*=\"hcaptcha\"]')) blockers.push('hcaptcha');
  if (document.querySelector('.cf-challenge, [data-cf-turnstile]')) blockers.push('cf_challenge');
  const t = (document.body.innerText || '').toLowerCase();
  if (t.includes('verify you are human') || t.includes('are you a robot') || t.includes('checking your browser')) blockers.push('challenge_text');
  return { blocked: blockers.length > 0, blockers };
})()")

if echo "$CAPTCHA_CHECK" | grep -q '"blocked":true'; then
  echo "CAPTCHA blocker detected: $CAPTCHA_CHECK — skipping (cannot auto-bypass safely)"
  exit 0  # log: outcome=skip, reason=captcha_present (see blockers array)
fi
```

Click Submit:

```bash
SUBMIT_RESULT=$(node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "(() => {
  const s = Ashby.findSubmit();
  if (!s.ok) return s;
  document.querySelector(s.selector).click();
  return { clicked: s.selector, ts: Date.now() };
})()")

sleep 4
EVIDENCE=$(node "$MRWEIRDO_REPO_ROOT/shared/submission_evidence.mjs" --tab "$TAB" --company "$COMPANY" --job "$ROW_ID" --phase after_submit)
VERDICT=$(echo "$EVIDENCE" | python3 -c "import json,sys; print(json.load(sys.stdin)['verdict'])")
```

One command reads the page text, judges it through the single shared verdict (`shared/submission_evidence.mjs` — confirm/deny tables, no default success), then takes a full-page screenshot whose name carries the verdict (`…_after_submitted.png` / `…_after_not_submitted.png` / `…_after_unknown.png`). File names can no longer contradict the page.

Parse `$VERDICT`:

- `submitted` — the page confirmed it:
  - Emit a structured final line like `{"outcome":"submitted","job_id":ROW_ID,"post_url":"<current URL>"}`
  - Let onboard call `shared/record_apply_outcome.mjs` to mark the DB row. Do not update `jobs.db` directly inside this helper.
  - Append `daily_count.jsonl` only from the onboard caller after the recorder says `action:"submitted"`.
  - Append `feedback.jsonl`: `{outcome:'submitted', auto_submitted:true, ats:'ashby', screenshot_pre, screenshot_post}`

- `not_submitted` — the page states failure (e.g. "We couldn't submit your application", duplicate-application refusal):
  - Do NOT click Submit again
  - Emit `{"outcome":"skip","reason":"page_states_failure","deny_hits":<from $EVIDENCE>,...}` and let the onboard recorder mark the DB row. This row is NOT a submission — never report it as one.

- `unknown` — the page confirmed nothing either way:
  - Do NOT click Submit again
  - Emit `{"outcome":"skip","reason":"submit_verify_fail",...}` and let the onboard recorder mark the DB row.
  - Forensic screenshots both saved

## Report Hook

After the onboard caller gets a successful recorder result, it appends the
submission audit:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
node shared/job_report.mjs --row-id "$ROW_ID" --append-submission
```

`record_apply_outcome.mjs` remains the single DB status writer; this report hook
only reads execution artifacts and updates the row's `report_path`.

---

## What this skill DOES NOT do

- Does not pause for user confirmation
- Does not retry on failure (one shot per row)
- Does not invent answers (verbatim only)
- Does not bypass CAPTCHA (skip + log)

## Reference

- `shared/ashby_helpers.js` — `fillForm` (plan-returning) / `findSubmit` / `findEmptyRequired` / `pickSelect` / `setSelectedLocation`
- `shared/submission_evidence.mjs` — the single submit verdict + full-page evidence capture (replaces `Ashby.checkSuccess()` here)
- `shared/cdp.mjs` — Node 24 WebSocket CDP driver
- v1 manual-submit equivalent: `mrweirdo-ashby`
