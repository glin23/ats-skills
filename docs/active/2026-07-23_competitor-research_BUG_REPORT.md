---
Status: done_pending_review
Owner: arnold-bug
Reads:
  - docs/active/2026-07-23_competitor-research_TASK.md
  - docs/specs/competitor-research.md
  - docs/specs/next-priorities.md
  - PROJECT_CONTEXT.yaml
Blocks: none
Updated: 2026-07-25
Iterations: 1
Type: bug
---

# BUG_REPORT — 投递回执确认记录全为 0（confirmed_at）

## 给拍板人的一句话

**你的产品不知道自己投出去的有没有回音——而且它从来就没试过去知道。**

不是坏了，是这个功能一直躺在那儿等人手动去按，而按它之前还要先做两件从来没人告诉过用户要做的准备工作（在 Gmail 里建一个邮件标签规则 + 装一个读 Gmail 的插件）。183 条投递、零条回执记录，是「从没启动过」，不是「启动了记错了」。

顺带查实的第二件事同样严重：主流程第 6 步「持续跟进直到拿 offer」也是同一个状态——系统内部其实已经算出「有 158 条投递超过 7 天没动静、该跟进了」，但这个数字从来没被端到任何人面前。

---

## 1. 现场（What happened）

复验属实，数据来自 `~/.mrweirdo-jobs/jobs.db`（只读连接 `mode=ro`，未做任何写入）：

| 实测项 | 数值 |
|---|---|
| 岗位总行数 | 950 |
| 已投（submitted_at 或 auto_submitted_at 非空） | **183** |
| 状态为 `✅ 已投` | 182 |
| 状态为 `✅ 已确认` | **0** |
| `confirmed_at` 非空 | **0** |
| `confirmation_email_id` 非空 | **0** |
| `confirmation_url` 非空 | 163（见 §2，这个字段不是回执） |
| `outcome_status` 全部取值 | `pending` × 950（无一例外） |
| `outcome_updated_at` / `last_followup_at` 非空 | 0 / 0 |
| `followup_count` > 0 | 0 |
| 最后一次投递 | 2026-06-14T21:26:36Z |
| `v_followup_due`（系统自算的「该跟进了」清单） | **158 行** |

旁证（第 3 问「有没有它曾经工作过的痕迹」）——**一处都没有**：

- `feedback` 数据表 292 行，事件类型只有 skip 119 / submitted 110 / requeued 27 / essay_pending 21 / success 15，时间跨度 2026-05-26 ~ 2026-06-14，**没有任何一条回执或跟进相关事件**。
- `~/.mrweirdo-jobs/feedback.jsonl` 里 22 行含 "confirm" 字样，逐条看过，全部是 `on_confirm_url`（提交后落地页判定），与「对方回信」无关。
- `~/.mrweirdo-jobs/log/dispatch.log` 与 `onboard.log` 中 "confirm" 出现次数 **0**。
- `~/.mrweirdo-jobs/reports/` 100 份报告里没有任何回执类产物。

## 2. 回执确认机制原本是怎么设计的

三个字段分工完全不同，先把它们拆开（此前的判断里把它们当成了一类）：

| 字段 | 谁写 | 什么时候写 | 实测 |
|---|---|---|---|
| `confirmation_url` | `shared/record_apply_outcome.mjs:163`、`shared/local_db.mjs:375`（markApplied） | **投递成功的那一刻**，写的是提交后落地页地址 | 163 行有值 — 正常工作 |
| `confirmed_at` | **只有** `shared/local_db.mjs:405` 的 `markConfirmed()` | 收到对方确认邮件、匹配上本地行之后 | 0 行 |
| `confirmation_email_id` | 同上 `markConfirmed()` | 同上，存 Gmail 会话 id（不存邮件正文，隐私考虑） | 0 行 |

**结论一（事实）**：`confirmation_url` 有 163 条不代表我们有回音——它只是「我们点完提交后浏览器停在哪一页」，写它的时候对方一个字都还没回。漏斗最后一格确实是空的。

