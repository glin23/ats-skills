---
Status: done_pending_review
Owner: arnold-verify
Reads: docs/active/2026-07-23_product-blueprint_TASK.md, docs/active/2026-07-23_product-blueprint_DESIGN.md, docs/active/2026-07-23_product-blueprint_BUILD.md, docs/active/2026-07-23_product-blueprint_RISK_REPORT.md, docs/active/2026-07-23_product-blueprint_FORENSIC.md, PROJECT_MEMORY.md, PROJECT_CONTEXT.yaml, .claude/arnold/roles/builder.md, .claude/arnold/roles/lead.md, shared/apply_gap_report.mjs, shared/missing_field_questions.mjs, shared/personal_fact_gate.mjs, shared/record_profile_answers.mjs, shared/answer_provenance.mjs, shared/answer_routing.mjs, shared/greenhouse_apply_driver.mjs, shared/ashby_apply_driver.mjs, shared/profile.template.json, shared/answer_bank.json, shared/supervisor_preflight.mjs, shared/apply_batch.mjs, scripts/secure_profile_files.sh, test/apply_gap_report.test.mjs, test/greenhouse_work_auth_driver.test.mjs, .claude/skills/mrweirdo-onboard/SKILL.md, .claude/skills/mrweirdo-onboard/references/intake-and-profile.md, .claude/skills/mrweirdo-onboard/references/run-and-database.md, .github/workflows/ci.yml
Mode: strict（第 1 轮 批次 A）/ daily（第 2 轮 批次 B 的 B0+B1）/ daily+（第 3 轮 Round 35，含不可逆动作取证）/ daily+（第 4 轮 Round 37，回炉三件聚焦复核）/ daily+（第 5 轮 阶段 0，施工记录缺失全独立实测）
Iterations: 6
Updated: 2026-07-30
Type: VERIFY_REPORT
Reads_round2: 设计稿（对号入座问法 / Ashby 阻塞信号 / 批次 B 验收标准 / 方法论复盘 那几节）, 施工记录第 45-54 节, PROJECT_MEMORY.md, PROJECT_CONTEXT.yaml, shared/work_auth_identity.mjs, shared/personal_fact_gate.mjs, shared/apply_gap_report.mjs, shared/ashby_apply_driver.mjs, shared/missing_field_questions.mjs, shared/apply_batch.mjs, shared/supervisor_preflight.mjs, shared/answer_provenance.mjs, shared/paths.mjs, shared/onboard_tmp.mjs, shared/local_db.mjs, shared/cover_letter_materials.mjs, scripts/intake_resume.sh, scripts/demo_check.mjs, test/ashby_driver_harness.mjs, test/ashby_pending_note.test.mjs, test/work_auth_identity.test.mjs, test/helpers.mjs, 引导说明书 intake-and-profile.md, .github/workflows/ci.yml
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

---
---

# 验收报告（第 2 轮）— 批次 B 的 B0 + B1（`8eb581c` → `66882ab` → `5e4f76a` → `a1ffd15`）

| 项 | 内容 |
|---|---|
| Owner | arnold-verify |
| Mode | daily（日常模式，未走 `--strict`；本轮不改数据表结构、不动认证，B1 虽新增模块但边界清楚） |
| Iterations | 3 |
| Updated | 2026-07-26 |
| 被验对象 | 4 个提交，14 文件 **+1406 / −30**（`git diff --stat 8f9e546..a1ffd15`，我自己跑的） |
| 判官分工 | 施工 = Codex，验收 = Claude（异家交叉成立） |
| 岗位补充说明 | **`.claude/arnold/roles/verify.md` 仍不存在**（同目录只有 `_README.md` / `builder.md` / `lead.md`）。老坑清单按派遣单给的 6 条 + `PROJECT_MEMORY.md` 五条原则执行 |
| 对真实家目录的动作 | **只读**。开工/收工各做一次 `find ~/.mrweirdo-jobs -exec stat` 全量快照，**diff = 0 行**（7205 条目前后一致，见 §10.4） |

> 本轮**未改一行产品代码**（10 次突变测试全部在临时工作树里做、每次 `git checkout --` 还原，5 棵工作树收工前
> `git status --porcelain` 均为 0 且已 `worktree remove`）；未 push、未动远端、未碰 `batchA-backup`、
> 未真跑投递、未开浏览器、未提交任何表单、未发邮件。

---

## §1 验收范围（第 2 轮）

按派遣单四块：**A** = DESIGN §13.8 第 1/2/3/7/8 条；**B** = 施工员自报的 3 处偏离逐条独立复核；
**C** = 6 条老坑回归；**D** = 「人肉门房版首跑」的路径隔离实测（与 A/B/C 无关的独立核实）。

**一条方法纪律**：全程不引用 BUILD 的任何数字。BUILD 说 212 我自己跑 212 才算；BUILD 说 60 格 3 格变
我自己搭 95 格矩阵重跑；BUILD 说「照设计字面写会当场变红」我自己把那行写回去看它红。

---

## §2 5 维高危区评估（**先于一切**，决定测试密度）

| 维度 | 本轮对应物 | 危险度 | 分配的测试密度 |
|---|---|---|---|
| ① 核心业务逻辑 | 「你是哪一种人」→ 四个档案字段的真值表；缺口报告的 note 分类 | **极高**（写错 = 在真实雇主表单上替人做一次移民身份陈述） | 最高：20 格内存断言 + 20 格落盘断言 + 95 格新旧对照 + 10 次突变测试 |
| ② 安全边界 | 别人的简历/档案会不会漏进创始人自己的家目录（D 项） | **极高**（拿别人简历代跑，漏 = 隐私事故） | 最高：全量 stat 快照 diff + 真跑一次代跑流程 + 逐个状态载体查路径解析 |
| ③ 性能 | 门多读一次留痕文件；报告多两次前缀比较 | 低（无 IO 增量、无网络） | 低：只确认 `demo:check` 与 preflight 仍在秒级 |
| ④ 集成点 | Ashby 驱动 → 结果 JSONL 的 `pending[].note` 字符串契约（弱类型，改名不报错） | **高** | 高：用出货源码里那一行本身跑（不重写替身），8 组题面 × 有/无选择器 |
| ⑤ 用户体验主流程 | 门是硬失败：误伤 = 整批投不出去；「说不清楚」不许是死胡同 | **高** | 高：6 种身份档案各跑一次完整落盘 + `apply_batch --dry-run` 真输出 + preflight JSON |

**据此定的密度**：①②④⑤ 全部走「独立复跑 + 假设 builder 没测过」；③ 只做量级确认。

---

## §3 7 类测试设计技术覆盖

| # | 技术 | 用了几次 | 具体用在哪 |
|---:|---|---:|---|
| 1 | 等价类划分 | 3 | 5 种身份情形；档案分「真实用户 / 出厂模板 / 真实档案但 `custom_facts` 清空 / 加了 Denver 的档案」；留痕来源分「人亲口 / 无记录」 |
| 2 | 边界值分析 | 4 | 「不写」的格子必须是 `null` 而非 `false`/`""`（落盘逐格断言 `typeof`）；`'unclear'` 是第三个合法值不是缺答；「说不清楚**且没留原话**」这一支；空题面进 `addPendingQuestion` |
| 3 | 决策表 | 2 | 25 题面 × 2 形态 + 9 note × 5 题面 = **95 格**新旧全跑；6 身份 × (落盘 4 字段 + 门 3 输出) |
| 4 | 状态迁移 | 2 | 「门拦住 → 用户说不清楚 → 写回原话 → 门仍拦但改口播查证去处 → 同批第二次不再问」全程真跑；地点闭环「问 → 用户答 Denver → 不再问」 |
| 5 | 用例测试（端到端） | 3 | ① 说不清楚全流程（`apply_batch --dry-run` + `supervisor_preflight --json` 真输出）② 人肉门房代跑（D 项）③ 干净检出 CI 四步 + `demo:check` |
| 6 | pairwise | 1 | 4 题面 × 2 档案（真实 / 清空 `custom_facts`）× 2 棵树，专打前缀规则的生效条件 |
| 7 | 风险驱动 | 贯穿 | 按 §2 的密度分配；**外加 10 次突变测试**——把被测代码逐处改回旧写法，看新测试会不会红（老坑 6） |

**N/A**：无。7 类全用上了。

---

## §4 5 轮回归循环记录

| 轮 | 做了什么 | 结果 |
|---:|---|---|
| 1 | 先写「会失败的对照」：把 `8f9e546`（本轮之前）单独检出，搭 95 格矩阵同时喂旧树新树；再把新代码逐处改回旧写法 | **10 次突变全部变红**（§5.7）；旧树在「同一道 onsite 题、带 note 反而说『档案里有』」这处**自相矛盾复现成功**（§5.2） |
| 2 | 跑全套：4 个提交各自干净检出 × CI 四步 + 主流程冒烟 | **全绿**：212/212、role_guard 0、alpha_gate 0、85 文件 `node --check` 0、`demo:check` exit 0（§10.1） |
| 3 | 红了辨析 | 出货代码没红。但把「前缀规则」放到**真实用户的档案**上跑，发现它一次也没生效（§5.4-❌1） |
| 4 | 追根因 | 不是接线错，是闭环谓词粒度太粗：`nonEmpty(standard_qa.custom_facts)`，而真实档案里有 11 条 → 前缀的「一票否决」永远被这一票抵消。实测双档案对照确认（§5.4） |
| 5 | 还红 → 是否转 bug 成员 | **不转**。根因清楚、修法与他自己在偏离 ② 做的那次修改同构（谓词从「桶里有没有东西」改成「这道题的事实答过没有」），属功能补齐不属排障 |

---

## §5 结论明细（第 2 轮）

### 5.1 ✅ A-1 / A-2：对号入座真值表 20 格 + 「说不清楚」不死锁

**20 格逐格断言（我自己按 DESIGN §13.3 那张表重写的断言，没有 import 他的 `TRUTH_TABLE`）**：

| 情形 | `authorized_to_work_us` | `requires_sponsorship_now` | `requires_sponsorship_future` | `visa_status` |
|---|:---:|:---:|:---:|---|
| Q1=是（公民/绿卡） | `true` ✅ | `false` ✅ | `false` ✅ | `US Citizen or Permanent Resident` ✅ |
| Q2=是 Q3=是 | `true` ✅ | `false` ✅ | `true` ✅ | `F-1 with CPT/OPT` ✅ |
| **Q2=是 Q3=否（还没批下来）** | **`<未写>`** ✅ | **`<未写>`** ✅ | `true` ✅ | `F-1 without current work permission` ✅ |
| Q2=是 Q3=说不清楚 | `<未写>` ✅ | `<未写>` ✅ | `<未写>` ✅ | 用户原话 ✅ |
| Q1否 Q2否（其他） | `<未写>` ✅ | `<未写>` ✅ | `<未写>` ✅ | 用户原话 ✅ |

**20/20 通过。** 第三行 `authorized_to_work_us` **一个字节都没写**（不是 `false`）——DESIGN 讨论区方向 7
点名要盯的那一格，成立。

**落盘复核（不只看内存返回值）**：拿真出厂模板建 6 个沙箱家目录、真跑
`record_profile_answers.mjs --source user_answer`，再读盘：

```
F-1 还没批下来   → authorized_to_work_us = null (typeof object)   ← 不是 false，不是 ""
                   requires_sponsorship_now = null (typeof object)
                   requires_sponsorship_future = true
F-1 说不清楚     → 三个布尔全部 null，visa_status = "说不清楚，学校还没回我"
其他签证         → 三个布尔全部 null，visa_status = "H-1B，去年转的"
```

**「说不清楚」不死锁的四个子条件，全流程真跑（`apply_batch --dry-run` 的实际 stdout）**：

| 子条件 | 实测 |
|---|---|
| ① 三个布尔仍为 null | ✅ 读盘确认 `typeof === 'object'`（null） |
| ② `visa_status` 记了原话 | ✅ `"说不清楚，学校还没回我"` |
| ③ 输出里**同时**含卡点 / 三条查证去处 / 「查清楚就能续上」 | ✅ 一次输出里 7 行俱全：卡点 1 行 + `去查 —` 3 行（OISS / I-20 第 2 页 / EAD 卡）+ 「一条命令就能续上，已经排好的队列不会白排」1 行 + 可复制的补救命令 1 行 |
| ④ 同一批内第二次调用不再重复问 | ✅ 第二次调用里含「ask "…"」的行数 = **0**；`asked_in_this_batch: true` |

`supervisor_preflight --json` 的 `work_authorization_answered` 那一格同样带全四件东西（我贴的是它的原始 JSON，不是转述）。

### 5.2 ✅ B-偏离② 独立结论（本轮重点）：**不是「改判定迁就代码」**

我按批次 A §5.1 的四步法重做，**没有采信他的任何数字**。

**第一步 — 我自己的 95 格矩阵（25 题面 × 2 形态 + 9 个动态 note × 5 题面），真实 `profile.json` 只读复制进沙箱**：

**88 格逐字一致，7 格变了，7 格全部落在地点族。**

| # | 题面 | note | BEFORE `8f9e546` | AFTER `a1ffd15` |
|---:|---|---|---|---|
| 1 | Are you able to work from our Denver office? | `relocation_commitment_policy_unset` | `agent_open_text` | `user_work_location_commitment` |
| 2 | Are you able to work from our Denver office? | `location_not_in_profile_preferences` | `agent_profile_backed` | `user_work_location_commitment` |
| 3 | Are you willing to work onsite? | `location_not_in_profile_preferences` | `agent_profile_backed` | `user_work_location_commitment` |
| 4-7 | What is your GPA? / Preferred name × 上面两个 note | （合成用例，非真实组合） | `agent_profile_backed` | `user_work_location_commitment` |

（我比他多出 4 格，是因为我额外跑了「题面与 note 不同族」的合成组合——它们不是真实驱动会产生的搭配，
但能暴露「note 一旦命中就完全接管分类」这个既有设计特性。方向与真实组合一致。）

**第二步 — 那 3 格到底变成了什么**：从 `agent_profile_backed`（报告原文动作是
「Do not ask the user first. Fill from existing profile」= 别问用户、自己从档案填）变成
`user_work_location_commitment`（带自己的问句 + 写回路径 `standard_qa.work_location_commitments`）。

**第三步 — 变化方向是「不再无声卡住」还是「多问一次」**：**是前者，而且代价比他自己说的还小。**
我做了 8 个定向探针（真实档案）：

| 探针 | BEFORE | AFTER |
|---|---|---|
| 他答过 Yes 的城市（New York）+ 同一个 note | `agent_profile_backed` | `agent_profile_backed` **零变化** |
| 他答过 Yes 的城市（Bay Area，无 note） | `agent_profile_backed` | `agent_profile_backed` **零变化** |
| **他没答过的城市（Denver）+ note** | `agent_profile_backed` | `user_work_location_commitment` ← 变了 |
| **没点名城市的 onsite 题 + note** | `agent_profile_backed` | `user_work_location_commitment` ← 变了 |
| 没点名城市的 onsite 题（**无 note**） | `user_work_location_commitment` | `user_work_location_commitment` 零变化 |

**代价 = 只有「他从没答过的城市」会被多问一次；他答过的城市一格不变。** 他在 BUILD §52 说的
「将来可能会被多问一次没答过的城市」成立，且没有夸大。

**第四步 — 这算不算「改判定迁就代码」：不算，两条硬证据。**

1. **新谓词严格更窄，不是更宽。** `locationCommitment !== null`（这道题点名的城市在档案里）⟹
   `nonEmpty(commitments)`（档案里有任何城市），反之不成立。**「迁就」的形状是放宽判定让自己过关；
   他做的是收紧。** 收紧后受影响的只有「档案里有别的城市、但没有这道题问的城市」这一个交集。
2. **旧代码在这一格是自相矛盾的，我把矛盾当场跑出来了。** 同一道题「Are you willing to work onsite?」、
   同一份真实档案：
   - **不带 note** → 旧代码就判 `user_work_location_commitment`（问用户）
   - **带上 note `location_not_in_profile_preferences`**（这条 note 的字面意思正是「这个地点不在档案偏好里」）
     → 旧代码反而判 `agent_profile_backed`（「档案里有，自己填」）

   **拿到更多信息、而且那条信息明说「档案里没有」之后，旧代码给出了相反且更乐观的结论。**
   这不是他改判定去迁就 note，是 note 路径与题面路径本来就对同一个事实给两个相反答案，他把两条路统一到了
   同一套别名匹配上。统一之后，带 note 的结果与「不带 note 时的既有正确行为」完全一致——这是最有力的旁证。

**闭环没被他改坏**（老坑 2 的另一面）：我实跑「用户答完 Denver=true 之后再读同一份结果文件」→
`agent_profile_backed`，问题消失，闭环闭上了。

### 5.3 ✅ B-偏离① 复现成功：照设计字面写，现成测试当场变红（我自己写的那行，不是信他）

我把「前缀 → 类目查表」按字面加进去（`if (driverFoundNoValue) return 'unknown_user_fact';`），跑全量：

```
✖ gap report: a fresh install is ASKED for a GPA instead of being answered from the template
  AssertionError: a GPA nobody stated must become a question:
  [{"category":"unknown_user_fact", … "question":"有表单问到了系统无法安全推断的事实。请看下面原题，逐题给真实答案。"}]
  + actual   'unknown_user_fact'
  - expected 'user_gpa'
✖ apply_gap_report: an empty-value note keeps the specific category when one exists
✖ apply_gap_report: an empty-value note still loses to the profile once the user answers
```

**212 → 209 pass / 3 fail，exit 1。** 他说的红是真的红，而且失败信息逐字印证他的理由：GPA 题会丢掉
`user_gpa` 自带的问句与 `education.gpa` 写回路径，降级成万能句。**偏离 ① 的判断成立。**

### 5.4 ❌ 真 bug（1 处）

#### ❌1 —— 严重度 **P2**｜命中维度 ①核心业务逻辑 ④集成点

**B0 附加的「前缀规则」对唯一真实用户 100% 不生效——它被自己的闭环谓词整个抵消掉了。**

`noValueCategory()` 的写法是
`categoryAnswered('unknown_user_fact') ? 'agent_profile_backed' : 'unknown_user_fact'`，
而 `unknown_user_fact` 的谓词是 `nonEmpty(standard_qa.custom_facts)`——**「这个桶里有没有任何东西」**。
真实 `profile.json` 的 `custom_facts` 里有 **11 条**，所以这个三元表达式在真实用户身上恒为
`agent_profile_backed`——**正好是前缀规则被设计出来要否掉的那个结论**。

实测（同一份真实档案，只把 `custom_facts` 清空作为对照）：

| 题面 | note | 真实档案（`custom_facts` 11 条） | 同档案但清空 `custom_facts` |
|---|---|---|---|
| Preferred name | `value_empty_for:preferred name` | **`agent_profile_backed`（没变）** | `unknown_user_fact`（生效） |
| Primary phone number | `no_bucket_for:primary phone number` | **`agent_profile_backed`（没变）** | `unknown_user_fact`（生效） |
| Expected graduation month | `value_empty_for:expected graduation month` | **`agent_profile_backed`（没变）** | `unknown_user_fact`（生效） |

**后果**：驱动明说「我这一格没值可填」，报告仍然回答「档案里有，别问用户，自己填」→ **那一行照旧无声卡住**。
这正是 DESIGN §13.5 / §10.2 存在的理由，在唯一的真实用户身上一点没被消灭。

**为什么他的 60 格对照表抓不到**：他比的是「旧 vs 新」，这三格新旧都是 `agent_profile_backed`
——**看起来「零变化」，实际是「新功能没启动」**。零变化在这里不是好消息。

**这不是回归**（旧行为一模一样），但它是本项目老坑的同款形状：**看起来修好了、行为没变**。
而且**他自己在同一个提交里已经把正确做法写出来了**——偏离 ② 就是把地点类目的谓词从
「桶里有没有东西」改成「这道题问的那个城市答过没有」。同一个提交里，一个类目用了细粒度、另一个用了粗粒度。

