---
name: ats-source
description: AI-driven job sourcing from Greenhouse and Ashby public Job Board APIs. Fetches latest postings from your curated company list, scores each one against your profile + recent skip feedback, and writes results to your Notion 「📋 岗位追踪」 dashboard for review. Triggered via "/ats-source", "用 ats-source 找新岗位", "AI source 一下", "find new jobs", or "source jobs".
---

# /ats-source — AI sourcing pipeline (v0.3)

One trigger. Skill pulls fresh job postings from the Greenhouse + Ashby public Job Board APIs for every company in `shared/sourcing/company_list.json`, filters to user's `target_filters.role_types`, scores each with Claude Sonnet (multi-dim fit score + key alignment/gaps), upserts to Notion with status `🤖 AI sourced`, and reports a top-N summary. Walk away, come back to a Notion dashboard you can approve/skip in 30 sec/row.

This is the Step 1 of the v0.3 funnel: **source → approve → /ats-skills batch apply**. This skill **only sources + scores**; it does **not** apply to anything.

---

## When to use

- 用户说 "找新岗位" / "AI source 一下" / "source jobs" / "用 ats-source 找新岗位" / "find new jobs"
- 用户希望从公开 Job Board API 拉新岗位 + AI 打分 + 写 Notion 让自己审
- **不要** 在用户手工提交单个 URL 让你投递时触发 — 那是 `/ats-greenhouse` / `/ats-ashby` 的事
- **不要** 在用户说"投我的待投队列"时触发 — 那是 `/ats-skills` batch orchestrator 的事

---

## 关键设计原则

1. **只 source + score，不 filter**：`min_fit_score` 是 Lee 在 Notion dashboard 里筛 view 用的，不是这里硬剔。打 3 分的也要写进 Notion，让 Lee 自己决定。
2. **Skip-not-fail**：单家公司 API 404 / 单条 job AI 评分 throw / 单 row Notion upsert 错 → log + 继续下一项，不中断 batch。
3. **De-dupe via Notion**：跟现有 「📋 岗位追踪」 DB 里同 URL 的 row 合并 — `upsertJob()` 已经按 Apply URL 找现有 row，存在则 PATCH（保留 Lee 手工 edit 的状态）；不存在则 CREATE 新 row 默认 `🤖 AI sourced`。
4. **Feedback loop inject**：每次 sourcing 都 load 最近 20 个 skip feedback 喂进 AI scorer system prompt，让模型避免重复推荐 Lee 已经 skip 过的同类 role。
5. **零 npm dep**：所有 helpers 都是 Node 24 ESM + 内置 fetch，不需要 install。

---

## Pre-flight checks

跑这些。任何一项 fail → 报错退出 + 给出修复指令。

```bash
# 1. NOTION_API_KEY env 存在
[ -n "$NOTION_API_KEY" ] || { \
  echo "NOTION_API_KEY env not set. Create integration at https://www.notion.so/my-integrations, share 「📋 岗位追踪」 DB to it, then export NOTION_API_KEY=ntn_..."; \
  echo "Or run ./setup.sh to persist into ~/.zshrc."; \
  exit 1; \
}

# 2. ANTHROPIC_API_KEY env 存在
[ -n "$ANTHROPIC_API_KEY" ] || { \
  echo "ANTHROPIC_API_KEY env not set. Get one at https://console.anthropic.com/settings/keys then export ANTHROPIC_API_KEY=sk-ant-..."; \
  exit 1; \
}

# 3. profile.json 存在 + 含 target_filters
PROFILE=/Users/lee/Projects/ats-skills/shared/profile.json
[ -f "$PROFILE" ] || { echo "Missing $PROFILE — run ./setup.sh first"; exit 1; }
node -e "
const p = require('$PROFILE');
const tf = p.target_filters;
if (!tf || !Array.isArray(tf.role_types) || tf.role_types.length === 0) {
  console.error('profile.json missing target_filters.role_types. Add { target_filters: { role_types: [\"intern\", \"new_grad_FT\"], locations: [\"US\", \"Remote-US\"], exclude_keywords: [...], min_fit_score: 6 } }');
  process.exit(1);
}
"

# 4. company_list.json 存在 + 有公司
LIST=/Users/lee/Projects/ats-skills/shared/sourcing/company_list.json
[ -f "$LIST" ] || { echo "Missing $LIST"; exit 1; }
node -e "
const l = require('$LIST');
if (!Array.isArray(l.companies) || l.companies.length === 0) {
  console.error('company_list.json has no companies entries');
  process.exit(1);
}
console.log('Pre-flight OK. ' + l.companies.length + ' companies on the list.');
"

# 5. log dir
mkdir -p /tmp/ats-skills/log/$(date +%F)
```

