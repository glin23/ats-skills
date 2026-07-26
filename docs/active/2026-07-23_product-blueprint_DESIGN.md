---
Status: revised_after_build_and_verify（批次 A 已施工并验收；本版为批次 B 动工前置修正）
Owner: arnold-architect
Type: DESIGN
Iterations: 2
Updated: 2026-07-26
Reads: docs/active/2026-07-23_product-blueprint_TASK.md, docs/active/2026-07-23_product-blueprint_BUILD.md, docs/active/2026-07-23_product-blueprint_RISK_REPORT.md, docs/specs/product-blueprint.md, PROJECT_MEMORY.md, PROJECT_CONTEXT.yaml, .claude/phase_schemas.yaml, .claude/file_size_limits.json, .claude/arnold/roles/builder.md, shared/apply_gap_report.mjs, shared/missing_field_questions.mjs, shared/answer_routing.mjs, shared/answer_templates.mjs, shared/profile.template.json, shared/validate_user_profile.mjs, shared/supervisor_preflight.mjs, shared/apply_batch.mjs, shared/apply_supervisor.mjs, shared/retry_gap_rows.mjs, shared/greenhouse_apply_driver.mjs, shared/ashby_apply_driver.mjs, shared/greenhouse_value_rules.mjs, shared/answer_buckets.mjs, scripts/public_alpha_gate.mjs, scripts/secure_profile_files.sh, setup.sh, .claude/skills/mrweirdo-onboard/SKILL.md, .claude/skills/mrweirdo-onboard/references/intake-and-profile.md, .claude/skills/mrweirdo-onboard/references/run-and-database.md, test/apply_gap_report.test.mjs, test/personal_facts_guard.test.mjs
Reads_v2: docs/active/2026-07-23_product-blueprint_BUILD.md（第 24 节八处偏离 / 第 26 节三条旧 bug / 第 31-32 节回炉）, docs/active/2026-07-23_product-blueprint_VERIFY_REPORT.md（结论明细与风险段）, docs/active/2026-07-23_product-blueprint_FORENSIC.md（截图取证与四条建议）, docs/active/2026-07-23_product-blueprint_STATE_AUDIT.md（权限盘点）, docs/active/2026-07-23_product-blueprint_TASK.md（关卡 2 / 关卡 3 拍板）, shared/personal_fact_gate.mjs, shared/missing_field_questions.mjs, shared/apply_gap_report.mjs, shared/profile.template.json, shared/lever_apply_driver.mjs, shared/ashby_apply_driver.mjs, shared/greenhouse_helpers.js, shared/cdp.mjs, shared/cover_letter_materials.mjs, scripts/secure_profile_files.sh, .claude/skills/mrweirdo-ashby-auto/SKILL.md, .claude/skills/mrweirdo-onboard/references/intake-and-profile.md
Blocks: arnold-builder（批次 B / C 施工）
---

> **本版是修正版。** 批次 A 已施工（10 个提交）并经 verify 独立验收。本次按施工记录里的
> 8 处偏离、验收报告的逐条判定、截图取证结论、以及关卡 2 / 关卡 3 的拍板修正了本文件。
> **改了哪些、依据是什么，逐条列在第 13 节（本次修正清单）**；每处正文修改都保留了
> 「原来怎么说 / 为什么错 / 现在怎么说」，因为这份设计以后还要被人读。

# DESIGN — 被阻塞的问题怎么变成一句问用户的话 + 出厂模板预填的处置

> 边界声明：本轮**只出设计**。除本文件外没有改动任何文件，没有跑投递，没有读写 `~/.mrweirdo-jobs/`。

---

## 0. 给拍板人（人话版，不需要懂编程）

### 0.1 现在这个死结是什么

把产品想成一家帮你代填表格的代办公司。表格上有一栏「你有没有美国工作授权？」

- **上个月以前**：代办员遇到这一栏，不管你说过没说过，一律替你打勾「有」。这是**说谎**。
- **上两轮修完之后**：代办员学会了「你没告诉过我，我就不填」。这是对的。**但是**——他把这张没填完的表格塞回抽屉，**不告诉你他卡在哪一栏**。你只看到「今天投了 0 家」，不知道为什么。
- **更麻烦的是**：新用户拿到的空白档案里，这一栏被工厂**预先打好了「有」**。所以对大多数新用户来说，代办员根本没机会卡住——他照着那个假勾直接填了。

于是产品现在被夹在两个都不能接受的状态之间：

| 只做一件事 | 结果 |
|---|---|
| 只把工厂预填的假勾清掉 | 代办员天天卡住，**每一行都卡**，而且**从不告诉你卡在哪** → 产品从「说谎」变成「一声不吭什么都不干」 |
| 只教代办员开口问 | 工厂预填的假勾还在，他压根不会卡住，**照样说谎** |

**所以这不是两个 bug，是一件事的两半。必须同一批上线。**

还有一处必须一起说清楚的细节：代办员卡住之后，系统内部有一张分类表决定「这一栏该问用户、还是系统自己能填」。今天这张表把工作授权、性别种族、退伍军人身份**全部归到「系统自己能填」**。所以卡住的行不但不会问你，还会被派回给系统「你自己填」——系统填不出来，再卡住，再派回去。**这是一个不出声的死循环**，也是「卡住但不知道卡在哪」的真正机器。

### 0.2 我的方案：一个新用户会经历什么

方案只有一句话：**关于你本人的事实，工厂一律不预填；能填的只有两个来源——你亲口说的，或者从你简历里读到的。凡是没来源的，要么当场问你，要么这一行不投。**

落成三层：

**第一层：出厂即空白。** 所有「关于你本人」的格子（工作授权、人口统计学、法律声明）出厂全是空的。空 = 没人说过。这是最便宜也最可靠的「区分用户亲口说的 vs 工厂默认」的办法——因为工厂什么都没说。

**第二层：一道门，只拦一件事。** 工作授权这一格，是**几乎每张表格都问、不填就整行投不出去**的那一格。所以它单独享受一道「开工前的门」：真正开投之前，系统用代码检查它有没有值；没有就 2 秒内停下来，问你一句（就是引导流程本来就该问的那一句），你答完再开投。
**注意这不是「投递前把所有问题都问一遍」**（那条 2026-06 已经拍板不做，也确实会把上手门槛抬到没人愿意用）。这道门只管一格，判据是「这一格不填，几乎每一行都投不出去」。今天全项目只有这一格够格。

**第三层：其余的，等真实表格问了才问你。** 别的事实（法律声明、居住地、EEO 自愿披露、学历……）继续走现在这条路：真投的时候某张表格问到了 → 那一行停下、一个字都不填 → 批次结束后系统把这一批真实表格问到的问题**压缩合并**成最少的几个问题一次问你 → 你答完自动存进档案 → 自动重投那些行。这条路本来就在（`missing_field_questions.mjs` 那套压缩逻辑真的在跑），本轮只是把「工作授权 / 法律声明 / EEO」这几类**接进这条路**——今天它们被那张分类表挡在门外。

**再加一个收口动作：你答完的东西，用代码写回档案，不再靠 AI 自觉。** 今天的说明书写着「用户答完后更新档案」——那是一句写给 AI 的话，不是代码。本轮新增一个专门的记录命令：只允许写它问过的那几个格子，写完立刻校验，同时记一笔「这个值是谁在什么时候说的」。这样下次就不用再问你（自动复用），出了事也查得到来源。

**新用户的完整体感（改完之后）：**

1. 装好，发一份简历给它。
2. 它问 3 个硬边界问题（工作授权 / 地点 / 法律声明）——**和今天一样，一个都没多问**。
3. 给你看要投的队列，你说「开始」。
4. **如果第 2 步的答案没落进档案（AI 走神了），这里 2 秒内停下来补问一句，而不是让你等 20 分钟再看到 0 投递。**
5. 投完给你一份总结：投出去几家、几家因为缺什么停下了。
6. 它一次问你最多 4 组问题（按「补这个能解锁几个岗位」排序），你答完自动重投。
7. 你答过的东西永久生效，第二批不会再问。

### 0.3 分几批上线，每批的风险

| 批次 | 内容 | 上线后会怎样 | 风险 |
|---|---|---|---|
| **A（必须整批一起上）** | 分类表纠偏 + 答案写回代码 + 开工前那道门 + 清掉工厂预填 | 新用户体感如上；现有唯一用户（你）**逐格零变化**（你的档案 4 个格子都填了，那道门直接放行） | 低。中途任何一个提交点掉链子都不会比今天更糟（见 §11 的提交顺序论证） |
| **B（A 之后，可隔天）** | ① 工作授权改成对号入座的问法（关卡 3 拍板）② 另外 6 处同类编造：居住地、逃犯/管制药物那一组、是否年满 18、学籍、担保话术、学历 ③ 出厂模板再清三处（GPA / 学位 / 最早到岗日）④ 求职信与投递截图**上锁** ⑤ 投递截图不再把失败标成成功、且改成整页拍 | 这些题从「替你说」改成「问你一次」。会**多问 1-2 组问题**；截图从「看着有其实没用」变成真能当证据；同机其他账号不再读得到你的求职信和截图 | 中。**必须在 A 之后**——A 没上就把它们改成阻塞，等于再造一遍今天这个死结 |
| **C（收尾，可拖）** | 删死配置、退伍军人选项排序、国家写死、投递答案留痕（F6） | 用户无感 | 低 |

**没有任何一批会让产品短期变得更不可用**——这一条我在 §11 逐个提交点验证过，不是口号。

**~~两个需要你一句话拍板的~~ → 你已经在关卡 2 拍过板了，两条都不是我给的选项，我按你的改了：**

1. **「你是否年满 18 岁」** —— 你说：**引导时问一次，不默认也不阻塞**。
   我原来只想到「改成停下问」和「保留写死」二选一，你指出还有第三条：顺口问一句就完了，
   答了就有据、没答也别拿它拦人。改法见 §10-C。
2. **「你是否拥有不受限制的工作授权」** —— 你说：**未知就阻塞，问清楚再投**，我的「保留保守答案」被否了。
   你的理由比我的成本账硬：**答错两个方向都伤**——国际生说成「有」是不实陈述，公民说成「没有」会被直接刷。
   我算的只是「多卡几行 vs 多问一句」。改法见 §10-H。

**第三条你在关卡 3 拍的，改动更大**：**工作授权不许再问「你有没有工作授权」**
（你的原话：这没人能知道），改成能对号入座的问法——「你是美国公民或绿卡吗」「你是持 F-1 的留学生吗」。
这条把批次 B 的提问设计整个换了一遍，人话版见下面这段，细节在 §13.3。

**新问法长什么样（你会看到的）**：一次一个是非题，问的都是你查得到、说得出的事，
不出现 CPT / OPT 这类术语，也不要求你判断自己「算不算有授权」——那是法律结论，由代码去推。
如果你真的说不清楚（比如不确定学校批没批工作许可），它**不会瞎猜也不会闷着**，
而是告诉你去哪儿问（学校国际学生办公室、你的 I-20 那一栏、EAD 卡），
并说清「这一批先不投，你查到了一条命令就能续上，排好的队列不白排」。

**还有一件你可能想知道的**：这一轮复核发现**产品还有一个平台（Lever）从头到尾没被检查过**，
它那边至今对「你是否有在美国工作的授权」无条件答「有」——和我们刚在另外两个平台上修掉的是同一个毛病，
而且你历史上确实有 5 家公司是走这个平台投的。修它的零件都是现成的，工程量小。
**要不要把它一起放进这一批，需要你或 lead 一句话**（§13.6）。

---

## 1. Implementation Approach

### 1.1 需求难点（三条，逐条对应一个设计选择）

**难点一：三态字段已经修好了，但「阻塞」这个信号是个哑弹。**
上两轮把 `authorized_to_work_us` 等字段从真假判断改成显式三分支，缺值返回阻塞（`answer_routing.mjs:184-241`），驱动侧也接线了（Ashby `:546` 走 `pending_for_main_claude`、Greenhouse `:1512` 走 `needs_user_answer`）。信号发出来了，**但没有接收方**：

> **🔧 修正 5（2026-07-26）— 「驱动侧也接线了」这句只对 Greenhouse 成立。**
> - **原来怎么说**：两个平台都已把阻塞信号接到结果里，断的只有报告侧。
> - **为什么错**：Ashby 侧 `ashby_apply_driver.mjs:1142` 组装待答清单时写的是
>   `addPendingQuestion(pending, { question: m, selector, tag })` —— **`a.note` 整个丢掉**。
>   我核实时只读到 `:546` 发出了 note，没有跟到它被写进结果文件的那一步就下了结论。
>   工作授权因为题面正则兜住了、看起来没事，**但 Ashby 的法律声明与居住地 note 永远到不了
>   note 查表**——而批次 B 恰恰依赖它。这是「读代码只读到一半就下结论」的教训。
> - **现在怎么说**：Greenhouse 已接线；**Ashby 未接线，修法与验收写在 §13.5**，
>   属批次 B 的第一件事（同行修复、净增 0）。且施工时另查明 `:1142` 还有第二个洞
>   （只有能定位到文本框的题才进清单，下拉框题连带 note 一起蒸发），一并在 §13.5 处置。

- `apply_gap_report.mjs:91` 收集阻塞项时写的是 `push(b.question || b, 'blocker')`。`b` 是 `{question, note, detail}`，取了 `b.question`（字符串）之后，**`note` 被整个丢掉**（`push` 只在收到对象时读 `note`，见 `:86`）。驱动辛辛苦苦标注的 `work_authorization_required` 到这里就没了。
- 就算 note 侥幸留下来，`classifyField` `:137` 那条超长正则会把 `legally authorized|authorized to work|gender|race|veteran|disability` 判成 `agent_profile_backed`（系统按档案自动填），于是这些行落进 `agent_actions`，动作文案是 `Do not ask the user first. Fill from existing profile`（`:368`）——**系统被告知"你自己从档案里填"，而档案里恰恰没有**。下一轮重试再卡住，再被派回来。**这是一个不发声的死循环，也是「卡住但不知道卡在哪」的真正机器。**

所以 F5 不是「改一条正则」，是**修一条从驱动到提问的信号通路**，三段都要通：note 保住 → 按 note 精确分类 → 分类进得了 `user_*` 与 `RETRYABLE_CATEGORIES`。

**难点二：「什么时候问」不能一刀切。**
本项目有两条互相拉扯的既有约束：

- 已实现且带覆盖校验的设计：问题集从**真实岗位表单反推 + 压缩**（`missing_field_questions.mjs:137-181`，`condenseMissingQuestions` 带 coverage invariant 断言）。
- 2026-06 拍板：**不做投递前探测**。

一刀切「全部投递后问」→ 工作授权这一格会让第一批 100% 空跑（用户等 20 分钟看到 0 投递）。一刀切「投递前问完」→ 违反拍板、且把上手门槛从 3 个问题抬到 20 个，直接打击「有人用」这个第一判据。

**取舍论证（选中的方案）**：按「阻塞面」分流，判据可量化——
> **某个事实缺失会阻塞的行占比 ≥ 80% ⇒ 前置一道门；否则一律走投递后压缩提问。**

按这个判据过一遍今天的全部个人事实字段，**只有工作授权两格够格**（几乎每张 Greenhouse / Ashby 表都问；`workAuthGapFor` 的题面正则覆盖 4 类真实问法，BUILD §14 实测 6 档案 × 4 题面全阻塞）。法律声明、居住地、EEO、学历都只阻塞一部分行 → 全部走投递后。**这个判据同时解释了为什么它不违反「不做投递前探测」**：它不探测任何表单，它只是把引导流程 A0 那个**本来就该问的**问题变成代码断言。

**难点三：所有缺陷的共同根因是「代码分不出用户亲口说的和出厂默认」，而最贵的解法未必是最好的。**
理论上最彻底的解法是给每个字段包一层 `{value, source}`。实测代价：全仓库 40+ 处读点要改，其中两个驱动文件已超行数上限、**净增必须为 0**（`.claude/file_size_limits.json`，BUILD §15 方向 1 记录过 hook 是按单次编辑前后比的，"先减后加"都不成立）。做不到，也不该做。

选中的是**两层**：
- **第一层（免费且可靠）：出厂一律 null。** 非 null ⇒ 一定有人说过。这已经是 `legal_attestations` 的既有体例（`profile.template.json:47-52` 自带 `_notes`），上一轮 `demographics` 也照这个体例改完了（`:54-61`）。工作授权只是补上第三块。
- **第二层（增量、只读用途）：`answer_provenance.json` 旁挂文件**，记录每个个人事实的来源（用户亲口 / 引导 A0 / 引导 A2 / 简历推断 / 历史遗留未核实）+ 值指纹 + 时间。**明确不参与填表判断**（填表只看三态值就够了）——理由见 ADR-4。

### 1.2 方案总览：一条信号通路 + 一道门 + 一个写回口

```
出厂空白 ──► 引导 A0/A2 ──► [记录命令] ──► profile.json ──┐
                                       + provenance      │
                                                          ▼
                       ┌────────────────────  [开工前那道门：只查工作授权]
                       │  缺 → 2 秒停下 + 一句问话 + 一条可直接执行的记录命令
                       ▼
                   真实投递 ──► 驱动遇到没被告知的事实 ──► 整行阻塞，一个字不填
                                                          │ blockers:[{question, note}]
                                                          ▼
                                          [缺口报告：按 note 精确分类 → user_*]
                                                          │
                                                          ▼
                                        [压缩成最少的几组问题（既有机制）]
                                                          │
                                                          ▼
                                    用户回答 ──► [记录命令：白名单校验 + 写回 + 留痕]
                                                          │
                                                          ▼
                                             [重投那些行（既有机制）]
```

其中 **既有、不改**：压缩提问（`condenseMissingQuestions`）、重投（`retry_gap_rows.mjs`）、驱动侧阻塞（上两轮已完成）。
**新增**：`personal_fact_gate.mjs`（那道门的纯判定）、`record_profile_answers.mjs`（写回口）、`answer_provenance.mjs`（留痕读写）。
**改造**：`apply_gap_report.mjs`（信号通路三段）、`missing_field_questions.mjs`（问题模板搬家 + 新增类目 + 导出写入白名单）、`supervisor_preflight.mjs` / `apply_batch.mjs`（挂门）、`profile.template.json`（清预填）。

### 1.3 一个必须点名的实现陷阱（不写清楚 builder 一定会踩）

`classifyField` 里现有的 `note` 变量是 `field.note || outcome.reason`（`:110`）——**行级 reason 会冒充字段级 note**。而 `classifyUnsubmitted()`（`greenhouse_apply_driver.mjs:1761-1775`）返回的行级 reason 里，`profile_full_address_required` / `company_relationship_answer_required` / `legal_attestation_required` 这几个字符串**恰好和字段级 note 同名**。

所以新增的 note→类目查表**必须只读 `field.note`，绝不能读那个带 reason 兜底的变量**。否则一行因为法律声明被拦，同一行里的「你的 GPA 是多少」也会被打上「法律声明」标签，问出一句驴唇不对马嘴的话——看起来像修好了，行为是错的。

### 1.4 一个必须遵守的硬约束（上一轮真红过）

`.claude/skills/mrweirdo-onboard/SKILL.md` 现在 **495 行，CI 门禁上限 500**（`scripts/public_alpha_gate.mjs:121`）。本设计要求 SKILL.md 的净增 **≤ 4 行**，所有新增说明文字落到 `references/` 两个文件里（不受门禁）。两个驱动文件净增必须 = 0。

---

## 2. File List

### 批次 A（必须整批一起上线）