**修法（不是我改，是给 lead 派工用）**：把 `unknown_user_fact` 的谓词从
`nonEmpty(custom_facts)` 改成「这道题面对应的那条事实在 `custom_facts` 里答过没有」，
与偏离 ② 同构。改动小，但要配一条「答完之后同一题不再问」的闭环测试——**这条不能省**，
否则会退化成 BUILD §50 方向 2 已经否决过的死循环。

### 5.5 ⚠️ 风险（不是本轮引入的 bug，但会咬人）

**⚠️1 — `f1_without_permission` 是一条明确答案，产品却把他当「去查清楚」处理，而且永远拦着。**
一个 F-1 学生老老实实答「学校还没批」→ 三个字段里两个不写 → 门 `ok=false` →
输出的是「去查你的 I-20 / EAD 卡 / 问 OISS」。**可他刚查完，答案就是「没有」。** 这一支：
① 产品对他完全不可用（不是这一批不投，是永远投不出去）；② 给他的三条查证去处答非所问。
DESIGN §13.3 只论证了「说不清楚」这一支的出口，**没论证这一支**。这是拍板人该知道的产品后果，
不是工程能单方面定的（「宁可不投也不编」是对的，但「这类用户装了等于白装」得有人拍板）。

**⚠️2 — 「说不清楚」但没留原话时，同一批内会重复问。**
`asked_in_this_batch` 是从 `visa_status` 非空 + 留痕来源是人亲口**反推**出来的，不是「问过没有」的直接记录。
而 `workAuthAnswers()` 在「说不清楚且用户没留只言片语」时**什么都不写**（这条克制本身是对的），
于是 `visa_status` 仍是 `""` → `asked_in_this_batch = false` → **下一次调用又把同一个问题弹一遍**。
实测确认（第 6 个沙箱：`provenance = unknown`、`asked_in_this_batch = false`）。
DESIGN §13.8 第 2 条 ④ 在这一支不成立。结构性修法是记「这个问题问过了」而不是从答案反推。

**⚠️3 — A2「满 18 岁」：说明书守住了，但下游三个驱动仍在替他答相反的话。**
派遣单让我确认两件事，逐条答：
- **说明书是否明写了「只问不写档」**：✅ 明写了——「档案里目前还没有这一格（`legal_attestations.at_least_18`
  与驱动侧的三态判定一起落地）；在那之前只问、不手写档案——`record_profile_answers.mjs` 会拒绝一个
  没有任何问题声明过的路径，这是设计如此，不要绕过它」。
- **有没有地方在假装它被存下来了**：✅ 没有。`at_least_18` 全仓库**只出现在说明书那一句注释里**，
  零代码读它；`answerWritePaths()` 里也不存在含 `18` 的路径（写回口会 exit 2 拒收）。**不构成静默降级。**
- **但我必须补报一件他没点名的事**：用户答完这半句之后，三个驱动对「你年满 18 岁了吗」
  **仍然无条件答 Yes**——`greenhouse_apply_driver.mjs:718`（`{value:'Yes', note:'age_over_18'}`）、
  `lever_apply_driver.mjs:271`、`ashby_helpers.js:1220`。也就是说：**现在的状态不是「问了没处存」，
  是「问了没处存，而且下游正在替他答一个可能相反的答案」。** 属 DESIGN §10-C ③④ / B2 范围，本轮一行未碰，
  但 lead 并入 B2 时必须把 ③④ 和 ① 一起做，否则用户答「否」也照样被填成 Yes。

**⚠️4（D 项）— 人肉门房代跑的路径隔离**不成立，单列 §5.8。

### 5.6 🟡 设计/记录不一致（不影响功能）

| # | 内容 |
|---:|---|
| 🟡1 | BUILD §45.2 记 `apply_gap_report.mjs`「564 → 589 行」，**实测 593 行**（`8eb581c` 与 `a1ffd15` 均为 593）。数字小错，不影响 800 门禁结论 |
| 🟡2 | 施工员在 BUILD §53 第 2 条自报的已知偏差**确认存在**：note 路径对「他明确说不去的城市」（Singapore=false）判 `agent_profile_backed`，题面路径判 `system_profile_declined_location`。我实测两条路都跑了，两边确实不一致。他的处置（钉住现状 + 写明是已知偏差 + 不在本轮改）我认同 |
| 🟡3 | DESIGN §13.8 第 7 条字面写的是「应当一格不变」，实际 7 格变了。**这不是隐瞒**——他在 BUILD §52 偏离 ② 主动标了出来并请求重点复核。建议 lead 把 §13.8 第 7 条改成「除申报过的偏离外一格不变」，否则下一轮验收会拿一条已经作废的标准去卡人 |

### 5.7 ✅ 突变测试：10 处「改回旧写法」全部变红（老坑 6 的答案：没有假绿）

| # | 把什么改回去 | 结果 | 谁红了 |
|---:|---|---|---|
| M1 | `addPendingQuestion` 的 `\|\| !item?.selector` 守卫 | 🔴 fail 2 | 下拉框题进 pending + 端到端归类 |
| M2 | `:1142` 的 `if (sel)` 包裹 | 🔴 fail 2 | 同上 |
| M3 | `(题面, 选择器)` 去重键 | 🔴 fail 1 | 去重测试 |
| M4 | 把 `note: a.note` 换成 `note: null`（洞 1 回滚） | 🔴 fail 4 | note 通路 4 条全红 |
| M5 | 地点谓词回滚成 `nonEmpty(commitments)` | 🔴 fail 1 | 「答应了一个城市不等于答了另一个城市」 |
| M6 | 去掉大兜底上的 `driverFoundNoValue` 分支 | 🔴 fail 1 | 「档案是空的」压过「从档案填」 |
| M7 | 把 `ownNote` 换成带 `outcome.reason` 兜底的 `note`（**张冠李戴陷阱**） | 🔴 fail 1 | 「行级 reason 不许渗到无关字段」 |
| M8 | 去掉 `unknown_user_fact` 的 `categoryAnswered` 谓词 | 🔴 fail 1 | 闭环测试 |
| M9 | 去掉 `relocation_commitment_policy_unset` 精确表项 | 🔴 fail 1 | 搬迁政策题 |
| M10 | 偏离 ① 的「照字面做」版本 | 🔴 fail 3 | GPA 守卫 + 2 条前缀测试 |

**10/10 全红。本轮新增的 22 条测试里，抽查到的每一条都真的在测东西**（批次 A 抓到过的那种「名字对、断言对、
什么都没证明」的回滚测试，本轮没有出现）。M7 尤其重要——它是派遣单老坑 3 点名的陷阱，守卫是真的在守。

### 5.8 ⚠️ D 项独立核实：**`MRWEIRDO_HOME` 单独设，隔离不成立**（两个洞，一个致命）

**结论先说**：拿别人的简历代跑，**只设 `MRWEIRDO_HOME` 不够**。好消息是我没找到任何「漏回创始人
`~/.mrweirdo-jobs/`」的路径——全量 stat 快照 diff = 0 行，7205 条目前后完全一致，一个字节没动。
坏消息是隔离在另外两个方向上是破的。

**做了什么（实测，不是读代码）**：造一份「别人的简历」PDF，`MRWEIRDO_HOME=/tmp/concierge-verify-test`
真跑一遍到打分为止的链路——`intake_resume.sh` → 建档案 → `record_profile_answers`（写留痕）→
`secure_profile_files.sh` → `supervisor_preflight --json` → `dashboard` → `apply_batch --dry-run`。
跑前跑后各做一次真实家目录全量 `stat` 快照。

**✅ 落进沙箱、且权限正确的**：

```
-rw------- /tmp/concierge-verify-test/profile.json
-rw------- /tmp/concierge-verify-test/answer_provenance.json
-rw------- /tmp/concierge-verify-test/resume.pdf
-rw-r--r-- /tmp/concierge-verify-test/jobs.db      ← 600 没上（B3-a §13.4 尚未做，本轮不在范围）
```

数据库也自动跟着走（`dbPath() = MRWEIRDO_DB_PATH || join(atsHome(),'jobs.db')`），不用单独设。
求职信 / 截图 / materials 三处的路径也都从 `atsHome()` 派生（`cover_letter_materials.mjs:290`、
8 个 `-auto` 技能说明书里的 `$MRWEIRDO_HOME/log/screenshots`），代跑时会一起进沙箱。

**❌ 洞 1（数据漏出沙箱）：过程文件走的是另一个开关，默认落在共享的 `/tmp/mrweirdo-onboard`。**

```
只设 MRWEIRDO_HOME 时：
  atsHome()        = /tmp/concierge-verify-test     ✅ 跟着走
  dbPath()         = /tmp/concierge-verify-test/jobs.db  ✅ 跟着走
  onboardTmpDir()  = /tmp/mrweirdo-onboard          ❌ 纹丝不动
```

`shared/onboard_tmp.mjs` 的默认值是写死的 `/tmp/mrweirdo-onboard`，只认**另一个**环境变量
`MRWEIRDO_ONBOARD_TMP_DIR`——而这个变量**在全部技能说明书和脚本里一次都没有被设过**（grep 零命中）。
本机那个目录现在是 `drwxr-xr-x`、167 个条目、文件 `-rw-r--r--`，全是创始人自己的历史数据。

我那一次代跑真的往里面写了东西：`/tmp/mrweirdo-onboard/apply-batch-summary-<ts>.json`，
内容里带着**代跑对象的工作身份状态**（`missing_paths` / `blocked_because` / 整段门输出）。
（我把自己造的那几个文件删掉了，该目录已复原，diff = 0。）

会落进这个共享目录的还有——按代码里的调用点数：`to_score.json` / `scored.json`（候选岗位）、
`apply-result-<rowId>.jsonl`（**当时在表单上填了什么**）、`apply-gap-report.json`（**这个人哪些个人问题没答**）、
`queue-review-*.html` / `readiness-plan-*.html`、`manual_or_unsupported.json`、`discovery_funnel.json`。
**除了隐私，还有一个正确性风险**：`store_scored_jobs.mjs` 默认就从这个目录读 `to_score.json` / `scored.json`
——下一次运行（哪怕是创始人自己的）可能读到上一个人留下的文件。

**❌ 洞 2（更致命，且与代码无关）：环境变量不跨 Bash 调用存活。**
我实测过：一次调用里 `export MRWEIRDO_HOME=/tmp/...`，**下一次调用里它是空的**，
`atsHome()` 当场回落到 `/Users/lee/.mrweirdo-jobs`。而所有技能说明书里的 bash 块写的都是
`export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"`——**继承得到就用，继承不到就静默用创始人自己的家**。
在 Claude Code / Codex 这种「每个 bash 块一个新 shell」的环境里，**只要有一个块没被前缀到，
别人的简历就写进创始人自己的 `~/.mrweirdo-jobs/` 了，而且不会有任何提示。**

**要补什么（三选一，按可靠性排序）**：

1. **[最可靠，代码 1 行]** 把 `onboard_tmp.mjs` 的默认值从 `/tmp/mrweirdo-onboard` 改成
   `join(atsHome(), 'run-tmp')`——一个开关管全部，顺带消灭跨人串档。
   （我**没有动**：它改的是运行期路径、会牵动现有测试与既有 `/tmp` 数据，超出 Quinn 的 1-3 行界，交 lead 派工。）
2. **[不改代码也能做]** 代跑期间把两个变量都设成会话级环境变量（不是在某个 bash 块里 export）：
   `MRWEIRDO_HOME=/tmp/concierge-<代号>` **和** `MRWEIRDO_ONBOARD_TMP_DIR=/tmp/concierge-<代号>/run-tmp`。
3. **[最省事但有后患]** 写进 shell profile——**不建议**：创始人下次跑自己的求职时会忘了删，
   自己的数据会静默流进代跑目录，方向反过来了。

**另外两条给拍板人的提醒**：① 代跑目录里 `jobs.db` 是 644（`profile.json` / 简历 / 留痕是 600），
别人的岗位与投递记录是同机可读的——B3-a（§13.4 写入侧统一上锁）做完才补上；
② 本次 pm 提的方案「只跑到打分为止」在路径上是安全的（不碰浏览器、不碰 `chrome-profile`），
真正的风险全在上面两个洞，**与跑多远无关**。

### 5.9 未覆盖（说明理由）

| 项 | 为什么不做 |
|---|---|
| DESIGN §13.8 第 4/5/6 条（上锁 / 留证 / 出厂模板守卫） | 派遣单明确只验第 1/2/3/7/8 条；B3-a / B3-b 本轮一行未碰（我核过 diff，确实零改动） |
| Lever 平台的编造（DESIGN §13.6） | 需 lead 拍板是否纳入，本轮未纳入；我只确认了 `lever_apply_driver.mjs:265/271` 仍在无条件答 Yes（⚠️3 顺带报出） |
| 真实浏览器 / 真实投递 | 派遣单硬边界禁止 |
| 覆盖率百分比复核 | 本轮两个主改动文件（`apply_gap_report.mjs` CLI、`ashby_apply_driver.mjs` 替身加载）本来就不进进程内统计，重算一遍百分比不能证明任何东西；我用 **10 次突变测试**替代——它比覆盖率数字更能回答「测试有没有在测东西」 |

---

## §6 Quinn 主动重构记录

**本轮零重构，一行未改。** 扫到的三处候选全部超界，逐条说明为什么没动手：

| 候选 | 为什么不动 |
|---|---|
| `onboard_tmp.mjs` 默认值改成 `join(atsHome(),'run-tmp')` | 1 行，但改的是**运行期路径**、会牵动现有 `/tmp/mrweirdo-onboard` 的既有数据与多个默认参数 → 属业务行为改动，超 Quinn 界，转 lead 派工（§5.8） |
| `unknown_user_fact` 谓词细粒度化（❌1 的修法） | 涉业务逻辑 + 必须配闭环测试，超界，转 lead 派工 |
| BUILD §45.2 的行数笔误（589 → 593） | 是别人的施工档案，不归我改（🟡1 报告即可） |

---

## §7 质量 3 指标

| 指标 | 数字 | 说明 |
|---|---|---|
| 覆盖率 | 不重报 | 见 §5.9 最后一行：本轮用 10 次突变测试替代覆盖率数字，因为两个主改动文件本来就不进进程内统计 |
| **漏检率自报** | `verify_self_miss_rate: 12.5%` | 本轮 8 个问题（1 真 bug + 4 风险 + 3 不一致）里，**1 个**属于上一轮该发现而没发现的：`CATEGORY_ANSWERED` 那一族谓词「粒度过粗」是批次 A 引入的，上轮 §8 老坑核查没点出来；本轮 ❌1 与偏离 ② 都是它的后果。1/8 = 12.5% |
| 真 bug 数 | **1**（P2） | 见 §5.4 |

---

## §8 老坑清单核查（派遣单给的 6 条，逐条）

| # | 老坑 | 结论 | 证据 |
|---:|---|---|---|
| 1 | 三态字段绝不允许用真假判断读 | ✅ **未复发** | 把本轮新增的**全部** `\|\|` 与三元表达式抓出来逐条看（8 处），没有一处把 `false` 与 `null` 一起吃掉：门用 `typeof !== 'boolean'`、身份模块用 `answered()`（`!== undefined && !== null`，`false` 算已答）、`a.note \|\| null` 与 `sel?.sel \|\| null` 作用于字符串 |
| 2 | `categoryAnswered` 谓词是否仍生效 | ✅ **仍生效**，但**粒度有问题**（→ ❌1） | M8 突变（去掉 `unknown_user_fact` 谓词）当场红；地点闭环实跑「答完 Denver 就不再问」通过。**但**粗粒度让它在真实用户身上恒真，见 §5.4 |
| 3 | 只读 `field.note`、不许读 `outcome.reason` 兜底 | ✅ **纪律守住了** | 源码确认 `driverFoundNoValue` 读的是 `ownNote`；M7 突变改成读带兜底的 `note` → 「行级 reason 不许渗到无关字段」当场红 |
| 4 | 净增 0 硬约束 | ✅ **成立** | 我自己 `wc -l`：`ashby_apply_driver.mjs` 旧树 **1170** → 新树 **1170**，一行不多 |
| 5 | 测试是否喂了「不像我」的档案 | ✅ **五种全覆盖** | 公民/绿卡 · F-1 有 CPT/OPT · F-1 没批下来 · 说不清楚 · 其他签证，五支各有落盘断言；外加 7 种非法输入断言 throw。**唯一遗漏**：没有一份「`custom_facts` 为空的新用户」档案跑前缀规则——这正是 ❌1 溜过去的原因 |
| 6 | 有没有假绿 | ✅ **没有** | 10 次突变全红（§5.7），远超「抽查 2 条」的要求 |

**外加 `PROJECT_MEMORY.md` 五条长期原则**：① 红线落成代码断言 ✅（门是代码、真值表是代码+测试）；
② 三态不用真假判断读 ✅；③ 喂「不像我」的档案 ✅（一处遗漏见上）；④ 填了什么要留痕 ✅（`answer_provenance` 接上了门）；
⑤ 双向扫编造 —— 本轮无新增出厂值，不适用；但 Lever 三行仍在编造（⚠️3），属 B2。

---

## §9 13 维深查

**N/A —— 本轮走日常模式**，未触发 `--strict` 条件（不改数据表结构、不动核心数据流的形状、不改认证、
不改关键提示词；B1 虽新增两个模块但都是纯函数、无 IO、边界清楚）。

---

## §10 覆盖度评估 + 质量分

### 10.1 CI 四步 —— 链上 4 个提交**各自单独干净检出**各跑一遍（`git worktree add --detach`）

| 提交 | 脏文件 | Unit tests | role_guard_smoke | public_alpha_gate | syntax |
|---|---:|---|---:|---:|---:|
| `8eb581c` (B0) | **0** | exit **0** | **0** | **0** | **0** |
| `66882ab` (B1) | **0** | exit **0** | **0** | **0** | **0** |
| `5e4f76a` (变更日志) | **0** | exit **0** | **0** | **0** | **0** |
| `a1ffd15` (tip) | **0** | **tests 212 / pass 212 / fail 0** → exit **0** | **0** | **0** | **0** |

主流程冒烟：干净检出上 `npm run demo:check` → **exit 0**。3 条 WARN 与本轮无关且可解释
（`skill_not_linked_workspace` = 临时检出没跑 setup.sh；`chrome_cdp_not_running` = 我没开浏览器；
`supervisor_preflight_not_clean` = 12 项里唯一 FAIL 是 cdp，`work_authorization_answered` 对真实档案 **ok=true**，门直接放行）。

### 10.2 DESIGN §13.8 本轮适用 5 条

| 条 | 结论 |
|---|---|
| 1 对号入座真值表 20 格 | ✅ **达标**（内存 20/20 + 落盘逐格 `typeof` 确认 null 而非 false/""） |
| 2 「说不清楚」不死锁 4 个子条件 | ✅ **达标**（全流程真跑；⚠️2 指出「没留原话」这一支 ④ 不成立，属边角） |
| 3 Ashby note 通路 + 下拉框形态 | ✅ **达标**（用出货源码那一行本身跑，8 组探针 note 全对、selector=null 仍进 pending） |
| 7 现有真实用户逐格零变化 | 🟡 **95 格 88 格一致，7 格变了**，全在地点族、方向为好、且是**申报过的**偏离 ②。字面不达标，实质通过（→ 🟡3 建议改标准措辞） |
| 8 CI 四步 + demo:check + 逐提交检出 | ✅ **达标**（4 个提交全绿，全部跑在干净 detached 检出上） |

### 10.3 派遣单四块交卷

**A** ✅ 5 条逐条验完；**B** ✅ 3 处偏离逐条独立复核（① 复现红成功、② 不是迁就代码、③ 未构成静默降级但补报了下游仍在答 Yes）；
**C** ✅ 6 条老坑逐条查完（无复发，但第 2 条暴露出 ❌1）；**D** ✅ 实测完成，隔离**不成立**，漏在哪、补什么已写清。

### 10.4 边界与零写入证据

```
开工快照  find ~/.mrweirdo-jobs -exec stat -f '%N|%z|%m|%Sp' → 7205 条目
收工快照  同一条命令                                          → 7205 条目
diff                                                          → 0 行
```
（其间跑过：4 棵树 × CI 四步、`demo:check`、10 次突变的 npm test、约 220 次 `apply_gap_report` 真跑、
1 次完整的人肉门房代跑。）5 棵临时工作树已全部 `worktree remove`，主仓 `git status` 与开工时一致，
`origin/main` 仍是 `8f9e546`、本地 ahead 4，未 push、未碰 `batchA-backup`。

