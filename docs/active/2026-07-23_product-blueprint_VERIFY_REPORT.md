---
Status: done_pending_review
Owner: arnold-verify
Reads: docs/active/2026-07-23_product-blueprint_TASK.md, docs/active/2026-07-23_product-blueprint_DESIGN.md, docs/active/2026-07-23_product-blueprint_BUILD.md, docs/active/2026-07-23_product-blueprint_RISK_REPORT.md, docs/active/2026-07-23_product-blueprint_FORENSIC.md, PROJECT_MEMORY.md, PROJECT_CONTEXT.yaml, .claude/arnold/roles/builder.md, .claude/arnold/roles/lead.md, shared/apply_gap_report.mjs, shared/missing_field_questions.mjs, shared/personal_fact_gate.mjs, shared/record_profile_answers.mjs, shared/answer_provenance.mjs, shared/answer_routing.mjs, shared/greenhouse_apply_driver.mjs, shared/ashby_apply_driver.mjs, shared/profile.template.json, shared/answer_bank.json, shared/supervisor_preflight.mjs, shared/apply_batch.mjs, scripts/secure_profile_files.sh, test/apply_gap_report.test.mjs, test/greenhouse_work_auth_driver.test.mjs, .claude/skills/mrweirdo-onboard/SKILL.md, .claude/skills/mrweirdo-onboard/references/intake-and-profile.md, .claude/skills/mrweirdo-onboard/references/run-and-database.md, .github/workflows/ci.yml
Mode: strict
Iterations: 2
Updated: 2026-07-26
Type: VERIFY_REPORT
---

# 验收报告 — 批次 A（`20c6f6d` → `f009f95` → `b11ee22` → `71c3bef`）

> 本轮只读复验，**未改一行产品代码**，未 push、未动远端、未真跑投递、未提交任何表单、未碰投递截图目录。
> 对 `~/.mrweirdo-jobs/` 只有两处只读：① `npm run demo:check`（登记表 ci_smoke 主流程冒烟，`grep` 确认脚本零写入）；
> ② 把 `profile.json` 复制一份到 scratchpad 做对照实测。实测后 `ls -la ~/.mrweirdo-jobs/` 顶层最新 mtime 仍是 Jul 22，
> `find -newermt '-3 hours'` 零命中。本轮建的两个 `git worktree` 已 remove，`git status` 条目数与开工时一致（35）。

---

## 给拍板人的一句话

**看你指的是哪一份「产品」。**

- **你电脑上现在这份工作副本**：工作授权这条不会再编了——我用 8 种档案实跑，明确说「我没有授权」的答 `No`、美国公民的担保题答 `No`、
  三种「没问过」的形态一个字都不填并且开工前 5 秒就把批次拦住问你。EEO（平等就业机会自愿披露）也从「系统自己填」改成了问你。
- **但产品还在替用户声明另外几件事**（这些都在计划内的 B / C 批次，不是本轮该做的，可我必须如实报）：你是否年满 18 岁 → 一律答「是」；
  联邦禁枪清单那一组（是否逃犯 / 是否非法居留 / 是否管制药物成瘾者）→ 一律答「否」；是否在读研究生 / 是否在校 → 从占位值推；
  「是否拥有不受限制的工作授权」→ 没问过就答「否」（**这一条你在关卡 2 已经拍板要改成阻塞，还没实现**）。
- **还有一条谁都没发现的**：出厂模板会让一个从没被问过的新用户，在「你愿意搬到我们纽约办公室吗 / 你能到旧金山办公室上班吗」
  这类题上直接答 **「Yes」**——跟本轮刚拆掉的「出厂预填工作授权 = true」是同一个病，而「搬迁」正好写在项目红线点名的清单里。

**另外有一件比上面都紧急的事**：**这 4 个提交单独拿出来是坏的。** 我把 `71c3bef` 干净检出到一棵独立工作树里跑测试——
**165 条测试、6 条红、`npm test` 退出码 1**；而且那个提交里的 Greenhouse 驱动 `:1570` 仍然写着
`value = BANK.yes_no_defaults?.work_authorization || 'Yes'`，也就是**仍然在替用户答「我有工作授权」**。
真正修好这件事的代码（`answer_routing.mjs`、两个驱动、`answer_bank.json`、4 个测试文件……共 18 个改动文件 + 1 个新测试文件）
**一行都没进 git**。现在只要谁跑一次 `git checkout .` 或 `git stash`，本轮和前两轮的成果就全没了；
只把这 4 个提交 push 上去，等于把「红的 CI + 仍然会说谎的产品」推上线。

---

## §1 验收范围

| 项 | 内容 |
|---|---|
| 被验对象 | 批次 A 四个提交 `20c6f6d`(A1) / `f009f95`(A2) / `b11ee22`(A3) / `71c3bef`(A4)，18 文件 +2069/−89 |
| 基线 | 缺陷判定以 `RISK_REPORT` 为准；设计以 `DESIGN` §12 施工单 / §10（原 §16）处置表 / ADR-6 为准 |
| 模式 | `--strict`（改核心数据流 + 加 3 个新模块 + 动身份事实判定，自主升级） |
| 判官分工 | 施工 = Codex，验收 = Claude（`.claude/arnold/roles/lead.md` 记的双模型分工），异家交叉成立 |
| 岗位补充说明 | **`.claude/arnold/roles/verify.md` 不存在**（同目录只有 `_README.md` / `builder.md` / `lead.md`）。按通用说明书办，并把 `builder.md` 的「CI 每一步都要本地跑一遍」当验收铁律执行。**这一条请 lead 知悉**：本项目还没有 verify 家规，本轮的「老坑清单」只能靠上游文档反推（见 §8） |

---

## §2 5 维高危区评估（**先于一切**，决定测试密度）

| 维度 | 本轮对应物 | 危险度 | 分配的测试密度 |
|---|---|---|---|
| ① 核心业务逻辑 | 三态个人事实判定 → 阻塞 → 提问 → 写回 → 重投这条闭环 | **极高**（这就是本轮全部内容） | 最高：8 档案 × 5 类函数 + 6 档案 × 16 真实题面跑出货驱动 + 闭环端到端跑真 CLI |
| ② 安全边界 | 写回口白名单、三态禁强转、`profile.json` / `answer_provenance.json` 的 chmod 600、留痕只存指纹 | **高**（写回口能改档案 = 能改真实表单上的陈述） | 高：白名单越权 / 类型强转 / 校验失败三条负路径各跑一次，每次 `shasum` 前后比对 |
| ③ 性能 | 门在 `--real` 路径上多一次纯对象判定；报告新增 note 查表 | 低（无 IO、无网络） | 低：只测门的返回时间量级（preflight 全程含 DB + fetch 仍在秒级） |
| ④ 集成点 | Greenhouse / Ashby 两个 ATS 驱动 ↔ 结果 JSONL ↔ 缺口报告的 note 契约（弱类型字符串契约） | **高**（契约靠字符串拼写，改名不报错） | 高：跑出货驱动本身而非重写一份；另核 NOTE_CATEGORY grep 守卫是否真能红 |
| ⑤ 用户体验主流程 | 登记表 `ci_smoke.main_chain`：简历 → 定岗 → 找岗 → 批量投递 → 报告 → 跟进。门插在「批量投递」之前 | **高**（门是硬失败，误伤 = 整批投不出去） | 高：现有真实用户放行必须实测；新用户被拦时问句和命令必须人能看懂 |

**据此定的密度**：①②④⑤ 全部走「独立复跑 + 不信 BUILD 任何数字」；③ 只做量级确认。

