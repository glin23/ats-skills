# Prompt PRD：Mr. Weirdo Jobs v3 —— 一份完整升级方案

**版本**：v1.0 / 2026-06-12
**依据**：对 `santifer/career-ops`（v1.10.0）与 `MadsLorentzen/ai-job-search` 的代码级研究 + `mrweirdo-jobs`（v2.2.0）全量盘点 + onboarding 现状交互审计
**性质**：Prompt PRD，供 coding agent 按阶段执行；不含代码实现

---

## 1. Executive Summary

- **career-ops 强在评估与数据纪律**：报告内嵌机读 `## Machine Summary` YAML；纯函数 liveness 分类器（bot challenge ≠ expired）；与 fit 分数分离的 ghost-job legitimacy 三档判定；pattern analysis 回写配置成闭环。但它**永不代提交**——这恰是我们的核心差异化。
- **ai-job-search 强在材料质量与诚实度**：drafter–reviewer 双 agent（reviewer 返回机器可应用的 JSON edits）；PDF 编译后读回检查；"interview backtrack test"（用户能否在面试中不打补丁地解释这条 bullet）是最好的"tailor without lying"操作化。但它**提交之后什么都没有**：tracker 从未被自动写入。
- **我们的护城河无人复制**：真实 GH/Ashby 自动提交 + submit 时二次校验 + gap report 闭环 + SQLite 审计 + quota guard。这一层原样保留，所有新功能只做它的只读消费者。
- **我们的功能缺口在提交前后两端**：提交前无 per-job 报告、无 liveness 复查、无 legitimacy 判定；提交后生命周期止于 `'✅ 已确认'`，零 follow-up、零 pattern analysis（25% land rate 是手算的）。
- **我们的体验缺口在首跑流程**：happy path 用户要输入/确认 5–7 次、点 10–15 次权限允许（repo 不带 `.claude/settings.json`），且 discovery / 评分 / batch 三段长流程对用户静默（batch 的 30–90s 防风控间隔最致命——用户最容易在花真实申请额度时以为卡死然后 Ctrl-C）。
- **本 PRD 的总路线**：Phase 1 先修体验（输入 ≤3 次、权限弹窗 ≤2 次、静默 ≤15s）并完成纯 prompt 类功能（legitimacy 评分字段）；Phase 2 补报告/跟踪/分析层；Phase 3 补材料/扩充/upskill/follow-up 层。
- **明确不抄的**：career-ops 的 markdown-as-database（为补救选错存储付出 739 行 merge + 自制文件锁的税）与多 CLI × 多语言矩阵（已现实 bug）；ai-job-search 的 LaTeX 依赖、WebSearch 式抓取、以及"tracker 靠自觉填写"。两个竞品都有 doc-drift 实锤（career-ops 宣称的 `.gemini/` 目录不存在；ai-job-search 的 SETUP.md 与 setup.md 矛盾）——所以我们的验收标准里含 skill↔script 引用一致性检查。

---

## 2. Competitive Map