### 质量分：**4 / 5**（4-5 = 放行）

**给 4 的理由（三条硬证据，不是印象分）**：

1. **§13.8 本轮适用的 5 条，实质全部达标**，唯一「不达标」的第 7 条是被主动申报的偏离，且方向是变好的。
2. **测试是真的**：10 次突变全红。这是本轮最有说服力的一项——批次 A 抓到过「名字对、断言对、什么都没证明」
   的回滚测试，本轮没有；连派遣单点名的张冠李戴陷阱（老坑 3）都有真守卫。
3. **三处偏离的论证经得起独立复核**：我把偏离 ① 的红自己写回去看它红了；偏离 ② 我搭了比他大 50% 的矩阵重跑，
   还从旧代码里挖出一处他自己都没说的**自相矛盾**（同一道题带上「档案里没有」的 note 之后反而判「档案里有」）
   ——这条反而**加强**了他的判断。**他没有为了让自己的改动过关而放宽任何一条该守的线。**

**没给 5 的理由（一条）**：❌1 —— B0 附加交付的那半件事，在唯一的真实用户身上一次都没启动过，
而且原因正是他自己在同一个提交里已经修好过一次的那类粗粒度谓词。这不是回归，但它是本项目老坑的同款形状
（**看起来修好了、行为没变**），必须补上才算 B0 交完。

**放行建议（4 分 = 可以合入，但带三件必做，按优先级）**：

1. **[必做，建议并入 B2 第一件]** 修 ❌1：`unknown_user_fact` 的谓词细粒度化，配一条闭环测试。
   不修则 B0 的前缀规则对现有用户等于没做。
2. **[必做，安全项]** D 项的两个洞：改 `onboard_tmp.mjs` 默认值（1 行）+ 给「人肉门房代跑」写一份
   带两个环境变量的固定操作卡。**在这之前不建议拿别人的简历在创始人机器上代跑**——不是因为会漏进
   `~/.mrweirdo-jobs/`（实测不会），而是因为过程文件会落进共享 `/tmp` 目录、且只要有一个 bash 块漏了前缀就前功尽弃。
3. **[请拍板]** ⚠️1：`f1_without_permission`（F-1 还没批下来）这一类用户，产品是永远拦着他，
   还是给一条别的路。这是产品取舍，不是工程能定的；也建议 lead 顺便把 ⚠️3 的三行「无条件答 Yes」
   与 §10-C 的 ①③④ 一起排进 B2，否则「问了满 18 岁」这半句现在是纯负收益。

---

## 试过的错误方向（第 2 轮，Iterations=3）

**❌ 方向 1：偏离 ② 的复核，一开始打算直接沿用 `categoryOf(report, label)` 这个现成助手取「这道题归到哪一类」。**
它就在 `test/helpers.mjs` 里，两行就能用上，而且施工员的 60 格对照表用的也是它。
**否决理由（自己撞出来的）**：它只返回**第一个**命中的类目。而一份真实结果文件会把同一道题
同时放进 `pending` 和 `still_missing` 两个数组，`collectFields` 会各推一次——同一个题面因此可能
**同时**落在 `user_questions` 和 `agent_actions` 两个桶里。我第一版矩阵跑出来 6 格差异，
其中「Denver + `location_not_in_profile_preferences`」的 BEFORE 显示成 `unknown_user_fact`，
与我读代码推出来的 `agent_profile_backed` 对不上——追下去才发现是助手把两个结果吃掉了一个。
改成「返回全部命中类目并排序比对」之后，差异从 6 格变成 7 格，而且每一格的 BEFORE 都与源码推演一致。
**如果我信了第一版，会写出一份数字对不上、结论还碰巧差不多的报告。**
**顺带一条要报给 lead 的**：`test/helpers.mjs` 的 `categoryOf` 有这个「只取第一个」的盲点，
现有测试里用它做的断言在「同一题面进两个桶」的场景下证明力是打折的（本轮不改，只报告）。

**❌ 方向 2：把「偏离 ② 收紧了谓词 → 恰好让他新加的 note 更容易过」直接判成「改判定迁就代码」。**
形式上完全符合嫌疑：他为了自己新加的 `relocation_commitment_policy_unset` 能走到「问用户」，
去动了另一个函数的判定。批次 A 有过同款嫌疑，我一度准备照那个模板落判。
**失败原因**：判「迁就」的标准不是「改了判定之后自己的东西过了」，而是**「改完之后那条线是更松还是更严」**。
我把两个谓词的取值集合摆出来一比——`locationCommitment !== null` 是 `nonEmpty(commitments)` 的**真子集**，
**严格更窄**。迁就的形状是放宽，不是收紧。真正把这条嫌疑钉死的是第二步实测：
旧代码在**同一道题、同一份档案**上，不带 note 判「问用户」、带上「档案里没有这个地点」的 note 反而判「档案里有」
——**旧代码本身就是矛盾的**，他做的是把两条路统一，统一后的结果与旧代码里那条正确的路逐字一致。
**教训：查「迁就」要比较判定的松紧集合，不能只看谁受益。**

**❌ 方向 3：D 项打算只读 `shared/paths.mjs` 和几个调用点，确认都走 `atsHome()` 就下结论「隔离成立」。**
pm 就是这么做的（只读了 `paths.mjs:37`），而且读代码的结论看起来很硬：39 个文件都 import `atsHome()`。
**失败原因**：真跑了一遍才发现，会写盘的不止 `atsHome()` 这一条路径来源。
`shared/onboard_tmp.mjs` 是**第二个**独立的路径来源、有**自己的**环境变量、默认值写死在 `/tmp`，
而它在 grep `atsHome` 的结果里根本不会出现。更要命的是第二个发现——**环境变量不跨 bash 调用存活**——
这一条读多少代码都读不出来，只能实测。**这正是派遣单要求「不许只读代码下结论」的原因，事实证明这条要求是对的。**

---
---

# 验收报告（第 3 轮）— Round 35（`ce48d4f` → `210cd7a` → `229fd1b` → `a4a865e`）

| 项 | 值 |
|---|---|
| Status | done_pending_review |
| Owner | arnold-verify |
| Mode | daily +（A 项按不可逆动作取证标准做，等同 strict） |
| Iterations | 4 |
| Updated | 2026-07-26 |
| **质量分** | **3 / 5（回炉）** |

Reads_round3: 任务档案 `docs/active/2026-07-23_product-blueprint_TASK.md`、本报告第 2 轮章节、
施工记录 `docs/active/2026-07-23_product-blueprint_BUILD.md` 第 55-63 节、
操作卡 `docs/active/2026-07-26_concierge-run_RUNBOOK.md`、登记表 `PROJECT_CONTEXT.yaml`、
代码 `shared/paths.mjs`、`shared/onboard_tmp.mjs`、`shared/missing_field_questions.mjs`、
`shared/apply_gap_report.mjs`、`shared/store_scored_jobs.mjs`、`shared/local_db.mjs`、`shared/discover_candidates.mjs`、
`shared/ashby_apply_driver.mjs`、`shared/greenhouse_apply_driver.mjs`、`scripts/concierge_guard.sh`、
`scripts/intake_resume.sh`、`scripts/preflight.sh`、测试 `test/concierge_isolation.test.mjs`、
说明书 `.claude/skills/mrweirdo-onboard/SKILL.md` 与 `references/run-and-database.md`、
流水线 `.github/workflows/ci.yml`、真实档案 `~/.mrweirdo-jobs/profile.json`（只读）

> **本轮对创始人真实资产的处置**：`~/.mrweirdo-jobs/` 全程**只读**，跑前跑后 `stat` 快照
> **7205 条目、零行差异**（见下文 F4 一节）。`/tmp/mrweirdo-onboard` **一个文件都没删**（硬边界）；
> 我自己在跑流水线复验时**往里漏进 4 个文件**，按边界**没有删**，文件名逐条列在下文 A4 一节交拍板人处置。
> 未 push、未动远端、未真投递、未开浏览器、未改任务档案。产品代码**一行未改**（Quinn 本轮零重构）。

---

## 一、验收范围（第 3 轮）

派遣单 A–G 七项。核心两件：件一「`unknown_user_fact`（说不清是什么事实的兜底桶）谓词细粒度化 +
报告公布 `profile_key`（答案该写回哪个键）」，件二「过程文件跟着家走 + 勿入纸条守卫 + 说明书去硬编码」。
外加操作卡实走、老坑回归、三条待拍板的技术判断。

**方法**：全部实测，零处「读代码即下结论」。真实档案对照用**我自己重建的探针**（20 题面 × 2 形态 = 40 格），
**没有引用施工记录的 40 / 14 那两个数字**；跑完才去对表。

---

## 二、5 维高危区评估（**测试前**先做，用来定测试密度）

| 维 | 本轮命中面 | 密度 |
|---|---|---|
| ① 核心业务逻辑 | `classifyField`（判定这一题该问谁）——**判错的方向决定「白问一次」还是「一行永远投不出去」** | **最高**：40 格对照 + 闭环三步实验 + 11 个真实事实逐条探 |
| ② 安全边界 | 别人的简历 / 表单答案会不会落进创始人的家；沙箱文件权限 | **最高**：4 个入口 × 有无开关 × 有无纸条，全实跑 |
| ③ 性能 | 本轮零外部调用、零连接池、零大文件 | 不适用 |
| ④ 集成点 | 说明书 20 多处硬编码路径 ↔ 代码默认值必须首尾一致 | 高：全仓库 grep（逐字文本搜索）+ 手动串「打分 → 入库 → 缺口」 |
| ⑤ 用户体验主流程 | 操作卡是**给不懂编程的人**用的，卡跑不通 = 这一轮白做 | **最高**：当拍板人从头走一遍，含故意制造污染 |

**结论：两个最高危区各出一处必须回炉的问题**（真 bug 一号在 ①，真 bug 二号在 ⑤）。

---

## 三、7 类测试技术覆盖

| # | 技术 | 用了几次 / 不适用理由 |
|---:|---|---|
| 1 | 等价类划分 | **3**：题面分「白名单正则命中 / 兜底落底 / 走 note 表」三类；已答事实的值分 `有值 / false / 空串 / 缺键` |
| 2 | 边界值 | **2**：`false` 对 空串 对 `null`（三态）；空题面 → 空键会不会答上所有题 |
| 3 | 决策表 | **1**：〈纸条有/无〉×〈开关有/无〉×〈node 入口 / shell 入口〉= 8 格全跑 |
| 4 | 状态迁移 | **1**：代跑生命周期 贴纸条 → 跑 → 核对 → 撕纸条 → 创始人自用，**含异常迁移「忘撕纸条」** |
| 5 | 用例测试 | **2**：操作卡端到端实走；「打分 → 入库 → 缺口报告」手动串链 |
| 6 | pairwise（两两组合） | **1**：4 个真实入口 × 2 种开关状态 |
| 7 | 风险驱动 | 贯穿：密度按第二节分配 |

---

## 四、5 轮回归循环记录

| 轮 | 做了什么 | 结果 |
|---:|---|---|
| ① | 先按最坏意图设计场景，不看施工记录的结论 | 独立探针 `vprobe4.mjs` 成型 |
| ② | 4 个提交各自 `git worktree add --detach`（干净检出）跑流水线四步 | **全绿**（见下文 F3） |
| ③ | 红了辨析 | 无红；转而用 **5 次突变**验「测试是不是真在测」（见下文 F2） |
| ④ | 闭环三步实验（问 → 按公布的键答 → 再问） | **查出真 bug 一号**：兜底那一类答完还问 |
| ⑤ | 还红 → 转 bug 成员 | 两个真 bug **都不在 Quinn 界内**（涉业务逻辑 + 跨文件），转 lead 派工，未自行修改 |

---

## 五、结论明细（第 3 轮）

### A. 🔴 不可逆动作核实：`/tmp/mrweirdo-onboard` 有没有丢过创始人的东西

**结论：可以排除。没有任何一个创始人的历史文件被删除——而且更进一步，那个目录里从来就没有过创始人的求职历史。**

**A1. 现在到底是什么（实证）**

```
条目数        165（ls -1A | wc -l 数出来的，不是目录链接数）
文件类型      165 / 165 全部是 apply-batch-summary-<时间戳毫秒>.json，无任何其他文件
目录出生时刻  btime = 2026-07-22 21:29:23  ← 与最老的那个文件同秒
内容          164 份是流水线夹具（"company":"Batch Co" / row_id 9 / dry_run:true）
              1 份（1784996791189，7-25 12:26）含 18 家真实公司，仍然 dry_run:true
所有 165 份的 rows 里带 result_file 的条数 = 0
```

→ 这个目录**诞生于 7-22 21:29**（Arnold 小队进场那天的第一次批量投递演练），
里面**没有一个字节**是创始人 6 月真实求职期的数据；**没有一次真实投递**（全是 `dry_run:true` 空跑）。
第 2 轮我写的那句「**全是创始人自己的历史数据**」是**我自己的过度断言，本轮据实推翻**（计入漏检率）。

**A2. 有没有文件被删（四路交叉验证，全部指向「没有」）**

| 证据 | 结论 |
|---|---|
| **文件名自带时间戳 对比 实际修改时间**：165 / 165 **偏差为 0 秒** | 无改名、无回填时间戳、无伪造 |
| **成对结构**：按 3 秒内聚类 → **82 个完整对 + 1 个单份**（正是那份唯一的真实数据单跑）。**零个残缺半对** | 流水线第 2 步每跑一次落 2 份；若从历史里删过任意单份，必留下一个孤儿半对——一个都没有 |
| **施工侧留下的三份磁盘快照**（临时目录里的 `d_tmp_before/after/final.txt`，18:00 采）：before **165 行** → 跑一次流水线第 2 步 **168 行**（多出的 3 份文件名全是 18:00:15–18:00:18 生成的）→ final **165 行，与 before 逐字节相同** | 删掉的**恰好是几分钟前刚漏进去的那几份**，一个历史文件没碰 |
| **我现在的清单 对比 上述 5 份快照全部逐字节相同** | 18:00 → 18:53 之间也没少任何东西 |

**A3. 那 2 个差额的确切来源：不是删除，是我第 2 轮把「目录链接数」当成了「条目数」。**

第 2 轮原话是「本机那个目录现在是 `drwxr-xr-x`、**167 个条目**」——`drwxr-xr-x` 紧挨着 167，
这就是 `ls -la` 头一行的格式，**第二列是目录链接数，不是文件数**。本机文件系统上目录链接数 = 文件数 + 2，
我当场做了对照实验固定这条：

```
建一个空目录放 10 个文件 → ls -lad 显示 12
删掉 2 个（剩 8 个）      → ls -lad 显示 10
```

所以第 2 轮那一刻的真实文件数就是 **165**，与今天完全一致。**167 与 165 从头到尾没有冲突，是我读错了一列。**
（施工记录里那组 `165 → 167 → 165` 用的是真实文件数，逻辑自洽；只是他文中「我漏进去 4 个」与
自己快照里的 3 个对不上——**数字口述不精确，实质无误**，见下文不一致清单第 1 条。）

**A4. 我自己往那个目录里漏进去的 4 份（按硬边界**未删除**，请拍板人决定）**

```
apply-batch-summary-1785106956608.json   2026-07-26 19:02:36
apply-batch-summary-1785106957985.json   2026-07-26 19:02:37
apply-batch-summary-1785107035827.json   2026-07-26 19:03:55
apply-batch-summary-1785107037145.json   2026-07-26 19:03:57
```

来源已定位到**具体提交**（见下文 D4 的泄漏归因表）：它们全部由在**改动前的检出 `ce48d4f`** 上跑
流水线第 2 步产生；`210cd7a` 与 `a4a865e` 上跑同一步**零泄漏**。内容是测试夹具，无任何人的真实信息。

---

### B. 🔴 「不静默回落」守卫：破不掉，但有一个真实的反向风险

**B1. 纸条在、某个 bash 块漏了前缀 → ✅ 真的当场报错，没有静默写入。**
用假家目录实跑 4 个真实入口，全部拒绝：

```
node shared/apply_supervisor.mjs --dry-run     → 抛错，非零退出
node shared/supervisor_preflight.mjs --json    → 抛错
node shared/apply_batch.mjs --dry-run          → 抛错
node shared/apply_gap_report.mjs               → 抛错
bash scripts/preflight.sh                      → 退出码 3
```

判据本身也验了：说明书写的是 `${VAR:-default}`（取不到就用默认值），**变量永远是设上的**，
所以「看变量有没有设」必然失效；守卫看的是**解析后的家**，这是对的。

**B2. `intake_resume.sh` 走 `cp` 不经 Node → ✅ 独立验过，拦住了。**

```
$ HOME=<假家> bash scripts/intake_resume.sh <假简历>
[mrweirdo] refusing to use <假家>/.mrweirdo-jobs: a concierge run is in progress...
退出码 3
$ ls <假家>/.mrweirdo-jobs/        # 只有纸条本身，简历没有被拷进去
```

**B3. 纸条被误删 / 忘了放 → ⚠️ 守卫失效是 100% 静默的。**
全仓库只有 `paths.mjs` 与 `concierge_guard.sh` 两处读这个文件名，**没有任何一处正着校验「纸条应该在」**。
漏做操作卡第 1 步 = 整场代跑零防护、零提示，退回到第 2 轮报的那个洞。
（操作卡第 1 步末尾的 `cat` 回显是唯一的人肉确认，一旦跳过就没了。）

**B4. 纸条忘了撕 → ⚠️⚠️ 这是最可能真实发生的失败，而报错会把拍板人指向错误的方向。**
守卫**确实**把创始人自己挡在门外（这是设计意图，对的），但他看到的是这个：

```
file:///Users/lee/Projects/mrweirdo-jobs/shared/paths.mjs:51
  throw new Error(
        ^
Error: refusing to use /Users/lee/.mrweirdo-jobs: a concierge run is in progress, ...
This run belongs in: /tmp/concierge-s1
Re-run the command with both switches in front of it, e.g.
  MRWEIRDO_HOME=/tmp/concierge-s1 MRWEIRDO_ONBOARD_TMP_DIR=/tmp/concierge-s1/run-tmp node <script>
When the concierge run is finished, delete /Users/lee/.mrweirdo-jobs/.concierge_run_active.
```

三个问题，按严重度：
1. **主推的补救是错的**。操作卡第 6 步先删沙箱、再撕纸条；忘撕纸条时沙箱**已经不存在了**，
   而报错第 3–4 行让他「带着这两个开关重跑」——指向一个已删除的目录。**他该做的是撕纸条，那句在第 6 行。**
2. **全文英文**，而操作卡全文中文、拍板人不懂编程。
3. **Node 侧带整段调用栈**（`paths.mjs:51 / throw new Error( / ^`），在他眼里等于「程序崩了」。
   shell 侧（`[mrweirdo] ...`）反而干净——**两个入口体感不一致**。

**这一条不是「守卫破得掉」，是「守卫生效时人读不懂」**。修法很轻：把「删掉这张纸条」提到第一行并给出可复制的
`rm` 整句，中文一句话，Node 侧走 `console.error` + 非零退出而不是裸抛。

**B5. ⚠️ 两个绕过面（本轮范围外，但同一形状，先记上）**
- `shared/local_db.mjs:34` 的 `dbPath()` 是 `process.env.MRWEIRDO_DB_PATH || join(atsHome(),'jobs.db')`——
  显式设了那个数据库路径变量就**完全不经过** `atsHome()`，纸条管不着。目前无人设它，属潜在面。
- 说明书里 `> "$MRWEIRDO_HOME/run-tmp/xxx.json"` 这类**重定向发生在 node 启动之前**：
  漏前缀且创始人家里已有 `run-tmp/` 时，会先落一个 0 字节文件再被 node 拒绝。
  好在操作卡第 5 步①**能查出来**（实测见下文 E3）。

---

### C. ❌ 真 bug 一号（P2）：报告公布的 `profile_key` 对「兜底那一类问题」是一句做不到的承诺

