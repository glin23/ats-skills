---
name: mrweirdo-greenhouse-auto
description: v2 auto-submit version of mrweirdo-greenhouse. Fills a Greenhouse ATS application using shared/cdp.mjs + greenhouse_helpers.js AND auto-clicks Submit (no user gate). Used by /mrweirdo-onboard's auto-apply dispatch loop, one URL per invocation. Logs every step to feedback.jsonl for audit. NEVER triggered directly by user — that would invite mis-application. The user-facing single-URL flow with the submit gate preserved is /mrweirdo-greenhouse.
---

# Greenhouse auto-submit (v2 internal helper)

> ⚠️ This skill **auto-clicks Submit**. Per the v2 PRD §"Red lines: retracted vs preserved", the v1 red line "Submit 永远人工" has been retracted for v2's onboard flow. This skill exists to fulfill that contract. It is invoked **by `/mrweirdo-onboard`'s Step 10 dispatch loop**, NOT directly by the user.
>
> If a user invokes this skill directly thinking it's the v1 half-auto Greenhouse helper, **stop and route them to `/mrweirdo-greenhouse`** (which preserves the per-app Submit gate).

## When to trigger

- **ONLY** when the main agent session is executing `/mrweirdo-onboard` Step 10 dispatch and routes a row whose `ats_platform == 'greenhouse'` to this skill.
- The invocation form is implicit (the onboard skill follows the steps below per row in its queue).

## When NOT to trigger

- User says "投这个 Greenhouse URL" (manual single URL) → that's `/mrweirdo-greenhouse` (v1 with Submit gate)
- User says "investigate this URL" / "看看这家" → no auto-submit, refuse and ask what they want
- URL host is NOT one of `*.greenhouse.io` / `boards.greenhouse.io` / `job-boards.greenhouse.io` → reject (caller bug)

## Pre-conditions (verified by `/mrweirdo-onboard` before invoking)

- Chrome CDP 9222 alive
- `~/.mrweirdo-jobs/profile.json` exists with personal/education/work_authorization populated
- Resume PDF exists at `profile.resume_path`
- `ats_platform == 'greenhouse'` for the row being processed
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

## Steps (8, same as v1 mrweirdo-greenhouse — but Step 8 auto-clicks Submit)

### 1. Parse URL

Extract company + role from URL slug + `<title>`. Save as `$COMPANY` / `$ROLE` for log naming.

### 2. Re-verify CDP 9222

```bash
curl -sf http://localhost:9222/json/version > /dev/null || { echo "CDP died mid-run"; exit 1; }
```

