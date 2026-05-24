---
name: ats-smartrecruiters
description: Automate SmartRecruiters ATS application form filling via Chrome CDP. v0.8 BETA — scaffold only, NOT yet dogfooded. SmartRecruiters is being migrated to SAP SuccessFactors; selectors may shift mid-rollout. Text fields go through `cdp.mjs typetext` (real keyboard, isTrusted=true) by default; native <select> dropdowns can use `SR.pickSelect`. Trigger with "投这个 SmartRecruiters URL：<url>" or `/ats-smartrecruiters <url>`. User must explicitly authorize Submit per harness classifier rules. Recommended: cap at ≤5 submissions/day until dogfood verifies the flow.
---

# SmartRecruiters ATS 投递 skill (v0.8 BETA — needs dogfood)

⚠️ **未实战验证**。本 skill 基于 Ashby/Greenhouse 经验 + SmartRecruiters Postings API 公开文档写成，**没有真实投递过一次**。在跑前先看 Known Limitations 一节。

## Known Limitations

1. **SAP 迁移风险** — SmartRecruiters 2025 被 SAP 收购，正在逐步迁移到 SuccessFactors (`career.sap.com/...`)。可能遇到：
   - 部分公司已经跳转到 SF 流程（这时本 skill 无法处理，需要走 ats-successfactors 或手投）
   - 同公司不同岗位用不同栈
   - 选择器 / API 在 SAP 整合过程中漂移
2. **零实战** — `findEmptyRequired` / `fillForm` 的选择器是基于 React 表单常见模式 + 公开 jobs.smartrecruiters.com 截图推断的，**没有跟真实 DOM 对过**。第一次跑前，让 Claude 先 `node shared/cdp.mjs eval $TAB "$(cat shared/smartrecruiters_helpers.js); JSON.stringify(SmartRecruiters.findEmptyRequired())"` 看看实际返回，不要直接信任 `fillForm.plan`。
3. **建议 ≤5/天** — 在确认整条 pipeline 稳定前，先小批量跑（每天 ≤5 家 SmartRecruiters）。每次跑完截图存档，发现选择器问题立刻 patch helpers。
4. **Yes/No / 日期 widget 未实现** — Ashby 有的 `clickYesNo` / `setDate` 这版没有；如果遇到自定义问卷需手填或回到 SKILL 加 handler。
5. **react-select 兼容性未知** — `SR.pickSelect` 只处理 native `<select>`。如果 SmartRecruiters 用 react-select，需要参考 `ashby_helpers.js` 加 mousedown 三连。

## 前置要求

1. **Chrome 已启动 + CDP 9222 暴露**（独立 profile，避免污染日常 Chrome）
   ```bash
   ./shared/chrome-cdp-launcher.sh
   ```
2. **`profile.json` 已填**（仓库根）— name/email/phone/LinkedIn 等
3. **简历 PDF 存在** — 默认 `/Users/lee/Desktop/用户_Lin_Resume.pdf`
4. **Node 24+**（内置 `WebSocket`，`cdp.mjs` 依赖）

## 触发

- `/ats-smartrecruiters <apply-url>`
- 或 "投这个 SmartRecruiters URL：`<url>`"

Apply URL 形如 `https://jobs.smartrecruiters.com/<CompanySlug>/<uuid>`。
**先检查 URL** — 如果重定向到 `career.sap.com` 或 `careers.successfactors.com`，立刻停下并report to the user 该公司已迁到 SF，本 skill 不处理。

## 流程（8 步）

### 1. 健康检查
```bash
curl -s http://localhost:9222/json/version > /dev/null || ./shared/chrome-cdp-launcher.sh
ls /Users/lee/Desktop/用户_Lin_Resume.pdf
cat profile.json | head -1   # 验证有效 JSON
```
如缺：报错退出，提示用户跑 `./setup.sh`。

### 2. 导航 + 迁移检查
```bash
TAB=$(node shared/cdp.mjs goto "<APPLY_URL>" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
sleep 3   # 等 SPA 渲染
# 检查是否被重定向到 SAP SuccessFactors
node shared/cdp.mjs eval $TAB "location.href"
```
如果 URL 跳到 `career.sap.com` / `successfactors.com` / `*.sapsf.com`，立即停止：
> "这家公司已经迁移到 SAP SuccessFactors，ats-smartrecruiters v0.8 不支持。建议手投或等 ats-successfactors。"

### 3. 注入 helpers + 先看实际表单
**v0.8 beta 关键**：不要直接信任 `fillForm.plan`。先 dump 一次 required fields to the user 看：
```bash
node shared/cdp.mjs eval $TAB "$(cat shared/smartrecruiters_helpers.js); JSON.stringify(SmartRecruiters.findEmptyRequired(), null, 2)"
```
看返回的 label/selector/type — 如果和 profile.json 字段对得上就继续；如果有大量 unknown 字段或 selector 看起来不对，截图to the user，先停下手动诊断。

然后拿 fill plan：
```bash
node shared/cdp.mjs eval $TAB "$(cat shared/smartrecruiters_helpers.js); JSON.stringify(SmartRecruiters.fillForm($PROFILE_JSON))"
```