**C1 ✅ 点名的三格确实翻过来了（我自己重跑的，未引用施工记录）**

用 `git worktree` 检出改动前的 `a1ffd15`，真实档案只读复制进沙箱，同一批探针喂给两棵树：

| 题面（带「这一格没值可填」的动态标记） | 改前 | 改后 | 公布的写回键 |
|---|---|---|---|
| Preferred name | `agent_profile_backed` | **`unknown_user_fact`** | `preferred_name` |
| Primary phone number | `agent_profile_backed` | **`unknown_user_fact`** | `primary_phone_number` |
| Expected graduation month | `agent_profile_backed` | **`unknown_user_fact`** | `expected_graduation_month` |

40 格里 **20 行发生变化**，全部落在「带标记」那一列；不带标记的一列**零变化**。与施工记录相符。

**C2 ✅ 反向守卫成立（没做成一律要问）**
- 不带标记的 20 格：全部仍是 `agent_profile_backed`
- 工作授权 / 平均绩点 / 平权问卷 / 开放问答：两棵树逐字一致
- **三态**：`previously_applied_to_this_company` 填 `false` → **`agent_profile_backed`**（「他说没有」是答案）；
  同一键改成空串 → `unknown_user_fact`。**`false` 与「没填」没有被一起吃掉**（项目长期原则第 2 条 ✅）

**C3 ❌ 闭环只在「白名单题面」上闭上；兜底那一类答完之后同一题照问不误。**

真跑三步（不是看单测）：

```
第一步 问 → 第二步 按报告公布的那条写回键写进档案 → 第三步 再问同一题

[A] Preferred name                               unknown_user_fact → agent_profile_backed  ✅ 闭上了
[B] Are you able to work from our Denver office? unknown_user_fact → unknown_user_fact     ❌ 照问
[C] Are you a US citizen?（档案里 us_citizen 早就答过 false）    unknown_user_fact          ❌ 照问
```

**根因**：新谓词只接了两处——标记表那条路，和白名单正则那条路。
`classifyField` 结尾那句**兜底** `return 'unknown_user_fact';`（在 `apply_gap_report.mjs` 里）**从不查这个谓词**。
而 `unknown_user_fact` 这个桶存在的意义**恰恰就是装没被白名单正则收编的题面**——**兜底那条路才是它的主入口**。

**代价有多大：拿他自己档案里 11 个已答事实逐条探**

| 题面 | 档案里已有的键 | 现在的判定 | 公布的写回键 |
|---|---|---|---|
| Are you a US citizen? | `us_citizen` = false | ❌ 还问 | `us_citizen`（**就是那个键，写了也没用**） |
| What is your current city? | `current_city` | ❌ 还问 | `current_city`（同上） |
| What is your permanent residence state? | `permanent_residence_state` | ❌ 还问 | `permanent_residence_state`（同上） |
| Rate your Excel proficiency | `excel_proficiency` | ❌ 还问 | `rate_your_excel_proficiency`（**还是另一个键**，会写出重复键） |
| Rate your Figma proficiency | `figma_proficiency` | ❌ 还问 | `rate_your_figma_proficiency` |
| Rate your Google Sheets proficiency | `google_sheets_proficiency` | ❌ 还问 | `rate_your_google_sheets_proficiency` |
| Do you live in the West End neighborhood? | `lives_in_west_end_neighborhood` | ❌ 还问 | `live_in_the_west_end_neighborhood` |
| Have you previously worked at Faraday Future? | — | ✅ 不问 | — |
| Is English your first language? | — | ✅ 不问 | — |

**他自己 11 个已答事实里，6 个仍然会被反复问；其中 3 个报告还会指导他写出一个重复的新键。**

**严重度 P2 / 命中维度 ①核心业务逻辑 + ⑤主流程体验。**
之所以不是 P3：报告的问题文案现在**明写了一句承诺**——
「写回 `standard_qa.custom_facts` 时，每一题都用它自己那条 `profile_key` 当键（换个键写＝下次还会问同一题）」，
反过来读就是「用这个键写就不会再问」。**对兜底那一类，这句话是假的**，而假绿 / 死循环正是本项目点名的老坑形状。

**复现步骤**（30 秒，无需真实档案）：
1. 造一个家目录，`profile.json` 里 `standard_qa.custom_facts` 放 `{"us_citizen": false}`
2. 造 `apply-result-1.jsonl`：`{"outcome":"blocked","job_id":1,"reason":"blocked_fields","blockers":[{"label":"Are you a US citizen?","note":"value_empty_for:x"}]}`
3. 跑 `MRWEIRDO_HOME=<家> node shared/apply_gap_report.mjs --result-dir <目录> --json`
4. 看 `run-tmp/apply-gap-report.json` → 仍是 `unknown_user_fact`，写回键仍是 `us_citizen`

**修法（1 行，我没有动手——涉业务判定，超 Quinn 界）**：`apply_gap_report.mjs` 结尾的
`return 'unknown_user_fact';` 改成 `return noValueCategory();`。
**我替 bug 成员先验过一件事**：把这行改掉之后 **224 / 224 全绿**（见下文 F2 的 M-e）——
说明①没有任何现存测试把这个错误行为钉死；②也**没有任何测试覆盖这条路**，这正是它漏出去的原因，
所以修的时候必须**先补一条会红的测试**（兜底题面 + 键已答 → 期望 `agent_profile_backed`）。

**C4 ⚖️ 那处未经授权的自主扩范围（公布写回键）：判「保留，但必须补齐 + 收窄措辞」，不回退。**

| 问 | 判断 | 依据 |
|---|---|---|
| ① 理由是否成立（不做会不会真假绿） | **成立** | 闭环实验 [A] 证明：`Preferred name` 之所以能闭上，**唯一原因**就是报告公布了 `preferred_name` 而写回用了同一个键。不公布 → 键由模型每轮自创 → 单测里绿、真人那边永远绿不了。这正是**不做就是静默降级**的形状 |
| ② 有没有把不该外泄的带出去 | **没有** | `customFactKey(label)` 是**纯函数、只吃题面**，不读档案任何值。而题面本身在同一份报告里本来就逐字打印在旁边。**新增字段携带的信息量为零增量**，不含姓名 / 电话 / 身份 / 任何档案值。落盘位置也没变（`run-tmp/apply-gap-report.json` 与同名 `.md`，随家走） |
| ③ 算不算范围蔓延 | **不算，是必要收尾** | 派遣单要的是「谓词细粒度化」；不配一个稳定的写回键，细粒度化本身**是一个跑不起来的半成品** |
| **结论** | **保留** | 但它现在**兑现不了自己写在问题文案里的承诺**（见 C3）。回退会让白名单那一半也一起废掉，方向错。**正确处置 = 保留字段 + 修 1 行兜底 + 补一条会红的测试**；在修好之前，问题文案那句「换个键写＝下次还会问同一题」**应当收窄**，别对兜底类题面许下做不到的保证 |

---

### D. ✅ 兼容性：20 多处硬编码替换**一处不漏**，且「不留回退读」的代价被高估了

**D1 ✅ 全仓库逐字搜索，出货面零残留。**
`/tmp/mrweirdo-onboard` 在**代码与技能说明书里已经没有任何可执行引用**，剩下的命中全部是：
变更日志（历史条目）、`shared/onboard_tmp.mjs` 与 `test/concierge_isolation.test.mjs` 的**注释**、
文档目录（本轮及历史文档）、操作卡第 5 步②那条**故意保留的巡检命令**，以及
`.claude/settings.json:24`（builder 报的待拍板第 1 条）。
反查也做了：搜 `run-tmp` 的结果里**没有一条**不是从 `$MRWEIRDO_HOME` / 那个过程文件目录变量 /
`onboardTmpDir()` / `atsHome()` 派生的。**没有「写新目录、读旧目录」的半断风险。**

**D2 ✅ 手动串一次「打分 → 入库 → 缺口报告」，首尾同一个目录。**
（发现步骤要联网，按硬边界不跑；改为核 `discover_candidates.mjs:423-425` 的三个输出全部由 `outputDir` 派生，
默认即 `onboardTmpDir()`，并从它的下游 `to_score.json` 接上真跑）

```
沙箱家 = <临时目录>/chainhome
  run-tmp/to_score.json + scored.json  →  store_scored_jobs  →  stored=1，行落进 chainhome/jobs.db
  apply-result-1.jsonl                 →  apply_gap_report   →  chainhome/run-tmp/apply-gap-report.json 与 .md
跑完：~/.mrweirdo-jobs/run-tmp  不存在（创始人家零新建）
      /tmp/mrweirdo-onboard     仍 165
```

顺带验到一条好东西：入库前那道「拒绝存半份打分」的闸是**响的**——我第一次喂的假数据分数不完整，
它明确返回失败并点名了两个文件的完整路径，**不是静默存 0**。

**D3 ✅ 「读不到旧目录」的代价约等于 0，比施工记录写的还小。**
施工记录担心的是升级当天的半程运行读不到 `to_score.json` / `scored.json` / 历史 `apply-result-*.jsonl`。
实测那个目录里：**这三类文件一个都没有**（165 份全是批次摘要），而且
**165 份摘要的 rows 里带 `result_file` 的条数 = 0** —— 就算真去读，也读不出任何东西。
**所以不留回退读，一分钱代价都没有**，方向判断正确。

**D4 ⚠️ 流水线泄漏的归因（可复现，且证明修好了）**

| 检出 | 跑一次流水线第 2 步 | 泄漏到 `/tmp/mrweirdo-onboard` |
|---|---|---:|
| `ce48d4f`（件一，隔离修之前） | ✔ | **+2** |
| `210cd7a`（件二，隔离修之后） | ✔ | **0** |
| `a4a865e`（最新提交） | ✔ | **0** |

**修复被独立复现了。** 我漏进去的 4 份全部来自 `ce48d4f` 那两次。

**D5 ⚠️ 同一形状的两处漏点，本轮范围外但没人提过（新发现）**

```
shared/ashby_apply_driver.mjs:1083       cdp('screenshot', tab, `/tmp/mrw_post_${JOB_ID}.png`)
shared/greenhouse_apply_driver.mjs:1834  cdp('screenshot', tab, `/tmp/mrw_gh_post_${JOB_ID}.png`)
```

**提交成功后**给整页表单截图，**写死在共享的 `/tmp`、不随家走、不受纸条管**——代跑场景下这是
「别人填好的投递表单整页截图落在全机可读的公共目录」。目前**不影响本轮**（操作卡明令跑到打分为止就停），
但它是第 2 轮那个洞的**同一形状、下一步**，建议与真投递解禁一起排。

---

### E. ❌ 真 bug 二号（P2）：操作卡拍板人**照着跑不通**——第 3 步就断

我按派遣单要求当了一次拍板人：**假家目录、假简历，全程没碰创始人真实家目录**。

**E1 ❌ 命令不能原样复制粘贴——卡上零处告诉他要先进到仓库目录。**
他打开「终端」，落脚点是自己的用户文件夹。照着卡敲：

```
$ bash scripts/intake_resume.sh ~/Desktop/他的简历.pdf
bash: scripts/intake_resume.sh: No such file or directory

$ node shared/apply_supervisor.mjs --dry-run
node:internal/modules/cjs/loader:1413  throw err;   （整段调用栈）
```

在操作卡里搜「cd」「仓库」「仓库根目录路径」——**命中 0**。
第 3 步和第 4 步的两条命令都是相对路径，**卡上从头到尾没有一句话说这个产品的代码在哪个文件夹**。
对「不需要懂编程、整段复制回车」这个明写的承诺来说，**这是卡本身的失效点，不是使用者的问题**。
修法一行：第 2 步那段里补一句 `cd /Users/lee/Projects/mrweirdo-jobs`（连同两个开关一起，同一段复制）。

**E2 ✅ 漏设开关会被拦住（独立验证，与施工自述一致）**：`intake_resume.sh` **退出码 3**，简历**没有**被拷进假家目录。

**E3 ✅ 第 5 步那几条核对命令真的查得出污染——故意制造了一次。**

```
干净时  find ~/.mrweirdo-jobs -newer <纸条>   →  一行不打印（连纸条自己都不打印，与卡上写的一致）
故意在假家目录里塞一个 run-tmp/apply-gap-report.json 之后，同一条命令：
    <假家>/.mrweirdo-jobs
    <假家>/.mrweirdo-jobs/run-tmp
    <假家>/.mrweirdo-jobs/run-tmp/apply-gap-report.json      ← 三行，逐级点名，查得出
```

第 5 步②同样有效：我自己漏进公共目录的那 4 份，用同一条命令**当场被列出来**（活体验证）。

**E4 🟡 术语基本合格，两处小瑕。**
全卡**零内部代号**，用词是中文大白话 ✅。两处：
① 报错原文是英文（见 B4）；② 第 6 步的 `rm ~/Desktop/他的简历.pdf` 是个中文占位文件名，
实测**这一行会报「找不到文件」，但下一行照样打印「清理完成」**——
他会以为清理完了，而**别人的简历还留在他桌面上**。（隐私相关，修法：把这一行单独列成第 7 步并写清「换成你自己的文件名」。）

**E5 ✅ `jobs.db` 权限 644 这条限制如实写在卡上**（「现在还存在的限制」第 1 条），措辞诚实、没有粉饰。

---

### F. 老坑回归（逐条）

| # | 老坑 | 结论 | 证据 |
|---:|---|---|---|
| F1 | 三态字段绝不用真假判断读 | **✅ 通过** | 新代码显式写了「值是 `null` / `undefined` / 空串才算没答」——`false` 是答案。实测：同一题面 `false` → `agent_profile_backed`，空串 → `unknown_user_fact`。改动里其余的「取不到就用默认值」全是环境变量与文案兜底，不涉三态 |
| F2 | 有没有假绿 | **✅ 通过，5 次突变** | ↓ 见下表 |
| F3 | 流水线四步 × 4 提交，各自干净检出 | **✅ 全绿** | ↓ 见下表 |
| F4 | `~/.mrweirdo-jobs/` 跑前跑后快照 | **✅ 零写入** | 对全目录取「路径、大小、修改时间、权限」四元组排序后比对 → **7205 条目，0 行差异** |

**F2 突变测试（在最新提交的独立工作副本上做，做完还原）**

| 突变 | 结果 |
|---|---|
| M-a 把「这条事实答过没有」改成恒为真 | 🔴 **红 5 条** |
| M-b 把 `atsHome()` 里的守卫改成空操作 | 🔴 **红 2 条** |
| M-c 把 `concierge_guard.sh` 的退出码 3 改成 0 | 🔴 **红 1 条** |
| M-d 把过程文件默认目录改回公共的 `/tmp/mrweirdo-onboard` | 🔴 **红 1 条** |
| **M-e（我加的，用来验真 bug 一号）** 兜底那句改成查一次「答过没有」 | 🟢 **224 / 224 全绿** |

前 4 条各自单独变红 → **本轮新测试是真的在测东西，不是假绿**。
M-e 全绿 → **兜底那条路一条测试都没有**，这就是真 bug 一号漏出去的原因。

**F3 流水线四步 × 链上 4 个提交（全部独立干净检出，工作副本脏文件数均为 0）**

| 提交 | 单元测试 | 角色守卫冒烟 | 公测发布闸 | 语法检查 |
|---|---|---:|---:|---:|
| `ce48d4f` | **217 / 红 0** | 0 | 0 | 0 |
| `210cd7a` | **224 / 红 0** | 0 | 0 | 0 |
| `229fd1b` | **224 / 红 0** | 0 | 0 | 0 |
| `a4a865e` | **224 / 红 0** | 0 | 0 | 0 |

登记表里主流程那格已填 → 主流程冒烟**必跑**：本轮以上文 D2 的手动串链完成
（比 `demo:check` 更贴那句主流程描述；`demo:check` 已由施工侧与 lead 各跑过一次、退出码 0）。
结构升级路径 / 数据隔离字段两格仍为空 → 对应两条铁律**跳过**，本轮亦无数据表结构变更。

---

### G. 三条待拍板的技术判断（**不做决定**，供 lead 与拍板人参考）

**G1 权限配置里那条指向旧公共目录的读权限——影响小，但现在是一条「死权限」。**
过程文件搬家后，那条规则指向一个**不再有人写**的目录，等于常年空转；
而真正要读的新位置（家目录下的 `run-tmp/`）没有对应规则，代跑或自用时**会多一次授权弹窗**（不是报错，点一下即可）。
**更好的处置：替换而不是新增**——把它换成覆盖 `~/.mrweirdo-jobs/**` 读的规则。
两点提醒：① 代跑时家在 `/tmp/concierge-*`，那条规则**也盖不到**，弹窗照样会有（这其实是好事，等于多一次人工确认）；
② 这是拍板人自己的权限地盘，builder 不代改是对的。

**G2 `store_scored_jobs.mjs` 读不到输入文件返回空数组——⚠️ 是一处静默降级，而且是「非对称」的那种。**
实测两种情况：

```
文件在、分数不全   → 明确返回失败 + 指名两个文件的完整路径 + 教你怎么办     ✅ 响
文件根本不存在     → stored=0 eligible=0，无错误字段，退出码 0            ❌ 静默
                     而且「打分覆盖率」报的是 1（0 除以 0 算成「全打完了」）
```

**同一个脚本，一半会喊一半不喊**。「一条候选都没有」和「我没找到候选文件」在屏幕上长得一模一样，
而后者恰恰是升级 / 漏开关 / 路径写错时会发生的那一种。
**改成 Fail Fast（快速失败）的代价与风险**：代价很低——只需把「文件不存在」与「文件里是空数组」分开处理
（前者报错退出，后者照旧算 0 行合法）；风险是**从没跑过发现步骤的首次运行**会变成报错，
用一句「先跑发现步骤」的提示即可化解。「打分覆盖率」在分母为 0 时不该报 1，建议一并改成空值。
**我的判断：值得排，但不紧急**（属独立小改动，可以跟真 bug 一号的修复一起走一轮）。

**G3 `jobs.db` 权限 644 在代跑场景下——⚠️ 风险确实被放大了，但有一条不用等排期的一行解法。**
放大点不在权限位本身（还是 644），而在**位置**：操作卡让他在公共的 `/tmp` 下建沙箱，
当前掩码下目录是 `drwxr-xr-x`，而 `/tmp` 本身是所有人可进的。
于是**同一台机器上的任何其他账号都能读到代跑对象的岗位与投递记录**；
相比之下创始人自己的 `jobs.db` 藏在家目录下，暴露面小得多。
档案 / 简历 / 答题留痕三样是仅本人可读 ✅ 没问题，**唯独 `jobs.db` 这一份**。
**不用等那件排期活的解法**：操作卡第 1 步建目录之后加一句 `chmod 700 /tmp/concierge-s1`——
零代码改动、零风险，把整个沙箱对其他账号关上门。
**我的判断：这一行值得在第一次真代跑之前就加上**；统一上锁那件活该排还是排，但不必为它卡住代跑。

---

### H. 🟡 记录不一致（不构成 bug）

| # | 不一致 | 说明 |
|---:|---|---|
| 🟡1 | 施工记录写「漏进去 4 个测试假数据文件」，而他自己 18:00 那组快照显示那一次是 **3 个** | 实质无误（复原后与基线逐字节相同），但**口述数字不精确**，正是这类不精确让 lead 不得不派一次最高优先级的排查。建议：记录里直接贴文件名，不写约数 |
| 🟡2 | 施工记录自述「按操作卡自己走了一遍」全部通过 | 走的是**已经在仓库目录里**的终端，因而没暴露 E1。不是造假，是**起点选错**——见下文错误方向 3 |

---

### I. 未覆盖（说明理由）

| 项 | 为什么不做 |
|---|---|
| 真实发现步骤（联网找岗） | 硬边界禁止；改为核输出路径全部由 `outputDir` 派生 + 从它下游接真跑 |
| 真投递 / 提交表单 / 浏览器 | 硬边界禁止；D5 的两处截图漏点因此只做静态定位，未动态复现 |
| 数据库路径变量绕过面的动态验证 | 无人设置该变量（搜索零命中），静态确认足够，动态复现价值低 |
| 覆盖率百分比 | 与第 2 轮同理由：本轮改动面的两个主文件不进进程内统计；改用 **5 次突变**回答「测试有没有在测东西」 |
| 权限配置的实际弹窗行为 | 改权限属拍板人地盘，不代试 |