---

## §3 7 类测试设计技术覆盖

| # | 技术 | 用了几次 | 具体用在哪 |
|---:|---|---:|---|
| 1 | 等价类划分 | 3 | 三态字段的 `true` / `false` / 未知三类；档案完整度分「真实用户 / 部分 / 空白 / 出厂模板」；来源分 `user_answer` / `onboarding_a0` / `legacy_unverified` |
| 2 | 边界值分析 | 4 | `priority = 0`（falsy 陷阱，实证 `\|\| 99` 会吃掉）；字符串 `"true"` vs 布尔 `true`；`{}` 空容器 vs 有内容；`workAuthGapFor` 的 `\bvisas?\b` 词边界（喂 "advisable" 确认不误触发） |
| 3 | 决策表 | 1 | 6 档案 × 16 真实题面 = 96 格全跑，逐格记「填了什么 / 阻塞了 / note 是什么」（§5 附表） |
| 4 | 状态迁移 | 1 | 完整走「门 ok=false → 阻塞 → 出问题 → 写回 → 门 ok=true → 同一份结果文件重跑报告 → 问题消失」，每个状态都取真实输出 |
| 5 | 用例测试（端到端） | 2 | 场景一「现有用户零变化」、场景二「新用户从空白模板走完整条路」（§5.4 / §5.5） |
| 6 | pairwise（多参数两两组合） | 1 | 8 档案 × 5 个判定函数（`deriveWorkAuthAnswers` / `workAuthGapFor` / `isGraduateDegree` / `blockingProfileGaps` / 分类器）两两配 |
| 7 | 风险驱动 | 贯穿 | 按 §2 的密度分配；把「builder 说测过了」全部当作没测，全部自己重跑 |

**N/A**：无。7 类全用上了。

---

## §4 5 轮回归循环记录

| 轮 | 做了什么 | 结果 |
|---:|---|---|
| 1 | 先写「会失败的对照」：把 `6e31883`（批次 A 之前）检出成独立工作树，拿 ADR-6 那条用例的原始夹具喂旧代码 | **旧代码确实把 `Gender` / `Are you Hispanic/Latino?` 判成 `agent_profile_backed`，动作文案是 `Do not ask the user first. Fill from existing profile`，而该夹具的档案里根本没有 `demographics` 这一块**——缺陷复现成功（§5.1） |
| 2 | 跑全套：CI 四步 + 主流程冒烟 + 三个新模块覆盖率 | 工作副本上全绿：`npm test` 177/177 exit 0、`role_guard_smoke` 0、`public_alpha_gate` 0、84 个文件 `node --check` 0、`demo:check` exit 0 |
| 3 | 红了辨析 | 工作副本没红。但第 4 轮把同一套跑在**干净的 `71c3bef`** 上时红了 6 条 |
| 4 | 追根因 | **不是 builder 写错代码**，是这 4 个提交不含前两轮的修复（那些改动至今未提交），所以提交树上的驱动仍走共用默认值 `'Yes'`。判定为**真 bug（交付形态层）**，见 §5-❌1 |
| 5 | 还红 → 是否转 bug 成员 | **不转**。根因清楚、修法明确（把剩下 18 个改动文件提交掉再复验一次 HEAD 绿），属于交付收尾不属于排障 |

---

## §5 结论明细

### 5.1 ✅ 最高优先项：那条断言改动**不是**「改测试迁就代码」（本轮最重要的结论）

**判定：断言原本锁住的行为，就是 RISK_REPORT 判定的缺陷行为本身。builder 没有为了让实现通过而放松任何一条该守的线。**

我没有采信 BUILD §25 的自述，做了四步独立论证：

**第一步 — 复现旧行为。** `git worktree` 把 `6e31883` 检出，用该用例的**原始夹具逐字节复制**跑旧代码：

```
Gender                       -> agent_profile_backed   (bucket: agent_actions)
Are you Hispanic/Latino?     -> agent_profile_backed   (bucket: agent_actions)
agent_actions[agent_profile_backed].action =
  "Do not ask the user first. Fill from existing profile, local history, or normal application consent rules; ..."
```

而同一份夹具的档案是 `{"personal":{...},"education":{"gpa":"3.2"}}` —— **没有 `demographics` 这一块**。
也就是说旧断言 `['user_full_address']` 强制要求这两题**不许**出现在「该问用户」清单里，等价于强制要求它们落进
「你自己从档案里填」那一档，**而档案里什么都没有**。这与 RISK_REPORT 第三节「扫描发现 1」（守门人站错了队）
和 DESIGN §4.3 的静默循环图**逐字对应**。**旧断言锁的就是缺陷。**

**第二步 — 新断言是更严还是更松。** 更严。它是 `assert.deepEqual` 的精确数组，新增了一个类目**并且**锁住了排序
（`user_full_address` 在前、`user_demographics_eeo` 在后，靠 priority 1 vs 15 决定）。实现若把 EEO 判错、
或把 priority 写成会被 `|| 99` 吃掉的 0，这条断言当场红。同用例另外 4 条断言（`agent_attestation` 存在、
`agent_profile_backed` 存在、`retry_candidates.length === 1`、`row_id === 101`）**一字未动且仍绿**——我核过 diff。

**第三步 — 反向守卫在不在。** 在，而且是新加的：`apply_gap_report stops asking once work auth and EEO are actually
in the profile` —— 档案里 EEO 五项有值时，这两题必须**变回** `agent_profile_backed`。我独立跑了这条路：
真实用户档案（五项都有值）下 24/24 分类零变化（§5.4）。**所以新行为不是「一律去问用户」，是「档案里真有值才算系统能填」**，
与同文件 GPA（`:266`）、语言（`:261-264`）的既有正确写法同款。

**第四步 — 会不会丢掉某种保护。** 我担心的是「驱动本来就能对 EEO 正确拒答，改成问用户等于凭空多打扰」。
实测排除：跑出货驱动本身，6 种档案下性别 / 种族 / 残疾**全部仍然自动拒答**（`I don't wish to answer` /
`I do not want to answer`），**驱动行为一行没变**；变的只有「驱动已经填不上、字段留在 `remaining` 里之后，报告该怎么归类」。
在那个前提下问用户是唯一不撒谎的选项。

**关于「同一断言两个调用点」**：我核过 diff，`:135`（`--summary`）与 `:154`（`--result-dir`）确实是同一份 fixture、
同一个结果文件、同一份档案的两次调用，**改一处必红**，lead 的读法成立，builder 没有越界。

### 5.2 ❌ 真 bug

#### ❌1 —— 严重度 **P0（交付阻断）**｜命中维度 ①核心业务逻辑 ④集成点 ⑤主流程

**这 4 个提交单独检出是坏的，而且不含本轮要修的那个缺陷的修复。**

复现步骤（任何人都可以照跑）：

```bash
git worktree add /tmp/clean-A 71c3bef
cd /tmp/clean-A && ln -s <repo>/node_modules node_modules
npm test
```

真实输出：

```
✖ every NOTE_CATEGORY key is a note some driver actually emits
✖ answer_bank yes_no_defaults: every EEO self-disclosure default is a refusal
✖ driver EEO fallbacks: no hard-coded veteran-status FACT left in the drivers
✖ drivers: work-auth / sponsorship answers never come from a shared bank default
✖ greenhouse driver: the three-state work-auth guard runs BEFORE any work-auth value branch
✖ greenhouse driver: the master's-degree question reads the profile, never a hard-coded No
ℹ tests 165   ℹ pass 159   ℹ fail 6
clean 71c3bef npm test exit=1
```

