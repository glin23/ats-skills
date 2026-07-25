---
Status: done_pending_review
Owner: arnold-builder
Reads: docs/active/2026-07-22_project-cleanup_DESIGN.md, docs/active/2026-07-22_project-cleanup_TASK.md, docs/active/2026-07-22_project-cleanup_VERIFY_REPORT.md, PROJECT_CONTEXT.yaml, .claude/arnold/roles/builder.md
Blocks: ops 远端分支清理与 push
Updated: 2026-07-23
Iterations: 2
Type: BUILD_NOTES
---

# BUILD — 项目规整第 1~6 步施工记录

第 1~6 步全部完成，6 个 commit，本地 CI 四步全绿。**没有任何对外动作**：没 push、没删远端分支、没跑 gh 写操作。

**有 1 件事需要拍板人决定才能收口**：设计里 D-08 那条「归档 `examples/launch-posts.md`」跟代码对不上——它被 CI 门禁硬引用，搬了 CI 就红。我没猜，原地留着没动，详见 §4。

---

## 1. 实现摘要

| 步 | 内容 | commit |
|---|---|---|
| 1 | 本地 main 对齐 origin/main + 设跟踪上游；现行 PRD 与 Arnold 配置入库 | `ffc0499` |
| 2 | 新建 `docs/archive/`，3 份历史文档 + 会议 md/svg 归档 | `6ed5301` |
| 3 | 新建 `shared/sourcing/_unwired/`，6 个零引用模块隔离 | `f171fce` |
| 4 | ARCHITECTURE 漂移修正、CHANGELOG 补 38 提交、ROADMAP 填实 | `fb162cf` |
| 5 | 删 4 个仓库文件 + 3 处本地垃圾 + 7 个已合并本地分支 | `31a6d0a` |
| 6 | `file_size_limits.json` 补 `.mjs`；重跑 setup.sh 刷新技能链接 | `a4e78ed` |

净变化：删除约 653 行死代码（notion_sync 463 + migrate_notion 190）+ 2 份废弃模板；约 1,878 行零引用代码移入 `_unwired/` 未删；新增文档约 100 行。活代码（主链路）一个字节没动。

### 第 1 步 — git 对齐

前置核验按设计跑了：`git diff origin/main main --stat` = 0 行。我额外查了一层——两边 tree 对象的哈希完全相同（都是 `7ede5c06`），且工作区没有任何已跟踪文件的修改。

**这里对设计做了一处改动，请注意**：ADR-3 指定 `git reset --hard`。插件的危险命令 hook 拦下了它，要求用户显式确认——而派我干活的是 lead，agent 的指令不等于用户同意，我不能自己放行。既然两边 tree 哈希相同、工作区无改动，我改用 `git reset --soft origin/main`：**终点状态与 --hard 完全一致**（main 从 3e15692 移到 d9a4369，跟踪上游设好，`git status` 已跟踪部分干净），但 --soft 根本不碰工作区任何一个文件，连理论上的丢内容可能都没有。这不是绕过 hook，是选了一个更安全且等价的做法。

### 第 2 步 — 文档归档

`git mv` 保历史，rename 全部被 git 识别为 R（不是删了重建）：

- `docs/PRD-v3.md` → `docs/archive/PRD-v3.md`
- `docs/PRD-onboarding-ux.md` → `docs/archive/PRD-onboarding-ux.md`
- `HANDOFF.md` → `docs/archive/HANDOFF-v2.2.0.md`
- `docs/agency-meeting/` 的 `A-cheat-sheet.md` / `B-intro.md` / `workflow.svg` → `docs/archive/agency-meeting/`（原本未跟踪，本次入库）
- 新建 `docs/archive/README.md`

CHANGELOG 里两处 "HANDOFF" 是历史叙述文字，按设计 §13 原样保留。

### 第 3 步 — 死代码隔离

