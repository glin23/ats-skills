---
name: mrweirdo-icims
description: "[v0.8 ALPHA — needs dogfood verification] Automate iCIMS career portal (`careers-*.icims.com`) application form filling using CDP via shared/cdp.mjs. iCIMS REQUIRES account creation; flow includes resume upload + multi-step wizard + EEOC. Trigger with '投这个 iCIMS URL：<url>' or '/mrweirdo-icims <url>'. User must explicitly authorize Submit — skill never auto-submits."
---

# iCIMS ATS 投递 skill (v0.8 ALPHA)

> **⚠️ v0.8 alpha — not yet dogfood-verified.** `shared/icims_helpers.js` selectors are
> best-guess based on iCIMS Career Connector docs + open-source scrapers + sampling
> live `careers-*.icims.com` portals. iCIMS has **massive template variance** —
> classic vs Refresh vs SAP-skin — and selectors will need correction per-tenant on
> first dogfood. Treat skill output skeptically; screenshot every step.

把 iCIMS (`careers-<tenant>.icims.com`) 申请页填到 "差最后一下点 Submit" 的状态。iCIMS 与 Greenhouse/Ashby 不同之处：

1. **强制账户注册**（不像 GH/Ashby 可 guest apply）。
2. **真 file upload**（不像 Handshake document picker），要走 CDP `setFileInputFiles`。
3. **多步 wizard 常见**（Personal Info → Resume → Education → Questions → EEO → Review）。
4. **模板变种多** — 同样是 iCIMS，Thermo Fisher / Ross / Disney 长得不一样。

## 何时触发

- 用户说 "用 mrweirdo-icims 投这个：`<URL>`"
- 用户说 "投这个 iCIMS URL：`<URL>`"
- 用户输入 `/mrweirdo-icims <URL>`
- 用户给的 URL host 匹配 `careers-*.icims.com` 或 `*.icims.com`

非 iCIMS 域名 → 让用户改用对应 skill。

## 前置要求

1. **Chrome with CDP 9222 已启动**（lily Profile，保证 iCIMS account 已登录）：
   ```bash
   bash shared/chrome-cdp-launcher.sh
   ```
2. **iCIMS 账号已注册** — 每个 tenant subdomain 都是独立账户体系（thermofisher 和 cintas 不互通）。第一次投某 tenant 时 用户 必须手动注册一次（邮箱 + 密码 + 简历）。建议用密码管理器记。
3. **`~/.mrweirdo-jobs/profile.json` 存在**（由 `/mrweirdo-onboard` 生成）+ `~/.mrweirdo-jobs/config.json.resume_path` 指向本地 PDF。
4. **Node 24+**。

任意一项缺失 → 不要继续，报告给用户。

## 已知 v0.8 局限（必读）

- **未 dogfood 验证** — selectors 大概率有字段失败；准备人工修 `icims_helpers.js`。
- **模板分裂** — 经典 iCIMS（server-rendered HTML）/ Refresh（React overlay）/ SAP-skin 三种都见过；v0.8 主要照经典模板写，Refresh tenant 第一步先在浏览器手投一次再扩展 helper。
- **多步 wizard 半支持** — `detectStep()` + `findNextStep()` 已有，但每步之间的转场（保存中 / 校验失败回滚）未验证。
- **EEOC + voluntary 自我披露页常被忽略** — iCIMS 大多 tenant 在 Submit 前加 EEOC 表（race / gender / veteran / disability），可全选 "decline to answer"，但选项 ID 是 per-tenant 的，需要 dogfood 后扩 helper。
- **每个 tenant 是独立账户** — 不要试图跨 tenant 复用 cookie / session。
- **反爬强（CloudFront + 部分 Akamai Bot Manager）** — 严格用 the user's真 Chrome session；**严禁 headless / fresh-profile / proxy**。建议 **≤3 投递/天/tenant** 直到摸到 throttle 边界。
- **iCIMS Help / Refresh 大版本之间 selector 变了**，老 GitHub scraper 抓的 `#firstName` 在新版可能是 `[data-automation-id="firstName"]`。

## 流程（8 步）

### 1. 解析 URL
确认 host 含 `icims.com`。从 URL slug 提取 tenant subdomain (`careers-{tenant}.icims.com`) + job id (`/jobs/{reqId}/`).

### 2. 健康检查
```bash
curl -sf http://localhost:9222/json/version > /dev/null || bash shared/chrome-cdp-launcher.sh
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"
export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
PROFILE="$MRWEIRDO_HOME/profile.json"; [ -f "$PROFILE" ] || PROFILE="$MRWEIRDO_REPO_ROOT/shared/profile.json"
RESUME=$(jq -r .resume_path "$MRWEIRDO_HOME/config.json" 2>/dev/null || jq -r .resume_path "$PROFILE")
[ -f "$RESUME" ] || { echo "resume missing: $RESUME"; exit 1; }
```
缺 → 报错退出。

