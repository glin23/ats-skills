---
Topic: project-cleanup
Created: 2026-07-22
Status: in_progress
Owner: arnold-lead
Updated: 2026-07-22
Type: refactor
Parent_task: none
Depends_on: none
Blocks: none
Spawned_subtasks: none
---

# TASK — 项目规整（Mr. Weirdo Jobs）

## 阶段 1 — lead-用户对话

- Round 1: 用户在 init 访谈中提出：「把这个项目好好规整一下——architecture 是乱的、folder setup、skills setup 都要整理，还链接着一个 GitHub Repo 也要理一理」。并授权「现有内容该删的删掉」。lead 判断：删除属不可逆动作，只出建议清单、逐条等拍板，不悄悄删。
- Round 2: lead 识别为 refactor/audit 类，流水线：architect 盘点出方案（含建议删除清单）→ 关卡拍板 → builder 施工 → verify 验收。
- Round 3: lead 自查 GitHub 状态（简单查询不派人）：远端 origin=github.com/glin23/mrweirdo-jobs；8 个功能分支正常跟踪；main 未设跟踪上游 + 1 个未推送提交（3e15692 README 美化）；工作区有 2 个未提交文件（docs/PRD-improvements.md、docs/agency-meeting/）+ 本次 init 新建的配置/地基文件。

## 阶段 2 — arnold-architect 规整盘点（status: in_progress）
- Round 4: lead 派 arnold-architect 做规整盘点（后台），产出目标 docs/active/2026-07-22_project-cleanup_DESIGN.md；等产出后设关卡等拍板
- Round 5: arnold-architect 首次派工失败（status: failed）——API 月度消费上限触顶，成员未开工即终止；用户说「继续」并切模型到 opus-4-8，lead 重派一次
- Round 6: arnold-architect 重派成功（Iterations 2）。产出: docs/active/2026-07-22_project-cleanup_DESIGN.md（374 行）
- Round 6 要点: 第 2 轮推翻第 1 轮"代码无错放"结论——全量引用图实测出 8 个零引用模块约 2530 行（5 个 sourcing 抓取模块 1654 行 + notion_sync 463 + migrate_notion 190 + computer_use_locator 224）+ 2 份零引用模板；技能组织实测无孤儿、最整齐；main"1 个未推提交"经 diff 核验为误判（内容已 squash 进远端，diff=0）
- Round 7: lead 设关卡 1，把 §5 删除清单（14 条）与 6 步搬迁方案端给拍板人，等拍板后才施工

**关卡 1 决策**：🩺 🔒 [用户] 拍板 — 删除清单按架构师建议档批准（删：仓库内个人资料快照〔先备份〕/ 临时打分文件夹 / Notion 遗留 2 模块 / 2 份废弃模板 / 8 个已合并分支 / 会议 PDF；挪进未接线区不删：5 个抓取模块 + 视觉兜底定位器；归档不删：3 份历史文档 + 发布文案草稿）；施工节奏 = 6 步一次跑完、终点验收
- Round 8: lead 派 arnold-builder 串行执行第 1~6 步（本地范围）；push 与远端分支删除属对外动作，留到终点验收后单独确认再由 ops 执行
