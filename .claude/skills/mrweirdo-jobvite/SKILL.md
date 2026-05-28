---
name: mrweirdo-jobvite
description: "[v0.8 ALPHA — needs dogfood verification] Automate JobVite (`jobs.jobvite.com/*`) application form filling using CDP via shared/cdp.mjs. Most tenants allow guest apply (no account required); resume upload via file input. Trigger with '投这个 JobVite URL：<url>' or '/mrweirdo-jobvite <url>'. User must explicitly authorize Submit — skill never auto-submits."
---

# JobVite ATS 投递 skill (v0.8 ALPHA)

> **⚠️ v0.8 alpha — not yet dogfood-verified.** `shared/jobvite_helpers.js` selectors are
> best-guess based on JobVite's `.jv-*` class conventions + sampling live boards +
> pattern transfer from Ashby/Greenhouse. First real submission will reveal where
> selectors need correction. Treat skill output skeptically; screenshot every step.

把 JobVite (`jobs.jobvite.com/{tenant}/job/{id}`) 申请页填到 "差最后一下点 Submit" 的状态。JobVite 与 iCIMS 不同的好处：

1. **多数 tenant 支持 guest apply**（不强制注册），降低复杂度。
2. **单页表单为主**（无 wizard 多步），EEOC 也内联。
3. **React SPA + 标准 `.jv-*` 类名**，模板比 iCIMS 一致。

但仍有坑：JobVite 是 React，setVal 可能被 react-hook-form 拦截 → 文本字段还是优先 `cdp.mjs typetext`。

## 何时触发

- 用户说 "用 mrweirdo-jobvite 投这个：`<URL>`"
- 用户说 "投这个 JobVite URL：`<URL>`"
- 用户输入 `/mrweirdo-jobvite <URL>`
- 用户给的 URL host 是 `jobs.jobvite.com`

非 JobVite 域名 → 让用户改用对应 skill。注意：少数公司用 `careers.<company>.com` 做 redirect proxy 到 JobVite — 先看 navigator 跳转后的 host。

## 前置要求

1. **Chrome with CDP 9222 已启动**（隔离 Chrome profile）：
   ```bash
   bash shared/chrome-cdp-launcher.sh
   ```
2. **`~/.mrweirdo-jobs/profile.json` 存在**（由 `/mrweirdo-onboard` 生成）+ `~/.mrweirdo-jobs/config.json.resume_path` 指向本地 PDF。
3. **可选：JobVite 账户登录**。少数 tenant 强制注册（特别是金融行业），多数允许 guest apply。如检测到 sign-in wall → 提示用户登录。
4. **Node 24+**。

任意一项缺失 → 不要继续，报告给用户。

## 已知 v0.8 局限（必读）

- **未 dogfood 验证** — selectors 是 best-guess；第一次跑大概率有字段失败。准备人工修 `jobvite_helpers.js`。
- **React + react-hook-form** — 文本字段强烈推荐 `cdp.mjs typetext`（isTrusted=true）；`setVal` 在部分 tenant silently drops input。
- **field ID 前缀变体** — 有 tenant 用 `#jv-field-first-name`，有 tenant 用 `#firstName`。helper 已 fallback 试两种，但其他 field 不在 helper 范围 → 人工补 selector。
- **EEOC 内联** — 不像 iCIMS 单独一页，EEOC 在 main form 里以 radio group 形式出现。每个 tenant 不一样，需要 dogfood + 截图人工填。
- **JS widget 模式** — 极少数 tenant 把 JobVite 当 widget 嵌到自己网站，DOM 是 iframe 或动态注入；helper 抓不到 → 提示 user uses对应公司官网走 manual。
- **反爬一般** — JobVite 没有 Akamai Bot Manager 这种级别，但还是建议 **≤5 投递/天 + 每次 sleep 30-60s jitter**，直到摸清边界。

## 流程（8 步）

### 1. 解析 URL
确认 host 是 `jobs.jobvite.com`。从 URL slug 提取 tenant + job id (`/{tenant}/job/{jvId}`).

### 2. 健康检查
```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"
export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
PROFILE="$MRWEIRDO_HOME/profile.json"; [ -f "$PROFILE" ] || PROFILE="$MRWEIRDO_REPO_ROOT/shared/profile.json"
curl -sf http://localhost:9222/json/version > /dev/null || bash "$MRWEIRDO_REPO_ROOT/shared/chrome-cdp-launcher.sh"
RESUME=$(jq -r .resume_path "$MRWEIRDO_HOME/config.json" 2>/dev/null || jq -r .resume_path "$PROFILE")
[ -f "$RESUME" ] || { echo "resume missing: $RESUME"; exit 1; }
```
缺 → 报错退出。

