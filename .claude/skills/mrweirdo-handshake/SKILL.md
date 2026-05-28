---
name: mrweirdo-handshake
description: "[v0.6 BETA — needs dogfood verification] Automate Handshake (app.joinhandshake.com) application form filling using CDP via shared/cdp.mjs. Detects redirect-to-external-ATS and dispatches to mrweirdo-greenhouse / mrweirdo-ashby / mrweirdo-workday. User Chrome must be pre-authenticated to Handshake. Trigger with '投这个 Handshake URL：<url>' or '/mrweirdo-handshake <url>'. User must explicitly authorize Submit — skill never auto-submits."
---

# Handshake ATS 投递 skill (v0.6 BETA)

> **⚠️ v0.6 beta — not yet dogfood-verified.** `shared/handshake_helpers.js` selectors are
> best-guess based on Handshake Help Center docs + pattern transfer from Ashby/Greenhouse.
> First real submission will reveal where fields/selectors need correction. Treat skill
> output skeptically; screenshot every step.

把 Handshake (`app.joinhandshake.com`) 申请页填到 "差最后一下点 Submit" 的状态。Handshake 有两种 apply 模式 — 内部 "Apply / Quick Apply"（停留在 handshake.com）和 "Apply Externally"（跳到 Greenhouse / Workday / Ashby / 其他）。本 skill 处理前者，并在检测到后者时 dispatch 到对应 ATS skill。

## 何时触发

- 用户说 "用 mrweirdo-handshake 投这个：`<URL>`"
- 用户说 "投这个 Handshake URL：`<URL>`"
- 用户输入 `/mrweirdo-handshake <URL>`
- 用户给的 URL host 是 `app.joinhandshake.com` 或 `joinhandshake.com`

非 Handshake 域名 → 让用户改用 `/mrweirdo-greenhouse` / `/mrweirdo-ashby`。

## 前置要求

1. **Chrome with CDP 9222 已启动**，使用隔离 Chrome profile（保证 Handshake 已登录）：
   ```bash
   bash shared/chrome-cdp-launcher.sh
   ```
2. **Handshake 账号已登录** — Handshake 所有 job pages 都需要 student SSO。隔离 profile 第一次跑时会要用户手动登录一次。
3. **`~/.mrweirdo-jobs/profile.json` 存在**（由 `/mrweirdo-onboard` 生成）。注意：Handshake 大部分字段（学校、邮箱、电话、resume）走 student profile 自动填，所以本地 `profile.json` 主要用于 fallback + 答疑。
4. **简历已在 Handshake Documents 上传** — Handshake 的"上传简历"是 document picker（选已传的 PDF），不是 file input。用户必须事先在 Handshake 个人 documents store 传过简历。
5. **Node 24+**。

任意一项缺失 → 不要继续，报告给用户。

## 已知 v0.6 局限（必读）

- **未 dogfood 验证** — selectors 是 best-guess，第一次跑大概率有字段失败。准备人工修 `handshake_helpers.js`。
- **多步 wizard 不支持** — Handshake 部分 employer 配置多步 apply（preferences / additional questions / final review）。当前 helper 只处理单 page 形式，多步逻辑待 v0.7+。
- **外跳 ATS 仅检测不接管** — `detectRedirectToExternalATS()` 报告 target_ats 后，本 skill 退出并提示用户用对应 skill 跑。未来 v0.7 可改成自动 dispatch（subprocess invocation）。
- **反爬强度未测试** — Handshake 有 daily 300 应用上限（官方），但每分钟/每小时的 throttle 未知。建议 **≤5 投递/天** 直到摸清边界。每次提交后 sleep 30-60s jitter。
- **document picker 默认 "most recent resume"** — 大多数情况这是对的（the user's resume），但如果 Handshake account 里有多版本要明确指定 `profile.document_preferences.resume`。
- **TLS / cookie 反爬** — Handshake 是普通 Cloudflare 站，没有 LinkedIn 级行为分析。但用 the user's真 Chrome session 还是最稳。**严禁 headless / fresh-profile / proxy。**

## 流程（8 步）

### 1. 解析 URL
确认 host 含 `joinhandshake.com`。从 URL slug 提取 job id (`/jobs/<id>` 或 `/emp/jobs/<id>`)。

