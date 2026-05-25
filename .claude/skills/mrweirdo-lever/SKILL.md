---
name: mrweirdo-lever
description: Automate Lever ATS application form filling using CDP via shared/cdp.mjs. Trigger with "投这个 Lever URL：<url>" or "/mrweirdo-lever <url>". User must explicitly authorize the final Submit click — skill never auto-submits. v0.8 stable (real prior experience from Lee's Palantir attempt).
---

# Lever ATS 投递 skill — v0.8 stable

低风险地把一个 Lever 申请页（`jobs.lever.co/<company>/<uuid>/apply`）填到 "差最后一下点 Submit" 的状态。所有字段值来自 `profile.json`，简历来自固定路径。**Skill 永远不自动点 Submit** — 最后一步必须由用户在对话里显式说"投这家"。

> **v0.8 status**: stable. Lee has prior real-world experience with Lever (5/13 Palantir attempt, see `feedback_ats_auto_apply_strategy_2026.md`). The 5 known gotchas are encoded in `shared/lever_helpers.js`.

## 何时触发

- 用户说 "用 ats-lever 投这个：`<URL>`"
- 用户说 "投这个 Lever URL：`<URL>`"
- 用户输入 `/mrweirdo-lever <URL>`
- 用户给的 URL host 是 `jobs.lever.co`（任何 `/<company>/<uuid>` 或 `/<company>/<uuid>/apply` 都接）

非 Lever 域名 → 让用户改用 `/mrweirdo-greenhouse` / `/mrweirdo-ashby` / 其他 skill。

## 前置要求

1. **Chrome with CDP 9222 已启动**（Lee 用 lily Profile 7）：
   ```bash
   bash shared/chrome-cdp-launcher.sh
   ```
   验证：`curl -s http://localhost:9222/json/version` 返回 JSON 即 OK。
2. **`shared/profile.json` 存在**，至少含 `full_name / email / phone / linkedin_url / location_text / resume_path`。schema 见 `shared/profile.template.json`。
3. **简历 PDF 可读**：`~/.ats-skills/config.json.resume_path`（由 `/mrweirdo-init` 设置）。**先 `cp` 到 `/tmp/`** — Lever 的 drag-drop 区在 macOS 沙盒外的路径上会触发误报（见 Known gotchas #5）。
4. **Node 24+**：内置 WebSocket 才能跑 `cdp.mjs`。

任意一项缺失 → 不要继续，报告给用户。

## 流程（8 步）

### 1. 解析 URL
确认 host 是 `jobs.lever.co`。提取公司 slug + posting UUID 用于截图命名 + log。若 URL 缺 `/apply` 尾巴，自动补上（Lever 直接 navigate 到 posting page 不会进 form）。

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
404 / DOM 内含 "This job is no longer posted" → 报告退出（写一行到 log），**不**继续填表。

### 4. 注入 helpers
```bash
node shared/cdp.mjs eval "$TAB" "$(cat shared/lever_helpers.js)"
```
应返回 `"Lever ready: setSelectedLocation,waitForResumeStorageId,..."`。

### 5. 上传简历（**先于填表，因为 GOTCHA #2**）

把简历 `cp` 到 `/tmp/` 沙盒，然后 upload 到 hidden file input（**不要**对 drag-drop zone — GOTCHA #5）：

```bash
export ATS_HOME="${ATS_HOME:-$HOME/.ats-skills}"
export ATS_REPO_ROOT="${ATS_REPO_ROOT:-$ATS_HOME/repo}"
PROFILE="$ATS_HOME/profile.json"; [ -f "$PROFILE" ] || PROFILE="$ATS_REPO_ROOT/shared/profile.json"
SRC_RESUME=$(jq -r .resume_path "$ATS_HOME/config.json" 2>/dev/null || jq -r .resume_path "$PROFILE")
cp "$SRC_RESUME" /tmp/
RESUME=/tmp/$(basename "$SRC_RESUME")
node shared/cdp.mjs upload "$TAB" "input[name=resume][type=file]" "$RESUME"
```

Lever 常见 selector：`input[name=resume][type=file]` / `#resume-upload-input` — 哪个 query 到用哪个。

立刻 poll `resumeStorageId`（GOTCHA #3）：
```bash
node shared/cdp.mjs eval "$TAB" "(async () => await Lever.waitForResumeStorageId(8000))()"
```
返回 `{ok: true, storageId: "..."}` 才算后端确认；超时则 retry upload 一次。

### 6. 调用 `Lever.fillForm(profile)` 填表
```bash
PROFILE_JSON=$(cat "$PROFILE")
node shared/cdp.mjs eval "$TAB" "(async () => await Lever.fillForm($PROFILE_JSON))()"
```
读返回的 `{filled, errors, plan}`。`fillForm` 内部会用 `setSelectedLocation()` 把 location 写成 JSON 格式（GOTCHA #1）。errors 非空时把缺的字段列出来 — 后续用户授权前由 skill 或用户手动补。

可选：跑 `Lever.findEmptyRequired()` 看还有哪些必填 visible field 是空的：
```bash
node shared/cdp.mjs eval "$TAB" "Lever.findEmptyRequired()"
```

### 7. 截图给用户预审
```bash
mkdir -p log/screenshots
node shared/cdp.mjs screenshot "$TAB" "log/screenshots/${COMPANY}_pre_submit.png"
```
把截图路径告诉用户。用户看截图后判断是否要补字段、改答案，或直接授权 submit。

也跑一次 error visibility 检查（GOTCHA #4）：
```bash
node shared/cdp.mjs eval "$TAB" "Lever.isErrorMessageVisible()"
```
`visible: false` = OK 继续；`visible: true` 且 messages 含 "100MB" → 大概率是 GOTCHA #5（drag-drop bug），让用户改走 hidden file input。

### 8. 等用户显式授权 → click Submit → 验证 success
**不要**在用户没说"投"之前点 submit（harness classifier 会拦，参考 `feedback_ats_auto_apply_strategy_2026.md`）。

用户明说"投这家 / submit / 投" 后：
```bash
node shared/cdp.mjs eval "$TAB" "(() => { const s = Lever.findSubmit(); if (!s.ok) return s; document.querySelector(s.selector).click(); return {clicked: s.selector}; })()"
sleep 3
node shared/cdp.mjs eval "$TAB" "Lever.checkSuccess()"
node shared/cdp.mjs screenshot "$TAB" "log/screenshots/${COMPANY}_post_submit.png"
```
`checkSuccess()` 返回 `{ok: true, urlMatch: true}` 表示 URL 落到 `/thanks` 路径，是 Lever 标准成功标志。

**Submit 失败时（GOTCHA #2）**：Lever 会回滚 resume + selectedLocation。retry 前必须**重做 step 5 + 重新 setSelectedLocation**，其他文本字段保留。

成功后 append 一行 JSON 到 `log/submitted.jsonl`：
```json
{"ts": "<iso>", "ats": "lever", "url": "<url>", "company": "<name>", "role": "<title>", "success": true}
```

## Known Lever gotchas

实测于 2026-05-13 Lee 第一次投 Palantir 时踩到（投了一遍失败 + 一次重试成功）。这 5 个坑全部在 `shared/lever_helpers.js` 里有 workaround 实现。

| # | 坑 | 现象 | Workaround |
|---|---|---|---|
| 1 | `#selected-location` 必须是 **JSON 格式** | `el.value = "Babson Park, MA"` 后 submit 抛 `SyntaxError: Unexpected token B in JSON at position 0` | `Lever.setSelectedLocation(text)` 自动 `JSON.stringify({name: text})` |
| 2 | 失败 submit 后 **resume + selectedLocation 被回滚** | retry 时 resumeStorageId 空了，再 submit 又失败 | retry 前**必须**重 upload resume + 重 setSelectedLocation；其他字段保留 |
| 3 | Resume upload 完成靠 **`resumeStorageId` 非空** 判断 | upload 后立刻 submit 会被后端拒 — 文件还没真的写完 | `Lever.waitForResumeStorageId(8000)` poll 到非空再继续 |
| 4 | 隐藏 `.error-message "File exceeds 100MB"` 是**模板默认值** | text-match 给 false positive，以为 upload 失败 | `Lever.isErrorMessageVisible()` 用 `offsetParent !== null` 真验显示 |
| 5 | drag-drop zone 在 macOS 触发 **100MB 误报 bug** | 简历明明 116KB，drop 后 Lever 显示 "File exceeds 100MB" | 直接 `cdp.mjs upload` 到 hidden `<input type="file">`，**不要**模拟 drop |

## 错误处理

| 情形 | 处理 |
|---|---|
| URL 返回 404 / "no longer posted" | 报告 + 退出，不写 log（不算投递） |
| `Lever.fillForm` `errors` 非空 | 列出 errors，让用户手动补（或更新 profile.json 后重投） |
| `waitForResumeStorageId` 超时 | retry upload 一次；仍失败 → 报告退出，让用户手动 |
| Submit 后 `checkSuccess.ok === false` | 截图 `*_post_submit_fail.png`；按 GOTCHA #2 重做 step 5 + setSelectedLocation 后再 retry 一次；仍失败则报告 |
| Chrome CDP 9222 不响应 | 尝试 `chrome-cdp-launcher.sh` 重启一次；仍失败则报错退出 |
| 简历 PDF 路径不存在 | 报错退出 |

## 成功判定

`Lever.checkSuccess()` 返回 `ok: true`，依据：
1. `location.pathname` 含 `/thanks` 或 `/thank-you`（Lever 标准成功路径），或
2. Body text 含 "thanks for applying" / "application has been submitted" / "application has been received"

两者满足其一即可。截图是辅助证据。

## 不要做的事

- 不要自动 submit — submit 是 8 步的最后一步，必须用户显式授权
- 不要从 skill 里硬编码任何 Lee 个人信息 — 全部从 `profile.json` 读
- 不要 batch 多个 URL — 一次 skill 调用 = 一个 URL
- 不要对 drag-drop zone 模拟 drop 事件 — 必踩 GOTCHA #5
- 不要把简历从 Desktop 直接 upload — 先 `cp /tmp/` 沙盒
- 不要绕过 harness classifier（混淆 selector / 改名 / 拆 eval 等）— 那是 malicious bypass
- 不要在 fail 时删除 profile.json 或截图 — 用户要 retry / debug

## 参考

- `shared/lever_helpers.js` — 5 个 gotcha 的 workaround 实现
- `shared/sourcing/lever_board_api.mjs` — sourcing client（含 `salary` 提取）
- `shared/cdp.mjs` — Node 24 WebSocket CDP driver
- `~/.claude/projects/-Users-lee/memory/feedback_ats_auto_apply_strategy_2026.md` — 5/13 Palantir 实战 + harness classifier 行为
- ATS 标准答案库（Notion）：用户 workspace root page，id 在 `~/.ats-skills/config.json.notion_root_page_id`
