# ats-skills — Engineer Handoff Brief

> Owner: Lee (`glin23`) · Repo: https://github.com/glin23/mrweirdo-jobs · 当前版本: **v0.9.0**（2026-05-23）
>
> 这是一份交付给工程师的需求 brief。读完应能：(1) 理解产品定位与红线 (2) 知道当前已建什么 (3) 拿到一份按优先级排好的 next-action 列表 (4) 知道在哪验收。

---

## 1. 一句话产品定位

把 **AI sourcing → Notion dashboard → batch auto-apply** 串成一条流水线的 Claude Code skill 集合，目标：

> 把 "100 家投递" 的时间从 **8–10 小时压到 < 2 小时**，并保证大公司有限的投递配额不被 batch 烧光。

**面向用户**：单用户（Lee 本人 + 公开 OSS 后的少量 self-host 用户），**不是 SaaS**，永远不做多租户。

---

## 2. 关键流程（端到端）

```
┌──────────────┐  ┌───────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌────────────┐
│ company_list │→ │ ATS Public API│→ │ AI scorer (6 dim)│→ │ Notion DB upsert │→ │ User triage│
│ (248 公司)   │  │ sourcing      │  │ Claude Sonnet    │  │ +「📋岗位追踪」  │  │ in Notion  │
└──────────────┘  └───────────────┘  └──────────────────┘  └──────────────────┘  └─────┬──────┘
                                                                                       │
                                                                                       ▼
                                                                          ┌───────────────────────┐
                                                                          │ User 标 ✅Approved /    │
                                                                          │ ❌Skipped+reason       │
                                                                          └──────────┬────────────┘
                                                                                     │
                                                                                     ▼
┌──────────────────┐  ┌──────────────────────┐  ┌──────────────────────────┐  ┌──────────────┐
│ Notion ✅Approved│→ │ URL → ATS dispatch   │→ │ CDP fillForm + Submit gate│→ │ Mark Notion  │
│ view (queue)     │  │ (greenhouse/ashby/…) │  │ (人工授权 Submit)         │  │ +feedback.jsonl│
└──────────────────┘  └──────────────────────┘  └──────────────────────────┘  └──────────────┘
                                                                                     │
                                                                                     ▼
                                                                          ┌─────────────────────┐
                                                                          │ 下次 sourcing 时把  │
                                                                          │ feedback 注入 AI 提示│
                                                                          │  (loop closes)      │
                                                                          └─────────────────────┘
```

---

## 3. 架构原则（**不可妥协**）

| # | 原则 | 理由 |
|---|---|---|
| 1 | **CDP 主，Computer Use 仅 fallback** | CDP isTrusted=true，~50ms/action；Computer Use 2-4 act/min 太慢且反爬不看浏览器层。CV 仅在 `findEmptyRequired` 返 unidentified element 时触发 |
| 2 | **零 npm 依赖**（Node 24 built-in fetch + WebSocket） | OSS 易 self-host；减少供应链风险；当前 repo 19.5k 行 0 deps |
| 3 | **Notion DB 是状态唯一来源** | 不建独立 web UI；所有 view / approval / submit 状态都走 Notion |
| 4 | **Submit 必须人工授权** | 每次 batch 跑前一次性 "go"，且 Submit 按钮点击前 skill 必须 stop-and-confirm |
| 5 | **Slow-mode 节奏** | 2–5 分钟 jitter / 每天 cap 50；模拟人类节奏；防被 ATS rate-limit / 标 bot |

---

## 4. 红线（**永远不做**）

| 项 | 原因 |
|---|---|
| LinkedIn Easy Apply | 反爬在行为/网络层；OSS bots 全 deprecated；TOS 明禁 |
| Indeed apply / Glassdoor apply | 同上 |
| Taleo / SuccessFactors | 单点登录 + tenant variants 死胡同 |
| Workday "generic" 通用化 | Tenant variant 50–65% 覆盖率，已确认是死胡同。**只做 per-company config-driven** |
| 自动点 Submit | Submit 永远要用户显式授权 |
| 自动投大公司 | 见 §6 quota guard |

---

## 5. 平台覆盖（v0.9 现状）