| 文件 | 新建/修改 | 行数影响 | 干什么 |
|---|---|---:|---|
| `shared/missing_field_questions.mjs` | 修改 | 181 → ~265 | `QUESTION_TEMPLATES` 从 `apply_gap_report.mjs` 搬进来（成为唯一真相源）+ 新增 3 个类目模板 + 导出 `answerWritePaths()` 写入白名单 |
| `shared/apply_gap_report.mjs` | 修改 | 533 → **564（实测）** | 模板搬走（-68）；`collectFields` 保住 note；新增 note→类目查表 + **「该类目是否已答」谓词**（见 §3.2 修正）；把个人事实从超长正则里摘出来改成「档案有值才算系统能填」；补 `RETRYABLE_CATEGORIES` 与 `onboarding_candidates` 名单 |
| `shared/personal_fact_gate.mjs` | **新建** | ~75 | 纯函数：`blockingProfileGaps(profile)` —— 那道门的判定 + 人话问句 + 可直接执行的记录命令 |
| `shared/answer_provenance.mjs` | **新建** | ~95 | 纯 + IO：来源留痕的读 / 写 / 指纹 / 一次性回填 |
| `shared/record_profile_answers.mjs` | **新建** | ~155 | CLI：白名单校验 → 类型校验 → 原子写 profile.json → 写留痕 → 重跑校验器，任一步失败整体回滚 |
| `shared/supervisor_preflight.mjs` | 修改 | 246 → ~253 | `checks` 数组加一项 `work_authorization_answered`（硬失败 ⇒ 真实批次拒绝开工） |
| `shared/apply_batch.mjs` | 修改 | 427 → ~434 | dry-run 路径也算一次门（只算不拦），把问句放进 dry-run 输出，让队列门在用户说「开始」**之前**就能看见 |
| `shared/profile.template.json` | 修改 | 131 → ~134 | `work_authorization` 三个布尔 → `null`、`visa_status` → `""`，加 `_notes`（与 `legal_attestations` / `demographics` 同体例） |
| `scripts/secure_profile_files.sh` | 修改 | 10 → ~16 | 新增一个「存在才 chmod」的可选清单，收 `answer_provenance.json` |
| `.claude/skills/mrweirdo-onboard/SKILL.md` | 修改 | 495 → **≤ 499** | Step 5 队列门的身份块加「来源」；Step 6 把「更新档案」改成调记录命令。**每处只许一行** |
| `.claude/skills/mrweirdo-onboard/references/run-and-database.md` | 修改 | +~35 | 记录命令用法、门被拦时的处置、重投流程 |
| `.claude/skills/mrweirdo-onboard/references/intake-and-profile.md` | 修改 | +~15 | A0/A2 答案必须经记录命令落盘，不许直接手写 JSON |
| `test/apply_gap_report.test.mjs` | 修改 | +~90 / 改 1 条断言 | 见 §12.4（**改断言需要显式授权，理由已写明**） |
| `test/personal_facts_guard.test.mjs` | 修改 | +~25 | 模板三个工作授权布尔必须为 null（防 I 项回潮） |
| `test/personal_fact_gate.test.mjs` | **新建** | ~90 | 门的三态 + 现有真实用户档案形状必须放行 |
| `test/record_profile_answers.test.mjs` | **新建** | ~140 | 白名单拒写、类型拒写、校验失败回滚、幂等、留痕正确 |
| `test/missing_info_loop.test.mjs` | **新建** | ~120 | **闭环证明**：阻塞结果 → 缺口报告 → 按模板写回 → 重跑报告 → 问题清单变空 |
| `CHANGELOG.md` | 修改 | +~8 | 登记表要求 |

批次 A 合计：新建 5 个源文件 + 3 个测试文件，修改 10 个文件。**没有任何文件触碰行数上限。**

> **修正（2026-07-26，依据施工实测 + 验收复核）**：`apply_gap_report.mjs` 我原估「533 → 约 500」
> （模板搬走 -67，新增约 34）。**为什么错**：低估了 note 查表 + 已答谓词 + 说明性注释的体量，
> 而且「模板搬走」并不能自动折抵新增。**实际是 533 → 564**（施工记录里写的 570 是工作副本上的
> 中间数，验收在提交树上按 `wc -l` 复核为 564，以 564 为准）。距 800 行上限仍有 236 行余量，
> **结论不变：无行数风险**。教训记在这里：行数预估只在「离上限还很远」时可以粗估，
> 一旦某文件逼近上限，估算必须换成先写后量。

### 批次 B（A 之后）— 2026-07-26 按拍板与实测重排

> 分成四个子包，**顺序即依赖顺序**。B0 是新加的前置（不先做它，B2 的法律声明与居住地在 Ashby 侧根本传不出来）。
> 详细设计见 §13.3 - §13.6。

| 子包 | 文件 | 行数影响 | 干什么 |
|---|---|---|---|
| **B0 接线** | `shared/ashby_apply_driver.mjs` | 1170 → **≤ 1170（净增 0，硬约束）** | `:1142` 保住 `a.note`；无文本框的阻塞题也要能出得来（§13.5） |
| **B1 问法** | `shared/missing_field_questions.mjs` | 372 → ~420 | 工作授权问句改「对号入座」式（关卡 3 拍板）+ 新增 `user_education_credentials` 类目（§13.3） |
| B1 | `shared/work_auth_identity.mjs` | **新建** ~110 | 身份答案 → 三个布尔的纯函数映射表 + 「说不清楚」的处置（§13.3） |
| B1 | `.claude/skills/mrweirdo-onboard/references/intake-and-profile.md` | +~30 | A0 改成两问对号入座、A2 加半句年满 18；删掉与本设计矛盾的那段「留 null 让门去问」 |
| B1 | `shared/personal_fact_gate.mjs` | 76 → ~95 | 门被拦时输出「去哪里查清楚」的指引 + 同一批不重复问 |
| **B2 判定** | `shared/greenhouse_value_rules.mjs` | 210 → ~285 | 接收从驱动搬出来的判定：禁枪清单（D）、居住地三态（B）、学籍三态（F）、年满 18（C）、无限制授权（H） |
| B2 | `shared/greenhouse_apply_driver.mjs` | 1914 → **≤ 1914（净增 0）** | 只留委托调用。D 项 10 条分支合并成 1 条 ⇒ 净减，腾出额度给 B/F/C/H |
| B2 | `shared/answer_templates.mjs` | 55 → ~59 | G 项：担保话术三态，没问过就不写那半句（**不阻塞**，理由见 §10-G） |
| B2 | `shared/profile.template.json` | +~6 | M/N/O 三处出厂值清空（GPA / 学位 / 最早到岗日）+ `_notes` 说明 |
| B2 | `shared/lever_apply_driver.mjs` | 489 → ~530 | **S 项：Lever 从未被扫过**（§13.6）。委托既有 `deriveWorkAuthAnswers()` / `workAuthGapFor()`；学籍 / 年满 18 / 亲属题同批处置。**需 lead 拍板是否纳入本批** |
| **B3 留证与上锁** | `shared/submission_evidence.mjs` | **新建** ~150 | 投递留证：先读页面文案定判定，再按判定命名，整页截图（§13.7） |
| B3 | `shared/state_file_lock.mjs` | **新建** ~70 | 写入侧统一上锁 + 一次性扫描补锁（§13.4） |
| B3 | `shared/cdp.mjs` | 378 → ~395 | `screenshot` 加整页开关；落盘即 `chmod 600`（所有截图的唯一收口） |
| B3 | `shared/cover_letter_materials.mjs` | 363 → ~370 | 求职信 HTML / PDF 落盘即上锁，目录 700 |
| B3 | `shared/supervisor_preflight.mjs` | 260 → ~270 | 每次真实批次开工前扫一遍补锁（覆盖用户手放的 `cover_letter.pdf`） |
| B3 | `scripts/secure_profile_files.sh` | 29 → ~33 | 改成调用同一个上锁模块，不再自己维护第二份清单 |
| B3 | 8 个 `-auto` 技能说明书的截图段 | 各 −1 / +1 行 | 把「模型拼文件名」换成「调 `submission_evidence.mjs`」（§13.7） |
| **测试** | `test/greenhouse_value_rules.test.mjs` / 新建 `test/work_auth_identity.test.mjs` / `test/prohibited_possessor.test.mjs` / `test/lever_driver.test.mjs` / `test/submission_evidence.test.mjs` / `test/state_file_lock.test.mjs` | +~450 | 每条新判定的三态全分支 + 身份映射真值表 + 留证判定的三种页面 + 上锁的权限位断言 |
| 测试 | `test/personal_facts_guard.test.mjs` | +~40 | **出厂默认值反向白名单守卫**（§10.2 那条固化扫法的机器动作） |

### 批次 C（收尾）

`shared/answer_bank.json`（删死键）、两个驱动的内置兜底 bank、`greenhouse_apply_driver.mjs:1640-1641`（退伍军人候选序）、`:1594`（国家）、`:1632`（全职意向）、`test/json_shapes.test.mjs`、F6 投递答案留痕（另出设计）、`missing_field_questions.mjs` 第 18 / 32 行两条中文问句里的被弃用旧叫法顺手改掉。

---

## 3. 数据结构与接口

```mermaid
classDiagram
    class ProfileJson {
        <<file ~/.mrweirdo-jobs/profile.json>>
        +personal: PersonalBlock
        +education: EducationBlock
        +work_authorization: WorkAuthorizationBlock
        +legal_attestations: LegalAttestationsBlock
        +demographics: DemographicsBlock
        +standard_qa: object
    }

    class WorkAuthorizationBlock {
        <<three-state 三态：true / false / null=没问过>>
        +visa_status: string
        +authorized_to_work_us: boolean|null
        +requires_sponsorship_now: boolean|null
        +requires_sponsorship_future: boolean|null
    }

    class LegalAttestationsBlock {
        +conflicting_obligations: boolean|null
        +no_prohibited_possessor_status: boolean|null
        +relatives_in_federal_government_or_contractors: boolean|null
        +at_least_18: boolean|null
    }

    class DemographicsBlock {
        +race: string|null
        +hispanic_or_latino: string|null
        +gender: string|null
        +veteran_status: string|null
        +disability_status: string|null
    }

    class AnswerProvenanceJson {
        <<file ~/.mrweirdo-jobs/answer_provenance.json, chmod 600>>
        +version: number
        +entries: Map~string, ProvenanceEntry~
    }

    class ProvenanceEntry {
        +source: ProvenanceSource
        +value_fingerprint: string
        +recorded_at: string
        +asked_by: string|null
        +category: string|null
    }

    class ProvenanceSource {
        <<enumeration>>
        user_answer
        onboarding_a0
        onboarding_a2
        resume_inferred
        legacy_unverified
    }

    class AnswerProvenanceModule {
        <<module shared/answer_provenance.mjs · 纯函数 + 单点 IO>>
        +fingerprint(value: any) string
        +readProvenance(home: string) AnswerProvenanceJson
        +recordEntries(home: string, changes: Change[], meta: RecordMeta) AnswerProvenanceJson
        +sourceFor(home: string, path: string, currentValue: any) ProvenanceSource|"unknown"
        +backfillLegacy(home: string, profile: ProfileJson) number
    }

    class PersonalFactGate {
        <<module shared/personal_fact_gate.mjs · 纯函数、零 IO>>
        +GATED_PATHS: string[]
        +blockingProfileGaps(profile: ProfileJson) GateResult
    }

    class GateResult {
        +ok: boolean
        +missing_paths: string[]
        +category: string
        +question: string
        +remediation_command: string
    }

    class MissingFieldQuestions {
        <<module shared/missing_field_questions.mjs · 纯函数>>
        +QUESTION_TEMPLATES: Map~string, QuestionTemplate~
        +QUESTION_GROUPS: QuestionGroup[]
        +answerWritePaths(templates) Map~string, string[]~
        +isUserFillableCategory(category: string, templates) boolean
        +validateQuestionGroups(groups, templates) void
        +buildMissingFieldRanking(entries: GapEntry[], templates) RankItem[]
        +condenseMissingQuestions(entries: GapEntry[], templates, groups) CondensedItem[]
    }

    class QuestionTemplate {
        +priority: number
        +profile_paths: string[]
        +question: string
        +answer_type: string
        +value_type: "boolean"|"string"|"enum"
        +enum_values: string[]|null
    }

    class ApplyGapReport {
        <<CLI shared/apply_gap_report.mjs>>
        +NOTE_CATEGORY: Map~string, string~
        +RETRYABLE_CATEGORIES: Set~string~
        +collectFields(outcome: DriverOutcome) GapField[]
        +classifyField(field: GapField, outcome: DriverOutcome) string
    }

    class GapField {
        +label: string
        +source: string
        +note: string|null
        +options: string[]|null
    }

    class DriverOutcome {
        <<JSONL 每行一条，驱动 stdout>>
        +outcome: string
        +reason: string
        +blockers: Blocker[]
        +missing: string[]
        +job_id: number
    }

    class Blocker {
        +question: string
        +note: string
        +detail: object|null
    }

    class RecordProfileAnswers {
        <<CLI shared/record_profile_answers.mjs>>
        +parseArgs(argv: string[]) RecordOptions
        +validateAnswers(answers, writePaths) ValidationResult
        +applyAnswers(profile: ProfileJson, answers) Change[]
        +main(argv: string[]) number
    }

    class Change {
        +path: string
        +from: any
        +to: any
    }

    ProfileJson *-- WorkAuthorizationBlock
    ProfileJson *-- LegalAttestationsBlock
    ProfileJson *-- DemographicsBlock
    AnswerProvenanceJson *-- ProvenanceEntry
    ProvenanceEntry --> ProvenanceSource
    AnswerProvenanceModule ..> AnswerProvenanceJson : 读写
    PersonalFactGate ..> ProfileJson : 只读
    PersonalFactGate --> GateResult : 返回
    MissingFieldQuestions *-- QuestionTemplate
    ApplyGapReport ..> MissingFieldQuestions : import 模板 + 压缩
    ApplyGapReport --> GapField : collectFields 产出
    ApplyGapReport ..> DriverOutcome : 解析
    DriverOutcome *-- Blocker
    RecordProfileAnswers ..> MissingFieldQuestions : answerWritePaths 白名单
    RecordProfileAnswers ..> ProfileJson : 原子写
    RecordProfileAnswers ..> AnswerProvenanceModule : 记来源
    RecordProfileAnswers --> Change : 返回
```

> 说明：本项目全部是 ESM 纯函数模块，没有 class、没有构造器。上图的 `<<module>>` 框把模块当类画，方法签名 = 导出的函数签名，**类型注解就是 builder 要写进 JSDoc 的那份**。

### 3.1 三个新模块的精确契约

```js
// shared/personal_fact_gate.mjs —— 纯函数，零 IO，可单测
export const GATED_PATHS = [
  'work_authorization.authorized_to_work_us',
  'work_authorization.requires_sponsorship_future',
];

/**
 * @param {object} profile  ~/.mrweirdo-jobs/profile.json 已解析对象
 * @returns {{ok: boolean, missing_paths: string[], category: string,
 *            question: string, remediation_command: string}}
 * ok=false 当且仅当 GATED_PATHS 里任一格既不是 true 也不是 false。
 * 只认 boolean：字符串 "true" / "Yes" 一律视为未回答（Fail Fast，禁强转）。
 */
export function blockingProfileGaps(profile = {}) { /* ... */ }
```

```js
// shared/answer_provenance.mjs
export function fingerprint(value)                  // sha256(JSON.stringify(value)).slice(0,16)
export function readProvenance(home)                // 缺文件 → {version:1, entries:{}}
export function recordEntries(home, changes, meta)  // meta: {source, asked_by, category}
export function sourceFor(home, path, currentValue) // 指纹对不上 → 'unknown'（陈旧留痕不撒谎）
export function backfillLegacy(home, profile)       // 一次性：有值但无留痕 → legacy_unverified
```

```js
// shared/record_profile_answers.mjs  CLI
// node shared/record_profile_answers.mjs \
//   --json '{"work_authorization.authorized_to_work_us": true,
//            "work_authorization.requires_sponsorship_future": true,
//            "work_authorization.visa_status": "F-1 OPT"}' \
//   --source user_answer --category user_work_authorization --asked-by queue_gate [--dry-run]
//
// 退出码：0 成功 / 2 参数或白名单违规 / 3 类型违规 / 4 写后校验失败（已回滚）
// stdout：{ok, changed:[{path,from,to}], skipped:[], provenance_written:N, validation:{ok,issues}}
```

### 3.2 缺口报告新增的两张表（数据，不是代码逻辑）

> **🔧 修正 1（2026-07-26）— 本文件曾经自相矛盾，照字面实现会出静默缺陷。**
>
> - **原来怎么说**：本节把 note→类目写成一张**无条件查表**——「命中即返回该类目」；
>   而 §4.3（失败路 2）描述的正确行为是「该 note 对应字段档案里已有值 → 归 `agent_profile_backed`，
>   不再问用户」。**同一份设计的两处互相打架**，builder 按哪一处写都能自圆其说。
> - **为什么错**：结果文件（`apply-result-*.jsonl`）在用户答完之后**会被重读**（重投前后各跑一次
>   缺口报告，`retry_gap_rows.mjs` 的输入就是它）。note 记录的是**驱动当时**为什么停下，
>   不是**现在**还缺不缺。无条件查表 ⇒ 用户答完、档案已经有值了，同一个问题**每一批都会再问一遍**，
>   永远问下去。闭环测试（`missing_info_loop.test.mjs`：写回后重跑报告，问题清单必须变空）当场抓到。
> - **现在怎么说**：**查表命中之后必须再过一道「这个类目档案里已经有答案了吗」的谓词**
>   （实现为 `CATEGORY_ANSWERED`，每个类目一条，与同类目的题面路径规则镜像）。
>   已答 → `agent_profile_backed`（系统按档案填，不再问）；未答 → 返回该 `user_*` 类目。
>   **判定的最终发言权归档案，不归 note。** note 只负责「问哪一件事」，档案负责「还问不问」。
>   没有这道谓词，本设计的闭环闭不上——这不是优化，是必需条件。
>
> 所以下表要读成：**note → 类目候选**，最终归属 = `CATEGORY_ANSWERED[类目]() ? agent_profile_backed : 类目`。
> 新增任何一个 note 映射时，**必须同时给它的类目补一条 `CATEGORY_ANSWERED` 条目**；
> 没有条目的类目一律按「未答」处理（宁可多问一次，不可替用户认定已答）。

**note → 类目候选（只查 `field.note`，绝不查带 reason 兜底的变量，理由见 §1.3）**

| 驱动发出的 note | 归到哪一类 | 今天归到哪（错在哪） |
|---|---|---|
| `work_authorization_required` | `user_work_authorization` | note 被丢 → 题面命中超长正则 → `agent_profile_backed`（系统自填，填不出来） |
| `sponsorship_future_required` | `user_work_authorization` | 同上 |
| `legal_attestation_required` | `user_legal_attestation` | `unknown_user_fact`（问得出来，但问句是万能句，用户看不懂在问什么） |
| `current_residence_required` | `user_full_address` | 落 `unknown_user_fact` |
| `profile_full_address_required` | `user_full_address` | 已正确（保持） |
| `specific_city_fact_unconfirmed` | `user_logistics_fact` | 已正确（保持） |
| `external_form_completion_required` | `user_external_form_completion` | 走题面正则，间接正确 |
| `export_control_answer_required` | `user_legal_attestation` | `unknown_user_fact` |
| `contractual_obligations_answer_required` | `user_compliance_relationship_or_restriction` | 走题面正则 |
| `company_relationship_answer_required` | `user_compliance_relationship_or_restriction` | 走题面正则 |
| `government_related_relative_answer_required` | `user_government_relative_compliance` | 走题面正则 |
| `english_fluency_answer_required` / `language_proficiency_not_in_profile` | `user_language_or_skill_level` | 走题面正则 |
| `availability_commitment_answer_required` / `part_time_availability_answer_required` | `user_earliest_start_date` | 走题面正则 |
| `location_not_in_profile_preferences` | `user_work_location_commitment` | 走题面正则 |
| 表里没有的 note | **不处理**，继续走原有题面正则 | —— |

**新增 3 个问题类目（模板）**