`markConfirmed()` 的唯一调用方是谁？grep 全仓库：

- 生产代码调用次数：**0**
- 测试调用次数：**0**（`test/` 下 32 个测试文件无一引用 `markConfirmed` 或 `confirmed_at`）
- 唯一调用处：`.claude/skills/mrweirdo-confirm/SKILL.md:115` 里的一段 bash 片段 —— 也就是说，**它是由 AI 助手在用户手动输入 `/mrweirdo-confirm` 之后照着说明书敲出来执行的**，不是任何程序自动跑的。

这条链路完整长这样：

```
用户手动输入 /mrweirdo-confirm
  → 前置 1：用户自己在 Gmail 建好过滤规则，把回执邮件打上 applied-jobs 标签
  → 前置 2：Claude Code 已连 Gmail MCP（读邮件的插件）
  → 拉近 7 天带该标签的邮件 → AI 抽公司/岗位 → 与近 14 天 ✅ 已投 行匹配
  → markConfirmed() → confirmed_at 落库
```

`outcome_status` / `last_followup_at` / `followup_count` 是**另一条同构的手动链路**：`shared/tracker_cli.mjs`，用户每收到一封回信要手动跑一次 `--row-id <行号> --outcome <结果>`，或 `--followup-sent`。同样零自动触发。

## 3. 根因（Why it happened）

### 判定：**从没被触发过**（不是跑了但坏了）

**事实层证据（可复现）**：

1. 全仓库零自动触发点。`grep mrweirdo-confirm` 只命中 4 处，全是文字提示：`setup.sh:195`（安装后帮助文本）、`README.md:135`、`docs/ARCHITECTURE.md:82`、`.claude/skills/mrweirdo-onboard/SKILL.md:482`（投递批次结束时打印的一行「48h 后同步确认邮件」）。**没有 cron、没有批次结束后的自动调用、没有任何守护进程。**
2. 前置条件从未被安排过，也从未被检查过。skill 要求用户先在 Gmail 建标签过滤规则——全仓库 `applied-jobs` 这个标签名只出现在 skill 自己和 `README.md:77`（一句「Optionally reads Gmail threads...」）。**新用户引导流程（onboard）、安装脚本（setup.sh）、体检脚本（doctor / demo_check）三者都没有任何一步提到、设置或校验它。**
3. Gmail 读取插件当前未装。`~/.claude.json` 里注册的 MCP 服务是 magic / framer / stitch / feishu-writer / xiaohongshu-mcp / notion，**没有 Gmail**；项目级 MCP 列表为空。（旁注：`claudeAiMcpEverConnected` 里有 "claude.ai Gmail"，说明网页端曾连过该连接器，因此**不能断言它在任何会话里都不可用**——这一条我只当作弱证据。）
4. 零运行痕迹（§1 的四项旁证）。

**推测层（明确标为推测，不作为结论依据）**：我推测用户从未输入过 `/mrweirdo-confirm`。严格说，存在一种不可证伪的边角情形——跑过、但 Gmail 里 0 封带标签邮件，skill 按设计打印一行提示就退出，不写库也不写日志。这种情形与「从没跑过」在数据上无法区分。但无论落在哪一种，**结论都是同一个：这套机制从未产生过任何一条数据**。

### 追加根因：就算今天马上跑，也救不回这 183 条（事实，已实测）

这是本次排查最值钱的发现。skill 的取数窗口是硬编码的：

- Gmail 侧：`newer_than:7d`（近 7 天邮件）
- 本地库侧：`queryRecentlyApplied(14)` —— `shared/local_db.mjs:465`，写死 14 天

最后一次投递是 2026-06-14，距今 41 天。我用只读 SQL 原样模拟了这个查询：**返回 0 行**。也就是说，现在输入 `/mrweirdo-confirm`，它会打印「最近 14 天没有 ✅ 已投 row」然后退出。**历史 183 条投递，用现有工具永远无法补记回执。**