| 平台 | Sourcing | Apply | 成熟度 | 备注 |
|---|---|---|---|---|
| Greenhouse | ✅ public API `boards-api.greenhouse.io` | ✅ stable | 已 dogfood 验证 | v0.2 NiCE SDR 真投成功；v0.3 修了 candidate-location bug |
| Ashby | ✅ public API `api.ashbyhq.com/posting-api` | ✅ stable | 已 dogfood 验证 | v0.2 验证；isTrusted=true 必须走 CDP typetext |
| Lever | ✅ public API | ✅ stable | 含 Lee 5/13 Palantir 实战 5 个 gotcha | v0.8 stable |
| SmartRecruiters | ✅ public API | ⚠️ scaffold (beta) | **需 dogfood** | 正在迁 SAP SuccessFactors，selector 可能漂移 |
| iCIMS | ✅ HTML scrape | ⚠️ scaffold (alpha) | **需 dogfood** | 必须创建账号，多步 wizard + EEOC |
| JobVite | ✅ HTML scrape | ⚠️ scaffold (alpha) | **需 dogfood** | 多数 tenant 允许 guest apply |
| Handshake | ⚠️ stub | ⚠️ scaffold (beta) | **需 dogfood** | 自动检测 redirect 到外部 ATS |
| Workday | ❌ per-company config | ⚠️ config-driven | 5 placeholder configs，**0 真验证** | _template.json 是 schema 锚点 |
| Recruitee | ✅ public API | manual | 仅 sourcing | |
| Personio | ✅ XML public | manual | 仅 sourcing | |
| BambooHR | ✅ HTML scrape | manual | 仅 sourcing | |
| Rippling | ✅ HTML/JSON | manual | 仅 sourcing | |
| Wellfound + YC WAAS | ⚠️ stub | manual | **TODO 实现** | |

---

## 6. 大公司配额保护（v0.9 产品级关键决策）

**Insight**：大公司有学期级投递 cap（例：Google 3 次/学期）。batch 自动跑里把配额烧在非 dream role = 失败。

**实施**（已落地，需 dogfood 验证）：

1. `shared/sourcing/company_list.json` 中 25 家大厂打 `apply_quota` / `apply_quota_period` / `apply_quota_note` 字段
   （Google / Meta / MSFT / Amazon / Apple / Tesla / SpaceX / Stripe / Anthropic / OpenAI / Bloomberg / GS / JPM / MS / Salesforce / Adobe / Oracle / IBM / Netflix / Snowflake / Databricks / Datadog / Airbnb / Uber / Coinbase）
2. batch orchestrator Step 3 加 quota guard：
   - 检测公司 capped → SKIP + warn + log feedback + Notion mark "⚠️ 跳过未投" + **continue**（不 break batch）
3. sourcing 阶段把这 25 家标记到 Notion view 「🏢 大公司限投 (待手动选)」
4. 用户必须 cherry-pick + 用单 URL skill（`/ats-greenhouse <url>` 等）**手动投**
5. `🏢 大公司投递配额追踪` sub-page 当前**手动维护**计数 → 未来可能加自动 rollup

---

## 7. AI 评分契约

**Model**：Claude Sonnet via Anthropic SDK（Node 24 built-in fetch，无 SDK dep）
**Cost**：~$0.003 / job（50 jobs/week ≈ $0.15/week）

**Input**：`profile.json`（resume + standard_qa + target_filters）+ JD raw text + 最近 20 个 skip_reason 注入 system prompt
**Output 契约**：
```json
{
  "fit_score": 7,
  "role_type_match": "new_grad_FT",
  "key_alignment": ["..."],
  "key_gaps": ["..."],
  "recommended": true,
  "dim_scores": {
    "role_fit":       8,
    "skills_match":   7,
    "location_fit":   9,
    "visa_compatible":10,
    "seniority_match":6,
    "exclude_check":  10
  }
}
```

`recommended = (min(dim_scores) >= profile.target_filters.min_fit_score)` — 任意一维爆雷即不推荐。

---

## 8. 数据契约：`profile.json` schema（v0.9）

文件位置：`shared/profile.json`（gitignored，每个 self-host 用户自己填）
模板：`shared/profile.template.json`

```json
{
  "personal":   { "name": "...", "email": "...", ... },
  "education":  { ... },
  "work_authorization": { "status": "...", "needs_sponsor": false },
  "standard_qa": { "Why this company?": "...", ... },
  "target_filters": {
    "role_types":       ["intern", "new_grad_FT"],
    "locations":        ["US", "Remote-US"],
    "exclude_keywords": ["SWE", "Software Engineer", "Sales Engineer"],
    "min_fit_score":    6,
    "visa_must_sponsor": false
  },
  "batch_pace": { "min_seconds_between_jobs": 120, "max_seconds_between_jobs": 300 },
  "daily_apply_cap": 50
}
```