**输出给用户**："Pre-flight OK. NOTION_API_KEY ✓ ANTHROPIC_API_KEY ✓ profile.target_filters ✓ company_list (N companies) ✓"

---

## Step 1: Confirm scope

读 `company_list.json` + `profile.json`，print 给用户：

```
即将从 N 家公司的 Greenhouse + Ashby Job Board API 拉新岗位 + AI 评分写 Notion。

- 来源:        N 家公司（greenhouse_slug + ashby_slug 两 ATS 都试）
- Role 过滤:   intern + new_grad_FT （按 profile.target_filters.role_types）
- AI scorer:   Claude Sonnet，~$0.003/job
- 预计成本:    ~M 个候选 jobs × $0.003 = ~$X
- Notion DB:   📋 岗位追踪（94b728d7-526d-4c9f-96f4-a8cb92c0f5fe）
                - 新 row 状态 = 🤖 AI sourced
                - 已存在 row 仅刷新 fit_score 字段，保留 状态/Bot 备注
- 反馈 loop:   load 最近 20 条 ~/.ats-skills/feedback.jsonl skip 喂进 system prompt

回 "go" 开始
   "skip <company>"  从本次 source 移除某家（可重复）
   "only <company>"  本次只跑这几家
   "cancel"          取消
```

预算估算公式：`M = N companies × ~10 jobs/board × 2 platforms × 0.5 (filter survival rate) ≈ 10×N` 上限；保守再 × 0.5 = `5×N`。`X = M × 0.003`。

等用户回复：

- `go` → 进 Step 2
- `skip <slug>` / `only <slug>` → 修改 list 后重新 print 一次等下一次回应
- `cancel` / 其他文本 → 退出，不跑

---

## Step 2: Fetch jobs from Greenhouse + Ashby

对 company_list.json 的每家 company 跑两边，结果合并。Greenhouse + Ashby helpers 已自带 1 req/sec throttle，串起来跑也安全（也可以并发，但保守串行更不踩 rate limit）。

实操：写一个小 driver 脚本到 `/tmp/ats-source/source_jobs.mjs`，import 现有 helpers，循环 + 输出 JSON 到 stdout。Claude 跑这个 script 收集结果。

```bash
mkdir -p /tmp/ats-source
cat > /tmp/ats-source/source_jobs.mjs <<'NODE'
import { readFile } from 'node:fs/promises';
import * as GH from '/Users/lee/Projects/ats-skills/shared/sourcing/greenhouse_board_api.mjs';
import * as Ashby from '/Users/lee/Projects/ats-skills/shared/sourcing/ashby_board_api.mjs';

const list = JSON.parse(
  await readFile('/Users/lee/Projects/ats-skills/shared/sourcing/company_list.json', 'utf8'),
);
const profile = JSON.parse(
  await readFile('/Users/lee/Projects/ats-skills/shared/profile.json', 'utf8'),
);
const roleTypes = profile.target_filters?.role_types || ['intern', 'new_grad_FT'];

const all = [];
const errors = [];

for (const c of list.companies) {
  process.stderr.write(`[fetch] ${c.name} (gh=${c.greenhouse_slug || '-'}, ashby=${c.ashby_slug || '-'})\n`);

  if (c.greenhouse_slug) {
    try {
      const raw = await GH.fetchJobsForCompany(c.name, [c.greenhouse_slug]);
      const filtered = GH.filterByRoleType(raw, roleTypes);
      all.push(...filtered.map((j) => ({ ...j, ats: 'greenhouse', _company_priority: c.priority })));
      process.stderr.write(`  gh: ${raw.length} raw → ${filtered.length} role-filtered\n`);
    } catch (err) {
      errors.push({ company: c.name, ats: 'greenhouse', error: err.message });
      process.stderr.write(`  gh ERROR: ${err.message}\n`);
    }
  }

  if (c.ashby_slug) {
    try {
      const raw = await Ashby.fetchJobsForCompany(c.name, [c.ashby_slug]);
      const filtered = Ashby.filterByRoleType(raw, roleTypes);
      all.push(...filtered.map((j) => ({ ...j, ats: 'ashby', _company_priority: c.priority })));
      process.stderr.write(`  ashby: ${raw.length} raw → ${filtered.length} role-filtered\n`);
    } catch (err) {
      errors.push({ company: c.name, ats: 'ashby', error: err.message });
      process.stderr.write(`  ashby ERROR: ${err.message}\n`);
    }
  }
}

process.stdout.write(JSON.stringify({ jobs: all, errors }, null, 2));
NODE

node /tmp/ats-source/source_jobs.mjs > /tmp/ats-source/raw_jobs.json
```