### 追加缺陷：24 行投递对回执匹配天然隐身（事实）

`queryRecentlyApplied()` 的过滤条件是 `status='✅ 已投' AND submitted_at >= :since`。而实测：

- `status='✅ 已投'` 且 `submitted_at IS NULL` 的行有 **24 行**（它们只有 `auto_submitted_at`，来自 2026-05-26~27 的早期人工驱动路径，`bot_note` 显示 `manual_main_claude_drive` / `ashby_apply_driver v1` 等）。
- 这 24 行同时被 `v_followup_due` 排除（该视图也要求 `submitted_at IS NOT NULL`）——这正好解释了 182 − 24 = **158** 这个数字。

当前代码路径（`record_apply_outcome.mjs:161-162`）两个字段都写，所以这是历史遗留数据，不是新增缺陷；但它会让回执匹配和跟进提醒**静默漏掉 13% 的投递**。

另有一个次级隐患：`submitted_at` 存在两种格式混用（24 行 ISO `2026-06-14T21:26:36Z`，134 行 SQLite 空格式 `2026-06-14 20:06:38`），而 `queryRecentlyApplied` 用的是**字符串比较**而非 `datetime()` 比较，同一天边界上会误判。（已实测排除它是 `confirmed_at` 为 0 的原因：SQLite 3.51.0 的 `datetime()` 两种格式都能正确解析。）

## 4. 同模式风险扫描（Where else can it happen）

**扫描范围**：`shared/` 全部 60+ 个 .mjs、`scripts/`、`bin/`、`.claude/skills/` 20 个 skill、`test/` 32 个测试文件、`~/.mrweirdo-jobs/` 运行期产物与日志。

**同一模式 = 「数据表字段建好了 + 写入函数写好了 + 触发方式只写在 SKILL.md 里靠人记得手动跑 + 无测试 + 无健康检查」**。命中三处，全部为 0 值：

| 位置 | 字段 | 触发方式 | 实测 |
|---|---|---|---|
| `mrweirdo-confirm` → `local_db.mjs:405` | `confirmed_at` / `confirmation_email_id` | 用户手打命令 | 0 / 0 |
| `mrweirdo-tracker` → `tracker_cli.mjs:35` | `outcome_status` / `outcome_updated_at` | 用户手打命令，且要逐行报行号 | 全 pending / 0 |
| `mrweirdo-tracker` → `tracker_cli.mjs:51` | `followup_count` / `last_followup_at` | 用户手打命令 | 0 / 0 |

**这不是三个 bug，是主流程第 6 步「持续跟进直到拿 offer」整段从未落地。** 前 5 步（简历 → 定岗 → 找岗 → 投递 → 报告）都有自动化、有日志、有测试；第 6 步只有数据表字段和三份说明书。

**扫描出的第二类同模式风险 — 恒零指标被当成真实 0 显示**：`shared/apply_report.mjs:55` 的漏斗里有一格 `confirmed_total`，直接输出 0，页面上不区分「测过，确实是 0」和「根本没在测」。这正是最高原则里的静默降级：报告读起来像「我们投了 183 家，0 家回复」，实际是「我们投了 183 家，没统计过有几家回复」。这两句话对产品判断的影响完全相反。`shared/analyze_patterns.mjs` 有样本量门槛（<15 投递或 <5 非 pending 结果就返回「样本不足」），设计上比报告好，但它同样只在用户手动跑时才说话。

## 5. 修复方案（How to fix）— 建议，本轮不执行

按「消除根因 vs 绕过症状」标注。根因是**测量链路只存在于说明书里、且没有前置条件保障**，所以只补一行提示不算修。