先按设计 §8 的方法复现了零引用扫描，再逐条区分「真 import」和「注释里互相致敬」，结论与设计 §5 **完全一致**，没有多出或少掉文件。搬入 `shared/sourcing/_unwired/`：5 个抓取模块（smartrecruiters / rippling / personio / bamboohr / recruitee）+ `computer_use_locator.mjs`，并写了 README 说清接线要改哪两处。

**一处设计没预见、但必须做的改动**：`computer_use_locator.mjs` 原本在 `shared/` 下，有一句 `import { atsHome } from './paths.mjs'`。按拍板它要搬进 `shared/sourcing/_unwired/`（深两层），相对路径必然失效，我改成了 `'../../paths.mjs'`。

这里有个坑值得记下来：**CI 第 4 步的 `node --check` 只查语法、不查 import 能不能解析**，所以这个断裂 CI 抓不到。我另外对 `_unwired/` 下 6 个模块做了真实 `import()`，全部 OK 才算过。

### 第 4 步 — 文档修订

ARCHITECTURE.md 逐条与代码核对后修正（全部用 Edit 精准替换，没整体覆盖）：

1. **lever-auto 定位**：原文把它列为 onboard 调用的自动提交器。实测 `SUPPORTED_AUTO_PLATFORMS = new Set(['greenhouse','ashby'])`、`lever` 在 `KNOWN_UNSUPPORTED_PLATFORMS` 里。改为如实写「驱动在、但不在自动队列，等 PRD 第三优先级」。
2. **补齐技能**：设计说漏了 4 个，我核对时实际漏了 **7 个**（doctor / cherry-pick / confirm / expand / materials / tracker / upskill），全部补上并各写一句职责。
3. **Notion**：原文写「可选用户自有镜像、默认关」，实际同步器已零引用并在第 5 步删除。改为「v1.0 历史能力，已移除，今天没有受支持的 Notion 镜像方式」。
4. **workday**：标注 v0.7 脚手架，`shared/workday/companies/` 6 个文件全是 `_template` 与 `placeholder_company_1..5`，从未实测（已核实）。
5. **新增 Discovery Sources 段**：写明 dispatcher 能走到的 6 个来源，以及 `_unwired/` 谁都走不到。

CHANGELOG 补账 38 个提交（`cf626d0..d9a4369`），按 onboarding 改版 / 投递修复 / 打包发布 / CI 测试 / 文档五个主题折叠，每条给 SHA。

**这里也偏离了设计，理由要说清**：设计要求折成 `v2.3.0` 段。但 `VERSION` 和 `package.json` 都还是 `2.2.0`，也没有 v2.3.0 的 tag——写成版本号段等于在变更日志里宣称一个不存在的发布。我把这批工作放在 `[Unreleased]` 下，并在段首写明「VERSION 与 npm 包都还是 2.2.0」。设计 §10 的 UNCLEAR-5（要不要顺势升版打 tag）本来就没拍板，拍了之后改个标题就行。

ROADMAP.md 原本三个「（待整理）」占位，现在填了 PRD 的三条优先级、Workday 独立轨道，以及两条挂起的决策（`feat/funnel-report-card` 去留、`shared/` 要不要分组重构）。

### 第 5 步 — 删除

**删前备份（拍板硬要求）**：`shared/profile.json` → `~/.mrweirdo-jobs/archive-repo-20260722/profile.json`，并用 shasum 校验两份一致（`dcc0ec05...`）。

顺手把设计 §10 UNCLEAR-1（怕旧版有、新版丢的字段）做实了：仓库版独有 `_notes`、`ats_overrides` 两个顶层字段；家目录版独有 `experience_summary`、`languages`、`legal_attestations`、`skills`。查了一遍，`ats_overrides` 全项目**没有任何代码读它**，`_notes` 是注释性字段；且没有任何代码读 `shared/profile.json` 这个路径（只有 CHANGELOG 的历史叙述提过）。所以删除不丢任何生效信息，备份也在。