| 维度 | career-ops | ai-job-search | mrweirdo-jobs 当前 |
|---|---|---|---|
| **Discovery** | 强。9 个 provider plugin，零 token 扫描，三级过滤 + `--rediscover-404` | 弱。WebSearch `site:` 查询；4 个真实 API scraper 闲置未接入 | 强。14 源 + dispatcher + rotating window + 带原因的硬过滤 |
| **Scoring / evaluation** | 强。A–G 七块报告 + legitimacy 三档 + Machine Summary | 中。5 维加权 + outcome 校准 | 中强。6 维 `dim_scores` + 双重 role-type 校验，但**结果只进 DB 列，无人类可读报告** |
| **Resume/CV 生成** | 中（Canva 流程是 demo-ware） | 强。relevance-weighted cutting + PDF 读回 QA | 无。单一 `resume.pdf` 投所有岗位 |
| **Cover letter / essay** | 中。四问强制 gate | 强。drafter-reviewer + backtrack test | 弱。静态 PDF + gap retry 时临时起草 |
| **ATS automation** | 无（品牌立场：永不提交） | 无。止于生成 PDF | **强（独有）**。全自动提交 + 二次校验 + 截图审计 + 单一 DB 写入口 |
| **User data model** | markdown/TSV，alias map 复制 4 处 | CLAUDE.md + 从未自动写入的 CSV | **SQLite**（两表 + 8 视图）+ 3 个 profile JSON，结构最好 |
| **Reporting / tracker** | 强。生命周期 `Evaluated→…→Offer` + Go TUI + 8 项 lint | 几乎无 | 中。HTML 汇总报告 + gap report；生命周期止于 ✅已确认 |
| **Follow-up / pattern analysis** | 强。cadence 引擎 + 转化率分析回写配置 | 无 follow-up；upskill 有加权 gap 热力图 | **零** follow-up；pattern 仅 last-20 skips 回灌 scorer |
| **Onboarding / profile 深度** | 中。`_profile.md` overrides + 写作风格标定 | **强**。documents 文件夹三路径、additive/conflict 合并、STAR stub | 中。1 简历 + 自我介绍 + 3 硬边界问题；之后只靠 gap report 长大。**且交互过多（5–7 次输入 + 10–15 次权限点击）、长流程静默** |
| **Engineering maturity** | 高（CI + 63 项测试），但多语言漂移已现 bug | 低-中（无 CI、文档过期、死组件） | 中-高（16 单测套件 + demo:check）；helper JS 无 CI、emoji 状态串 6 处字面量 |

---

## 3. Product Direction

**定位升级**：从"自动投递执行器"升级为"**可审计的求职作战系统**：评估 → 提交 → 跟踪 → 学习，每一步留痕、全程可见"。

**一条体验主线（贯穿所有 Phase）**：
- **看得见**——任何阶段终端静默 ≤15s，每阶段结束报 funnel 数字；
- **少问**——问问题只有两个合法时机：不答无法安全继续（硬边界三问）、某个真实申请此刻卡在这个字段（gap report）；其余从简历推断 + 标注 `[推断]` + 留改的窗口；
- **少点**——确认合并而非删除：真实提交前必有且只有一道硬 gate；权限弹窗与业务确认重合（`--real` 的弹窗本身就是闸）。

**四个功能层（围绕不动的执行器核心）**：
1. **执行器核心（不动区）**：`apply_supervisor.mjs` / 三个 driver / `record_apply_outcome.mjs` / `validate_auto_row.mjs` / quota guard / 锁 / gap-retry 闭环。
2. **Opportunity Report 层**（学 career-ops）：per-job report + Machine Summary YAML；批前 liveness gate；评分新增 legitimacy 判定。
3. **Tracker / Outcome 层**（career-ops 生命周期 + ai-job-search outcome 校准）：状态延伸到 responded / OA / interview / offer；outcome 回灌评分校准。
4. **学习层**：pattern analysis 直接吃 `jobs.db`（我们有竞品没有的结构化 `dim_scores`），建议经用户逐条确认后回写配置；follow-up cadence 只草拟不代发。
5. **材料与画像层**（学 ai-job-search）：per-job cover letter（drafter-reviewer + backtrack test + HTML→PDF 读回 QA，**不引入 LaTeX**）；`documents/` 文件夹渐进式 profile 扩充；upskill 报告。简历暂不做 per-job tailoring。

---

## 4. UX 与 Safety Requirements（全 PRD 的硬约束）

### 4.1 交互预算（首跑 happy path）

| 指标 | 现状 | 目标 |
|---|---|---|
| 用户输入次数 | 5–7 次 | **≤ 3 次**（intake 一次、queue gate 一次、批后 gap 问答一次） |
| 权限弹窗 | 10–15 次 | **≤ 2 次**（启动 Chrome + `--real` 批次） |
| 最长终端静默 | 分钟级 | **≤ 15s** |

### 4.2 确认点的最终形态