| 类目 | priority | profile_paths | 问句要点 | value_type |
|---|---:|---|---|---|
| `user_work_authorization` | **0.5** | `work_authorization.visa_status` / `.authorized_to_work_us` / `.requires_sponsorship_now` / `.requires_sponsorship_future` | **问法按关卡 3 拍板重做成「对号入座」式，见 §13.3**；三个布尔由身份答案推导，不再让用户自己判断「我算不算有工作授权」 | 每条路径各自的真实类型（三个布尔 + `visa_status` 是字符串） |
| `user_legal_attestation` | **5.5** | `legal_attestations.no_prohibited_possessor_status`（批次 B 加 `.at_least_18`） | 一句话说明这是联邦表格的固定一组题，一次确认覆盖全组；**「No 或不确定 = 我跳过问到这组题的岗位，不替你回答」**——这句出口是本设计里唯一做对了的一处，工作授权那组要照抄它（§13.3） | boolean |
| `user_demographics_eeo` | 15 | `demographics.race` / `.hispanic_or_latino` / `.gender` / `.veteran_status` / `.disability_status` | **必须写明自愿**：默认「不愿回答」，只有你主动说才填；这张表格没有「不愿回答」选项时你可以让我跳过这个岗位 | string |

> **🔧 修正 2（2026-07-26）— priority 不许取 0。**
> - **原来怎么说**：§12.1（给 builder 的改法）写「直接给新类目取 0 / 5.5 / 15」。
> - **为什么错**：`categoryPriority()` 的写法是 `templates[category]?.priority || 99`。**0 是假值**，
>   会被 `|| 99` 吃掉，于是「最该先问的那一格」排到全部问题的**最后**——排序反而垫底，
>   而 Step 6（引导第 6 步）每批只问四组，等于永远问不到。这是一个「看起来实现了、行为正好相反」的缺陷，
>   施工时靠实算排序才发现。
> - **现在怎么说**：`user_work_authorization` 取 **0.5**（比既有最小值 1 小、且是真值）；
>   `user_legal_attestation` 取 5.5（插在既有 5 与 6 之间，不动任何既有条目）。
>   **通用规则：本项目的 priority 永远不许取 0**，除非先把 `|| 99` 改成 `??`（本轮不改，
>   改它会影响所有既有类目的排序，收益为零）。

> **🔧 修正 3（2026-07-26）— `value_type` 不是每条路径都是字符串。**
> - **原来怎么说**：§12.1（给 builder 的改法）写「既有模板一律补 `value_type: 'string'`（现状就是字符串）」。
> - **为什么错**：**现状不是字符串**。`legal_attestations.conflicting_obligations` 与
>   `.relatives_in_federal_government_or_contractors` 是 boolean；`standard_qa` 下的
>   `language_proficiency` / `location_logistics` / `company_relationships` /
>   `work_location_commitments` / `external_form_confirmations` 五处是 object。照字面写，
>   写回口的类型校验会对**一半类目**判 exit 3 / exit 4，用户答完写不进去——同样是「看起来做了、
>   实际闭不上环」。
> - **现在怎么说**：模板的 `value_type` 记该类目**多数路径**的类型，另加一个
>   `path_value_types: { <路径>: <类型> }` 覆盖表记录例外（如 `user_work_authorization`
>   的 `visa_status` 是 string、其余三条是 boolean）。写回口按「先查覆盖表、再退回 `value_type`」
>   取类型。**新增任何模板时，作者必须逐条路径核对档案里的真实类型，禁止照抄一个默认值。**

**为什么 EEO 的 priority 给到 15**：它排在所有实质性缺口之后，Step 6「最多问四组」的额度先给能解锁岗位的问题。它只在**表单没有「不愿回答」选项、驱动真的填不进去**时才会冒出来——那时候它确实是一个用户决策（自己选一个 / 跳过这个岗位），系统无权代答。

**为什么不需要动 `QUESTION_GROUPS`**：`validateQuestionGroups()` 只校验已声明的分组；新类目走 `condenseMissingQuestions` 的 singleton 分支（`missing_field_questions.mjs:160-172`）自动成为独立问题。工作授权本来就该独立问（一个问题四个选项），EEO 更不该和别的题捆在一起。**零改动拿到正确行为。**

---

## 4. 调用流

### 4.1 正常路：新用户从装好到投出去

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant SK as 引导技能（主对话）
    participant REC as record_profile_answers.mjs
    participant PF as profile.json + answer_provenance.json
    participant BATCH as apply_batch.mjs
    participant PRE as supervisor_preflight.mjs
    participant GATE as personal_fact_gate.mjs
    participant DRV as Greenhouse / Ashby 驱动
    participant GAP as apply_gap_report.mjs
    participant RETRY as retry_gap_rows.mjs

    U->>SK: 简历 PDF 路径
    SK->>U: 硬边界三问 A0 工作授权 / A1 地点 / A2 法律声明
    U-->>SK: 作答
    SK->>REC: --json {work_authorization.*} --source onboarding_a0
    REC->>REC: 白名单校验 → 类型校验 → 原子写 → 校验器复跑
    REC->>PF: 写值 + 写来源留痕（chmod 600）
    REC-->>SK: {ok:true, changed:[3 项]}
    SK->>BATCH: apply_supervisor --dry-run（队列预览）
    BATCH->>GATE: blockingProfileGaps(profile)
    GATE-->>BATCH: {ok:true}
    BATCH-->>SK: dry-run JSON（含 profile_gate:{ok:true}）
    SK->>U: 队列门：身份块显示「工作授权 F-1 OPT（来源：你本次亲口回答）」
    U-->>SK: 开始
    SK->>BATCH: apply_supervisor --real
    BATCH->>PRE: supervisor_preflight --json
    PRE->>GATE: blockingProfileGaps(profile)
    GATE-->>PRE: {ok:true}
    PRE-->>BATCH: exit 0
    loop 队列每一行
        BATCH->>DRV: 投这一行
        alt 表单只问了已知事实
            DRV-->>BATCH: outcome=submitted
        else 表单问到没被告知的事实（例：联邦禁枪清单题）
            DRV-->>BATCH: outcome=skip, blockers:[{question, note:"legal_attestation_required"}]
        end
    end
    BATCH->>GAP: --summary <本批>
    GAP->>GAP: collectFields 保住 note → NOTE_CATEGORY 精确分类 → user_legal_attestation
    GAP->>GAP: condenseMissingQuestions 压缩（按解锁岗位数排序）
    GAP-->>SK: user_questions / condensed_missing_questions / retry_candidates
    SK->>U: 一次最多四组问题（「补这个可解锁 N 个岗位」）
    U-->>SK: 作答
    SK->>REC: --json {legal_attestations.no_prohibited_possessor_status:true} --source user_answer --category user_legal_attestation
    REC->>PF: 写值 + 留痕
    SK->>RETRY: --apply --gap-report <本批报告>
    RETRY-->>SK: 重新入队 N 行
    SK->>BATCH: apply_supervisor --real（第二批）
    BATCH-->>U: 这些行投出去了；下一批不会再问同一个问题
```

### 4.2 失败路 1（本设计的核心保护）：工作授权没落进档案

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant SK as 引导技能
    participant BATCH as apply_batch.mjs
    participant PRE as supervisor_preflight.mjs
    participant GATE as personal_fact_gate.mjs
    participant REC as record_profile_answers.mjs

    Note over SK: A0 问过了，但模型没把答案写进 profile.json<br/>（本项目历史上正是这种"指令≠断言"造成全部缺陷）
    U->>SK: 开始
    SK->>BATCH: apply_supervisor --real
    BATCH->>PRE: supervisor_preflight --json
    PRE->>GATE: blockingProfileGaps(profile)
    GATE-->>PRE: {ok:false, missing_paths:[authorized_to_work_us, requires_sponsorship_future],<br/>question:"你的工作授权状态是？（四选一）",<br/>remediation_command:"node shared/record_profile_answers.mjs --json ..."}
    PRE-->>BATCH: exit 1 + FAIL work_authorization_answered
    BATCH-->>SK: fail(supervisor_preflight) —— 浏览器一个标签页都没开
    SK->>U: 「开投之前还差一件事：<问句>」（2 秒内，不是 20 分钟后）
    U-->>SK: 作答
    SK->>REC: 照 remediation_command 执行
    REC-->>SK: {ok:true}
    SK->>BATCH: apply_supervisor --real（重跑）
    BATCH-->>U: 正常开投
```

**对照没有这道门时会发生什么**（也就是「只清模板不修 F5」的世界）：20 行全部真的打开浏览器 → 每行加载页面、填一半、卡在工作授权 → 全部 skip → 用户等了 20 分钟看到「投出 0 家」→ 缺口报告把这些行判给「系统自己填」→ 系统填不出来 → 重投 → 再卡。**这就是 lead 说的「比现在更糟的中间态」，这道门是它唯一的解药。**

### 4.3 失败路 2：用户答完，同一行又被同一题卡住

```mermaid
sequenceDiagram
    autonumber
    participant REC as record_profile_answers.mjs
    participant PF as profile.json
    participant RETRY as retry_gap_rows.mjs
    participant DRV as 驱动
    participant GAP as apply_gap_report.mjs
    actor U as 用户

    U-->>REC: EEO 题回答「不愿回答」
    REC->>PF: demographics.* = "Prefer not to say"（来源 user_answer）
    RETRY->>DRV: 重投该行
    DRV->>DRV: 这张表单的下拉框里根本没有「不愿回答」这个选项
    DRV-->>GAP: 又一次 skip，同题同 note
    GAP->>GAP: 该 note 对应字段档案里已有值 → 归 agent_profile_backed（不再问用户）
    GAP-->>U: 该行落进 agent_actions，不再进提问清单
    Note over GAP,U: 已知缺陷：跨批次没有"答过还是卡住"的状态，<br/>这一行会安静地每批重试一次。<br/>最小解法见 §5 第 4 条，本轮不做。
```

### 4.4 写回口内部（Fail Fast，档案要么整体更新、要么原样不动）

```mermaid
sequenceDiagram
    autonumber
    participant CLI as record_profile_answers.mjs
    participant MFQ as missing_field_questions.mjs
    participant FS as 文件系统
    participant VAL as validate_user_profile.mjs

    CLI->>MFQ: answerWritePaths(QUESTION_TEMPLATES)
    MFQ-->>CLI: 允许写入的路径集合（= 问过的问题声明的 profile_paths ∪ 门控路径）
    CLI->>CLI: 每个 key 不在集合里 → exit 2，一个字不写
    CLI->>CLI: 布尔路径收到 "yes"/"true"/1 → exit 3，禁强转（三态字段不允许模糊输入）
    CLI->>FS: 读 profile.json（不存在 → exit 2）
    CLI->>VAL: 写前先验一次（本来就不合法 → exit 4，一个字不写）
    CLI->>FS: 备份到 profile.json.bak（成功后删除，不长期留副本）
    CLI->>FS: 写临时文件 → rename 原子替换 → chmod 600
    CLI->>VAL: validateProfileBundle(home)
    alt 校验通过
        CLI->>FS: 写 answer_provenance.json（含值指纹）+ chmod 600
        CLI->>FS: 删除 profile.json.bak（不留第二份明文个人数据）
        CLI-->>CLI: exit 0，打印 changed 清单
    else 校验失败
        CLI->>FS: 用备份还原 profile.json
        CLI-->>CLI: exit 4 + 打印校验器原始报错（不吞、不兜底）
    end
```

---

## 5. Anything UNCLEAR

1. **本项目缺 `.claude/arnold/roles/architect.md`（architect 岗位补充说明）。** 已确认该文件不存在（同目录只有 `_README.md` / `builder.md` / `lead.md`）。本设计的「项目铁律」是从 `PROJECT_MEMORY.md` 四条长期原则、`builder.md` 家规、登记表 `ci_smoke.main_chain` 反推的（§9）。**若另有未成文的架构家规，请补进那个文件，我会按它复核本设计。**

2. ~~「你是否年满 18 岁」要不要改成阻塞？~~ **已拍板（关卡 2 ②），本条关闭。**
   拍板结果是**第三条路，我给的两个选项都不是**：**引导时问一次，不默认、不阻塞**。
   我原来只想到「改成阻塞」与「保留写死」两选一，拍板人指出还有「问一次就好了，答了就有据，
   没答就别拿它拦人」。处置改法见 §10-C 与 §13.3。

3. ~~「不受限制的工作授权」未知时的保守答 `No` 要不要保留？~~ **已拍板（关卡 2 ③），本条关闭。**
   拍板结果**否掉了我的建议**：未知一律**阻塞，问清楚再投**。拍板人的理由比我的成本账更硬——
   「答错双向都伤：国际生说成有是不实陈述、公民说成没有会被直接刷」。
   我原来的算法只算了「多卡几行」的成本，没把「保守答案本身也是一次替用户陈述」算进去。
   处置改法见 §10-H。

4. **跨批次「答过仍被卡」没有状态，本设计未解**（§4.3）。最小解法：在 `feedback` 表新增一列 `blocked_note`，同一 `(job_id, note)` 连续两批出现即把该行标 `permanently_blocked`、不再重投也不再提问。**代价是一次数据表结构变更（不可逆）**，且登记表 `ci_smoke.schema_upgrade_path` 那格是空的（没有登记「改表要同步改哪几处」）。所以我把它拆出去，建议随 F6 审计留痕一起单独设计，不塞进本轮。

5. **EEO 题在表单不提供「不愿回答」选项时，用户说「跳过这个岗位」要不要落成永久偏好？**（新增一个 `demographics.decline_and_skip_rows` 字段）**本轮不加**——按字段克制原则，先看真实发生频次再说；现在加等于凭空猜一个用户行为。真实批次跑过之后如果这条反复出现，再补。

6. **本设计假设「引导流程 A0 的答案原本就应该落进 `work_authorization`」**——这一条我核实过是既有约定（`references/intake-and-profile.md:52-57` 明确要求 A0 写成那四个规范键；`validate_user_profile.mjs:59-73` 也要求这四个键必须存在）。**所以那道门不是新增门槛，是把既有约定从"给模型的指令"升级成"代码断言"。** 如果拍板人认为 A0 本来就允许留空，那这道门的定位要重谈——但那样的话产品就只剩「每一行都卡」这一条路了。

7. **「说不清楚自己的工作授权状态」这条出口，本设计原来给错了，现已改**（见 §13.3 与 ADR-7）。
   验收发现文档两处互相矛盾：引导说明书说「答不出来就留 null，让开工前那道门去问」（结果是门永远拦着、整批一行投不出去，死锁），
   而本文件 §6（可靠性那一栏）说「选它就写 `false` 到 `authorized_to_work_us`」——**写 false 本身就是一次编造**，
   只是方向保守，与红线冲突，且 RISK_REPORT F1 明确否掉过「把默认值从 Yes 掉头改成 No」这条路。
   **两条都不对**，现在的处置是第三条：不写任何布尔，把「不确定」做成一个有明确后果的正式状态
   （告诉用户去哪里查、查到之前这一批不投），并且**同一批里不再重复问**。

8. **本设计（以及批次 A、B 的全部改动）只覆盖 Greenhouse 与 Ashby 两个平台，Lever 从头到尾没进过扫描范围**——
   这是我这份设计最大的一处范围漏洞，2026-07-26 复核时才发现，详见 §13.6。
   `shared/lever_apply_driver.mjs:265` 至今仍是 `return chooseOption(field, ['Yes', …]) \|\| 'Yes'`，
   **对「你是否有在美国工作的授权」无条件答 Yes**，与批次 A 修掉的 Greenhouse 缺陷逐字同款；
   担保题、学籍题、年满 18 题同样是两态压三态。而取证报告里 **50 张截图有 5 家是真实 Lever 投递**，
   这条路是活的。**需要拍板人决定它进批次 B 还是单开一轮**（我的建议：进批次 B，因为该文件 489 行、
   离 800 上限还远，判定函数可以直接复用已有的 `deriveWorkAuthAnswers()` / `workAuthGapFor()`，工程量小）。

9. **门的判据阈值（阻塞面 ≥ 80% ⇒ 前置）是我定的。** 今天只有工作授权两格越线，判断依据是 BUILD §14 的 6 档案 × 4 题面实测和 `workAuthGapFor` 的题面覆盖。**这个阈值没有真实批次数据背书**（41 天零投递）。第一批真投跑完后应该用真实数据复核：如果法律声明那一组的阻塞面也逼近 80%，它就该升级进门。

---

## 6. 8 项质量属性取舍表

| 质量属性 | 指标（本设计的承诺） | 显式牺牲了什么 |
|---|---|---|
| **Performance 性能** | 门的判定：纯对象取值 + 4 次 `===` 比较，**< 1 ms**（无 IO，profile 已被 preflight 读进内存）。缺口报告新增 note 查表是 O(1) 哈希，每字段新增 2 条正则，**30 行批次的报告生成新增 < 10 ms**（现值量级为百毫秒）。写回命令：读 + 写 2 个小 JSON + 一次校验器子进程，**< 300 ms**。**上述为设计预算，builder 交活时须贴实测值**（本轮禁跑真实投递，无法在设计阶段测端到端） | 门在 `--real` 路径上多跑一次 profile 读取（preflight 自己已经读过，实际零新增 IO）。为了做到「要么整体更新要么原样不动」，写回命令用了备份 + 重命名 + 复跑校验器，比直接写慢约 200 ms——**用延迟换档案永不残缺** |
| **Scalability 扩展性** | 新增一个「关于本人的事实」类问题的成本：**1 条 note 映射 + 1 个问题模板 = 2 处改动，0 处驱动改动**。今天同样的事要改 4 处（驱动分支 / 分类正则 / 模板 / 重试白名单） | 牺牲了「一条正则搞定一切」的紧凑：`classifyField` 会多出 3 个条件分支，文件从 533 长到约 500（因为模板搬走反而净减）。多了 3 个新文件要维护 |
| **Security 安全** | 写回命令**只能写白名单路径**（白名单 = 问过的问题自己声明的 `profile_paths`，模板即权限，不存在"能问不能写"或"能写没问过"的缝）。新文件 `answer_provenance.json` **chmod 600**。留痕只存路径 + 指纹 + 时间，**不存值本身**（不因为审计需求增加一份明文个人数据副本） | 白名单让「临时手改一个没在问题模板里的字段」这条路走不通——只能改模板或手编 JSON。这是有意的：本轮全部缺陷都源自"随手写档案，没人知道值从哪来" |
| **Maintainability 可维护性** | 问题模板成为**唯一真相源**：一处定义同时决定「问什么 / 允许写哪些格 / 压缩怎么分组 / 重试放不放行」。所有个人事实判定进纯函数模块，两个超限驱动**净增 0 行**（批次 B 的 D 项合并后净减，给 B/F/C 腾额度） | 模板从 `apply_gap_report.mjs` 搬进 `missing_field_questions.mjs` 会让 `git blame` 断一次；`missing_field_questions.mjs` 从 181 涨到约 265 行（上限 800，安全） |
| **Reliability 可靠性** | 写回失败一律整体还原：档案要么是更新后的完整状态、要么与改动前逐字节相同（exit 4 + 打印校验器原始报错）。门只认 boolean，字符串 `"true"` 一律当没回答（**禁强转，Fail Fast**）。留痕带值指纹，指纹对不上就报 `unknown` 而不是撒谎。闭环有测试兜底（`missing_info_loop.test.mjs`：阻塞 → 提问 → 写回 → 问题清单变空） | 门是硬失败：档案缺工作授权时**整批拒绝开工**。极端情况——用户确实不知道自己的授权状态——他会被卡在门口。**缓解方式已于 2026-07-26 改写**：原文写的是「选『不确定』就写 `false` 到 `authorized_to_work_us`」，**那是错的**——写 false 就是替用户做了一次陈述（方向保守也仍是编造），且与 RISK_REPORT F1 否掉的「默认值掉头改成 No」是同一件事。现在的做法：**一个布尔都不写**，`visa_status` 记原话，并给出「去哪里 5 分钟内查清楚」的具体指引（§13.3），门继续拦本批但**同一批不再重复问**。这是一次**知情的停下**，不是死锁——用户知道卡在哪、知道怎么解、知道解了就能继续 |
| **Interoperability 互操作** | 驱动 → 报告 → 提问 → 写回 全链路只用两个既有信号名（`needs_user_answer` / `pending_for_main_claude`）和一个既有 note 字段，**不发明新协议**。两个 ATS 平台的差异（Ashby 用 pending、Greenhouse 用 unanswerable，BUILD §12 已论证是有意为之）在报告层被统一吸收 | 沿用 note 字符串当契约 = 弱类型契约，驱动侧改一个 note 拼写不会有编译错误。缓解：新增测试断言「NOTE_CATEGORY 里每个键都能在 `shared/*.mjs` 里 grep 到」，改名即红 |
| **Compliance 合规** | 兑现红线「不编造个人事实」的**可执行断言**：出厂全空 + 三态阻塞 + 分类归 `user_*`。EEO 自愿披露**默认拒答**，只有用户主动说才填，问句里必须写明自愿。全部数据留在本机（与免责声明一致），留痕不外传 | EEO 在表单不提供拒答选项时会去问用户——**比今天多打扰一次**。这是有意的：另一条路是永久静默跳过该岗位且不告诉用户，那正是本轮要消灭的行为 |
| **Cost 成本** | 零新增服务、零依赖、零外部调用。用户侧问题总量：引导 3 问（**不变**）+ 门 0-1 问（只在 A0 没落盘时）+ 每批最多 4 组（**不变，既有上限**）。工程量：批次 A 约 900 行（含约 350 行测试），批次 B 约 250 行，批次 C 约 150 行 | 新增 5 个源文件 = 5 份长期维护负担。批次 B 会让「多问 1-2 组问题」成为常态，换来的是不再替用户做法律陈述——**这个换法我认为必须做，但它确实是把摩擦从系统转移给了用户** |

