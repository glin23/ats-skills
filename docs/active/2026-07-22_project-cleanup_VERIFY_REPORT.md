---
Status: done_with_findings
Owner: arnold-verify
Reads: docs/active/2026-07-22_project-cleanup_DESIGN.md, docs/active/2026-07-22_project-cleanup_BUILD.md, docs/active/2026-07-22_project-cleanup_TASK.md, PROJECT_CONTEXT.yaml, .claude/arnold/roles/builder.md, .claude/phase_schemas.yaml, .github/workflows/ci.yml, docs/ARCHITECTURE.md, shared/sourcing/_unwired/README.md, shared/sourcing/dispatcher.mjs, shared/sourcing/apply_url_classification.mjs, shared/sourcing/_unwired/computer_use_locator.mjs
Mode: daily
Updated: 2026-07-22
Iterations: 1
Type: VERIFY_REPORT
---

# VERIFY_REPORT — 项目规整终点验收（Mr. Weirdo Jobs）

**一句话结论**：DESIGN §16 的 5 条验收标准我全部独立复跑，**5 条全过**（不引用施工记录的任何数字）。但在指定深查的第 ⑥ 项偏差复核里**抓到 1 个真 bug**——builder 声称已闭环的"搬模块导致路径失效"这一类问题，他修了静态 import、漏了**运行时按 `__dirname`（模块所在目录）拼出来的兄弟文件路径**，`computer_use_locator.mjs` 搬家后 `captureFrame()` 找不到 `cdp.mjs`。这个模块目前零调用方，**今天不影响任何线上行为**，但它砸掉了 `_unwired/`（未接线区）"代码本身是好的，只是没接线"这条承诺。

**质量分：4 / 5**（放行 + 附一张 punch list 待改清单）。

**我没有改任何一行代码。** 本轮为纯只读复验，`git status` 除 lead 自己的 TASK 档案外无任何改动。

---

## §1 验收范围

- **对象**：本地 main 上 `d9a4369..08f7e89` 共 7 个提交（`ffc0499` / `6ed5301` / `f171fce` / `fb162cf` / `31a6d0a` / `a4e78ed` / `08f7e89`）。
- **依据**：DESIGN §16 五条 + 派遣单追加的"反向确认搬动没弄断活代码" + TASK Round 9 的 5 项施工偏差复核（重点第 ⑤ 项）。
- **边界遵守**：全程零对外动作——没 push、没碰远端分支、没跑 gh 写操作。核验后 `git branch -vv` 仍是 `main ... [origin/main: ahead 7]`，远端未被触碰。
- **模式**：daily（日常）。本次改动无数据表结构变更 / 无认证变更 / 无核心数据流变更，按说明书不触发 --strict（严苛模式）；但对"移动模块导致路径失效"这一维做了超出日常密度的定向深挖（见 §5 真 bug）。

---

## §2 5 维高危区评估（测试前先做，用来定测试密度）

| # | 维度 | 本次改动的暴露面 | 判定 | 测试密度安排 |
|---|---|---|---|---|
| 1 | 核心业务逻辑 | 主流程链路（简历上传→分析定岗→找岗→大批量一键投递→报告→跟进）代码理论上"一个字节没动"，但删了 4 个文件、搬了 6 个模块 | **高** | 最高密度：全量引用图重扫 + 全量相对 import 解析 + 全量 repo 相对路径字符串存在性核验 + 真实冒烟 |
| 2 | 安全边界 | 删除了仓库内真实个人资料快照 `shared/profile.json`（隐私隐患消除动作），涉及"删前备份不能丢字段" | **中高** | 备份存在性 + 双份 profile 顶层字段级 diff + 独立核查独有字段有无代码读者 |
| 3 | 性能 | 纯文件搬迁 / 删除，零运行时代码新增 | **低** | 不专项测；由 CI 与冒烟顺带覆盖 |
| 4 | 集成点 | 三处：① Chrome CDP 子进程调用 ② 20 个技能 ↔ `shared/*.mjs` 硬编码路径 ③ npm 打包白名单 / setup.sh 技能软链 | **高** | 逐个核：技能与文档里全部路径引用存在性、软链完整性、白名单 6 项、CDP 相关模块可加载性 ← **真 bug 就是在这一维抓到的** |
| 5 | 用户体验主流程 | 无前端、无 UI 演示稿；用户面只有 README 门面与技能命令 | **中** | README 全链接可点 + 技能数量与源对齐 |

**评估结论**：密度压在第 1 / 4 维。第 4 维（集成点）是本次改动真正的薄弱面——因为"搬文件"破坏的往往不是语法而是**路径**，而路径失效在本项目的 CI 四步里**一步都抓不到**。这条判断直接催生了 §3 里的决策表，也直接导出了唯一的真 bug。

---

## §3 7 类测试设计技术覆盖

