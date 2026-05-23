---
name: ats-greenhouse
description: Automate Greenhouse ATS application form filling using CDP via shared/cdp.mjs. Trigger with "投这个 Greenhouse URL：<url>" or "/ats-greenhouse <url>". User must explicitly authorize the final Submit click — skill never auto-submits.
---

# Greenhouse ATS 投递 skill

低风险地把一个 Greenhouse 申请页填到 "差最后一下点 Submit" 的状态。所有字段值来自 `profile.json`，简历来自固定路径。**Skill 永远不自动点 Submit** — 最后一步必须由用户在对话里显式说"投这家"。

## 何时触发

- 用户说 "用 ats-greenhouse 投这个：`<URL>`"
- 用户说 "投这个 Greenhouse URL：`<URL>`"
- 用户输入 `/ats-greenhouse <URL>`
- 用户给的 URL host 是 `boards.greenhouse.io` / `job-boards.greenhouse.io` / `<company>.greenhouse.io`

非 Greenhouse 域名 → 让用户改用 `/ats-ashby` 或其他 skill。

## 前置要求

1. **Chrome with CDP 9222 已启动**，使用隔离 profile（Lee 用 lily Profile 7）：
   ```bash
   bash shared/chrome-cdp-launcher.sh
   ```
   验证：`curl -s http://localhost:9222/json/version` 返回 JSON 即 OK。
2. **`shared/profile.json` 存在**，至少包含 `first_name / last_name / email / phone / phone_country / linkedin_url / resume_path / country_label`。schema 见 `shared/profile.template.json`。
3. **简历 PDF 可读**：`profile.resume_path`（Lee 默认 `/Users/lee/Desktop/Lee_Lin_Resume.pdf`）。
4. **Node 24+**：内置 WebSocket 才能跑 `cdp.mjs`。

任意一项缺失 → 不要继续，报告给用户。

## 流程（8 步）

### 1. 解析 URL
确认 host 含 `greenhouse.io`。提取公司名 + role 名（从 URL slug 或 `<title>`）用于后续截图命名 + log。

### 2. 检查 CDP 9222
```bash
curl -sf http://localhost:9222/json/version > /dev/null || bash shared/chrome-cdp-launcher.sh
```
启动后 sleep 2 再继续。

### 3. 导航到申请页
```bash
TAB_JSON=$(node shared/cdp.mjs goto "<URL>")
TAB=$(echo "$TAB_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
```
404 / DOM 内含 "Job is no longer available" → 报告退出（写一行到 log），**不**继续填表。

### 4. 注入 helpers
```bash
node shared/cdp.mjs eval "$TAB" "$(cat shared/greenhouse_helpers.js)"
```
应返回 `"GH ready: openPicker,pickOption,..."`。

### 5. 调用 `GH.fillForm(profile)` 填表
```bash
PROFILE=$(cat shared/profile.json)
node shared/cdp.mjs eval "$TAB" "(async () => { return await GH.fillForm($PROFILE); })()"
```
读返回的 `{filled, errors}`。errors 非空时，把缺的字段列出来 — 后续用户授权前由 skill 或用户手动补。

### 6. 上传简历
JS 没文件系统访问，必须走 CDP `DOM.setFileInputFiles`：
```bash
node shared/cdp.mjs upload "$TAB" "#resume_input" "$(jq -r .resume_path shared/profile.json)"
```
Greenhouse 常见 selector：`#resume_input` / `input[type=file][name=resume]` — 哪个 query 到用哪个。

### 7. 截图给用户预审
```bash
mkdir -p log/screenshots
node shared/cdp.mjs screenshot "$TAB" "log/screenshots/${COMPANY}_pre_submit.png"
```
把截图路径告诉用户。用户看截图后判断是否要补字段、改答案，或直接授权 submit。

### 8. 等用户显式授权 → click Submit → 验证 success
**不要**在用户没说"投"之前点 submit（harness classifier 会拦，参考 feedback_ats_auto_apply_strategy_2026.md）。

用户明说"投这家 / submit / 投" 后：
```bash
node shared/cdp.mjs eval "$TAB" "(() => { const s = GH.findSubmit(); if (!s.ok) return s; document.querySelector(s.selector).click(); return {clicked: s.selector}; })()"
sleep 3
node shared/cdp.mjs eval "$TAB" "GH.checkSuccess()"
node shared/cdp.mjs screenshot "$TAB" "log/screenshots/${COMPANY}_post_submit.png"
```
`checkSuccess()` 返回 `{ok: true, urlMatch: true}` 表示 URL 含 `/confirmation`，是 Greenhouse 标准成功标志（Lee 的 NICE 投递 5/18 已验证）。

成功后 append 一行 JSON 到 `log/submitted.jsonl`：
```json
{"ts": "<iso>", "ats": "greenhouse", "url": "<url>", "company": "<name>", "role": "<title>", "success": true}
```

## 错误处理

| 情形 | 处理 |
|---|---|
| URL 返回 404 / "Job no longer available" | 报告 + 退出，不写 log（不算投递） |
| `GH.fillForm` `errors` 非空 | 列出 errors，让用户手动补（或更新 profile.json 后重投） |
| Submit 后 `checkSuccess.ok === false` | 截图 `*_post_submit_fail.png`，**不删 profile**，让用户能 retry |
| Chrome CDP 9222 不响应 | 尝试 `chrome-cdp-launcher.sh` 重启一次；仍失败则报错退出 |
| 简历 PDF 路径不存在 | 报错退出 |

## 成功判定

`GH.checkSuccess()` 返回 `ok: true`，依据：
1. `location.pathname` 含 `/confirmation`（Greenhouse 主路径），或
2. Body text 含 "thank you for applying" / "application has been submitted" / "application received"

两者满足其一即可。截图是辅助证据。

## 不要做的事

- 不要自动 submit — submit 是 8 步的最后一步，必须用户显式授权
- 不要从 skill 里硬编码任何 Lee 个人信息 — 全部从 `profile.json` 读
- 不要 batch 多个 URL — 一次 skill 调用 = 一个 URL
- 不要绕过 harness classifier（混淆 selector / 改名 / 拆 eval 等）— 那是 malicious bypass
- 不要在 fail 时删除 profile.json 或截图 — 用户要 retry / debug

## 参考

- `shared/greenhouse_helpers.js` — 所有 react-select v5 / iti phone trick 的实现
- `shared/cdp.mjs` — Node 24 WebSocket CDP driver
- Lee 的 ATS 标准答案库（Notion）：page `35d1e8ce818581e697a9fb4bfd36f250`