**已知 issue**：当前 Lee 的 `shared/profile.json` 中 `target_filters` 全空。`ats-source` SKILL.md 的 pre-flight 会硬 fail。**P0 修复项**。

---

## 9. 数据契约：Notion DB schema

**DB**: 「📋 岗位追踪」`94b728d7-526d-4c9f-96f4-a8cb92c0f5fe`
**Data Source**: `6995653c-4fab-4622-b174-d10892620ad8`
**Root page**: `35d1e8ce-8185-819a-ba70-ec00e8fc2726`

**字段 (v0.9)**：
| 字段 | 类型 | 来源 |
|---|---|---|
| 公司 / 职位 / URL / 地点 / 来源 / 状态 | (原有 v0.2) | sourcing + apply |
| `fit_score` / `key_gaps` / `role_type_match` / `skip_reason` / `user_note` / `dim_scores` | v0.3 AI scorer | AI scorer |
| `salary_min` / `salary_max` / `salary_currency` / `salary_interval` / `hourly_rate` / `ats 平台` (SELECT) | v0.8 | sourcing |
| `apply_quota_limit` / `apply_quota_period` / `apply_quota_note` | v0.9 quota guard | company_list.json |

**状态 enum**: 🤖 AI sourced · ✅ Approved · 🔵 未投 · ⚠️ 跳过未投 · ✅ 已投 · 🔥 面试中 · ❌ Rejected

**Views (7 个)**：
- 🤖 AI Sourced (Pending Review) · view `36a1e8ce-8185-8167-b7c7-000c46b5a2cc`
- ✅ Approved (Ready to Apply) · view `36a1e8ce-8185-81f2-acf3-000c6672a718`
- ❌ Skipped + Reason · view `36a1e8ce-8185-8133-85df-000c2ecfd75a`
- 🏢 大公司限投 (待手动选) · view `36a1e8ce-8185-814a-a067-000c6162b627`
- 🔵 未投 / ✅ 已投 / 🔥 面试中 (原有)

---

## 10. 仓库结构（v0.9 终态）

```
ats-skills/
├── README.md / LICENSE / DISCLAIMER.md / CHANGELOG.md / setup.sh
├── shared/
│   ├── cdp.mjs                          # 271 行 zero-dep CDP driver (WS + Node 24 fetch)
│   ├── chrome-cdp-launcher.sh           # 启动隔离 Chrome (Lee 用 Profile 7)
│   ├── greenhouse_helpers.js   (599)
│   ├── ashby_helpers.js        (903)
│   ├── lever_helpers.js        (506)
│   ├── smartrecruiters_helpers.js (557)  ⚠️ beta
│   ├── icims_helpers.js        (582)     ⚠️ alpha
│   ├── jobvite_helpers.js      (603)     ⚠️ alpha
│   ├── handshake_helpers.js    (545)     ⚠️ beta
│   ├── workday_helpers.js      (477)     ⚠️ config-driven
│   ├── computer_use_locator.mjs (224)    # vision fallback
│   ├── feedback.mjs            (132)     # ~/.mrweirdo-jobs/feedback.jsonl R/W
│   ├── patterns.mjs            (191)     # 借鉴 Career-Ops 系统性偏差分析
│   ├── notion_sync.mjs         (358)     # HTTP Notion API client, 不走 MCP
│   ├── sourcing/
│   │   ├── company_list.json            # 248 公司 / 25 capped
│   │   ├── greenhouse_board_api.mjs / ashby_board_api.mjs / lever_board_api.mjs
│   │   ├── smartrecruiters_board_api.mjs / icims_board_api.mjs / jobvite_board_api.mjs
│   │   ├── recruitee_board_api.mjs / personio_board_api.mjs
│   │   ├── bamboohr_board_api.mjs / rippling_board_api.mjs
│   │   └── handshake_search.mjs / wellfound_search.mjs / yc_workatastartup.mjs   # 3 个 stub
│   ├── matching/ai_scorer.mjs + prompt_template.md
│   ├── workday/companies/ _template.json + 5 placeholders
│   └── profile.template.json
└── .claude/skills/
    ├── ats-skills/SKILL.md              # 777 行 batch orchestrator (含 quota guard)
    ├── ats-source/SKILL.md              # 515 行 sourcing + AI + Notion + capped detect
    ├── ats-greenhouse/ats-ashby/ats-lever                   # ✅ stable
    ├── ats-smartrecruiters/ats-icims/ats-jobvite            # ⚠️ alpha/beta
    └── ats-handshake/ats-workday                            # ⚠️ untested
```