| # | 技术 | 用了几次 | 具体怎么用的 |
|---|---|---|---|
| 1 | 等价类划分 | 5 类 | 把 34 处改动按"会怎么坏"分 5 个等价类，每类挑代表用例而不是逐文件重复：① 搬走的文档 ② 搬走的代码模块 ③ 删掉的代码/模板 ④ 原地改内容的文档 ⑤ 配置文件。同类里只要机制一致，验一个即代表全类 |
| 2 | 边界值分析 | 3 次 | ① 目录深度边界：`_unwired/` 是本次唯一"深两层"的落点，相对路径最容易在这里断 ② 行数红线边界：`.mjs: 800` 上线后逐个数超限文件，实测恰好 2 个（1917 / 1170），无第三个意外入网 ③ git 历史边界：`--follow` 追到最早祖先提交，验证不是"删了重建" |
| 3 | 决策表 | 1 张（4 条件 × 6 模块） | **这张表是抓到真 bug 的直接原因**。对每个被搬模块列 4 个独立条件：Ⓐ 静态 import 能否解析 Ⓑ **运行时按 `__dirname` 拼出来的文件路径**能否命中 Ⓒ 外部文档/技能对它的路径引用是否更新 Ⓓ 文件内自述的 CLI 用法路径是否更新。builder 只验了 Ⓐ；Ⓑ 在 `computer_use_locator.mjs` 上是 FAIL，Ⓓ 在 5 个抓取模块上是 FAIL |
| 4 | 状态迁移 | 1 次 | 对每个文件走"改动前 → 搬/删后 → git 视角"三态迁移，重点验异常迁移：`git diff --name-status -M` 全表核对，13 处 rename 全部被 git 识别为 R（R100 内容零变化 / R099 = 改了 import 那一行的 computer_use_locator），无一处退化成 D+A |
| 5 | 用例测试（端到端） | 2 条 | ① CI 完整四步端到端 ② 主流程冒烟 `npm run demo:check` + 直接跑 `shared/supervisor_preflight.mjs --json` 逐检查项拆开看 |
| 6 | pairwise（两两组合） | 1 组（6 模块 × 2 加载方式） | 6 个被搬模块 × {静态解析、真实 `import()` 动态加载} 全组合 12 次，全绿——这一组恰好**验证了 builder 的结论是对的**，但也暴露了这组组合本身覆盖不到运行时路径（故补第 3 项决策表的 Ⓑ 条件） |
| 7 | 风险驱动 | 全程 | 由 §2 的 5 维评估定优先级：第 1/4 维投入最多、第 3 维基本不投；刻意用最坏意图假设"builder 说验过了 = 没验" |

---

## §4 5 轮回归循环记录

| 轮 | 动作 | 结果 |
|---|---|---|
| 1 | 写验证脚本（3 个一次性检查器，落在会话临时目录不入仓）：相对 import 静态解析器、markdown 本地链接检查器、活文档路径引用存在性检查器 | 建成 |
| 2 | 跑全套：CI 四步 + 主流程冒烟 + 三个检查器 + 零引用扫描 | CI 四步全绿、冒烟退出码 0；检查器全部 0 broken |
| 3 | 红了辨析 | 表层无红。**但反着想**：这些工具的共同盲区是"运行时拼路径"，于是加做决策表的 Ⓑ 条件 → 抓到真 bug 1 个 + 文档级不一致 3 类 |
| 4 | 修后重跑 | **本轮不适用**——按派遣单边界只读复验，不擅自改代码；缺陷已复现并给出可执行复现命令，交回处置 |
| 5 | 转交 | 1 个真 bug + 3 项 punch list 交回 lead 派 builder/bug 处置（见 §5、§10） |

**关于"≥1 个 failing test 复现 bug 修复前状态"**：我**没有**新增永久测试文件（只读复验边界内不落文件到仓库）。等价物是一条可复制粘贴、当场可复现的失败命令，见 §5 真 bug 的复现步骤——它现在跑出来就是 FAIL，修好之后同一条命令会变成"错误信息不再是 Cannot find module"。这一条我如实标注为**部分满足**，不冒充完全满足。

---

## §5 逐条结论：✅通过 / ❌真 bug / ⚠️风险 / 🟡不一致

### DESIGN §16 五条验收标准（全部自己跑，未引用施工记录数字）

#### ✅ ① 零引用扫描为空 + 反向确认搬动没弄断活代码

按 DESIGN §8 原样复跑：

```bash
for f in $(find shared -name '*.mjs' -o -name '*.js'); do
  b=$(basename "$f")
  n=$(grep -rlF "$b" shared scripts test bin .claude/skills setup.sh package.json | grep -v "^$f$" | wc -l)
  [ "$n" -eq 0 ] && echo "零引用: $f"
done
```

真实输出：**一行都没有**（空）。

但我**不接受这个空**作为证据——因为 `_unwired/README.md` 逐个列出了那 6 个文件名，而它自己就在 `shared/` 下，扫描会把 README 的提及算作"有人引用"。这条扫描从此对 `_unwired/` 永久失明（⚠️ 风险 1，见下）。所以我另跑一版**只认代码、排除 .md** 的严格扫描：