### 3. 导航 + 触发 Apply
```bash
TAB_JSON=$(node shared/cdp.mjs goto "<URL>")
TAB=$(echo "$TAB_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
sleep 3
# iCIMS job detail 页面通常有 "Apply for this job online" 按钮
node shared/cdp.mjs eval "$TAB" "(() => {
  const btn = Array.from(document.querySelectorAll('a, button')).find(el =>
    /apply\s+for\s+this\s+job|apply\s+now/i.test((el.innerText || '').trim()));
  if (!btn) return {ok: false, note: 'no apply button — already on apply page?'};
  btn.click(); return {ok: true, clicked: btn.innerText.trim()};
})()"
sleep 3
```

### 4. 注入 helpers + 检查登录态
```bash
node shared/cdp.mjs eval "$TAB" "$(cat shared/icims_helpers.js)"
node shared/cdp.mjs eval "$TAB" "JSON.stringify(ICIMS.detectLoginRequired())"
node shared/cdp.mjs eval "$TAB" "JSON.stringify(ICIMS.detectStep())"
```

处理分支：

| `detectLoginRequired().loginRequired` | 处理 |
|---|---|
| `true` | 截图 + report to the user："iCIMS 要求登录 `<tenant>` 账户，请在 Chrome 里完成登录后 reply '已登录'。" 暂停。 |
| `false` | 继续。 |
| `null` (unknown) | 截图to the user 让他判断。 |

### 5. 逐步填表（wizard loop）
每个步骤循环执行（最多 6 步，匹配 iCIMS 标准段：Personal / Resume / Education / Work / Questions / EEO / Review）：

```bash
PROFILE_JSON=$(cat "$PROFILE")
for step in 1 2 3 4 5 6; do
  STEP_INFO=$(node shared/cdp.mjs eval "$TAB" "JSON.stringify(ICIMS.detectStep())")
  echo "== Step $step :: $STEP_INFO =="

  # 拿 plan
  PLAN=$(node shared/cdp.mjs eval "$TAB" "JSON.stringify(ICIMS.fillForm($PROFILE))")
  # ... 解析 PLAN，逐项执行（见下面 action 表）
  # 截图本步
  node shared/cdp.mjs screenshot "$TAB" "log/screenshots/${COMPANY}_icims_step${step}.png"

  # 找 Next/Continue；如果是 Submit 直接跳出 loop 等 step 7
  NEXT=$(node shared/cdp.mjs eval "$TAB" "JSON.stringify(ICIMS.findNextStep())")
  if echo "$NEXT" | grep -q '"ok":true'; then
    node shared/cdp.mjs eval "$TAB" "document.querySelector($SEL).click()"
    sleep 2
  else
    break  # 已到最终 Submit
  fi
done
```

每个 plan item action ∈ `typetext | native_select | react_select | file_upload | manual`：

- **`action: "typetext"`** → `node shared/cdp.mjs typetext "$TAB" "<selector>" "<value>"`
- **`action: "native_select"`** → 在 page 内调 `ICIMS.pickNativeSelect(fieldId, value)`
- **`action: "react_select"`** → 调 `ICIMS.pickSelect(fieldId, value)` (Refresh template)
- **`action: "file_upload"`** → `node shared/cdp.mjs setfileinput "$TAB" "<selector>" "$RESUME"`（如 cdp.mjs 暂无此命令，先实现）
- **`action: "manual"`** → 截图 + 让用户人工处理 + log 出来下次完善 helpers

每步之间 sleep 1-2s jitter。

### 6. EEOC + voluntary disclosure 页（如出现）
iCIMS 通常在 Review 前插一页 EEOC。selectors per-tenant，先：
```bash
node shared/cdp.mjs screenshot "$TAB" "log/screenshots/${COMPANY}_icims_eeoc.png"
```
让 user reviews截图决定怎么填（推荐 decline to answer），手填完后 reply "继续"。

### 7. `findEmptyRequired` 二次扫描 + 截图预审
```bash
node shared/cdp.mjs eval "$TAB" "JSON.stringify(ICIMS.findEmptyRequired())"
node shared/cdp.mjs screenshot "$TAB" "log/screenshots/${COMPANY}_icims_pre_submit.png"
```
列出剩余空字段 → 让 用户 确认是否要补 / profile.json 加字段 / 直接授权 submit。

### 8. 等用户显式授权 → click Submit → 验证 success
**不要**在用户没说"投"之前点 submit（harness classifier 会拦）。

