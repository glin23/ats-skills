# 定稿 — 项目规整结论（Mr. Weirdo Jobs）

> 只写当前最新结论。来龙去脉见 docs/active/2026-07-22_project-cleanup_*（TASK / DESIGN / BUILD / VERIFY_REPORT）。
> 定稿日期：2026-07-23　质量分：verify 4/5 放行

## 确立的两条结构原则（长期有效）

1. **docs/ 三线制**：现行文档放 `docs/` 根、过程稿放 `docs/active/`、退役文档 `git mv` 进 `docs/archive/`（保历史）。看到 `docs/` 根目录的文件即可默认它现行有效。
2. **代码只有两种状态**：接线的 / 明确标注没接线的（`shared/sourcing/_unwired/`）。不允许「看着像在用其实走不到」的第三种。`shared/sourcing/` 平层从此只放 dispatcher 真能走到的模块。

## 这轮做了什么（已完成，8 个 commit，未 push）

- **git 对齐**：本地 main 对齐 origin/main（内容 diff=0 已验证）、设跟踪上游；PRD-improvements + Arnold 配置入库。
- **文档归档**：PRD-v3 / PRD-onboarding-ux / HANDOFF / launch-posts / agency-meeting(md+svg) → `docs/archive/`；会议 PDF 不入库（md 可再生成）。
- **死代码隔离**：6 个零引用模块 → `shared/sourcing/_unwired/`（5 个抓取模块 + 视觉兜底定位器），带 README 说明接线方法。搬家引出的运行时路径 bug 已修（commit 7a6efbc）。
- **文档补账**：ARCHITECTURE 修 4 处漂移 + 补 7 个漏记技能；CHANGELOG 补 6 月改动（记在 [Unreleased]）；ROADMAP 排入 PRD-improvements 的 P1/P2/P3。
- **清理**：删仓库内个人资料快照（先备份到 `~/.mrweirdo-jobs/archive-repo-20260722/`）、临时打分文件夹、Notion 遗留 2 模块、2 份废弃模板、会议 PDF、7 个本地已合并分支。
- **治理补丁**：file_size_limits.json 补 `.mjs: 800`（存量超限文件进「只减不增」模式）。

## 关卡拍板结论

- **关卡 1**（🩺）：删除清单按架构师建议档批准——删垃圾/遗留、挪备料不删、归档历史不删。施工节奏 = 6 步一次跑完终点验收。
- **关卡 2**（🩺）：Arnold 配置入公开库；版本号先不发（改动留 [Unreleased]）；D-08 `examples/launch-posts.md` 原地保留（是发布门禁的哨兵，非历史垃圾，设计漏看了引用）。

## 明确留待后续（不在本轮）

- `shared/` 平铺 60+ 文件的内部分组重构：本轮判「不做」（20 个技能 + 30 个测试写死路径，搬动风险落在主链路）。要做需单独立项 + 全量回归。
- verify 报告 3 项风险：零引用扫描对 `_unwired/` 自我失明、`ATS_CDP_PORT` 遗留命名、`ats_overrides` 僵尸字段。
- `feat/funnel-report-card` 分支（420 行未合并功能）去留：产品拍板，已入 ROADMAP。
- 远端 7 个已合并分支删除 + push：对外动作，待用户确认后由 ops 执行。