| # | 建议 | 性质 | 说明 |
|---|---|---|---|
| A1 | 去掉 14 天硬编码，`queryRecentlyApplied` 支持 `--since` / `--all` | 消除根因（可测性） | 不做这条，历史 183 条永远进不了匹配集 |
| A2 | 匹配集改用 `COALESCE(submitted_at, auto_submitted_at)`，并把比较改成 `datetime()` 而非字符串 | 消除根因 | 一次性把隐身的 24 行拉回来，顺手解决格式混用 |
| B | 报告与看板：当 `confirmation_email_id` 全空时，`confirmed_total` 显示「未开启测量」而不是 0 | 消除根因（反静默降级） | 零风险、改动最小、直接解决「我们不知道自己知不知道」 |
| C | 体检脚本（`shared/doctor.mjs` / `scripts/demo_check.mjs`）增加一项：回执测量是否就绪（Gmail 标签规则 + 读邮件插件），未就绪就明说「回复率无法统计」 | 消除根因（前置条件收口） | 现在这两个脚本对回执一个字都没有 |
| D | 投递批次结束后，不只打印一行「48h 后跑 /mrweirdo-confirm」，而是把「N 条待确认 / 158 条到期待跟进」直接算给用户看 | 消除根因（触发方式） | 靠人记得手动跑 = 等于没有，已经被 41 天的数据证明 |
| E | 若拍板人不愿接 Gmail 读取（隐私顾虑合理）：做「30 秒手动确认」兜底——列出待确认清单让用户勾选，或 `tracker_cli` 支持批量标记 | 绕过症状但**诚实**：它测的是真实分子 | 关键是先有数，测得丑胜过测不出 |
| F | 补测试（见 §6） | 防回归 | 当前该链路测试覆盖为零 |

**优先级建议（供 lead 与拍板人取舍）**：B + C 最小、最快、零风险，先让系统承认自己没在测量；A1 + A2 是让历史数据可救；D 决定这事以后会不会又停 41 天；E 是不接 Gmail 时的退路。

**明确的取舍面**：快 vs 彻底——只做 B 一天就能上线，但回复率依然是零；A+C+D+E 才真正把漏斗最后一格点亮，代价是要碰投递主链路之外的三个 skill。**我建议不要只做 B**，理由是 §4 已经证明这不是单点缺陷而是整段第 6 步缺位；只做 B 等于把「我们不知道」这句话印得更大，仍然不知道。

**我这个修法会不会破坏别的路径（自查）**：A2 若把 `status='✅ 已投' AND submitted_at IS NULL` 的 24 行纳入匹配集，它们会同时进入 `v_followup_due`（158 → 182），跟进提醒数量会跳变；这是正确的，但要提前告诉用户，别让人以为是新 bug。另外 `markConfirmed` 会把 status 改成 `✅ 已确认`，`SUBMITTED_STATUSES`（`shared/job_identity.mjs:1`）已包含该值，去重与不重复投递逻辑不受影响——这一点我核对过，**不会出现「确认后又被当成没投过再投一次」**。

## 6. 防回归（How to prevent regression）

本轮只查不修，故未新增测试；以下是修复时应先红后绿的清单：

1. `markConfirmed()` 单元测试：写入后 `confirmed_at` / `confirmation_email_id` / status 三者同时正确（当前零覆盖，这也是这个函数从未被验证过的原因之一）。
2. `queryRecentlyApplied()` 用例：① `submitted_at` 为空但 `auto_submitted_at` 有值的行必须能被取到 ② 两种时间格式混用时边界日不漏 ③ 窗口参数可调。
3. `demo_check` / `doctor` 增加断言：回执测量未就绪时必须显式报「未开启」，不得静默显示 0。
4. 报告快照测试：`confirmed_total` 在无测量时输出的是提示文案而非数字 0。

## 7. 教训（What to remember）

