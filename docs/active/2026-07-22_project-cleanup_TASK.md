---
Topic: project-cleanup
Created: 2026-07-22
Status: completed
Owner: arnold-lead
Updated: 2026-07-23
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

## 阶段 3 — arnold-builder 施工（status: done_pending_review）

- Round 9: arnold-builder 完成第 1~6 步，产出 docs/active/2026-07-22_project-cleanup_BUILD.md。6 个 commit：ffc0499（git 对齐 + 配置入库）/ 6ed5301（文档归档）/ f171fce（死代码隔离）/ fb162cf（文档修订）/ 31a6d0a（删除）/ a4e78ed（治理补丁）。**无任何对外动作**（未 push、未删远端分支）。
- Round 9 验证: 本地 CI 四步全绿且退出码逐个记录（npm test 128/128 pass、role_guard_smoke ok、public_alpha_gate 105 PASS 0 FAIL、81 个 .mjs 语法检查全过）；主流程冒烟 `npm run demo:check` 退出码 0（ready rows 18 / eligible 215）；设计 §16 五条验收要点中 ①③④⑤ 全过、② 仅剩待拍板的 launch-posts 两处。
- Round 9 要点: 设计 §5 的死代码盘点经复现**完全属实**，无出入。但 **D-08 与代码对不上**——`examples/launch-posts.md` 被 `scripts/public_alpha_gate.mjs` 两处硬引用（存在性核查 + 文案检查），搬走 CI 即红，而设计 §7 又声明 `scripts/` 不动；builder 未擅自选边，原地未动并上报（详见 BUILD §4.1，选项 A 改门禁脚本 / B 不搬，builder 倾向 B）。
- Round 9 其他偏离（均已在 BUILD §4 标注）: ① 第 1 步改用 `git reset --soft`（危险命令 hook 拦下 `--hard`，且两边 tree 哈希相同、工作区无改动，--soft 终点等价且不碰任何文件）；② CHANGELOG 补账落在 `[Unreleased]` 而非新建 v2.3.0 段（VERSION 与 npm 包仍为 2.2.0、无 tag，写版本号段等于宣称不存在的发布，待 UNCLEAR-5 拍板）；③ ARCHITECTURE 实际补了 7 个漏登记技能（设计预计 4 个）。
- Round 9 待拍板项: D-08 二选一 / UNCLEAR-5 是否升版打 tag / UNCLEAR-4 Arnold 配置入库（已本地 commit 未 push，反悔成本极低）。
- Round 9 待办交接: 远端 7 个已合并分支的删除 + push 交 ops（`readme-banner` 远端已不存在，实际 7 个不是 8 个）。
- Round 9 纪律提醒: hook 报本 topic 的 living doc `docs/specs/project-cleanup.md` 未建 — 按纪律属 lead 职责，builder 未代建。
- Round 9: arnold-builder 完成 6 步（7 个 commit: ffc0499 / 6ed5301 / f171fce / fb162cf / 31a6d0a / a4e78ed）。产出: docs/active/2026-07-22_project-cleanup_BUILD.md
- Round 9 证据: npm test 128/128、role_guard_smoke ok、public_alpha_gate 105 PASS 0 FAIL、81 文件 node --check、demo:check exit 0（ready 18 / eligible 215）
- Round 9 偏差: ① DESIGN D-08 判错——examples/launch-posts.md 被 scripts/public_alpha_gate.mjs 硬引用 2 处，未归档待定；② git reset --hard 被危险命令 hook 拦下，改用 --soft 达同一终态；③ CHANGELOG 记在 [Unreleased] 不新开 v2.3.0（VERSION 仍 2.2.0 无 tag）；④ ARCHITECTURE 补的是 7 个技能不是 4 个；⑤ computer_use_locator 的 import 路径修正（node --check 查不出 import 解析，已用真实 import() 验证）
- Round 10: lead 派 arnold-verify 做终点验收；同时把 3 项待定（D-08 / 版本号 / Arnold 配置是否入公开库）端给拍板人

