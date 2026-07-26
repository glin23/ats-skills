---
Topic: next-priorities
Created: 2026-07-23
Status: in_progress
Owner: arnold-lead
Updated: 2026-07-23
Type: discuss
Parent_task: docs/active/2026-07-22_project-cleanup_TASK.md
Depends_on: none
Blocks: none
Spawned_subtasks: none
---

# TASK — 下一步优先级排序（Mr. Weirdo Jobs）

## 阶段 1 — lead-用户对话

- Round 1: 规整任务收口后浮出两件未排序的事：① `shared/sourcing/_unwired/` 下 5 个没接线的岗位来源平台（SmartRecruiters / Rippling / Personio / BambooHR / Recruitee）要不要接线；② `feat/funnel-report-card` 分支（420 行改动，投递漏斗战报卡）合并还是废弃。两件都不在现行 PRD 的三条优先级里。
- Round 2: 用户问「你有什么建议」。lead 给出调度层观察（看板第一优先是「投完够格存量」，246 个够格岗位在排队、134 个未打分；新增两件是"找更多岗位"和"报告更好看"，不解当前卡点），但明确这属产品优先级判断、该由 pm 定，提议拉 pm 重排。
- Round 3: 用户答「拉」。lead 派 arnold-pm 做优先级重排。
- Round 3 待处理散点：概念与术语词典的「备料 vs 未接线」一对，lead 建议定「未接线」为标准叫法、「备料」进弃用清单，用户尚未表态。状态：推迟到本任务后续，未表态则不重复提。

## 阶段 2 — arnold-pm 优先级重排（status: done_pending_review）

- Round 4: arnold-pm 完成重排（Iterations 2）。产出：`docs/active/2026-07-23_next-priorities_PRODUCT_SPEC.md`
- Round 4 结论：三件事顺序 = ① 投完够格存量 + 修"可投数量"读数（Lever 一行搭车）→ ② 缺信息只跳过该行不中止整批 → ③ 降门槛（押后到存量投空后）。接线 5 个抓取平台、funnel-report-card 分支均判"暂缓/冻结 + 挂触发条件"，不删不合并
- Round 4 关键实测（看板旧数 246/134 已作废，勿再引用）：够格可投 **215**、系统显示 **18**（2026-07-22 `demo:check`，verify 独立复跑）；历史投递 **139** 条、最后一次 **2026-06-14**、至今 **40 天零投递**（`daily_count.jsonl`）；`feedback.jsonl` 126 条中跳过 58、其中表单缺信息 24；`essay_pending.jsonl` 100 条覆盖 72 个岗位；岗位编号已排到 ≥3347
- Round 4 根因发现：`auto_apply_queue.mjs:61` 只认存档字段 `auto_apply_eligible=1`，而该字段仅在真跑批次时刷新（`apply_batch.mjs:226`）→ 所有"还剩多少能投"的显示长期报低约 12 倍。判为产品缺陷，非使用习惯（PRD 未提及）
- Round 4 对 PRD 的反驳：① P1 第一动作应从"并行投递提速"改为"修读数 + 跑通一轮全量"（40 天没跑，无当期耗时数据，无法论证并行）② P3 应拆开——修 Lever 一行零风险提前搭车，降门槛押后（今日读码确认 `apply_url_classification.mjs:3` 仍只有 greenhouse/ashby）
- Round 4 能力边界（如实）：pm 工具箱无命令行，**未执行任何 SQL**；岗位总数 / 未打分数 / `auto_apply_eligible=1` 行数三项查不到，已在 PRODUCT_SPEC §2.2 附只读查询命令，待有命令行的成员补测
- Round 4 待 lead 处理：① living doc `docs/specs/next-priorities.md` 未建（hook 已警告，属 lead 职责，pm 未代建）② 4 个待解问题需拍板人回答（每日投递上限 / 战报卡用途等）
- Round 5: lead 补跑只读 SQL 落实 pm 的根因（pm 无命令行查不到的三项）。实测 jobs.db 真实数字：岗位总数 **950**、已打分 **801** / 未打分 **149**、够格(fit≥5)且从未投过 **292**、其中系统标记 auto_apply_eligible=1 的仅 **20**（约 14.6 倍报低，根因证实）、历史已投 **183**、confirmed_at 非空 **0**、最后一次投递 **2026-06-14**（至今 39 天零投递）
- Round 5 补充发现：292 个够格未投按平台分布 = greenhouse 256 / ashby 20 / lever 16。**存量绝大多数在 greenhouse（已支持自动投递的平台）**，即卡点确在读数字段而非平台支持
- Round 5 口径说明：pm 用 demo:check 输出测得 215，lead 直接查库测得 292，方法不同数字有差；两者都远大于系统显示的 18-20，结论方向一致。后续以直接查库为准
- Round 6: lead 设关卡，把三件事顺序 + 读数缺陷 + 每日投递上限问题端给拍板人

**关卡 1 决策**：🏛️ 🔒 [用户] 拍板 — 三件事按 pm 排序做：① 修「还剩多少能投」读数缺陷 + 跑通一轮完整投递（Lever 支持搭车）→ ② 缺信息只跳过该行不中断整批 → ③ 降门槛（押后到存量投空）。新增两件（5 个未接线平台 / funnel 战报卡）保留不动。**每日投递上限：先小步跑 20-30 条/天**（拍板人定，属账号风险判断）
- Round 7: lead 派 arnold-architect 出第一件事的实施方案。边界：真投递属不可逆对外动作，施工到 verify 可自动跑，**真跑批必须回到用户拍板**
- Round 7 失败（status: failed）：arnold-architect 崩溃——API 连接中途断开（Connection closed mid-response），崩在"已读完全部资料、正要动笔写 DESIGN"那一刻。**DESIGN 未产出，工作区无残留**。按铁律 5 原样上报，不自动重试，等用户决策（续跑 / 重派 / 停）