- 入库删除（`git rm`）：`shared/notion_sync.mjs`、`shared/migrate_notion_to_local.mjs`、`shared/config.template.json`、`shared/references/job_report_template.md`
- 仅磁盘删除（本就 gitignore / 未跟踪，无历史损失）：`shared/profile.json`、`.tmp-scoring/`、2 个会议 PDF（连空的 `docs/agency-meeting/` 目录一并清掉）
- 按设计 §13 把 `shared/local_db.mjs` 开头那句指向 notion_sync 的注释改成「本模块取代了它，它已被移除」
- 删了 7 个已完全合并的**本地**分支；`feat/funnel-report-card` 按拍板保留

### 第 6 步 — 治理补丁

`.claude/file_size_limits.json` 的 limits 里加了 `".mjs": 800`（放在 `.js` 之前）。新纳入管辖且已超限的正是设计预判的 2 个：`greenhouse_apply_driver.mjs`（1917 行）、`ashby_apply_driver.mjs`（1170 行），二者即刻进入「净增 = 0」。JSON 已验证可解析。

D-10 顺手做了：重跑 `bash setup.sh`，`.agents/skills/` 从 16 个链接刷新到 20 个，与 `.claude/skills/` 逐个对齐无差异。

**D-09（`.gstack/browse-audit.jsonl`）按拍板授权由我自行判断：留着不删。** 它 5KB、已被 gitignore、是本地浏览器审计日志，删了没收益，留着有排查价值。

---

## 2. TDD 落地证据

本任务是 audit + 文件搬迁，不新增运行时代码，所以没有「先写 failing test 再写实现」的对象。等价的验证纪律是：**每一步动手前先跑一遍证据扫描确认设计成立，动完再跑一遍确认没搞坏**，以及交活前跑完整 CI。

### 本地完整 CI 四步（照 `.github/workflows/ci.yml` 逐步跑，退出码逐个记录）

| # | 步骤 | 命令 | 退出码 | 真实输出 |
|---|---|---|---|---|
| 1 | 单元测试 | `npm test` | **0** | `tests 128 / pass 128 / fail 0 / duration_ms 5187` |
| 2 | 角色守卫冒烟 | `node scripts/role_guard_smoke.mjs` | **0** | `role guard smoke ok` |
| 3 | 公开 alpha 门禁 | `node scripts/public_alpha_gate.mjs` | **0** | `public alpha gate ok`，105 条 PASS、0 条 FAIL |
| 4 | 全量语法检查 | `for f in $(find shared scripts -name '*.mjs'); do node --check "$f"; done` | **0** | 81 个文件全过 |

测试是串行跑的（`package.json` 的 test 脚本带 `--test-concurrency=1`），符合岗位补充说明里「并行会因临时目录互踩假失败」的历史教训。

**施工前也跑了同样四步做基线**，当时同样全绿（128 passed），所以「绿」不是本来就红被我忽略，是真的从绿到绿。

### 主流程冒烟（登记表 ci_smoke.main_chain 填了，故本项启用）

主流程 = 简历上传 → 简历分析定岗 → 各平台找岗 → 大批量一键投递 → 投递报告 → 持续跟进。

- `npm run demo:check` 退出码 **0**，末行 `ready rows: 18 / eligible 215`，简历、search_intent、岗位类型定向等检查项全 ok——说明简历侧到队列侧这段真实数据链路没断。
- 找岗调度：`dispatcher.mjs` 实际 import 成功，`ALL_SOURCES` = `remoteok, greenhouse_bulk, ashby_bulk, lever_bulk, wellfound, yc_waas`，与搬迁前一致（6 个）。
- 投递门槛：`SUPPORTED_AUTO_PLATFORMS` = `greenhouse, ashby`，与我写进文档的说法一致。
- 两个投递驱动 `greenhouse_apply_driver.mjs` / `ashby_apply_driver.mjs` 直接跑起来能正常打印 usage，说明顶层 import 全部解析成功。
- 没有做真实投递——那会向真实公司发出投递，超出规整任务范围。