### 3. 导航
```bash
TAB_JSON=$(node shared/cdp.mjs goto "<URL>")
TAB=$(echo "$TAB_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
sleep 3  # React SPA 渲染
```

### 4. 注入 helpers + 探测页面状态
```bash
node shared/cdp.mjs eval "$TAB" "$(cat shared/jobvite_helpers.js)"
node shared/cdp.mjs eval "$TAB" "JSON.stringify(JobVite.detectExternalRedirect())"
node shared/cdp.mjs eval "$TAB" "JSON.stringify(JobVite.detectApplyForm())"
```

处理分支：

| `detectExternalRedirect().redirected` | 处理 |
|---|---|
| `false` | 继续。 |
| `true` | report to the user target_url + target_ats=unknown，退出让 用户 决定。 |

| `detectApplyForm` 结果 | 处理 |
|---|---|
| `ok: true` (form 可见) | 继续。 |
| `ok: false, note: form_collapsed_click_apply_button_first` | 在 page 内 click "Apply Now" 触发表单展开，然后再探测一次。 |
| `ok: false, note: apply_form_not_found` | 截图to the user 让他判断。 |

展开折叠表单：
```bash
node shared/cdp.mjs eval "$TAB" "(() => {
  const btn = Array.from(document.querySelectorAll('button, a')).find(el =>
    /^(apply\s+now|apply\s+for\s+this|apply)$/i.test((el.innerText || '').trim()));
  if (!btn) return {ok: false};
  btn.click(); return {ok: true, clicked: btn.innerText.trim()};
})()"
sleep 2
```

### 5. 调用 `JobVite.fillForm(profile)` 拿 plan + 执行
```bash
PROFILE_JSON=$(cat "$PROFILE")
PLAN=$(node shared/cdp.mjs eval "$TAB" "JSON.stringify(JobVite.fillForm($PROFILE_JSON))")
```
返回 `{ ok, plan: [...] }`。每 plan item action ∈ `typetext | select | radio | file_upload | manual`：

- **`action: "typetext"`** → CDP `typetext`（保 isTrusted=true）：
  ```bash
  node shared/cdp.mjs typetext "$TAB" "<selector>" "<value>"
  ```
- **`action: "select"`** → 调 `JobVite.pickSelect(fieldId, optionText)`（会自动判 react-select vs native）。
- **`action: "radio"`** → 调 `JobVite.clickRadio(name, optionText)`。
- **`action: "file_upload"`** → `node shared/cdp.mjs setfileinput "$TAB" "<selector>" "$RESUME"`（若 cdp.mjs 暂无此命令需先扩）。
- **`action: "manual"`** → 截图 + 列出未知字段ask the user，log 出来下次完善 helpers。

每步之间 sleep 0.5-1.5s jitter（JobVite 比 iCIMS 反爬轻）。

### 6. EEOC 内联填充
JobVite EEOC 在 main form 内以 radio group 出现（Race / Gender / Veteran / Disability）。`findEmptyRequired` 会列出 `type: 'radio-group'` 项 + `group_name` + `options`。

推荐策略：
- 全部选 "Decline to self-identify" / "I don't wish to answer"（如果 options 里有）。
- 否则截图让 用户 人工选。

### 7. `findEmptyRequired` 二次扫描 + 截图预审
```bash
node shared/cdp.mjs eval "$TAB" "JSON.stringify(JobVite.findEmptyRequired())"
mkdir -p log/screenshots
node shared/cdp.mjs screenshot "$TAB" "log/screenshots/${COMPANY}_jobvite_pre_submit.png"
```
列出剩余空字段 → 让 用户 确认是否要补 / profile.json 加字段 / 直接授权 submit。

### 8. 等用户显式授权 → click Submit → 验证 success
**不要**在用户没说"投"之前点 submit（harness classifier 会拦）。

授权后：
```bash
node shared/cdp.mjs eval "$TAB" "(() => { const s = JobVite.findSubmit(); if (!s.ok) return s; document.querySelector(s.selector).click(); return {clicked: s.selector}; })()"
sleep 4
node shared/cdp.mjs eval "$TAB" "JSON.stringify(JobVite.checkSuccess())"
node shared/cdp.mjs screenshot "$TAB" "log/screenshots/${COMPANY}_jobvite_post_submit.png"
```