---

## 六、Quinn 主动重构记录

**本轮零重构，产品代码一行未改。** 扫到 3 处候选，全部超界：

| 候选 | 为什么不动手 |
|---|---|
| 真 bug 一号的修法（兜底那句改成查一次「答过没有」） | 字面 1 行，但**改的是判定语义**（涉业务逻辑），且必须配一条新测试才算做完 → 超 Quinn 界，转 lead 派工 |
| 操作卡补进仓库目录那一句 | 1 行，但那是**别人的交付物**，且要连带决定「代码在哪」这个只有拍板人环境才知道的事实 → 报告即可 |
| 守卫报错文案改中文 + 把「撕纸条」提到第一行 | 跨两个文件（`paths.mjs` 与 `concierge_guard.sh`）、涉用户可见文案 → 超界 |

---

## 七、质量 3 指标

| 指标 | 数字 | 说明 |
|---|---|---|
| 覆盖率 | 不重报 | 见上文未覆盖表末行，用 5 次突变替代 |
| **漏检率自报** | `verify_self_miss_rate: 25%` | 本轮 8 个问题（2 真 bug + 4 风险 + 2 不一致）里，**2 个**是我上一轮该发现而没发现的：① 第 2 轮把目录链接数当条目数写成「167 个条目」，还顺手断言「全是创始人自己的历史数据」——**两句都是错的**，直接导致本轮要花最高优先级去排查一次并不存在的删除；② 第 2 轮点名那个兜底桶的谓词粒度过粗时，**只看了白名单那条路**，没有把兜底那条路一起点出来，于是修法天然只覆盖了一半（真 bug 一号）。2 除以 8 = 25% |
| 真 bug 数 | **2**（均 P2） | 一号：闭环承诺兑现不了；二号：操作卡照着跑不通 |

---

## 八、老坑清单核查

项目 `.claude/arnold/roles/` 下**没有 verify 岗位补充说明**（只有 `_README.md` / `builder.md` / `lead.md`），
故按派遣单 F 项给的 4 条 + 项目记忆五条原则核，结果见上文 F 一节与下表：

| 原则 | 结论 |
|---|---|
| 暴露问题不遮盖 / 不静默降级 | 本轮新代码 ✅（守卫是抛不是打印，没有兜底回落）；但**存量**有一处静默降级被本轮改动放大 → G2 |
| 三态字段绝不用真假判断读 | ✅ F1 |
| 改 bug 穷尽根因 | ⚠️ 真 bug 一号说明件一只修到了根因的一半（白名单路），兜底路没跟上 |
| 交付前自己当用户用一次 | ⚠️ 见 🟡2：起点选错，因而没暴露 E1 |
| 文件膨胀 / 变更日志 | ✅ 均已核，无超限，变更日志已记 |

---

## 九、13 维深查

**不适用（本轮 Mode = daily +）。** A 项按不可逆动作的取证标准单独加严（四路交叉验证），
其余按日常模式的 7 类技术 + 5 维高危做。派遣单未要求严苛模式，本轮也无数据表结构 / 认证 / 核心提示词变更。

---

## 十、覆盖度评估 + 质量分

**覆盖度**：派遣单 A–G 七项**全部实测覆盖**，无一项只读代码下结论；未覆盖的 5 项均属硬边界禁止或价值极低。

**做得好的（要说清楚，不是客套）**：
- 件二（隔离 + 守卫）是**扎实的**：4 个真实入口 × 有无开关 × 有无纸条全拦住，`cp` 那条不经 Node 的路也单独堵了，
  判据选「解析后的家」而不是「变量设没设」是**对的且经过实测否决了直觉写法**；
  20 多处硬编码一处不漏；泄漏修复被我独立复现（改前漏 2、改后漏 0）。
- 「不留回退读」的方向判断正确，而且代价比施工记录自己写的还小（D3）。
- 4 次突变各自变红 → 新测试不是摆设。
- 边界纪律好：公共目录那 165 个文件一个没删，四路证据都对得上；创始人家目录零写入。

**为什么仍然要回炉**：两个**最高危区各挂一处**，而且都是「看起来完成了、实际兑现不了承诺」的形状——
① 报告白纸黑字告诉用户「用这个键写回就不会再问」，对他自己 11 个已答事实中的 6 个**是假的**；
② 一张明写「不需要懂编程、整段复制回车」的操作卡，**第 3 步就跑不通**。
两处修法都很小（各 1 行，真 bug 一号还要配一条会红的测试），但**没修之前不能算完**。

### **质量分：3 / 5（回炉）**

分档理由：不是 4——4 意味着「可以放行、剩下的是小尾巴」，而这两处直接否定了本轮两件交付物各自的核心承诺；
不是 2——没有任何回归、没有假绿、流水线四步 × 4 提交全绿、隔离这件主活是真做成了。
按「拿不准就往低打」，落 3。

**建议下一步（具体到人）**：
1. **arnold-bug**：修真 bug 一号（`apply_gap_report.mjs` 兜底那句改成查一次「答过没有」），**先写一条会红的测试**
   （兜底题面 + 键已答 → 期望 `agent_profile_backed`），并同步收窄那段问题文案。
2. **arnold-builder**：操作卡补进仓库目录那一句（并进第 2 步同一段）；把第 6 步删简历那行拆出来；
   守卫报错改中文、把「撕掉纸条」提到第一行、Node 侧不裸抛调用栈；第 1 步建目录后加 `chmod 700`（G3）。
3. **lead / 拍板人**：G1 权限规则替换与否；G2 是否排快速失败改造；公共目录里我漏进去的 4 份（A4）要不要删。

---

## 试过的错误方向（第 3 轮，Iterations=4）

**❌ 方向 1：A 项打算直接对比「第 2 轮报的 167」和「现在的 165」，判成「差 2 个，疑似删除」。**
派遣单本身就是这么描述的，两个数字白纸黑字对不上，最省事的写法是「无法排除，建议保守处理」。
**失败原因**：真去查了才发现，**「167」根本不是文件数**。本机 `ls -la` 头一行第二列是**目录链接数** = 文件数 + 2，
我建了个空目录放 10 个文件做对照（显示 12，删 2 个显示 10）才把这条钉死。
**教训：两个数字对不上时，先问「这两个数字量的是同一件东西吗」，再问「是不是少了东西」。**
差点就为一次并不存在的删除写出一份「无法排除」的报告——那种结论看起来谨慎，实际是把没查清楚包装成了严谨。

**❌ 方向 2：C 项打算重跑施工记录那张 40 格 / 14 格的表，对上了就算通过。**
派遣单要的就是「独立重跑、不许引用他的数字」，我照做了，而且**确实对上了**（20 行变化、三格全翻）。
**失败原因**：对上了只证明「他没编数字」，**不证明「这个修法管用」**。
真正把真 bug 一号揪出来的是**第三步**——按报告公布的那条键**真写回去、再问一遍**。
`Preferred name` 闭上了，`Are you a US citizen?` 照问不误。
**教训：验「修好了没有」要走完整个闭环，不能停在「改前改后不一样」。**
差一步就会写出一份「三格确认翻转、闭环成立、通过」的报告，而他自己档案里 6 个已答事实还在被反复问。

**❌ 方向 3：E 项打算在仓库目录里把操作卡的命令跑一遍，跑通就判「卡可用」。**
这也正是施工侧做的事（他自述「按操作卡自己走了一遍」，结论全部通过）。
**失败原因**：**落脚点错了**。拍板人打开「终端」的落脚点是自己的用户文件夹，不是仓库目录。
我把起点换成用户文件夹再跑，第 3 步当场「找不到文件」。
**教训：验「不懂编程的人能不能照着做」，必须从他真实的起点开始，不能从自己方便的地方开始。**
这也是同一份卡两个人走、一个全部通过、一个第 3 步就断的全部原因。

**❌ 方向 4：D 项打算搜 `/tmp/mrweirdo-onboard` 零残留就判「路径搬家干净」。**
搜索结果确实干净（出货面零可执行引用）。
**失败原因**：搜错了对象。真正该问的不是「旧名字还在不在」，而是「**还有没有别的东西写死在公共的 `/tmp`**」。
换成搜 `/tmp/` 之后，两处**提交成功后的整页表单截图**（两个平台驱动各一处）立刻掉出来——
它们不随家走、不受纸条管，是同一个洞的下一步。
**教训：查「搬干净了没有」要按「有没有漏在外面」搜，不能按「旧名字还在不在」搜。**

---
---

# 验收报告 · 第 4 轮（Round 37 · 回炉三件聚焦复核 · `953e99a` → `b9d4b5b`）

| 项 | 值 |
|---|---|
| Status | done_pending_review |
| Owner | arnold-verify |
| Mode | daily +（件一件二按不可逆动作取证标准做） |
| Iterations | 5 |
| Updated | 2026-07-26 |
| **质量分** | **4 / 5（放行）** |

Reads_round4: 任务档案 `docs/active/2026-07-23_product-blueprint_TASK.md`、本报告第 3 轮章节、
施工记录 `docs/active/2026-07-23_product-blueprint_BUILD.md` 第 64-76 节、
操作卡 `docs/active/2026-07-26_concierge-run_RUNBOOK.md`、`PROJECT_MEMORY.md`、`PROJECT_CONTEXT.yaml`、
代码 `shared/apply_gap_report.mjs`、`shared/missing_field_questions.mjs`、`shared/paths.mjs`、
`shared/onboard_tmp.mjs`、`shared/apply_batch.mjs`、`shared/apply_supervisor.mjs`、
`shared/ashby_apply_driver.mjs`、`shared/greenhouse_apply_driver.mjs`、
`scripts/concierge_guard.sh`、`scripts/intake_resume.sh`、
测试 `test/custom_fact_key.test.mjs`、`test/concierge_isolation.test.mjs`、
流水线 `.github/workflows/ci.yml`、真实档案 `~/.mrweirdo-jobs/profile.json`（**只读**）

> **岗位补充说明**：`.claude/arnold/roles/verify.md` **不存在**（该目录只有 `_README.md` / `builder.md` / `lead.md`），
> 按说明书跳过、不报错。登记表 `ci_smoke` 只填了 `main_chain` 一格 → **主流程冒烟必跑**；
> `schema_upgrade_path` / `isolation_field` 两格为空 → 对应两条铁律**跳过**（本轮亦无数据表结构变更）。
>
> **本轮对创始人真实资产的处置**：`~/.mrweirdo-jobs/` 全程**只读**（探针把档案复制进临时沙箱再喂 CLI）。
> 跑前跑后 `stat` 四元组（路径 / 大小 / 修改时间 / 权限）排序比对：**7205 条目、0 行差异**；
> 家目录里**没有留下任何 `.concierge*` 文件**。`/tmp/mrweirdo-onboard` **169 → 169**（零删除、零泄漏）。
> 未 push、未动 `origin`、无 force / rebase / 改历史、未碰 `batchA-backup`；
> 未真跑投递、未提交表单、未开浏览器碰真实网站、未发邮件；未改任务档案、未改 `.claude/settings.json`。
> 产品代码**一行未改**（Quinn 本轮零重构）。本轮建的 9 个 `git worktree` 已全部 remove，
> `git worktree list` 只剩前几轮遗留的 3 个（非本轮所建，未动）。

---

## §1 验收范围（第 4 轮）

派遣单四块：① 件一兜底谓词 + 6/8 数字分歧 ② 件二双向配对守卫（新机制，按新机制破）
③ 件三操作卡从拍板人真实落脚点原样粘贴走一遍 ④ 回归与新洞。

**方法**：全部实测。件一的探针**我自己重写**（未看施工记录的 `probe11.mjs`），
件二用**我自己设计的 16 个攻击场景**（不是跑他的测试），件三**从用户文件夹起步、每条命令原样粘贴**。
所有「他说测过了」一律当作「没测过」重跑。

---

## §2 5 维高危区评估（**测试前**先做，用来定测试密度）

| 维 | 本轮命中什么 | 密度 |
|---|---|---|
| ① 核心业务逻辑 | 件一那 1 行兜底谓词 —— 它决定「这道题问不问他」，错任一方向都伤 | **最高**：10 条已答事实 × 改前改后 + 4 条反向 + 4 态三态 + 6 条假阳性探针 |
| ② 安全边界 | 件二守卫 = **别人的简历会不会落进创始人自己的家**。本项目最贵的一格 | **最高**：16 个攻击场景 × node/shell 双入口 + `cp` 那条路 |
| ⑤ 用户体验主流程 | 操作卡 = 拍板人唯一的界面；报错文案 = 他出事时唯一的救命稻草 | **高**：全卡原样粘贴实走 + 报错逐字读 + 故意写错文件名 |
| ④ 集成点 | 无第三方服务变更（本轮不联网） | 低：只核 `--dry-run` 到驱动之间那道闸 |
| ③ 性能 | 守卫多 2 次 `stat`，纯本地文件判断 | 低：不测 |

**测试密度按此分配**：件一 + 件二吃掉 ~80% 的工作量。

---

## §3 7 类测试设计技术覆盖

| 技术 | 用了几次 / N/A 理由 |
|---|---|
| ① 等价类划分 | **3 次**：事实三态（有值 / `false` / 空）、纸条状态（两张全 / 缺一张 / 对不上）、档案形态（长期档案 / 全新空档案） |
| ② 边界值分析 | **4 次**：空文件、纯空白、`\r\n` 换行、路径尾斜杠、多行文件取第 1 行 |
| ③ 决策表 | **1 次**：两张纸条 × 存在/缺失/内容错 = 3×3 真值表，逐格跑（见 §5.2 表） |
| ④ 状态迁移 | **1 次**：贴纸条 → 代跑 → 撕纸条 → 恢复自用；外加「只撕一半」的异常迁移 |
| ⑤ 用例测试（端到端） | **1 次**：操作卡第 1→7 步全程实走（§5.3） |
| ⑥ pairwise | **1 次**：`MRWEIRDO_HOME` × `MRWEIRDO_ONBOARD_TMP_DIR` × 纸条在否 的组合抽样 |
| ⑦ 风险驱动 | 贯穿全场，按 §2 分配密度；假阳性探针（§5.1.5）就是纯风险驱动挖出来的 |

---

## §4 5 轮回归循环记录

| 轮 | 干了什么 | 结果 |
|---|---|---|
| 1 | 独立重写件一探针（一题一份报告，避开报告每类只印 5 例的截断） | 改前 8/10、改后 2/10 |
| 2 | 全套测试 + 主流程冒烟（干净检出 `b9d4b5b`） | **232 / 232，红 0** |
| 3 | **7 处突变**（把被测代码改回旧写法 / 改成看似等价的写法） | 6 红 1 绿 —— 那 1 绿是真实测试缺口，见 §5.2.4 |
| 4 | 16 个攻击场景破守卫 + 操作卡原样粘贴实走 | 守卫全部按预期拒绝；操作卡 7 步全通 |
| 5 | 流水线四步 × 链上 **6 个提交**各自干净检出 | 全绿（§10.1） |

**未进第 5 轮转 bug 成员**：本轮没有测出需要 bug 成员接手的红。

---

## §5 结论明细（第 4 轮）

### 5.1 件一：我自己的数字，以及 6 / 8 分歧的来源

#### 5.1.1 ✅ 我自己重跑的数字：**改前 8 / 10 → 改后 2 / 10**，与施工自述一致

探针我自己写（`probe.mjs`，未看他的）：把创始人真实档案**整份只读复制进临时沙箱**
（不是只抠 `custom_facts` —— 只抠那一格会改变「英语是不是母语」这类由别的规则读的题的答案，
那是**我的假象**，不是他的现状），每条已答事实造一个自然题面 + 驱动的「这一格没值可填」标记，
**一题一份报告**喂给真实的缺口报告 CLI，改前树 `a4a865e` 与改后树 `b9d4b5b` 各跑一遍。

| # | 题面 | 档案里的键 | 改前 | 改后 | 报告公布的写回键 |
|--:|---|---|---|---|---|
| 1 | Are you a US citizen? | `us_citizen`=`false` | ❌ 照问 | ✅ 不问 | — |
| 2 | What is your current city? | `current_city` | ❌ 照问 | ✅ 不问 | — |
| 3 | What is your permanent residence state? | `permanent_residence_state` | ❌ 照问 | ✅ 不问 | — |
| 4 | Rate your Excel proficiency | `excel_proficiency` | ❌ 照问 | ✅ 不问 | — |
| 5 | Rate your Figma proficiency | `figma_proficiency` | ❌ 照问 | ✅ 不问 | — |
| 6 | Rate your Google Sheets proficiency | `google_sheets_proficiency` | ❌ 照问 | ✅ 不问 | — |
| 7 | Do you live in the West End neighborhood? | `lives_in_west_end_neighborhood` | ❌ 照问 | ❌ **仍问** | `live_in_the_west_end_neighborhood` |
| 8 | Have you previously worked at Faraday Future? | `previously_worked_at_faraday_future` | ✅ 不问 | ✅ 不问 | — |
| 9 | Is English your first language? | `english_first_language_note` | ✅ 不问 | ✅ 不问 | — |
| 10 | Have you previously been employed at this company? | `previously_employed_here_default` | ❌ 照问 | ❌ **仍问** | `previously_been_employed_at_this_company` |

**照问不误：8 / 10 → 2 / 10。3 处「指导写重复键」全部归零**（第 4/5/6 题改后根本不问，
报告也不再发 `rate_your_excel_proficiency` 这类新键——我核了 `profile_key` 字段，改后为空）。

#### 5.1.2 ✅ 6 / 8 分歧的来源：**我第 3 轮错了两次，他的 8 是对的**

分歧不是口径不同，是**我第 3 轮那张表本身有两处硬伤**，逐条交代：

| 来源 | 说明 |
|---|---|
| **① 我漏了一道题** | 档案里 11 个键对应 **10 道题**（`us_citizen_note` 是 `us_citizen` 的附注，不单独成题）。我第 3 轮的表只列了 **9 行**，漏掉了 `previously_employed_here_default`（第 10 题）—— 而它恰恰是**照问**的。9 行的表天花板就是 9，够不到 8 以上的真相 |
| **② 我正文的数字与自己的表对不上** | 我第 3 轮那张表数下来是 **7 个 ❌**，正文却写「**6 个**仍然会被反复问」。是我抄写时数错了，不是量的不是同一件东西 |
| **③ 他还纠正了我一处事实** | 我第 3 轮把第 8、9 题的「档案里已有的键」写成「—」（当作没有键）。实际两个键都在档案里（`previously_worked_at_faraday_future` / `english_first_language_note`），只是结论（不问）碰巧对了 |

**结论：以 8 为准。这是我的错，不是他的。** 6 → 7 → 8 三个数字里，
6 是抄错、7 是漏了一题的表、**8 才是把 10 道题跑全的真数**。
教训写进 §「试过的错误方向」方向 1。

#### 5.1.3 ✅ `us_citizen` 那条**已归零**（本轮最要害的一格）

`us_citizen` = `false`（他明说「我不是美国公民」）→ 改前 `unknown_user_fact`（照问），
**改后 `agent_profile_backed`（不问）**。这一格打穿的正是刚做完的对号入座提问，现在闭上了。

**三态四格独立复验**（把 `us_citizen_note` 一并移除，避免附注键代答）：

| `us_citizen` 的值 | 改前 | 改后 |
|---|---|---|
| `false`（他说「否」） | 照问 ❌ | **不问 ✅** |
| `''`（空串） | 照问 | 照问 ✅ |
| `null` | 照问 | 照问 ✅ |
| 键不存在 | 照问 | 照问 ✅ |

**`false` 与「没问过」没有被一起吃掉**（项目长期原则第 2 条 ✅）。

#### 5.1.4 ✅ 反向守卫成立：没答过的事实**仍然会被问**

四条创始人档案里根本没有的事实
（`Do you own a car?` / `Which shift do you prefer?` / `What is your favourite colour?` / `Are you a notary public?`）
→ 改后**全部仍是 `unknown_user_fact`（照问）**。**修复没有被做成「一律不问」。**