---

## 7. ADR（架构决策记录）

### ADR-1：按「阻塞面」分流提问时机，只有工作授权走前置门

- **Status**：Proposed（待拍板人确认）
- **Date**：2026-07-25
- **Context**：两条既有约束打架——「问题集从真实表单反推 + 压缩」（已实现、带覆盖校验）vs「工作授权缺失会让 100% 的行投不出去」。用户口述希望「投递前问完」，但他自己 2026-06 拍板过「不做投递前探测」。
- **Decision**：定量判据——**某事实缺失导致阻塞的行占比 ≥ 80% ⇒ 前置一道门；否则一律走投递后压缩提问。** 今天只有 `authorized_to_work_us` 与 `requires_sponsorship_future` 越线。这道门不探测任何表单，只是把引导 A0 的既有问题变成代码断言。
- **Consequences**：+ 第一批不会空跑；+ 上手门槛不变（仍是 3 个硬边界问题）；+ 判据可量化、以后新字段照着量就行。− 多了一个「批次可能在开工前被拒」的失败模式，说明书要教会主对话怎么处置。− 阈值没有真实批次数据背书，第一批真投后须复核。
- **Alternatives**：① 全部投递后问 → 第一批 100% 空跑，用户等 20 分钟看到 0 投递（**这正是 lead 点名禁止的中间态**）。② 全部投递前问 → 违反 2026-06 拍板，上手门槛从 3 问抬到 20 问，直接打击「有人用」。③ 缺工作授权时只跳过受影响的行、不拦整批 → 因为受影响的是全部行，等价于方案 ①。

### ADR-2：出厂模板一律 null，把「谁说的」做成结构性事实

- **Status**：Proposed
- **Date**：2026-07-25
- **Context**：本轮全部缺陷的共同根因是「代码分不出用户亲口说的和出厂默认」。RISK_REPORT 的决定性证据：真实档案的 5 个人口统计学值与模板出厂值**逐字节完全一致**，而引导流程从没问过这些题。
- **Decision**：所有「关于用户本人」的字段出厂一律 `null` / `""`，并在同一个 JSON 块里用 `_notes` 写清楚为什么空着（沿用 `legal_attestations` 与 `demographics` 的既有体例）。**非 null ⇒ 一定有人说过**，这个不变量由测试守卫。
- **Consequences**：+ 免费拿到 90% 的来源可区分性，零运行期开销；+ 与 `intake-and-profile.md:70-71` 那句 `nullable unless explicit` 终于对齐（今天模板自己违反自己的规范）；+ `validate_user_profile.mjs:71` 用的是 `typeOfNullable`，null 合法，**校验器不用改**。− 模板从「能直接跑的示例」退化成「形状说明」，照抄模板的人会得到一份必须补齐的档案（这正是想要的）。
- **Alternatives**：① 每个字段包 `{value, source}` → 全仓 40+ 读点要改，两个超限驱动净增必须为 0，**物理上做不到**。② 留预填但另存一份「出厂值快照」做对比 → 用户碰巧同意默认值时无法区分，等于没解决。③ 只清工作授权、留住其它 → 下一个平台照样复发（RISK_REPORT 教训第 2 条）。

### ADR-3：缺口分类改由「驱动发出的 note」主导，题面正则退为兜底

- **Status**：Proposed
- **Date**：2026-07-25
- **Context**：`classifyField` 今天靠一条约 40 个分支的题面正则（`:137`）判断归属，而题面来自各家表单、写法千奇百怪。同一件事驱动内部其实已经有精确标识（note），却在 `collectFields` 里被丢掉了。
- **Decision**：`collectFields` 保住 note（把整个 blocker 对象传下去）；`classifyField` 先查 note→类目表（**只查字段自己的 note**），查不到再走原有题面正则。个人事实从超长正则里摘出来，改成「档案里有明确值才算系统能填」——照抄同文件 GPA `:171` 与语言 `:166-170` 的既有正确写法。
- **Consequences**：+ 分类准确度不再依赖题面措辞；+ 新增一类问题的成本从 4 处改动降到 2 处；+ 与红线原文（`PRD-v3.md:230` 指定 `user_*` 分类为执行机制）终于一致。− note 是弱类型契约，拼写改了不会编译报错（用 grep 断言测试兜住）。− 必须只读字段级 note，读了那个带行级 reason 兜底的变量就会张冠李戴（§1.3）。
- **Alternatives**：① 继续加长那条正则 → 越长越脆，且解决不了「档案有值时不该再问」这一半。② 让驱动直接输出类目名 → 把产品分类知识塞进两个超限驱动文件，净增必须为 0，且分类逻辑会分裂成两份。

### ADR-4：来源留痕只用于报告与审计，不参与填表判断

- **Status**：Proposed
- **Date**：2026-07-25
- **Context**：有了 `answer_provenance.json` 之后，很自然会想「只有 source=user_answer 的值才允许填表」。
- **Decision**：**不这么做。** 填表判断只看三态值（已实现、已被 146 条测试覆盖）。留痕只用于：队列门显示来源、F6 审计、以及将来判断哪些事实值得复核。现有真实用户的档案没有留痕，一次性回填为 `legacy_unverified`，**不因此改变任何填表行为**。
- **Consequences**：+ 状态空间不翻倍（三态 × 五种来源 = 15 种组合的噩梦）；+ 现有唯一用户逐格零变化；+ 留痕文件损坏 / 丢失不影响投递，是纯增益组件。− 「用户亲口说的」和「模型从简历推断的」在填表时同等对待。缓解：`intake-and-profile.md:145-147` 本来就禁止把签证 / GPA / 人口统计学 / 法律声明 / 背景调查 / 搬迁标成推断值，本设计在写回口再加一道白名单，等于把那条禁令也落成了代码。
- **Alternatives**：① 留痕参与判断 → 现有用户所有字段变成 `legacy_unverified`，第一批全部阻塞，**当场制造"比现在更糟"的中间态**。② 不做留痕 → 队列门无法回答「这个值是谁说的」，F6 也没有地基。

### ADR-5：答案写回必须走代码，白名单等于问题模板

- **Status**：Proposed
- **Date**：2026-07-25
- **Context**：今天 `SKILL.md:428` 写的是「用户答完后更新档案」——一句给模型的自然语言指令。`PROJECT_MEMORY.md` 第 1 条长期原则的实证正是：**写在文档里的红线等于没有。**
- **Decision**：新增 `record_profile_answers.mjs`，可写路径集合**由问题模板的 `profile_paths` 生成**（模板即权限）。类型不匹配 Fail Fast（三态字段只收 `true` / `false`，`"yes"` 一律拒绝）。写后立刻复跑校验器，失败整体回滚。
- **Consequences**：+ 「问了什么」和「能写什么」在结构上不可能脱节；+ 答案落在驱动读的同一个 `profile.json`，**下次复用是自动的、不需要额外机制**；+ 主对话不再有机会手写 JSON 写错字段名（`standard_answers` 那类错配的成因）。− 想临时改一个没在模板里的字段就得先加模板（有意为之）。− 多一个 CLI 要维护、要写用法说明。
- **Alternatives**：① 继续让模型直接写 JSON → 就是今天这个 bug 的成因，直接违反项目记忆第 1 条。② 让缺口报告自己写回 → 报告是只读分析工具，让它有写档案的权限会把两个职责焊死。

### ADR-6：EEO 自愿披露在表单不提供拒答选项时，问用户而不是静默跳过

- **Status**：Proposed
- **Date**：2026-07-25
- **Context**：驱动对 EEO 五题一律拒答（上一轮已统一）。但如果某张表单的下拉框里根本没有「不愿回答」这个选项，这一行就会永久卡住。今天这类字段被判成 `agent_profile_backed`，系统被告知「你自己从档案里填」，而档案是空的。
- **Decision**：档案里该项为 null 时归 `user_demographics_eeo`（priority 15，排在所有实质缺口之后）；问句必须写明自愿、必须提供「跳过这些岗位」这个出口；用户的拒答被**当作一个正式答案记下来**（`demographics.* = "Prefer not to say"`，来源 `user_answer`），此后永不再问。
- **Consequences**：+ 用户的拒答第一次成为「他自己的选择」而不是工厂预填；+ 不再有静默永久卡住的行。− 会新增一次打扰（只在表单真的没有拒答选项时）。− **需要修改一条现有测试断言**（`test/apply_gap_report.test.mjs:135`），见 §12.4。
- **Alternatives**：① 新建一个 `system_eeo_declined` 类目、永不问用户 → 表单没有拒答选项时该行永久静默卡死，且技术上绕开了红线点名的 `user_*` 机制。② 维持现状归 `agent_profile_backed` → 就是今天的死循环。

### ADR-7：工作授权改问「你是哪一种人」，不问「你有没有授权」；「说不清楚」是一个有出口的正式状态

- **Status**：Accepted（关卡 3 ① 拍板 + 验收发现的文档矛盾一并解决）
- **Date**：2026-07-26
- **Context**：原问法是「你在美国的工作授权属于哪一种？」四选一。拍板人的原话是**「这没人能知道」**——
  「我有没有工作授权」是一个**法律结论**，而不是一个用户能从自己生活里读出来的事实；
  一个 F-1 学生要回答它，得先知道 CPT / OPT / EAD 与「授权」的关系。让用户做法律判断，
  等于把出错的责任转嫁给他。同时验收查出「不确定」这条路是死的：引导说明书说留 null（门永远拦着 = 死锁），
  本设计 §6 说写 `false`（那是一次编造）。
- **Decision**：① 问句改成**对号入座式的身份问题**——问的是用户查得到、说得出的身份与证件事实
  （你是不是美国公民或绿卡持有者？你是不是持 F-1 的留学生？你手上有没有已经批下来的 CPT / OPT？），
  **一次一个、每个都是是非题**；② 三个布尔由代码从身份答案**推导**，用户不接触布尔；
  ③ 「说不清楚」不写任何布尔，只把原话记进 `visa_status`，并给出**具体的查证去处**
  （学校国际学生办公室 / 你的 I-20 或 EAD 卡 / 学校发的工作许可邮件），本批不投、下批再来；
  ④ 同一批内不再重复问同一件事。
- **Consequences**：+ 用户回答的是他知道的事，不是他得判断的事；+ 「不确定」从死胡同变成一次知情的暂停；
  + 与法律声明那一组「不确定 = 我跳过这些岗位，不替你回答」的既有出口体例统一。
  − 问题从 1 个变成 2-3 个是非题（但都更好答）；− 身份→布尔的映射表成为一处必须维护的知识，
  它必须**只覆盖能确定的情形**，覆盖不到的一律落到「说不清楚」而不是猜。
- **Alternatives**：① 保留四选一 → 拍板人明令否决。② 让用户自己填三个布尔 → 更糟，等于把内部数据结构摊给用户。
  ③ 「不确定」时写保守的 `false` → 就是被本轮否掉的那条（编造，且方向有害）。

### ADR-8：状态目录的上锁改在「写入侧」，并保留一次全量补锁；不给上锁脚本加第二个调用点

- **Status**：Accepted（lead 关卡后裁决：不打绕行补丁，并入批次 B）
- **Date**：2026-07-26
- **Context**：`secure_profile_files.sh` 只有一个调用点（引导第 2 步），那时要保护的文件多半还没生成；
  它的覆盖面也只有 3 个 JSON。而状态目录盘点实测：`cover_letter.pdf`、50 张投递截图（**含明文邮箱电话**）、
  38 份求职信全部是 644，**同机其他账号可读**，且**全仓库没有任何一行代码在管它们**。
- **Decision**：**谁写文件谁负责上锁**——在每一个产出个人数据的写入点落 `chmod 600`（截图统一收口在
  `cdp.mjs` 的落盘处、求职信在 `cover_letter_materials.mjs`、档案类已在批次 A 做到）；
  另加**一次全量补锁**（`state_file_lock.mjs --sweep`），挂在每次真实批次开工前的 preflight 与
  `secure_profile_files.sh` 里。
- **Consequences**：+ 新产生的文件天生就是 600，不再依赖「有没有人记得跑那个脚本」；
  + 补锁能覆盖**没有生产方的文件**（`cover_letter.pdf` 是用户手放的，只有扫描能管到它）；
  + 上锁脚本不再自己维护第二份清单，两处不会再走偏。
  − 多一个模块；− 补锁每批多几毫秒的 `stat`/`chmod`。
- **Alternatives**：① 在引导说明书里再加一次脚本调用 → **绕行补丁**：求职信、截图一个也管不到，
  而且给下一轮埋一处要拆的旧代码。② 只手动 `chmod` 一次 → 下一份新文件仍是 644，等于没做。
  ③ 把状态目录整体改成 700 → 看似一劳永逸，但它是用户自己要进去看报告和截图的目录，
  且 Chrome 会话目录在其中，动它风险落在唯一能用的主链路上。

### ADR-9：投递留证的文件名由代码按页面实际文案决定，且必须整页截图

- **Status**：Accepted
- **Date**：2026-07-26
- **Context**：取证实测——**6 张文件名写着 `success` 的截图，页面上写的是「We couldn't submit your application」**
  （同一岗位 7 天内重复投递被拦），另有 3 张 `post_submit` 画面里根本没有提交确认。
  更根本的是：50 张全是**单屏**截图，而工作授权、担保、学历、退伍军人这几类题在表单中下部，
  **拍摄的两个时机（提交前视口停在顶部 / 提交后已跳确认页）结构性地拍不到它们**——命中率 2/50，
  等于没有取证价值。而文件名是**技能说明书里的一段 bash 字符串**拼的，判定权在模型手里。
- **Decision**：① 把「截图」这件事从说明书的 bash 行收进代码（`submission_evidence.mjs`）；
  ② **先读页面文案、判出结果，再按结果命名**：`submitted` / `not_submitted` / `unknown`——
  **读不出来一律写 `unknown`，禁止默认写成功**；③ 提交前那张改成**先滚到底、再整页截图**；
  ④ 落盘即 600（与 ADR-8 同一个收口）。
- **Consequences**：+ 「我投出去几家」这个用户最在意的数字不再被文件名污染；
  + 截图第一次真的能当证据用（能拍到中下部那些题）；+ 保留策略终于有了可执行的分层依据
  （成功的留、失败的留 90 天）。− 整页截图更大（表单页约 2-4 倍），需要配合保留策略；
  − 页面文案判定是启发式的，判不准时会得到 `unknown`——**这正是要的**：不确定就说不确定。
- **Alternatives**：① 只改文件名后缀不改取景 → 数字不再撒谎，但截图仍然拍不到该拍的东西，
  取证价值还是零。② 保持说明书里拼名字、要求模型先看页面 → 又一条「给模型的指令」，
  本项目全部缺陷的成因就是这个。③ 干脆不截图 → 免责声明对外承诺了投递留证，单方面撤回不行。

### ADR-10：出厂模板的体检从「顺着代码扫」改成「逐键扫模板」，并把它固化成一条测试

- **Status**：Accepted
- **Date**：2026-07-26
- **Context**：见 §10.2。原来的十一处清单是顺着驱动代码里的写死答案扫出来的，
  这种扫法对「合法代码 + 被污染的输入」这一类完全失明——搬迁意愿、GPA、最早到岗日、
  渠道、工作方式五处全落在盲区里，其中搬迁意愿还明确写在红线原文的点名清单上。
- **Decision**：新增一次方向相反的扫描（逐键读出货模板，问「这个值会不会被送到雇主面前」），
  并把它固化成 `personal_facts_guard.test.mjs` 里的**反向白名单守卫**：模板里每个非空叶子键
  都必须在理由表里登记「配置」或「已论证的例外」，否则测试红。
- **Consequences**：+ 第 19 处不会靠人的自觉去发现；+ 新人加一个出厂值时会被当场问住「这是配置还是陈述」。
  − 理由表要维护；− 会把一批无害的占位符（示例姓名、示例邮箱）也拉进登记范围
  （**这是可接受的**：登记一次成本极低，而占位符正是本节 O 项那个洞的来源）。
- **Alternatives**：① 只补七行清单 → 扫法没变，下次照漏。② 把模板改成「全空」 → 配置类字段
  （最低匹配分、批次节奏）没有出厂值就跑不起来，会把上手门槛推给用户。

---

## 8. 跨栈一致性字段对照表

本项目没有数据库表承载个人事实（`jobs.db` 只存岗位与投递结果），所以「跨栈」这条链是：**档案 JSON → 纯判定模块 → 驱动填表/阻塞 → 结果 JSONL → 缺口报告 → 问题模板 → 写回口 → 回到档案 JSON**。全链只允许一套字段名。

| 档案 JSON 路径 | 类型 | 纯判定模块 | 驱动侧信号 | 结果 JSONL 里的 note | 缺口报告类目 | 问题模板 `profile_paths` | 写回口白名单 |
|---|---|---|---|---|---|---|---|
| `work_authorization.authorized_to_work_us` | `boolean\|null` | `deriveWorkAuthAnswers` → `authorizedAns` / `authorizedNeedsUser`；门 `blockingProfileGaps` | GH `:1512` `needs_user_answer`；Ashby `:546` `pending_for_main_claude` | `work_authorization_required` | `user_work_authorization` | 同左路径 | 允许（boolean 强类型） |
| `work_authorization.requires_sponsorship_future` | `boolean\|null` | 同上 → `sponsorAns` / `sponsorNeedsUser`；门 | 同上 | `sponsorship_future_required` | `user_work_authorization` | 同左路径 | 允许（boolean） |
| `work_authorization.requires_sponsorship_now` | `boolean\|null` | `workAuthWithoutRestrictionAnswer`（批次 C 复核） | — | — | `user_work_authorization`（同组作答） | 同左路径 | 允许（boolean） |
| `work_authorization.visa_status` | `string` | `authSummary`（`answer_templates.mjs:9-19`）、非移民签证分支 | — | — | `user_work_authorization`（同组作答） | 同左路径 | 允许（string） |
| `legal_attestations.no_prohibited_possessor_status` | `boolean\|null` | 批次 B：`prohibitedPossessorAnswer()` | GH `:731` `needs_user_answer` | `legal_attestation_required` | `user_legal_attestation` | 同左路径 | 允许（boolean） |
| `legal_attestations.at_least_18` | `boolean\|null` | 批次 B（待拍板） | 批次 B | `legal_attestation_required` | `user_legal_attestation` | 同左路径 | 批次 B 起允许 |
| `legal_attestations.conflicting_obligations` | `boolean\|null` | 既有 | GH `:626` | `contractual_obligations_answer_required` | `user_compliance_relationship_or_restriction` | 既有 | 既有 |
| `legal_attestations.relatives_in_federal_government_or_contractors` | `boolean\|null` | 既有 | GH `:656` | `government_related_relative_answer_required` | `user_government_relative_compliance` | 既有 | 既有 |
| `demographics.race` / `.hispanic_or_latino` / `.gender` / `.veteran_status` / `.disability_status` | `string\|null` | 驱动候选表（拒答优先） | 填不进去时留在 `missing` | —（无 note，走题面正则 + 档案有无值） | `user_demographics_eeo` | 同左五路径 | 允许（string） |
| `personal.address_city` / `.address_state` / `.address_country` | `string` | `currentResidenceYesNoAnswer` | GH `:1465` / `answer_routing.mjs:145` | `profile_full_address_required` / `current_residence_required` | `user_full_address` | 既有五路径 | 既有 |
| `education.degree` | `string` | `isGraduateDegree`（含词边界） | 批次 B 起三态 | `education_credentials_required`（批次 B 新增） | `user_education_credentials`（批次 B） | 批次 B | 批次 B |
| `education.currently_enrolled` | `boolean\|null` | 批次 B：`enrollmentAnswer()` | 批次 B | `education_credentials_required` | `user_education_credentials` | 批次 B | 批次 B |
| `education.gpa` | `string` | 既有 | 既有 | — | `user_gpa` | 既有 | 既有 |

