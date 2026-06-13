# PRD — Onboarding 体验改造 (Mr. Weirdo Jobs)

> Status: Draft for handoff · Owner: PM · Implementer: TBD
> Scope: 入口菜单 + onboarding 流程 + 缺失信息收集。**不含**视觉/排版重绘。
> Baseline: 仓库当前 = commit `50bab4c`（工作区干净）。本 PRD 描述目标态,未实现。

---

## 1. 背景与问题

当前 `/mrweirdo-jobskill` / `/mrweirdo-onboard` 的入口和 onboarding 存在三个体验问题:

1. **入口是一面命令墙。** 用户被要求自己敲 `/mrweirdo-greenhouse`、`/mrweirdo-ashby`、`/mrweirdo-lever` 等一长串带平台后缀的命令。这些 ATS 平台命令对用户毫无意义,且要求"打字"而非"选择"。
2. **冷启动索取太多、见价值太慢。** 用户在看到第一个岗位之前,要先贴简历路径、**手写 5–10 句自我介绍**、再过硬边界问题。"投简历前先写作文 + 过安检"。
3. **缺失信息逐条轰炸。** 当系统找到 N 个岗位、只有少数能直接投、其余因信息缺失被卡时,如果把每个岗位缺什么逐行甩给用户,体验等同手动投递,极其劝退。

## 2. 产品北极星

**本产品唯一的核心功能 = 一键/一句话自动投递:** 用户把简历交给 agent,告诉它"去投",agent 自动完成发现→打分→自动提交。没有比这更重要的功能。

**简历是用户唯一必须提供的输入。** "简历进 → agent 自动投 → 完事"之间的一切,凡是拖慢"到达自动投递",都是要砍/要省的对象。只有**最关键、无法从简历安全推断**的信息才打扰用户,其余冗余信息一律不问。

**受众 = 所有美国大学生,任何专业;目标岗位横跨所有职能/领域。** 这**不是一个为 PM 量身定做的工具**。用户要投的岗位可能是 Software Engineer、Accounting、Marketing、Nursing、Design、Data、Consulting……任何职能。专业也可能是商科、CS、护理、工程、艺术、公共卫生、新闻等任意一种。

- **绝不预设任何职能/方向**——尤其不能 hard-code PM / growth / startup 假设(画像、role_categories、打分 rubric 都不能默认 PM 视角)。
- **目标职能与专业解耦:** 用户想投的岗位职能跟他学的专业不必一致——学 CS 的可投 SWE 也可投别的,学会计的投 Accounting,学 PM 的也可投非 PM 岗。画像、discovery、打分必须跟着**真实简历 + 用户自报方向**走,不能假设"专业 = 目标职能"。
- (注:`references/intake-and-profile.md` 已有 "Serve any US college student… Do not hard-code PM/growth/startup assumptions" 原则,本 PRD 将其提升为硬约束。)

## 3. 目标 (Goals)

- G1. 入口零打字:用户用**选择**进入,不再看到任何 ATS 平台命令。
- G2. 冷启动最小化:必填只剩简历;自我介绍可选。
- G3. 问什么**从真实申请归纳压缩而来**,不是 PM 钦定的固定清单;把一长串原始字段(ABCDEFG)上卷成最小问题集(XYZ)。
- G4. 缺失信息**跨申请归纳压缩 + 按解锁岗位数排序**,一次性问,绝不逐行轰炸。
- G5. 开放题(cover letter / essay 问答)**自动创作**,不反复索取。
- G6. 保持唯一一道投递前确认门(queue gate)。
- G7. discovery/打分**按人个性化**并守**相关性边界**:相邻职能可一起投,差距过大的职能不投。

## 4. 非目标 (Non-Goals)

- N1. **视觉/markdown 排版重绘**——单独一轮,先把流程改对再刷漆。
- N2. **投递前表单探测**(pre-emptive probe)——见 §6 架构约束,明确不做。
- N3. **删除任何平台 skill 文件**——它们是内部引擎,保留(见 §5.1)。
- N4. cover letter PDF 自动塞进批次——见 §8 待决策,**本 PRD 不含**。
- N5. **研究生/项目申请不在范围。** 产品只做 job / internship / new-grad 全职(走 Greenhouse/Ashby/Lever 等招聘 ATS 自动投)。研究生申请表单/文书/推荐信流程完全不同,本期不做。("目标可跨专业"指的是跨**工作方向**,不含读研。)

