---
name: mrweirdo-workday
description: "v0.7 stretch — config-driven Workday ATS submission. NOT a generic Workday solver. Each company needs its own JSON config under shared/workday/companies/<slug>.json describing each wizard step's fields. Pure-DOM heuristics yield <60% coverage across Workday tenants because of variant 'Application Questions' selects, demographic option lists, and tenant-specific data-automation-id naming; per-company config is the practical workaround. Trigger with '投这个 Workday URL：<url>' or `/mrweirdo-workday <url>`. User must explicitly authorize Submit per harness classifier rules. Dogfood pending."
---

# Workday ATS 投递 skill (v0.7 stretch, config-driven)

Workday tenant variant 太多 — 同样一份 "Application Questions" step，Leidos / Salesforce / NVIDIA 的 `data-automation-id` 命名和选项文本都不一样。试过纯 DOM 启发式，覆盖率 <60% 死胡同。所以走 **per-company adapter**：

- 共性 selectors（Save and Continue / file upload / EEO demographic）放在 `shared/workday/workday_helpers.js`
- 公司特异性字段（required Application Questions、source dropdown 的选项映射）放在 `shared/workday/companies/<slug>.json`

工作流是先 parse URL 拿 tenant subdomain → 查 `companies/<slug>.json` → 不存在就报错让 Lee 先做 config → 存在就按 step_definitions 一步步填。

## 前置要求

1. **Chrome 已启动 + CDP 9222 暴露**（独立 profile）
   ```bash
   ./shared/chrome-cdp-launcher.sh
   ```
2. **`profile.json` 已填**（仓库根）— personal.first_name / last_name / email / address.* / phone / linkedin
3. **简历 PDF 存在** — 路径在 `~/.mrweirdo-jobs/config.json.resume_path`（由 `/mrweirdo-init` 设置）
4. **公司 config 存在** — `shared/workday/companies/<slug>.json`，schema 见 `_template.json`
5. **Node 24+**

## 触发

- `/mrweirdo-workday <apply-url>`
- 或 "投这个 Workday URL：`<url>`"

## 流程（8 步）

### 1. URL parse — 抽 tenant subdomain
Workday URL 形如：
```
https://<tenant>.<wdN>.myworkdayjobs.com/<board>/job/<location>/<title>_<reqid>
例: https://leidos.wd5.myworkdayjobs.com/en-US/External/job/Bethesda/Sr-Engineer_R-00159780
```

抽出来：
```bash
URL="<APPLY_URL>"
TENANT=$(echo "$URL" | sed -E 's|https://([^.]+)\..*|\1|')
SLUG="$TENANT"   # 默认拿 tenant subdomain 当 slug；可改
echo "tenant=$TENANT slug=$SLUG"
```