**批次 B 新增的四条链（2026-07-26）**：

| 档案 JSON 路径 / 载体 | 类型 | 纯判定模块 | 驱动侧信号 | 结果 JSONL 里的 note | 缺口报告类目 | 问题模板 `profile_paths` | 写回口白名单 |
|---|---|---|---|---|---|---|---|
| `legal_attestations.at_least_18` | `boolean\|null` | B2：`atLeast18Answer()` | GH `:718` 改三态 | `legal_attestation_required`（复用） | `user_legal_attestation`（复用） | 同左路径 | B 起允许（boolean） |
| `standard_qa.preferred_work_arrangement` | `string` | B2：Lever `:268` 改阻塞 | Lever 新增 | `location_not_in_profile_preferences`（复用） | `user_work_location_commitment`（复用） | 既有 | 既有 |
| `work_authorization.*`（Lever 侧） | 同上四键 | 复用 `deriveWorkAuthAnswers()` / `workAuthGapFor()` | Lever `:265` `:266` 改三态 | `work_authorization_required` / `sponsorship_future_required`（复用） | `user_work_authorization`（复用） | 同左路径 | 已允许 |
| 投递留证文件名 | 文件名后缀 | B3：`submissionVerdict(bodyText)` | 页面文案 | 不进 JSONL（落在文件名与报告里） | —— | —— | —— |

> **这四条全部复用既有 note 与既有类目，零新增类目。** 这是本设计一以贯之的取舍：
> 新增一个类目要同时动模板、映射表、重试白名单、提问分组四处，而复用只动判定一处。

**命名风格转换**：全链路统一用下划线小写（`authorized_to_work_us`），**不做任何驼峰转换**。唯一的风格差异发生在纯函数模块内部的局部变量名（`authorizedAns` / `sponsorNeedsUser`），它们**不跨模块传递、不落盘、不进 JSON**，只是函数内部命名。留痕文件的 key 直接用点分档案路径（`work_authorization.authorized_to_work_us`），与问题模板的 `profile_paths` 逐字一致——**这一条由测试守卫**（留痕 key 必须能在模板白名单里找到）。

---

## 9. 本项目铁律对照

> `.claude/arnold/roles/architect.md`（architect 岗位补充说明）**不存在**（同目录只有 `_README.md` / `builder.md` / `lead.md`）。以下逐条对照 `PROJECT_MEMORY.md` 四条长期原则、`builder.md` 的三条家规、以及登记表 `ci_smoke` 已填格。

| 铁律 | 本设计怎么兑现 |
|---|---|
| **红线必须落成代码断言，写在文档里的红线等于没有** | 三处落断言：① 那道门是 `supervisor_preflight` 的 `checks` 项、硬失败拦批次（不是提示）；② 写回口的白名单由问题模板生成、越界 exit 2；③ 出厂全空由 `personal_facts_guard.test.mjs` 守卫。**并且明确废掉了两句"给模型的指令"**：`SKILL.md:428` 的「更新档案」改成调命令，`intake-and-profile.md` 的 A0 落盘改成调命令 |
| **三态字段绝不允许用真假判断读** | 门只认 `=== true` / `=== false`，其余（含字符串 `"true"`）一律算没回答；写回口对布尔路径**拒绝任何非布尔输入**，不做强转；批次 B 的四处（B/D/F/G）全部改成显式三分支 |
| **单用户期的测试必须喂「不像我」的档案** | 新增测试一律喂三类档案：现有真实用户（F-1 OPT）、与他相反的（美国公民 / 明确未获授权）、以及**全空**。`missing_info_loop.test.mjs` 的主用例用的就是全空档案 |
| **投递时"填了什么"必须留痕** | 批次 A 建地基（`answer_provenance.json` 记来源），F6 的字段级投递留痕排批次 C 单独设计。**没有假装本轮解决了 F6**。**2026-07-26 补**：批次 B 的投递留证（§13.7）是这条铁律的另一半——它管的不是「档案里的值哪来的」，而是「这一次投递到底成没成、页面当时长什么样」。取证已证明：**这两层留证今天都记不住「填了什么」**，所以两半都得做 |
| **测试必须串行跑**（`builder.md`） | 新增测试全部用临时目录 + `onboardTestEnv(home)` 的既有夹具体例，不共享真实家目录；沿用 `npm test` 自带的 `--test-concurrency=1` |
| **交活前 CI 四步全跑**（`builder.md`） | 写进 §12.6 验收标准，且点名 `public_alpha_gate` 的 500 行门禁（上一轮真红过一次） |
| **主流程冒烟优先**（登记表 `ci_smoke.main_chain`） | 主流程是「简历上传 → 分析定岗 → 找岗 → 大批量一键投递 → 报告 → 跟进」。本设计只在「一键投递」前加一道**只在缺值时才触发**的门，现有真实用户档案完整 ⇒ `npm run demo:check` 行为不变。验收要求实测 exit=0 |
| 登记表 `ci_smoke.schema_upgrade_path` / `isolation_field` 两格为空 | 本设计**无数据表结构变更**（§5 第 4 条那个需要改表的想法被明确拆出本轮）；单用户本机产品，无多租户隔离字段 |

---

## 10. 同类编造逐条处置（原十一处 + 2026-07-26 补进的第 12-18 处）

> 排序 = 建议动手顺序。行号沿用 BUILD 第 16 节（同模式扫描结果）的改后行号。
> **本节 2026-07-26 从十一处扩到十八处**，新增七处 + 一段「为什么原表会漏掉它们」的方法论复盘，见 §10.1 与 §10.2。

| # | 位置 | 性质 | 处置 | 落哪批 | 改完之后新用户的实际体验 |
|---|---|---|---|---|---|
| **I** | `profile.template.json:41-43` | **出厂预填身份事实**——本轮的要害 | **改**。`authorized_to_work_us` / `requires_sponsorship_now` / `requires_sponsorship_future` → `null`；`visa_status` → `""`；加 `_notes` 说明为什么空着（与 `legal_attestations:48` / `demographics:55` 同体例）。**校验器不用改**（`validate_user_profile.mjs:71` 的 `typeOfNullable` 本来就允许 null） | **A（最后一个提交）✅ 已落地 `93cc41f`** | 引导 A0 答完 → 门放行 → 正常投。A0 没落盘 → 开工前 2 秒被问一句 → 答完正常投。**任何路径都不会出现"全都卡住且不说为什么"** |
| **D** | `:719` `:720` `:725-726` + 同组另外 5 处（`mental defective` / `dishonorable` / `renounced citizenship` / `nonimmigrant visa` / `alien unlawfully`） | **编造法律事实**，且**同一份联邦表格的同一组题被拆成两套标准**：紧邻的重罪题（`:728-731`）没问过就阻塞，这 8 条却直接答 `No` | **改**。这 10 条其实是同一份联邦禁枪清单（fugitive / illegal alien / controlled substance / mental / dishonorable / renounced / restraining order / indictment / domestic violence / felony），档案里对应的就是**一个** `legal_attestations.no_prohibited_possessor_status`。合并成一条与 `:728-731` 逐字同款的三态分支：`=== true → 'No'`（带 `profile_no_prohibited_possessor_status` 溯源）；`=== false` 或 `null` → 阻塞（`legal_attestation_required`）。**注意 `false` 也必须阻塞**——用户说「我有某项问题」时，具体是哪一项无法推导。**10 条分支合并成 1 条，净减约 6 行**，正好给 B/F/C 腾出驱动的行数额度 | **B** | 引导 A2 明确确认过 → 这 10 题全部自动答 `No`（和今天一样，但有据可查）。没确认过 → 这些行停下，批次结束后**一个问题**覆盖整组（不是 10 个问题）。**注意：引导 A2 今天就在问这件事**（`intake-and-profile.md:14`），所以走完引导的用户体感不变 |
| **B** | `:1614` / `:1694` 的 `\|\| 'No'` + `:428` 的 `no_specific_current_location` | **编造居住地事实**（对没填城市的用户直接答「我不住那儿」），而且 `\|\| 'No'` 会把将来任何阻塞返回值悄悄吃掉 | **改**。去掉 `\|\| 'No'`；`:428` 在题面没提到任何已知城市时返回 `{needs_user_answer:true, note:'current_residence_required'}` 而不是 `'No'`。该 note 已在批次 A 的映射表里指向 `user_full_address`（复用既有类目与既有分组，**不新增类目**） | **B** | 档案里有地址（引导会从简历读）→ 行为不变。没地址 → 这题停下，批次结束后并进「地址与通勤」那一组问题一起问（既有分组 `location_and_logistics`） |
| **C** | `:718` 「你是否至少 18 岁」写死 `Yes` | **编造年龄事实**。风险低但真实（大一新生可能 17 岁），且和 D 项属同一类「替用户做法律陈述」 | **🔒 已拍板（关卡 2 ②）：引导时问一次，不默认、不阻塞。** 拍板结果是我给的两个选项**之外**的第三条路。落法：① 新增 `legal_attestations.at_least_18`（三态）；② **引导 A2 那一组里加半句「你已满 18 岁了吗」**，答了就写进档案；③ 填表时 `=== true → 'Yes'`、`=== false → 'No'`、**`null` → 走既有的 `user_legal_attestation` 提问路（投递后问），不进开工前那道门**。④ 写死的 `'Yes'` 无论如何要删——它是本项目里唯一一处「明知是事实却因为通常成立就替用户答」的残留。**我原来的思路错在哪**：我把它当成「阻塞 or 不阻塞」的二选一，忘了本设计自己的分流判据（阻塞面 ≥ 80% 才进门）——年龄题的阻塞面远低于 80%，本来就该走投递后那条路，只是**引导里顺口问一句可以让它连投递后都不用问** | **B** | A2 答过 → 无感；没答 → 和 D 项同一个问题一起问（不是新增一个问题） |
| **F** | `:442` `currently_enrolled === true` 否则 `'No'` | 三态压两态：没填学籍 → 答「我不在读书」 | **改**。三态；`null` → 阻塞（`education_credentials_required` → 新类目 `user_education_credentials`）。注意模板 `:36` 的 `currently_enrolled: true` 也是出厂预填，一并置 `null` | **B** | 引导会从简历读出在读状态（毕业日期在未来 ⇒ 在读），绝大多数用户无感。真读不出来 → 问一句 |
| **G** | `answer_templates.mjs:12-14` | 三态压两态，而且是**写进求职信 / 作文正文**：没问过就替用户宣称「不需要未来担保」 | **改，但处置方式与其它几条不同——不阻塞。** 理由：这是一句作文里的从句，把整篇作文卡住不划算，而且这句话是**可以省略的**。改法：`=== true` → 保留现有「可能需要未来担保」；`=== false` → 现有的「不需要未来担保」；`null` → **整个从句不渲染**，只输出 `visa_status`；连 `visa_status` 都没有 → `WORK_AUTH_SUMMARY` 渲染成空串（模板引擎 `:51` 本来就把未知键渲染成空串，行为一致）。**这是"少说一句"而不是"编一句"**，符合红线 | **B** | 无感（作文里少一句没人会填的话）。批次 A 的门已经保证了工作授权基本不会是 null，所以这条实际很少触发——但留着就是下一次事故的火种 |
| **A** | `answer_bank.json:118-119` + 两个驱动的内置兜底 bank | 本轮后已成**死配置**（全仓库 0 处读），但字面仍写着「工作授权 = Yes」 | **删**。同时删两个驱动内置兜底 bank 里的同名键，并更新 `test/json_shapes.test.mjs` 的形状断言。BUILD §15 方向 3 已经加了「谁再读这两个键就测试红」的守卫，删掉是把火种也一并清走 | **C** | 完全无感 |
| **E** | `:1640-1641` 退伍军人候选表 `'No'` 排第一 | 若某家表单恰好提供裸 `No` 选项，仍会先选它（事实陈述优先于拒答） | **改**。把 `'No'` 移到三个拒答选项之后，与同文件性别 `:1638`、种族 `:1641` 的写法对齐。1 行 | **C** | 无感（标准 Greenhouse 退伍军人下拉一般没有裸 `No`，今天大概率已经落到拒答——但那是运气不是设计） |
| **H** | `:588-595` `workAuthWithoutRestrictionAnswer()` 未知时返回 `'No'` | 「没问过却答了」，但方向**对用户不利**（少宣称），不是抬高自己 | **🔒 已拍板（关卡 2 ③）：改成阻塞，问清楚再投。我的建议被否掉了。** 落法：该函数在两个布尔任一非布尔时返回 `{needs_user_answer:true, note:'work_authorization_required'}`（复用既有 note 与既有类目，零新增）。**拍板人的理由比我的成本账更硬**：我算的是「多卡几行 vs 多问一句」，他指出的是**答错的双向代价**——国际生被说成「有不受限制的授权」是不实陈述，公民被说成「没有」会被直接刷掉。**要记住的教训**：当一个字段答错的两个方向都伤用户时，「保守方向」并不存在，唯一正确的动作是问 | **B**（从 C 提前——它现在是一处会主动出错的编造，不是收尾优化） | 档案齐全 → 无感；不齐 → 与工作授权同一组问题一起问，不新增问题 |
| **K** | `:1594` 国家写死 `'United States'` | 档案里明明有 `personal.address_country` 却不读 | **改**。读档案，缺值时保留 `'United States'`（模板 `:27` 的这个预填是**地址格式默认**不是身份事实，且本产品明确只服务美国岗位，保留合理——但这一条要在模板 `_notes` 里写明白，免得下次盘点又被当成同类问题） | **C** | 无感 |
| **J** | `:1632` 「是否考虑全职」写死一句固定话术 | 编造求职意向（非身份事实，危害最低） | **改**。读 `search_intent.role_type_targets`：含 `new_grad_FT` → 「考虑全职」；只有 `intern` / `part_time` → 保留现话术；读不到 → 保留现话术（**不阻塞**，这是偏好不是事实） | **C** | 无感或更准 |

**原十一处的处置总览（2026-07-26 更新）**：11 处**全部要改**——原来标「待拍板」的 C / H 两处
已由关卡 2 拍板（C = 引导时问一次、不阻塞；H = 未知即阻塞），处置改法见上表两行。
其中 I 已在批次 A 落地（提交 `93cc41f`），其余 10 处仍在批次 B / C。

---

## 10.1 补进来的第 12-18 处（2026-07-26 新增）

> 前四条来自验收与施工实测（12、13 有出处），后四条是我这次**换了一种扫法**重扫出来的（14-18，出处是我逐行读代码 + 逐键读出货模板）。
> 判据一律是派遣单给的那句：**「关于用户本人的事实，被出厂模板预填、或在代码里写死」**。

| # | 位置 | 性质 | 处置 | 落哪批 | 状态 |
|---|---|---|---|---|---|
| **L** | `profile.template.json` 的 `standard_qa.willing_to_relocate_scope: "Anywhere US"` 与 `target_filters.relocation_policy: "anywhere_primary_country"`（另有 `willing_to_relocate: true` 是同一句话的第三个副本） | **出厂预填搬迁承诺**。验收实跑出货驱动：五种档案在「你愿意搬到我们纽约办公室吗」上全部阻塞，**唯独出厂模板答 `Yes`**。两个键**各自足够触发**（逐键删除二分复核过），不是一条链的两个环节。而 `relocation`（搬迁）**明确写在红线原文的点名清单里** | **已修**（提交 `91e2708`）：三处出厂值清空，处置与 I 项逐字同款（出厂置空 + 缺值转问用户）。闭环走既有类目 `user_work_location_commitment`，零新增类目。反向守卫已加：真答过 `Anywhere US` 或真设过 policy 的档案仍答 `Yes`，**清空出厂值绝不能变成一律拒答** | A（回炉时补做） | ✅ 已落地，本表**补登记**，防止下次盘点又漏 |
| **M** | `profile.template.json:35` `"gpa": "3.9"` | **出厂预填学业事实**，与 I 项同病。危害是**双份的**：① `greenhouse_helpers.js:372` `addText('gpa', edu.gpa)` 会把 3.9 真的填进表单；② `apply_gap_report.mjs:266` 是 `PROFILE.education?.gpa ? 'agent_profile_backed' : 'user_gpa'`——**有假值就等于「档案里有」，于是「你的 GPA 是多少」这个问题永远不会问到用户**。假数据同时污染填表和提问两条路 | **改**：`gpa` → `""`。走完引导的用户不受影响（引导用简历重写档案），受害的是照抄模板的人 | **B** | 待做（施工时已扫出并排队） |
| **N** | `profile.template.json:32` `"degree": "B.S. in Your Major"` | **占位符被当成事实解析**。`isGraduateDegree()` 读到这个字符串 → 判定「不是研究生学位」→ 表单上「你是否在读硕士 / 博士项目」被答 `No`。用户从没被问过，占位符替他答了 | **改**：模板 `degree` → `""`，并要求 `isGraduateDegree()` 对空串返回**未知（阻塞）而不是 false**（与 §12.7 第 5 条那条「只看一个字段」的遗留一并处理） | **B** | 新增 |
| **O** | `profile.template.json:77` `"earliest_start_date": "MM/DD/YYYY"` | **占位符是真值**，后果同 M 的双份：① `greenhouse_helpers.js:376-378` 把字面 `MM/DD/YYYY` 填进「earliest start / start date / available」三类题；② `apply_gap_report.mjs:195` 的 `!!standard.earliest_start_date` 判它「已答」，于是「你最早什么时候能开始」永远不会问用户 | **改**：→ `""`。**并把这一类写成规则**：模板里凡是「格式占位符」（`MM/YYYY`、`MM/DD/YYYY`、`Your …`、`you@example.com`）**一律不许出现在会被真值判断读的字段上**——它们在代码眼里全是真值 | **B** | 新增 |
| **P** | `profile.template.json:70` `"how_did_you_hear": "LinkedIn"` | **出厂替用户陈述一件行为事实**（我是从 LinkedIn 知道这个岗位的）。`greenhouse_helpers.js:375` 与 `lever_apply_driver.mjs:151/234` 都会填它。危害低于身份事实，但性质相同：**用户没说过，系统替他说了**；而且它会污染雇主的招聘渠道归因 | **改，且有更好的答案**：这件事**我们其实知道真相**——这一行岗位是从哪个来源发现的，`jobs.db` 里就有。改法：模板置空；填表时读该行的来源字段，读得到就填真的（LinkedIn / 公司官网 / 岗位板），读不到就走提问。**注意代码侧还有两个孪生兄弟**：`lever_apply_driver.mjs:234` 的 `\|\| 'LinkedIn'` 与 `ashby_apply_driver.mjs:598/886` 的候选表首项，一并处理 | **C** | 新增 |
| **Q** | `profile.template.json:72-73` `why_company` / `why_role` 出厂预填两句英文占位散文 | **出厂替用户写了两句「以他的口吻说的话」**。`answer_templates.mjs:39` 用的是 `firstNonEmpty(standard.why_company, …)`——占位散文是非空的，**会被当成用户自己的答案渲染进作文题与求职信**。这不是编造事实，是**冒用口吻**，而且会让整份投递一眼看出是机器写的 | **改**：两个键出厂 `""`。`firstNonEmpty` 的下一顺位本来就是一句可用的兜底句，置空后行为更好而不是更差 | **C** | 新增 |
| **R** | `profile.template.json:91` `"preferred_work_arrangement": "Open to onsite, hybrid, or remote"` + 代码侧 `lever_apply_driver.mjs:268` 的候选表 `['Remote','Hybrid','On-site','Onsite']` | **与搬迁意愿同一族的生活承诺**：「我接受到岗办公」是雇主会当真、会据以安排面试的一句话。出厂预填了它；而且即便模板置空，Lever 的候选表兜底仍会替用户选一个 | **改两处**：模板置空；`lever:268` 在档案无值时**返回阻塞而不是挑一个选项**（复用既有类目 `user_work_location_commitment`，零新增类目） | **B**（与 L 同族，L 已修、这条是它的漏网亲戚） | 新增 |
| **S** | `lever_apply_driver.mjs:265 / :266-270 / :266 / :271 / :269` 一组 | **整个 Lever 平台从未进过本轮扫描范围**：工作授权无条件 `\|\| 'Yes'`、担保题两态压三态（没问过 = 「我不需要担保」，**对国际生方向有害**）、学籍无条件 `Yes`、年满 18 无条件 `Yes`、亲属/竞业无条件 `No` | **改**：直接委托批次 A 已建好的 `deriveWorkAuthAnswers()` / `workAuthGapFor()`，与 Greenhouse 逐字同款；其余四题按 B 批次同类处置。该文件 **489 行、离 800 上限还远，不受净增 0 约束**，工程量小 | **B**（建议）——**但范围扩张需 lead 拍板** | 新增，见 §5 第 8 条 |