再加一格更狠的：**全新空档案**（`custom_facts` = `{}`，也就是代跑一个新学生的真实起点）→
连 `Are you a US citizen?` / `What is your current city?` 在内**全部照问**。
**代跑场景下这条改动完全不改变行为**——这一格很重要，5.1.5 要用到。

#### 5.1.5 ⚠️ 新洞（本轮改动**带出来的**，施工侧没测这一侧）：假阳性面被同步放大了

他只量了「该不问的问不问」这一侧（8→2），**没量另一侧：「不该判成已答的会不会被判成已答」**。
我造了 6 个「与已有键共享一段连续词、但问的是另一件事」的题面，改前改后各跑一遍：

| 题面 | 改前 | 改后 |
|---|---|---|
| What is your **current city** of birth? | 照问 | ❌ **判成「档案里有，交给系统填」** |
| What was your **permanent residence state** before 2020? | 照问 | ❌ 同上 |
| Are you a **US citizen** of the country where you will work? | 照问 | ❌ 同上 |
| Who in your household is a **US citizen**? | 照问 | ❌ 同上 |
| How many years of **Figma proficiency** does your team have? | 照问 | ❌ 同上 |
| Which **Excel proficiency** certification have you earned? | 走别的规则（不变） | 走别的规则（不变） |

**这是什么性质**：连续词段匹配这个机制**不是本轮新加的**（白名单那条路和标记表那条路早就在用），
本轮把它从「两条命名规则管的题面」推广到了**所有没被命名规则收编的题面**——**机制没变，射程变宽了**。
错的方向是「说他答过、其实没答」，正是他自己在 §73 方向 4 里点名不敢碰的那个方向。

**为什么我判它不是本轮的回炉项，而是一条待排的风险**（这条要说清楚，因为它离红线很近）：

1. **代跑场景下射程为零**：新学生的档案 `custom_facts` 是空的，谓词对空桶恒为 false，
   这一整类**一格都点不着**（5.1.4 末尾那格实测证明）。本轮交付的就是代跑场景。
2. **不产生死锁**：判成 `agent_profile_backed` 的后果是「这题交给系统按档案填」，
   行不会被永远卡住；真正的危害是**可能把一个不相干的档案值填到表上**（「城市」填成「出生城市」）。
   这条命中的是项目长期原则第 1 条（绝不编造个人事实），**严重度 P2**，
   但只在创始人自己那份用了很久的档案上才有机会发生。
3. **修法不该顺手做**：这一类要么给键加个「这条键管哪道题」的元信息，要么把匹配收紧成整题面比对——
   两条都是独立的一件活，超 Quinn 界（>3 行、涉业务判定）。

**建议**：与件一剩下那 2 题的「键迁移」**并成同一件活**排给 bug 成员——
它们的根因是同一个（**键与题面之间只有字符串关系，没有身份关系**），分开修两次不划算。

#### 5.1.6 ✅ 剩下那 2 个「仍问」：他的说法**成立**，「接受多问一次」这个取舍**我判正确**

逐条独立核过：

| 他的说法 | 我的核实 |
|---|---|
| 「不是同一个 bug」 | ✅ **成立**。第 7 题命中白名单 `do you live in` 那条路、第 10 题的正则 `previously employed` 对不上题面里的 `previously **been** employed`——**两题都不经过本轮改的那句兜底**。实证：改前它们就是「问」，改后还是「问」，而另外 6 题**同时**翻转——两组的行为曲线不同，根因就不同 |
| 「这两个键是当初手写进档案的、不是报告发出来的」 | ✅ **成立**。`lives_in_west_end_neighborhood`（`lives`）不是题面 `do you live in the west end neighborhood` 的连续词段；`previously_employed_here_default` 里的 `here_default` 题面里压根没有。其余 9 个键**碰巧**是连续词段 |
| 「修它要引入模糊匹配，错的方向是死锁」 | ✅ **成立**，而且 5.1.5 刚好给这句话提供了活体证据：射程一放宽，假阳性立刻出来 6 个 |
| 「接受多问一次」是正确取舍 | ✅ **是**。我把闭环真跑了一遍验证「多问一次」真能自愈：按报告公布的键写回 → **再问同一题 → 不问了**。两题都闭上。**代价确实有界且自愈** |

```
Do you live in the West End neighborhood?
  第一次问 → unknown_user_fact（报告告诉他写进 live_in_the_west_end_neighborhood）
  按这个键写回后再问 → agent_profile_backed  ✅ 闭上了

Have you previously been employed at this company?
  第一次问 → unknown_user_fact（写进 previously_been_employed_at_this_company）
  按这个键写回后再问 → agent_profile_backed  ✅ 闭上了
```

**唯一附带代价**（他自己也申报了）：桶里会多一条与旧键并存的记录。
我额外核了一件他没核的：**没有任何代码按键名去读 `custom_facts`**
（全仓库搜 `custom_facts[` 零命中），所以重复键**不会造成读取歧义**，只是不整齐；
真要说风险，是他哪天对新旧两个键给了**相反的答案**，那份档案就自相矛盾了——概率低，登记在案即可。

#### 5.1.7 ✅ 那条「先写才会红」的测试：**我自己删掉被测代码，它真红**

不是看他贴的报错原文，是**我自己在干净检出上做突变**：
把 `apply_gap_report.mjs` 结尾的 `return noValueCategory();` **改回** `return 'unknown_user_fact';`（即撤销本轮修复）：

```
### M1 撤销兜底修复 -> ℹ pass 231 ℹ fail 1
✖ gap report: the catch-all path stops asking a fact the bucket already holds
```

**红了，且只红这一条**（精确命中，不是一片连坐）。
第 3 轮我实证过「这条路此前一条测试都没有」（当时改掉这行 224/224 全绿），
**现在这条路有守卫了。不是假绿。**

---

### 5.2 件二：双向配对守卫 —— 按新机制破，16 个攻击场景

先说结论：**没破掉**。四个必答项逐条如下。

#### 5.2.1 决策表（两张纸条 × 状态，逐格实跑，node + shell 双入口）

| # | 场景 | 期望 | 实测 |
|--:|---|---|---|
| 1a | 家里有纸条，他跑自己的求职（= 忘撕纸条） | 拒绝 | ✅ 退出码 **3**，简历零落地 |
| 1b | 同上，shell 入口 | 拒绝 | ✅ 退出码 **3** |
| 1c | 家里有纸条、沙箱**没有**回执，在沙箱里跑 | 放行（家已被锁住，保护在生效） | ✅ 退出码 0，静默 |
| 2a | **只有沙箱回执、家里纸条没有**（node） | 拒绝 | ✅ 退出码 **3**，点名缺哪张、给整句 `echo` 贴回去 |
| 2b | 同上（shell） | 拒绝 | ✅ 退出码 **3** |
| 2c | 同上，走 `cp` 那条拷简历的路 | 拒绝且**简历不落地** | ✅ 退出码 **3**，`ls` 沙箱里只有 `.concierge_sandbox`，**没有 resume.pdf** |
| 3a | 两张都在，家里纸条指向**另一个沙箱** | 拒绝 | ✅ 退出码 **3**，报出「指的是另一个地方：/tmp/some-other-run」 |
| 3b | 家里纸条**内容为空** | 拒绝 | ✅ 退出码 **3**，显示「（空的）」 |
| 3c | 沙箱回执**内容为空** | 拒绝 | ✅ 退出码 **3**，「没法确认纸条贴没贴」+ 指回操作卡第 1 步 |
| 3d | 沙箱回执指向**不存在的家** | 拒绝 | ✅ 退出码 **3**（🟡 给出的修复命令会失败，见 5.2.5） |
| 3e | 家里纸条**尾部多个斜杠** | 拒绝（严格比对） | ✅ 退出码 **3** |
| 3f | 家里纸条带**前导空格 + CRLF 换行** | 放行（属正常书写差异） | ✅ 退出码 0，两侧去空白口径一致 |
| 3g | 沙箱回执**多行、真路径在第 2 行** | 拒绝 | ✅ 退出码 **3** |
| 4a | **两张都在且配对正确**（node） | **正常跑，且静默** | ✅ 退出码 0，stdout 打印沙箱路径，**stderr 一个字都没有** |
| 4b | 同上（shell） | 同上 | ✅ 退出码 0，静默 |
| 4c | 同上，`intake_resume.sh` 真拷简历 | **真的拷进去** | ✅ 打印沙箱路径，`ls` 看到 `resume.pdf`（权限 `-rw-------`） |
| 4d | 配对正确、**只设一个开关**，过程文件去哪 | 跟着家走 | ✅ `<沙箱>/run-tmp` |
| 4e | **一张纸条都没有**（普通人日常用） | 正常，静默 | ✅ 退出码 0，stderr 空 |

**守卫没有被做成「谁都过不去」**：4a-4e 五格全部零噪音通过，
且全量 232 条测试（其中大量测试都在设 `MRWEIRDO_HOME` 指临时目录）**一条不红**——这就是「不误伤」的硬证据。

#### 5.2.2 ✅ 「忘撕纸条」的报错：拍板人读得懂

这是他出事时唯一的救命稻草，逐字读一遍（我自己跑出来的原文，不是抄他的）：

```
[mrweirdo] 这台电脑正在「帮别人跑」，所以你自己的家暂时上锁了：/tmp/.../.mrweirdo-jobs

▶ 想跑你自己的求职？撕掉那张纸条就全部恢复正常。整行复制：
    rm /tmp/.../.mrweirdo-jobs/.concierge_run_active

▶ 还在帮别人跑？那是刚才那条命令漏了开关。这次代跑的家是：
    /tmp/concierge-s1
  ...
（什么都没写坏：它是拒绝干活，不是出错。）
```

| 派遣单要求 | 实测 |
|---|---|
| 第一行是可直接复制的删除命令 | ✅ 第一段就是 `rm <绝对路径>`，整行可复制；「带开关重跑」排在第二 |
| 中文人话 | ✅ 全中文，零内部代号 |
| 没有调用栈盖住它 | ✅ 无 `at ...` 帧、无 `paths.mjs:NN`、无 `throw new Error`。退出码 3（node 与 shell 统一） |

**为什么这个顺序是对的**：忘撕纸条这个场景发生时，操作卡第 6 步早把沙箱删了——
旧文案主推的「带开关重跑」会把他送去一个**已经不存在的目录**。现在这条排第二，对。

#### 5.2.3 ✅ 「逐字节相同」独立验证：**四个文案变体，node 与 shell 全部字节一致**

不是跑他的测试，是我自己用 `cmp` 二进制比对两个入口的 stderr：

```
note-family:
  [locked home]   BYTE-IDENTICAL
sandbox-family:
  [note missing]  BYTE-IDENTICAL
  [note crossed]  BYTE-IDENTICAL
  [marker empty]  BYTE-IDENTICAL
```

**他这句话为真。** 一处实现层面的差异如实记下：node 侧用 `join()` 拼路径会把 `//` 规整成 `/`，
shell 侧是字符串拼接不规整。用带双斜杠的临时目录跑时两边会差一个斜杠字符；
操作卡上的真实路径（`~/.mrweirdo-jobs`、`/tmp/concierge-s1`）都不含双斜杠，**实际使用中不会出现**，
且两条命令都仍然可用（`//` 在路径里等价）。**不算 bug，记录备查。**

#### 5.2.4 ⚠️ 但「有测试防漂移」这半句**只覆盖了 4 个文案里的 1 个**（突变实测）

他说「node 与 shell 两侧文案逐字节相同**且有测试防漂移**」。前半句我验了，为真；后半句**只对四分之一**。

突变实测：把 `concierge_guard.sh` 里沙箱那条文案改一个字
（`纸条不见了` → `纸条不见啦`），跑全量测试：

```
### M3 shell 侧沙箱文案漂移一个字 -> ℹ pass 232 ℹ fail 0
```

**全绿。漂移没有被抓住。** 原因：`the Node refusal and the shell refusal say the same thing`
这条测试只构造了**上锁那一种**情形去比对，**本轮新增的三条沙箱文案（缺纸条 / 对不上 / 回执为空）
两个语言各一份，没有任何测试比对它们**。

**性质**：不是功能 bug（今天四个变体确实字节一致，5.2.3 已证），是**测试缺口**——
新机制的文案没有守卫，下次谁改一边忘了另一边，不会有人吭声。
**严重度 P3**，修法很小（把那条对比测试参数化成四个情形各比一次）。**没让他现在返工。**

#### 5.2.5 🟡 两处「拒绝是对的、但给的修复命令不好用」（tamper 场景才会出现）

- **3d**（沙箱回执指向不存在的家）：提示 `echo "..." > /nonexistent/home/.concierge_run_active`，
  这条命令会报「No such file or directory」——他照做会二次受挫。
- **3g**（回执多行、第一行是垃圾）：提示里出现相对路径 `junk/.concierge_run_active`。

两者都**只在有人手动改过回执文件时**才可能出现（正常按操作卡跑不会），
且**拒绝方向是对的**（fail safe，没往下跑）。**P3，登记不返工。**

#### 5.2.6 ✅✅ 他主动申报的那格「盖不住」：① 我确认真的盖不住 ② 但**有一个更便宜的正着校验他漏了**

**① 通用规则确实盖不住 —— 他的判断成立。**
「第 1 步整段跳过」= 两张纸条都不存在，程序无从分辨「这是一次代跑」还是「这人换了个家目录用」。
唯一的通用做法是「不是默认家目录就必须有纸条」，
而**全量 232 条测试里绝大多数都在设 `MRWEIRDO_HOME` 指临时目录**——这条规则会把整个测试套件和
所有「我就是想换个家目录」的正常用法一起拦死。他说这是「假守卫换来的真故障」，**我同意，判断正确**。

**② 但他把「盖不住」推广得太宽了 —— 有一格是能盖住的，而且成本极低。**

那条通用规则之所以贵，是因为它管**所有**入口。但真正要命的**只有一个文件：别人的简历**。
把规则收窄到 `intake_resume.sh` 这一个入口——
**「简历只允许拷进两种地方：默认家目录，或一个带回执的沙箱」**——就够了：

- 我核过全仓库**只有 2 处调用** `intake_resume.sh`，都在 `test/concierge_isolation.test.mjs`，
  **两处都是拒绝场景**（一个拷进上锁的家、一个拷进无回执的沙箱），**新规则一条测试都不会破**；
- 引导说明书 `.claude/skills/mrweirdo-onboard/SKILL.md:155` 那条走的是默认家目录，**不受影响**；
- 错的方向是「**拒绝拷简历，并告诉他去跑第 1 步**」——**不是死锁**，正是他想要的方向。

**这不是本轮的返工项**（他做的没错，只是保守了一格），
**是给拍板人的一条更便宜的选项**：比他建议的「把第 1 步做成一条 `concierge start s1` 脚本」（产品形态变更）便宜得多，
且两者可以都做。**交拍板人决定排不排。**

**③ 操作卡那句「不能跳」够不够醒目：🟡 位置偏，但风险不高。**
「第 1 步不能跳」这句原文写在**全卡最末尾**的「现在还存在的限制」第 3 条，
而**第 1 步本身的正文里没有这句话**。判断：
- 第一次照卡从头做的人**不会跳**（他按顺序读到第 1 步就做了）——主流程安全；
- 真正的风险人群是**跑过第二次的人**（「我熟了，建个文件夹直接开」），而他恰恰不会再读末尾那段限制。

**建议（1 行文档改动，不构成回炉）**：把「⚠️ 第 1 步不能跳，跳了就没有任何保护、而且不会有人提醒你」
这句话**搬一份到第 1 步标题下面**。**我没动手改**——操作卡是给拍板人看的交付物，改文案属产品决定，超 Quinn 界。

---

### 5.3 件三：操作卡 —— 从他的用户文件夹原样粘贴，走完 1→7 步

**起点**：`$PWD` = 用户文件夹（**不是仓库目录**），`HOME` 指向临时假家目录（创始人真实家目录零写入），
壳用 **zsh**（macOS「终端」默认，也是他的真实壳），**每条命令原样复制粘贴**，只改卡上明说「只改这一行」的那行。

| 步 | 卡上承诺 | 实测 |
|---|---|---|
| 1 | 打印 `✅ 纸条和临时家配好了，可以开工` | ✅ 一字不差，退出码 0 |
| （插） | 「如果你忘了第 2 步，这一句会当场报错」 | ✅ **故意先跳过第 2 步**：退出码 3，中文报错，`ls` 确认**简历没落进自己的家** |
| 2 | 回显三行，第一行是代码文件夹 | ✅ `代码在=/Users/lee/Projects/mrweirdo-jobs`，家与过程文件都指向 `/tmp/concierge-s1`。**第 3 轮断掉的 `cd` 补上了** |
| 3 | 打印 `/tmp/concierge-s1/resume.pdf` | ✅ 一字不差，退出码 0 |
| 4 | 「如果它回你一句 `Missing role targets`…不是出错」 | ✅ 原文 `[apply-supervisor] Missing role targets. ...`，**与卡上预告一致** |
| 5 | ①②一行都不打印；③看得到他的东西 | ✅ ①②**全空**；③ 看到 `resume.pdf`（`-rw-------`）/ `run-tmp` / `.concierge_sandbox` |
| 6 | 打印那句恢复正常 | ✅；随后跑 `atsHome()` **恢复正常**（退出码 0，指回自己的家） |
| 7 | **故意写错文件名** → 说简历还在 | ✅ `⚠️ 这个路径上没有文件…他的简历八成还在你电脑上`，桌面上**简历确实还在**；改对 → `✅ 已从你电脑上删除`，桌面清空 |
| 收尾 | 只做了第 6 步一半（忘撕纸条） | ✅ 退出码 3，第一行就是可复制的 `rm` |

**第 3 轮确认有效的三项，逐条核**：

| 项 | 结论 |
|---|---|
| 第 5 步污染核对命令 | ✅ **没改坏**，①②实测仍然一行不打印 |
| `jobs.db` 644 如实写明 | ✅ 「现在还存在的限制」第 1 条**原文未动**，措辞诚实（我逐字比对了第 3 轮引用的原文） |
| 全卡零内部代号 | ✅ 通读一遍，零内部代号，全中文大白话 |

**一处不影响使用的说明偏差（🟡）**：第 5 步 ③ 写「应该能看到 profile.json / resume.pdf / jobs.db / run-tmp」，
但**只有真的走完第 4 步的分析入库**才会有 `profile.json` 与 `jobs.db`。
我这次按边界只走到打分前就停，看到的是 `resume.pdf` / `run-tmp` / `.concierge_sandbox` 三样。
不构成 bug（真走完流程就会有），但若拍板人中途停下来核对，可能会疑心是不是漏了什么。

#### 5.3.1 ✅ **本轮最终交付给拍板人的那句话**

> **可以。** 按这张卡，拍板人现在能安全地拿一份真实学生的简历代跑一次到「打分排队」为止：
> 全卡 7 步原样粘贴全部跑通；漏开关会被当场拦下且**简历不落地**；
> 忘撕纸条会被拦下且第一行就是能复制的修复命令；写错简历文件名不会假报「清理完成」。
> **两个附带条件**：① **第 1 步不能跳**（跳了没有任何保护，且不会有人提醒——建议把这句搬到第 1 步下面）；
> ② **不要越过第 4 步**（真投递在代跑场景下从未验证过，且真投递会把整页表单截图写进公共 `/tmp`，见 5.4.4）。

---

### 5.4 回归与新洞

#### 5.4.1 ✅ 老坑：三态字段没有新的 `|| 默认值`

扫本轮 `shared` / `scripts` / `test` 的**全部新增行**，找 `||` / `??` / `Boolean(`，共 5 处命中：

```
[ -n "$SANDBOX" ] || SANDBOX="（纸条里没写，打开这个文件看一眼）"
[ -f "$MARKER" ] || exit 0
[ -n "$POINTS_AT" ] || POINTS_AT="（空的）"
const sandbox = firstLine(lock) || '（纸条里没写，打开这个文件看一眼）';
trouble(`...：${pointsAt || '（空的）'}`, [...])
```

**5 处全部是「路径字符串为空时显示什么」，没有一处读的是三态布尔值。** 老坑未复发。
另加一条**突变实证**：把 `customFactAnswered` 的 `value === ''` 判断改成 `!value`（这正是老坑的形状），
**当场 2 条红**（`✖ customFactAnswered: one fact in the bucket...` / `✖ gap report: the catch-all path...`）——
`false` 不会被当成「没答」这件事，**有测试钉着**。