### 2. 健康检查
```bash
curl -sf http://localhost:9222/json/version > /dev/null || bash shared/chrome-cdp-launcher.sh
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"
export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
PROFILE="$MRWEIRDO_HOME/profile.json"; [ -f "$PROFILE" ] || PROFILE="$MRWEIRDO_REPO_ROOT/shared/profile.json"
ls "$(jq -r .resume_path "$MRWEIRDO_HOME/config.json" 2>/dev/null || jq -r .resume_path "$PROFILE")" > /dev/null
```
缺 → 报错退出。

### 3. 导航
```bash
TAB_JSON=$(node shared/cdp.mjs goto "<URL>")
TAB=$(echo "$TAB_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
sleep 3   # Handshake 是 React SPA，渲染慢
```

### 4. 注入 helpers + 检查登录态 / 外跳
```bash
node shared/cdp.mjs eval "$TAB" "$(cat shared/handshake_helpers.js)"
node shared/cdp.mjs eval "$TAB" "JSON.stringify(Handshake.detectLoginRequired())"
node shared/cdp.mjs eval "$TAB" "JSON.stringify(Handshake.detectRedirectToExternalATS())"
```

处理分支：

| `detectLoginRequired().loginRequired` | 处理 |
|---|---|
| `true` | 截图 + report to the user："请在 Chrome 里登录 Handshake，登录完成后 reply '已登录' 我继续。" 暂停。 |
| `false` | 继续。 |
| `null` (unknown) | 截图to the user 让他判断。 |

| `detectRedirectToExternalATS().redirected` | 处理 |
|---|---|
| `false` | 继续走本 skill 后续步骤。 |
| `true` + target_ats=`greenhouse` | report to the user："Handshake 外跳到 Greenhouse (`<target_url>`) — 建议跑 `/mrweirdo-greenhouse <target_url>`。" 退出。 |
| `true` + target_ats=`ashby` | 同上，dispatch 到 `/mrweirdo-ashby`。 |
| `true` + target_ats=`workday`/`lever`/`icims`/`unknown` | 报告 + 退出，用户 决定。v0.6 暂不支持 workday auto-dispatch。 |

### 5. 触发 Apply UI（如未自动打开）
Handshake 申请通常是 modal — 用户点页面的 "Apply" / "Quick Apply" 才打开。
```bash
node shared/cdp.mjs eval "$TAB" "(() => {
  const btn = Array.from(document.querySelectorAll('button, a')).find(el =>
    /^(Apply|Quick Apply)$/i.test((el.innerText || '').trim()));
  if (!btn) return {ok: false, error: 'no apply button visible'};
  btn.click(); return {ok: true, clicked: btn.innerText.trim()};
})()"
sleep 2
```
"Apply Externally" 出现的话点击会开新 tab — 改走步骤 4 的外跳分支。

### 6. 调用 `Handshake.fillForm(profile)` 拿 plan + 执行
```bash
PROFILE_JSON=$(cat "$PROFILE")
node shared/cdp.mjs eval "$TAB" "(async () => { return await Handshake.fillForm($PROFILE); })()"
```
返回 `{ ok, plan: [...] }`。每 plan item action ∈ `typetext | select | pick_document | yesno`：

- **`action: "typetext"`** → 走 CDP `typetext`（保 isTrusted=true，与 Ashby 同）：
  ```bash
  node shared/cdp.mjs typetext "$TAB" "<selector>" "<value>"
  ```
- **`action: "pick_document"`** + `note: "verify_default_selection"` → 截图确认默认选中的是 用户 最新简历就跳过；不对再调 `Handshake.pickDocument(name, type)`。
- **`action: "pick_document"`** + 明确 `value` → 调 `Handshake.pickDocument(value, documentType)`。
- **`action: "select"`** → `Handshake.pickSelect(fieldId, optionText)`（react-select v5 mousedown 三连）。
- **`action: "yesno"`** → 当前 v0.6 还没确认 Handshake yes/no 长什么样，先截图让用户人工处理 + log 出来好下次完善 helpers。

每步之间 sleep 0.8-2.0s jitter。

### 7. `findEmptyRequired` 二次扫描 + 截图预审
```bash
node shared/cdp.mjs eval "$TAB" "JSON.stringify(Handshake.findEmptyRequired())"
mkdir -p log/screenshots
node shared/cdp.mjs screenshot "$TAB" "log/screenshots/${COMPANY}_handshake_pre_submit.png"
```
列出剩余空字段 → 让 用户 确认是否要补 / profile.json 加字段 / 直接授权 submit。

### 8. 等用户显式授权 → click Submit → 验证 success
**不要**在用户没说"投"之前点 submit（harness classifier 会拦）。