### 4. 上传简历（plan 里 upload 项）
```bash
node shared/cdp.mjs upload $TAB "<resume_selector>" /Users/lee/Desktop/用户_Lin_Resume.pdf
```
`<resume_selector>` 来自 `SR.uploadResume()` 的返回。SmartRecruiters resume input 通常 name 含 `resume` 或 `cv`。

### 5. 逐项执行 plan

- **`action: "typetext"`** → 真键盘（react-hook-form 风险，默认走 CDP）：
  ```bash
  node shared/cdp.mjs typetext $TAB "<selector>" "<value>"
  ```
  **不要** 调 `SR.setVal()` — 同 Ashby 的 react-hook-form isTrusted 问题。

- **`action: "select"`** → native `<select>`：
  ```bash
  node shared/cdp.mjs eval $TAB "$(cat shared/smartrecruiters_helpers.js); JSON.stringify(SmartRecruiters.pickSelect('<selector>', '<optionText>'))"
  ```
  如果返回 `not_native_select`，说明是 react-select — 这版没实现，截图ask the user 手填或先 patch helpers。

- **`action: "upload"`** → 同步骤 4。

每步之间 sleep 0.8-2.0s jitter。

### 6. 截图to the user 看
```bash
node shared/cdp.mjs screenshot $TAB /tmp/smartrecruiters_pre_submit.png
```
report to the user："已填完 + 简历已上传，截图 `/tmp/smartrecruiters_pre_submit.png`。**这是 v0.8 beta 第一次跑这家**，先确认无误后说『投』我才点 submit。"

### 7. Submit（**等 用户 显式授权**）

⚠️ **不要自动 submit**。条件：用户在当前对话明确说 "投" / "submit" / "可以了"。

授权后：
```bash
node shared/cdp.mjs eval $TAB "$(cat shared/smartrecruiters_helpers.js); JSON.stringify(SmartRecruiters.findSubmit())"
# 拿到 selector，然后：
node shared/cdp.mjs eval $TAB "document.querySelector('<selector>').click(); 'submitted'"
```

### 8. 验证成功
```bash
sleep 3
node shared/cdp.mjs eval $TAB "$(cat shared/smartrecruiters_helpers.js); JSON.stringify(SmartRecruiters.checkSuccess())"
node shared/cdp.mjs screenshot $TAB /tmp/smartrecruiters_success.png
```

**成功判定** = body 文字命中 `application has been submitted` / `thank you for applying` / `successfully submitted` / `application received`，**或** URL 含 `/thankyou` / `/confirmation` / `/success`。

成功后追加一行到 `log/submitted.jsonl`：
```json
{"ts": "<iso>", "ats": "smartrecruiters", "url": "<APPLY_URL>", "company": "<inferred>", "screenshot": "/tmp/smartrecruiters_success.png", "skill_version": "0.8-beta"}
```

## SmartRecruiters 特殊处理（一行总结）

- 文本字段默认走 `cdp.mjs typetext`（react-hook-form isTrusted 风险，同 Ashby）
- Native `<select>` → `SR.pickSelect`；react-select 未实现
- 简历 input name/id 含 `resume` 或 `cv` — `SR.uploadResume()` 帮你找
- 成功判定支持 in-place success panel **和** URL 跳转两种
- **第一次跑前**: 先 `findEmptyRequired()` dump 实际 DOM，对不上 profile 就停
- **迁移检查**: 跳到 `career.sap.com` / `successfactors.com` 立刻停（不归本 skill 管）

## 错误处理

| 症状 | 处理 |
|---|---|
| URL 跳到 SAP / SuccessFactors | 停下，report to the user 走手投或等 ats-successfactors |
| `cdp.mjs goto` 404 / 超时 | URL 死了，report to the user + 退出（不写 log） |
| `findEmptyRequired` 返回里 label 大量 `null` 或 `(no label)` | DOM 跟预期不一致，截图 + 停下诊断 |
| `fillForm.plan` 为空 | 选择器没匹配上，截图to the user + 让 用户 报 field name |
| `typetext` 完毕后 value 没进去 | 重试一次；仍失败 → 截图 + 用户 手填 |
| `pickSelect` 返回 `not_native_select` | react-select — v0.8 未支持，需 patch helpers |
| `pickSelect` 返回 `option_not_found` | 选项文本对不上，列出 options ask the user |
| Submit 后 `checkSuccess.ok = false` | 截图 + 留页面to the user 看（可能 validation 没过） |

## 成功判定

```js
SmartRecruiters.checkSuccess()
// → { ok: true, matched: "body_text"|"url", snippet: "...", url: "..." }
```

`ok === true` + 截图存档 = 完成。

## v0.8 → v0.9 收敛清单（dogfood 后补）

- [ ] 验证 firstName/lastName 真实 selector
- [ ] 验证 resume input 真实 name/id
- [ ] 是否有 Yes/No widget？需要 clickYesNo handler 吗？
- [ ] 是否有 react-select？需要 mousedown 三连吗？
- [ ] 验证 submit button 真实 selector
- [ ] 验证 success 文案命中哪条
- [ ] 写入 `feedback_ats_smartrecruiters.md` 记录所有发现