1. **只写在说明书里、靠人记得手动跑的机制，等于不存在。** 41 天、183 条投递、零次触发已经证明了这一点。凡是产品主流程上的环节，触发权不能留给记忆力。
2. **漏斗最后一格恒为 0 时，系统必须自己喊出来。** 「测出来是 0」和「压根没测」在界面上必须长得不一样——这是最高原则「禁静默降级」在指标层的直接对应，建议沉淀进项目记忆。
3. **字段名相近不等于语义相同。** `confirmation_url` 有 163 条一度看起来像「有回执」，实际是提交后落地页地址。以后判断某个能力是否在工作，要追到「谁在什么时刻写这个字段」，不能看非空计数。
4. **窗口硬编码 = 给未来的自己上锁。** 14 天窗口让历史数据永久不可补记；这类「只面向当下」的默认值，在一个本来就低频使用的产品里代价特别大。

（以上第 1、2 条属结构性教训，是否沉淀进项目记忆或岗位补充说明，由 lead 决定，我未自行改写任何记忆文件。）

## 8. 如果这是未完工功能，还差什么

按「用户装上就能用」的标准，回执确认这条链路差 5 件：

1. **引导缺失**：新用户引导流程里没有「建 Gmail 标签规则」这一步（30 秒的事，但没人告诉用户）。
2. **依赖缺失**：读邮件插件（Gmail MCP）没有安装引导，也没有可用性检查；skill 只在运行到一半才发现没有然后退出。
3. **触发缺失**：没有自动或半自动的触发点，全靠用户主动想起来。
4. **历史不可补**：窗口硬编码 14 天 + 7 天，存量投递救不回来（§3）。
5. **可观测缺失**：没有任何地方显示「这项能力当前是关的」，导致产品对外和对内都以为自己在测量回复率。

**完成定义（建议，供拍板人判断工作量）**：跑完一轮投递后，用户不需要记住任何命令，就能看到「本轮 N 条投递，其中 M 条已收到确认，K 条超过 7 天无动静建议跟进」；如果回执测量没开，这段话要变成「回执测量未开启，一分钟设置好 →」。

## 试过的错误方向

1. **假设 `markConfirmed()` 自身写入失败被静默吞掉。** 该函数确实用 `try/catch` 包住并返回 `{ok:false, error}`（这本身是个隐患，调用方不检查就等于丢错），一度是最像的嫌疑。**失败原因**：逐字段核对 UPDATE 语句与 `local_db.mjs:91-93` 的表结构，字段名、参数绑定名全部对得上，语法无误；更关键的是若它执行过、哪怕失败过，183 行里应至少留下 status 变化或 `feedback` 事件，实测两者皆为零痕迹。排除。
2. **假设「回执其实记在别处」——`confirmation_url` 有 163 条非空，怀疑回执走了这个字段。** **失败原因**：读 `shared/record_apply_outcome.mjs:163` 与 `local_db.mjs:375`，该字段在提交成功的同一条 UPDATE 里由驱动返回的 `post_url` 写入，时间点是「我们点完提交」，与对方是否回信无关。这个方向不仅错，还差点把「有 163 条 URL」误报成「机制部分工作」。排除。
3. **假设时间戳格式混用（ISO 带 T/Z 与 SQLite 空格式各 24/134 行）导致写入或比较失败。** **失败原因**：在 SQLite 3.51.0 上实测 `datetime('2026-06-14T21:26:36Z')` 与 `datetime('2026-06-14 20:06:38')` 均正确解析，视图 `v_followup_due` 也未因此漏行（漏的 24 行是因为 `submitted_at IS NULL`，不是格式）。格式混用是真实存在的次级隐患（`queryRecentlyApplied` 用字符串比较），但不是 `confirmed_at` 为 0 的原因。降级为次级发现，未当根因。
4. **假设有 cron 或批次结束后的自动调用坏掉了。** **失败原因**：`grep -rn mrweirdo-confirm` 全仓库仅 4 处命中，逐处打开确认全部是给人看的文字提示（安装帮助、README 表格、架构文档、批次结束的一行 next step），不存在任何可执行的调用点；`crontab` 相关配置在仓库与运行目录中均不存在。排除。
