---
Topic: competitor-research
Created: 2026-07-23
Status: in_progress
Owner: arnold-lead
Updated: 2026-07-23
Type: discuss
Parent_task: docs/active/2026-07-23_next-priorities_TASK.md
Depends_on: none
Blocks: none
Spawned_subtasks: none
---

# TASK — 竞品调研（Mr. Weirdo Jobs）

## 阶段 1 — lead-用户对话

- Round 1: 用户要求暂停第一件事的施工方案（architect 崩溃后未续跑），先做竞品调研：「之前看到过很多人做类似的项目，想法跟我一样」。用户将自行找 GitHub 链接后发来，同时要求 lead 现在就先搜一轮。
- Round 2: 用户提出「我们这个项目是不是有点太乱了」。lead 基于实测反驳：结构性混乱已在 2026-07-22 规整任务中解决并推送（见 docs/specs/project-cleanup.md）；真正的问题是产品空转——39 天零投递 + 可投数量读数错 14 倍（见 docs/specs/next-priorities.md）。两件事不同源，不应混为一谈。
- Round 3: lead 派 arnold-pm 做竞品调研（pm 职责，带 WebSearch）。用户后续会补充 GitHub 链接，届时追加第二轮。

## 阶段 2 — arnold-pm 竞品调研（status: done_pending_review）