```bash
for f in $(find shared -name '*.mjs' -o -name '*.js'); do
  b=$(basename "$f")
  hits=$(grep -rlF "$b" shared scripts test bin setup.sh package.json | grep -v "^$f$" | grep -v '\.md$')
  skillhits=$(grep -rlF "$b" .claude/skills)
  [ -z "$hits" ] && [ -z "$skillhits" ] && echo "CODE-ZERO-REF: $f"
done
```

真实输出 4 行，**全部落在 `shared/sourcing/_unwired/` 里**（smartrecruiters / computer_use_locator / rippling / personio）；另两个（bamboohr / recruitee）之所以没被列出，是因为同在 `_unwired/` 的兄弟文件在**注释头**里写了 `Interface mirrors recruitee_board_api.mjs`——我逐行看过命中位置，**全是注释、无一处 import**。

> **关键结论：活代码区（`shared/` 平层与其余子目录）现在没有任何"看着像在用其实走不到"的模块。** DESIGN 说的"占比 89% → 100%"这个承诺，我独立复核为**属实**。

**反向确认（派遣单追加项）**：6 个被挪模块**确实没被任何入口引用**——

```bash
grep -rnE "(import|require|from)[^\n]*<模块名>" --include='*.mjs' --include='*.js' --include='*.json' --include='*.sh' .
```

6 个模块逐个跑，排除 `_unwired/` 自身与 `.agents/` 生成物后，**6 个全部输出 (none)**。

**挪动有没有弄断活代码**：三层独立核验，全部 0 断裂——

| 核验层 | 方法 | 结果 |
|---|---|---|
| 静态 import 解析 | 自写解析器扫 `shared scripts test bin` 下 **121 个** .mjs/.js，抽出 import / export-from / 动态 import() / require 的**全部相对路径** **194 条**，逐条 `existsSync` | `broken=0` |
| repo 根相对路径字符串 | 抽出代码里以 `'shared/...' 'scripts/...'` 形式硬写的路径字符串 **141 条**（本项目大量用 `runNode(['shared/xxx.mjs'])` 这种跨进程调用），逐条核存在 | 5 条"未命中"逐个人工判读后**全部是假阳性**：3 条是注释文字 / 1 条是外部 GitHub 原始文件 URL 片段 / 1 条是 `public_alpha_gate.mjs` 的**反向断言**（断言 `shared/source_cache.mjs` 已被删掉才算通过）。真实断裂 **0** |
| 活文档 + 20 个技能的路径引用 | 扫 32 份现行文档与 SKILL.md 里出现的 **97 条** `shared/… scripts/… examples/…` 路径，逐条核存在 | `missing=0` |

**删除项复核**：7 处该消失的全消失（`shared/profile.json`、`.tmp-scoring/`、`docs/agency-meeting/`、`notion_sync.mjs`、`migrate_notion_to_local.mjs`、`config.template.json`、`references/job_report_template.md`），且全仓库无 PDF 残留。删除物的残余提及只剩 CHANGELOG 历史叙述、归档区旧 PRD、本次工作档案——全是历史文本，非引用。`shared/local_db.mjs` 顶部那句指向已删模块的注释已按 DESIGN §13 改成"本模块取代了它，它已被移除"，我读了原文确认。

**个人资料删除的兜底复核**（第 2 维安全边界）：备份 `~/.mrweirdo-jobs/archive-repo-20260722/profile.json` 存在（5172 字节），与家目录现行版 sha256 不同（确认不是把现行版复制一份冒充备份）。顶层字段差集我独立复算：备份独有 `_notes` / `ats_overrides`，现行独有 `experience_summary` / `skills` / `languages` / `legal_attestations` —— 与 BUILD §5 的说法**逐字一致**。并且我独立 grep 确认 `ats_overrides` 全仓库**没有任何读者**（只出现在 `shared/profile.template.json` 的模板声明里）。**删除不丢生效信息，成立。**

#### ✅ ② 断链自查为空

DESIGN §8 两条 grep 原样复跑，排除归档区与本次工作档案后，现行文件里的残余命中只有 **2 处**：

```
scripts/public_alpha_gate.mjs:101:  'examples/launch-posts.md',
scripts/public_alpha_gate.mjs:115:  textDoesNotMatch('examples/launch-posts.md', /.../, 'stale launch promise')
```

**这两处不是断链**——文件仍在 `examples/launch-posts.md` 原位，引用完全有效（我核过文件存在）。它是 D-08 那条**待拍板事项**的痕迹：builder 没搬，所以没断。DESIGN 目标态（归档它）未达成，但那是**拍板缺口不是缺陷**。另加两层我自己补的断链核验：

- **全仓库 51 份 markdown 的本地链接**：checked=10，`broken=0`（本项目文档习惯用反引号写路径而非 markdown 链接，所以链接数少——这也是我补跑上面"97 条路径引用"那一层的原因）。
- **`ROADMAP.md` 指向归档的两条引用**：指的是 `docs/archive/PRD-v3.md` / `docs/archive/PRD-onboarding-ux.md` **新位置**，正确。