而且不只是测试红——**功能也是坏的**：

```bash
$ git show 71c3bef:shared/greenhouse_apply_driver.mjs | grep -n "yes_no_defaults?.work_authorization"
1570:  else if (/legally authorized|authorized to work|...) { value = BANK.yes_no_defaults?.work_authorization || 'Yes'; }

$ git show 71c3bef:shared/answer_routing.mjs | grep -c "threeStateYesNo\|work_authorization_required"
0
```

即：**在提交树上，Greenhouse 仍然从共用默认值答「我有工作授权」，三态判定函数根本不存在。**
（而按 architect 的盘点，292 个够格存量里 256 个、88% 在 Greenhouse。）

真正的修复散在 **18 个已修改但未提交的文件** + 1 个未跟踪的新测试文件里：
`shared/answer_routing.mjs`、`shared/greenhouse_apply_driver.mjs`、`shared/ashby_apply_driver.mjs`、
`shared/lever_apply_driver.mjs`、`shared/greenhouse_value_rules.mjs`、`shared/answer_bank.json`、`shared/paths.mjs`、
5 个 `SKILL.md`、`PROJECT_MEMORY.md`、4 个测试文件、`test/greenhouse_work_auth_driver.test.mjs`（未跟踪）。

**为什么这条必须报 P0**：① Round 19 的证据「CI 四步 0/0/0/0、177/177」我复现了，但那只对**脏工作副本**成立，
对**任何可检出的提交**都不成立——评审 / CI / 别人克隆看到的都是红的；② 一次 `git checkout .` / `git stash`
就会把前两轮全部成果抹掉，而它们从未落盘进版本库；③ 若按计划 push 这 4 个提交，上线的是「红 CI + 仍在编造工作授权的产品」。

**lead Round 19 裁决 3 的措辞需要修正**：那条写的是「剩余文件另起一个**文档**提交收尾」。剩余文件不是文档，
是本轮缺陷的**主体修复代码**。「不重组 git 历史」这个决定本身我认同（未 push、无丢失、重组只有风险）；
但「另起文档提交」这个收尾动作的范围被低估了，实际需要的是**先把这 18 个文件提交掉，再复验 HEAD 绿，才算批次 A 交付完成**。

#### ❌2 —— 严重度 **P1**｜命中维度 ①核心业务逻辑｜**同类漏网第三条（DESIGN §16 十一处清单没有它，BUILD §26 也没有）**

**出厂模板让一个从没被问过的新用户，在搬迁 / 到岗地点题上直接答「Yes」。**

跑出货 Greenhouse 驱动本身，同一道题喂不同档案：

```
档案                                        「你愿意搬到我们纽约办公室吗？」
A. 空白（无 work_authorization 块）            BLOCKED  note=location_not_in_profile_preferences
B. 明确未获授权                                BLOCKED  note=location_not_in_profile_preferences
C. 美国公民                                    BLOCKED  note=location_not_in_profile_preferences
D. 现有真实用户（F-1 OPT）                     BLOCKED  note=location_not_in_profile_preferences
E. 全字段显式 null                             BLOCKED  note=location_not_in_profile_preferences
F. 出厂模板逐字节                              FILLED "Yes"      ← 只有它答了
```

「这个岗位在旧金山办公室办公，你能到岗吗？」同样：只有出厂模板答 `Yes`。

二分定位到**两个各自都足够触发的出厂预填**：

```
template 逐字节                                       -> FILLED "Yes"
template 去掉 standard_qa.willing_to_relocate_scope   -> FILLED "Yes"
template 去掉 target_filters.relocation_policy        -> FILLED "Yes"
template 两个都去掉                                    -> BLOCKED location_not_in_profile_preferences
```

- `shared/profile.template.json:88` `"willing_to_relocate_scope": "Anywhere US"` → `greenhouse_apply_driver.mjs:312`
  读进 `preferredLocationAliases()` → `:325` 命中 `anywhere` → 加 `anywhere_us` 别名 → `:384`
  `if (aliases.has('anywhere_us') && mentionsUs) return { ok: true }` → 驱动答 `'Yes'`。
- `shared/profile.template.json:103` `"relocation_policy": "anywhere_primary_country"` + `:102 countries_open_to: ["US"]`
  → `:308` + `:327` 同样加 `anywhere_us`，**独立成立**。
- 另有 `:87 "willing_to_relocate": true` —— 今天只被 `ashby_helpers.js:1222` 经由 `standard_answers` 那条死路读
  （RISK_REPORT F7），所以暂时不触发；但它是同一句陈述的第三个副本，F7 一接线就活。