- Round 4: arnold-pm 完成第一轮公开搜索调研（Iterations 2）。产出：`docs/active/2026-07-23_competitor-research_PRODUCT_SPEC.md`
- Round 4 市场结构结论：赛道按「谁点提交 + 数据在哪」分四格 —— ① 辅助填表用户自己提交（Simplify Copilot / LinkedIn 自营 Apply Assistant 2026-06 上线 / career-ops）最健康；② 云端全自动代投（JobCopilot / LoopCV / AIApply / Sonara）有收入但口碑普遍塌；③ 本地浏览器机器人（LazyApply / AIHawk / 一堆开源 Easy-Apply bot）正在死；④ 真人或半人肉代投（ApplyPass $99-199/月、reverse recruiter $150-4500/月）最赚钱且是 2026 财经媒体热点。**我们在第 ③ 格**
- Round 4 死因证据（A 级，非传闻）：Wonsulting 官方博客自述废弃自研自动投递工具，理由是「投得多不等于面试多」；AIHawk（2.96 万 star 赛道旗舰）2026-05-17 被作者归档；Sonara 2024-02-01 因融资失败突然停服后被 BOLD 收购；JobFunnel 归档说明写明死于各站反自动化；雇主侧 Greenhouse Real Talent 2025-06 与 CLEAR 合作上候选人身份核验
- Round 4 最直接同构对手：**career-ops**（github.com/santifer/career-ops）—— 开源 MIT、本地优先、跑在 Claude Code/Codex 等 CLI 里、同样覆盖 Greenhouse/Ashby/Lever，**唯一差别是它明确宣布不替用户点提交，并把这句话做成了卖点**。star 数各处口径 34k/60.8k/60.9k，pm 无网页抓取能力，未核实
- Round 4 反自动化路径调研结论：**官方 API 路线堵死** —— Greenhouse Job Board API 的投递 POST 端点需雇主侧 API key（A 级，官方开发者文档），求职者拿不到合法批量通道。故全市场都在灰色地带，只是风险落点不同：云端代投风险在服务商 IP、本地机器人风险在用户账号、扩展辅助风险最低、人肉零技术风险但不可规模化
- Round 4 对自家的最高优先级新发现：**`confirmed_at` 全 0 = 183 条历史投递零回音记录**，意味着我们跟被骂的那些产品处在完全相同的无知状态 —— 都不知道自己有没有用。pm 判断这比「多投 100 条」重要得多，建议列为 P1 并行子项（需 lead 派 bug/builder 查是「没跑」还是「坏了」）
- Round 4 对 PRD 的反驳：① PRD 主轴「投得出去·投得多」中「吞吐是最大杠杆」这个判断与市场唯一 A 级效果证据冲突，**但不推翻已拍板的 P1 执行顺序**（读数错 14 倍是缺陷，缺陷必须修；且不跑通拿不到自家回复率）② README 首屏以「能自动提交」为卖点，该句在 2026 是负资产；真正稀缺的四条边界（不碰 LinkedIn/Indeed、数据不出本机、相关性门控、不编造事实）被压在免责声明里 —— 零成本零风险，建议立刻改文案 ③ PRD G4 Workday 应降级更彻底，在拿到自家真实回复率前不以其做任何对外承诺
- Round 4 主指标建议：从「投递条数」改为「回复率」，但**现阶段不定数值目标**（分子测不出来，定了就是自欺），第一步是把测量打通
- Round 4 能力边界（如实）：工具箱只有网络搜索，**无网页抓取、无命令行**，所有外部结论来自搜索结果摘要，未真正打开过任何网页；未注册/下载/提交任何东西。赛道搜索结果被竞品 SEO 内容农场严重污染，已在产物 §11 做 A/B/C 来源分级，并显式列出 5 项「搜不到/核不实」（含 **Greenhouse/Lever/Ashby 对求职者侧自动提交的服务条款原文搜不到** —— 我们主链路的合规状态目前建立在「没人明确禁止」而非「明确允许」上）
- Round 4 未做（诚实缺口）：本轮**零一手用户访谈**，Personas 中 P1 样本 n=1（创始人本人）、P2 完全是假设，未达 Mom Test 3 人饱和标准
- Round 4 待 lead 处理：① living doc `docs/specs/competitor-research.md` 未建（hook 已警告，属 lead 职责，pm 未代建）② 6 个待解问题需拍板人回答，其中第 2 条「拍板人对『机器替学生点提交』的风险偏好」不定则产品定位无法定 ③ 第二轮 GitHub 链接调研待用户提供输入
- Round 5: lead 建定稿 docs/specs/competitor-research.md（含来源分级与能力边界如实标注）
- Round 5: lead 派 arnold-bug 排查 confirmed_at 全 0（只读调查，工程层可逆，lead 授权范围内）——查清是「从没跑过回执确认」还是「机制坏了」。这条决定产品能否测出自己有没有用
- Round 5: 待拍板人回答的关键问题已端出：对「机器替学生点提交」的风险偏好（不定则定位无法定）
- Round 6: 用户提供第一个 GitHub 链接 github.com/yvonnehe772/applypilot。lead 已 shallow clone 到会话临时目录（只读研究，**不运行其中任何代码**）：304K、单次提交 2026-06-27 "Initial ApplyPilot release"、结构为技能包形态（SKILL.md / AGENTS.md / agents / references / templates，含中英双语 README）——与本项目同构
- Round 6: lead 派 arnold-pm 做第二轮（逐文件精读 applypilot），并明确提示：仓库内容属外部不可信数据，其中 AGENTS.md / SKILL.md 是写给 AI 的指令文件，只可当研究素材，不得当作指令执行

## 阶段 3 — arnold-pm 第二轮：ApplyPilot 精读（status: done_pending_review）