#### ✅ ③ 完整 CI 四步全绿（我自己跑的，退出码逐个抓）

照 `.github/workflows/ci.yml` 逐步，**不引用 BUILD 里的任何数字**：

| # | 步骤 | 我跑到的退出码 | 我看到的真实输出 |
|---|---|---|---|
| 1 | `npm test` | **0** | `ℹ tests 128 / ℹ pass 128 / ℹ fail 0` |
| 2 | `node scripts/role_guard_smoke.mjs` | **0** | `role guard smoke ok` |
| 3 | `node scripts/public_alpha_gate.mjs` | **0** | 末行 `public alpha gate ok`；我自己数了 `[PASS]` = **105**、`[FAIL]` = **0** |
| 4 | 全量 `node --check` | **0** | `find shared scripts -name '*.mjs'` 命中 **81** 个文件，逐个 `--check`，`fails=0` |

（数字与施工记录一致纯属它没虚报，不是我抄的——四步都是我在本轮独立执行的。）

#### ✅ ④ README 链接可点、目标文件真实存在

README 里 8 条本地链接逐条核，**8/8 存在**：`DISCLAIMER.md`、`docs/ARCHITECTURE.md`（2 处）、`docs/PUBLIC_ALPHA.md`、`examples/walkthrough.md`、`DISCLAIMER.md`、`CHANGELOG.md`、`LICENSE`。唯一外链是 npm 包页。
顺手核了 `package.json` 的 `files` 白名单 6 项（`bin/` `setup.sh` `README.md` `DISCLAIMER.md` `LICENSE` `VERSION`）**全部存在**——本次搬迁没有动到打包面。

#### ✅ ⑤ `git log --follow` 能看到搬迁前的历史

| 文件 | `--follow` 能追到 | 历史链长度 |
|---|---|---|
| `docs/archive/PRD-v3.md` | `50bab4c docs: capture v3 prd and engineering backlog` | 2 |
| `docs/archive/PRD-onboarding-ux.md` | `c4ae787 feat(onboard): selection entry...` | 2 |
| `docs/archive/HANDOFF-v2.2.0.md` | `c042b54 v1.0-phase1 ...` | **15** |
| `shared/sourcing/_unwired/computer_use_locator.mjs` | `2981c0b v0.5 — ... Computer Use vision fallback` | 5 |
| `shared/sourcing/_unwired/personio_board_api.mjs` | `bcace64 v0.8a — Multi-platform expansion ...` | 4 |

外加 `git diff --name-status -M d9a4369..HEAD` 全表核对：**13 处 rename 全部标记为 R**（12 处 R100 = 内容零变化、1 处 R099 = `computer_use_locator.mjs` 改了 import 那一行），无任何一处退化成"删除+新建"。**用的是 git mv，属实。**

---

### ❌ 真 bug（1 个）

#### BUG-1 — 搬家漏改：`computer_use_locator.mjs` 运行时找不到兄弟文件 `cdp.mjs`

- **严重度：Medium（中）**。命中 **§2 第 4 维（集成点：Chrome CDP 子进程调用）**，间接牵连第 1 维。
- **为什么不是 High**：该模块在 `_unwired/`（未接线区）、全项目零调用方，**今天不影响任何线上行为、不在主流程上**。
- **为什么不能算 Low**：`_unwired/README.md` 白纸黑字承诺"**代码本身是好的，只是还没接进流程**"，而这个模块现在**代码本身就是坏的**。这块"备料"当初之所以留着不删，理由正是"重写成本高、将来还要用"——留下一个坏掉的备料，等于把成本从"接线"偷偷涨成"接线 + 先 debug 一个不知道存在的坑"。而且它错在**吞掉异常返回软失败**（`catch` 里把错误塞进返回对象），将来接线时表现是"视觉兜底莫名其妙不工作"，不是当场崩，排查成本更高。

**位置**：`/Users/lee/Projects/mrweirdo-jobs/shared/sourcing/_unwired/computer_use_locator.mjs:80`

```js
export function captureFrame(tabId, opts = {}) {
  const cdpPath = opts.cdpPath || join(__dirname, 'cdp.mjs');
```

**根因**：`__dirname`（模块所在目录）是**运行时**从 `import.meta.url` 算出来的。搬家前模块住在 `shared/`，`join(__dirname,'cdp.mjs')` = `shared/cdp.mjs` ✅ 真实存在（我核过）。搬进 `shared/sourcing/_unwired/` 后同一行算出 `shared/sourcing/_unwired/cdp.mjs` ❌ 不存在。注释里那句 `default: sibling file`（默认取兄弟文件）在新位置已经不成立——`cdp.mjs` 不再是它的兄弟，而在上两层。

**为什么现有四道关卡一道都没拦住**（这正是派遣单要我独立验证的第 ⑤ 项）：