**为什么这条和本轮 I 项（`authorized_to_work_us: true`）是同一个病**：出厂值与「用户亲口说的」在数据上字节相同，
代码分不出来；而搬迁意愿是雇主会当真、会据以安排面试和 offer 的一句关于本人的承诺。
**而且「relocation」明确写在项目红线原文的点名清单里**（`docs/archive/PRD-v3.md:230`：
「不编造底线（visa/GPA/demographic/attestation/background-check/**relocation**）」）。

**建议**：并进批次 B/C 的模板清理，与 §16-I / §16-K 同批处理；处置方式建议与 I 项一致（出厂置空，
缺值时走 `user_work_location_commitment` 这个**已经存在**的类目——它已在 `RETRYABLE_CATEGORIES` 里，零新增类目成本）。

#### ❌3 —— 严重度 **P2**｜命中维度 ②安全边界

**`scripts/secure_profile_files.sh` 本轮新加的「可选文件一并上锁」代码块，在它最该生效的那个时间窗里跑不到。**

实测（沙箱假家目录，只有 `profile.json`，没有 `search_intent.json`）：

```
$ MRWEIRDO_HOME=<sbx> bash scripts/secure_profile_files.sh
Missing required profile file: <sbx>/search_intent.json
exit=1
$ ls -l <sbx>
-rw-r--r--  answer_provenance.json     ← 没被上锁
-rw-r--r--  cover_letter.pdf
-rw-------  profile.json
```

原因：脚本第 7-9 行那个必需文件循环遇到第一个缺失就 `exit 1`，新加的可选文件循环在它后面，**永远跑不到**。
而 `answer_provenance.json` 恰恰在引导 Step 3（A0 落盘）就会生成，`search_intent.json` 要到 Step 4 才写——
**这个窗口正是新代码想覆盖的那一段。**

**缓解（所以只给 P2 不给 P1）**：`record_profile_answers.mjs` 自己在写入时就 `chmod 600`，我实测确认
（`-rw------- answer_provenance.json`）。所以脚本这一层是双保险失效，不是唯一防线失效。
**建议**：把可选文件循环挪到必需文件循环**之前**，一行位置调整。

### 5.3 ⚠️ 风险（不是 bug，但会咬人）

**⚠️1 —— 「(D) 其他或不确定」这个出口，文档说两套话，代码一套都没实现。**

门的问句写着「（D）其他或不确定（请补一句说明）」，但写回口对这两个键**只收严格布尔**（实测 exit 3 拒绝 `"Yes"`）。
那么一个真的不知道自己授权状态的用户会怎样？两份上游文档给的答案是相反的：

- `references/intake-and-profile.md`（本轮新增段）：「If the user's answer does not settle a key, leave it `null`:
  the pre-batch gate will ask before anything is submitted」→ 留 null → **门永远拦着，整批一行都投不出去，死锁**。
- `DESIGN §6`（Reliability 那一栏）：「选它写 `false` 到 `authorized_to_work_us` 并在 `visa_status` 记原话」
  → 写 `false` → 驱动在真实表单上答「我没有工作授权」，note 是 `work_authorization_from_profile`，
  **与用户亲口说「没有」在数据上不可区分** → 这本身就是一次编造，方向保守而已，
  而 RISK_REPORT F1 明确否掉过「把默认值从 Yes 掉头改成 No」这条路。

**对照本轮做对的那一处**：法律声明的问句写的是「No 或不确定 = **我会跳过问到这组题的岗位，不替你回答**」——
把「不确定」做成了一个有明确后果的正式答案。工作授权这一组缺同款出口。

**建议**：给工作授权补一个和法律声明同款的「不确定 = 我跳过所有问到这题的岗位，不替你回答」路径
（可以是 `visa_status` 记原话 + 两个布尔保持 null + 门从「拦整批」降级为「拦命中该题的行」）。
这需要**产品取舍拍板**，不该由 builder 自己定。

**⚠️2 —— EEO 提问的触发条件，与 ADR-6 声称的触发条件不是同一件事。**

ADR-6 的论证前提是「某张表单的下拉框里**根本没有**『不愿回答』这个选项，所以驱动填不进去」。
但实现的判据是「**档案里该项为 null**」（`eeoValueKnown`）。这两件事只在「驱动确实填不上、字段确实留在 `remaining` 里」
时重合。一旦某一行因为**别的原因**中途失败、EEO 字段顺带落进 `remaining`，用户就会被问一组本来不必问的自愿披露题。

**为什么只算风险不算 bug**：① priority 15 排在所有实质缺口之后，Step 6「最多问四组」的额度基本轮不到它；
② 被问到时用户答「不愿回答」会被当正式答案记下来，此后永不再问（我实测跑通了这条：写 `demographics.gender`
= `Prefer not to say` 之后重跑报告，该题回到 `agent_profile_backed`）。
③ 41 天零投递，没有真实批次数据能量化这个频次。**建议**：第一批真投跑完后用真实 `remaining` 数据复核一次。

**⚠️3 —— 产品今天仍在替用户声明的事实清单（全部属已知/已排期，但拍板人有权看到全表）。**

跑出货 Greenhouse 驱动，**空白档案 / 出厂模板**下的真实输出：

| 表单题 | 空白档案下填了什么 | 性质 | 归属 |
|---|---|---|---|
| 你是否年满 18 岁 | `Yes` | 编造年龄事实 | §16-C，关卡 2 已拍板「引导时问一次，不阻塞」→ 批次 B，未实现 |
| 你是否逃犯 / 非法居留 / 管制药物成瘾者 | `No`（三题都是） | 编造法律事实 | §16-D → 批次 B，未实现。**注意紧邻的重罪题已正确阻塞**（`legal_attestation_required`），同一份联邦表格两套标准仍在 |
| 你是否拥有**不受限制**的工作授权 | `No` | 编造身份事实 | §16-H。**关卡 2 ③ 拍板人已明确要求改成阻塞**，落在批次 C，未实现 |
| 你是否在读硕士 / 博士项目 | `No` | 从缺失学位推断 | DESIGN §12.7 第 5 条明确本轮不做 → 批次 B |
| 你是否在校就读 | 出厂模板 `currently_enrolled: true` → `Yes` | 出厂预填 | §16-F → 批次 B，未实现 |
| 退伍军人身份 | Greenhouse 候选表仍是 `['No', "I don't wish to answer", ...]`，`'No'` 排第一 | 事实陈述优先于拒答 | §16-E → 批次 C，未实现（Ashby 侧已改成拒答，实测确认） |
| 愿意搬迁 / 能到某地办公 | 出厂模板 → `Yes` | **本报告新发现**，见 ❌2 | 不在任何清单里 |

**这些都不是批次 A 的失职**——DESIGN 明确排了 B/C，验收不因此扣分。列出来是因为拍板人问的是
「产品现在还会不会替用户编造关于他本人的事实」，只答工作授权就是选择性汇报。

### 5.4 ✅ 场景一：现有用户零变化（独立复跑，未采信 BUILD 的对照表）

方法：`git worktree` 检出 `6e31883`，**同一份 24 道真实题面**分别喂旧树 / 新树，
档案用拍板人真实 `profile.json` 的**只读副本**（复制到 scratchpad，`MRWEIRDO_DB_PATH` 指向不存在路径确保 SQLite 不开）。

```
identical: 24/24        changed: 0
```

三条关键行（这三条正是本轮最可能误伤的）：

```
Are you legally authorized to work in the United States?   agent_profile_backed -> agent_profile_backed
Gender / Hispanic / race / Veteran / Disability (5 条)      agent_profile_backed -> agent_profile_backed
Do you have unlimited and unrestricted authorization...    agent_profile_backed -> agent_profile_backed
```

独立第二证据：`npm run demo:check`（它自己读真实家目录）里
`work_authorization_answered: ok=true`、`profile_gate: {"ok":true,"missing_paths":[]}`——**门对真实档案直接放行**。
第三证据：`blockingProfileGaps()` 直接喂真实档案形状 → `ok=true`。

### 5.5 ✅ 场景二：新用户走空白模板（独立复跑）

**分类层**（同一份 24 题夹具喂出厂模板，旧树 vs 新树）——实质变化 8 条，与 BUILD 一致：

```
Are you legally authorized to work in the United States?  agent_profile_backed -> user_work_authorization
Will you now or in the future require sponsorship...      agent_profile_backed -> user_work_authorization
Do you have unlimited and unrestricted authorization...   agent_profile_backed -> user_work_authorization
Gender / Are you Hispanic/Latino? / race / Veteran / Disability (5 条)
                                                          agent_profile_backed -> user_demographics_eeo
```

**一处必须写明的方法学差异**：我第一次跑出的是「13 条变化」不是 8 条。查下去，多出来的 5 条
（GPA / 最早到岗日 / 毕业年月 / 电话 / Attach）全是 `(absent) → agent_profile_backed`，
根因是 `apply_gap_report.mjs:400` 的 `examples: items.slice(0, 8)` ——**每个类目最多展示 8 个例子**。
旧树里 `agent_profile_backed` 有 13 个成员、只展示前 8；新树有 8 个搬走了，剩下的就露出来了。
**这是展示层截断，不是分类变化**，我把每题拆成独立一行重跑仍是同样现象，再读源码确认了截断点。
**结论：BUILD 的「8/24」在实质上正确；但谁按同样方法复跑会先看到 13，需要这条注释才不会误判成回归。**

**门与写回口的完整一条路**（沙箱假家目录，零浏览器、零投递）：

```
① 门（空白模板）  ok=false  missing=["work_authorization.authorized_to_work_us",
                                     "work_authorization.requires_sponsorship_future"]
   问句：你在美国的工作授权属于哪一种？（A）美国公民或绿卡持有者；（B）F-1 学生签证，已经有 CPT/OPT，
        现在就能工作；（C）F-1 学生签证，现在和将来都需要公司担保；（D）其他或不确定（请补一句说明）。
        这一格空着，几乎每一份投递表单都会卡住。
   可执行命令：node shared/record_profile_answers.mjs --json '{...}' --source user_answer
              --category user_work_authorization --asked-by queue_gate
② supervisor_preflight 真跑（空白模板）→ 打印 "- FAIL work_authorization_answered" + 上面的问句与命令
   → 进程退出码 exit=1（apply_batch.mjs:253 `if (preflight.code !== 0) fail(...)` → 整批中止，一个标签页都没开）
③ 越权拒写：--json '{"personal.email":"attacker@example.com"}'
   → [record-answers] no question declares these paths ... exit=2   profile.json 逐字节不变（shasum 前后一致）
④ 三态禁强转：--json '{"work_authorization.authorized_to_work_us":"Yes"}'
   → expects boolean, got string ("Yes"). Values are not coerced. exit=3   profile.json 逐字节不变
⑤ 正常作答（选项 B：F-1 已有 OPT）→ exit=0
⑥ 门放行：{"ok":true,"missing_paths":[]}
⑦ 权限：-rw------- profile.json    -rw------- answer_provenance.json    无 .bak 残留
⑧ 留痕内容：只有 source / value_fingerprint(16 位) / recorded_at / asked_by / category，没有值本身
   并且把模板自带的 education.gpa="3.9" 诚实标成 legacy_unverified（自己把 ❌ 那个洞照出来了）
```

### 5.6 ✅ 「阻塞 → 提问 → 写回 → 不再问」闭环，且**不会静默循环**（独立跑真 CLI）

这是 RISK_REPORT 与 DESIGN 双双点名的那条 `Do not ask the user first. Fill from existing profile` 静默重试路径。
我用一份带 `blockers:[{question, note:'work_authorization_required'}, {..., note:'sponsorship_future_required'}]`
的真实形状结果文件，跑真 CLI：

```
第一遍：user_questions   = ['user_work_authorization']
        agent_actions    = []                                ← 关键：一条都没有，静默重试路径根本没被触发
        retry_candidates = [(501, requires_user_answer=True, agent_can_handle=False)]
        condensed_missing_questions = ['user_work_authorization']
        问句 + profile_paths 都在报告里，下一步不需要报告之外的知识

写回：node shared/record_profile_answers.mjs --json '{四个键}' --source user_answer ... → exit=0

第二遍（同一份结果文件，一个字没改）：
        user_questions   = []                                ← 问题消失
        condensed        = []
        agent_actions    = [('agent_profile_backed', 2)]      ← 回到「系统能填」，而这次档案里确实有值
```

**同时核了两条容易假绿的机制**：
① `RETRYABLE_CATEGORIES`（`:298-317`）确实含 `user_work_authorization` / `user_legal_attestation` /
`user_demographics_eeo` 三项——**漏这一步等于用户答完了行也不会被重投，功能等于没做**；
② `onboarding_candidates`（`:440`）的硬编码名单确实含 `user_work_authorization`。

### 5.7 ✅ 缺陷是否真被消除（8 档案 × 5 判定，未引用 BUILD 任何数字）

`deriveWorkAuthAnswers()` + `blockingProfileGaps()`，配仓库里**真实出货的** `answer_bank.json`：

| 档案 | authorized | sponsorship_future | 门 |
|---|---|---|---|
| P1 美国公民（授权、不需担保） | `Yes` | **`No`** | ok=true |
| P2 **明确未获授权**（F-1 无 CPT/OPT） | **`No`** | `Yes` | ok=true |
| P3 `work_authorization` 键全缺 | null + 阻塞 | null + 阻塞 | **ok=false** |
| P4 连 `work_authorization` 整块都没有 | null + 阻塞 | null + 阻塞 | **ok=false** |
| P5 四个键显式 `null`（没问过） | null + 阻塞 | null + 阻塞 | **ok=false** |
| P6 现有真实用户形状（F-1 OPT） | `Yes` | `Yes` | ok=true |
| P7 陈旧手改档案（字符串 `"true"`） | null + 阻塞 | null + 阻塞 | **ok=false**（禁强转） |
| P8 **出货模板逐字节** | null + 阻塞 | null + 阻塞 | **ok=false** |

对照 RISK_REPORT 的实跑基线「5 种档案 5 次全部输出 `Yes`，这个函数在当前配置下没有能力输出 `No`」——
**现在它既能输出 `No`，也能输出「不知道」。P2 与 P1 这两条 RISK_REPORT 点名的明确不实陈述，全部消除。**

其余四类：

- **担保题方向相反那条（RISK_REPORT E）**：P1 美国公民现在答 `No`（不需担保），不再被标成「我需要担保」。✅
- **硕士学位（RISK_REPORT C）**：`isGraduateDegree()` 词边界实测——`BS in Marketing` → false、
  `Bachelor of Science in Information Systems` → false（这两个正是 BUILD 记的「差点翻车」样本）、
  `Master of Science in CS` / `MS in Data Science` / `PhD in Economics` / `MBA` → true、
  `Associate of Applied Science` / `B.A.` / 空 / null → false。✅ 词边界成立，不会把市场营销本科生答成硕士。
- **退伍军人（RISK_REPORT D）**：出货 `answer_bank.json` 的 `yes_no_defaults.veteran` 现在是
  `I don't wish to answer`，五项 EEO 默认**全部落在拒答集合**。Ashby 侧实测拒答。
  ⚠️ Greenhouse 候选表 `'No'` 仍排第一（§16-E，批次 C）。
- **共用默认值是否真死**：`grep -rn yes_no_defaults` 全仓核过，`work_authorization` / `sponsorship_future`
  两个键**已无任何代码读点**（只剩注释与守卫测试），且 `test/personal_facts_guard.test.mjs:115`
  有一条「谁再读这两个键就红」的守卫。✅

### 5.8 🟡 设计/记录不一致（不影响功能，但会误导下一个人）

| # | 位置 | 说的 | 实际 |
|---:|---|---|---|
| 1 | BUILD §24 偏离 7 | `apply_gap_report.mjs` 533→**570** | 提交树与工作树都是 **564**（`git show 71c3bef:... \| wc -l` = 564）。结论不变（距 800 上限仍有余量），但这是证据表里的一个数字 |
| 2 | BUILD §22.2「changed 8/24」 | 直接复跑会看到 **13** | 多出的 5 条是 `:400` 的 8 条展示截断，非分类变化（详见 §5.5）。建议在 BUILD 里补一句注释 |
| 3 | DESIGN §6 vs `intake-and-profile.md` | 「不确定」该写 `false` / 该留 `null` | 两份文档互相矛盾，代码只实现了「留 null → 死锁」（详见 ⚠️1） |
| 4 | DESIGN §1.1「驱动侧已接线」 | 对 Greenhouse 成立 | 对 Ashby 不成立（`ashby_apply_driver.mjs:1142` 丢 `a.note`，见 §6 核实结论）。builder 已自报，DESIGN 本身需按 BUILD §24 修正后才启动批次 B（lead Round 19 裁决 2 已覆盖） |

### 5.9 未覆盖（说明理由）

| 项 | 为什么没覆盖 |
|---|---|
| 真实表单上的端到端投递 | 派遣单明令禁止真跑投递 / 禁止提交任何表单。所有驱动级验证走「取出货源码 + 只替换 6 个碰浏览器的函数」的替身法，判定逻辑逐字是驱动自己的代码 |
| `reactSelectOneOf` 候选表在真实下拉框里到底选中哪一项 | 需要真实表单。替身按 `values[0]` 记账，所以 §5.3 表里退伍军人的 `'No'` 是「候选表首选」而非「一定被选中」——标准 Greenhouse 退伍军人下拉一般没有裸 `No`，实际大概率落到拒答，**但那是运气不是设计**（沿用 RISK_REPORT 的判断） |
| Ashby 驱动的完整题面矩阵 | Ashby 驱动不在批次 A 文件清单内、本轮一行未动；只核了它的 EEO 默认与 `:1142` 的 note 丢失 |
| DESIGN §12.6 那两条「上线后落地实证 SQL」 | 明确写的是「批次 A 上线并跑过第一批真实投递之后执行」，本轮无真实投递，无法执行 |
| 数据表结构升级双路 / 数据隔离 | 登记表 `ci_smoke.schema_upgrade_path` 与 `isolation_field` **两格均为空** → 对应铁律跳过；且本轮**确无数据表结构变更**（`git diff` 核过，无建表 / 改表语句），本产品为单用户本机产品、无多租户 |
| UI 演示稿核对 | 本项目无 UI，本轮零前端改动 |

---

## §6 Quinn 主动重构记录

**本轮零重构、零代码改动。**

发现的 3 个真 bug 全部超出 Quinn 边界：❌1 是交付形态（涉 18 个文件的提交决策，属 lead 拍板）、
❌2 涉及出厂模板语义与批次 B/C 排期（属产品取舍）、❌3 虽然只是一个循环挪位置（≈4 行），
但 `secure_profile_files.sh` 是安全脚本、且改它会与批次 B 的 R2「写入侧统一上锁」撞车，
**按红线 6「Quinn 重构超界」我没有动**，列进报告交给 lead 排期。

同类核实（派遣单第六项）：

| builder 自报 | 核实结论 |
|---|---|
| `shared/ashby_apply_driver.mjs:1142` 丢 `a.note` | **属实**。原文 `addPendingQuestion(pendingForMainClaude, { question: m, selector: sel.sel, tag: sel.tag })`，`a.note` 确实没有传下去；`addPendingQuestion`（`:1039`）只校验 `question` 与 `selector`，多带一个键不会被拒。工作授权靠新加的题面兜底分支仍能正确归类（我实测确认），但 Ashby 侧的法律声明 / 居住地 note 到不了 NOTE_CATEGORY——**批次 B 会撞上**，builder 判断正确 |
| `shared/profile.template.json:35 "gpa": "3.9"` / `:77 "earliest_start_date": "MM/DD/YYYY"` | **属实，且比自报更严重一点**：`apply_gap_report.mjs:266` 写的是 `PROFILE.education?.gpa ? 'agent_profile_backed' : 'user_gpa'`，`"3.9"` 是 truthy → **照抄模板的用户永远不会被问 GPA，3.9 会被当成他的 GPA 填进真实表单**。同理 `"MM/DD/YYYY"` 会被当成已知的最早到岗日。本轮新加的留痕已经把它标成 `legacy_unverified` 自曝（我在沙箱里实测看到了这条） |
| **第三条（builder 与 DESIGN §16 都没看见）** | **搬迁意愿出厂预填**，见 ❌2。这是本轮扫描的主要增量发现 |

扫描方法（列出来供复核）：把出厂模板里**每一个非空 / 非 null 的值**逐条过一遍「这是不是关于用户本人的一句陈述」，
再对每个候选 `grep` 它的代码读点、跑驱动确认是否真会落到表单上。除上述三条外，其余非空值判为
**占位符或非身份事实**：`personal.*` 的姓名 / 邮箱 / 电话 / 链接（引导必覆写，且明显是占位）、
`education.school/major/graduation_date`（占位）、`standard_qa.how_did_you_hear: "LinkedIn"`（渠道问卷，非本人事实）、
`personal.address_country: "United States"`（§16-K 已在清单，且 DESIGN 已论证是地址格式默认）、
`target_filters.*` 的打分阈值与节奏参数（非本人事实）。
**边界情况一条**：`education.degree: "B.S. in Your Major"` 是占位符，但 `isGraduateDegree()` 会把它当真实学位读并答「否」——
不产生虚高陈述，归进 §16-F 的学历三态一并处理即可，不单列。

---

## §7 质量 3 指标

| 指标 | 值 | 说明 |
|---|---|---|
| 覆盖率 | 三个新模块**行覆盖 100% / 100% / 100%**（`personal_fact_gate` / `answer_provenance` / `record_profile_answers`，我用 `node --test --experimental-test-coverage` 独立实测，未采信 BUILD）。分支覆盖 100% / 89.74% / 85.19%。`apply_gap_report.mjs` 96.45%（未覆盖 23-24 / 38-39 / 44-51 / 107 / 268-270 / 272 / 289 / 292-293，全部是既有 IO 与 CLI 兜底分支）、`missing_field_questions.mjs` 94.62% | 达标（DESIGN 要求 ≥90%） |
| 漏检率自报 | `verify_self_miss_rate: 0%` | 本任务此前**没有过 verify 轮次**（TASK Round 1-19 无 verify 产物），故无「上轮漏检」可算。本轮总问题数 3 真 bug + 3 风险 + 4 处记录不一致 = 10 |
| 真 bug 数 | **3**（P0 ×1 / P1 ×1 / P2 ×1） | 均给了严重度 + 命中维度 + 可复现步骤 |

> 单人项目，本表不填大厂记分卡式指标（缺陷密度 / 逃逸率等）——没有历史基线，填了是仪式不是信息。

---

## §8 老坑清单核查

**本项目未定义 verify 岗位补充说明**（`.claude/arnold/roles/verify.md` 不存在）。
以下老坑从 `PROJECT_MEMORY.md` 四条长期原则 + `builder.md` 家规 + 上游报告的教训段反推，逐条核：

| # | 老坑 | 核查结论 |
|---:|---|---|
| 1 | **红线必须落成代码断言，写在文档里的红线等于没有** | ✅ 本轮兑现了三处断言：门是 `supervisor_preflight` 的 `checks` 项且退出码非 0（实测 exit=1，不是 WARN）；写回白名单越界 exit 2（实测）；出厂全空由 `personal_facts_guard.test.mjs` 守卫。**但** ❌2 说明红线清单里的 `relocation` 这一项**至今没有断言**——建议给 `personal_facts_guard.test.mjs` 补一条「模板不得预填任何搬迁意愿」 |
| 2 | **三态字段绝不允许用真假判断读** | ✅ `threeStateYesNo()` 显式三分支；门只认 `=== true` / `=== false`，字符串 `"true"` 实测被当没回答；写回口对布尔路径拒绝任何非布尔（exit 3）。⚠️ 但 §5.3 表里的年满 18 / 禁枪清单 / 在读状态 / 不受限制授权四类**仍是两态**（批次 B/C） |
| 3 | **单用户期的测试必须喂「不像我」的档案** | ✅ 本轮新增测试确实喂了美国公民 / 明确未获授权 / 全空三类；我自己另加了「陈旧字符串 `"true"`」与「出货模板逐字节」两类，也都过 |
| 4 | **投递时「填了什么」必须留痕** | 🟡 本轮只建了**来源**留痕地基（`answer_provenance.json`，只存指纹不存值），**字段级投递留痕（F6）明确未做**，BUILD §27 如实记了，没有假装解决。与 DESIGN §12.7 一致 |
| 5 | `builder.md`：**测试必须串行** | ✅ `npm test` 自带 `--test-concurrency=1`，我复跑两次结果一致，无 flaky |
| 6 | `builder.md`：**交活前 CI 每一步本地跑一遍，不能只跑 `npm test`** | ✅ 我四步全跑（§10）。**但正是这条家规的精神抓出了 ❌1**——「本地全绿」与「提交树全绿」是两件事，家规下一次应当补一句：绿要绿在**可检出的提交**上 |
| 7 | 登记表 `ci_smoke.main_chain` 主流程冒烟 | ✅ `npm run demo:check` exit=0；两条 WARN（`chrome_cdp_not_running` / `supervisor_preflight_not_clean`）同源——我故意没开浏览器，preflight 唯一 FAIL 是 `cdp: fetch failed`，`work_authorization_answered` 是 **OK**。与本轮改动无关 |
| 8 | FORENSIC 提出的 R1（文件名把失败标成成功） | 本轮范围外（lead 已排队至批次 A 之后），未核 |

---

## §9 13 维深查（`--strict`）

| # | 维度 | 检查方式 | 结论 |
|---:|---|---|---|
| 0 | 最高原则逐条 | 通读新增三个模块 + 分类器改动 | ✅ 无 fallback 遮盖：写回口校验失败**原样打印校验器报错**不包装（源码核过）；Fail Fast：白名单/类型/校验三道各有独立退出码（2/3/4，实测 2 与 3）；无静默降级：门是硬失败不是 WARN（DESIGN 讨论段方向 6 论证过，实测 exit=1 属实）；无过期防御层。⚠️ 唯一一处「彻底解决 vs 降级」的取舍未收口 = ⚠️1 的「不确定」出口 |
| 1 | 并发时序 | 检查写回口的原子性与批次锁 | ✅ 写临时文件 → `rename` 原子替换 → `chmod 600`；`apply_batch` 有 `acquireBatchLock()`。写回口无并发写场景（单用户本机、主对话串行调用） |
| 2 | 数据一致性 | 幂等 / 回滚 / 半成功 | ✅ 实测：同一命令跑两次留痕只一条（幂等）；白名单违规与类型违规两条负路径**档案 shasum 前后逐字节一致**；校验失败走 `.bak` 还原 + exit 4（有专测，且覆盖率数字曾戳穿过一条假绿测试——BUILD §21 方向 5，我核了改后版本确有 `calls === 2` 断言）；成功后删 `.bak`（实测目录里无残留） |
| 3 | 错误路径 | 每个 `catch` 是否走过 | ✅ 新代码 3 处 `try/catch` 全是有明确降级语义的解析兜底（`readProfileForGate` 读不到 → `{}` 让门去拦、`--json` 解析失败 → exit 2 打印原始错误、`applyAnswers` 抛错 → exit 3 打印原始错误）。`grep 'catch {}'` 空 catch 零命中 |
| 4 | 边界值 | 空 / 超长 / 特殊字符 / 数字边界 | ✅ `priority: 0` falsy 陷阱（`|| 99` 实证，两处：`missing_field_questions.mjs:302` 与 `apply_gap_report.mjs:377`）；`{}` 空容器不被当「有人填过」；`\bvisas?\b` 词边界（喂「Is it advisable to…」确认不误触发）；`isGraduateDegree` 12 个正反样本 |
| 5 | 数据隔离 | 登记表 `isolation_field` **未填** | 跳过（单用户本机产品，无多租户） |
| 6 | 移动端 + 浏览器 | 无前端改动 | N/A |
| 7 | 网络层 | 本轮零外部请求 | ✅ 新增三个模块零网络调用（`grep fetch/http` 零命中）。门在开工前拦截，**实测 preflight 走完不开任何标签页** |
| 8 | 性能资源 | 门的开销 / 报告新增查表 | ✅ 门是纯对象取值 + 4 次 `===`，无 IO；报告新增 `NOTE_CATEGORY` 为 O(1) 哈希 + `CATEGORY_ANSWERED` 惰性谓词。24 题 × 2 树的对照跑全部亚秒返回；`demo:check` 端到端时长与改前无可感差异 |
| 9 | 安全 | 权限 / 越权 / 明文 | ✅ 写回口白名单由问题模板生成（实测越权 exit 2）；`profile.json` 与 `answer_provenance.json` 均 `-rw-------`；留痕**只存 16 位指纹不存值**（我打开文件确认了）；无 `.bak` 长期残留。❌3 是这一维扣的分 |
| 10 | 用户体验 | 失败提示 / 用户看得懂卡在哪 | ✅ 门被拦时 preflight 直接打印中文问句 + 一条可复制执行的完整命令（§5.5 ①②）；缺口报告的 `condensed_missing_questions` 自带 `profile_paths`，下一步不需要报告之外的知识。⚠️ 「不确定」那条出口缺失（⚠️1） |
| 11 | 未来扩展 | 3 个月后会不会后悔 | 🟡 note 是**弱类型字符串契约**，改名不会编译报错——已用 grep 守卫兜住（我核了这条测试真能红：它断言 NOTE_CATEGORY 至少 16 个键且每个键都能在 `shared/*.mjs` 里搜到）。字段无膨胀（新增类目复用既有分组机制，`QUESTION_GROUPS` 一行没动）。无供应商锁定 |
| 12 | 文档同步（**缺失 = 真 bug**） | 变更日志 / 项目记忆 / 说明书 | ✅ `CHANGELOG.md` `[Unreleased] → Fixed` 新增 4 条；`SKILL.md` 净增 1 行（496/500，门禁过）；`references/run-and-database.md` 新增完整的写回命令用法 + 四个退出码表 + 留痕说明；`references/intake-and-profile.md` 把 A0/A2 落盘从「给模型的指令」改成「必须调命令」。`PROJECT_MEMORY.md` 四条长期原则本轮无需新增（RISK_REPORT 那三条已在）。**未发现该更没更的文档** |

---

## §10 覆盖度评估 + 质量分

### CI 四步（本地串行真跑，逐条对照 `.github/workflows/ci.yml`，不引用 BUILD 的退出码）

| # | CI 步骤 | 命令 | 结果 | 退出码 |
|---:|---|---|---|---:|
| 1 | Unit tests | `npm test` | tests 177 / pass 177 / **fail 0** | **0** |
| 2 | Role-guard smoke test | `node scripts/role_guard_smoke.mjs` | `role guard smoke ok` | **0** |
| 3 | Public alpha release gate | `node scripts/public_alpha_gate.mjs` | `public alpha gate ok`（含 `onboard skill stays concise`） | **0** |
| 4 | Syntax-check | `for f in $(find shared scripts -name '*.mjs'); do node --check "$f"; done` | 84 个文件全过 | **0** |

主流程冒烟：`npm run demo:check` → **exit=0**，2 条 WARN 均因我故意不开浏览器。

> ⚠️ **这张表只对当前脏工作副本成立。** 同一套命令跑在干净的 `71c3bef` 上是 **165 / 159 pass / 6 fail / exit 1**（❌1）。

### 覆盖度

| 项 | 状态 |
|---|---|
| DESIGN §12.6 的 8 条验收标准 | 1 CI 四步 ✅ / 2 主流程冒烟 ✅ / 3 新用户模拟 ✅ / 4 现有用户零变化 ✅（贴了对照表）/ 5 闭环实证 ✅ / 6 越权拒写实证 ✅（贴了 shasum 结论）/ 7 覆盖率 ✅（实测 100%）/ 8 边界 ✅ —— **8/8 全部独立复验通过** |
| RISK_REPORT 的 5 处缺陷（A-E） | A/B/E 工作授权与担保 ✅ 消除；C 硕士学位 ✅ 消除且词边界正确；D 退伍军人 🟡 Ashby ✅、Greenhouse 候选表首项仍是事实陈述（§16-E，批次 C） |
| RISK_REPORT 的 4 条扫描发现 | 发现 1（守门人站错队）✅ 本轮修好且我独立复现了修前修后；发现 2（`standard_answers` 错配 F7）未做（DESIGN §12.7 明确不做）；发现 3（Lever/GH 退伍军人）批次 C；发现 4（无审计留痕 F6）本轮只建地基，如实记录 |
| 关卡拍板事项 | 关卡 1 ①「编造事实 bug 要修」→ 工作授权部分兑现；关卡 2 ②「满 18 岁引导时问一次」→ **未实现**（批次 B）；关卡 2 ③「无限制工作授权未知 → 阻塞」→ **未实现**（批次 C）。两条均在计划内，非本轮失职，但**拍板事项尚未落地这件事必须在收口时说清楚** |

### 质量分：**3 / 5**（1-3 = 回炉）

**打 3 不是因为代码差——代码质量是我近期见到的高水位**：TDD 是真的（四段先红后绿，原始报错可核）、
6 个被否决方向里 4 个是靠实算和覆盖率数字揪出来的（不是事后补的叙事）、8 处偏离 100% 标注且
**其中 3 处「照设计字面写会出静默缺陷」的判断我逐条独立复核，全部正确**：

- `priority: 0` 会被 `|| 99` 吃掉 —— 我在两处源码（`missing_field_questions.mjs:302`、`apply_gap_report.mjs:377`）都确认了写法，用 0.5 是对的；
- `value_type: 'string'` 一刀切不成立 —— 实测 `legal_attestations.*` 两条确是 boolean、`standard_qa.*` 五条确是 object，照设计字面写会让写回口对一半类目 exit 4；
- `NOTE_CATEGORY` 无条件查表闭不上环 —— 我的第一遍/第二遍闭环实跑直接证明：没有 `CATEGORY_ANSWERED` 那道谓词，
  同一份结果文件重跑时问题不会消失。**builder 是对的，DESIGN §3.2 与 §4.3 确实自相矛盾。**
  （另外两处也核了：偏离 4 反向依赖确实避免了 `missing_field_questions ↔ personal_fact_gate` 的循环 import——
  我核了两个文件的 import 方向，是单向的；偏离 6 成功后删 `.bak` 我在沙箱里确认了不留第二份个人数据副本。）

**扣到 3 的三条硬理由**：

1. **交付形态是坏的（❌1，P0）**。「CI 四步 0/0/0/0」这条核心交付证据，对任何可检出的提交都不成立；
   而且提交树上的产品**仍在替用户答「我有工作授权」**。这不是苛求——它是一条命令就能验证的客观事实。
2. **同类漏网还有第三条，而且在红线点名清单里（❌2，P1）**。派遣单第六项就是问「有没有第三条」，答案是有：
   出厂模板会让新用户答应搬去纽约。它与本轮刚拆掉的 I 项是同一个病、同一类后果。
3. **拍板人在关卡 2 已经拍板的一条（无限制工作授权未知 → 阻塞）至今未落地**，而它今天对空白档案答的是 `No`。
   排期上属批次 C 没错，但「拍过板的事还在编造」这件事必须由 lead 主动向拍板人交代，不能埋在批次 C 的清单里。

**回炉建议（三件事，都不大）**：

1. **[必做，先做]** 把剩下 18 个改动文件 + 1 个未跟踪测试文件提交掉，然后**在干净检出上重跑一次 CI 四步**，
   贴出「HEAD 全绿」的证据。批次 A 才算交付完成。（lead Round 19 裁决 3 的「不重组历史」我认同并建议保留，
   只是收尾动作的范围要从「文档提交」改成「把主体修复代码提交」。）
2. **[必做]** 把 ❌2（搬迁意愿出厂预填）加进批次 B 的模板清理清单，与 §16-I / §16-K 同批；
   并给 `personal_facts_guard.test.mjs` 补一条守卫断言（红线里点名 `relocation`，今天没有任何断言守它）。
3. **[请拍板]** ⚠️1 的「我不确定」出口该怎么走（死锁 vs 写 false vs 跳过命中该题的行），
   两份上游文档给的答案相反，这是产品取舍不该由 builder 定。

批次 B **可以在第 1 项做完之后启动**（lead Round 19 裁决 2 要求的「DESIGN 按 BUILD §24 修正」我复核后认为
那 8 处标注是准确的，修正 DESIGN 后即可）；❌2 与 ⚠️1 建议并入批次 B 的派遣单。

---

## 试过的错误方向

**❌ 方向 1：一开始打算直接对 BUILD §22.1 那张 24 行对照表做「抽查几行」，看数字对不对。**
省时间，而且那张表看起来很详细。
**否决理由**：验收铁律第一条就是「builder 说测过了 = 假设没测」，抽查等于让被验方选考题。
改成自己检出 `6e31883` 建独立工作树、自己造夹具、自己跑两边。**这个决定直接换来了两条发现**：
① 我跑出来的是 13 条变化不是 8 条，追下去才找到 `:400` 的 8 条展示截断（§5.5），
若只抽查我会误判成回归；② 为了搭工作树而做的 `git worktree` 操作，让我顺手在干净树上跑了一次测试——
**❌1（HEAD 是红的）就是这么撞出来的**。

**❌ 方向 2：把「EEO 现在会去问用户」直接判成 UX 回退，理由是驱动本来就能正确拒答、不该多打扰。**
一度很有说服力：RISK_REPORT 自己就说性别 / 种族 / 残疾三个平台一致拒答、是正确做法。
**失败原因**：我把「驱动怎么填」和「报告怎么归类」混成了一件事。跑出货驱动实测后确认——
**驱动对 EEO 的行为一行没变，五题仍然自动拒答**；变的只是「驱动已经填不上、字段留在 `remaining` 里之后」
的归类。在那个前提下，旧行为是把这一行交给「你自己从档案里填」而档案是空的（静默循环），新行为是问用户。
后者严格更好。这个方向翻车之后，剩下的合理担忧被降级成 ⚠️2（触发条件比 ADR-6 声称的宽），而不是回退。

**❌ 方向 3：判定「本轮把编造事实这件事解决了」，因为 RISK_REPORT 点名的 5 处 A-E 我都验证消除了。**
数据上完全成立：5 处逐条核过，该 `No` 的 `No`、该阻塞的阻塞。
**失败原因**：RISK_REPORT 的 5 处是**pm 那次读码的抽样**，不是全集。我把驱动当黑盒、拿 16 道真实题面
× 6 种档案跑了一遍完整决策表之后，看到年满 18 / 禁枪清单三题 / 不受限制授权 / 在读状态**仍然在答**。
它们确实都在 DESIGN 的 B/C 批次里（所以不扣批次 A 的分），但**拍板人问的是「产品现在还会不会编造」**——
只答 A-E 五处就是拿抽样冒充全集。§5.3 那张表因此才被加进来。

**❌ 方向 4：只在模板 JSON 里肉眼找「哪些值看起来像个人事实」来做第三条漏网扫描。**
最快，`gpa: "3.9"` 一眼就能看见。
**失败原因**：这个方法找得到**字面就是事实的值**，找不到**经过代码推导才变成事实陈述的值**。
搬迁那一条在模板里长的是 `relocation_policy: "anywhere_primary_country"` 和
`willing_to_relocate_scope: "Anywhere US"`——两个像配置参数的字符串，肉眼扫十遍也不会觉得它是「关于用户本人的陈述」。
是把出厂模板当成一份普通档案**喂进真驱动跑真题面**，看到它对「你愿意搬到纽约吗」答了 `Yes`
（而其余 5 种档案全部阻塞）才逮到。**教训：出厂模板的体检，必须让它跑一遍完整题面，不能只读 JSON。**