## 10.2 为什么原来那张十一处的表会漏掉这些（方法论复盘，比补几行清单重要）

**原表是「顺着作案现场扫」的：**施工记录第 16 节的原话是「**在 Greenhouse 驱动里逐行找**『关于用户本人的事实问题被写死、或用真假判断读三态字段』」。
这是一次**汇点扫描（sink scan）**——从「代码里出现了一个写死的答案」这个特征出发。它有两个结构性盲区，而漏掉的七处正好全落在盲区里：

1. **盲区一：作案代码本身完全正常，被污染的是它的输入。**
   搬迁意愿（L）的填表路径是 `preferredLocationAliases() → 命中 anywhere → 答 Yes`——**这段代码没有任何写死的答案**，
   它是一段规规矩矩的、数据驱动的判定。有毒的是喂给它的出厂模板值。
   **顺着代码扫，永远扫不到它**，因为现场没有指纹。GPA（M）、开始日期（O）、渠道（P）、
   工作方式（R）全是同一个形状：**合法的读取代码 + 出厂预填的输入**。
   I 项（工作授权预填）当时能进表，纯粹是运气——它恰好被一条写死的驱动分支指着，
   所以顺着现场就撞见了它；换句话说，**十一处里唯一一处模板问题，是被别的线索捎带进来的，不是扫出来的。**

2. **盲区二：只扫了一个平台。** 原表标题就写着「在 Greenhouse 驱动里」。Ashby 靠 `answer_routing.mjs` 共用判定所以顺带覆盖了，
   **Lever（S）从头到尾没人看过一眼**——而它有真实投递记录。

**所以补七行清单不解决问题，得补一种扫法。** 加一次**源点扫描（source scan）**，方向正好相反：

> **逐键读出货模板 `profile.template.json`，对每一个非空的出厂值问一句：
> 「这个值有没有可能被原样送到雇主面前？如果会，它是在替用户陈述什么？」**

判据（写下来供以后照抄）：
- **是配置** = 只影响我们自己找岗 / 排序 / 限速，永远不离开这台机器 → 可以有出厂值（`min_fit_score`、`batch_pace`、`exclude_keywords`、`target_filters.locations`）。
- **是陈述** = 有任何一条路径会让它出现在雇主的表单、作文或求职信里 → **出厂必须为空**（本节 L / M / N / O / P / Q / R 全部属于这一类）。
- **占位符不是空**：`"MM/DD/YYYY"` / `"Your School"` / `"3.9"` 在人眼里是占位符，**在 `if (value)` 眼里全是真值**。
  它们不但会被填进表单，还会让「该问用户的问题」被判成「档案里已经有了」——**一份假数据同时毒化填表与提问两条路**。

**把这条扫法固化成机器动作（本设计要求批次 B 落地，否则第 19 处一定会有）**：
在 `test/personal_facts_guard.test.mjs` 里加一条**反向白名单守卫**——
遍历出货模板的每一个叶子键，凡值非空非零长度的，**必须**出现在一张
`FACTORY_DEFAULT_RATIONALE`（出厂默认值理由表）里，并写明它属于「配置」还是「已论证过的例外」。
新增一个有出厂值的键而不登记理由 = 测试红。
**这条守卫的价值不在拦住已知的七处，在于它把「有没有人重新扫一遍」这件事，从人的自觉变成了 CI 的动作**
——与本设计对红线的一贯处置（红线必须落成代码断言）完全一致。

---

## 11. 分批上线方案（含「不会更糟」的逐点论证）

### 11.1 批次 A：必须整批上线的四件事

**为什么这四件必须同一批**：

```
只做 ①F5 分类纠偏         → 模板还在预填 true，阻塞几乎不触发，白改
只做 ④清模板预填          → 每行都阻塞，而阻塞进不了提问清单 = 静默全跳（比今天更糟）
做 ①+④ 不做 ②写回口       → 问出来了，答案靠模型手写 JSON 落盘（本轮全部缺陷的成因，会复发）
做 ①+②+④ 不做 ③那道门     → A0 没落盘的用户要等一整批空跑（20 分钟）才被问，第一印象就废了
```

**提交顺序（同一批次内，按此顺序落 commit，任一提交点都不比今天差）：**

| 提交 | 内容 | 落地后的世界 | 比今天更糟吗 |
|---:|---|---|---|
| A1 | 缺口报告信号通路（保 note + note 映射 + 3 个新类目 + 重试白名单 + 提问模板搬家） | 阻塞的行终于能变成一句问话。但模板仍预填 `true`，所以阻塞很少触发 | **否**。纯增益：今天已经在阻塞的少数行（档案手工清空过的）从「静默」变成「会问」 |
| A2 | `record_profile_answers.mjs` + `answer_provenance.mjs` + 说明书接线 | 用户答完由代码写回、带留痕。旧的「模型手写 JSON」路径还在，但不再是唯一路径 | **否**。纯增量组件，不改任何既有判定 |
| A3 | `personal_fact_gate.mjs` + preflight 挂门 + dry-run 提示 | 门开始生效。**此时模板还预填 `true`，所以对走完引导的新用户永不触发**；只对档案确实缺工作授权的用户触发——而这些用户今天的下场是整批静默空跑 | **否**。把「20 分钟空跑」换成「2 秒一句问话」 |
| A4 | 清掉模板预填 + 守卫测试 | 出厂不再说谎。缺值由 A3 的门在 2 秒内接住，由 A1 的通路变成问话，由 A2 的写回口落盘 | **否**。三张网都已就位才拆掉这块假地板 |

**批次 A 的风险**：低。最坏情况是那道门误伤——某个用户的档案里工作授权是字符串 `"true"` 而不是布尔 `true`（历史脏数据）。缓解：`validate_user_profile.mjs:71` 本来就要求这四个键是 boolean 或 null，非布尔今天就会校验失败，所以这种档案根本进不了投递流程。**验收时必须实测一遍现有真实用户的档案形状，确认门放行。**

### 11.2 批次 B：另外 6 处编造（A 之后，可隔天）

**为什么必须在 A 之后**：B 里每一条的处置都是「把编造改成阻塞」。**A 没上线就做 B，等于把本轮这个死结原样再造一遍**——阻塞进不了提问清单，用户又一次「卡住但不知道卡在哪」。这条是硬依赖，不是偏好。

**批次内顺序（2026-07-26 重排）**：
**B0 Ashby 接线**（净增 0，必须最先——不做它，D 与 B 两项在 Ashby 侧的 note 传不出来）
→ **B1 问法改对号入座 + 身份映射 + 引导文案**（关卡 3 拍板；它决定 B2 的阻塞被问出来时长什么样）
→ **B2** D（净减行数，给后面腾驱动额度）→ B → F → C → H → G → M/N/O 模板清值 →（R、S 待 lead 定范围）
→ **B3 留证与上锁**（与前三包无耦合，但同样碰 `-auto` 技能说明书，排最后避免写冲突）。

**风险**：中。这一批会让「多问 1-2 组问题」成为常态。缓解三条：① 全部并进既有分组（D 与 C 共用一个问题、B 并进「地址与通勤」组）；② Step 6「最多问四组」的上限本来就在，不会问爆；③ 每一条都要有「现有真实用户档案逐格零变化」的实测对照表（BUILD §14 那种格式）。

### 11.3 批次 C：收尾（可拖，但别忘）

A / E / K / J + `missing_field_questions.mjs` 第 18 / 32 行两条中文问句里的被弃用旧叫法 + F6 投递答案留痕（**另出设计，不塞进本轮**）。风险低，用户无感。

### 11.4 拆分清单（给 lead 的派工建议）

| 子任务 | 派谁 | 预估改动量 | 一次还是分批召唤 |
|---|---|---|---|
| 批次 A（4 个提交，见上表） | arnold-builder | 约 900 行（含约 350 行测试），新建 5 源 + 3 测试，改 10 文件 | **一次召唤，一个施工包**。四件事互相咬合，拆开派会在提交点之间制造真空 |
| 批次 A 验收 | arnold-verify | —— | A 完成后单独召唤。重点验「新用户模拟」（全空档案走完整条路）与「现有用户零变化」 |
| ~~批次 B（原估）~~ | ~~arnold-builder~~ | ~~约 250 行~~ | **已由 2026-07-26 的修正取代，见下四行** |
| 批次 C | arnold-builder | 约 150 行 | 可与 F6 设计并行 |
| F6 投递答案留痕 | arnold-architect | —— | 另起设计，含 §5 第 4 条那个数据表结构变更的取舍 |

**批次 B 的派工建议（2026-07-26 重排后）**：

| 子任务 | 派谁 | 预估改动量 | 一次还是分批召唤 |
|---|---|---|---|
| **B0 + B1**（Ashby 接线 + 对号入座问法 + 身份映射 + 引导文案） | arnold-builder | 约 300 行（含约 120 行测试） | **一次召唤**。B0 是 B2 的前置、B1 决定 B2 的阻塞长什么样，拆开派会在提交点之间制造真空 |
| **B2**（D/B/F/C/H/G + 模板 M/N/O） | arnold-builder | 约 350 行（含约 150 行测试） | B0+B1 验收通过后单独召唤。**派工单必须带上关卡 2 的两条拍板结果**（C = 引导问一次不阻塞；H = 未知即阻塞） |
| **B2 附加：Lever（S）与工作方式（R）** | arnold-builder | 约 120 行 | **需 lead 先拍板是否纳入**（范围扩张，见 §13.6）。纳入则并进 B2 同一个施工包 |
| **B3**（留证 + 写入侧上锁） | arnold-builder | 约 400 行（含约 180 行测试） | 可与 B2 并行**但不建议**——两者都碰 `-auto` 技能说明书。建议串在 B2 之后 |
| 批次 B 验收 | arnold-verify | —— | 按 §13.8 的 8 条验。重点：真值表 20 格、「说不清楚」不死锁、现有用户逐格零变化 |
| 截图保留策略 | arnold-pm → 拍板人 | —— | **产品与合规取舍，不是工程决定**。依赖 B3 先做完（有可信判定才谈得上分层保留） |

---

## 12. 给 builder：改哪些文件、每处怎么改、测试怎么设计、验收标准

### 12.1 `shared/missing_field_questions.mjs`（先做，后面全依赖它）

1. 把 `QUESTION_TEMPLATES` 整块从 `apply_gap_report.mjs:180-247` **搬**进来并 `export`（内容逐字不变，只是搬家 + 加 `export`）。`apply_gap_report.mjs` 改成 `import { QUESTION_TEMPLATES, ... } from './missing_field_questions.mjs'`。
2. 新增 3 个模板：`user_work_authorization`(**priority 0.5**) / `user_legal_attestation`(**5.5**) / `user_demographics_eeo`(15)。字段见 §3.2 第二张表。既有条目一个都不动。
   **⚠️ 原文写的是「取 0 / 5.5 / 15」，0 是错的**——`categoryPriority()` 用 `|| 99` 兜底，0 被当假值吃掉、排序垫底。详见 §3.2 修正 2。
3. 每个模板加 `value_type` / `enum_values`，再加一个 `path_value_types` 覆盖表给例外路径用，供写回口做类型校验。
   **⚠️ 原文写的是「既有模板一律补 `value_type: 'string'`」，这是错的**——两个 `legal_attestations.*` 是 boolean、五个 `standard_qa.*` 是 object，照字面写会让写回口对一半类目直接拒写。**逐条路径核对真实类型**，详见 §3.2 修正 3。
4. 新增 `export function answerWritePaths(templates = QUESTION_TEMPLATES)`：返回 `Map<path, {value_type, categories[]}>`。
   **依赖方向：门的路径清单 `gate_paths` 声明在问题模板里，`personal_fact_gate.mjs` 从模板取（仍对外导出 `GATED_PATHS`，契约不变）；`answerWritePaths()` 对门控路径只做「必须可写」的断言，不做合并。**
   **⚠️ 原文写的是「`answerWritePaths` 并入 `GATED_PATHS`」，方向反了**：那会让 `missing_field_questions.mjs` 与 `personal_fact_gate.mjs` 互相 import 成环（前者要读门的清单、后者要读前者的模板）。而且**断言比合并强**——一个「问得出来却写不回去」的门是死路，应当在测试里当场报错，而不是被 `answerWritePaths` 悄悄补上、让缺陷藏到运行期。
5. **不要动 `QUESTION_GROUPS`**：新类目走 singleton 分支自动成为独立问题（`:160-172`），且 `validateQuestionGroups` 只校验已声明的分组。改了反而会触发 `:86` 的 profile_paths 一致性断言。

### 12.2 `shared/apply_gap_report.mjs`

1. **`collectFields` 第 91 行**：`push(b.question || b, 'blocker')` → `push(b, 'blocker')`。`fieldLabel` 已经会读 `field.question`（`:75`），传对象既拿到 label 也保住 note；传字符串仍然工作（老结果文件兼容）。第 96 行的 `obj.pending` 同样处理。
2. **`classifyField` 新增 note 查表**，位置在 captcha 检查（`:134`）之后、attestation 检查（`:135`）之前：
   ```js
   const ownNote = String(field.note || '').toLowerCase();   // 注意：不是 :110 那个带 reason 兜底的 note
   if (NOTE_CATEGORY[ownNote]) return NOTE_CATEGORY[ownNote];
   ```
   **`NOTE_CATEGORY` 表见 §3.2 第一张表，一个都不能少、一个都不能多。** `:110` 那个 `note` 变量保持原样给下面的老正则用。**这一条如果写错（读了带 reason 兜底的变量），功能看起来是好的、行为是错的**，详见 §1.3。
   **⚠️ 上面这段伪代码是不完整的（2026-07-26 修正）**：查表命中之后**必须再过一道
   `CATEGORY_ANSWERED[类目]()` 谓词**——档案里已经有答案的，归 `agent_profile_backed` 不再问。
   缺这道谓词，用户答完之后同一个问题会被永远问下去，闭环闭不上。完整论证见 §3.2 修正 1。
3. **拆 `:137` 的超长正则**，摘出下列分支另立门户（插在 `:136` 之后、`:137` 之前）：
   ```js
   // 工作授权 / 担保：档案里两格都有明确布尔才算系统能填
   if (/unlimited and unrestricted authorization|legally authorized|authorized to work|require.{0,40}sponsor|sponsor.{0,40}immigration|maintain that authorization/.test(lower)) {
     return workAuthKnown() ? 'agent_profile_backed' : 'user_work_authorization';
   }
   // EEO 自愿披露：档案里该项有值才算系统能填
   if (/gender|race|ethnic|hispanic|latino|veteran|disability/.test(lower)) {
     return eeoValueKnown(lower) ? 'agent_profile_backed' : 'user_demographics_eeo';
   }
   ```
   然后从 `:137` 的正则里**删掉**这两组已被接管的分支（`unlimited and unrestricted authorization` / `legally authorized` / `authorized to work` / `require.{0,40}sponsor` / `sponsor.{0,40}immigration` / `maintain that authorization` / `gender|race|ethnic|hispanic|latino|veteran|disability`）。
   **`bachelor` 与 `background check` 留在原处不动**（前者归批次 B 的学历类目，后者本轮无阻塞来源，见 §12.7）。
   `workAuthKnown()` = 两个布尔都 `typeof === 'boolean'`；`eeoValueKnown(lower)` = 按题面命中哪一项去查 `PROFILE.demographics` 对应键是否非 null。写成两个小函数放在 `classifyField` 上方。
4. **`RETRYABLE_CATEGORIES`（`:270-285`）补三项**：`user_work_authorization` / `user_legal_attestation` / `user_demographics_eeo`。**漏了这一步 = 用户答完了行也不会被重投**，功能等于没做。
5. **`onboarding_candidates`（`:409`）的硬编码名单补 `user_work_authorization`**。
6. 文件净减约 33 行（搬走 67 + 新增约 34），无行数风险。

### 12.3 三个新文件

契约见 §3.1，此处只补实现要点：

- **`personal_fact_gate.mjs`**：纯函数、零 IO、不 import 任何有副作用的模块（`apply_gap_report.mjs` 顶层就读文件，**不要 import 它**）。`remediation_command` 拼成一条可直接复制执行的完整命令。问句必须提供四个选项（复用 A0 的措辞）+ 一个「其他 / 不确定」出口。
- **`answer_provenance.mjs`**：`fingerprint` 用 `node:crypto` 的 sha256 取前 16 位十六进制。**只存指纹不存值**（§6 安全那一栏）。`sourceFor` 在指纹对不上时返回 `'unknown'`——陈旧留痕必须自曝，不许撒谎。`backfillLegacy` 幂等。
- **`record_profile_answers.mjs`**：流程见 §4.4。**四个退出码语义必须照做**（0/2/3/4）。原子写：写 `profile.json.tmp` → `rename` → `chmod 600`。校验失败用 `profile.json.bak` 还原后 exit 4，**把校验器的原始报错原样打出来，不要包装成友好文案**（Fail Fast，禁静默降级）。
  **补充两条（2026-07-26 按施工实测补进设计，原文没写、施工时自行补上，判定为正确）**：
  ① **写之前先跑一次校验器**。档案在本次写入之前就已经不合法时，直接 exit 4 且一个字不写——
  否则「你的档案早就坏了」会被报成「你这次的写入把它写坏了」，把用户和下一个排障的人一起带偏。
  两条路都是 exit 4，退出码语义不变。
  ② **成功之后删掉 `profile.json.bak`**。备份只在「写入 → 校验」这一小段窗口里有意义；
  长期留着 = 状态目录里多一份**没人管的个人数据明文副本**，正是本轮在清的东西。
  异常中断留下的残骸由 §13.4 的写入侧统一上锁兜底（`.bak` 已在可选上锁清单里）。

### 12.4 测试怎么设计

**先红后绿，按 `builder.md` 家规串行跑。**