授权后：
```bash
node shared/cdp.mjs eval "$TAB" "(() => { const s = Handshake.findSubmit(); if (!s.ok) return s; document.querySelector(s.selector).click(); return {clicked: s.selector}; })()"
sleep 4   # Handshake submission 处理稍慢
node shared/cdp.mjs eval "$TAB" "JSON.stringify(Handshake.checkSuccess())"
node shared/cdp.mjs screenshot "$TAB" "log/screenshots/${COMPANY}_handshake_post_submit.png"
```

成功后 append 一行到 `log/submitted.jsonl`：
```json
{"ts": "<iso>", "ats": "handshake", "url": "<url>", "company": "<name>", "role": "<title>", "success": true}
```

## Known Limitations (v0.6)

- **未 dogfood 验证** — 所有 selector / DOM 假设需要真投递 verify。第一次跑必失败一些字段。
- **多个 Handshake 公司 redirect 到外部 ATS** — 此 skill 仅处理 native Handshake form；外跳后 dispatch 给 mrweirdo-greenhouse / mrweirdo-ashby（用户手动跑 sub-skill，v0.6 不做 auto-dispatch）。
- **暂未支持 multi-step wizards** — Handshake 部分 employer 配多页 apply 流程，当前只处理单 page。
- **反爬未测试** — 建议 ≤5 投递/天 + 每次后 sleep 30-60s jitter，直到摸到 throttle 边界。Daily 应用 cap 300（官方）。
- **document picker selectors 全是 TODO-verify** — `data-hook` 属性是从 ASU QuickApply-Bot 开源仓库借的，可能已过时。
- **登录态依赖用户 Chrome session** — Handshake 走学校 SSO，automation 无法登录。用户 必须事先在 lily profile 登好。
- **不支持 Apply Externally 内 in-app browser** — 部分 Handshake 实现外跳是开新 window 而不是新 tab，CDP 拿不到。如检测不到 redirect，让用户检查浏览器有没有弹新 window。

## 错误处理

| 情形 | 处理 |
|---|---|
| URL 返回 404 / job closed | 报告 + 退出，不写 log |
| `detectLoginRequired().loginRequired === true` | 暂停 + 提示 用户 登录 + 等"已登录"信号 |
| `detectRedirectToExternalATS().redirected === true` | 报告 target_url + target_ats，让 用户 跑对应 sub-skill，退出 |
| `Handshake.fillForm` plan 里有 `needs_manual_answer` | 截图 + 列出未知字段ask the user |
| `typetext` 后 value 没进去 | 重试 1 次；仍失败 → 截图让 用户 手填 |
| Submit 后 `checkSuccess.ok === false` | 截图 `*_handshake_post_submit_fail.png`，留页面让 user reviews；可能是 multi-step wizard 后面还有 page |
| Handshake 显示 "Daily limit reached" (300) | 报错退出，提醒 用户 改天再投 |
| Chrome CDP 不响应 | 重启 chrome-cdp-launcher.sh 一次；仍失败报错退出 |

## 成功判定

`Handshake.checkSuccess()` 返回 `ok: true` — body text 包含以下任一：
- "Application submitted"
- "You've applied"
- "Thanks for applying"
- "Your application has been submitted/sent"

辅助：截图存档。另外 Handshake 会发 "Application Submitted" 确认邮件（参考官方 help center），但不要等 email（延迟不可控）。

## 不要做的事

- 不要自动 submit — 最后一步必须用户显式授权
- 不要在 fail 时改 helpers.js 静默推进 — 先 raise to the user，由他决定怎么改
- 不要 batch 多个 URL — 一次 skill 调用 = 一个 URL
- 不要绕过 harness classifier（混淆 selector / 拆 eval 等）
- 不要在未登录时尝试自动登录（不要碰 SSO / 学校 portal）
- 不要在 fail 时删除 profile.json 或截图

## 参考

- `shared/handshake_helpers.js` — v0.6 best-guess helpers，每个 selector 旁标 `TODO-verify`
- `shared/cdp.mjs` — Node 24 WebSocket CDP driver
- `shared/sourcing/handshake_search.mjs` — Handshake job search scraper (v0.6 stub)
- Handshake apply 流程官方文档：https://support.joinhandshake.com/hc/en-us/articles/218693418
- Handshake URL 结构: `https://app.joinhandshake.com/jobs/<id>` (student) 或 `/emp/jobs/<id>`
- v0.6 dogfood log（待 用户 第一次跑后填）：`log/handshake_dogfood_2026-XX.md`