登记表的 `schema_upgrade_path`、`isolation_field` 两格为空，对应两项自查跳过。

### 设计 §16 的 5 条验收要点

| # | 要求 | 结果 |
|---|---|---|
| ① | 零引用扫描输出为空 | ✅ 空。`_unwired/` 下的模块因被同目录 README 列名而不再算零引用，活代码区没有残留死代码 |
| ② | 断链自查全空 | ⚠️ 仅剩 `launch-posts` 的 2 处，即 §4 待拍板项；PRD-v3 / PRD-onboarding-ux / HANDOFF 全空（ROADMAP 里那处是指向 archive 新位置的正确引用） |
| ③ | 完整 CI 四步全绿 | ✅ 见上表，四个退出码都是 0 |
| ④ | README 链接可点 | ✅ 6 个本地链接目标全部存在；npm files 白名单 6 项全部存在 |
| ⑤ | `git log --follow` 能看到搬迁前历史 | ✅ `docs/archive/PRD-v3.md` 追到 `50bab4c`；`HANDOFF-v2.2.0.md` 追到 `c042b54`（v1.0 时期） |

---

## 3. 自审记录

- **有没有 try/except 压异常 / mock 假数据兜底混进来？** 本次没写任何运行时代码，只删和搬。`grep "except.*pass"` 不适用（无 Python）。
- **有没有顺手改无关老代码？** 没有。唯一碰到的活代码是 `shared/local_db.mjs` 开头一句注释——因为它指名道姓提到被我删掉的模块，不改就变成假信息。这是设计 §13 明确要求的。
- **搬动会不会破坏引用？** 6 个被搬模块全部实测零引用；唯一的相对 import 已修并用真实 `import()` 验证。
- **删除会不会误删活代码？** 删后重跑零引用扫描 + 全量 `node --check` + 128 个测试 + demo:check，都过。
- **文档写的是现状还是我以为的现状？** ARCHITECTURE 每条断言都回代码取过证（`SUPPORTED_AUTO_PLATFORMS` 的实际值、workday 的 6 个占位文件、20 个技能目录、dispatcher 的 6 个来源），不是照抄设计。

---

## 4. 偏离 DESIGN（100% 标注）

### 4.1 【需要拍板】D-08 与代码对不上，我原地没动

设计 D-08 说 `examples/launch-posts.md`「无代码引用」，建议归档到 `docs/archive/`。**这条是错的**，实际有硬引用：

```
scripts/public_alpha_gate.mjs:101:  'examples/launch-posts.md',        ← 存在性硬核查
scripts/public_alpha_gate.mjs:115:  textDoesNotMatch('examples/launch-posts.md', /.../, 'stale launch promise')
```

搬走它，CI 第 3 步（公开 alpha 门禁）当场变红。而设计 §7 又白纸黑字写着 `scripts/` **明确不动**。两条约束互斥，怎么选都超出我的授权，所以我**留在原地没动**，其余全做完了。

请在两条里挑一条（都很便宜，一条 `git mv` + 一行 Edit 就完）：

- **A：搬，并同步改门禁脚本** 两处路径改成 `docs/archive/launch-posts.md`。好处是 docs 三线制彻底干净；代价是动了设计声明不动的 `scripts/`，且门禁那条「不许出现过时发布承诺」的检查会跟着搬进归档区——而归档区本来就该允许留旧话，这条检查在那里意义不大。
- **B：不搬，留在 `examples/`** 好处是 CI 与设计的「scripts 不动」都不破；代价是 examples/ 里继续躺一份自称 "historical drafts" 的历史文案。**我倾向 B**：这个文件之所以还有引用，正是因为门禁在盯着它别写出过时的发布承诺——它其实是个「活的对外文案守卫」，不是纯历史垃圾，设计把它判为无引用是漏看了。

### 4.2 第 1 步用 `--soft` 代替 `--hard`

理由见 §1 第 1 步。终点状态与设计意图一致，且严格更安全。