| 测试文件 | 用例 | 为什么这条能抓住真 bug |
|---|---|---|
| `test/personal_fact_gate.test.mjs`（新） | ① 两格都 true → 放行 ② `authorized=false, sponsor=true` → 放行（明确回答也是回答）③ 缺一格 → 拦 ④ 整块缺 → 拦 ⑤ 显式 null → 拦 ⑥ **字符串 `"true"` → 拦**（禁强转）⑦ 现有真实用户档案形状（F-1 OPT 四格齐全）→ 放行 | ⑥ 是三态铁律的直接断言；⑦ 保证不误伤唯一在用的用户 |
| `test/record_profile_answers.test.mjs`（新） | ① 正常写入 + 留痕 ② 写白名单外路径 → exit 2 且 **profile.json 逐字节不变** ③ 布尔路径收字符串 → exit 3 且档案逐字节不变 ④ 制造校验失败 → exit 4 且档案**还原成改动前的字节** ⑤ 同一命令跑两次 → 幂等、留痕只一条 ⑥ 留痕 key 必须全部能在 `answerWritePaths()` 里找到 | ② ③ ④ 三条都断言「档案逐字节不变」——这是「要么整体更新、要么原样不动」的唯一硬证据 |
| `test/missing_info_loop.test.mjs`（新，**最重要**） | 全空档案 + 一份带 `blockers:[{question,note:'work_authorization_required'}]` 的结果 JSONL → 跑缺口报告 → 断言 `user_questions` 含 `user_work_authorization`、`retry_candidates` 含该行、`agent_actions` **不含**该行 → 照该模板的 `profile_paths` 调记录命令写回 → **重跑缺口报告** → 断言 `user_questions` 为空 | 这一条同时证明「问得出来」和「答完不再问」，是整个 F5 的闭环证明。缺了它，前面所有单测都可能各自绿着而链路是断的 |
| `test/personal_facts_guard.test.mjs`（改） | 新增：模板 `work_authorization` 三个布尔必须为 `null`、`visa_status` 必须为空串 | 防 I 项回潮（与既有 demographics 那条同款） |
| `test/apply_gap_report.test.mjs`（改） | **需要改一条现有断言**（详见下方） + 新增一条：带 note 的 blocker 分类正确、且 `field.note` 缺失时**不会**继承行级 reason（喂一个 `reason:'legal_attestation_required'` 的行 + 一个「你的 GPA 是多少」字段，断言它仍归 `user_gpa`） | 后一条正是 §1.3 那个陷阱的守卫 |

**必须改的那条现有断言（显式说明，请勿悄悄改）**：
`test/apply_gap_report.test.mjs:135` 断言 `report.user_questions.map(c => c.category)` 等于 `['user_full_address']`，而该用例的 `remaining` 里含 `Gender` 与 `Are you Hispanic/Latino?`、档案里 `demographics` 为空。按本设计它们会变成 `user_demographics_eeo`，所以断言要改成 `['user_full_address', 'user_demographics_eeo']`（注意排序：`sortQuestionItems` 先按解锁岗位数、再按 priority，两者解锁数都是 1，EEO 的 priority 15 排后）。
**改这条断言的理由**：它锁住的正是被 RISK_REPORT 判定为缺陷的行为（EEO 归「系统按档案自动填」，而档案里什么都没有）。**这不是「测试碍事就改测试」**——ADR-6 记录了完整论证。builder 交活时必须在 BUILD 记录里单独说明这次断言修改，让 verify 能复核。

> **🔧 修正 4（2026-07-26）— 那条断言有两个调用点，改一处必红。**
> - **原来怎么说**：本节写「只改 `:135` 一条断言」，读起来像「只许动一行」。
> - **为什么错**：同一条断言在**同一个用例**里出现两次——`:135` 是 `--summary` 那次调用的结果、
>   `:154` 是紧接着 `--result-dir` 那次调用的结果，**同一份夹具、同一个结果文件、同一份档案**，
>   只是换了个入参形式。只改第一处，套件必红。
> - **现在怎么说**：授权范围是**「那一条断言」，包含它的全部调用点**（本例是两行）。
>   verify 已独立核过 diff（两处确为同一断言的两次实例），lead 已认可这个读法。
>   **通用规则：以后凡授权改某条断言，写的是「这条断言」不是「这一行」，
>   施工时必须把它在同一用例里的全部实例一并改并逐一说明。**

### 12.5 说明书改动（注意 500 行门禁）

- `SKILL.md`：**净增 ≤ 4 行**。Step 5 身份块把 `<visa 状态>` 改成 `<visa 状态>（来源 <source>）`（0 净增）；Step 6「After the user answers, update ... as needed」改成调 `record_profile_answers.mjs`（1 行内）；Step 5 加一句「dry-run 输出里 `profile_gate.ok=false` 时先问那个问题再往下走」（1-2 行）。**详细用法一律写进 `references/`。**
- `references/run-and-database.md`：记录命令完整用法 + 四个退出码含义 + 门被拦时的处置流程 + 留痕文件说明。
- `references/intake-and-profile.md`：A0 / A2 的答案**必须**经记录命令落盘，不许直接手写 JSON；并写明工作授权四个键是三态、不确定就留 null 让门去问。

### 12.6 验收标准（verify 照这个验）

1. **CI 四步本地串行全跑、贴真实退出码**：`npm test` / `node scripts/role_guard_smoke.mjs` / `node scripts/public_alpha_gate.mjs` / `for f in $(find shared scripts -name '*.mjs'); do node --check "$f"; done`。**第 3 步会检查 onboard 技能 ≤ 500 行**（上一轮真红过）。
2. **主流程冒烟**：`npm run demo:check` exit=0，且 WARN 项与本轮改动无关（逐条说明）。
3. **新用户模拟（沙箱假家目录，禁真跑投递）**：从模板生成一份档案 → `blockingProfileGaps` 返回 `ok:false` 且问句 / 命令可读 → 照 `remediation_command` 执行 → 再查返回 `ok:true` → `validate_user_profile.mjs` exit=0。
4. **现有真实用户零变化**：用他的档案形状（F-1 OPT，四格齐全）跑门 → 放行；跑缺口报告 → 分类与改前逐条对照，**贴出对照表**。
5. **闭环实证**：`missing_info_loop.test.mjs` 绿，且在 BUILD 记录里贴出「第一次跑报告有问题 / 写回 / 第二次跑报告没问题」的真实输出。
6. **越权拒写实证**：手工跑一次写白名单外路径的命令，贴 exit 码与「档案逐字节不变」的证据（`shasum` 前后一致）。
7. **覆盖率**：三个新模块行覆盖 ≥ 90%，贴未覆盖行号。
8. 边界：未 push、未真跑投递、未提交表单、未读写 `~/.mrweirdo-jobs/`（`demo:check` 只读除外，需声明）。

**上线后的落地实证 SQL**（批次 A 上线并跑过第一批真实投递之后执行；本地库 `~/.mrweirdo-jobs/jobs.db`，只读）：

```sql
-- 证据 1：被阻塞的行确实进了投递记录，而不是无声消失
SELECT count(*) FROM feedback
 WHERE outcome = 'skip'
   AND (reason LIKE '%work_authorization%' OR reason LIKE '%legal_attestation%'
        OR reason LIKE '%profile_specific_answer_required%');
-- 期望 > 0（如果这一批确实有行被个人事实拦下）；恒为 0 且缺口报告也没有对应问题，
-- 说明信号通路仍然断着，builder 未完成本设计的 F5 部分

-- 证据 2：用户答完之后，同一类阻塞不再复发
SELECT count(*) FROM feedback f1
 WHERE f1.reason LIKE '%work_authorization%'
   AND f1.ts > (SELECT max(ts) FROM feedback WHERE reason LIKE '%work_authorization%' AND ts < datetime('now','-1 day'));
-- 期望 = 0（用户答过之后不应再出现同类阻塞）；> 0 说明写回没生效或没被复用
```

### 12.7 本轮明确不做（列出来，不静默跳过）

1. **`background check` 分类不动**（仍归 `agent_profile_backed`）。理由：今天没有任何驱动会为它发出阻塞信号，改分类不会带来任何行为变化，只会新增一个永不触发的类目；且档案里没有对应字段，加字段违反字段克制。**红线点名了这一项，所以如果拍板人要求现在就覆盖，那需要先确定"背景调查同意"到底存哪个字段——那是产品问题不是架构问题，该问 pm。**
2. **F6 投递答案留痕**：本轮只建来源留痕的地基，字段级投递留痕另出设计（涉及数据表结构变更）。
3. **`standard_answers` 字段名错配（F7）**：6 个平台辅助文件读一个不存在的字段。本轮不碰——它属于「死路」不属于「编造」，且改它要动 6 个平台文件 + 8 条 workday 映射配置，与本设计无耦合。建议排在批次 C 之后单独做。
4. **跨批次「答过仍被卡」的状态**（§5 第 4 条）。
5. **`isGraduateDegree()` 只看一个字段、档案没填学位时返回 false**（BUILD §7 第 7 条）。批次 B 的 F 项会顺带覆盖学历三态，届时一并处理。
   **2026-07-26 补**：这一条现在与 §10-N（模板出厂 `degree: "B.S. in Your Major"`）合并处置——
   模板置空 + 该函数对空值返回「未知（阻塞）」而不是 false。两件事其实是同一个洞的两头。

**2026-07-26 追加的「本轮不做，但不静默跳过」**：

6. **截图与报告的保留策略**：依赖 §13.7 先做完，且**多久算合适是产品与合规取舍**——
   状态目录盘点里这个问题挂了三轮无人作答。建议随批次 C 端给拍板人，选项已备好
   （按份数 / 按天数 / 按投递结果分层）。
7. **历史那 50 张截图删不删**：取证结论是「先修文件名再谈删」——
   **修好之前删掉，等于把这个缺陷唯一的现场物证一起扔了**。R1 落地后再问拍板人。
8. **`standard_qa` 字段名错配（F7）**：6 个平台辅助文件读一个不存在的字段。它属于「死路」不属于「编造」，
   与本设计无耦合。但要提醒一句：**F7 一接线，模板里 `willing_to_relocate` 那个副本就会活过来**
   （§10-L 已把它置空，所以现在接线也安全——这是 P1 修复的一个额外收益，记在这里免得被当成可以回退的改动）。
9. **`how_did_you_hear` 改成读岗位来源**（§10-P 的正解）本轮只写方向不落地——
   它要碰 `jobs.db` 的读取路径与三个驱动，与批次 B 的主线无耦合，排批次 C。

---

## 13. 本次修正清单 + 批次 B 详细设计（2026-07-26）

### 13.1 本次改了这份设计的哪些地方、依据是什么

> 一处不藏。「依据」栏写的是我照着谁的实测改的——**没有一条是我自己坐在这里想出来的**。

| # | 改了哪里 | 原来怎么说 | 为什么错 | 现在怎么说 | 依据 |
|---:|---|---|---|---|---|
| 1 | §3.2 note 查表 | 无条件查表 | 与 §4.3 自相矛盾；结果文件在用户答完后会重读，无条件查表 = 同一问题永远问下去 | 查表命中后必过「该类目已答吗」谓词，档案有最终发言权 | 施工第 21 节方向 3（闭环测试抓到）+ 验收独立复核判定正确 |
| 2 | §3.2 / §12.1 priority | 新类目取 0 | 0 是假值，被 `\|\| 99` 吃掉，排序垫底 = 永远问不到 | 取 0.5 / 5.5 / 15；本项目 priority 永不取 0 | 施工第 21 节方向 1（实算排序）+ 验收复核 |
| 3 | §3.2 / §12.1 `value_type` | 既有模板一律补 `'string'` | 两个法律字段是布尔、五个 `standard_qa` 是对象；照写会让写回口对一半类目拒写 | 加 `path_value_types` 覆盖表，逐条路径核真实类型 | 施工第 21 节方向 2 + 验收复核 |
| 4 | §12.1 门与写回白名单的依赖方向 | `answerWritePaths` 并入 `GATED_PATHS` | 会造成两个模块循环 import；而且「合并」会把「问得出却写不回」这种死路悄悄补上 | 门的路径声明在模板里，写回口只做断言 | 施工第 24 节偏离 4 + 验收核过 import 方向 |
| 5 | §12.3 / §4.4 写回口 | 只有写后校验 + 备份 | 档案本来就坏时会被报成「你这次写坏了」；`.bak` 长期留着 = 多一份没人管的明文个人数据 | 加写前校验；成功后删 `.bak` | 施工第 24 节偏离 5 / 6 + 验收沙箱确认 |
| 6 | §2 行数预估 | `apply_gap_report.mjs` 533 → ~500 | 低估新增体量 | 533 → **564**（提交树实测；施工写的 570 是工作副本中间数） | 验收 `wc -l` 复核 |
| 7 | §12.4 那条被授权修改的断言 | 「只改 `:135` 一条」 | 同一断言在同一用例里有两个调用点，改一处必红 | 授权范围 = 那条断言的全部实例 | 施工第 25 节 + 验收核 diff + lead 认可 |
| 8 | §1.1「驱动侧已接线」 | 两个平台都接好了 | 只对 Greenhouse 成立；Ashby `:1142` 把 note 整个丢掉 | 改成「Greenhouse 已接线、Ashby 未接线」，修法进 §13.5 | 施工第 26 节第 1 条 + 验收核实 |
| 9 | §5 第 2、3 条待拍板 | 悬而未决 | 关卡 2 已拍板，且**两条都不是我给的选项** | 逐条写明拍板结果与我判断错在哪 | 关卡 2 ② ③ |
| 10 | §6 可靠性栏「不确定就写 false」 | 写 `false` 保守跳过 | **写 false 本身就是编造**，与红线冲突，RISK_REPORT F1 否过同类做法 | 一个布尔都不写，做成有出口的暂停（§13.3） | 验收风险 ⚠️1（两份文档互相矛盾） |
| 11 | §10 十一处清单 | 十一处 | 扫法是「顺着驱动代码扫」，对「合法代码 + 被污染输入」失明 | 扩到十八处 + §10.2 换扫法 + 固化成测试 | 验收 ❌2（搬迁）、施工第 26 节第 2 条（GPA）、本轮源点扫描（N/O/P/Q/R/S） |
| 12 | 新增批次 B 四个子包 | 只有「另外 6 处编造」 | 拍板与实测新增了四件必须做的事 | §13.3-§13.7 | 关卡 3 ①、lead 关于上锁的裁决、取证 R1/R4 |

**本次没有改的（明确说明）**：门的 80% 判据、三层方案骨架、ADR-1 到 ADR-5 的结论、批次 A 的全部设计——
它们经施工与独立验收后行为符合预期（现有用户 24/24 零变化、新用户 8/24 恰为该变的、三个新模块行覆盖 100%）。

### 13.2 批次 B 的四个子包与依赖顺序

```
B0 Ashby 接线（净增 0）  ──必须最先──┐
                                      ├─► B2 各平台判定改三态（D/B/F/C/G/H/R/S）
B1 问法改对号入座 + 身份映射 ─────────┘        （B0 没做，Ashby 侧的法律声明 / 居住地 note 传不出来）
                                      
B3 留证与上锁（与 B0-B2 无耦合，可并行，但都碰 `-auto` 技能说明书，建议排在最后避免写冲突）
```

### 13.3 B1：工作授权改成「对号入座」的问法（关卡 3 ① 拍板）

**拍板原话**：问「你是美国公民或绿卡吗？」「你是持 F-1 的留学生吗？」，**不许问「你有没有工作授权」**——
「这没人能知道」。

**为什么这条拍板是对的（我原来的问法错在哪）**：原问句四选一，选项里塞着 `CPT` / `OPT` 这些术语，
而且要求用户自己把身份翻译成「算不算有授权」——**那是一个法律结论**。用户答错不是他的错，
是问题问错了。正确的做法是**只问他从自己的证件和生活里读得出来的事实**，法律结论由代码去推。

**问法（三个是非题，逐题追问，答到能定案就停）**：

| 序 | 问句（人话，不出现术语） | 触发条件 | 得到什么 |
|---:|---|---|---|
| Q1 | **「你是美国公民，或者持有绿卡（永久居民卡）吗？」** | 总是问 | 是 → 三个布尔全部定案，问完即止 |
| Q2 | **「你是持 F-1 学生签证在美国读书的留学生吗？」** | Q1 答否时问 | 是 → 进 Q3；否 → 进「其他情形」分支 |
| Q3 | **「学校已经给你批下来可以工作的许可了吗？（就是那张 EAD 卡，或者你的 I-20 上写着 CPT 那一栏）」** | Q2 答是时问 | 是 / 否 / 说不清楚 |

**身份 → 三个布尔的映射（`shared/work_auth_identity.mjs`，纯函数，真值表即测试）**：

| 情形 | `authorized_to_work_us` | `requires_sponsorship_now` | `requires_sponsorship_future` | `visa_status` |
|---|:---:|:---:|:---:|---|
| Q1 = 是（公民 / 绿卡） | `true` | `false` | `false` | `US Citizen or Permanent Resident` |
| Q2 = 是 且 Q3 = 是（F-1，已有 CPT / OPT） | `true` | `false` | `true` | `F-1 with CPT/OPT` |
| Q2 = 是 且 Q3 = 否（F-1，还没批下来） | **不写** | **不写** | `true` | `F-1 without current work permission` |
| Q2 = 是 且 Q3 = 说不清楚 | **不写** | **不写** | **不写** | 记用户原话 |
| Q1 否 且 Q2 否（其他签证 / 其他情形） | **不写** | **不写** | **不写** | 记用户原话 |

> **两条设计纪律，写死在这张表里**：
> ① **只在能确定的格子上写值，确定不了的一格都不写**——这就是三态存在的意义。
>    第三行看着可以顺手把 `authorized_to_work_us` 填成 `false`，**不许**：一个还没拿到 CPT 的
>    F-1 学生能不能对「你是否有在美国工作的授权」答 Yes，取决于岗位是不是能走 CPT、
>    学校批不批——**这是个案，不是我们能替他推的**。填 false 会让他被直接刷掉。
> ② **`requires_sponsorship_future` 对全部 F-1 情形都是 `true`**——这一格是能推的：
>    F-1 的工作许可有期限，将来要长期工作就要担保。这是身份本身决定的，不是个案。

**「说不清楚」怎么办（不许是死胡同）**：门拦下这一批时，**必须同时给出三件东西**——

1. **卡在哪**：「投递表单几乎每一份都会问你的工作身份，这一格我不能替你猜。」
2. **去哪里查清楚**（具体到人，不是「请自行确认」）：
   - **你学校的国际学生办公室（International Student Office / OISS，管 F-1 学生身份的那个办公室）** —— 最快，一封邮件就能问清；
   - **你自己的 I-20 表**（第 2 页 `Employment Authorization` 那一栏写着有没有 CPT）；
   - **EAD 卡**（Employment Authorization Document，工作许可卡；有 OPT 的人手里那张实体卡）。
3. **查清楚之前会怎样**：「这一批我先不投，你查到了跟我说一声，一条命令就能续上，
   已经排好的队列不会白排。」——**并且同一批内不再重复问同一件事**（门的返回里带上
   `asked_in_this_batch` 标记，主对话据此不重复弹问）。

**为什么门仍然拦整批、而不是只拦命中该题的行**：因为命中该题的行就是几乎全部行
（6 档案 × 4 题面实测全阻塞）。只拦命中行 = 拦掉整批 + 用户等 20 分钟才知道 —— 更差。
**这一点是本设计从头到尾没变过的判据**（ADR-1）。

**引导侧同步改**：
- `intake-and-profile.md` 的 A0 从「四选一」改成上面三个是非题；
- **删掉那段与本设计矛盾的话**（「答不出来就留 null，让开工前那道门去问」——它把死锁写成了正常流程）；
- A2 那一组加半句「你已满 18 岁了吗」（关卡 2 ② 拍板，见 §10-C），**不新增问题、只加半句**。

### 13.4 B3-a：写入侧统一上锁（状态目录盘点 C11 / 取证建议 R2）

**问题的实际形状**（实测，不是推测）：

| 载体 | 现状 | 有没有代码在管 |
|---|---|---|
| `cover_letter.pdf`（三个驱动的默认求职信） | 644 | **全仓库零 chmod，且没有任何生产方**——用户手放进去的 |
| `log/screenshots/` 50 张 | 644 | 无（其中多张含**明文邮箱与电话**） |
| `materials/cover_letters/` 38 份 | 644 | 无（38/38 含真名） |
| `profile.json` / `search_intent.json` / `essay_profile.json` | 600 ✅ | `secure_profile_files.sh`，**只有引导第 2 步一个调用点** |

**为什么「给上锁脚本加第二个调用点」不行**：那个脚本管的是 3 个 JSON，
求职信和截图**一个也管不到**；而且引导第 2 步跑的时候，这些文件还都不存在。
加调用点只是让一个覆盖面不够的东西多跑一次。（施工时试过这条路并自己否掉了，判断正确。）