进度 print（stderr 流到用户）：

```
[fetch] Cresta (gh=cresta, ashby=-)
  gh: 47 raw → 4 role-filtered
[fetch] Hugging Face (gh=huggingface, ashby=-)
  gh: 23 raw → 1 role-filtered
...
```

**错误处理**：单家公司 fetch fail 不退出整个 step，append 进 `errors[]` 继续。所有 errors 收集后 Step 5 dashboard 一起 print。

**结果**：`/tmp/ats-source/raw_jobs.json` 含 `{ jobs: [...], errors: [...] }`。每个 job 已经 normalized + role-filtered。

---

## Step 3: AI score batch

读 `/tmp/ats-source/raw_jobs.json` + load 最近 20 条 feedback，调 `scoreBatch()` with progress callback。

```bash
cat > /tmp/ats-source/score_jobs.mjs <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';
import { scoreBatch } from '/Users/lee/Projects/ats-skills/shared/matching/ai_scorer.mjs';
import { loadRecent } from '/Users/lee/Projects/ats-skills/shared/feedback.mjs';

const profile = JSON.parse(
  await readFile('/Users/lee/Projects/ats-skills/shared/profile.json', 'utf8'),
);
const { jobs, errors } = JSON.parse(
  await readFile('/tmp/ats-source/raw_jobs.json', 'utf8'),
);
const recentFeedback = loadRecent(20);

process.stderr.write(`[score] ${jobs.length} jobs, ${recentFeedback.length} feedback entries\n`);

const results = await scoreBatch(profile, jobs, {
  concurrency: 5,
  recentFeedback,
  onProgress: (done, total) => {
    if (done % 10 === 0 || done === total) {
      process.stderr.write(`[score] ${done}/${total} scored\n`);
    }
  },
});

// Stitch: input job + AI score
const scored = jobs.map((job, i) => {
  const r = results[i] || {};
  if (r.error) {
    return { ...job, ai_error: r.error, fit_score: null };
  }
  return {
    ...job,
    fit_score: r.fit_score,
    role_type_match: r.role_type_match,
    recommended: r.recommended,
    dim_scores: r.dim_scores,
    key_alignment: r.key_alignment,
    key_gaps: r.key_gaps,
    honest_reason: r.honest_reason,
  };
});

await writeFile('/tmp/ats-source/scored_jobs.json', JSON.stringify({ scored, fetch_errors: errors }, null, 2));
process.stderr.write(`[score] done. ${scored.filter((j) => j.fit_score != null).length}/${scored.length} successfully scored.\n`);
NODE

node /tmp/ats-source/score_jobs.mjs
```

进度 print 给用户：

```
[score] 47 jobs, 12 feedback entries
[score] 10/47 scored
[score] 20/47 scored
...
[score] done. 45/47 successfully scored.
```

**错误处理**：`scoreBatch` 内部已经 try/catch，单个 job AI throw 会写 `results[i] = { error: ... }` 而不是 throw 出来。这里我们把 ai_error 保留进 scored，下一步 Notion 写 row 时 fit_score = null（Notion DB 允许 null number）。

---

## Step 4: Notion upsert

读 `/tmp/ats-source/scored_jobs.json`，按 Notion DB schema 映射，调 `batchUpsert()`。