---

## 5. 需求详述

### 5.1 入口改为选择式 (G1)

`/mrweirdo-jobskill`(及 `/mrweirdo-onboard` 无具体请求分支)在无明确请求时,用**一次 AskUserQuestion** 给出恰好 5 个可选项,不展示任何可敲命令:

| 选项 | 行为 |
|---|---|
| **开始找实习 / Onboard(推荐,首项)** | 自动进入完整 onboard 流程(简历 intake → discovery),无需用户再敲任何命令 |
| 进度跟踪 / Tracker | 路由到 `mrweirdo-tracker` |
| 扩充写作画像 / Expand | 路由到 `mrweirdo-expand` |
| 技能提升 / Upskill | 路由到 `mrweirdo-upskill` |
| 起草申请材料 / Materials | 路由到 `mrweirdo-materials` |

**约束:**
- greenhouse / ashby / lever / cherry-pick / confirm / doctor 等**一律不作为用户命令出现**。doctor 作为 onboard 内部 preflight;confirm / cherry-pick / 各平台 `-auto` 引擎为内部调用。
- **不得删除或改动**平台 skill 文件、尤其 `*-auto` 三个引擎 skill 的 frontmatter/触发逻辑——它们是 onboard 自动投递分发循环的提交引擎,删了整条自动投递报废。只改"用户面的菜单/介绍呈现",内部路由引用保留。

### 5.2 简历为唯一必填,自我介绍可选 (G2)

- Step 1 intake:**只有简历 PDF 路径是必填项**。自我介绍降级为可选——用户愿意可加一两句,不写则 agent 直接从简历推断,之后可用 Expand / Materials 补充写作记忆。
- profile / essay 生成必须支持 **resume-only**:`self_intro_raw` 可为空;无自我介绍时从简历推断 voice/positioning/proof points,真正未知的写作事实进 `dynamic_questions_to_ask_later` / `hard_no_claims`,**不阻塞、不强制用户写**。
- **不得削弱 truthfulness 规则**:绝不编造个人事实。

### 5.3 问用户什么 = 从真实申请归纳压缩出来的,不是预先声明的固定清单 (G3)

**核心原则:不存在 PM 钦定的"固定 N 项"。** 要问用户什么,必须**从真实投递的一批 application 里归纳**:看遍这些申请反复出现的、核心必需的原始字段(ABCDEFG…),把这一长串**语义归纳、压缩成尽量少的几个面向用户的问题(XYZ)**,使得用户填完 XYZ 就覆盖了 ABCDEFG 全部,不必再额外填任何东西。

- **这套"多→少"的归纳压缩是本系统的核心智能。** 若只是把每个申请的原始字段原样转给用户,等于让用户自己投,系统就没有存在意义。
- **反模式(严禁):** 今天投 A 看到要 ABC 就问 ABC,明天投 B 看到要 BCD 就问 BCD,后天再问 XYZ——每次现问现填。
- **示例 ≠ schema:** 薪资、地点、工作授权等**是这套归纳可能产出的问题,不是预先写死的清单**。具体问哪几个、怎么合并,由真实申请的字段分布决定。
- **数量不固定:** 能压成 3 个就 3 个;目标是"覆盖最多申请所需的最小问题集"。
- 凡能从简历安全推断的(姓名、学校、专业、已有的 LinkedIn/GitHub 等),**不进问题集**——只问简历里没有、又被多数申请需要的。
- 用户提供的事实(如薪资)写回 profile 时,**绝不推断/编造**(满足 truthfulness 对薪资等的 "Never invent" 约束);用户跳过则留空。

**Discovery 时序的现实(约束,非固定清单):** 极少数字段(如工作地点、是否需要 sponsorship)必须在 discovery **之前**知道,否则找不对岗位。这部分按"discovery 真正需要的最小集"前置询问,**同样遵循"能合并就合并、不声明固定清单"的原则**——不是把它当成另一张写死的表。其余绝大多数字段走 §5.4 的"投递中归纳压缩"。