**设计：一个模块 + 两类触发**

```js
// shared/state_file_lock.mjs —— 只做一件事：把个人数据文件的权限收到 600 / 目录收到 700
export function lockFile(path)            // 存在才动；不存在不报错、也不创建
export function lockDir(dir, {recursive}) // 目录 700 + 目录内文件 600
export const PII_TARGETS = [              // 相对状态目录的清单，唯一真相源
  'profile.json', 'search_intent.json', 'essay_profile.json',
  'answer_provenance.json', 'profile.json.bak',
  'resume.pdf', 'cover_letter.pdf',
  { dir: 'log/screenshots' }, { dir: 'materials/cover_letters' }, { dir: 'generated_materials' },
];
export function sweep(home)               // 遍历 PII_TARGETS，返回 {locked:[], missing:[]}
```

- **触发一（主力）= 写入侧**：谁写谁锁，落在四个写入点上——
  `cdp.mjs` 的截图落盘处（**全项目所有截图的唯一收口**，驱动和技能说明书都走它）、
  `cover_letter_materials.mjs` 的 HTML / PDF 落盘处、批次 A 已做到的档案与留痕、`intake_resume.sh`（已有）。
- **触发二（补网）= 全量扫描**：`supervisor_preflight.mjs` 在每次真实批次开工前扫一遍，
  `secure_profile_files.sh` 改成调同一个模块（不再自己维护第二份清单）。
  **补网不可省**：`cover_letter.pdf` 根本没有生产方，只有扫描能管到它。

**边界与失败处理**：`chmod` 失败**不吞**（打印路径与原始错误）；但**不因为上锁失败而中断投递批次**——
它是 preflight 的一条 WARN 而不是硬失败。理由：上锁失败的典型原因是文件属于别的用户，
把整批拦掉的代价远大于收益；而**真正的硬失败在写入侧**（写不进 600 的文件说明目录有问题，该报）。
> 这是一处显式取舍：**已知牺牲了「补网失败也停机」的强度，换主链路不被运维问题拦停。**

**验收怎么验**（给 verify）：沙箱假家目录里造出全部 10 类载体、故意设成 644 →
跑一次写入路径和一次扫描 → `stat` 逐个断言 600 / 700；再造一个「文件不存在」的家目录 →
断言不报错、不创建空文件、退出码 0。

### 13.5 B0：Ashby 的阻塞 note 传不出来（净增 0 的修法）

**查明的事实**（读代码，不是引用他人结论）：

```js
// shared/ashby_apply_driver.mjs:1142
if (sel) addPendingQuestion(pendingForMainClaude, { question: m, selector: sel.sel, tag: sel.tag });
// 而 addPendingQuestion(:1039-1043) 的第一行是：
//   if (!item?.question || !item?.selector) return;
```

**两个洞，不是一个**：
1. **note 被丢**：`a.note`（驱动为什么停下的精确标识）根本没往对象里放。
   → 结果文件里没有 note → 缺口报告的 note 查表拿不到东西 → 只能退回题面正则兜底。
   工作授权因为题面特征明显、被正则兜住了；**法律声明与居住地兜不住**——而批次 B 恰恰依赖它。
2. **只有能定位到文本框的题才进得来**：`if (sel)` + `addPendingQuestion` 里的
   `!item.selector → return`。一道**下拉框 / 单选**形态的阻塞题定位不到文本框，
   于是**连题目带 note 一起蒸发**，只在 `missing` 里剩一个光秃秃的标签。

**修法（净增 0 行，硬约束：该文件 1170 行 > 800 上限）**：
- 洞 1：`:1142` 那一行加一个键——`{ question: m, selector: sel.sel, tag: sel.tag, note: a.note || null }`。
  **同一行内改，净增 0。**
- 洞 2：把 `if (sel)` 改成「有 sel 就带 sel、没 sel 就带 `selector: null`」，
  并把 `addPendingQuestion` 的守卫从 `!item.selector → return` 放宽成
  **`!item.question → return`**（选择器只是给主对话回填用的便利，
  **没有选择器不代表这道题不该被报出来**）。去重键从 `(question, selector)` 改成 `question`。
  **这三处都是同一行内替换，净增 0。**
- **缺口报告侧零改动**：`collectFields` 已经在读 `obj.pending`，note 一旦带上就自动走通。

**验收**：喂一份没有工作授权的档案跑 Ashby 驱动的替身（批次 A 已经建好
`test/greenhouse_driver_harness.mjs` 那种「取出货源码、只换碰浏览器的函数」的做法，
Ashby 照建一份），断言结果 JSONL 里 `pending[].note === 'legal_attestation_required'`，
再把这份结果喂缺口报告，断言归类为 `user_legal_attestation` 而不是万能句。

### 13.6 B2 附加：Lever 从未进过扫描范围（新发现，需 lead 拍板是否纳入本批）

```js
// shared/lever_apply_driver.mjs
:265  if (/authorized|eligible.*work|legally.*work/i.test(label)) return chooseOption(field, ['Yes', …]) || 'Yes';
:266  if (/sponsor|sponsorship|visa|…/i.test(label)) return auth.requires_sponsorship_future === true ? 'Yes' : 'No';
:266  if (/currently enrolled|…|student/i.test(label))  return chooseOption(field, ['Yes']) || 'Yes';
:271  if (/18 years|over 18|at least 18/i.test(label))  return chooseOption(field, ['Yes']) || 'Yes';
:269  if (/relative|previously employed|…|conflict/i.test(label)) return chooseOption(field, ['No']) || 'No';
```

**这就是批次 A 在 Greenhouse 上修掉的那个缺陷，逐字同款，只是换了个文件**：
第 265 行对「你是否有在美国工作的授权」**无条件答 Yes**；第 266 行担保题两态压三态，
**没问过 = 「我不需要担保」**——方向对国际生有害（说他不需要担保，等于替他做了一次不实陈述）。

**这条路是活的，不是死代码**：取证报告里 50 张截图覆盖的 30 家公司中，
**ekimetrics / endpointclinical / everbridge / getvocal / voltus / wintermute 走的都是 Lever**。

**为什么之前没人发现**：见 §10.2 盲区二——原扫描的标题就写着「在 Greenhouse 驱动里逐行找」。

**修法**：直接委托批次 A 已经建好的 `deriveWorkAuthAnswers()` / `workAuthGapFor()`
（`answer_routing.mjs`，已被 100% 覆盖），与 Greenhouse 逐字同款；学籍 / 年满 18 / 亲属题按 §10 同类处置。
**该文件 489 行，离 800 上限还远，不受净增 0 约束，工程量小。**

**为什么要 lead 拍板**：这是**范围扩张**（原派遣单的批次 B 是「另外 6 处编造」，不含 Lever）。
我的建议是纳入本批——它是一处正在生效的编造，而且修它的零件全都现成；
但**扩不扩范围是排期决定，不是我能替 lead 定的**。

### 13.7 B3-b：投递留证——文件名不许把失败标成成功，取景要能拍到该拍的题

**两个问题的层级不同，必须都修**：

| | 症状 | 根因 | 后果 |
|---|---|---|---|
| **R1 文件名撒谎** | 6 张 `..._success_...` 的页面写着「We couldn't submit your application」；3 张 `post_submit` 页面里没有任何提交确认 | **判定权在模型手里**：文件名是技能说明书里一段 bash 字符串拼的，而且**截图在读页面之前就拍了、名字在判定之前就定了** | 直接污染「我投出去几家」这个用户最在意的数字 |
| **R4 取景无效** | 命中率 **2/50**——只有 1 张拍到答案、1 张拍到未答 | 单屏截图 + 两个拍摄时机（提交前视口停顶部 / 提交后已跳确认页），而这些题在表单**中下部** | 留证机制从一开始就没对准要留的东西，出了事查不出来 |

**设计：`shared/submission_evidence.mjs`（新建，约 150 行，既是模块也是 CLI）**

```js
export function submissionVerdict(bodyText)   // 纯函数：页面文案 → 'submitted'|'not_submitted'|'unknown'
export async function captureEvidence(tab, { company, jobId, phase })
// phase='before_submit'：滚到底 → 整页截图 → 命名 <company>_<jobId>_<ts>_before_submit.png
// phase='after_submit' ：先读页面文案 → 判定 → 整页截图 → 命名 …_after_<判定>.png
// 落盘即 chmod 600（走 §13.4 的同一个上锁模块）
```

**判定规则（`submissionVerdict`，纯函数，好测）**：
- 命中确认类文案（`successfully submitted` / `thank you for applying` / `application received` …）→ `submitted`
- 命中失败类文案（`couldn't submit` / `could not submit` / `needs corrections` / `already applied` / `try again`）→ `not_submitted`
- **两类都不命中、或两类同时命中 → `unknown`**
- **禁止任何「默认成功」的兜底**。`unknown` 是一个正当结论，不是失败——今天已经有 `unknown` 这个值，
  说明机制在，缺的只是「页面明确说了失败」这一档。

**取景（R4）**：`before_submit` 那张**先滚到页面底部**（触发懒加载）**再整页截图**
（CDP 的 `Page.captureScreenshot` 带 `captureBeyondViewport: true`；`cdp.mjs` 的 `screenshot`
子命令加一个 `--full-page` 开关，约 6 行，该文件 378 行有余量）。
**这一条直接决定「以后还能不能查得出当时填了什么」**——今天的答案是查不出来，
而这正是历史那 183 次投递不可考的原因。

**接线**：8 个 `-auto` 技能说明书里的截图段，从「`mkdir` + 拼名字 + `cdp.mjs screenshot`」
换成一行 `node shared/submission_evidence.mjs --tab "$TAB" --company "$COMPANY" --job "$ROW_ID" --phase before_submit`。
**行数是减的**，主入口说明书 500 行门禁不受影响（改的是 `-auto` 技能，不是主入口）。
两个驱动里那两行往 `/tmp` 写的一次性截图（`greenhouse_apply_driver.mjs:1834`、
`ashby_apply_driver.mjs:1083`）同一行内改成落进留证目录并带判定后缀，**净增 0**。

**明确不在本设计范围内的**：截图保留策略（取证建议 R3）——它依赖本节先做完
（有了可信判定才谈得上「成功的留、失败的留 90 天」），且**保留多久是产品与合规取舍，
不是工程能单方面定的**（状态目录盘点里这个问题挂了三轮没人答）。建议随批次 C 一起端给拍板人。

### 13.8 批次 B 的验收标准（给 verify，在原 §12.6 之外追加）

1. **对号入座问法**：三个是非题的**真值表逐行断言**（5 种情形 × 4 个字段 = 20 格），
   其中「不写」的格子必须断言**档案里仍是 `null`**——不是 `false`、不是空字符串。
2. **「说不清楚」不死锁**：跑一次「Q3 答说不清楚」的全流程，断言 ① 三个布尔仍为 null；
   ② `visa_status` 记了原话；③ 门的输出里**同时**含卡点说明、三条查证去处、和「查清楚就能续上」的话；
   ④ 同一批内第二次调用不再重复问。
3. **Ashby note 通路**：驱动替身实跑，断言 `pending[].note` 存在且正确；**并断言下拉框形态的阻塞题
   也进得了 pending**（洞 2 的守卫）。
4. **上锁**：沙箱造 10 类载体 → 写入路径与扫描各跑一次 → `stat` 断言 600/700；
   文件不存在时不报错不创建。
5. **留证**：三种页面文案（确认 / 明确失败 / 都不像）喂 `submissionVerdict`，
   断言第三种得到 `unknown` **而不是 submitted**；整页截图断言图片高度 > 视口高度。
6. **出厂模板守卫**：新增一个有出厂值的键但不登记理由 → **测试必须红**（先看它红再看它绿）。
7. **现有真实用户逐格零变化**：与批次 A 同样的对照方法（新旧两棵树、同一份题面夹具、真实档案只读），
   **贴对照表**。批次 B 改的是「没问过就别答」，对档案齐全的用户应当一格不变。
8. CI 四步本地串行全跑、主流程冒烟 `demo:check` exit 0，与批次 A 同标准。

---

## 讨论中辩驳过的方向

> 下面前 6 条是第 1 轮（出设计时）的；第 7 条起是第 2 轮（2026-07-26 修正时）的。

**❌ 方向 7（第 2 轮）：把「说不清楚工作授权」的用户，按最保守的方向写 `authorized_to_work_us: false`，让他至少能投出去一部分。**
这是我第 1 轮写在 §6 里的做法，看起来很体贴：用户不知道答案，我们替他选一个不会夸大自己的，
产品继续跑，总比卡在门口强。**否决理由**：`false` 与「用户亲口说没有」在档案里**字节相同**，
代码分不出来——这正是本轮全部缺陷的根因，我居然在同一份设计里又造了一个。
而且方向「保守」也救不了它：一个 F-1 学生被写成「没有工作授权」，
在很多雇主那里就是**直接刷掉**（关卡 2 拍板的原话）。RISK_REPORT F1 早就否掉过同类做法
（把共用默认值从 Yes 掉头改成 No）。**验收把这处矛盾当面指出来，是对的。**
现在的做法是一个布尔都不写 + 给出具体查证去处（§13.3）。

**❌ 方向 8（第 2 轮）：搬迁意愿和 GPA 这两处漏网，补进清单就算交差。**
派遣单只要求「补两条」，补完表就齐了。**否决理由**：补清单解决的是这两处，
解决不了「下次还会漏」——而这两处漏得**很有规律**（§10.2）：原扫描是顺着代码里的写死答案扫的，
对「合法代码 + 被污染输入」这一类结构性失明。我照这个思路重扫了一遍出货模板，
**又扫出四处**（学位占位符、最早到岗日占位符、渠道、工作方式）和**一个整平台的漏网**（Lever）。
所以本轮补的不是两行，是**一种扫法 + 一条把这种扫法固化下来的测试**（ADR-10）。
**如果只补两行，第 19 处几乎是必然的。**

**❌ 方向 9（第 2 轮）：给 `secure_profile_files.sh` 加第二个调用点，让可选文件真的被锁到。**
施工时提过、我一开始也觉得可行——毕竟一行的事。**否决理由**：那个脚本管的是 3 个 JSON，
而实测裸奔的是**求职信、38 份生成的求职信、50 张含明文邮箱电话的截图**，
多调一次它**一个也管不到**。这是典型的「用兜底掩盖真问题」：
看起来把 P2 关掉了，实际隐私裂口一点没变小，还给下一轮埋了一处要拆的旧代码。
lead 的裁决（不打绕行补丁，并入写入侧统一上锁）是对的，设计落在 §13.4。

**❌ 方向 10（第 2 轮）：投递留证只改文件名后缀——把「读页面文案再命名」加上，取景先不动。**
这是最小改动，直接消灭「6 张失败被标成成功」这个正在污染用户数字的 bug，风险几乎为零。
**否决理由**：取证报告的命中率是 **2/50**——单屏截图**结构性地拍不到**工作授权、担保、
学历、退伍军人这些排在表单中下部的题。只修名字，得到的是**一批诚实但依然无用的截图**；
下次再问「当时到底填了什么」，答案还是查不出来。而这个问题**恰恰是本轮所有排查最后撞的那堵墙**
（历史 183 次投递不可考）。两件事成本相差不大（整页截图是 CDP 的一个参数），
**分两次做没有任何好处，只是让「以后可查」这件事再推迟一轮。**

**❌ 方向 11（第 2 轮）：Lever 的问题另开一轮，别塞进批次 B。**
理由很正当：派遣单写的批次 B 是「另外 6 处编造」，不含 Lever，扩范围会拖慢批次 B。
**部分否决（改成交给 lead 拍板）**：我不能自己扩范围——那是排期决定；
但我**也不能把它降级成「以后再说」**，因为它是一处**正在生效的编造**
（对「你是否有在美国工作的授权」无条件答 Yes），和批次 A 刚在 Greenhouse 上修掉的是同一个东西，
而且 Lever 有真实投递记录。**静默排到「以后」= 明知有个平台在替用户说谎却不说**，
违反「凡发现问题默认彻底解决，不许自行降级」。所以写法是：设计做完、代价算清、
**明确标为需要 lead 一句话**（§13.6）。

**❌ 方向 1：在引导说明书里加一句「A0 的答案必须写进 profile.json」，不写代码。**
这是最省事的做法，而且看起来很对——说明书本来就是这么写的。**否决理由**：`PROJECT_MEMORY.md` 第 1 条长期原则的实证就是这个——「绝不编造个人事实」在 PRD 里写了三年，执行它的分类器却把红线保护的字段全判给了「系统自动填」。**给模型的指令不是断言。** 本轮全部缺陷（模板预填、A0 没落盘、答案手写 JSON）都是同一个病：关键约束靠自觉。所以门必须是 `checks` 数组里一个会让批次退出码非 0 的检查项，写回必须是一个会 exit 2 的命令。

**❌ 方向 2：清掉模板预填之后，用「缺值就整批跳过」当保护，等用户自己发现不对再问。**
这就是 lead 在派工单里点名禁止的中间态：用户看到「投出 0 家」、没有问题、没有原因。而且它比今天更糟——今天至少还投得出去（虽然是靠说谎）。**这条不是被"讨论"掉的，是被"能不能让人用起来"这个第一判据一票否决的。**

**❌ 方向 3：照用户口述做「投递前把所有定制化问题问完」。**
用户在 Round 3 的原话确实是「结合简历生成定制化问题，让他回答完再去投」。**否决理由有三条**：① 与他自己 2026-06 的拍板（不做投递前探测）直接冲突；② 与已实现且带覆盖校验的「从真实表单反推 + 压缩」机制冲突，等于推翻一个能跑的零件去做一个猜的；③ 最要命的是它把上手门槛从 3 个问题抬到 20 个，**直接打击「我希望这东西最后能有人用」这个第一判据**。pm 在 PRODUCT_SPEC 第 4 条已经站在他 2026-06 那一边，本设计沿用。**但我没有原样照搬 pm 的结论**：pm 说「全部走投递后」，我加了一条量化例外（阻塞面 ≥ 80% 的走前置），因为工作授权这一格全部走投递后会让第一批 100% 空跑——那同样是「没人愿意用」。

**❌ 方向 4：给每个个人事实字段包一层 `{value, source}`，从数据结构上根治「谁说的」。**
理论上最干净。**否决理由**：全仓库 40+ 处读点要改，其中 `greenhouse_apply_driver.mjs`（1914 行）与 `ashby_apply_driver.mjs`（1170 行）**已超行数上限、净增必须为 0**，而 hook 是按单次编辑前后比的（BUILD §15 方向 1 实证「先减后加」都不成立）。**物理上做不到。** 而且「出厂一律 null」这个免费方案已经提供了 90% 的可区分性——剩下 10%（用户亲口 vs 简历推断）用一个旁挂留痕文件解决就够，不值得动全仓库的读点。

**❌ 方向 5：把 EEO 题归成一个新的 `system_eeo_declined` 类目，永远不问用户。**
一度很有吸引力：EEO 是自愿的，拒答是完整答案，不问用户 = 少一次打扰 = 对「有人用」有利，而且不用改那条现有测试断言。**否决理由**：当某张表单的下拉框里根本没有「不愿回答」这个选项时（这是真实存在的），这一行会**永久静默卡住，而用户永远不知道**——正是本轮要消灭的那个行为。而且它技术上绕开了红线点名的 `user_*` 执行机制。改成 priority 15 的低优先级 `user_*` 类目，既保住了「不打扰」（排在所有实质缺口之后，几乎排不进每批四组的额度），又在真卡住时给了用户一个出口。

**❌ 方向 6：把那道门做成「警告」而不是「硬失败」，让用户自己决定要不要继续。**
听起来更尊重用户。**否决理由**：警告在自动化流程里等于不存在——主对话看到一条 WARN 会继续往下跑（`supervisor_preflight` 现在就有 5 类 WARN，全都被无视着），然后整批空跑。而且「要不要继续」这个问题本身是假选择：继续的结果是 100% 的行投不出去，没有任何用户会选它。**给一个只有一个正确答案的选择题，是把决策成本转嫁给用户。**
