---
name: ats-init
description: First-run onboarding for ats-skills v1.0. Collects API keys (Anthropic + Notion), parses the user's resume PDF, asks 4 questions to build target_filters, and provisions a new Notion 「📋 岗位追踪」 database with full schema. Persists everything to ~/.ats-skills/. Run once per user. After this, /ats-source + /ats-skills + single-URL skills all work end-to-end.
---

# ats-init — Onboarding Orchestrator (v1.0)

**何时跑**：用户首次使用 ats-skills，或者想 reset 多租户配置。一次性 setup，之后所有其它 skill (ats-source / ats-skills / ats-greenhouse / ats-ashby / ats-lever 等) 都从 `~/.ats-skills/` 读配置。

**何时不要跑**：用户已经有 `~/.ats-skills/config.json` 且能正常 sourcing — 这种情况下走 /ats-source 即可。

---

## 关键设计原则

1. **一次性 setup**：跑一遍生成所有 file，之后不再问用户基础信息
2. **secrets 不进 git**：API key 写 `~/.ats-skills/.env` (`chmod 600`)，repo `.gitignore` 永远不收 `~/.ats-skills/`
3. **resume PDF AI 解析**：用户上传简历 → Claude Sonnet 抽出 personal/education/work_auth → 用户审核改正再保存
4. **Notion DB 自动建**：用 Notion REST API 在用户指定的 parent page 下建 「📋 岗位追踪」 + 16 properties + 4 view
5. **Skill 不持有 secret**：所有 API key 永远只在用户本地 `~/.ats-skills/.env`，Claude 不复制到 transcript / log

---

## Step 0: 环境准备

```bash
export ATS_HOME="${ATS_HOME:-$HOME/.ats-skills}"
export ATS_REPO_ROOT="${ATS_REPO_ROOT:-$ATS_HOME/repo}"
[ -d "$ATS_REPO_ROOT" ] || ATS_REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
mkdir -p "$ATS_HOME"/{log}
[ -f "$ATS_HOME/.env" ] || (touch "$ATS_HOME/.env" && chmod 600 "$ATS_HOME/.env")
```

报给用户：「环境准备好。$ATS_HOME 已建。」

---

## Step 1: 收 Anthropic API key

直接问用户（不要用 AskUserQuestion — secret 不走选项 UI）：