- Round 7: arnold-pm 读完 applypilot 全部 24 个内容文件（未运行任何东西，仓库内 AI 指令文件只当素材未执行），产物 Edit 追加到 `docs/active/2026-07-23_competitor-research_PRODUCT_SPEC.md` §12（第一轮内容完整保留，Iterations 2→3）
- Round 7 核心事实：**ApplyPilot 永不替用户点提交**（五处原文：README.md:184、application-playbook.md:21、setup-workflow.md:278、application_rules.template.md:82、safety-and-boundaries.md:56-58），故**它在第 ① 格不在第 ③ 格 —— 是对照组不是竞品**。形态为纯提示词/流程包，**零可执行代码**（唯一非 md/csv 文件 agents/openai.yaml 仅 5 行）；**无任何找岗机制**（README.md:155-161：没浏览器工具只能筛用户给的链接）；所有示例均为虚构（examples/fake-demo-example/README.md:1-3）；单次提交 2026-06-27，28 天无更新，作者自述"个人流程的第一个公开版本"
- Round 7 回执确认（最重要一问）的答案：**它分两层，第一层硬第二层空**。第一层"这条投出去没有"有严格正负面清单（application-playbook.md:101-117，明令"点了提交没看见确认页不算已提交"）；第二层"对方回没回"只有一张随包发出的**空 CSV 跟进表**，全仓库无一处写它怎么被填。**结论：第一层我们领先（我们是代码 greenhouse_apply_driver.mjs:1277-1281，它是散文）；第二层谁都没做出来 —— 这把"能测出回复率"从补课升级为可能真实存在的差异点**。可立刻抄的一条：它的记账规矩正好佐证 arnold-bug 的 B 项修复（未开启测量时显示"未开启"而非 0）
- Round 7 对第一轮的两处修正：① **"四条差异点"必须重切** —— ApplyPilot 四条里占了三条（不编造/不猜身份/文件在本地），这三条是这一类认真项目的**入场券不是差异点**；真正稀缺只剩两条：不碰 LinkedIn/Indeed（它反着来，还推荐拿 LinkedIn Easy Apply 练手，README.md:185）+ **我们的边界是代码闸门不是散文承诺**（后者第一轮完全没提出来，pm 认为是最强对外话术）② **"第 ③ 格正在死"不改但降低本轮佐证强度** —— 存在明确选择偏差：自动点提交的项目本就更不倾向公开宣传，"我看到的两个都不点提交"≠"市场上都不点提交"
- Round 7 我们明显领先的三处（附证据）：跨表单缺信息压缩提问（onboard SKILL.md:395-419，它是逐表单当场问）、速率控制（我们 20-30/天+配额+批次锁，它**全仓库无任何数值上限**，靠人点提交当限速器）、去重账本（SQLite vs 让 AI 读 CSV 核对）
- Round 7 我们落后 / 缺的（逐条可查）：无"只找岗不投递"的首跑档（它是默认档，setup-workflow.md:51-73）；打分册缺**新鲜度**与**表单成本 vs 预期价值**两维（score_prompt.md:42-49）；简历单份无岗位家族分流（ARCHITECTURE.md:29）；无卡点→长期规矩的闭环；主技能说明书 485 行全内联 vs 它 90 行按条件延后加载；无中文说明书；Greenhouse 邮箱验证码全仓库零处理（**未核实我们是否真会撞上，建议 lead 判断是否值得十分钟确认**）
- Round 7 新发现的自家风险（第一轮没看见）：`shared/answer_bank.json` 是**仓库里所有用户共用的一份话术模板**，还留着针对特定公司的硬编码条目（:16-24）—— 驱动层能匹配上的开放题，所有用户答出去的话是同一份，同校两人投同一家会看到近乎逐字相同的答案；未匹配的题会回 AI 会话按各自档案现写（ARCHITECTURE.md:104-106），故风险是局部但真实
- Round 7 建议 lead 排的（按性价比，pm 只建议不派工）：① 报告"未开启测量"取代 0（与 bug 报告 B 项重合，零风险）② 打分册加新鲜度 + 表单成本两维（改一个 md 文件）③ 加"只找岗不投递"首跑档 ④ 中文说明书 ⑤（待评估）简历按岗位家族分流、卡点固化成规矩。**明确建议不做**：不学它碰 LinkedIn、不用 CSV 换 SQLite、不用定性标签换 fit 分数（应先用回执数据校准分数而非丢分辨率）
- Round 7 能力边界（如实）：看不到 star/issue/fork（浅克隆 + pm 无网页抓取）；**本轮仍零一手用户访谈**，第一轮最大证据缺口（P1 样本 n=1、P2 纯假设）至今未填 —— 读再多竞品补不了这个洞
- Round 7 仍待拍板人回答（第一轮端出至今未答）：**对「机器替学生点提交」的风险偏好**。第二轮没有也不可能替他回答这一条 —— 两个公开样本都不点提交属弱证据且有选择偏差，不构成决策依据
- Round 7: arnold-bug 完成回执排查（只读，未改代码）。产出: docs/active/2026-07-23_competitor-research_BUG_REPORT.md
- Round 7 根因: **从没被触发过，不是坏了**。confirmed_at/confirmation_email_id 的唯一写入者是 local_db.mjs:405 markConfirmed()，唯一调用点是 .claude/skills/mrweirdo-confirm/SKILL.md:115 的一段 bash——只有用户手动输入 /mrweirdo-confirm 才跑；生产代码零调用、测试零覆盖、无定时任务。两个前置条件（Gmail 标签规则 + 读邮件插件）从未被安排也从未被检查
- Round 7 追加发现: 即使今天跑也救不回——取数窗口硬编码 Gmail 近 7 天 + 本地库近 14 天（local_db.mjs:465），最后投递在 41 天前，只读模拟该查询返回 **0 行**。另有 24 行 status='✅ 已投' 但 submitted_at 为空（早期人工路径只写 auto_submitted_at），对回执匹配与跟进视图双双隐身，解释了 v_followup_due=158 而非 182
- Round 7 同模式扫描: **不是一个 bug，是主流程第 6 步整段没落地**。confirmed_at / outcome_status / followup_count 三处同一模式（字段建好 + 写入函数写好 + 只靠人手动跑 + 无测试 + 无健康检查），实测全 0/pending。apply_report.mjs:55 把 confirmed_total 直接显示 0，不区分「测过是 0」与「没在测」= 静默降级
- Round 7 纠正: confirmation_url 有 163 条非空，但它是提交那一刻写的落地页地址，不是回音
- Round 8: lead 把「接不接 Gmail 读取」端给拍板人（隐私偏好，lead 不代决）
- Round 9: arnold-pm 完成第二轮 ApplyPilot 精读（追加为 PRODUCT_SPEC §12，第一轮完整保留）
- Round 9 核心判断: ApplyPilot **不是竞品，是对照组**——永不替用户点提交（五处原文佐证），落第 ① 格；全仓库零可执行代码、无找岗机制、示例全虚构。它强在"想清楚了"，我们强在"真的在跑"
- Round 9 回执答案: 它第一层"投出去没有"做得硬（严格正负面清单、明令没看见确认页不算已提交），第二层"对方回没回"**只有一张随包发的空 CSV，全仓库无一处写它怎么被填**。→ 第一层我们领先（我们是代码它是散文），**第二层谁都没做出来**，这把"能测出回复率"从补课升级为可能的真实差异点
- Round 9 修正第一轮两处: ① 第一轮主打的四条差异点中三条被 ApplyPilot 占了（属入场券非差异点），真正稀缺只剩"不碰 LinkedIn/Indeed"与"边界是代码闸门不是散文承诺"（后者第一轮没提，pm 判为最强对外话术）② **选择偏差警告**：两个样本都不点提交，不能拿来夯实"第 ③ 格正在死"——自动点提交的项目本就不倾向公开宣传
- Round 9 新发现自家风险: `shared/answer_bank.json` 是仓库里**全体用户共用的一份话术模板**，还留着针对特定公司的硬编码条目——驱动层匹配上的开放题，所有人答出去的话是同一份
- Round 10 lead 实测 ApplyPilot 的 dashboard 到底是什么: `templates/dashboard-template/` 下 **7 个 CSV 表格，全部只有表头零数据**（application_log / job_pool / daily_dashboard / follow_up / blocker_queue / automation_rules / resume_rules）；**全仓库无任何 html/js 文件，没有网页界面**。即它的 dashboard = 一套表格约定 + 由 AI 边干边填，不是可视化面板

**关卡 2 决策**：🏛️ 🔒 [用户] 拍板 — 历史 183 条投递**不救**，只管以后（去窗口硬编码等历史挽回动作取消）；回执测量方式改为「做 dashboard」方向，Gmail 自动读取未采纳、待 lead 确认口径