| 关卡 | 为什么漏 |
|---|---|
| `node --check` | 只查语法，路径是运行时的事 |
| 我的静态 import 解析器 | 这不是 import 语句，是函数体内 `join()` 拼出来的字符串 |
| builder 做的真实 `import()` | 只执行模块顶层；这行在函数体里，不调用函数就永远不执行 |
| 128 个单元测试 / CI 四步 | 没有任何测试覆盖 `_unwired/`（它按定义就是没人调的） |

**复现步骤**（当场可跑，现在就是 FAIL）：

```bash
cd /Users/lee/Projects/mrweirdo-jobs
node -e 'import("./shared/sourcing/_unwired/computer_use_locator.mjs").then(m=>console.log(JSON.stringify(m.captureFrame("FAKE_TAB")).slice(0,200)))'
```

我跑出来的真实输出：

```
{"ok":false,"error":"...Error: Cannot find module '/Users/lee/Projects/mrweirdo-jobs/shared/sourcing/_unwired/cdp.mjs'..."}
```

（对照组：`ls shared/cdp.mjs` → 存在；`ls shared/sourcing/_unwired/cdp.mjs` → No such file。）

**修复建议**（1 行，交 builder 或 bug 成员，我按只读边界没动）：把默认值改成指向真实位置，并同步改上面那句 `sibling file` 注释。例如 `join(__dirname, '../../cdp.mjs')`，或更抗搬家的写法：从已经 import 进来的 `../../paths.mjs` 一族里取仓库根再拼。**建议顺带定为项目方法论**：BUILD §11 写的"移动 JS 模块，语法检查不等于可加载"只说对了一半，完整版应是 —— **移动 JS 模块时，除了 import 能否解析，还必须搜一遍文件内所有 `__dirname` / `import.meta.url` / `new URL('./…')` 派生的运行时路径**。

**同类漏网核查结果（派遣单点名要查的）**：我对全部 6 个被搬模块 + 全仓库做了同模式排查，**除 BUG-1 外没有第二处**——

```bash
grep -nE "new URL\(|import\.meta\.url|__dirname|fileURLToPath|join\(.*['\"]\.\.?/" shared/sourcing/_unwired/*.mjs
```

5 个抓取模块里出现的 `import.meta.url` 全部只用于 `if (import.meta.url === \`file://${process.argv[1]}\`)` 这种 CLI 入口自检（与所在目录无关，搬家不影响）；只有 `computer_use_locator.mjs` 用 `__dirname` 拼了文件路径。被删的 4 个文件不存在"搬动"问题。**同类漏网：仅此 1 处，已定位。**

---

### 🟡 设计不一致 / 文档级问题（3 项，均不影响运行）

| # | 问题 | 位置 | 建议 |
|---|---|---|---|
| N-1 | 5 个被搬抓取模块的**文件内 CLI 用法注释仍写旧路径**（`// Usage: node shared/sourcing/personio_board_api.mjs <tenant>`），照着敲会报"找不到文件"。`_unwired/README.md` 里写的是新路径，两边打架 | `_unwired/{bamboohr:293, recruitee:226, smartrecruiters:383, rippling:312, personio:304}` | 5 个文件各改 1 行。**注意**：这超出 Quinn 主动重构的"不跨文件"边界（跨 5 个文件），故我未动，交 builder |
| N-2 | `_unwired/README.md` 把 6 个模块统一描述为"代码本身是好的"，但 `computer_use_locator.mjs` 因 BUG-1 现在不成立；README 也没提它依赖上两层的 `cdp.mjs` | `shared/sourcing/_unwired/README.md:16` | 修完 BUG-1 后补一句依赖说明 |
| N-3 | CHANGELOG 补账段标题写 `38 commits, cf626d0..d9a4369`，但 git 的 `A..B` 记法**不含 A**：`git rev-list --count cf626d0..d9a4369` = **37**，要凑 38 得写 `cf626d0^..d9a4369`（我实测 = 38）。数字对、记法差一个 `^` | `CHANGELOG.md` [Unreleased] 段 | 加一个 `^`。够 Quinn 尺度但我选择不动——本轮定位只读，且改它会给待 push 的仓库凭空添一处未提交 diff，交由下一次动 CHANGELOG 时顺手带走更干净 |

---

### ⚠️ 风险（3 项，非缺陷，供拍板参考）