> 请创建一个 Anthropic API key (https://console.anthropic.com/settings/keys)，粘贴到这里。
> 这个 key 会写到 `~/.ats-skills/.env`（chmod 600），repo 永远不收。

收到后写入：

```bash
# 用户给的 key 假设在变量 ANTHROPIC_KEY
# 先看 .env 里是否已有，有则 update 而不是 append
grep -v '^ANTHROPIC_API_KEY=' "$ATS_HOME/.env" > "$ATS_HOME/.env.tmp" || true
echo "ANTHROPIC_API_KEY=$ANTHROPIC_KEY" >> "$ATS_HOME/.env.tmp"
mv "$ATS_HOME/.env.tmp" "$ATS_HOME/.env"
chmod 600 "$ATS_HOME/.env"
```

验证可用：

```bash
ANTHROPIC_API_KEY=$ANTHROPIC_KEY curl -sf -X POST https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":10,"messages":[{"role":"user","content":"ping"}]}' \
  | jq -e '.content[0].text' > /dev/null && echo "Anthropic key OK" || echo "Anthropic key FAILED"
```

如果 fail：截图 / 显示错误，让用户重发 key。

---

## Step 2: 收 Notion API key

直接问：

> 请去 https://www.notion.so/profile/integrations 建一个新 integration（"+ New integration" → "Internal integration"），起名 "ats-skills"，复制 secret token（`ntn_...` 开头）粘贴到这里。

写入：

```bash
grep -v '^NOTION_API_KEY=' "$ATS_HOME/.env" > "$ATS_HOME/.env.tmp" || true
echo "NOTION_API_KEY=$NOTION_KEY" >> "$ATS_HOME/.env.tmp"
mv "$ATS_HOME/.env.tmp" "$ATS_HOME/.env"
chmod 600 "$ATS_HOME/.env"
```

验证：

```bash
node "$ATS_REPO_ROOT/shared/onboarding/notion_setup.mjs" ping
# 期望输出 {ok:true, integration:"ats-skills", id:"..."}
```

---

## Step 3: 收简历 PDF + AI 解析

问用户：

> 把你的简历 PDF 的完整路径贴过来（或者把文件拖进 Claude Code 输入框）。常见路径如 `~/Desktop/MyResume.pdf`。

收到 path 后：

```bash
RESUME_INPUT="<user-provided-path>"
[ -f "$RESUME_INPUT" ] || { echo "PDF not found at $RESUME_INPUT"; exit 1; }
cp "$RESUME_INPUT" "$ATS_HOME/resume.pdf"
chmod 600 "$ATS_HOME/resume.pdf"
```

跑 AI 解析（**会花 ~10 秒，cost ~$0.02**）：

```bash
node "$ATS_REPO_ROOT/shared/onboarding/resume_parser.mjs" "$ATS_HOME/resume.pdf" > "$ATS_HOME/profile.parsed.json"
cat "$ATS_HOME/profile.parsed.json" | jq .
```

把 parsed JSON show 给用户：

> 我从你的简历抽到这些信息，看一眼有没有错（特别是邮箱 / 学校 / 毕业日期 / work_authorization）。需要改的告诉我：

等用户确认 or 给修改指令。改完写：

```bash
# 在 parsed JSON 上 merge 用户修正 + 加 resume_path + 加 standard_qa（用 template 默认）+ 加 batch_pace
node -e "
import('$ATS_REPO_ROOT/shared/paths.mjs').then(async m => {
  const fs = await import('node:fs/promises');
  const parsed = JSON.parse(await fs.readFile('$ATS_HOME/profile.parsed.json', 'utf8'));
  const template = JSON.parse(await fs.readFile('$ATS_REPO_ROOT/shared/profile.template.json', 'utf8'));
  const profile = {
    ...parsed,
    resume_path: '$ATS_HOME/resume.pdf',
    standard_qa: template.standard_qa || {},
    batch_pace: { min_seconds_between_jobs: 120, max_seconds_between_jobs: 300, daily_apply_cap: 50 },
    target_filters: {} // filled in Step 4
  };
  await fs.writeFile('$ATS_HOME/profile.json', JSON.stringify(profile, null, 2));
  console.log('profile.json written');
});
"
```

---

## Step 4: 4 个 target_filters 问题

用 AskUserQuestion 工具一次性问 4 个（不要分 4 次问）：

```
1. role_types — multiSelect — options:
   - "intern (实习)"
   - "new_grad_FT (新毕业全职)"
   - "internship_to_FT (return offer 实习)"

2. locations — multiSelect (用户可选多个 + Other) — options:
   - "US (全美)"
   - "Remote-US (美国远程)"
   - "Bay Area"
   - "New York"
   - "Other (自定义)"

3. exclude_keywords — 不用 AskUserQuestion，给一个默认 list 让用户改：
   "我默认 exclude 这 30 个 SWE 类关键词（software engineer / swe / ml engineer / backend / frontend / devops / sre / security engineer / data engineer / qa engineer / mobile engineer / embedded engineer / robotics / compiler / kernel / firmware / graphics / platform / systems / 等）。要加 / 减哪些？回 'keep' 全用 default，回 'add X,Y / remove A,B' 改"

4. min_fit_score — multiSelect=false — options:
   - "6 (推荐 — AI fit score >= 6 才进 Approved 候选)"
   - "5 (更宽松，AI 评分 5+ 都看一眼)"
   - "7 (更严格，只看高匹配)"
```

收齐 4 个答案，写进 `~/.ats-skills/profile.json` 的 `target_filters`：

```bash
node -e "
const fs = require('node:fs');
const p = JSON.parse(fs.readFileSync('$ATS_HOME/profile.json', 'utf8'));
p.target_filters = {
  role_types: <user-selected>,
  locations: <user-selected, US default expanded>,
  exclude_keywords: <default or user-customized>,
  min_fit_score: <user-selected>,
  visa_must_sponsor: false
};
fs.writeFileSync('$ATS_HOME/profile.json', JSON.stringify(p, null, 2));
console.log('target_filters saved');
"
```

---

## Step 5: 建 Notion DB

告诉用户：

> 现在我们要在你的 Notion 工作区建一个「📋 岗位追踪」database。步骤：
> 1. 打开 Notion，建一个空白页面（命名什么都行，例如 "求职 2027"）
> 2. 点页面右上角 `...` → `Connections` → 搜 "ats-skills" → 加上
> 3. 把这个页面的 URL 贴过来（URL 末尾 32 字符是 page id）

收到 URL 后抽 page id：

```bash
PARENT_URL="<user-URL>"
# Notion URL 末尾 32 hex chars (with optional dashes) = page id
PARENT_PAGE_ID=$(echo "$PARENT_URL" | grep -oE '[a-f0-9]{32}' | tail -1)
[ -z "$PARENT_PAGE_ID" ] && { echo "Couldn't parse page id from URL: $PARENT_URL"; exit 1; }
echo "Using parent page id: $PARENT_PAGE_ID"
```

建 DB:

```bash
node "$ATS_REPO_ROOT/shared/onboarding/notion_setup.mjs" "$PARENT_PAGE_ID" > "$ATS_HOME/notion_db.json"
cat "$ATS_HOME/notion_db.json" | jq .
```

输出 `{db_id, data_source_id, ...}`。

---

## Step 6: 用 MCP 建 4 个 view

**这步用 Claude Code 的 Notion MCP**（不是 REST API — Notion REST 不公开 view create）。

调用 `mcp__notion__notion-create-view` 4 次，每次 args:

```
{
  "database_id": "<db_id from Step 5>",
  "view_type": "table",
  "view_name": "🤖 AI Sourced (Pending Review)",
  "filter": { "property": "状态", "select": { "equals": "🤖 AI sourced" } }
}
```

4 个 view:
1. "🤖 AI Sourced (Pending Review)" — 状态 = 🤖 AI sourced
2. "✅ Approved (Ready to Apply)" — 状态 = ✅ Approved
3. "❌ Skipped + Reason" — 状态 = ⚠️ 跳过未投
4. "🏢 大公司限投 (待手动选)" — apply_quota_limit 存在

如果 `mcp__notion__notion-create-view` 不可用（用户 Notion MCP 没装），fallback：告诉用户「在 Notion DB 里手动建这 4 个 view + filter 条件」并给 screenshot 教程链接。

---

## Step 7: 写 config.json

```bash
node -e "
const fs = require('node:fs');
const db = JSON.parse(fs.readFileSync('$ATS_HOME/notion_db.json', 'utf8'));
const config = {
  notion_db_id: db.db_id,
  notion_data_source_id: db.data_source_id,
  notion_root_page_id: db.parent_page_id,
  views: {
    ai_sourced: '<view-id-from-Step-6 view 1>',
    approved: '<view-id-from-Step-6 view 2>',
    skipped: '<view-id-from-Step-6 view 3>',
    large_company: '<view-id-from-Step-6 view 4>'
  },
  resume_path: '$ATS_HOME/resume.pdf'
};
fs.writeFileSync('$ATS_HOME/config.json', JSON.stringify(config, null, 2));
console.log('config.json written');
"
```

---

## Step 8: 健康自检 — 端到端 smoke test

跑一次 1 公司 sourcing dry-run + Notion write，验证整条 pipeline 通：

```bash
node -e "
import('$ATS_REPO_ROOT/shared/sourcing/greenhouse_board_api.mjs').then(async m => {
  const jobs = await m.fetchBoard('cresta', 10);
  console.log('Cresta GH fetch ok: ' + jobs.length + ' jobs');
});
"
```

如果 jobs > 0 → smoke test pass。

可选：让用户回 "yes" 跑一次完整 mini-sourcing（5 家公司，~$0.05 cost）来验证 AI scorer + Notion upsert 都 work。如果用户跳过这步就结束。

---

## Step 9: 打印 next steps

```
🎉 ats-init 完成！~/.ats-skills/ 已配齐：
  - .env (API keys, chmod 600)
  - profile.json (你的 personal/education/target_filters)
  - config.json (Notion ids + view ids)
  - resume.pdf (你的简历副本)

下一步:
  /ats-source — 从 248 家公司抓岗位 → AI 评分 → 写进你的 Notion DB
  /ats-greenhouse <url> — 单 URL 投递（Greenhouse）
  /ats-ashby <url>      — 单 URL 投递（Ashby）
  /ats-skills           — 从 Notion ✅ Approved view 批量投递

Gmail confirmation 闭环（可选 v1.0）:
  在 Gmail 里建一个 filter — from:noreply@greenhouse.io OR from:noreply@ashbyhq.com OR from:jobs@lever.co OR subject:"thanks for applying" — apply label "applied-jobs". 然后跑 /ats-confirm 让 confirmation email 自动 mark Notion「✅ 已确认」.
```

---

## 错误处理

| 情形 | 处理 |
|---|---|
| Anthropic API key 无效 | 让用户重发，不要写坏的 key 进 .env |
| Notion integration 未加到 parent page | API 报 "Page not accessible"。指引用户重新 "+ Connections" |
| 简历 PDF 太大 (> 20MB) | 报错，让用户压缩或换 PDF |
| 简历 parse 出 null 太多 | 让用户手动 review + 补充 |
| Notion DB 已存在同名 | API 不会拒，会建多个。但用户应该只跑一次 init — 重跑前先在 Notion 删旧 DB |

---

## 不要做的事

- ❌ 不要把 API key 写进 transcript / log / git tracked file
- ❌ 不要 echo Anthropic / Notion key 到 stdout
- ❌ 不要让用户绕过简历 review — 永远先 show parsed JSON 让 ta 检查
- ❌ 不要替用户决定 target_filters — 必须问

---

## 参考

- `shared/onboarding/resume_parser.mjs` — PDF → AI parse
- `shared/onboarding/notion_setup.mjs` — Notion DB create
- `shared/paths.mjs` — 路径 + config resolver
- `shared/config.template.json` — config.json schema
- `shared/profile.template.json` — profile.json schema