### 2. Pre-flight — 检查 config + 依赖

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"
export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
PROFILE="$MRWEIRDO_HOME/profile.json"; [ -f "$PROFILE" ] || PROFILE="$MRWEIRDO_REPO_ROOT/shared/profile.json"
RESUME=$(jq -r .resume_path "$MRWEIRDO_HOME/config.json" 2>/dev/null || jq -r .resume_path "$PROFILE")
CONFIG="$MRWEIRDO_REPO_ROOT/shared/workday/companies/${SLUG}.json"
test -f "$CONFIG" || { echo "ERROR: No config for $SLUG. Copy $MRWEIRDO_REPO_ROOT/shared/workday/companies/_template.json to $CONFIG and fill in step_definitions. See SKILL.md 'How to add a new company'."; exit 1; }
test -f "$PROFILE" || { echo "ERROR: missing profile.json — run /mrweirdo-init"; exit 1; }
test -f "$RESUME" || { echo "ERROR: resume PDF missing: $RESUME"; exit 1; }
curl -s http://localhost:9222/json/version > /dev/null || bash "$MRWEIRDO_REPO_ROOT/shared/chrome-cdp-launcher.sh"
jq -e '._meta.last_verified != null' "$CONFIG" > /dev/null || echo "WARN: config $SLUG never dogfooded (last_verified=null). Proceeding but expect failures."
```

### 3. Navigate

```bash
TAB=$(node shared/cdp.mjs goto "$URL" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
sleep 3   # let Workday SPA hydrate
```

### 4. Click "Apply" if on job detail page (not yet on application form)

```bash
node shared/cdp.mjs eval $TAB "$(cat shared/workday/workday_helpers.js); document.querySelector('[data-automation-id=\"applyButton\"], a[data-automation-id=\"adventureButton\"]')?.click(); 'clicked'"
sleep 2
```

If Workday demands account creation/signin, Lee handles it manually in the visible Chrome window (do NOT script credentials).

### 5. Inject helpers + apply config per step

For each wizard step, re-inject helpers (page rerenders on Save & Continue) and call `applyCompanyConfig`:

```bash
PROFILE_JSON=$(cat "$PROFILE")
CONFIG_JSON=$(cat "$CONFIG")
PLAN=$(node "$MRWEIRDO_REPO_ROOT/shared/cdp.mjs" eval $TAB "$(cat "$MRWEIRDO_REPO_ROOT/shared/workday/workday_helpers.js"); JSON.stringify(Workday.applyCompanyConfig($CONFIG_JSON, $PROFILE_JSON))")
echo "$PLAN" | jq .
```

The plan looks like:
```json
{ "ok": true, "step": {...}, "detectedStep": {...}, "plan": [
  {"action": "typetext", "selector": "[data-automation-id='legalName--firstName']", "value": "Lee"},
  {"action": "select",   "autoId": "addressSection_countryRegion", "value": "California"},
  {"action": "upload",   "selector": "[data-automation-id='file-upload-input-ref']", "value": "<resume_path from config.json>"},
  {"action": "missing",  "autoId": "...", "profile_path": "..."}  // required field has no value
]}
```

Dispatch each plan item:

- **`action: "typetext"`** → real keyboard:
  ```bash
  node shared/cdp.mjs typetext $TAB "<selector>" "<value>"
  ```
  Many Workday tenants are like Ashby (react-hook-form, checks isTrusted). Don't trust JS InputEvent.

- **`action: "select"`** → click dropdown to open popup, type option text, press Enter:
  ```bash
  node shared/cdp.mjs eval $TAB "Workday.setSelectByAutoId('<autoId>', '<optionText>').then(r => console.log(JSON.stringify(r)))"
  node shared/cdp.mjs typetext $TAB "[data-automation-id='<autoId>']" "<optionText>"
  node shared/cdp.mjs keypress $TAB Enter
  ```

- **`action: "upload"`** → CDP setFileInputFiles:
  ```bash
  node shared/cdp.mjs upload $TAB "<selector>" "<absolute_path>"
  ```

- **`action: "click"`** → button:
  ```bash
  node shared/cdp.mjs eval $TAB "Workday.clickButtonByAutoId('<autoId>')"
  ```

- **`action: "missing"`** → required field has no profile value. STOP, screenshot, ask Lee.

### 6. Checkpoint per step

After each step's plan executes, screenshot + click continue:

```bash
node shared/cdp.mjs screenshot $TAB "/tmp/workday_step_${STEP}.png"
node shared/cdp.mjs eval $TAB "$(cat shared/workday/workday_helpers.js); JSON.stringify(Workday.clickContinue())"
sleep 2   # let next step render
```

Loop back to step 5 with re-injected helpers until `Workday.detectStep().step === 6` (Review) or we hit the final step in the config.

### 7. Final step — submit (wait for Lee's explicit authorization)

⚠️ **Do not auto-submit**. Show Lee `/tmp/workday_pre_submit.png` and the field summary. Wait for Lee to say "投" / "submit" / "可以了".

After authorization:
```bash
node shared/cdp.mjs eval $TAB "document.querySelector('[data-automation-id=\"bottom-navigation-next-button\"], [data-automation-id=\"wizardNavigationNext\"]').click(); 'submitted'"
```

(On the Review step the "Next" button is labeled "Submit Application" but the data-automation-id is usually still `bottom-navigation-next-button`.)

### 8. Verify success

```bash
sleep 5
node shared/cdp.mjs eval $TAB "$(cat shared/workday/workday_helpers.js); JSON.stringify(Workday.checkSuccess())"
node shared/cdp.mjs screenshot $TAB /tmp/workday_success.png
```

Workday success indicators:
- `[data-automation-id="applicationSubmittedPage"]` exists, OR
- body text contains "Your application was submitted" / "Thank you for applying"

Append to `log/submitted.jsonl`:
```json
{"ts": "<iso>", "ats": "workday", "tenant": "<tenant>", "url": "<APPLY_URL>", "screenshot": "/tmp/workday_success.png"}
```

## How to add a new company

This is the contribution flow. Expect ~30 min per company the first time.

1. **Find the company's careers page Workday URL.**
   Pattern: `https://<tenant>.wd<N>.myworkdayjobs.com/<board>/...`. Tenant is the first subdomain (e.g. `leidos`, `salesforce`, `nvidia`). Save the slug = tenant by default.

2. **Pick a representative open job and load it in CDP Chrome.**
   ```bash
   ./shared/chrome-cdp-launcher.sh
   TAB=$(node shared/cdp.mjs goto "<JOB_URL>" | jq -r .id)
   node shared/cdp.mjs eval $TAB "$(cat shared/workday/workday_helpers.js); JSON.stringify(Workday.detectStep())"
   ```

3. **Walk each wizard step in DevTools → Elements panel.**
   For every required field, copy the `data-automation-id` attribute. Common stable IDs:
   - `legalName--firstName`, `legalName--lastName`, `email`, `phone-number`
   - `addressSection_addressLine1`, `addressSection_city`, `addressSection_postalCode`
   - `file-upload-input-ref` (resume)
   - `gender`, `ethnicity`, `hispanicOrLatino`, `veteranStatus`, `disabilityStatus`

   Tenant-specific (these are what break generic solvers):
   - Application Questions step — every question's automation_id is generated server-side per tenant
   - "How did you hear about us" — option list varies (LinkedIn vs Indeed vs Referral)
   - Work-auth / sponsorship questions — sometimes Yes/No buttons, sometimes a dropdown

4. **Use `Workday.findEmptyRequired()` to enumerate fields.**
   ```bash
   node shared/cdp.mjs eval $TAB "$(cat shared/workday/workday_helpers.js); JSON.stringify(Workday.findEmptyRequired(), null, 2)"
   ```
   This returns `[{ autoId, label, type, currentValue }]` for everything required-but-empty on the current step. Copy these into your config.

5. **Copy `_template.json` → `companies/<slug>.json`** and fill:
   - `_meta.company` — human-readable name
   - `_meta.tenant_subdomain`, `_meta.wd_instance`, `_meta.board_slug`
   - `_meta.last_verified` — keep `null` until you've dogfooded an actual submission
   - `step_definitions` — each step's `fields[]`, with `automation_id` + `profile_path` + `type` + `required`
   - For `select` fields with non-obvious option text, populate `options_to_value_map` so `profile.standard_answers.work_authorized = "Yes"` maps to whatever Workday shows ("Yes — I am authorized").

6. **Dogfood + iterate.**
   Run `/mrweirdo-workday <URL>` against a real low-stakes job posting. Every time something fails, update the config. Once a full submission succeeds, set `_meta.last_verified` to today's date.

7. **PR to ats-skills repo** so the community can reuse the config. Strip anything tenant-private before pushing.

## Workday specifics (one-liner each)

- Primary selector is `data-automation-id="..."` — IDs and classes are not stable
- Multi-step wizard rerenders the page on Save & Continue → re-inject helpers each step
- Resume file input: `[data-automation-id="file-upload-input-ref"]` — use `cdp.mjs upload`
- Continue button: `[data-automation-id="bottom-navigation-next-button"]` (sometimes `wizardNavigationNext`)
- Demographic EEO (gender / ethnicity / veteran / disability) — automation_ids are consistent across tenants, option lists are too
- Application Questions step is the variant minefield — that's the whole reason for per-company config
- Many tenants force account creation. Lee handles login manually; do NOT script credentials.
- Success page: `[data-automation-id="applicationSubmittedPage"]` or body text "submitted"

## Error handling

| Symptom | Action |
|---|---|
| `No config for <slug>` | Tell Lee to follow "How to add a new company" |
| `applyCompanyConfig` returns `no_matching_step_in_config` | Config step numbering / names don't match `detectStep()`. Screenshot + ask Lee to inspect |
| `plan[]` contains `action: "missing"` | Required profile field unset. Screenshot + ask Lee to update profile.json or skip company |
| `typetext` value not retained | Try once more; on second failure screenshot + report (some tenants use stricter trust checks) |
| Account creation required | Tell Lee, hand control to the visible Chrome window |
| `clickContinue` returns `continue_button_not_found` | DOM layout changed. Screenshot, fall back to manual click |
| `checkSuccess.ok = false` after submit | Don't write success log. Screenshot + ask Lee to verify in browser |

## Status

**v0.7 stretch — unit-shape sanity-checked, dogfood pending.** The helpers compile and inject cleanly. Real-world end-to-end submission against a live Workday tenant has not yet been verified. Treat each company's first submission as a manual-supervised dogfood until `_meta.last_verified` is set.
