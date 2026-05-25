---
name: mrweirdo-init
description: First-run onboarding for ats-skills v1.1. Collects the Anthropic API key, parses the user's resume PDF, asks 4 questions to build target_filters, and initializes a local SQLite database at ~/.mrweirdo-jobs/jobs.db. Persists everything to ~/.mrweirdo-jobs/. Run once per user. After this, /mrweirdo-source + /mrweirdo-jobs + single-URL skills all work end-to-end. Optional Datasette UI for browsing.
---

# ats-init — Onboarding Orchestrator (v1.1, SQLite-backed)

**何时跑**：用户首次使用 ats-skills，或想 reset 配置。一次性 setup，之后所有其它 skill (ats-source / ats-skills / ats-greenhouse / ats-ashby / ats-lever / ats-confirm 等) 都从 `~/.mrweirdo-jobs/` 读配置。

**何时不要跑**：用户已经有 `~/.mrweirdo-jobs/jobs.db` 且能正常 sourcing — 直接走 /mrweirdo-source。

---

## v1.1 关键变化 vs v1.0

**Notion 已下线**。Job tracking 数据库改为本地 SQLite (`~/.mrweirdo-jobs/jobs.db`)。Onboarding 从 9 步 → **6 步**：

| v1.0 (Notion) | v1.1 (SQLite) |
|---|---|
| 收 Anthropic + Notion API key | 只收 **Anthropic** key |
| 用户去 Notion 建 integration + share page + 给 parent page url | **不需要** |
| 跑 notion_setup.mjs 建 DB + properties | 跑 local_db.mjs init (自动建 schema) |
| MCP 建 4 个 view | 用 SQL VIEW (datasette 自动呈现) |
| 写 config.json (notion ids + view ids) | 不写 (db path 由 paths.mjs 算) |

可选：用户跑 `datasette serve ~/.mrweirdo-jobs/jobs.db --open` 起一个本地 web UI 看 row + filter + export，~1s 启动。

---

## 关键设计原则

1. **一次性 setup**：跑一遍生成所有 file，之后不再问用户基础信息
2. **secrets 不进 git**：API key 写 `~/.mrweirdo-jobs/.env` (`chmod 600`)
3. **resume PDF AI 解析**：用户上传简历 → Claude Sonnet 抽出 personal/education/work_auth → 用户审核改正再保存
4. **DB 本地**：所有 job row 写 SQLite `~/.mrweirdo-jobs/jobs.db`。零 cloud。
5. **不打 Notion**：v1.1 完全 self-contained

---

## Step 0: 环境准备

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"
export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
[ -d "$MRWEIRDO_REPO_ROOT" ] || MRWEIRDO_REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
mkdir -p "$MRWEIRDO_HOME"/{log}
[ -f "$MRWEIRDO_HOME/.env" ] || (touch "$MRWEIRDO_HOME/.env" && chmod 600 "$MRWEIRDO_HOME/.env")
```

报告：「环境准备好。$MRWEIRDO_HOME 已建。」

---

## Step 1: 收 Anthropic API key

直接问（不要走 AskUserQuestion — secret 不通过选项 UI）：

> 请去 https://console.anthropic.com/settings/keys 建一个 API key，粘贴到这里。
> 这个 key 会写到 `~/.mrweirdo-jobs/.env` (chmod 600)，repo 永远不收。

写入：

```bash
grep -v '^ANTHROPIC_API_KEY=' "$MRWEIRDO_HOME/.env" > "$MRWEIRDO_HOME/.env.tmp" 2>/dev/null || true
echo "ANTHROPIC_API_KEY=$ANTHROPIC_KEY" >> "$MRWEIRDO_HOME/.env.tmp"
mv "$MRWEIRDO_HOME/.env.tmp" "$MRWEIRDO_HOME/.env"
chmod 600 "$MRWEIRDO_HOME/.env"
```

验证可用：

```bash
ANTHROPIC_API_KEY=$ANTHROPIC_KEY curl -sf -X POST https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":10,"messages":[{"role":"user","content":"ping"}]}' \
  | jq -e '.content[0].text' > /dev/null && echo "Anthropic key OK" || { echo "Anthropic key FAILED"; exit 1; }