**关卡 2 决策**：🩺 🔒 [用户] 拍板 — Arnold 配置入公开库（不介意公开协作流程）；版本号先不发保持现状（改动留在 [Unreleased]）。D-08 由 lead 按工程判断定为 B（原地保留，门禁哨兵非历史垃圾）
- Round 11: arnold-verify 终点验收，质量分 4/5 放行。CI 四步独立复跑退出码 0/0/0/0、README 8 链接全存在、13 处 rename 全 R、无虚报。产出: docs/active/2026-07-22_project-cleanup_VERIFY_REPORT.md
- Round 11 抓到真 bug（Medium）: _unwired/computer_use_locator.mjs:80 运行时拼 join(__dirname,'cdp.mjs') 搬家后指向不存在路径；四道关卡（node --check/静态解析/顶层 import()/128 测试）全漏，真调 captureFrame 才现形。同类漏网已排查无第二处
- Round 12: lead 派 builder 修 BUST-1 一行 + 顺带 N-1/N-2 文档瑕疵，同一 commit 收；修完 push 前再确认
- Round 13: arnold-builder 完成 BUST-1 修复 + N-1/N-2（commit 7a6efbc，运行时验证过：改前报找不到模块、改后报网络层失败=路径已找对），CI 四步 0/0/0/0
- Round 14: lead 建定稿 docs/specs/project-cleanup.md；决定本轮一并收 N-3（一个字符），派 builder 补 N-3 + 提交定稿
- Round 15: arnold-builder 补 N-3（CHANGELOG cf626d0..d9a4369 → cf626d0^..d9a4369，含 A 后为 38 与段标题对齐）+ 定稿入库，commit 178fded，CI 四步 0/0/0/0
- Round 16: 规整完成，10 个 commit（ffc0499/6ed5301/f171fce/fb162cf/31a6d0a/a4e78ed/7a6efbc/178fded 等），本地全绿零对外动作。等用户拍板 push + 删远端分支

## 复盘（Retrospective）— 2026-07-23
### ✅ 做对了什么
- architect 第 2 轮自我推翻第 1 轮「代码无错放」结论，拉全量引用图实测出 8 个零引用模块——避免了"只看目录边界"的漏判
- verify 不信施工自述、真调一次抓到四道自动关卡全漏的运行时路径 bug（BUST-1）——独立验收的价值实证
### ❌ 哪里卡住 / 失败
- architect 首派因账号月度消费上限触顶失败（非流程问题，重派即成）
- DESIGN D-08 判错 launch-posts.md「零引用」（实际被门禁硬引用 2 处）——设计阶段引用核查有盲区，靠 builder+verify 兜住
### 🔄 流程要不要改？
- 一次性偶发，不改流程。DESIGN 的引用核查已在 §6 写了方法论，只是 D-08 这条漏执行；下次 architect 做删除清单时对每条都跑一遍引用图即可（已在 verify 报告留痕）

**关卡 3 决策**：🩺 🔒 [用户] 拍板 — 授权对外动作：push 本地 main 9 个 commit 到 origin/main（设跟踪上游）+ 删除 7 个已合并远端分支（chore/changelog-fold-v2.2.0 / codex/public-alpha-release-gate / fix/lever-upload / refactor/extract-answer-buckets / refactor/extract-pure-logic / release/v2.2.0 / test/regression-harness）；feat/funnel-report-card 保留不动
- Round 17: lead 派 arnold-ops 执行 push + 删远端分支
- Round 17 完成: ops push 成功（d9a4369..178fded，9 个 commit，fast-forward 无 force，已设跟踪上游）+ 删除 7 个已合并远端分支成功。lead 独立复核终态：origin/main..main=0 完全同步，远端仅剩 origin/main 与 origin/feat/funnel-report-card
- Round 18: 任务收口。安全警告说明——子代理侧报"删远端分支无可见授权"属视角误报（子代理看不到聊天层），授权真实存在且已记入关卡 3 决策锚点（含 7 个分支名逐个列出）