1. **DESIGN §8 那条零引用扫描从此对 `_unwired/` 自我失明**。因为 `_unwired/README.md` 列了全部 6 个文件名，而扫描的 grep 范围含 `shared/`（含 .md）。后果：将来再往 `shared/` 丢一个死模块、只要有任何 .md 提过它的文件名，这条扫描就查不出来。**建议把 §5 ① 里那版"排除 .md 的严格扫描"写进项目方法论替换原版**，成本为零。
2. **`supervisor_preflight` 的补救提示仍用已废弃的环境变量名 `ATS_CDP_PORT`**（项目 v1.3.0 已做 `ATS_* → MRWEIRDO_*` 全量迁移）。**与本次规整无关、是存量漂移**，但既然本轮主题就是"清理漂移"，值得排进 ROADMAP 一起收掉。我实测冒烟时看到的原文：`Start Chrome CDP: ATS_CDP_PORT=9223 bash shared/chrome-cdp-launcher.sh`。
3. **`ats_overrides` 是"有声明无读者"的僵尸字段**：`shared/profile.template.json:119` 对外声明了它（等于告诉用户"你可以配这个"），但全仓库无任何代码读。存量问题、非本轮引入，但性质与本轮清掉的死代码同类，建议一并列入待办。

---

### 未覆盖项（如实说明理由）

| 未覆盖 | 理由 |
|---|---|
| 真实投递端到端（真的向公司提交一次投递） | 会对真实公司产生不可逆的对外动作，超出验收授权 |
| Chrome CDP 活链路 | 需要拉起可见浏览器；冒烟里 `cdp` 这一项 FAIL 纯粹是"Chrome 没开着"，与本次改动无关（同一环境下改动前也是这个结果） |
| `bash setup.sh` 重跑 | 它会改写 `~/.claude/skills` 与 `~/.codex/skills` 的全局软链，属于对本机环境的写动作。改为**只读核验其产物**：`.agents/skills` 20 个链接全部可达无悬空，与 `.claude/skills` 的 20 个逐一对齐 |
| npm 包实际打包 / 发布 | 属对外动作。改为只读核验白名单 6 项存在性 |

---

## §6 Quinn 主动重构记录

**本轮零重构、零代码改动。** 按派遣单"只读复验为主、不擅自改代码"的边界执行。够 Quinn 尺度（1-3 行）的只有 N-3 一项，我主动放弃了——理由写在 N-3 那一栏：本地 main 正处在"7 个提交待 push、3 项待拍板"的状态，验收员在这时候往工作区里丢一处未提交 diff，收益（少一个 `^`）远小于给 lead/ops 添的对账负担。N-1 跨 5 个文件、N-2 涉判断性描述，都超界，交 builder。

我落在仓库里的**唯一**文件就是本报告；三个一次性检查器脚本全部写在会话临时目录，未入仓。

---

## §7 质量 3 指标

| 指标 | 值 | 说明 |
|---|---|---|
| 覆盖率 | 不适用（无新增运行时代码）；等价覆盖：121 个 JS 文件 / 194 条相对 import / 141 条仓库根相对路径字符串 / 97 条文档路径引用 / 51 份 md 文档 / 13 处 rename / 6 个被搬模块 × 2 种加载方式，**全部实跑** | 本项目无覆盖率工具链，用"改动面被实际验证的比例"替代；本次改动面 34 处，验证覆盖 34/34 = 100% |
| `verify_self_miss_rate` | **0%** | 本任务首轮验收，无上轮基线可比。如实标注为"首轮无基线"，不虚报也不用漂亮数字充数 |
| 真 bug 数 | **1**（Medium × 1；High 0 / Critical 0） | 另有 🟡 文档不一致 3 项、⚠️ 风险 3 项（其中 2 项为存量、非本轮引入） |

> 说明：本项目为单人维护，说明书要求的"大厂记分卡指标"这里不填空转数字，只填能对账的真东西。

---

## §8 老坑清单核查

**`.claude/arnold/roles/verify.md`（验收员岗位补充说明）不存在 → 本项目未定义 verify 专属老坑清单。**

最接近的项目家规是 `.claude/arnold/roles/builder.md` 的三条，我把它们当作项目铁律反过来核 builder 有没有真做到：

| 项目铁律（出自 builder.md） | 我的独立核验 | 结论 |
|---|---|---|
| 测试必须**串行**跑（并行会因临时目录互踩假失败） | `package.json` 的 test 脚本实为 `node --test --test-concurrency=1 test/*.test.mjs`，我跑的就是它，没绕开 | ✅ 属实 |
| 交活红线：CI **每一步**都在本地跑一遍全绿，不能只跑 `npm test` | 我自己把四步全跑了一遍，退出码 0/0/0/0 —— builder 报的"全绿"经独立复跑**属实，未虚报** | ✅ 属实 |
| 主流程冒烟那条链路优先保证不断 | 见 §9 配置驱动铁律 1 | ✅ 属实 |

---

## §9 配置驱动的验收铁律逐条核