**必须用户确认（硬 gate，不可移除）**：
- **Queue gate（唯一硬 gate）**：queue preview 表 + 身份复核块 + 三行汇总，用户明确指令后才跑 `--real`：

```
将以以下身份提交：<name> / <email> / <phone> / <visa 状态>
自动投 24 行 | manual 清单 31 行（不会替你投）| quota 保护 6 行 | suspicious 待复核 2 行
回复"开始"执行，或先指出需要修改的行/字段。
```

- cherry-pick 每个大公司 slot（现有，不动）；
- pattern analysis 的每条配置回写（逐条 ask，展示 before/after）；
- expand 写入 `profile.json` 任何 ATS 实投字段（conflicting 桶逐条）；
- materials 灰区表述（backtrack test "Flag" 档 → "Keep, soften, or drop?"）。

**降级为软窗口 / 自动继续**：
- **Parse confirmation 不再是独立硬 gate**：展示摘要（含 `[推断]` 标注）后直接开始 discovery（只读、可重跑），用户在 discovery 跑动期间随时纠正；身份事实在 queue gate 处二次复核——确认实质合并，不是删除。
- liveness 跳过 expired 行、per-job report 生成、upskill 报告、expand additive 桶（批量确认一次）、prune（自动执行 + 一行摘要，因只删可再发现行）。

**不编造底线（任何新路径不得旁路）**：visa / GPA / demographic / legal attestations / background-check / relocation / 薪资接受度只能来自显式问答；对应 `apply_gap_report.mjs` 的 `user_*` 与 `agent_attestation` 分类是底线。`legitimacy='suspicious'` 行与非 GH/Ashby 平台进 manual review；suspicious 的措辞用"信号：标题含 2025"式陈述，不下"假岗位"结论。

**避免"全都自动投了"的误解**：queue preview 固定声明「只有标记 auto 的行会被自动提交；manual 清单在 `manual_or_unsupported.json`，系统不会替你处理」；apply report 增加 funnel 段让"216 行只投 24 行"数字自解释。

---

## 5. Proposed Skill Changes（按文件）

### 5.1 `.claude/skills/mrweirdo-onboard/SKILL.md`（重点改造，UX + 功能一起）

- **当前问题**：交互点 7 个（intake、三问、≤5 追问、parse 硬确认、queue 确认、gap 问答、prune 暂停）；命令用 `node "$MRWEIRDO_REPO_ROOT/shared/..."` 绝对路径形态导致权限 allowlist 无法命中；评分/discovery/batch 三段静默；queue preview 信息不足；跑完无 next steps。
- **具体改动**：
  - **Step 0**：preflight 收编为 `bash scripts/preflight.sh` 一条命令（见 §6.1）。
  - **Step 1（intake 合一屏）**：一条消息收简历路径 + 自我介绍；收到后**一次 AskUserQuestion（3 questions：A0/A1/A2）**问完硬边界三问，A2 默认选项"ask/skip（投到需要时再问我）"。简历校验/复制用 `scripts/intake_resume.sh <path>`。
  - **Step 3（parse 软窗口）**：摘要展示（推断项标 `[推断，可改]`）后直接进 Step 4 开始 discovery，告知"只读操作，期间随时纠正；身份字段改完即生效，方向类字段改完重跑 discovery"。
  - **Step 4**：评分指令追加规则"每完成一批 50 个，先输出一行 `评分进度: 100/216（fit≥5 暂计 N）`"；每阶段结束用一句中文复述 funnel；batch 开始时提示 `npm run status`。
  - **Step 5（queue gate）**：表增加 liveness / legitimacy 信息（列数超 7 则只对异常行标注）+ §4.2 的身份复核块与固定声明。
  - **Step 6**：gap `user_questions` 合并为一次 AskUserQuestion（≤4 问，超出按频率取前 4，其余留下批）。
  - **Step 7**：删除 prune 前暂停，自动执行 + 摘要一行；结尾追加 next-steps 段（`/mrweirdo-confirm` 48h 后核对、`/mrweirdo-tracker` 记录进展、manual 清单位置）。
  - 全部 bash 块改为 `cd "$MRWEIRDO_REPO_ROOT"` + 相对路径 `node shared/xxx.mjs`（allowlist 前提）。
  - Step 1 可选分支：`~/.mrweirdo-jobs/documents/` 非空时引导 `/mrweirdo-expand`；不存在则完全静默。