```

如果 fail：让用户重发 key，不写坏的 key。

---

## Step 2: 收简历 PDF + AI 解析

问用户：

> 把你的简历 PDF 的完整路径贴过来（或拖文件进 Claude Code 输入框）。常见路径如 `~/Desktop/MyResume.pdf`。

收到后：

```bash
RESUME_INPUT="<user-provided-path>"
[ -f "$RESUME_INPUT" ] || { echo "PDF not found at $RESUME_INPUT"; exit 1; }
cp "$RESUME_INPUT" "$MRWEIRDO_HOME/resume.pdf"
chmod 600 "$MRWEIRDO_HOME/resume.pdf"
```

AI 解析（~10 sec, ~$0.02）：

```bash
node "$MRWEIRDO_REPO_ROOT/shared/onboarding/resume_parser.mjs" "$MRWEIRDO_HOME/resume.pdf" > "$MRWEIRDO_HOME/profile.parsed.json"
cat "$MRWEIRDO_HOME/profile.parsed.json" | jq .
```

Show parsed JSON 给用户审核 (邮箱 / 学校 / 毕业日期 / work_authorization 是 hot fields)。等用户修正确认。

合并 + 写最终 profile.json:

```bash
node --no-warnings -e "
import('$MRWEIRDO_REPO_ROOT/shared/paths.mjs').then(async () => {
  const fs = await import('node:fs/promises');
  const parsed = JSON.parse(await fs.readFile('$MRWEIRDO_HOME/profile.parsed.json', 'utf8'));
  const template = JSON.parse(await fs.readFile('$MRWEIRDO_REPO_ROOT/shared/profile.template.json', 'utf8'));
  const profile = {
    ...parsed,
    resume_path: '$MRWEIRDO_HOME/resume.pdf',
    standard_qa: template.standard_qa || {},
    batch_pace: { min_seconds_between_jobs: 120, max_seconds_between_jobs: 300, daily_apply_cap: 50 },
    target_filters: {} // filled in Step 3
  };
  await fs.writeFile('$MRWEIRDO_HOME/profile.json', JSON.stringify(profile, null, 2));
  console.log('profile.json written');
});
"
```

---

## Step 3: 4 个 target_filters 问题

用 AskUserQuestion 一次性问全部 4 个：

```
1. role_types — multiSelect — options:
   - "intern (实习)"
   - "new_grad_FT (新毕业全职)"
   - "internship_to_FT (return offer 实习)"

2. locations — multiSelect — options:
   - "US (全美)"
   - "Remote-US (美国远程)"
   - "Bay Area"
   - "New York"
   - "Other (自定义)"

3. exclude_keywords — 不走 AskUserQuestion，给 default + 问 add/remove:
   "默认 exclude 30 个 SWE 类关键词（software engineer / swe / ml engineer / backend / frontend / devops / sre / security engineer / data engineer / qa engineer / mobile engineer / embedded engineer / robotics / compiler / kernel / firmware / graphics / platform / systems / 等）。
   回 'keep' 全用 default；回 'add X,Y / remove A,B' 改"

4. min_fit_score — multiSelect=false — options:
   - "6 (推荐, AI fit score >= 6 才进 Approved 候选)"
   - "5 (更宽松)"
   - "7 (更严格)"