| 铁律 | 登记表填了吗 | 核验 |
|---|---|---|
| **1. 主流程冒烟**（`ci_smoke.main_chain`） | **填了**：「简历上传 → 简历分析定岗 → 各平台找岗 → 大批量一键投递 → 投递报告 → 持续跟进直到拿 offer」 | **✅ 启用并已跑**。`npm run demo:check` 退出码 **0**，末行 `ready rows: 18 / eligible 215`。我不满足于"退出码 0"，把冒烟里那个 WARN 拆开单独跑了 `node shared/supervisor_preflight.mjs --json`，逐检查项落地：profile_json / profile_shape / resume_pdf / search_intent_json / role_targets_nonempty / role_targets_supported / **syntax** / role_guard_smoke / **queue_nonempty (18 行)** / queue_validated 全 OK，**唯一 FAIL 是 `cdp`，原因是本机 Chrome 没在调试端口上跑（fetch failed），属环境未就绪、与本次改动无因果**。另核：`dispatcher.mjs` 实跑 `ALL_SOURCES` = `remoteok, greenhouse_bulk, ashby_bulk, lever_bulk, wellfound, yc_waas`（**6 个，与搬迁前一致**）；`SUPPORTED_AUTO_PLATFORMS` 实为 `{greenhouse, ashby}`。**主流程未断。** |
| **2. 结构升级双路**（`schema_upgrade_path`） | 空 | 跳过（且本次无数据表结构变更） |
| **3. 数据隔离**（`isolation_field`） | 空 | 跳过。补一句观察：本产品是**单人本地库**模型（`shared/local_db.mjs` 注释明写"per-user local database，不同学生应各自 `MRWEIRDO_HOME`"），不存在多租户共库，该格留空是对的 |
| **4. UI 照演示稿**（通用铁律） | —— | 不适用：本项目无前端界面、无 UI 演示稿，用户面是 CLI 与技能命令 |
| **5. 不玩覆盖率数字游戏**（通用铁律） | —— | ✅ 遵守：本报告不报任何覆盖率百分比，全部结论都附**可复制的命令 + 我看到的真实输出**；三层"真实运行"证据（CI 四步 / 主流程冒烟 / 6 模块真实 import()）齐备 |

**用词规范自查**（登记表 terminology 三条）：全文统一用「用户 / 投递 / 岗位」三个现行词；登记表列的三个旧叫法一个都没出现。引用英文文件名、命令输出、他人原文时保持原样。另核查了本轮新增/改动的中文文档（ROADMAP、三个 README、`_unwired/README.md`），**均无旧叫法**。

---

## §10 覆盖度评估 + 质量分

### 覆盖度

DESIGN §16 的 5 条 **5/5 独立复跑通过**；派遣单追加的反向确认与偏差第 ⑤ 项 **已完成且抓到实质问题**。TASK Round 9 列的 5 项偏差逐条复核：

| 偏差 | 复核结论 |
|---|---|
| ① D-08 `launch-posts.md` 判错、未搬 | **✅ builder 判断正确**。我核实 `scripts/public_alpha_gate.mjs:101/115` 确有两处硬引用（一处存在性核查、一处"不许出现过时发布承诺"的文案检查），搬走 CI 第 3 步必红。builder 停手上报而不是偷偷改门禁脚本，**是对的**。**我倾向 B（不搬）**，理由比 builder 说的更硬一层：那条 `textDoesNotMatch` 检查的对象是**对外发布文案**，它盯着这个文件不许写出过时承诺——这说明该文件不是历史垃圾，而是**受门禁保护的对外文案样本**；搬进归档区等于让门禁去管一个"本来就该允许留旧话"的地方，检查会失去意义。仍需拍板人一句话定案 |
| ② `git reset --soft` 代替 `--hard` | **✅ 终态等价，已核**。`main` 现指向 `08f7e89`、上游跟踪 `origin/main` 已设（`[origin/main: ahead 7]`），工作区除 lead 自己的 TASK 档案外干净。builder 因危险命令 hook 拦截而选更安全的等价做法、且没自行放行 hook，处理得当 |
| ③ CHANGELOG 落 `[Unreleased]` 不新开 v2.3.0 | **✅ 判断正确**。我核了 `VERSION` 与 `package.json` 都仍是 `2.2.0`、无 v2.3.0 tag。写版本号段等于宣称一个不存在的发布，builder 的选择比 DESIGN 原方案更诚实。附带发现 N-3 的 `^` 记法小瑕疵 |
| ④ ARCHITECTURE 补 7 个技能而非 4 个 | **✅ 属实且更全**。`.claude/skills/` 实有 **20** 个目录，我逐个对照 ARCHITECTURE 现文，**20 个全部收录、无遗漏无虚构**。并逐条回代码验了它的事实断言：`SUPPORTED_AUTO_PLATFORMS = new Set(['greenhouse','ashby'])` ✅、`lever` 确在 `KNOWN_UNSUPPORTED_PLATFORMS` ✅、6 个 dispatcher 来源 ✅、`shared/workday/companies/` 确实只有 `_template.json` + `placeholder_company_1..5.json` ✅、Notion 段已改为"已移除" ✅。文档里出现的 8 个文件路径引用**全部真实存在**。**ARCHITECTURE 漂移确已清零** |
| ⑤ `computer_use_locator` import 路径修正、`node --check` 查不出 import 解析 | **⚠️ 结论一半对、一半不全**。**对的部分**：`node --check` 确实查不出 import 解析——我独立验证了这个论断；他改的 `'./paths.mjs'` → `'../../paths.mjs'` 确实必要且正确（`shared/paths.mjs` 存在）；6 个模块真实 `import()` 我复跑**确实全部 OK**（导出符号都正常拿到）。**不全的部分**：他把"可加载"当成了"没搬坏"的终点，而真正的坑在函数体里的运行时路径 → **BUG-1**。也就是说，他自己提炼的那条教训（BUILD §11）救了他一次，但停早了一步 |