- **不该改什么**：queue gate 本身；`fit_score >= 5` 阈值；"批次开始后不逐行确认"；`/tmp/mrweirdo-onboard/` 工件布局；安全底线（§4.2）。
- **验收**：模拟首跑输入 ≤3 次、权限弹窗 ≤2 次；demo:check 全绿。

### 5.2 `references/intake-and-profile.md`（修改）

三问合并为一次 UI call 的规则；自适应追问上限 5→**3 且只许 1 次 UI call**，触发条件收紧为"显著改变 discovery 关键词"的两类（多 function、role type 混杂），其余推断 + 标注；parse 软窗口规则成文。硬边界事实永不推断的原则原文保留。

### 5.3 `.claude/skills/mrweirdo-jobskill/SKILL.md`（小改）

空参输出命令菜单（onboard / 三平台单 URL / cherry-pick / confirm / doctor / tracker / expand / upskill / materials 各一行中文）；同步 5.1 的流程引用。**不做** career-ops 式"含 responsibilities 即判定 JD"的关键词路由。

### 5.4 `shared/scoring/score_prompt.md`（修改）

输出 schema 每 job 增加 `legitimacy`（`"high" | "caution" | "suspicious"`）与 `legitimacy_signals`（≤2 条），判定只用批量评分已有信息（标题年份、描述具体度、薪资透明度、`first_seen_at` 间隔），不做 WebSearch。`suspicious` 不改 fit_score 与 eligible 计算，由队列降级为 manual review。6 维 dim_scores、`recommended` 公式、"Be honest, not generous"、JSON-only 契约不动。`store_scored_jobs.mjs` 对缺失字段向后兼容（默认 `high`）。

### 5.5 新增 `.claude/skills/mrweirdo-tracker/SKILL.md`（Phase 2）

三个功能：① 记录进展（"X 公司给了 OA" → 更新新列 `outcome_status` + `feedback` 表追加事件行）；② 查看 funnel（按 outcome 分组）；③ 已投 ≥15 且非 pending outcome ≥5 时提示跑 `analyze_patterns.mjs`，建议逐条 ask 确认后回写 `search_intent.json` / `target_filters.min_fit_score`。Phase 3 并入 follow-up 草拟（基于 `v_followup_due`；**只草拟、不代发**；"只记录用户确认已发送的 follow-up"；草稿禁用 "just checking in" 类短语）。不碰 `status` 列 emoji 枚举、不触发投递。

### 5.6 新增 `.claude/skills/mrweirdo-expand/SKILL.md`（Phase 3）

扫描 `~/.mrweirdo-jobs/documents/`（`transcripts/`、`linkedin/`、`portfolio/`、`past_applications/`），与三个 profile JSON 做 diff：additive 桶批量确认写 `essay_profile.json`（每项带 `source` 标注保证幂等）；conflicting 桶逐条 `[keep]/[replace]/[manual]`，涉 ATS 实投字段时警告；行为推断只进 essay_profile 且带 `[inferred]`。`work_authorization` / `legal_attestations` / `demographics` 为只读区。验收：双跑幂等、`validate_user_profile.mjs` 通过。

### 5.7 新增 `.claude/skills/mrweirdo-upskill/SKILL.md`（Phase 3）

调 `upskill_report.mjs` 聚合 DB 的 `key_gaps`（权重 `(10 - fit_score)/10`），按 role_category 输出热力图；agent 用 WebSearch 找资源（"Never fabricate resources"、查询带年份）；报告存 `~/.mrweirdo-jobs/reports/upskill-YYYY-MM-DD.md`，二跑起输出与上份的 diff。纯只读。

