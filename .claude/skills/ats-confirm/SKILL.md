---
name: ats-confirm
description: Close the loop after batch apply. Reads Gmail threads labeled "applied-jobs" (user-curated via a Gmail filter), uses Claude to extract company + role + ATS source from each confirmation email, and updates the matching Notion 「📋 岗位追踪」 row from 「✅ 已投」 → 「✅ 已确认」 with confirmed_at + confirmation_email_id. Idempotent — re-running is safe.
---

# ats-confirm — 投递 confirmation 闭环 (v1.0)

**何时跑**：批量投递 1-2 天后，确认邮件到了。或者 cron 每日跑一次。

**前置 (用户一次性 setup)**:
1. Gmail 里建一个 filter — `from:noreply@greenhouse.io OR from:noreply@ashbyhq.com OR from:jobs@lever.co OR (subject:"thanks for applying" OR subject:"application received")` — 设 action = `Apply label "applied-jobs"`
2. 用户已经跑过 `/ats-init`，`~/.ats-skills/config.json` 已有 notion_db_id
3. Claude Code 已连 Gmail MCP（`mcp__claude_ai_Gmail__*`）

**为什么用 Gmail filter 而不是写 scope**：所有邮件流量留在用户自己 Gmail 端，skill 只查带 label 的子集（隐私让步最少；用户掌控数据流）。

---

## Step 0: 环境准备

```bash
export ATS_HOME="${ATS_HOME:-$HOME/.ats-skills}"
export ATS_REPO_ROOT="${ATS_REPO_ROOT:-$ATS_HOME/repo}"
[ -d "$ATS_REPO_ROOT" ] || ATS_REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

# Verify config
[ -f "$ATS_HOME/config.json" ] || { echo "Missing ~/.ats-skills/config.json — run /ats-init first"; exit 1; }
NOTION_DB_ID=$(jq -r .notion_db_id "$ATS_HOME/config.json")
[ -n "$NOTION_DB_ID" ] && [ "$NOTION_DB_ID" != "null" ] || { echo "config.json missing notion_db_id"; exit 1; }
```

---

## Step 1: 拉最近 7 天带 label 的 Gmail thread

用 `mcp__claude_ai_Gmail__search_threads` 工具：

```
{ "query": "label:applied-jobs newer_than:7d", "max_results": 50 }
```

如果 MCP 工具不可用（用户没装 Gmail MCP）→ 打印「未检测到 Gmail MCP。请装 Anthropic 官方 Gmail MCP 或者在 Notion 里手动 mark confirmed」并退出。

返回的 thread 列表里每个 thread 拉 detail（用 `mcp__claude_ai_Gmail__get_thread` thread_id），取最新一条 message 的：
- `subject`
- `from`
- `body_text` (前 1500 char 足够)
- `message_id` / `thread_id`
- `date`

---

## Step 2: AI 抽取关键字段

对每个 thread 跑 Claude Sonnet 分类（zero-shot，~$0.0003/email）：

```
你是从招聘 confirmation 邮件抽公司 + 岗位的工具。

Input:
  Subject: <subject>
  From: <from>
  Body (前 1500 char): <body>

Output JSON only:
{
  "is_confirmation": boolean,        // 真的是投递 confirmation? 拒信不算
  "company": string,
  "role_title": string|null,         // 邮件里有就给，没有 null
  "ats": "greenhouse"|"ashby"|"lever"|"workday"|"smartrecruiters"|"icims"|"jobvite"|"handshake"|"other"|null,
  "is_rejection": boolean,           // 早期 rejection 也走这条，可标 ❌ Rejected
  "notes": string|null
}
```

Confidence 启发式：
- subject 含 "application received" / "thanks for applying" / "submitted" → `is_confirmation: true`
- subject 含 "no longer being considered" / "unfortunately" / "regret" → `is_rejection: true`
- from 含 `noreply@greenhouse.io` → `ats: greenhouse`，等
- 模糊的（如「Hi from Stripe」无主题描述）→ `is_confirmation: false`，跳

---