If CDP died → log to feedback.jsonl with `outcome=skip, reason=cdp_down`, return. The onboard dispatch loop will continue to the next row (don't abort the batch).

### 3. Navigate to URL

```bash
TAB_JSON=$(node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" goto "$URL")
TAB=$(echo "$TAB_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
```

If 404 / DOM contains "Job is no longer available" / "Job posting has been removed" → skip + log `reason=job_unavailable`, **do NOT proceed**.

### 4. Inject helpers

```bash
node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "$(cat "$MRWEIRDO_REPO_ROOT/shared/greenhouse_helpers.js")"
```

Expected response: `"GH ready: openPicker,pickOption,..."`. If different → skip + log `reason=helpers_inject_fail`.

### 5. `GH.fillForm(profile)`

```bash
PROFILE=$(cat "$MRWEIRDO_HOME/profile.json")
FILL_RESULT=$(node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "(async () => await GH.fillForm($PROFILE))()")
```

Parse the JSON `{filled: N, errors: [...]}`. Errors handling:

- **Empty `errors`** → continue to Step 5.5 (gap-fill pass).
- **`errors` has missing fields** → log them, then run Step 5.5. If gap-fill still leaves required gaps after one pass → skip + log `reason=incomplete_form, errors=[...]`. Never loop more than once.

### 5.5. Inferred-fill pass (covers v2 BLOCKER fix — was unimplemented in pre-2026-05-26 runs)

The default `normalizeProfile` derives a set of `custom_answers` / `picker_answers` keyed by label substring (LinkedIn URL, school, GPA, graduation date, authorized-to-work, sponsorship). These are pre-filled in step 5 above. This step handles the **remaining** gaps after `fillForm` runs — anything `GH.findEmptyRequired()` still reports as unfilled.

```bash
GAPS=$(node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "(() => JSON.stringify(GH.findEmptyRequired()))()")
```

Parse `GAPS` (JSON array of `{id, label, type, required, options?}`). For each entry:

1. **Read the field's label** (e.g. "Are you based in NYC and able to work in our Union Sq office Mon–Fri?").
2. **You (the main agent) infer the answer** from `profile.json` and `search_intent.json` — they're already in your context. Pick the most defensible answer; never invent facts (if the question asks for GPA and `profile.education.gpa === ''`, answer the closest honest equivalent like `"Not listed on resume"` — never fabricate a number).
3. **Dispatch the answer** with the right helper for the field type:

```bash
# For type=text/textarea: set value via the existing helper
node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "(() => GH.setText('$FIELD_ID', $JSON_ENCODED_ANSWER))()"

# For type=react-select (single-pick dropdown): open picker, choose option
node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "(async () => {
  const o = await GH.openPicker('$FIELD_ID');
  if (!o.ok) return o;
  return await GH.pickOption($JSON_ENCODED_ANSWER);
})()"
```

Then re-run `GH.findEmptyRequired()` ONCE. If any required field still empty → skip the row with `reason=incomplete_form_after_gapfill, remaining=[...]`. Do NOT loop a second gap-fill pass — the field is either ambiguous or the form has a control we don't know how to dispatch.

**Hard rules for inferred answers:**
- Never invent numeric values (GPA, salary, years of experience). Say "Not listed on resume" or skip the row.
- For yes/no work-auth / sponsorship questions, derive from `profile.work_authorization` (already in `picker_answers` defaults — only inferred-fill if `fillForm` couldn't match the label).
- For diversity / EEO questions where the user hasn't declared, prefer `"Prefer not to say"` over inventing.
- For "earliest start date" when blank → infer from `search_intent.target_cycle[0]` (e.g. "Summer 2026" → answer "May 2026") rather than guessing.

### 6. Upload resume

```bash
RESUME_PATH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$MRWEIRDO_HOME/profile.json')).resume_path || '$MRWEIRDO_HOME/resume.pdf')")
node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" upload "$TAB" "#resume_input" "$RESUME_PATH" \
  || node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" upload "$TAB" "input[type=file][name=resume]" "$RESUME_PATH"
```

If both upload selectors fail → skip + log `reason=resume_upload_fail`. Common cause: Greenhouse changed selectors; needs helpers patch.

### 7. Pre-submit evidence (for audit log, NOT for user review)

```bash
node "$MRWEIRDO_REPO_ROOT/shared/submission_evidence.mjs" --tab "$TAB" --company "$COMPANY" --job "$ROW_ID" --phase before_submit
```

Scrolls to the bottom (mid-form answers in frame), captures a FULL-PAGE screenshot into `$MRWEIRDO_HOME/log/screenshots/` named `…_before_submit.png`, locked to 600.

**Critical v2 difference vs v1**: This screenshot is **for audit only** — saved to disk, NOT shown to user. The onboard flow does not pause for human review. The user can later run `datasette serve ~/.mrweirdo-jobs/jobs.db` or browse `log/screenshots/` if they want to audit what happened.

### 8. CAPTCHA / sanity check → auto-click Submit → verify success

Before clicking submit, one last automated sanity check (NOT user-facing):

```bash
# Detect VISIBLE CAPTCHA / bot-check elements; if present, SKIP — don't auto-bypass.
# Critical: Greenhouse embeds invisible reCAPTCHA v3 on every form. We must NOT skip on that;
# only block when there's a visible challenge the user would actually have to solve.
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
  # Log: outcome=skip, reason=captcha_present (see blockers array for which kind)
  exit 0
fi
```

If clean, **click Submit**:

```bash
SUBMIT_RESULT=$(node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "(() => {
  const s = GH.findSubmit();
  if (!s.ok) return s;
  document.querySelector(s.selector).click();
  return { clicked: s.selector, ts: Date.now() };
})()")
```

Then verify the submit state through the single shared verdict (no per-platform success regex, no default success):

```bash
sleep 4  # let confirmation page render
EVIDENCE=$(node "$MRWEIRDO_REPO_ROOT/shared/submission_evidence.mjs" --tab "$TAB" --company "$COMPANY" --job "$ROW_ID" --phase after_submit)
VERDICT=$(echo "$EVIDENCE" | python3 -c "import json,sys; print(json.load(sys.stdin)['verdict'])")
```

One command reads the page text + URL (`/confirmation` counts as confirming evidence), judges, then takes a full-page screenshot whose name carries the verdict (`…_after_submitted.png` / `…_after_not_submitted.png` / `…_after_unknown.png`).

Parse `$VERDICT`:

- `submitted` — **the page confirmed it**:
  - Emit a structured final line like `{"outcome":"submitted","job_id":ROW_ID,"post_url":"<current URL>"}`
  - Let onboard call `shared/record_apply_outcome.mjs` to mark the DB row. Do not update `jobs.db` directly inside this helper.
  - Append to `daily_count.jsonl` only from the onboard caller after the recorder says `action:"submitted"`.
  - Append to `feedback.jsonl`: `{outcome:'submitted', auto_submitted:true, screenshot_pre, screenshot_post}`

- `not_submitted` — **the page states failure**:
  - Do NOT click Submit again
  - Emit `{"outcome":"skip","reason":"page_states_failure","deny_hits":<from $EVIDENCE>,...}` and let the onboard recorder mark the DB row. Never report this row as submitted.

- `unknown` — **uncertain submit state**:
  - Do NOT click Submit again (avoid double submissions)
  - Emit `{"outcome":"skip","reason":"submit_verify_fail",...}` and let the onboard recorder mark the DB row.
  - Append to `feedback.jsonl` with both screenshots — these are the forensic record

---

## Pacing (per-row hint, but enforced by onboard caller)

This skill itself doesn't sleep; the calling onboard dispatch loop applies a 30–90s jitter between rows. If invoking this skill standalone for testing, you should also sleep manually.

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

- Does not pause for user confirmation (PRD §"Red lines: retracted")
- Does not retry on failure (one shot per row to avoid double-submits)
- Does not invent answers to free-text questions (uses profile.json + resume only)
- Does not bypass CAPTCHA (skip + log instead)
- Does not modify profile.json or search_intent.json (read-only consumption)

## Critical do-nots

- ❌ Do NOT batch multiple URLs in one skill invocation (caller iterates one at a time)
- ❌ Do NOT click Submit twice on the same form (idempotency — once committed, observe and move on)
- ❌ Do NOT delete or modify the screenshots (forensic audit log)
- ❌ Do NOT skip the CAPTCHA check (Step 8 first half) — auto-bypass is both ineffective and a clear ToS violation flag

## Reference

- `shared/greenhouse_helpers.js` — `fillForm` / `findSubmit` / `findEmptyRequired`
- `shared/submission_evidence.mjs` — the single submit verdict + full-page evidence capture (replaces `GH.checkSuccess()` here)
- `shared/cdp.mjs` — Node 24 WebSocket CDP driver
- v1 manual-submit equivalent: `mrweirdo-greenhouse`