### 5.8 新增 `.claude/skills/mrweirdo-materials/SKILL.md`（Phase 3）

输入 row id / URL：两问 gate（为什么这家 / 突出哪个 proof point）→ 主会话起草（≤350 词）→ reviewer subagent（backtrack test 查无依据 claim、JD 覆盖、`essay_profile.voice` 语气；输出 `{file, old_string, new_string, reason}` JSON edits + narrative）→ **HTML→PDF**（不引 LaTeX）+ Read 读回检查单页 → 写 `materials/index.jsonl` 元数据。生成物不自动接入 auto-apply 路径（`cover_letter_path` 仍是 batch 默认）。不做 resume tailoring。

### 5.9 auto skills 小改（`mrweirdo-greenhouse-auto` / `mrweirdo-ashby-auto`，Phase 2）

成功提交后调 `node shared/job_report.mjs --row-id $ROW_ID --append-submission`，把实际提交答案摘要、截图路径、时间戳回填 report。8 步流程、一次性 Submit、`record_apply_outcome.mjs` 单一写入口、CAPTCHA 规则全部不动。

### 5.10 新增 references

- `shared/references/truthfulness.md`：backtrack test 三档统一诚实度规约（OK：用 JD 的词重述真实经历 / Flag：学术+实习合并暗示全是 industry 经验 / Never：编造技能、雇主、时长），onboard、materials、gap-retry 的 `agent_open_text` 起草统一引用。
- `shared/references/job_report_template.md`：per-job report 模板 + Machine Summary 字段 allowlist。

---

## 6. Shared Scripts / Settings / Data Model Changes

**总原则**：DB 变更全走 `local_db.mjs` 现有 try/catch ALTER 模式，新列 nullable，旧库零迁移成本；新脚本只读执行链产出、绝不写 `status` 列；新增枚举在 `shared/constants.mjs`（新）单点定义（不学 career-ops 复制 4 处）。

### 6.1 UX 基建（Phase 1）

- **`.claude/settings.json`（新，随 repo 发布）**：精确前缀 allowlist——`doctor` / `discover_candidates` / `store_scored_jobs` / `validate_user_profile` / `init_db_cli` / `apply_report` / `apply_gap_report` / `queue_diagnostics` / `prune_discovered_jobs` / `scripts/preflight.sh` / `Read(//private/tmp/mrweirdo-onboard/**)` / `apply_supervisor.mjs --dry-run`。**刻意排除**：`apply_supervisor.mjs --real`（弹窗 = 第二道花钱闸，与 queue gate 重合而非叠加）、`retry_gap_rows.mjs --apply`、`chrome-cdp-launcher.sh`。不发布 `Bash(node *)` 宽授权。
- **`scripts/preflight.sh`（新）**：收编 Step 0 的 env / mkdir / CDP 探测 / doctor / Node 版本检查，5 个弹窗变 1 个。
- **`scripts/intake_resume.sh`（新，~10 行）**：简历校验 + cp + chmod。
- **`shared/init_db_cli.mjs`（新，~5 行）**：替代 SKILL.md 内联 `node -e` eval（无法 allowlist 且有 quoting 隐患）。
- **`shared/progress.mjs`（新，~30 行）**：进度走 **stderr**（stdout JSON 管道不受影响），格式 `[mrweirdo] <stage> <message>`；接入 `discover_candidates.mjs`（每源一行 + funnel）、`apply_batch.mjs`（每行结果 + **间隔期每 10–15s 倒计时一行**：`⏸ 防风控等待 47s，下一个: Vanta (3/24)`）、`store_scored_jobs.mjs`、`apply_supervisor.mjs`（仅心跳）。`MRWEIRDO_QUIET=1` 可整体关闭。
- **`package.json`**：`"status": "node scripts/dashboard.mjs"`（脚本已存在，接线）。
- **安装器提示**：装完说明"首跑会有 2 次授权：启动 Chrome、开始真实投递——刻意保留，其余已预授权"。

### 6.2 `shared/liveness_gate.mjs`（新，Phase 2）