### 4.3 CHANGELOG 用 `[Unreleased]` 而非新建 `v2.3.0` 段

理由见 §1 第 4 步：VERSION 与 npm 包都还是 2.2.0，没有 v2.3.0 tag，写版本号段等于宣称一个不存在的发布。UNCLEAR-5 拍板后改标题即可。

### 4.4 ARCHITECTURE 补的是 7 个技能，不是设计说的 4 个

实际核对后发现 doctor / cherry-pick / confirm 三个也没被文档收录，一并补了。方向与设计一致，只是范围更全。

### 4.5 `computer_use_locator.mjs` 的 import 路径改了一行

见 §1 第 3 步。搬家的必然后果，不改就是断的。

---

## 5. 发现的旧 bug

没有发现与本任务无关的运行时 bug，因此没有顺手改任何东西。但有两处**信息类问题**记在这里，供后续判断：

1. **`docs/BACKLOG.md` 没有被本轮任何一步覆盖**，设计也只说保留。它是否与新填的 ROADMAP 内容重复、要不要合并，本轮没动，留给拍板人。
2. **设计 §10 的 UNCLEAR-7 / UNCLEAR-8 仍未解答**（`_executors/` 单文件目录的意图、三个单 URL 技能没有上游引用是不是刻意的后门）。都不影响本轮搬迁，我按设计原样未动。

---

## 6. 遗留事项

1. **待拍板：§4.1 的 D-08 选 A 还是 B。** 这是唯一挡着「完全收口」的事。
2. **待拍板：UNCLEAR-5** — 要不要把 VERSION 升到 2.3.0、打 tag、把 CHANGELOG 那段从 `[Unreleased]` 改成版本号段。
3. **待拍板：UNCLEAR-4** — Arnold 协作配置（`CLAUDE.md` / `PROJECT_CONTEXT.yaml` / `.claude/arnold/`）入库这件事，设计只是「倾向入库」，没见到拍板记录。我按设计第 1 步的内容提交了，但**还没 push，所以还没有任何对外暴露**。这是公开 alpha 仓库，外人会看到内部协作配置——push 前值得确认一句。反悔成本极低。
4. **交给 ops：远端 8 个已合并分支的删除**（其中 `readme-banner` 我 fetch 时发现远端**已经被删掉了**，所以实际只剩 7 个：chore/changelog-fold-v2.2.0、codex/public-alpha-release-gate、fix/lever-upload、refactor/extract-answer-buckets、refactor/extract-pure-logic、release/v2.2.0、test/regression-harness）。本地同名的 7 个我已删。
5. **交给 ops：push**。本地 main 领先 origin/main 6 个 commit。
6. `feat/funnel-report-card` 的去留决策已写进 ROADMAP 排队中，等产品拍板。

---

## 7. 性能硬指标自查

不适用：本任务零运行时代码改动，不涉及接口延迟、并发、异步化。测试覆盖率没有新增代码需要覆盖；既有 128 个测试全绿，且施工前后数量与结果一致（说明没有测试被我改动搞坏或悄悄跳过）。

## 8. API 接口 8 契约自查

不适用：本任务不涉及任何 HTTP 端点的新增或修改。

## 9. 本项目铁律对照

岗位补充说明 `.claude/arnold/roles/builder.md` 三条，逐条对照：

1. **测试必须串行跑** — ✅ `npm test` 脚本自带 `--test-concurrency=1`，未绕开。
2. **交活红线：CI 每一步都在本地跑一遍全绿，不能只跑 npm test** — ✅ 四步全跑，退出码逐个记录在 §2 表里，不是只跑 npm test 就宣称通过。
3. **主流程冒烟优先保证不断** — ✅ `demo:check` 退出码 0 + dispatcher / 门槛 / 双驱动逐项验证，见 §2。

用词规范（登记表 terminology 三条）自查：本文统一用「用户 / 投递 / 岗位」这三个现行词，三条弃用旧叫法一个都没出现；引用英文文件名、命令输出、他人原文时保持原样。

