---
name: mrweirdo-greenhouse-auto
description: v2 auto-submit version of mrweirdo-greenhouse. Fills a Greenhouse ATS application using shared/cdp.mjs + greenhouse_helpers.js AND auto-clicks Submit (no user gate). Used by /mrweirdo-onboard's auto-apply dispatch loop, one URL per invocation. Logs every step to feedback.jsonl for audit. NEVER triggered directly by user — that would invite mis-application. The user-facing single-URL flow with the submit gate preserved is /mrweirdo-greenhouse.
---

# Greenhouse auto-submit (v2 internal helper)

> ⚠️ This skill **auto-clicks Submit**. Per the v2 PRD §"Red lines: retracted vs preserved", the v1 red line "Submit 永远人工" has been retracted for v2's onboard flow. This skill exists to fulfill that contract. It is invoked **by `/mrweirdo-onboard`'s Step 10 dispatch loop**, NOT directly by the user.
>
> If a user invokes this skill directly thinking it's the v1 half-auto Greenhouse helper, **stop and route them to `/mrweirdo-greenhouse`** (which preserves the per-app Submit gate).

## When to trigger

- **ONLY** when the main Claude session is executing `/mrweirdo-onboard` Step 10 dispatch and routes a row whose `ats_platform == 'greenhouse'` to this skill.
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
- Row passed all gating in onboard Step 8 (fit_score ≥ threshold, NOT large-cap, daily cap not hit)

If any pre-condition fails on entry, log skip + return — do NOT attempt to fill.

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

- **Empty `errors`** → continue to Step 6 (resume upload)
- **`errors` has missing fields** (e.g. "no first_name input found"): **v2 attempts inferred fill** — log the error, attempt `GH.findEmptyRequired()`, then use main Claude reasoning (you, calling this skill) to fill remaining required fields from `profile.json` semantically. If still incomplete after one pass → skip + log `reason=incomplete_form, errors=[...]`. Do not loop indefinitely.

### 6. Upload resume

```bash
RESUME_PATH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$MRWEIRDO_HOME/profile.json')).resume_path || '$MRWEIRDO_HOME/resume.pdf')")
node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" upload "$TAB" "#resume_input" "$RESUME_PATH" \
  || node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" upload "$TAB" "input[type=file][name=resume]" "$RESUME_PATH"
```

If both upload selectors fail → skip + log `reason=resume_upload_fail`. Common cause: Greenhouse changed selectors; needs helpers patch.

### 7. Pre-submit screenshot (for audit log, NOT for user review)

```bash
mkdir -p "$MRWEIRDO_HOME/log/screenshots"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%S)
SHOT="$MRWEIRDO_HOME/log/screenshots/${COMPANY}_${TIMESTAMP}_pre_submit.png"
node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" screenshot "$TAB" "$SHOT"
```

**Critical v2 difference vs v1**: This screenshot is **for audit only** — saved to disk, NOT shown to user. The onboard flow does not pause for human review. The user can later run `datasette serve ~/.mrweirdo-jobs/jobs.db` or browse `log/screenshots/` if they want to audit what happened.

### 8. CAPTCHA / sanity check → auto-click Submit → verify success

Before clicking submit, one last automated sanity check (NOT user-facing):

```bash
# Detect common CAPTCHA / bot-check elements; if present, SKIP — don't auto-bypass.
CAPTCHA_CHECK=$(node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "(() => {
  const captchaSelectors = ['iframe[src*=\"recaptcha\"]', 'iframe[src*=\"hcaptcha\"]', '[id*=\"captcha\" i]', '.cf-challenge'];
  const found = captchaSelectors.some(s => document.querySelector(s));
  const text = (document.body.innerText || '').toLowerCase();
  const challengeText = text.includes('verify you are human') || text.includes('are you a robot') || text.includes('checking your browser');
  return { found_widget: found, found_text: challengeText };
})()")

if echo "$CAPTCHA_CHECK" | grep -q '"found_widget":true\|"found_text":true'; then
  echo "CAPTCHA detected — skipping (cannot auto-bypass safely)"
  # Log: outcome=skip, reason=captcha_present
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

Then verify success:

```bash
sleep 4  # let confirmation page render
SUCCESS=$(node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "GH.checkSuccess()")

# Post-submit screenshot
SHOT_POST="$MRWEIRDO_HOME/log/screenshots/${COMPANY}_${TIMESTAMP}_post_submit.png"
node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" screenshot "$TAB" "$SHOT_POST"
```

Parse `$SUCCESS`:

- `{ok: true, urlMatch: true}` or text match — **success**:
  - Mark DB row: `status='✅ 已投'`, `auto_submitted_at=now`, `confirmation_url=<current URL>`
  - Append to `daily_count.jsonl` (onboard already handles this from its side)
  - Append to `feedback.jsonl`: `{outcome:'success', auto_submitted:true, screenshot_pre, screenshot_post}`

- `{ok: false}` — **uncertain submit state**:
  - Do NOT click Submit again (avoid double submissions)
  - Mark DB row: `status='⚠️ 跳过未投'`, `skip_reason='submit_verify_fail'`
  - Append to `feedback.jsonl` with both screenshots — these are the forensic record

---

## Pacing (per-row hint, but enforced by onboard caller)

This skill itself doesn't sleep; the calling onboard dispatch loop applies a 30–90s jitter between rows. If invoking this skill standalone for testing, you should also sleep manually.

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

- `shared/greenhouse_helpers.js` — `fillForm` / `findSubmit` / `checkSuccess` / `findEmptyRequired`
- `shared/cdp.mjs` — Node 24 WebSocket CDP driver
- v2 PRD: `/Users/lee/.claude/plans/smooth-orbiting-bentley.md`
- v1 manual-submit equivalent: `.claude/skills/mrweirdo-greenhouse/SKILL.md`