对队列行的 `apply_url` 做 HTTP fetch（节流 + 抖动 + 严格串行），纯分类器 `classifyLiveness({status, finalUrl, bodyText})` 判定 `live | expired | bot_challenge | uncertain`。规则：Greenhouse `?error=true` 重定向 = expired；Cloudflare challenge = `uncertain` **而非 expired**（避免把活岗位永久拉黑）；`uncertain`/`bot_challenge` 照常进队列（driver 页面层还会判一次 404）。更新新列 `liveness_status` + `liveness_checked_at`；`eligibility.mjs` 守卫链在 `quota_guarded` 之后插 `liveness_expired`；`apply_batch.mjs` 在 preflight 后调用，带 `--skip-liveness` 逃生口。NULL 视同未检查、不拦截。

### 6.3 `shared/job_report.mjs`（新，Phase 2）

`--row-id` / `--batch --run-id` / `--append-submission` 三模式；按 `job_report_template.md` 渲染到 `~/.mrweirdo-jobs/reports/jobs/<row_id>-<company-slug>.md`：岗位摘要 / 6 维分数表 + key_alignment / key_gaps / legitimacy 信号 /（提交后）实际答案摘要 + 截图路径 + 时间戳；文末内嵌 fenced `## Machine Summary` YAML（字段 allowlist：`row_id, company, title, fit_score, dim_scores, legitimacy, outcome_status, ats_platform, submitted_at, gap_fields`），解析器带 `--self-test`。新列 `report_path`。

### 6.4 Tracker 生命周期（改 `local_db.mjs`，Phase 2）

新列：`outcome_status`（`pending | responded | oa | interview | offer | rejected | ghosted`）、`outcome_updated_at`、`last_followup_at`、`followup_count INTEGER DEFAULT 0`。新视图：`v_outcomes`、`v_followup_due`（已投 7 天无 outcome 且 followup_count < 2）。事件复用 `feedback` 表（`outcome_*` 行），不建新表。**`status` 列 emoji 枚举一个字符不动**。

### 6.5 `shared/analyze_patterns.mjs`（新，Phase 2）

输入 `jobs.db`（结构性优势：career-ops 要用正则刮 markdown，我们一条 SQL）。最低样本 gate（已投 ≥15 且非 pending ≥5，`--min-threshold` 可调，不足输出"样本不足"而非弱结论）。统计：funnel、submitted vs skipped 的 fit 分布、按 `ats_platform` / `search_source` / `role_type_match` / score band 的提交成功率与转化率、`skip_reason` 频率 top、negative outcome 行的 `key_gaps` 频率。输出 `/tmp/mrweirdo-onboard/patterns.json` + `~/.mrweirdo-jobs/reports/patterns-YYYY-MM-DD.md`；recommendations 每条带 `target_file` + `proposed_change`，由 tracker skill 逐条 ask 后代写——**脚本永不写配置**。

### 6.6 `shared/upskill_report.mjs`（新，Phase 3）

聚合 scored 行 `key_gaps`（normalize + 加权计数，权重 `(10 - fit_score)/10`），输出 gap → 加权频率 → 公司示例 JSON；零网络请求，资源搜索留给 agent 层。

### 6.7 Materials 元数据（Phase 3）

`~/.mrweirdo-jobs/materials/index.jsonl`（append-only）：`{ts, row_id, type, path, profile_version_hash, reviewed, used_in_submission}`。暂不进 DB；Phase 3 末评估自动接入 batch 时再加 `cover_letter_override_path` 列。

### 6.8 测试

每个新脚本配 `test/*.test.mjs` 纯单测（照现有 16 套件模式）；liveness 分类器用 fixture HTML；ALTER 在含旧数据 fixture DB 上验证幂等；progress 不污染 stdout 的回归测试；`preflight.sh` 的 `bash -n` 进 `demo_check.mjs`。

---

## 7. Phased Roadmap

### Phase 1 —— UX 修复 + 纯 prompt 功能（低风险，先做）