```bash
cat > /tmp/ats-source/sync_notion.mjs <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';
import { batchUpsert } from '/Users/lee/Projects/ats-skills/shared/notion_sync.mjs';

const { scored, fetch_errors } = JSON.parse(
  await readFile('/tmp/ats-source/scored_jobs.json', 'utf8'),
);

// Map scored → Notion row payload (see notion_sync.buildProperties for fields)
const rows = scored.map((j) => ({
  company: j.company,
  title: j.title,
  location: j.location || '',
  url: j.url || j.apply_url || '',
  ats: j.ats,
  fit_score: typeof j.fit_score === 'number' ? j.fit_score : null,
  key_gaps: Array.isArray(j.key_gaps) ? j.key_gaps.join('; ') : '',
  role_type_match: j.role_type_match || null,
  dim_scores: j.dim_scores || null,
  bot_note: j.honest_reason
    ? `ats-source v0.3 | fit=${j.fit_score ?? '?'} | ${j.honest_reason}`
    : `ats-source v0.3 | fit=${j.fit_score ?? '?'}`,
})).filter((r) => r.url); // skip jobs without URL

process.stderr.write(`[notion] upserting ${rows.length} rows (skipping ${scored.length - rows.length} without URL)\n`);

const result = await batchUpsert(rows, {
  concurrency: 3,
  onProgress: ({ done, total, last }) => {
    if (done % 10 === 0 || done === total) {
      process.stderr.write(`[notion] ${done}/${total} synced (${last.created ? 'created' : 'updated'})\n`);
    }
  },
});

await writeFile('/tmp/ats-source/notion_result.json', JSON.stringify({ result, scored, fetch_errors }, null, 2));
process.stderr.write(`[notion] done. created=${result.created} updated=${result.updated} errors=${result.errors.length}\n`);
NODE

node /tmp/ats-source/sync_notion.mjs
```

**错误处理**：`batchUpsert` 已经 try/catch 每个 row，单 row Notion 错（e.g. property name 不存在）→ 收集到 `result.errors[]`，不中断。Step 5 dashboard 显示。

---

## Step 5: Final dashboard

batch 结束 print 给用户：

```
## ats-source report — 2026-05-23

📊 Sourcing pipeline:
  - Companies queried:    16 (Greenhouse + Ashby)
  - Jobs fetched (raw):   ~340
  - Role-type filtered:   47 (intern + new_grad_FT)
  - AI scored:            45/47  (2 scorer errors — see log)
  - Notion synced:        43 new + 2 updated, 2 errors

⭐ Top-10 fits (by fit_score):

| # | Company   | Role                       | ATS        | Fit | Role Type    |
|---|-----------|----------------------------|------------|-----|--------------|
| 1 | Cresta    | DS Intern CS               | greenhouse | 9   | intern       |
| 2 | Mercury   | New Grad Product Analyst   | greenhouse | 8   | new_grad_FT  |
| 3 | Linear    | PM Intern Summer 2026      | ashby      | 8   | intern       |
| 4 | Ramp      | New Grad Customer Eng      | ashby      | 7   | new_grad_FT  |
| 5 | Notion    | GTM Strategy Intern        | greenhouse | 7   | intern       |
...

⚠️  Companies with fetch errors (skipped):
  - Hugging Face (greenhouse): 404 for slug "huggingface"
  - Stripe (greenhouse): timeout after 12s

❌ Notion upsert errors (2):
  - Faire — "Marketing Intern": Notion property "fit_score" not configured. Add via notion_sync.mjs header instructions.

下一步:
  1. 打开 Notion → 「📋 岗位追踪」 → "🤖 AI Sourced (Pending Review)" view
  2. 按 fit_score 排序，逐 row decide:
     - ✅ approve → 拖到 "✅ Approved" view（改 状态 字段）
     - ❌ skip → 状态 改 "⚠️ 跳过未投" + skip_reason + user_note
  3. 审完后跑 `/ats-skills` 一键投 Approved view 里的全部

Log:
  /tmp/ats-source/raw_jobs.json       (fetch results)
  /tmp/ats-source/scored_jobs.json    (AI scores)
  /tmp/ats-source/notion_result.json  (sync results + errors)
```

---

## Error handling speedrun

| 情形 | 处理 |
|---|---|
| `NOTION_API_KEY` / `ANTHROPIC_API_KEY` 未设 | Pre-flight fail，给出导出命令 + setup.sh 提示 |
| `profile.json` 缺 `target_filters.role_types` | Pre-flight fail，给出 schema 示例 |
| `company_list.json` 空 | Pre-flight fail "no companies on the list" |
| 单家公司 Greenhouse API 404 (slug 错) | helper 已内置返 `[]` + warn，append errors[] 继续 |
| 单家公司 Ashby API 404 | 同上 |
| 单家公司 fetch 5xx | helper retry 1 次，仍 fail → throw → append errors[] 继续 |
| 单 job AI scorer 5xx / 429 | scoreFit retry 1 次，仍 fail → 写 `results[i] = { error: ... }` 不 throw |
| 单 row Notion upsert 失败 (property 不存在) | batchUpsert 写 `errors[]` 继续，dashboard 显示 |
| Notion 429 rate-limited | notionFetch 已自带 retry-after backoff |
| `/tmp/ats-source/` 目录写不进 | OS 错，pre-flight 之外 throw — 几乎不可能 |
| 用户在 Step 1 回 cancel | 直接退出，不跑 fetch/score/sync |

