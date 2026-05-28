---
name: mrweirdo-lever-auto
description: v2 auto-submit version of mrweirdo-lever. Fills a Lever ATS application using shared/cdp.mjs + lever_helpers.js AND auto-clicks Submit (no user gate). Used by /mrweirdo-onboard's auto-apply dispatch loop, one URL per invocation. Logs every step to feedback.jsonl for audit. NEVER triggered directly by user — that would invite mis-application. The user-facing single-URL flow with the submit gate preserved is /mrweirdo-lever.
---

# Lever auto-submit (v2 internal helper)

> ⚠️ This skill **auto-clicks Submit**. Per the v2 PRD §"Red lines: retracted vs preserved", the v1 red line "Submit 永远人工" has been retracted for v2's onboard flow. This skill exists to fulfill that contract. It is invoked **by `/mrweirdo-onboard`'s Step 10 dispatch loop**, NOT directly by the user.

## When to trigger

- **ONLY** when the main agent session is executing `/mrweirdo-onboard` Step 10 dispatch and routes a row whose `ats_platform == 'lever'` to this skill.

## When NOT to trigger

- User says "投这个 Lever URL" (manual single URL) → that's `/mrweirdo-lever` (v1 with Submit gate)
- URL host is NOT `jobs.lever.co` → reject (caller bug)

## Pre-conditions (verified by `/mrweirdo-onboard` before invoking)

- Chrome CDP 9222 alive
- `~/.mrweirdo-jobs/profile.json` exists with personal/education/work_authorization populated
- Resume PDF exists at `profile.resume_path`
- `ats_platform == 'lever'` for the row being processed
- Row passed all gating in onboard Step 8

If any pre-condition fails on entry, log skip + return.

---

## Lever-specific notes

- Lever uses an internal `Lever` namespace (`globalThis.Lever`) after helper injection.
- Resume upload goes through a 2-step async flow (upload → wait for `storage_id`); `Lever.waitForResumeStorageId` polls.
- Lever has a `setSelectedLocation` for the geo combobox.
- Per memory `feedback_ats_react_select_mousedown.md`: any react-select picker on Lever (rare) needs `mousedown` event, not `click`. `Lever.openPicker` handles this internally.

---

## Steps (8, mirroring greenhouse-auto / ashby-auto)

### 1. Parse URL

Extract company + role from URL slug + `<title>`. Verify host is `jobs.lever.co`.

### 2. Re-verify CDP 9222

```bash
curl -sf http://localhost:9222/json/version > /dev/null || { echo "CDP died mid-run"; exit 1; }
```

### 3. Navigate to URL

```bash
TAB_JSON=$(node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" goto "$URL")
TAB=$(echo "$TAB_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
```

If 404 / DOM contains "Position no longer accepting applications" / "Job posting was removed" → skip + log `reason=job_unavailable`.

### 4. Inject helpers

```bash
node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "$(cat "$MRWEIRDO_REPO_ROOT/shared/lever_helpers.js")"
```

Expected response contains `"Lever ready"`. If different → skip + log `reason=helpers_inject_fail`.

### 5. `Lever.fillForm(profile)` (async)

```bash
PROFILE=$(cat "$MRWEIRDO_HOME/profile.json")
FILL_RESULT=$(node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "(async () => await Lever.fillForm($PROFILE))()")
```

Parse `$FILL_RESULT` for `{filled, errors}`. Prior Lever dogfood surfaced 5 gotchas — most are now handled inside `lever_helpers.js`, but errors can still occur. If `errors` present:

- Run `Lever.findEmptyRequired()` to get the remaining required fields
- Main Claude (you) reasons over profile.json to fill them semantically (one pass)
- Still incomplete → skip + log `reason=incomplete_form`

### 6. Upload resume

```bash
RESUME_PATH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$MRWEIRDO_HOME/profile.json')).resume_path || '$MRWEIRDO_HOME/resume.pdf')")
for SEL in 'input[type=file][name=resume]' 'input[type=file][data-qa=resume-upload]' 'input[type=file]'; do
  node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" upload "$TAB" "$SEL" "$RESUME_PATH" && break
done || { echo "skip: resume_upload_fail"; exit 0; }

# Lever needs storage_id confirmation — wait up to 15s
node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "(async () => await Lever.waitForResumeStorageId(15000))()"
```

If `waitForResumeStorageId` returns failure → resume upload didn't complete; skip + log `reason=resume_storage_timeout`.

### 7. Pre-submit screenshot (audit only)

```bash
mkdir -p "$MRWEIRDO_HOME/log/screenshots"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%S)
SHOT="$MRWEIRDO_HOME/log/screenshots/${COMPANY}_lever_${TIMESTAMP}_pre_submit.png"
node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" screenshot "$TAB" "$SHOT"
```

### 8. CAPTCHA check → auto-click Submit → verify

```bash
CAPTCHA_CHECK=$(node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "(() => {
  const captchaSelectors = ['iframe[src*=\"recaptcha\"]', 'iframe[src*=\"hcaptcha\"]', '[id*=\"captcha\" i]'];
  const found = captchaSelectors.some(s => document.querySelector(s));
  const text = (document.body.innerText || '').toLowerCase();
  return { found_widget: found, found_text: text.includes('verify you are human') };
})()")

if echo "$CAPTCHA_CHECK" | grep -q '"found_widget":true\|"found_text":true'; then
  echo "CAPTCHA detected — skipping"
  exit 0
fi

# Pre-submit, also check for visible field-validation errors
ERROR_CHECK=$(node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "Lever.isErrorMessageVisible()")
if echo "$ERROR_CHECK" | grep -q '"visible":true'; then
  echo "Field validation error visible — skipping submit"
  exit 0
fi

# Click Submit
SUBMIT_RESULT=$(node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "(() => {
  const s = Lever.findSubmit();
  if (!s.ok) return s;
  document.querySelector(s.selector).click();
  return { clicked: s.selector, ts: Date.now() };
})()")

sleep 5  # Lever sometimes redirects to a confirmation page
SUCCESS=$(node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "Lever.checkSuccess()")

SHOT_POST="$MRWEIRDO_HOME/log/screenshots/${COMPANY}_lever_${TIMESTAMP}_post_submit.png"
node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" screenshot "$TAB" "$SHOT_POST"
```

Parse `$SUCCESS`:

- `{ok: true}` (Lever redirects to a confirmation URL or body text confirms) — **success**:
  - Mark DB row: `status='✅ 已投'`, `auto_submitted_at=now`, `bot_note='mrweirdo-lever-auto v2'`
  - `feedback.jsonl`: `{outcome:'success', auto_submitted:true, ats:'lever', ...}`

- `{ok: false}` — **uncertain**:
  - Do NOT click Submit again
  - Mark DB row: `status='⚠️ 跳过未投'`, `skip_reason='submit_verify_fail'`
  - Both forensic screenshots saved

---

## What this skill DOES NOT do

- Does not pause for user confirmation
- Does not retry on failure (one shot per row)
- Does not invent answers (verbatim only)
- Does not bypass CAPTCHA / visible validation errors

## Reference

- `shared/lever_helpers.js` — `fillForm` (async) / `findSubmit` / `checkSuccess` / `findEmptyRequired` / `waitForResumeStorageId` / `isErrorMessageVisible` / `setSelectedLocation`
- `shared/cdp.mjs` — Node 24 WebSocket CDP driver
- v2 design: auto helpers are internal-only and invoked from `mrweirdo-onboard`
- Lever gotchas: `shared/lever_helpers.js`
- v1 manual-submit equivalent: `mrweirdo-lever`