---

## 11. 待办（按优先级，**直接可分给工程师执行**）

### P0 — 必须立刻做（blocker for first real sourcing dogfood）

| # | 任务 | 验收 |
|---|---|---|
| P0-1 | 让 Lee 填 `shared/profile.json` 的 `target_filters`（当前全空）。注意：memory 里 Lee 明确说 **"不要 SWE / 仅美国 / 不要 FT"**，但 PRD 默认 `role_types=["intern","new_grad_FT"]` 含 new_grad_FT → **与工程师确认前先与 Lee 拍板** | `ats-source` pre-flight 不再硬 fail |
| P0-2 | 修 Greenhouse `classifyRoleType` regex（`greenhouse_board_api.mjs:212`）—— 当前 `/intern\|internship\|.../i` 缺 word boundary，"**Intern**al Audit" / "**Intern**ational" 被误判 intern | 跑 dry-run，Asana "Head of Internal Audit" 不再被分到 intern 桶 |
| P0-3 | sourcing 阶段加 `filterByExclude(jobs, excludeKeywords)` — 当前 GH/Ashby 的 `filterByRoleType()` 没读 `profile.target_filters.exclude_keywords`，SWE 漏的根源 | 248 公司 dry-run 后 SWE 类岗位 0 进候选 |
| P0-4 | sourcing 阶段加 `filterByLocation(jobs, allowedLocations)` — 当前 Warsaw/Toronto/远东 全进 US 候选 | dry-run 结果中只剩 US states + "Remote - US" / "United States" |
| P0-5 | 跑完整 `/ats-source` sourcing dogfood：248 公司 → fetch ~500–1000 jobs → AI score → 写 Notion → 验证 capped 公司导向「🏢 大公司限投」view | Lee 在 Notion 看到完整 funnel；top-10 AI 推荐与他人工 pick 重合 ≥ 7 |

> 上个 session 已经跑了 dry-run 到 120/248（无 AI / 无 Notion 写入，纯 fetch 测试）。后台进程结果在 `/tmp/ats-source/dry_run_result.json`，**接班的工程师应先读这个文件再写 patch**。

### P1 — Sourcing 准确率 / Workflow 稳定性

| # | 任务 | 验收 |
|---|---|---|
| P1-1 | Handshake (v0.6 beta) 真投 dogfood + 修 helpers | Lee 投 5 个 Handshake 岗位 success rate ≥ 60% |
| P1-2 | Workday (v0.7) 写 Lee 目标 5 家公司的 `companies/<slug>.json` config + 真投 | 5 家 submit 1 个真投 → success ≥ 4/5 |
| P1-3 | SmartRecruiters / iCIMS / JobVite (v0.8 alpha) 真投 dogfood + 修 selectors | 每平台 ≥ 1 次成功真投 |
| P1-4 | `patterns.mjs` 启用：定期跑 skip 系统性偏差分析，自动 update `profile.target_filters.exclude_keywords` | 跑 3 周后 AI sourced 的 approve rate 从 50% → 70% |
| P1-5 | Computer Use visual fallback dogfood（`computer_use_locator.mjs`）—— CDP 找不到 selector 时触发 vision，3 次重试后 skip + log | 至少 1 次真案例：CDP 失败 → CV locate 成功 → 表单填上 |

### P2 — 配额追踪自动化

| # | 任务 | 验收 |
|---|---|---|
| P2-1 | 「🏢 大公司投递配额追踪」从手动 → 自动：Notion relation rollup 或 SKILL.md 写入计数 | Lee 投一次大公司后，sub-page 数字自动 + 1 |
| P2-2 | 配额耗尽 alert：用户接近 cap 时 sourcing 阶段 Notion 标红 | UI 上能一眼看到"Google 还剩 1/3" |

### P3 — 平台扩展