### 5.4 缺失信息:跨申请归纳压缩 + 排序 + 一次问 (G4) — 本次重点

当 discovery/打分 / 投递尝试后存在"因缺字段而被卡"的岗位:

- **禁止逐行**把每个岗位缺什么列给用户(明确反模式:让产品退化成手动投递)。
- **跨所有申请归纳压缩(核心):** 把这批申请里出现的一长串原始必需字段(ABCDEFG…)**合并/上卷成尽量少的几个面向用户的问题(XYZ)**——语义相近、或能由同一问题覆盖的原始字段,合并成一个用户问题。用户面只看到压缩后的少数问题,**填完即覆盖全部原始字段**。这一步是系统的核心智能,不是简单转发。
  - 注:现有 `classifyField` 的 label→category 只是**第一层**归纳;本需求要在其之上再做一层"category→最小用户问题集"的合并,目标是**最少的问题覆盖最多的申请**。
- **按影响力排序:** 压缩后的问题**按"能解锁多少个 distinct 岗位"降序**呈现,例:"补 GPA 可解锁 N 个 / 补 LinkedIn 可解锁 M 个"。
- 用**一次** AskUserQuestion(≤ ~4 个分组问题),让用户**统一填一遍**。
- 填完后更新 profile,经现有 requeue 路径回填重投。

**计数正确性:** "解锁 N 个"必须是**去重后的 distinct 岗位数**(按 row_id 去重),不是字段标签出现次数。仅纳入能映射到"用户可填 profile 字段"的类目,排除 agent/system 类目。

### 5.5 开放题自动创作 (G5)

- inline 开放题 / essay 问答,在任何向用户提问之前,**先由 agent 自动起草**:依据简历 + profile + `essay_profile.json` + `answer_bank.json`,受 `truthfulness.md` 约束(绝不编造)。
- 不因开放题反复打扰用户。

### 5.6 唯一确认门 (G6)

- queue gate 是**唯一**一道真实提交前的业务确认门——那个"一键投递"的主时刻:用户看一次队列 + 身份块,回复"开始"即放行自动投递。
- **不得新增其它确认门。** 身份块、manual/quota/suspicious 核算等安全机制原样保留。

### 5.7 岗位相关性边界:只投相关/相邻,差距过大不投 (G7)

discovery/打分必须**按每个人的简历 + 自报方向个性化**,并守一条相关性边界:

- 以用户**自报目标职能**(+ 简历体现的方向)为锚点。
- **相关/相邻职能可一起投:** 例如想做 Operations/PM → Ops、PM、BizOps、Strategy、APM、Program Management 等相邻岗可批量投。
- **差距过大/不相关职能严禁投:** 同一个 Ops/PM 用户,绝不给他投 Software Engineer、Nursing、Design、Data 等跨度过大的岗。
- **收紧现有口径:** 这收紧了 `role_categories` 里 "a few low exploratory roles" 的定义——**探索性岗位也必须落在相邻范围内**,不得跨进不相关职能。
- **落地:** role_categories 生成 + 打分 rubric 需编码"与目标职能的相关性距离";不相关岗即便偶然分数不低,也**不进自动投队列**(排除或转 manual)。相关性边界以用户自报方向为准,不能用专业反推(见 §2 目标与专业解耦)。

---

## 6. 关键架构约束(实现者必读)

**系统只能在"尝试投递时"才知道某岗位要哪些字段**——靠在浏览器里读取实时表单 DOM、正则匹配标签得知,**没有任何"投递前就知道岗位要什么"的声明式 schema**。

因此 §5.4 的聚合采用 **"投递中收集再聚合 (aggregate-during-attempt)"**:对能投的 + 高匹配岗位真实跑一遍,缺口由现有批次/gap 数据自然暴露,再聚合排序。

> 用户已决策:**采用 aggregate-during-attempt,不做 pre-emptive probe。** "补 GPA 解锁 60 个"在真实尝试后呈现,对用户体感无差异,但成本只有探测方案的零头(探测方案需逐个打开表单只读抓字段,慢、脆、浏览器工作量翻倍)。