### 质量分：**4 / 5** — 放行 + punch list

**为什么给 4 不给 5**：在 builder 亲口宣称已闭环的那一类问题上（移动模块导致路径失效），存在一个他没查到、我查到了的真 bug。自证闭环但没闭到底，不能满分。

**为什么给 4 不给 3（不回炉）**：逐条对齐分档标准——DESIGN §16 五条验收标准 **5/5 独立复跑全绿**，不是抄他的数字；CI 四步真绿、105 条门禁 0 失败；主流程冒烟真通、6 个来源与投递门槛与搬迁前逐字一致；删除项 100% 过拍板、备份与字段级差异我独立复算无误；13 处搬迁全部 git mv 保历史；活代码区死代码确已清零。唯一真 bug 落在**零调用方的隔离区**，不在主流程上、不影响任何现有行为，修复量是 1 行 + 5 行注释——这是**打补丁清单，不是返工**。把它判成"回炉"会让 builder 重跑一整轮已经验证过的工作，成本与收益倒挂。

**我拿这个 4 分反着想过一遍**：假设我给 5 分会怎样？那 BUG-1 会随 push 进公开仓库，`_unwired/` 的承诺变成一句假话，将来真去接视觉兜底的人要先 debug 一个"上一轮清理留下的"坑——所以 5 分不能给。假设我给 3 分呢？lead 会把整个 7 commit 打回重做，而这 7 个 commit 里 34 处改动我逐处验过、33 处无懈可击——那是浪费。**4 分是这两个错误之间唯一诚实的位置。**

### 给 lead 的处置建议（按优先级）

1. **修 BUG-1 再 push**（`shared/sourcing/_unwired/computer_use_locator.mjs:80` 一行 + 那句 `sibling file` 注释）。这是**唯一挡在 push 前面的技术项**——一旦推上公开仓库，坏掉的备料就带着"这里的代码是好的"的 README 一起对外了。派 builder 即可，不必惊动 bug 成员（根因已定位、复现命令现成）。
2. **顺手带走 N-1 / N-2**（5 处旧路径用法注释 + README 补依赖说明），与第 1 项同一个 commit 收掉最省事。
3. **三项待拍板端给用户**（D-08 选 A 还是 B〔我倾向 B，理由见上表〕/ UNCLEAR-5 是否升版打 tag / UNCLEAR-4 Arnold 协作配置入不入公开库）。**第三项建议在 push 前定**——这是公开 alpha 仓库，配置一旦推上去，外人就能看到内部协作配置；现在还没 push，反悔成本为零，之后就不是了。
4. **把 §5 ① 那版"排除 .md 的严格零引用扫描"写进项目方法论**替换 DESIGN §8 原版（零成本，防止这条扫描将来永久失明），并把 BUG-1 里那条完整版教训一并记进项目记忆。
5. **⚠️ 风险 2 / 3（`ATS_CDP_PORT` 遗留命名、`ats_overrides` 僵尸字段）排进 ROADMAP**——存量漂移，与本轮同题，不必现在做。
6. **ops 交接项照 BUILD §6 执行**（7 个远端已合并分支删除 + push），但**排在第 1 项之后**。

---

## 试过的错误方向

Iterations = 1，按规则不强制列。但有两个方向我走进去了又退出来，记下来免得下一位验收员重走：

1. **「三个检查器全跑 0 broken，那就是全对了，可以收工」**（否）。这是本轮最危险的一个念头——三个工具全绿的观感极强，但我停下来问了一句"**它们仨的共同盲区是什么**"，答案是：全都只看**静态可见的路径**（import 语句、markdown 链接、字符串字面量），一条都覆盖不到**运行时算出来的路径**。BUG-1 就藏在那个共同盲区里。教训：工具全绿只能证明"工具查的那些没问题"，不能证明"没问题"；每加一个自动检查，都要顺手写下它查不到什么。
2. **「用真实 `import()` 把 6 个模块全跑一遍就等于验证了 builder 的结论」**（否，或者说"对但不够"）。我确实跑了、也确实全过——但 `import()` 只执行模块**顶层**代码，函数体里的路径要等函数被调用才求值。而 `_unwired/` 里的函数按定义**永远不会被调用**，所以这层验证在这个目录里恰恰是最弱的。真正管用的是**直接调用导出函数**（我最后是 `captureFrame("FAKE_TAB")` 一调就现原形）。教训：**验证隔离区的代码，光加载不够，得真调一次**——否则"隔离"就等于"没人知道它坏了"。