授权后：
```bash
node shared/cdp.mjs eval "$TAB" "(() => { const s = ICIMS.findSubmit(); if (!s.ok) return s; document.querySelector(s.selector).click(); return {clicked: s.selector}; })()"
sleep 5  # iCIMS submission 处理较慢（账户校验 + 邮件触发）
node shared/cdp.mjs eval "$TAB" "JSON.stringify(ICIMS.checkSuccess())"
node shared/cdp.mjs screenshot "$TAB" "log/screenshots/${COMPANY}_icims_post_submit.png"
```

成功后 append 到 `log/submitted.jsonl`：
```json
{"ts": "<iso>", "ats": "icims", "tenant": "<tenant>", "url": "<url>", "company": "<name>", "role": "<title>", "success": true}
```

## Known Limitations (v0.8)

- **未 dogfood 验证** — 所有 selector / step detection 是 best-guess，第一次跑必有字段失败。
- **Template variance** — classic vs Refresh vs SAP-skin 三种，v0.8 优先经典；遇到新版本先手投一次，回头扩 helper。
- **每 tenant 独立账号** — 跨 tenant 不复用 session；每个 `careers-X.icims.com` 都要 用户 单独注册一次。
- **多步 wizard 转场未充分测试** — 步骤间校验失败 / 自动 redirect 行为未验证。
- **EEOC 页 selectors 完全 TODO** — 每个 tenant 不同，第一次遇到必须截图人工填。
- **反爬未测试** — 建议 ≤3 投递/天/tenant + 每次后 sleep 60-90s jitter。
- **CDP `setfileinput` 命令** — 如果 `shared/cdp.mjs` 暂无该 helper，需先扩。其原理是 `DOM.setFileInputFiles`。
- **某些 tenant 用 SmartRecruiters / Workday / Eightfold 接管 apply** — 域名仍是 `careers-X.icims.com` 但表单是 iframe 嵌入；helper 抓不到 → 截图退出 + dispatch 提示。

## 错误处理

| 情形 | 处理 |
|---|---|
| URL 返回 404 / job closed | 报告 + 退出，不写 log |
| `detectLoginRequired().loginRequired === true` | 暂停 + 提示 用户 注册/登录 `<tenant>` 账户 |
| `fillForm` plan 里有 `manual` 项 | 截图 + 列出未知字段ask the user |
| `typetext` 后 value 没进去 | 重试 1 次；仍失败 → 截图让 用户 手填 |
| 文件上传 fail | 重试 1 次；仍失败 → 截图让 用户 手传 |
| 多步 wizard 第 N 步 Next 失败 | 截图 + 报错让 user reviews是哪个字段没过校验 |
| Submit 后 `checkSuccess.ok === false` | 截图 `*_icims_post_submit_fail.png`，留页面让 user reviews |
| iCIMS 显示 "Daily limit" / 403 | 报错退出，提醒 用户 改天再投 + 检查反爬触发 |
| Chrome CDP 不响应 | 重启 chrome-cdp-launcher.sh 一次；仍失败报错退出 |

## 成功判定

`ICIMS.checkSuccess()` 返回 `ok: true` — body text 包含以下任一：
- "Application has been submitted/received/sent"
- "Thank you for applying / for your application / for your interest"
- "Your application is complete / was successful"
- "Confirmation number:" / "Confirmation code:"

辅助：截图存档。iCIMS 通常也会发一封 "Application Received" 邮件到注册邮箱。

## 不要做的事

- 不要自动 submit — 最后一步必须用户显式授权
- 不要在 fail 时改 helpers.js 静默推进 — 先 raise to the user
- 不要 batch 多个 URL — 一次 skill 调用 = 一个 URL
- 不要绕过 harness classifier（混淆 selector / 拆 eval 等）
- 不要在未登录时尝试自动 sign-up（注册邮件验证步骤 automation 不可控）
- 不要跨 tenant 复用 cookie / 账户
- 不要在 fail 时删除 profile.json 或截图

## 参考

- `shared/icims_helpers.js` — v0.8 alpha best-guess helpers，每个 selector 旁标 `TODO-verify`
- `shared/sourcing/icims_board_api.mjs` — iCIMS career portal HTML scraper (v0.8 alpha)
- `shared/cdp.mjs` — Node 24 WebSocket CDP driver（注意：可能需扩 `setfileinput` 命令）
- iCIMS Career Connector docs: https://www.icims.com/customer-community/ (gated)
- iCIMS URL 结构: `https://careers-<tenant>.icims.com/jobs/<reqId>/<slug>/job`
- v0.8 dogfood log（待 用户 第一次跑后填）：`log/icims_dogfood_2026-XX.md`
