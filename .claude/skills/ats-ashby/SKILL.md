---
name: ats-ashby
description: Automate Ashby ATS application form filling using real Chrome via CDP. Text fields MUST go through `cdp.mjs typetext` (real keyboard, isTrusted=true) because Ashby's react-hook-form rejects JS-dispatched InputEvents (isTrusted=false). Yes/No buttons take a single click (NOT mousedown). Trigger with "投这个 Ashby URL：<url>" or `/ats-ashby <url>`. User must explicitly authorize Submit per harness classifier rules.
---

# Ashby ATS 投递 skill

Ashby 比 Greenhouse 严格 —— 它的 react-hook-form 会检查 `event.isTrusted`，JS dispatchEvent 出来的 input 事件 (`isTrusted: false`) 会被忽略。所以文本字段必须走 CDP `Input.insertText` 走真键盘。

## 前置要求

1. **Chrome 已启动 + CDP 9222 暴露**（独立 profile，避免污染日常 Chrome）
   ```bash
   ./shared/chrome-cdp-launcher.sh    # open -na 强制独立 instance
   ```
2. **`~/.ats-skills/profile.json` 已填** — name/email/phone/LinkedIn/visa 等（由 `/ats-init` 生成）
3. **简历 PDF 存在** — 路径在 `~/.ats-skills/config.json.resume_path`
4. **Node 24+**（内置 `WebSocket`，`cdp.mjs` 依赖）

## 触发

- `/ats-ashby <apply-url>`
- 或 "投这个 Ashby URL：`<url>`"

## 流程（8 步）

### 1. 健康检查
```bash
export ATS_HOME="${ATS_HOME:-$HOME/.ats-skills}"
export ATS_REPO_ROOT="${ATS_REPO_ROOT:-$ATS_HOME/repo}"
PROFILE="$ATS_HOME/profile.json"
RESUME=$(jq -r .resume_path "$ATS_HOME/config.json" 2>/dev/null || jq -r .resume_path "$PROFILE")
curl -s http://localhost:9222/json/version > /dev/null || bash "$ATS_REPO_ROOT/shared/chrome-cdp-launcher.sh"
[ -f "$RESUME" ] || { echo "Resume not found: $RESUME"; exit 1; }
[ -f "$PROFILE" ] && jq -e . "$PROFILE" > /dev/null   # 验证有效 JSON
```
如缺：报错退出，提示用户跑 `/ats-init`。

### 2. 导航
```bash
TAB=$(node shared/cdp.mjs goto "<APPLY_URL>" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
```
等 2-3s 让 Ashby SPA 完成渲染。

### 3. 注入 helpers + 拿 fill plan
```bash
node shared/cdp.mjs eval $TAB "$(cat shared/ashby_helpers.js); JSON.stringify(Ashby.fillForm($PROFILE_JSON))"
```
返回 `{ ok, plan: [...] }`。每个 plan item 标了 action 类型（typetext / yesno / select / date / upload）。

### 4. 上传简历（plan 里第一个 upload 项）
```bash
node "$ATS_REPO_ROOT/shared/cdp.mjs" upload $TAB "#_systemfield_resume" "$RESUME"
```
Ashby 不像 Lever 有 100MB upload bug，直接 hidden file input 即可。

### 5. 逐项执行 plan（**关键 — 不要走 JS setVal**）

对 `plan` 里每个 item，按 action 类型分发：

- **`action: "typetext"`** → 必须走真键盘：
  ```bash
  node shared/cdp.mjs typetext $TAB "<selector>" "<value>"
  ```
  **不要** 调 `Ashby.setVal()`。setVal 是 JS InputEvent fallback，react-hook-form 大概率忽略（已在 Matterworks、Polymarket、Injective 实测失败）。typetext 走 CDP `Input.insertText` 产生 isTrusted=true 的事件。

- **`action: "yesno"`** → 单次 click，不要 mousedown：
  ```bash
  node shared/cdp.mjs eval $TAB "JSON.stringify(Ashby.clickYesNo('<uuid>', '<Yes|No>'))"
  ```
  Plain `button.click()` 单击即可激活 `_active_` class 并翻 hidden checkbox。**不要** dispatch mousedown — Ashby 把 mousedown+click 当 toggle，连按两次会取消。