## Step 3: 拉最近 14 天 ✅ 已投 的 Notion 行，匹配

```bash
node -e "
import(`${process.env.ATS_REPO_ROOT}/shared/local_db.mjs`).then(async m => {
  const rows = await m.queryRecentlyApplied(14);
  console.log(JSON.stringify(rows, null, 2));
}).catch(e => { console.error(e); process.exit(1); });
" > /tmp/applied_rows.json
```

返回 list of `{page_id, company, title, apply_url, submitted_at}`.

---

## Step 4: 匹配 + mark confirmed

对 Step 2 抽出的每个 `is_confirmation=true` thread，找匹配 row：

匹配规则（按优先级）：
1. **company 名 + role_title 都精确匹配**（case-insensitive） → 直接 mark
2. **company 精确 + role_title 模糊 (substring)** → mark
3. **company 精确 + 只有 1 个 ✅ 已投 row** → mark (大多数情况)
4. **多 row 候选** → 报告给用户让 ta 选 / skip
5. **0 候选** → 报告给用户「Gmail 收到 confirmation 但 Notion 没找到对应 ✅ 已投 row。可能是手投，或 row 还没 sync」

对 `is_rejection=true`：同样匹配规则，但 mark 成「❌ Rejected」而不是「✅ 已确认」（可以加一个 markRejected helper，或先 manual 用 markSkipped with reason='Rejected'）。

写入 Notion:

```bash
node -e "
import(`${process.env.ATS_REPO_ROOT}/shared/local_db.mjs`).then(async m => {
  const result = await m.markConfirmed(
    '<page_id>',
    { confirmed_at: '<email date ISO>', email_id: '<thread_id>' }
  );
  console.log(JSON.stringify(result));
});
"
```

---

## Step 5: 报告

print:

```
Gmail 拉到 N 个 label:applied-jobs thread (近 7 天)
  ├─ M 个 confirmation matched + Notion mark ✅ 已确认
  ├─ K 个 rejection matched + Notion mark ❌ Rejected (可选)
  ├─ P 个 confirmation 但 Notion 没找到对应 ✅ 已投 row：
  │     [public_id_1] subject / company / role  →  user TODO mark
  └─ Q 个 skipped (not confirmation, e.g., recruiter outreach)
```

---

## 幂等性 / 重复跑

- skill 跑 N 次效果相同：已经 mark 「✅ 已确认」的 row 不会再被 mark
- Notion query 已经 filter `状态 == ✅ 已投`，confirmed row 自然 drop 出查询集

如果想强制重新跑某 row：先在 Notion 把状态改回 ✅ 已投，再跑 /ats-confirm。

---

## 错误处理

| 情形 | 处理 |
|---|---|
| Gmail MCP 不可用 | 打印安装指引，退出（不要 fallback 到 IMAP） |
| 0 thread with label | 打印「Gmail 还没 confirmation 邮件 / filter 未生效」+ 给 filter 教程链接，退出 |
| Notion 0 ✅ 已投 row | 打印「最近 14 天没有 ✅ 已投 row。先跑 /ats-skills 再跑 /ats-confirm」 |
| AI parse 输出非 JSON | 跳过该 thread + log + 继续 |
| Notion API 4xx/5xx | retry once，仍失败则报错继续下一封 |

---

## 不要做的事

- ❌ 不要不读 user label 就扫整个 inbox — 隐私 + scope
- ❌ 不要 mark Notion row 「✅ 已确认」如果没 100% 确定匹配
- ❌ 不要写入 confirmation email body 进 Notion（PII）— 只存 thread_id

---

## 参考

- `shared/local_db.mjs.markConfirmed()` / `queryRecentlyApplied()` — v1.1 (SQLite)
- `mcp__claude_ai_Gmail__search_threads` / `mcp__claude_ai_Gmail__get_thread` — official Anthropic Gmail MCP
- `shared/onboarding/resume_parser.mjs` — pattern for Anthropic API direct call (reuse for Step 2 AI parse if you want pure Node, but MCP 是更简单的路径在 Claude Code 里)