- **Scope**：§6.1 全部 UX 基建；onboard/jobskill/intake-reference 流程改写（intake 合一屏、追问降级、parse 软窗口、queue gate 合并身份复核、gap 问答聚合、prune 去暂停、命令形态标准化、进度与 funnel 输出规则）；score_prompt 加 legitimacy（含 store 端容错）；两个新 references；auto skills 的 report 调用占位说明。
- **Files**：`.claude/settings.json`、`scripts/preflight.sh`、`scripts/intake_resume.sh`、`shared/init_db_cli.mjs`、`shared/progress.mjs` + 4 个脚本接入、`package.json`、4 个 SKILL.md、`references/intake-and-profile.md`、`shared/scoring/score_prompt.md`、`shared/store_scored_jobs.mjs`（~10 行容错）、2 个 references、`test/`。
- **Acceptance**：模拟首跑（干净 `~/.mrweirdo-jobs/`）输入 ≤3 次、权限弹窗 ≤2 次；`--dry-run` 全程任意相邻 stderr 输出间隔 ≤15s；所有 stdout JSON 产物与改前 byte-level 一致；老 scored.json 无 legitimacy 入库不报错；`npm test` / `test:smoke` / `demo:check` 全绿；`--dry-run` 队列行数与 main 一致；对 16 个 skill 做一次 skill↔script 引用一致性走查并修复发现项。
- **Risks**：parse 软窗口让错误方向流到 discovery → 代价只是几分钟重跑，身份事实有 queue gate 二次复核兜底；scorer 新增字段影响 JSON 合规率 → prompt 给一行 few-shot + store 端宽松解析；倒计时刷屏 → 10–15s 一行 + `MRWEIRDO_QUIET=1`。

### Phase 2 —— reports / tracker / 分析

- **Scope**：`constants.mjs`、`liveness_gate.mjs` + batch 接入、`job_report.mjs` + auto skills 回填调用、DB 新列（liveness 2 + outcome 4 + `report_path`）与 2 视图、`analyze_patterns.mjs`、`mrweirdo-tracker` skill、queue preview 补 liveness/legitimacy 展示、apply report 加 funnel 段。
- **Files**：上述新脚本 + `shared/local_db.mjs` + `shared/apply_batch.mjs`（一个调用点）+ `shared/eligibility.mjs`（守卫链插一项）+ `.claude/skills/mrweirdo-tracker/SKILL.md` + 两个 auto SKILL.md + 对应 `test/*.test.mjs`。
- **Acceptance**：旧 jobs.db 打开即迁移且幂等；liveness 全 `uncertain` 时 `--dry-run` 队列行数不变（证明不误杀）；一次 ≤3 行 `--real` 小批量验证 report 回填；patterns 样本不足时正确拒绝；`record_apply_outcome` 与 driver 零 diff。
- **Risks**：liveness 误杀活岗位 → uncertain/bot_challenge 永不拦截 + `--skip-liveness` 逃生口；`eligibility.mjs` 守卫顺序是 6 处消费方的隐性契约 → 新 guard 只插在 `quota_guarded` 之后并补单测锁顺序。

### Phase 3 —— materials / expand / upskill / follow-up

- **Scope**：三个新 skill（materials / expand / upskill）+ `upskill_report.mjs` + tracker 并入 follow-up 草拟 + `documents/` 目录约定。
- **Files**：3 个新 SKILL.md、`shared/upskill_report.mjs`、tracker SKILL.md 扩充、`test/` 对应套件。
- **Acceptance**：materials 对故意注入的虚构技能能拦截（prompt 测试用例）；expand 双跑幂等且只读区不可写（单测）；upskill 在现有 216 行产出非空报告；follow-up 草稿无 "just checking in" 类短语（prompt 测试）；全程执行器核心零 diff。
- **Risks**：HTML→PDF 在无头环境的字体/分页 → 读回检查兜底 + 允许降级 md 交付；expand 误写 ATS 字段 → 只读区白名单 + 单测。

---

## 8. Implementation Prompt For Coding Agent