## 7. 现有可复用基建(降低实现成本)

来自代码勘查,实现时优先复用而非重写:

- **Step 6「Missing Info Follow-Up And Retry」已存在**于 `.claude/skills/mrweirdo-onboard/SKILL.md`:批次 → gap-report → 一次 AskUserQuestion → 更新 profile → requeue。本 PRD 主要是**重排为按解锁数排序**并强化"不逐行"。
- **`shared/apply_gap_report.mjs`** 已把缺失字段分类为类目并计数(`grouped_counts`、`user_questions[].count`、`onboarding_candidates`)。§5.4 的排序 = 增量加一个按 distinct row_id 计数的 `missing_field_ranking[]`(每条 `entries[]` 已带 `row_id` + `category`)。
- **开放题自动创作**已是文档化规则(SKILL Step 6 + `apply_gap_report` 的 `agent_open_text` 动作明确"先起草、别问用户")。
- **`shared/retry_gap_rows.mjs`** = 现成 requeue 回填路径,不要重造。
- **A0/A1/A2 硬边界 AskUserQuestion** 已在 Step 1;A3 薪资 = 加一问。
- **`work_authorization.salary_expectation_usd`** 字段已存在于 `shared/profile.template.json`。
- 涉及文件清单:`shared/apply_gap_report.mjs`(聚合核心)、`shared/retry_gap_rows.mjs`(requeue)、`shared/eligibility.mjs`(被卡原因)、`shared/answer_buckets.mjs`(标签→值匹配)、`shared/local_db.mjs`(schema)、`.claude/skills/mrweirdo-onboard/SKILL.md`(Step 1 / Step 6)、`.../references/intake-and-profile.md`(A0–A3)。

## 8. 待决策(需 Owner 显式拍板,不在本 PRD 实现范围)

- **D1. cover letter PDF 自动塞进自动投递批次。** 现有安全硬规则(`mrweirdo-materials`)**明确禁止**未经人工过目就把 agent 生成的 cover letter 附到批次提交。是否松绑 = 对外动作,需 Owner 单独 yes/no。在决策前保持现状不动。

## 9. 风险

- **R1. 分类器脆弱性。** `answer_buckets.mjs` 与 `apply_gap_report.classifyField` 是大量手调正则匹配自由文本表单标签;未识别标签会落入通用桶,导致解锁数排序失真。排序质量受其覆盖率上限制约。
- **R2. 薪资/cover letter 与 truthfulness 张力。** 薪资改为"用户提供"已规避;cover letter 自动附见 D1。
- **R3. 聚合口径。** "解锁 N 个"仅反映已真实尝试过的岗位,非全部已发现-被卡岗位——这是 aggregate-during-attempt 的诚实边界,文案不应暗示已覆盖全部。

## 10. 验收 (Definition of Done)

- 用户全程必须"打字"的地方 = **仅简历 PDF 路径**;其余皆可选或选择题。
- 入口/任何菜单**永不出现** `/mrweirdo-greenhouse|ashby|lever` 等平台命令;5 选项选择式入口;选 Onboard 自动进流程。
- 问用户的问题集是**从真实申请归纳压缩**得到的最小集(XYZ 覆盖 ABCDEFG),不是写死的固定清单;能从简历推断的不进问题集。
- 缺失信息:一次性、跨申请**归纳压缩成最少问题**、按 distinct 岗位解锁数排序、**无逐行枚举**;`missing_field_ranking` 按去重 row_id 计数。
- discovery/打分按人个性化;**不相关职能岗位**(与用户目标职能距离过大,如 Ops/PM 用户的 SWE/Nursing/Design/Data)**不进自动投队列**,仅相关/相邻职能批量投。
- 开放题在向用户提问前已自动起草。
- 确认门有且仅有 queue gate;`-auto` 引擎、eligibility、queue gate 安全机制未被改动。
- 现有测试(`test/apply_gap_report.test.mjs`、`retry_gap_rows.test.mjs`、`validate_user_profile.test.mjs`)全绿。