---

## 不要做的事

- ❌ **不要自动跑 batch apply** — 那是 `/ats-skills` 的事。本 skill 只 source + score + write Notion，结束。
- ❌ **不要按 `min_fit_score` 在写 Notion 前过滤** — Lee 自己在 Notion view 里筛。低分 row 也写进去（让 feedback loop 完整 — 哪些被 skip 也是信号）。
- ❌ **不要 hardcode 公司名 / slug** — 全部从 `company_list.json` 读。新增公司走 PR / 编辑 JSON。
- ❌ **不要 hardcode role types** — 从 `profile.target_filters.role_types` 读。
- ❌ **不要让 AI 评分时看公司网页 / web search** — scorer 只看 JD raw text + profile（防 hallucination）。
- ❌ **不要在 Step 4 用 `replace` 删旧 row** — 用 `upsertJob` 按 URL 合并，保留 Lee 手工 edit 的 状态 / Bot 备注。
- ❌ **不要 git commit / push** — 这是 runtime skill，不是 build pipeline。
- ❌ **不要 retry 整个 batch** — 单 job/row 错 skip-not-fail；整个 batch 跑一次结束，dashboard 显示 errors，Lee 决定要不要再跑。

---

## Example invocation

```
用户: "用 ats-source 帮我找新岗位"

Claude: [Step 0 pre-flight] Pre-flight OK. NOTION_API_KEY ✓ ANTHROPIC_API_KEY ✓ profile.target_filters ✓ company_list (16 companies) ✓
        [Step 1 confirm scope]
        即将从 16 家公司的 Greenhouse + Ashby Job Board API 拉新岗位 + AI 评分写 Notion。
        ...预计 ~80 个候选 jobs × $0.003 = ~$0.24
        回 'go' 开始

用户: "go"

Claude: [Step 2 fetch] [fetch] Cresta ...  [fetch] Notion ...  → 47 role-filtered jobs
        [Step 3 score] [score] 10/47 scored ... [score] done. 45/47.
        [Step 4 notion] [notion] 43 created, 2 updated, 2 errors
        [Step 5 dashboard]
        ⭐ Top-10 fits: Cresta DS Intern (9), Mercury New Grad PA (8), Linear PM Intern (8) ...
        下一步: 去 Notion 「🤖 AI Sourced (Pending Review)」 view 审核 + 标 approve/skip
        审完跑 /ats-skills batch 投递
```

---

## 参考

- `shared/sourcing/greenhouse_board_api.mjs` — `fetchJobs`, `fetchJobsForCompany`, `filterByRoleType`, `classifyRoleType`
- `shared/sourcing/ashby_board_api.mjs` — `fetchJobs`, `fetchJobsForCompany`, `filterByRoleType`
- `shared/sourcing/company_list.json` — Lee 维护的高 fit 公司种子列表（PR 扩展）
- `shared/matching/ai_scorer.mjs` — `scoreFit`, `scoreBatch`, `buildProfileSummary`（Claude Sonnet, $0.003/job）
- `shared/matching/prompt_template.md` — AI scorer system prompt template（multi-dim output）
- `shared/notion_sync.mjs` — `upsertJob`, `batchUpsert`, `queryApprovedView`, `queryAiSourcedPending`（zero-dep Notion HTTP）
- `shared/feedback.mjs` — `loadRecent(20)`, `formatForPrompt`, `summarize` (~/.ats-skills/feedback.jsonl)
- `shared/profile.json` — 含 `target_filters` schema（v0.3 新增字段）
- `.claude/skills/ats-skills/SKILL.md` — Step 2 的 batch apply orchestrator（消费本 skill 写的 ✅ Approved view）
- `.claude/plans/peaceful-bouncing-karp.md` v0.3 phase plan — 完整 PRD