#### 5.4.2 ✅ 突变测试：7 处，**6 红 1 绿**（那 1 绿是 5.2.4 的测试缺口）

| # | 突变 | 结果 |
|--:|---|---|
| M1 | 撤销件一兜底修复（`noValueCategory()` → `'unknown_user_fact'`） | **红 1**（精确命中） |
| M2 | 三态判断改成真假判断（`value === ''` → `!value`） | **红 2** |
| M3 | shell 侧沙箱文案改一个字 | 🔴 **绿** —— 漂移守卫没覆盖，见 5.2.4 |
| M4 | 删掉 node 侧 `refuseIfSandboxIsUnprotected(home)` 调用 | **红 2** |
| M5 | shell 侧整段跳过沙箱配对检查 | **红 1**（正是拷简历那条） |
| M6 | 拒绝退出码 3 → 0 | **红 4** |
| M7 | 报错文案里删掉「撕纸条」那一段（打乱先后顺序） | **红 3** |

**除 M3 外没有假绿。**

#### 5.4.3 ✅ 创始人家目录零写入 + 公共临时目录零减少

```
~/.mrweirdo-jobs 跑前 7205 条目 / 跑后 7205 条目 / stat 四元组 diff = 0 行
家目录里 .concierge* 文件：none
/tmp/mrweirdo-onboard：跑前 169 → 跑后 169（含我上轮漏进去的 4 份，按边界一个没删）
/tmp/concierge-s1：已按操作卡第 6 步自行清理，无残留
```

#### 5.4.4 ✅ 他报的旧洞**属实**，且「本轮碰不到」这个「理论上」**我核过，成立**

| 问 | 结论 |
|---|---|
| 两处写死公共 `/tmp` 是否属实 | ✅ **属实**。`shared/ashby_apply_driver.mjs:1083` → `` `/tmp/mrw_post_${JOB_ID \|\| 'job'}.png` ``；`shared/greenhouse_apply_driver.mjs:1834` → `` `/tmp/mrw_gh_post_${JOB_ID \|\| 'job'}.png` ``。两处都在 `if (res.success)` 里，即**投递成功之后**给整页表单截图 |
| 代跑场景真会写别人的截图进公共目录吗 | **本轮不会**，但**不是因为操作卡叫他别做**——我去核了代码这道闸：`shared/apply_batch.mjs` 里 `if (dryRun) { summaries.push(...); continue; }` **排在驱动启动那行之前**，`--dry-run` 根本走不到 `driverFor(row)`。`apply_supervisor.mjs` 也只在 `--real` 时才碰浏览器。**「理论上碰不到」是结构性的，不是靠自觉** ✅ |
| 那还剩什么风险 | 一旦真投递解禁（Step 5 之后），**别人填好的投递表单整页截图会落在全机可读的 `/tmp`，不随家走、不受纸条管**。操作卡已在 4 处明令别做、限制第 4 条也写了「真投递在代跑场景下没有验证过」。**按派遣单只核实不修** |

**我另外扫出 3 处同形状的**（他没报，一并登记）：

```
shared/sourcing/_unwired/computer_use_locator.mjs:58   const FRAME_DIR = '/tmp/mrweirdo-jobs'
scripts/coverage_matrix_check.mjs:145 / 191 / 202       /tmp/coverage_*.json
```

第一处在 `_unwired/`（2026-07-22 隔离的死代码），**不在出货面**；
第二处是开发用的覆盖率分析脚本，写的是岗位与打分数据（**不含个人信息**），且不在操作卡任何一步里。
**两处都不改，登记备查。**

#### 5.4.5 🟡 施工记录里一个数字对不上（不影响功能）

`b9d4b5b` 的提交信息与 §74 都写「未 push 的本地提交 **14** 个，counted not guessed」。
我实测 `git rev-list --count origin/main..HEAD` = **15**。
原因是**那次计数发生在记录这个数字的提交自己被创建之前**——它把自己漏掉了。
（派遣单转述的也是 14。）**纯记录偏差，零功能影响**，下次带上一句「含本提交」即可。

---

## §6 Quinn 主动重构记录

**本轮零重构。** 逐条对判准：5.2.4 的测试缺口要参数化一条测试（跨断言、涉测试设计，>3 行）；
5.1.5 的假阳性面要改匹配语义（涉业务判定）；5.2.6 的收窄守卫要新增一段逻辑（涉安全边界）；
5.2.5 两条提示文案在 node 与 shell 两处、且要跟 5.2.3 的字节一致约束联动。
**四条全部超界**（>3 行 / 跨文件 / 涉业务或安全判定）→ **一律不动手，列给 lead 与拍板人。**

---

## §7 质量 3 指标

| 指标 | 数字 |
|---|---|
| 测试总数 / 通过 | **232 / 232**（干净检出实跑，非引用） |
| 覆盖率 | 本轮改动面两个主文件（`apply_gap_report.mjs` 是 import 期读文件的 CLI、`paths.mjs` 走子进程）**不进进程内统计**，与前三轮同理由。改用**突变测试**回答「测试有没有在测东西」：7 处突变 6 红 1 绿 |
| 真 bug 数 | **0 个必须回炉**；1 个新洞 P2（5.1.5，代跑场景射程为零，建议与键迁移并案）、1 个测试缺口 P3（5.2.4）、3 个 P3 小瑕（5.2.5 两条 + 5.3 说明偏差）、1 个记录偏差（5.4.5） |
| `verify_self_miss_rate` | **50%** —— 上轮漏检 2 条（① 件一少测一道题、正文数字与自己的表对不上，导致报了 6 而真数是 8；② 没量假阳性那一侧，5.1.5 那类改前就已存在于两条命名规则上，我第 3 轮没碰）；本轮总问题数 4（含新洞 1、测试缺口 1、小瑕 2 合并计 2）→ 2 / 4 = **50%**。**这是我这四轮里最难看的一次，如实报。** |

---

## §8 老坑清单核查

岗位补充说明 `.claude/arnold/roles/verify.md` **不存在** → 按说明书写「项目未定义」。
改按 `PROJECT_MEMORY.md` 五条长期原则逐条核（这是本项目实际的老坑清单）：

| 长期原则 | 本轮核查 |
|---|---|
| ① 红线必须落成代码断言 | ✅ 件二的「勿入」不再只是操作卡上的一句话，是**双向配对 + 退出码 3**；突变 M4/M5/M6 证明有断言钉着 |
| ② 三态字段绝不用真假判断读 | ✅ 5.4.1 扫描 5 处 `||` 全是显示字符串；突变 M2 证明三态有守卫 |
| ③ 单用户期测试必须喂「不像我」的档案 | ✅ 5.1.4 用**全新空档案**（新学生的真实起点）跑了一遍，行为与创始人长期档案**不同且都正确** |
| ④ 投递时「填了什么」必须留痕 | N/A（本轮无投递，也未改留痕代码） |
| ⑤ 查编造必须双向扫（汇点 + 源点） | ✅ **本轮就是靠这条挖出 5.1.5**：他只扫了「该不问的问不问」（汇点），我反方向扫「不该判成已答的会不会」（源点），当场 5 个 |

---

## §9 13 维深查

**本轮 Mode = daily +，不走 13 维全套。** 触发条件对照：无数据表结构变更、无核心数据流改动、
无新模块、无认证改动、无关键提示词改动 → 按说明书**不升 strict**。
其中与本轮改动直接相关的 4 维单独查过，结论写在正文：
维 2 数据一致性（5.1.6 闭环）、维 4 边界值（5.2.1 的 3b/3c/3e/3f/3g）、
维 5 数据隔离（5.2 全节）、维 12 文档同步（变更日志已记两条，5.4.5 记一处数字偏差）。

---

## §10 覆盖度评估 + 质量分

### 10.1 流水线四步 × 链上 **6 个提交**各自 `git worktree add --detach` 干净检出

| 提交 | 工作副本脏文件 | 单元测试 | 角色守卫冒烟 | 公测发布闸 | 语法检查 |
|---|---:|---|---:|---:|---:|
| `953e99a` | 0 | **226 / 红 0** | 0 | 0 | 0 |
| `aad18a9` | 0 | **232 / 红 0** | 0 | 0 | 0 |
| `f293956` | 0 | **232 / 红 0** | 0 | 0 | 0 |
| `c4e5a75` | 0 | **232 / 红 0** | 0 | 0 | 0 |
| `5a6c41c` | 0 | **232 / 红 0** | 0 | 0 | 0 |
| `f045bb6` | 0 | **232 / 红 0** | 0 | 0 | 0 |
| `b9d4b5b` | 0 | **232 / 红 0** | 0 | 0 | 0 |

（`.github/workflows/ci.yml` 四步：`npm test` / `node scripts/role_guard_smoke.mjs` /
`node scripts/public_alpha_gate.mjs` / 逐文件 `node --check`，全部本地串行真跑。）
整轮期间 `/tmp/mrweirdo-onboard` **169 → 169**。

### 10.2 主流程冒烟（登记表 `ci_smoke.main_chain` 填了，本项必跑）

主流程 = 「简历上传 → 简历分析定岗 → 各平台找岗 → 大批量一键投递 → 投递报告 → 持续跟进」。
本轮按硬边界不跑投递段，跑的是它的**前段与报告段**：

```
简历上传   → intake_resume.sh 真拷（沙箱，权限 -rw-------）        ✅
队列预览   → apply_supervisor.mjs --dry-run，输出与操作卡预告一致    ✅
投递报告   → apply_gap_report.mjs 真跑 30+ 次（探针全部走真实 CLI） ✅
   「Are you a US citizen?」（答过）→ 不问   agent_profile_backed   ✅
   「Which shift do you prefer?」（没答）→ 问他 unknown_user_fact   ✅
```

登记表另两格（`schema_upgrade_path` / `isolation_field`）为空 → 对应两条自查**跳过**。

### 10.3 派遣单四块交卷

| 块 | 结论 |
|---|---|
| 一 · 件一 | ✅ 我自己的数字 **8 → 2**；6/8 分歧**是我第 3 轮的两处硬伤**（漏一题 + 正文数字抄错），以 8 为准；`us_citizen` **已归零**；反向守卫成立；「先写才会红」的测试**我删代码验过，真红**。他关于剩下 2 题的说法**全部成立**，「接受多问一次」**取舍正确**（闭环实测自愈）。**新增一条他没测的假阳性风险（5.1.5）** |
| 二 · 件二 | ✅ 16 个攻击场景**没破掉**；配对正确时**不误伤**；忘撕纸条的报错**拍板人读得懂**；「逐字节相同」**为真**，但「有测试防漂移」**只覆盖 1/4**（5.2.4）；他申报的那格盖不住**确实盖不住**，但**有一个更便宜的正着校验他漏了**（5.2.6②） |
| 三 · 件三 | ✅ 7 步原样粘贴全通；`cd` 补上了；写错文件名说「简历还在」；三项有效项没改坏。**结论：可以代跑，两个附带条件**（5.3.1） |
| 四 · 回归 | ✅ 流水线四步 × 6 提交全绿；7 处突变 6 红（1 绿是测试缺口）；老坑未复发；零写入证据齐；驱动截图旧洞**属实**且「碰不到」**结构性成立** |

### 10.4 覆盖度

| 面 | 覆盖 |
|---|---|
| 件一改动面 | **高**：10 已答事实 × 2 树 + 4 反向 + 4 三态 + 6 假阳性 + 2 闭环，共 30+ 次真跑 CLI |
| 件二改动面 | **高**：16 场景 × node/shell 双入口 + `cp` 路 + 4 文案字节比对 + 4 处突变 |
| 件三 | **高**：从真实落脚点全卡实走，含 3 个故意失败路径 |
| 未覆盖 | ① 真投递段（硬边界，且这正是 5.4.4 那条风险所在，标注为「未验证」）② 第 4 步里由 AI 驱动的简历分析 / 找岗（要联网，按边界不跑；已用它下游的 `to_score.json` 接口对上）③ 覆盖率百分比（改动面两文件不进进程内统计，用突变替代） |

### **质量分：4 / 5（放行）**

**分档理由（往低打不往高打的口径下仍落 4）**：

- **不是 3**（回炉）：第 3 轮点名的两处「否定核心承诺」的真 bug **两处都真修好了，且是我自己重跑证实的，不是信他**——
  报告不再对已答事实食言（8→2，`us_citizen` 归零），操作卡从拍板人的真实落脚点**从头到尾跑得通**。
  件二还超出返工要求做成了双向配对，16 个攻击场景破不掉。**没有任何必须回炉的真 bug。**
- **不是 5**：本轮我挖出一条**由这次改动带出来的**假阳性风险（5.1.5，P2）——虽然代跑场景射程为零，
  但它命中的是项目长期原则第 1 条的形状，施工侧**只量了单侧、没量另一侧**；
  加上 5.2.4 那句「有测试防漂移」**只兑现了四分之一**。两条都说明自检还差一口气。
- **拿不准 4 还是 5 → 打 4。** 拿不准 4 还是 3 时我也问了自己一遍：3 的含义是「核心承诺没兑现」，
  而本轮两条核心承诺**都兑现了**，剩下的是新发现的旁支风险与测试缺口，**不构成回炉**。

**建议下一步（具体到人）**：

1. **lead / 拍板人**（本轮唯一真正要拍的一件）：**可以照卡代跑了**（5.3.1），
   建议同时拍两件小事：① 把「第 1 步不能跳」搬到第 1 步下面（1 行文档）；
   ② 要不要采纳 5.2.6② 那条更便宜的收窄守卫（只管 `intake_resume.sh`，零测试破坏），
   还是走 builder 建议的 `concierge start s1` 产品形态改造，还是两个都做。
2. **arnold-bug**（并成一件活，别分两次）：**键与题面之间只有字符串关系、没有身份关系**这个根因，
   同时导致 ① 件一剩下 2 题多问一次 ② 5.1.5 那 5 个假阳性。修法（加键的题面归属元信息 / 收紧成整题面比对）请一并出方案。
3. **arnold-builder**（小尾巴，可随下一轮捎带）：把 `the Node refusal and the shell refusal say the same thing`
   参数化成四个情形各比一次（5.2.4）；顺手修 5.2.5 那两条提示里的坏命令。
4. **上轮三条待拍板仍原样挂着**（`.claude/settings.json` 权限 / `store_scored_jobs` 静默返回 0 行 / `jobs.db` 644），
   本轮按边界一律没动。

---

## 试过的错误方向（第 4 轮，Iterations=5）

**❌ 方向 1：件一的 6 / 8 分歧，我一开始打算「各报各的、写成口径不同」。**
两个数字，两套探针，最省事也最像样的写法是「样本不同导致口径差异，建议以更全的一套为准」——听起来很专业。
**失败原因**：派遣单明写「分歧本身要有解释，不能各报各的」。真去逐格对了才发现，
**根本不是口径问题，是我第 3 轮那张表有两处硬伤**：漏了一道题（表只有 9 行，天花板够不到 8），
正文写的 6 **跟我自己那张表数出来的 7 都对不上**（抄写数错）。
**教训：两个数字打架时，先回头查自己那个数是怎么来的，再去解释差异。**
差一点就把「我数错了」包装成「我们量的不是一回事」——那不是严谨，那是给自己留面子。

**❌ 方向 2：件一的探针，我一开始只把 `custom_facts` 那一格复制进沙箱，其余档案留空。**
理由听着还很正当：只测这一格，最小化、干净、不带无关变量。
**失败原因**：第 9 题「Is English your first language?」当场判成「要问他」，
而真实情况是不问——因为这题走的是**语言熟练度**那条规则，读的是 `standard_qa.language_proficiency`，
被我剥掉了。我差点把**自己造出来的假象**写成一条「他的表和我的表对不上」。
**教训：做对照实验时，「只留被测的那一格」和「保持其余条件与现场一致」是两件事，后者优先。**
剥得太干净，剥掉的往往正是让结论成立的那些条件。

**❌ 方向 3：件二我一开始打算跑他那 7 条新测试，全绿就判「双向配对成立」。**
派遣单说「按新机制验」，他的测试恰好就是照新机制写的，跑一遍最省事。
**失败原因**：跑他的测试只能证明「他写的测试通过了」，证明不了「这个机制破不掉」。
我改成自己设计 16 个攻击场景（含尾斜杠、CRLF、多行文件、空文件、指向不存在的家），
**其中 4 格是他的测试完全没有的**，而且正是这条路让我发现 5.2.4：
**他的漂移守卫只覆盖了四分之一的文案**——一个字的突变，全量 232 条测试**全绿放过**。
**教训：验「破不破得掉」必须自己出题；跑对方的题，最多验出他有没有作弊。**

**❌ 方向 4：5.1.5 那条新洞，我一开始想直接判成「真 bug、回炉」。**
它命中的是项目长期原则第 1 条（绝不编造个人事实），形状很吓人，判回炉最安全、也最显得我尽责。
**失败原因**：多问了一句「代跑场景下这一格点得着吗」，真去跑了**空档案**那一格——
新学生的 `custom_facts` 是空的，谓词恒为 false，**这一整类一格都点不着**。
它只在创始人自己那份用了很久的档案上才有机会发生，而且不产生死锁。
判成回炉，会让一件**本轮确实做成了的交付**被一条**跟本轮交付场景无关**的风险拖住。
**教训：判严重度要问「在本次要交付的那个场景里，它点得着吗」，不能只看形状像不像红线。**
把不相干的风险按最坏形状打分，看着是谨慎，实际是让真正该放行的东西过不去。

---

# 第 5 轮验收 — 阶段 0（身份问答收尾，8 提交 `a42dd4e`→`264a7af`）｜2026-07-29

> Mode: daily+（施工记录缺失，一切结论独立实测）。边验边写，本节按验完顺序追加。
> 硬边界遵守中：未 push、未动 origin、未碰 `batchA-backup`、未真跑投递、未开浏览器、
> `~/.mrweirdo-jobs/` 零写入（开工基线 7205 条 stat 快照已存，收尾对账）、
> `/tmp/mrweirdo-onboard` 开工计数 **168**（收尾须 ≥168）。

## R5-§0 验到哪了（断线接续锚点）

- [x] 读齐：TASK 全文、DESIGN §13.3.1/§13.3.2/§13.3.3/§13.3.4/§13.10/§13.11/§13.12、ADR-11、ADR-12、`shared/work_auth_identity.mjs` 全文、master-plan 定稿
- [x] 独立环境：`git worktree add --detach` 干净检出 tip `264a7af`（scratchpad 独立路径，0 脏文件）
- [x] **tip 干净检出 CI 四步复核（不采信 lead 数字，自己重跑）**：npm test **257/257 pass、fail 0、exit 0**；role_guard_smoke=0；public_alpha_gate=0；node --check（shared+scripts 全部 .mjs）=0 —— 与 lead 自述一致
- [x] A1 门语义 ✅（见 R5-A1）
- [x] A5 visa_status 不外泄 + 白名单守卫 ✅（见 R5-A5）
- [x] C1 三态回归 / 突变抽查 ✅（见 R5-C1）
- [x] **初步 D 判定已出（见 R5-D-初步）**
- [x] A2 真值表 / A3 两层接缝 / A4 措辞 ✅（见 R5-A2/A3/A4）
- [x] A6 删句对照 ✅（见 R5-A6）
- [x] B 七种档案端到端 ✅（见 R5-B）
- [x] C3 C1-C14 对账 / C4 零写入 / demo:check / 8 提交独立检出闭环 ✅（见 R5-C3/C4 与 R5-D 终判）

## R5-C3 DESIGN §13.11 C1-C14 逐项对账 — 14/14 做了，附 2 处注释漂移（P3）