| # | 任务 | 验收 |
|---|---|---|
| P3-1 | Wellfound + YC WAAS 的 sourcing 实现（当前是 stub） | 至少能 fetch 10 个 job 进 Notion |
| P3-2 | BambooHR / Rippling / Recruitee / Personio 的 apply helpers（当前仅 sourcing） | 每平台 ≥ 1 次真投成功 |
| P3-3 | Lever 的 sourcing dogfood + 平台扩展（含 Greenhouse-like 平台） | sourcing 产出 ≥ 50 jobs from Lever boards |

---

## 12. 工程师 onboarding 流程

```bash
# 1. clone
gh repo clone glin23/mrweirdo-jobs && cd ats-skills

# 2. 读 4 个文档（按序）
cat README.md                                          # 用户视角
cat HANDOFF.md                                         # 本文件
cat CHANGELOG.md                                       # v0.1 → v0.9 历史
cat .claude/skills/ats-skills/SKILL.md                 # 777 行 batch orchestrator

# 3. 启动隔离 Chrome
bash shared/chrome-cdp-launcher.sh                     # Profile 7, port 9222

# 4. 填 profile.json
cp shared/profile.template.json shared/profile.json
# 编辑 personal / education / standard_qa / target_filters

# 5. 设 env
export ANTHROPIC_API_KEY=...     # AI scorer 用
export NOTION_API_KEY=...        # notion_sync 用

# 6. 验证 sourcing dry-run（不烧 API key）
node /tmp/ats-source/dry_run.mjs                       # 上个 session 留下来的 driver

# 7. 真 sourcing（小批量先验）
# 在 Claude Code 里说: /ats-source
```

---

## 13. 凭证与资源（**敏感，单独传递**）

- Anthropic API key — env `ANTHROPIC_API_KEY`，AI scorer 用
- Notion API key — env `NOTION_API_KEY`，notion_sync 用（或走 MCP，两条路都已验证 work）
- Resume PDF — `/Users/lee/Desktop/Lee_Lin_Resume.pdf`
- Chrome lily Profile 7 — `bash shared/chrome-cdp-launcher.sh` 启动
- profile.json — `shared/profile.json`（gitignored）
- Notion DB ID / data source ID / root page ID — 见 §9
- GitHub repo — https://github.com/glin23/mrweirdo-jobs

> **不要 commit** 任何 `.env` / `profile.json` / API key。`setup.sh` 会自动 gitignore。

---

## 14. 测试 / 验收策略

- **Unit-style smoke**：每个 helper 改动后必须 `node --check` 通过 + 至少 1 次真投递成功
- **Sourcing dry-run**：不烧 API key 跑全 248 公司 fetch，看 errors count + filtered count
- **AI scoring 验证**：每次 prompt 改动，跑 10 个已知 ground-truth jobs 看 dim_scores 漂移
- **End-to-end (v1.0)**：见 PRD §Verification — 冷启动 → sourcing → triage → batch apply → 反馈 loop 验证

---

## 15. 关键依赖文档（深读）

| 文件 | 在哪里 | 为什么读 |
|---|---|---|
| 完整 PRD | `/Users/lee/.claude/plans/peaceful-bouncing-karp.md` | v0.3 → v1.0 详细 phase plan + risk + verification |
| Mega devlog | `/Users/lee/.claude/projects/-Users-lee/memory/devlog-2026-05-23-ats-skills-mega.md` | 单 session v0.2 → v0.9 全 19.5k 行历史 |
| ATS 自动投策略 | memory `feedback_ats_auto_apply_strategy_2026.md` | gstack 模式被 Ashby flag，需用 chrome-cdp + Profile 7 + 人工 Submit |
| react-select gotcha | memory `feedback_ats_react_select_mousedown.md` | Greenhouse/Ashby picker `.click()` 不开 menu，必须 dispatch `MouseEvent('mousedown')` |
| Execute-in-session 红线 | memory `feedback_execute_in_session_redline.md` | Lee 说"这个 session 做"时不准建议"下次 session"，立刻多 agent 并行 |

---

## 16. 不在范围内 (Out of Scope)

- LinkedIn Easy Apply、Indeed apply、Glassdoor apply、Taleo、SuccessFactors（红线）
- Workday "generic" 通用化（已确认死胡同，只做 per-company config）
- AI 改简历 per JD（v2 stretch）
- Cover letter generator（v2 stretch）
- 移动端 / SaaS / 多用户（永远不做）
- 中国侧平台 BOSS 直聘 / 拉勾（v2 评估）

---

_End of brief. 问题、补充上下文，找 Lee（`glin23` GitHub / lg2916286821@gmail.com）。_