成功后 append 到 `log/submitted.jsonl`：
```json
{"ts": "<iso>", "ats": "jobvite", "tenant": "<tenant>", "url": "<url>", "company": "<name>", "role": "<title>", "success": true}
```

## Known Limitations (v0.8)

- **未 dogfood 验证** — 所有 selector 是 best-guess，第一次跑必有字段失败。
- **field ID 变体** — 不同 tenant 在 `jv-field-` 前缀和裸 ID 之间不一致；helper 标准字段 fallback 两种，custom field 需要逐次手补。
- **react-hook-form 拦截** — 文本字段不要用 setVal，统一走 `cdp.mjs typetext`。
- **EEOC selectors per-tenant** — 不同 tenant 的 race/gender/veteran/disability 选项 id 不同；helper 抓 group_name 但 option 文本需 fallback 模糊匹配。
- **JS widget tenant** — 有公司把 JobVite 当 widget 嵌官网；这种情况 helper 抓不到 → 退出让 用户 manual。
- **反爬未测试** — 建议 ≤5 投递/天，每次后 sleep 30-60s jitter。
- **CDP `setfileinput`** — 如 `shared/cdp.mjs` 暂无该 helper，需先扩（`DOM.setFileInputFiles`）。
- **不支持 LinkedIn / Indeed import** — JobVite 提供 "Apply with LinkedIn" 替代上传简历的路径；当前 helper 只走 file upload，不点 LinkedIn 入口。

## 错误处理

| 情形 | 处理 |
|---|---|
| URL 返回 404 / job closed | 报告 + 退出，不写 log |
| `detectExternalRedirect().redirected === true` | 报告 target_url，让 用户 决定（可能是 widget tenant），退出 |
| `detectApplyForm` 始终 `ok: false` | 截图 + 让 用户 检查页面 / 是否登录态问题 |
| `typetext` 后 value 没进去 | 重试 1 次；仍失败 → 截图让 用户 手填 |
| 文件上传 fail | 重试 1 次；仍失败 → 截图让 用户 手传 |
| `fillForm` plan 含 `manual` 项 | 截图 + 列出未知字段ask the user |
| Submit 后 `checkSuccess.ok === false` | 截图 `*_jobvite_post_submit_fail.png`，留页面让 user reviews；可能 form 验证失败回到 error state |
| JobVite 显示 rate limit / 403 | 报错退出，提醒 用户 改天再投 |
| Chrome CDP 不响应 | 重启 chrome-cdp-launcher.sh 一次；仍失败报错退出 |

## 成功判定

`JobVite.checkSuccess()` 返回 `ok: true` — 满足任一：
- URL 含 `/applied` / `/thank` / `/confirmation`
- body text 包含：
  - "Thank you for applying / for your application / for your interest"
  - "Application has been submitted/received/sent"
  - "We've received your application"
  - "Your application is complete / was successful"

辅助：截图存档。JobVite 通常也会发确认邮件。

## 不要做的事

- 不要自动 submit — 最后一步必须用户显式授权
- 不要在 fail 时改 helpers.js 静默推进 — 先 raise to the user
- 不要 batch 多个 URL — 一次 skill 调用 = 一个 URL
- 不要绕过 harness classifier（混淆 selector / 拆 eval 等）
- 不要在未授权时点 "Apply with LinkedIn"（OAuth 跳转不可控）
- 不要在 fail 时删除 profile.json 或截图

## 参考

- `shared/jobvite_helpers.js` — v0.8 alpha best-guess helpers，每个 selector 旁标 `TODO-verify`
- `shared/sourcing/jobvite_board_api.mjs` — JobVite career portal HTML scraper (v0.8 alpha)
- `shared/cdp.mjs` — Node 24 WebSocket CDP driver（注意：可能需扩 `setfileinput` 命令）
- JobVite Career Portal class conventions: `.jv-careersite`, `.jv-job-list-item`, `.jv-field-*`
- JobVite URL 结构: `https://jobs.jobvite.com/{tenant}/job/{jvId}` (or `/careers/{tenant}/job/{jvId}` legacy)
- v0.8 dogfood log（待 用户 第一次跑后填）：`log/jobvite_dogfood_2026-XX.md`