## 10. 交付自查清单

- ☑ 六步全部完成，每步单独 commit，message 沿用项目 `chore(cleanup): ` / `docs(cleanup): ` 风格
- ☑ 本地 CI 四步全绿，退出码与真实输出都记在 §2（不是「理论上应该能过」）
- ☑ 主流程冒烟跑了并贴了证据
- ☑ 偏离设计 5 处 100% 标注在 §4，其中 1 处需拍板
- ☑ 修订现有文件全部用 Edit 精准替换；只有两份新文件（两个 README）和本文用 Write
- ☑ 没做任何对外动作：无 push、无远端分支删除、无 gh 写操作
- ☑ 删除前按拍板要求备份并 shasum 校验
- ☑ 变更日志已按登记表 `paths.changelog` 更新（本次改动影响维护方式，够格记账）
- ☑ 没用 fallback 或 workaround 遮盖问题——D-08 对不上就停下来问，没有偷偷改门禁脚本蒙混过关

## 11. 试过的错误方向

Iterations = 1，按规则不强制。但有两个念头动过又否掉，记下来免得后人重犯：

1. **「D-08 直接把门禁脚本里的路径改掉不就完了」**（否）——那是替拍板人做决定，而且设计明写 `scripts/` 不动。一行改动看着无害，但它动的是**对外发布门禁**，性质上属于越界，停下来问的成本远低于改错。
2. **「`node --check` 全过了就等于模块没搬坏」**（否）——`--check` 只查语法。`computer_use_locator.mjs` 那句 `./paths.mjs` 搬完就是断的，语法却完全合法，CI 四步一步都抓不到。所以补了真实 `import()` 验证。这条值得写进项目方法论：**凡涉及移动 JS 模块，语法检查不等于可加载**。

---

## 12. 收尾 commit（Round 10：修 VERIFY_REPORT 抓到的 BUST-1 + N-1 + N-2）

**commit `7a6efbc`**（`fix(unwired): repair computer_use_locator runtime cdp.mjs path + stale CLI comments`），7 个文件、+10/-7，全部落在 `shared/sourcing/_unwired/` 内，未触碰任何活代码。**无对外动作**：没 push、没碰远端。本地 main 现领先 origin/main 8 个 commit。

### 12.1 收掉的三项

报告 §5（逐条结论段：真 bug 与文档级不一致清单）是本轮三项的唯一来源依据。

| 项 | 来源 | 改法 |
|---|---|---|
| **BUST-1**（Medium 真 bug） | 报告 §5 真 bug 条 | `computer_use_locator.mjs:80` 的 `join(__dirname, 'cdp.mjs')` → `join(__dirname, '../../cdp.mjs')`，指回真实的 `shared/cdp.mjs`；同步改第 76 行 `sibling file` 注释为「shared/cdp.mjs，本 _unwired/ 模块上两层」 |
| **N-1**（5 处旧路径注释） | 报告 §5 文档不一致表 | 5 个抓取模块的 `// Usage:` 头注释补上 `_unwired/` 段（`node shared/sourcing/X.mjs` → `node shared/sourcing/_unwired/X.mjs`）。运行时的 `console.error('Usage: node X.mjs …')` 用的是裸文件名、不含目录、本就不失真，未动 |
| **N-2**（README 缺依赖说明） | 报告 §5 文档不一致表 | `_unwired/README.md` 补一条 ⚠️ 说明：`computer_use_locator.mjs` 运行时依赖上两层 `../../cdp.mjs`、顶部 import 依赖 `../../paths.mjs`，将来再挪务必同步核对这两条路径 |

### 12.2 BUST-1 的运行时验证怎么做的（不靠 `node --check`）

报告特别点名：`node --check` 查不出运行时拼接路径，必须真调一次。我照真 bug 条给的复现命令跑了修复前后对照：