```

写入 profile.json:

```bash
node --no-warnings -e "
const fs = require('node:fs');
const p = JSON.parse(fs.readFileSync('$MRWEIRDO_HOME/profile.json', 'utf8'));
p.target_filters = {
  role_types: <user-selected>,
  locations: <user-selected, expand US if picked>,
  exclude_keywords: <default or user-customized>,
  min_fit_score: <user-selected>,
  visa_must_sponsor: false
};
fs.writeFileSync('$MRWEIRDO_HOME/profile.json', JSON.stringify(p, null, 2));
console.log('target_filters saved');
"
```

---

## Step 4: 初始化 SQLite database

```bash
node --no-warnings "$MRWEIRDO_REPO_ROOT/shared/local_db.mjs" init
```

输出: `{"ok":true,"path":"<MRWEIRDO_HOME>/jobs.db"}` 即 DB 已 ready（表 / view / 索引全部 idempotent 建好）。

```bash
node --no-warnings "$MRWEIRDO_REPO_ROOT/shared/local_db.mjs" summary
```

输出: `{"total":0,"byStatus":[],"recentSubmits":0,"db_path":"..."}` — DB 空 + 准备好接 sourcing.

---

## Step 5: 健康自检 — 端到端 smoke test

跑一次 1 公司 sourcing dry-run 验证 pipeline 通：

```bash
node --no-warnings -e "
import('$MRWEIRDO_REPO_ROOT/shared/sourcing/greenhouse_board_api.mjs').then(async m => {
  const jobs = await m.fetchBoard('cresta', 10);
  console.log('Cresta GH fetch ok: ' + jobs.length + ' jobs');
});
"
```

jobs > 0 → smoke pass.

可选 mini-sourcing（5 家公司，~$0.05 cost）做 AI score + DB write 全流程验证。用户跳过即可。

---

## Step 6: （可选）启动 Datasette web UI

```bash
# 装 datasette (一次性)
pip install datasette || pip3 install datasette
# 启动 — 自动打开浏览器
datasette serve "$MRWEIRDO_HOME/jobs.db" --open --port 8001
```

打开后看到几个 view：
- `v_ai_sourced` — AI 评分待 review 的 row
- `v_approved` — 用户 已 approve 待投的 row
- `v_submitted` — 已投 / 已确认
- `v_skipped` — skip / rejected
- `v_large_company_pending` — 大公司限投待 manual cherry-pick

Datasette 自带 SQL query + filter + JSON export + CSV export，比 Notion 还快（zero web 加载）。

如果用户不想装 datasette，可以用任何 SQLite 客户端（TablePlus / DBeaver / Datagrip / `sqlite3` CLI）打 `~/.mrweirdo-jobs/jobs.db`。

---

## Step 7: 打印 next steps

```
🎉 ats-init 完成！~/.mrweirdo-jobs/ 已配齐：
  - .env (ANTHROPIC_API_KEY, chmod 600)
  - profile.json (你的 personal/education/target_filters)
  - jobs.db (SQLite, 含 schema + 5 个 view)
  - resume.pdf (你的简历副本)

下一步:
  /mrweirdo-source — 从 248 家公司抓岗位 → AI 评分 → 写 jobs.db
  /mrweirdo-greenhouse <url> — 单 URL 投递（Greenhouse）
  /mrweirdo-ashby <url>      — 单 URL 投递（Ashby）
  /mrweirdo-jobs           — 从 v_approved 批量投递 (在 datasette 里改 status 为 ✅ Approved)
  /mrweirdo-confirm          — 抓 Gmail confirmation 邮件 → mark v_submitted 行

可选: datasette serve "$MRWEIRDO_HOME/jobs.db" --open --port 8001
```

---

## 错误处理

| 情形 | 处理 |
|---|---|
| Anthropic API key 无效 | 让用户重发，不要写坏的 key |
| 简历 PDF 太大 (> 20MB) | 报错，让用户压缩 |
| 简历 parse 出 null 太多 | 让用户手动 review + 补充 |
| node:sqlite 不可用 | 提示用户升级到 Node 24.7+ |
| SQLite 写 jobs.db 失败 | 检查 ~/.mrweirdo-jobs/ 权限 |

---

## 不要做的事

- ❌ 不要把 API key 写进 transcript / log / git tracked file
- ❌ 不要 echo Anthropic key 到 stdout
- ❌ 不要让用户绕过简历 review — 永远先 show parsed JSON 让 ta 检查
- ❌ 不要替用户决定 target_filters — 必须问

---

## 参考

- `shared/local_db.mjs` — SQLite wrapper (CRUD + queries + 5 view)
- `shared/onboarding/resume_parser.mjs` — PDF → AI parse
- `shared/paths.mjs` — 路径 + env resolver
- `shared/profile.template.json` — profile.json schema
- v1.0 archived: `shared/onboarding/notion_setup.mjs` + `shared/notion_sync.mjs` — 留作 Notion 用户参考，v1.1 流程不再触发