> 你负责升级 `/Users/lee/Projects/mrweirdo-jobs`。严格按本 PRD 实施 **Phase 1**（§6.1 + §5.1–5.4 + §7 Phase 1 清单），完成并验证后停下汇报，等确认再进 Phase 2/3。
>
> **开工前必读**（按序）：`.claude/skills/mrweirdo-onboard/SKILL.md` 全文、`references/intake-and-profile.md`、`.claude/skills/mrweirdo-jobskill/SKILL.md`、`shared/scoring/score_prompt.md`、`shared/store_scored_jobs.mjs`、`shared/discover_candidates.mjs`、`shared/apply_batch.mjs`、`shared/apply_supervisor.mjs`（理解输出口，行为只读）、`shared/eligibility.mjs`、`shared/local_db.mjs`、`scripts/demo_check.mjs`、`scripts/dashboard.mjs`、`test/json_shapes.test.mjs`、`package.json`。
>
> **实施顺序**：先授权层（settings.json + preflight.sh / intake_resume.sh / init_db_cli.mjs + SKILL.md 命令形态统一）→ 再流程层（SKILL.md / references 改写）→ 最后可见性层（progress.mjs + 接入 + npm run status）→ 评分层（score_prompt legitimacy + store 容错）。
>
> **硬约束**：
> 1. 不修改 `apply_supervisor.mjs` 的提交/gating 行为、任何 `*_apply_driver.mjs`、`record_apply_outcome.mjs`、`validate_auto_row.mjs`、quota guard、fit 阈值；supervisor 只许加 stderr 心跳。
> 2. `--real` 与 `retry_gap_rows.mjs --apply` 不得进 allowlist；queue gate（身份复核块 + 用户明确指令）不得被绕过；`status` 列 emoji 枚举不动。
> 3. progress 只写 stderr；用 fixture 验证所有 stdout JSON 产物 byte-level 不变。
> 4. 不编造底线（visa/GPA/demographic/attestation/background-check/relocation）不得被任何新路径旁路——`apply_gap_report.mjs` 的 `user_*` 与 `agent_attestation` 分类是底线。
> 5. DB 变更走现有 try/catch ALTER 模式、新列 nullable、含旧数据 fixture 验证幂等；新增枚举只在 `shared/constants.mjs` 定义。
> 6. 不新增 npm runtime 依赖；每个新脚本配 `test/*.test.mjs`。
>
> **完成定义**：`npm test`、`npm run test:smoke`、`npm run demo:check` 全绿；`apply_supervisor.mjs --dry-run` 队列行数与 main 一致；提交摘要包含——改后首跑交互点逐条清单（证明输入 ≤3 / 弹窗 ≤2）、静默间隔抽查、每个文件改动目的、新增测试清单、四项验证实际输出。任何验证失败如实报告，不要自行放宽验收线。

---

## 附：竞品工程缺口备忘（佐证"不照搬"的判断）

- **career-ops**：README 宣称的 `.gemini/commands/*.toml` 目录实际不存在；`modes/ar/` 与 `modes/interview.md` 漏出自更新 allowlist；status alias map 在 4 个脚本中复制粘贴而非读取其宣称的 source of truth `states.yml`；`scan.mjs` 仍按西语标题 `## Pendientes` 写 pipeline.md 而文档是英语 `## Pending`（真实 bug）；无 lockfile。→ 它的 markdown-DB + 多语言矩阵路线不可学，但它为此付出的防御性工程（锁、原子写、lint）值得在我们 SQLite 路线上以更低成本实现。
- **ai-job-search**：SETUP.md 与 setup.md 版本漂移（two vs three paths）；`/apply` 从不写 tracker 但 `/upskill` 依赖 tracker 数据；4 个带测试的 Bun scraper 被 README 要求安装却从未被 `/scrape` 调用；`gemini-research-expert.md` 是无引用死件；Bun deps 用 `latest`。→ 它是个人框架而非产品，材料层 prompt 工艺照单全收，工程模式不学。