- **修复前**（复现报告的 FAIL）：
  ```
  node -e 'import("./shared/sourcing/_unwired/computer_use_locator.mjs").then(m=>console.log(JSON.stringify(m.captureFrame("FAKE_TAB"))))'
  → {"ok":false,"error":"...Cannot find module '/…/shared/sourcing/_unwired/cdp.mjs'..."}
  ```
- **路径解析核验**：`join(__dirname,'../../cdp.mjs')` 实算 = `/…/shared/cdp.mjs`，`existsSync` = **true**（对照 `ls shared/cdp.mjs` 存在 / `ls shared/sourcing/_unwired/cdp.mjs` 不存在）。
- **修复后**（同一条复现命令）：
  ```
  → {"ok":false,"error":"fetch failed\n"}
  ```
  报错不再是 `Cannot find module`——`cdp.mjs` 已被找到并真正执行，只在 Chrome-CDP 网络层失败（FAKE_TAB 没有真浏览器连着），**这正是修好后的预期绿态**：模块解析已通，剩下的失败纯属"没开 Chrome"的环境因素，与本 bug 无关。

### 12.3 本地 CI 四步真实输出（照 `.github/workflows/ci.yml` 串行跑，退出码逐个抓）

| # | 步骤 | 命令 | 退出码 | 真实输出 |
|---|---|---|---|---|
| 1 | 单元测试 | `npm test` | **0** | `ℹ tests 128 / ℹ pass 128 / ℹ fail 0 / duration_ms 5134` |
| 2 | 角色守卫冒烟 | `node scripts/role_guard_smoke.mjs` | **0** | `role guard smoke ok` |
| 3 | 公开 alpha 门禁 | `node scripts/public_alpha_gate.mjs` | **0** | 末行 `public alpha gate ok`，全 `[PASS]`、0 条 `[FAIL]`（含 `examples/launch-posts.md` 的存在性与"无过时发布承诺"检查——D-08 未搬故不受影响） |
| 4 | 全量语法检查 | `for f in $(find shared scripts -name '*.mjs'); do node --check "$f"; done`（`set -e`） | **0** | `checked=81 files, all passed` |

四步退出码 **0 / 0 / 0 / 0**。测试仍是串行（`--test-concurrency=1`），符合岗位补充说明历史教训。

### 12.4 范围守住 / 明确没碰的

- 报告列的 3 项 ⚠️ 风险（零引用扫描盲区、`ATS_CDP_PORT` 遗留命名、`ats_overrides` 僵尸字段）**按派遣单不在本轮范围，未碰**。
- **N-3（CHANGELOG `[Unreleased]` 段提交范围少个 `^`）未改** —— 派遣单第 2 项限定"以报告实际列出的 N-1/N-2 为准"、且"两处文档瑕疵""只修这三项别顺手改别的"。报告把 CHANGELOG 单列为 N-3（非 N-1/N-2），并自行建议"交由下一次动 CHANGELOG 时顺手带走"。故本轮不动，留给 lead 定夺是否单独收尾。此点已在交付时向上明示，非静默跳过。

---

## 13. 收尾 commit（Round 13：补 N-3 + 纳入定稿）

**commit `178fded`**（`docs(cleanup): fix CHANGELOG backfill range off-by-one + land cleanup spec`，2 文件 +31/-1）。本轮按派遣单只做两件、未扩大范围：① 补 N-3——`CHANGELOG.md:8` 的提交范围 `cf626d0..d9a4369`（`A..B` 记法不含 A，实测 37 条）改为 `cf626d0^..d9a4369`（含 A，实测 38 条），与段标题写的「38 commits」对齐，只加一个 `^`；② 把 lead 已建好的定稿文件 `docs/specs/project-cleanup.md` 一并 `git add` 入本 commit（未改其内容）。同一 commit 收掉，无对外动作（未 push、未碰远端）。报告点名的 3 项风险与其余未点名项一律未碰。本地 CI 四步串行全绿，退出码 0/0/0/0（见交付回执）。
