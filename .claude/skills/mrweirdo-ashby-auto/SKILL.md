---
name: mrweirdo-ashby-auto
description: v2 auto-submit version of mrweirdo-ashby. Fills an Ashby ATS application using shared/cdp.mjs + ashby_helpers.js AND auto-clicks Submit (no user gate). Used by /mrweirdo-onboard's auto-apply dispatch loop, one URL per invocation. Logs every step to feedback.jsonl for audit. NEVER triggered directly by user — that would invite mis-application. The user-facing single-URL flow with the submit gate preserved is /mrweirdo-ashby.
---

# Ashby auto-submit (v2 internal helper)

> ⚠️ This skill **auto-clicks Submit**. Per the v2 PRD §"Red lines: retracted vs preserved", the v1 red line "Submit 永远人工" has been retracted for v2's onboard flow. This skill exists to fulfill that contract. It is invoked **by `/mrweirdo-onboard`'s Step 10 dispatch loop**, NOT directly by the user.
>
> If a user invokes this skill directly thinking it's the v1 half-auto Ashby helper, **stop and route them to `/mrweirdo-ashby`** (which preserves the per-app Submit gate).

## When to trigger

- **ONLY** when the main Claude session is executing `/mrweirdo-onboard` Step 10 dispatch and routes a row whose `ats_platform == 'ashby'` to this skill.

## When NOT to trigger

- User says "投这个 Ashby URL" (manual single URL) → that's `/mrweirdo-ashby` (v1 with Submit gate)
- URL host is NOT `jobs.ashbyhq.com` → reject (caller bug)

## Pre-conditions (verified by `/mrweirdo-onboard` before invoking)

- Chrome CDP 9222 alive
- `~/.mrweirdo-jobs/profile.json` exists with personal/education/work_authorization populated
- Resume PDF exists at `profile.resume_path`
- `ats_platform == 'ashby'` for the row being processed
- Row passed all gating in onboard Step 8 (fit_score ≥ threshold, NOT large-cap, daily cap not hit)

If any pre-condition fails on entry, log skip + return — do NOT attempt to fill.

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

After execution, run `Ashby.findEmptyRequired()` to confirm zero gaps. If gaps remain → main Claude (you) reasons over `profile.json` to fill them semantically (one pass via the same action types above). Still incomplete → skip + log `reason=incomplete_form, remaining=[...]`.

### 6. Upload resume

```bash
RESUME_PATH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$MRWEIRDO_HOME/profile.json')).resume_path || '$MRWEIRDO_HOME/resume.pdf')")
# Ashby selector varies; try common ones
for SEL in 'input[type=file][name=_systemfield_resume]' 'input[type=file][data-testid*=resume]' 'input[type=file]'; do
  node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" upload "$TAB" "$SEL" "$RESUME_PATH" && break
done || { echo "skip: resume_upload_fail"; exit 0; }
```

### 7. Pre-submit screenshot (audit only)

```bash
mkdir -p "$MRWEIRDO_HOME/log/screenshots"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%S)
SHOT="$MRWEIRDO_HOME/log/screenshots/${COMPANY}_ashby_${TIMESTAMP}_pre_submit.png"
node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" screenshot "$TAB" "$SHOT"
```

Saved to disk for forensic audit. NOT shown to user.

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
SUCCESS=$(node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval "$TAB" "Ashby.checkSuccess()")

SHOT_POST="$MRWEIRDO_HOME/log/screenshots/${COMPANY}_ashby_${TIMESTAMP}_post_submit.png"
node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" screenshot "$TAB" "$SHOT_POST"
```

Parse `$SUCCESS`:

- `{ok: true}` (Ashby confirms via "successfully submitted" body text) — **success**:
  - Mark DB row: `status='✅ 已投'`, `auto_submitted_at=now`, `bot_note='mrweirdo-ashby-auto v2'`
  - Append `daily_count.jsonl` (caller handles)
  - Append `feedback.jsonl`: `{outcome:'success', auto_submitted:true, ats:'ashby', screenshot_pre, screenshot_post}`

- `{ok: false}` — **uncertain**:
  - Do NOT click Submit again
  - Mark DB row: `status='⚠️ 跳过未投'`, `skip_reason='submit_verify_fail'`
  - Forensic screenshots both saved

---

## What this skill DOES NOT do

- Does not pause for user confirmation
- Does not retry on failure (one shot per row)
- Does not invent answers (verbatim only)
- Does not bypass CAPTCHA (skip + log)

## Reference

- `shared/ashby_helpers.js` — `fillForm` (plan-returning) / `findSubmit` / `checkSuccess` / `findEmptyRequired` / `pickSelect` / `setSelectedLocation`
- `shared/cdp.mjs` — Node 24 WebSocket CDP driver
- v2 PRD: `/Users/lee/.claude/plans/smooth-orbiting-bentley.md`
- v1 manual-submit equivalent: `.claude/skills/mrweirdo-ashby/SKILL.md`