| 项 | 状态 | 证据 |
|---|---|---|
| C1 Q3 换问法删术语 | ✅ | R5-A4 实测问句零术语，「还没有（正常…）」选项在 |
| C2 Q4/Q5 + FORM_ANSWER_POLICIES | ✅ | R5-A2 行 3-9 |
| C3 说不清楚补 `requires_sponsorship_future=true` | ✅ | R5-A2 行 6（三变体） |
| C4 BLOCKED_BECAUSE / WHAT_HAPPENS_NEXT 改写 | ✅ | 新文案=「引导没跑过」/「答不上来的格子只停问到的那几行，其余照投」，读码+R5-A1 门关输出实测 |
| C5 other_status 接 Q5+Q4′ | ✅ | R5-A2 行 7-9、R5-B 档案 6 |
| C6 门谓词换「问过没问过」 | ✅ | R5-A1（含 🟡 值兜底偏离，已判接受） |
| C7 preflight 注释与检查项语义 | ✅ | 新注释写「about 1 row in 20, 4/72=5.6%」，检查项挂 checks 硬项 |
| C8 模板加 `form_answer_policy`/`_user_words` 路径+枚举收紧 | ✅ | 读码 + R5-B 写回实测（枚举拒收 exit 3） |
| C9 引导说明书 A0 改 Q1-Q5、删「batch cannot start」段、门槛账写明 | ✅ | R5-A4；全仓 grep 旧句仅剩「已删」的自述注释 |
| C10 NOTE_CATEGORY 新 note→self_serve 新类目 | ✅ | R5-A3 跨层实测 |
| C11-C14 ADR-12 四处 | ✅ | R5-A5（渲染/驱动/桶/守卫）+ R5-A6（bank 删句） |

**🟡 P3 注释漂移 2 处（行为零影响，建议下轮顺手清）**：`shared/missing_field_questions.mjs:82-84`（「blocks nearly every row」）与同文件 `gate_paths` 注释尾句（「this one blocks essentially all of them」）仍在复述被关卡 7 推翻的「阻塞几乎全部行」——同文件 `:100` 明说那两句已删，删的是用户可见问句、漏了这两条内部注释。13 维第 12 维（文档同步）记账。

## R5-C4 边界与收尾对账 — ✅ 全部干净

- `~/.mrweirdo-jobs/` **7205 条 stat 快照（路径+mtime+大小+权限）跑前跑后 diff = 0 行**；
- `/tmp/mrweirdo-onboard` 条目 **168 → 168**，未删任何文件；
- 沙箱家目录（`/tmp/mrw-v5-*`）已清；本轮建的 6 个 worktree 全部 remove（残留的 6 个是 lead/前几轮所建，非本轮产物，未动）；主仓工作区对产品代码 0 脏（突变全部复原核过）；
- 未 push、未动 origin、未碰 `batchA-backup`、未真跑投递、未开浏览器、未发邮件；
- `npm run demo:check`（登记表 ci_smoke 主流程冒烟）在干净 tip 检出 **exit 0**（对真实家只读；`work_authorization_answered ok=true` 对真实用户放行——门的值兜底偏离正是为他留的，实测吻合）。

## R5-D 终判：阶段 0 完工判定（8 提交整体）

**8 提交独立检出各自全绿（独立路径逐个建，未循环建删）**：lead 验过 6 个新提交（244→257 递增），本轮独立复核其中 2 个（`165dc6f` 244/244、`9dbfe79` 254/254，与 lead 数字一致），并**补验了 lead 没盖到的前两个**：`a42dd4e` **241/241**、`0cc1442` **244/244**。至此 8/8 每个提交单独检出 npm test 全绿——`git bisect` 安全，批次 A 那次「中间提交红」的旧事故形态不存在。

**§2 5 维高危区**（测试前评估，密度按此定）：① 核心业务逻辑=真值表+门（最高密度：19+14 格逐格）② 安全边界=visa_status 外泄+编造（三层+突变）③ 集成点=驱动/报告接缝（跨层实测）④ 用户体验主流程=demo:check+七档案 ⑤ 性能=本轮无外部调用链变更，N/A。
**§3 7 类技术**：等价类（七档案）/ 边界值（null/false/空串/字符串"true"/非法枚举）/ 决策表（真值表 10×5 逐格）/ 状态迁移（漏斗 Q1→Q5 含非法迁移抛错）/ 用例测试（沙箱端到端写回→门→驱动）/ 风险驱动（编造方向突变 M1-M5）/ pairwise：N/A（参数组合已被决策表穷举覆盖）。
**§4 回归循环**：本轮为验收侧独立实测（1 轮全绿 + 5 突变红绿对照），未触发回炉循环。
**§7 质量 3 指标**：真 bug 数 **0**；覆盖率 = 真值表 10/10 行、C 清单 14/14、七档案 7/7、8/8 提交；`verify_self_miss_rate: 0%`（本轮 3 条发现——1 🟡 偏离 + 2 P3 注释漂移——全部出自阶段 0 新代码，上一轮范围内无漏检对象；如实报 0，不是虚报）。
**§8 老坑清单**：项目未定义 verify 岗位家规文件；派遣单点名的 4 条老坑（三态真假读法 / 测试假绿 / 对账不抽样 / 零写入）逐条核过，见 R5-C1/C2/C3/C4。
**§9 13 维**：非 strict 轮，按派遣单聚焦面跑；文档同步维（#12）产出 2 条 P3。

**质量分：4/5 — 放行。** 扣 1 分事由：① 门谓词与 DESIGN §13.3.3 硬规定 1 的偏离虽方向安全、理由实证成立，但因 BUILD §85 缺失而无人申报，靠验收侧代为补录——流程上是缺口不是零瑕疵；② 2 处注释漂移。均不构成回炉。

**结论：这 8 个提交作为一个整体，可以推上 GitHub。**
- 全检查绿灯（干净检出 CI 四步 + demo:check + 8/8 单提交绿）；
- 设计符合性 A1-A6 六项全过（真值表、接缝、措辞、ADR-11/12、删句对照非故意变化=0）；
- 编造路径实测已死且有守卫咬人；真实用户零意外变化（125 键仅 1 键、即拍板确认那句）。
- 「本地与 GitHub 零差异」的后半句由 lead 推送后达成；推送时注意：**工作区尚有 4 个已改文件 + 7 个未跟踪文档不在本 8 提交内**（含本报告与 TASK/BUILD 的追加、master-plan 等定稿），是否随批入库由 lead 定——只推 8 提交或先收文档提交皆不影响本判定。

**遗留清单（不阻断，建议去向）**：① 门谓词偏离半句回写 DESIGN（architect，随 BUILD §85 欠账一起）② 2 处注释漂移（builder 下轮顺手）③ BUILD §85 阶段 0 章节仍欠（Round 55 已挂账，事实链本报告已补全大半）。

## R5-B 七种档案端到端 — ✅ 42/42 通过（不是看测试名，是真跑链条）

**方法**：每档案一个独立沙箱家目录 → 出厂模板落盘 → 漏斗 `workAuthAnswers()` → **真 CLI** `record_profile_answers.mjs --home <沙箱>` 按 `write_groups` 分组写回（`user_answer` 与 `onboarding_a0` 两次调用）→ 读磁盘核三态 → 门（读磁盘档案+磁盘留痕，真实调用链形态）→ 出货 Greenhouse 驱动答授权/担保两道真题面。

| 档案 | 门 | 授权题 | 担保题 | 三态/留痕 |
|---|---|---|---|---|
| 公民 / 绿卡 | 开 | 填 Yes | 填 No | 不写格磁盘 null ✅ 留痕在 ✅ |
| F-1 已有证件 | 开 | 填 Yes | 填 Yes | ✅ |
| F-1 没批（Q4=C 默认） | **开**（关卡 7 兑现：常态不拦批） | **停行** note=deferred | 填 Yes（fut 已推导） | `authorized_to_work_us` 磁盘 **null** ✅ |
| F-1 说不清（含中文原话） | 开 | 停行 deferred | 填 Yes | 原话只进 `_user_words`、`visa_status` 是枚举、全 bank 渲染零泄漏 ✅ |
| 其他签证（Q5=需要, Q4′=C） | 开 | 停行 deferred | 填 Yes（**他说的**） | ✅ |
| 一次都没问过 | **关** | —（门先拦） | — | 报错可读 ✅ |

附加：写回口对自由文本 `visa_status:"F-1 OPT"` **exit 3 拒收、档案未被污染**（ADR-12 R4 枚举收敛在写入口真执行）。与门+行层验收表（§13.3.3）逐行一致。

## R5-A6 「到岗时间」尾部工作授权自述删除 — ✅ 通过，非故意变化 = 0

**方法**：真实档案 + 真实 search_intent（只读）喂新旧两棵干净检出（`635c143` = R1 落地前一提交，独立路径 worktree）各自的出货渲染器 × 各自的 answer_bank 全部 125 个模板键，逐键对照。
**结果**：**变化键数 = 1**（`essay_templates.15.answer_template`，到岗时间），变化内容恰为设计 §13.10 点名那句尾巴消失：`Work authorization summary from my profile: F-1 OPT eligible; may require future sponsorship depending on the role.` → 整句不再出现，前半句逐字不变。**其余 124 键逐字节零变化。** 真实用户自由文本 `F-1 OPT eligible` 被打给雇主的路径就此关闭（该变化已由拍板人在关卡 8/§13.10 流程确认，非偷改）。

## R5-A2 真值表 10 行 × 5 列 — ✅ 19/19 逐格通过（独立探针 `probe_truthtable.mjs`）

- 行 1-9（含行 6 的 A/B 变体）：五列值 + 「不写」形态 + 来源留痕（第 3/4 行 `authorized_to_work_us` **source=user_answer**、推导格 **onboarding_a0**、`write_groups` 两组分开）全对。
- **第三行（F-1 没批）重点**：Q4=A → `true`(他说的)；Q4=B → `false`(他说的)；Q4=C → **键整个不出现**（不可能是 false/空串），`requires_sponsorship_now` 恒不写。
- **第十行（漏斗没跑过）重点**：`workAuthAnswers({})` **显式抛错**（Fail Fast，零格子产出）；档案侧出厂模板实测 `authorized_to_work_us === null`、`requires_sponsorship_now === null`、`requires_sponsorship_future === null`、`visa_status === ""`、`form_answer_policy === null`——**不是 false、不是编造值**。
- 第 9 行纪律：Q4=A 时 `requires_sponsorship_future` 仍不写（不许拿 Q4 补 Q5）✅。
- 防御：Q1 已定案还带 Q3 答案 → 抛错（漏斗与调用方打架不吞）✅。

## R5-A3 两层接缝 — ✅ 通过（跨层实测：出货驱动发的 note → 出货报告 CLI 分类）

- 驱动侧（真代码）：defer 档案 + 授权题 → 停行、note=**`work_authorization_deferred_by_user`**；没问过档案 → note=**`work_authorization_required`**——两个 note 从驱动侧就分开；defer 档案的担保题（`fut=true` 已推导）照答 Yes（defer 只覆盖答不出的格子，与 §13.3.3 验收表第 5 行一致）。
- 报告侧（真 CLI）：defer note → 独立类目 `user_work_authorization_self_serve`，文案是交待不是重问；**`user_work_authorization`（身份问题）类目零条目 = 他答过的问题不会被再问一遍**；不落 `agent_actions`（「你自己从档案填」那台静默卡死机器不启动）；行仍可重投。
- 出货 `work_auth_self_serve.test.mjs` 另覆盖「改口 C→A 后旧 deferred 行自动变按档案填」，本轮读码核对其断言真实。

## R5-A4 措辞硬约束 — ✅ 通过

- Q4 问句 + `Q4_NOTICE` 含「这三个字会被原样打到真实雇主的表单上」逐字（代码与引导说明书两处，说明书并规定文案一律从 `IDENTITY_QUESTIONS`/`Q4_NOTICE` 读、禁止重打防漂移）。
- Q1/Q2/Q3/Q5 问句与选项全文**零 CPT/OPT/EAD/H-1B/J-1**；全仓扫描剩余命中均为：`WHERE_TO_CHECK` 指路说明（派遣单豁免）、代码注释/设计理由（非问句）、校验文档「free text such as F-1 OPT is rejected」（枚举拒收说明）。
- Q3 选项带「还没有（**正常，大多数人在这一档**）」——「常态不是资格审查」拍板兑现；引导说明书把上手门槛的账写在明处（公民 1 题 / 常态留学生 4 题）。

## R5-C1/C2 老坑回归：三态读法 + 突变 — ✅ 通过

**C1 三态字段真假判断扫描**：8 提交全 diff（+5870/−521，38 文件）的新增行里，对 `authorized_to_work_us` / `requires_sponsorship_*` / `form_answer_policy` / `visa_status` 的每一处读取全部是 `=== true` / `=== false` 严格三分支或枚举白名单判；**零处 `|| 默认值` / truthy 读法**。`withoutSponsorshipAnswer()` 显式「两 false→Yes、任一 true→No、其余 null 调用方必须阻塞」，注释自书「No default branch: that was the fabrication」，与实现一致。

**C2 突变测试（5 处全红，无假绿）**：
| 突变 | 结果 |
|---|---|
| M1 真值表第 4 行 Q4=B 改写 `true`（编造方向） | `work_auth_identity.test` **2 红** ✅ |
| M2 门的漏斗来源放宽（`resume_inferred` 算问过） | `personal_fact_gate.test` **1 红** ✅ |
| M3 `authSummary` null 掉进「不需要担保」（两态回归重演） | `answer_templates.test` **1 红** ✅ |
| M4 白名单外文件加 visa_status 读点 | 守卫 **1 红** ✅（见 R5-A5） |
| M5 雇主可见模块加读点 | 守卫 **2 红** ✅（见 R5-A5） |

每处突变后 `git checkout` 复原，工作树 0 脏（复原已核）。

## R5-D-初步 初步判定（最小证据链完成时点）

**初步结论：倾向可推。** 依据：① tip 干净检出 CI 四步 + 257/257 独立复核全绿；② 门的新语义（本轮改动的地基）14 形态实测全对，报错可读、修复命令可复制；③ ADR-12 三层（渲染/驱动/守卫）实测全通，编造路径确认已死且守卫会咬人；④ 新增测试非假绿（5 突变全红）；⑤ 三态老坑零新增。
**尚未验、可能翻盘的项**：A2 真值表逐格（若格子写错属 P0）、A6 删句对照（若非故意变化 ≠0 属 P1）、B 七档案（若某档死锁属 P0）、C4 零写入收尾对账。以下继续。

## R5-A5 ADR-12：`visa_status` 只给系统看 — ✅ 通过（渲染层 + 驱动层 + 守卫突变三层实测）

**渲染层（R1/R3/R4，独立探针 `probe_adr12.mjs`，跑出货 `renderAnswerTemplate`）**：
- 毒档案（`visa_status: '我不知道，学校说要等'`、`_user_words: '我是陪读签证…'`、三布尔全 null）喂 **answer_bank.json 全部 125 条模板逐条渲染**：中文原话 / `F-1` 字样 **零泄漏**；
- `answer_bank.json` 全文无 `{{WORK_AUTH_SUMMARY}}`（到岗时间那半句确认已删——A6 再做真实档案前后对照）；
- `authSummary()` 对毒档案输出空串；R3 三分支实测：`requires_sponsorship_future` null → 担保半句**整个不出现**，true → `may require…`，false → `does not require…`。

**驱动层（R2，出货 Greenhouse 驱动经 harness——只换浏览器边界，判定逐字节是驱动代码）**：
- 中文原话档案 + 「非移民签证入境」题 → **阻塞（needs_user_answer），零填写**——ADR-12 里「被答成 No」那条编造路已死；
- 真实用户旧形态（`visa_status:'F-1 OPT eligible'` 自由文本、布尔 null）→ 同样阻塞，**自由文本不再被嗅**；
- 公民签名形态（两担保布尔皆 false）→ 允许答 `No`（合理推导，非编造）；
- 「无限制授权」题、未知 → 阻塞（关卡 2 ③ 兑现）。

**守卫层（`test/visa_status_read_points.test.mjs`，突变实测）**：
- 白名单 6 文件各有登记理由 + 「白名单没腐烂」反向测试（登记了却不读 = 红，防守卫空转）；
- **突变 1**：白名单外文件（`answer_routing.mjs`）加一个读点 → 测试 **1 红** ✅；
- **突变 2**：雇主可见模块（`answer_templates.mjs`）加读点 → 测试 **2 红**（读点未登记 + 零容忍双杀）✅；两处突变后 `git checkout` 复原，工作树 0 脏。
- 静态扫描核对：全仓 `visa_status` 命中文件与白名单差集 = 3 个文件全是**注释**（`answer_routing/answer_buckets/greenhouse_apply_driver` 里的 ADR-12 说明文字）+ 1 个 note 标签字符串 `'nonimmigrant_visa_status'`（出站标签、非读点，且 READ_SHAPES 正则边界处理正确不误伤）。

## R5-A1 门的新语义（ADR-11）— ✅ 通过，附 1 条 🟡 有理由的设计偏离

**方法**：独立探针（scratchpad `probe_gate.mjs`），只 import 干净检出 tip 的出货 `personal_fact_gate.mjs`，14 个形态逐一喂 `blockingProfileGaps()`。**14/14 符合设计语义**：

| 形态 | 门 | 判据 |
|---|---|---|
| 光有留痕（`user_answer` / `onboarding_a0`）、格子全空/全 null | **开** | 派遣单 A1 正例 ✅ |
| 空档案+无留痕 / 出厂模板原样 | **关** | 报错三件套齐：`blocked_because` 人话（「不是你答不上来，是这一步还没走完」）+ `missing_paths` + 可直接复制跑的 `remediation_command` ✅ |
| 留痕来源 `resume_inferred` / `legacy_unverified` / 留痕在别的字段族 | **关** | 非漏斗来源不算「问过」✅ |
| 格子是字符串 `"true"` / `"Yes"` / 自由文本 visa_status / 非法 policy 值 | **关** | 手改与旧档形态不被强转成「问过」✅ |
| typed boolean / 合法 policy 枚举、无留痕 | 开 | 见下偏离条 |
| context 整个缺省 | 关 | 调用方漏传不会静默放行 ✅ |

**preflight 接线**：`supervisor_preflight.mjs` 的 `work_authorization_answered` 是 **checks 硬项**（非 WARN），喂的是 `workAuthSources(home)` 真实留痕——门真挂在批次口上。

**🟡 偏离（有理由，方向安全，但 BUILD 缺失导致无人申报——由本轮代为申报）**：DESIGN §13.3.3 接缝硬规定 1 写「门**只读来源留痕，不读值**」；实现是「留痕 **或** 严格类型值（boolean/枚举）任一即认定问过」。代码注释自述理由：**现有真实用户早于留痕文件**——本轮实查属实（`~/.mrweirdo-jobs/answer_provenance.json` 不存在，档案里 3 个 typed boolean 在）。若照设计字面写，唯一真实用户会被自己的门锁死。方向性安全：**值只能开门、永远不能关门**（被 ADR-11 取缔的是「值缺 ⇒ 锁」这个反方向），且字符串形态一律不认。判定：**接受，不构成回炉**；建议 architect 把这半句补回 DESIGN（与 BUILD §85 欠账一起收）。

## R5-§0.1 已核事实（静态读码，随后实测补强）

- 真值表模块 `shared/work_auth_identity.mjs`：Q3 问句「你现在手上已经有一份批下来的、允许你在美国工作的证件吗？」与 DESIGN §13.3.1 逐字一致，**问句无 CPT/OPT/EAD**；Q5 问句无术语；Q4_NOTICE 含「这三个字会被原样打到真实雇主的表单上」原话（关卡 8 决定一）。`WHERE_TO_CHECK` 第 3 条含「EAD 卡（Employment Authorization Document…）」——属指路说明（派遣单豁免项），且已按 §13.3.2 挪到 Q4 旁边（`where_to_check_ref`）而非门前。
- 「不写」实现形态：模块用「`answers` 里**不出现该键**」表达「不写」，并返回 `unwritten_paths` 清单——与 DESIGN「不写 ≠ false ≠ 空串」语义相容（档案上该格保持 null 由写回口保证，待实测确认）。
- 第 9 行纪律（Q5=unclear 不写、不许拿 Q4 补）代码注释与实现均在（`typeof input.sponsorshipNeededFuture === 'boolean'` 才写）；第 10 行（漏斗没跑过）由 `identitySituation` 直接 throw 兑现「Fail Fast，缺答案是调用方 bug」。