- **`action: "select"`** → react-select v5 mousedown 三连：
  ```bash
  node shared/cdp.mjs eval $TAB "Ashby.pickSelect('<fieldId>', '<optionText>').then(r => console.log(JSON.stringify(r)))"
  ```

- **`action: "date"`** → setter + InputEvent，不开 calendar：
  ```bash
  node shared/cdp.mjs eval $TAB "JSON.stringify(Ashby.setDate('<fieldId>', 'MM/DD/YYYY'))"
  ```

- **`action: "upload"`** → 同步骤 4。

每步之间 sleep 0.8-2.0s jitter（避免触发速率反爬）。

### 6. 截图to the user 看
```bash
node shared/cdp.mjs screenshot $TAB /tmp/ashby_pre_submit.png
```
report to the user："已填完 + 简历已上传，截图 `/tmp/ashby_pre_submit.png`。看一眼，确认无误后说『投』我才点 submit。"

### 7. Submit（**等 用户 显式授权**）

⚠️ **不要自动 submit**。Claude Code 的 safety classifier 会拦截未授权的真投递。条件：用户在当前对话明确说 "投" / "submit" / "可以了" 对这一家公司授权。

授权后：
```bash
node shared/cdp.mjs eval $TAB "$(cat shared/ashby_helpers.js); JSON.stringify(Ashby.findSubmit())"
# 拿到 selector，然后：
node shared/cdp.mjs eval $TAB "document.querySelector('<selector>').click(); 'submitted'"
```

### 8. 验证成功
```bash
sleep 3
node shared/cdp.mjs eval $TAB "$(cat shared/ashby_helpers.js); JSON.stringify(Ashby.checkSuccess())"
node shared/cdp.mjs screenshot $TAB /tmp/ashby_success.png
```

**成功判定 = body text 包含 "successfully submitted"**。Ashby 不跳 URL（不是 `/confirmation`），而是 in-place 把 form 替换成绿框 Success panel。**也不要等 confirmation email** — 很多 Ashby 用户（小 YC startup 比如 Uplane F25）没设 auto-reply。

成功后追加一行到 `log/submitted.jsonl`：
```json
{"ts": "<iso>", "ats": "ashby", "url": "<APPLY_URL>", "company": "<inferred>", "screenshot": "/tmp/ashby_success.png"}
```

## Ashby 特殊处理（一行总结）

- 文本字段必须走 `node shared/cdp.mjs typetext` 不要走 JS（react-hook-form 检查 isTrusted）
- Yes/No: `Ashby.clickYesNo(uuid, "Yes"|"No")` 单击，不要 mousedown
- `_systemfield_name` 是 **combined** "Jane Doe"，不分 first/last
- Date picker 直接 setter + InputEvent，不开 calendar
- 成功判定 = body 文字 "successfully submitted"，不是 URL 变化
- 不等 confirmation email — 小 startup 没设 auto-reply

## 错误处理

| 症状 | 处理 |
|---|---|
| `cdp.mjs goto` 404 / 超时 | URL 死了，report to the user + 退出（不写 log） |
| `Ashby.fillForm` 返回 plan 里有 `needs_manual_answer` | 截图 + 列出未知字段ask the user 怎么填 |
| `typetext` 完毕后 value 没进去 | 重试一次；仍失败 → 截图 + report to the user 手填 |
| `clickYesNo` 返回 `click_did_not_activate` | DOM 结构变了，截图 + 报告 |
| `pickSelect` 返回 `option_not_found` | 选项文本对不上，列出实际选项ask the user |
| Submit 后 `checkSuccess.ok = false` | 截图 + 留页面to the user 看（可能是 validation error 没填全） |

## 成功判定

```js
Ashby.checkSuccess()
// → { ok: true, snippet: "...Your application was successfully submitted..." }
```

`ok === true` + 截图存档 = 完成。
