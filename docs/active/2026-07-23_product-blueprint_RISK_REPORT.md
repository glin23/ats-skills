---
Status: done_pending_review
Owner: arnold-bug
Reads: docs/active/2026-07-23_product-blueprint_TASK.md, docs/active/2026-07-23_product-blueprint_PRODUCT_SPEC.md, docs/specs/next-priorities.md, PROJECT_CONTEXT.yaml, .claude/phase_schemas.yaml, shared/answer_routing.mjs, shared/answer_bank.json, shared/answer_buckets.mjs, shared/greenhouse_apply_driver.mjs, shared/ashby_apply_driver.mjs, shared/lever_apply_driver.mjs, shared/greenhouse_helpers.js, shared/ashby_helpers.js, shared/smartrecruiters_helpers.js, shared/apply_gap_report.mjs, shared/apply_batch.mjs, shared/profile.template.json, test/answer_routing.test.mjs, docs/archive/PRD-v3.md, .claude/skills/mrweirdo-onboard/SKILL.md, .claude/skills/mrweirdo-onboard/references/intake-and-profile.md, ~/.mrweirdo-jobs/profile.json, ~/.mrweirdo-jobs/feedback.jsonl, ~/.mrweirdo-jobs/jobs.db
Blocks: none
Iterations: 1
Updated: 2026-07-25
Type: RISK_REPORT
---

# 风险核实报告 — 档案缺值时的共用默认答案，会不会在真实投递表单上替用户说不实的个人事实

> **本轮只查不修。** 没有改动任何代码文件，没有跑过任何投递，没有提交过任何表单。数据库全程只读（`sqlite3 -readonly`）。

---

## 给拍板人的一句话结论

**会。**你的产品在 Greenhouse 和 Ashby 的投递表单上，遇到"你有工作授权吗 / 你有硕士学位吗 / 你是退伍军人吗"这类关于本人的事实题时，**只要档案里那一格不是明确的"是"，它就会替你答一个写死的默认答案**——工作授权答 `Yes`、硕士学位答 `No`、退伍军人答 `I am not a protected veteran（我不是受保护的退伍军人）`。**最硬的一条实测证据：负责工作授权的那个函数，我用 5 种档案（含"完全不填"和"明确填了不授权"）实跑，5 次全部输出 `Yes`——它在当前配置下没有能力输出 `No`。**

**真的发生过吗？没有找到"答错"的证据，但也不能完全洗清——因为系统压根没有记录它在表单上答了什么。** 15 条有记录的真实提交里，只有 1 条留下了字段级痕迹（2026-05-28 投 lambda，记的是 `authorized to work US=Yes`）；那一条与你档案里的真实值（`authorized_to_work_us: true`）一致，是对的。其余 14 条**没有任何字段级留痕可查**。退伍军人 / 硕士学位这两类，在全部投递日志和数据库里**一次都没出现过**（查过，无证据）。

**严重程度：P1（上线前必修），但现在不在着火。** 理由三条：① 已 41 天零投递，当前没有活跃投递；② 现有唯一用户（创始人本人）的档案里，5 个默认值中 4 个恰好与他的真实情况一致，所以历史上大概率没答错；③ 但这纯属**巧合而非机制保证**——换一个用户（美国公民、或还没拿到 OPT 的国际生、或读硕士的学生、或真的退伍军人），同一段代码会当场说假话。

**还查出一条 pm 没提、方向相反、危害更直接的**：如果用户**不需要**签证担保（美国公民 / 绿卡），系统会在表单上答"**我需要担保**"（`shared/answer_routing.mjs:175-177` + `shared/answer_bank.json:119`）。这条不是"帮用户蒙混过关"，是**主动把一个不需要担保的学生标记成需要担保**——很多雇主见到这个答案直接刷掉。详见下文根因第 1 条 (b)。

---

## 一、现场（What happened）

**来源**：pm 读码发现（`docs/active/2026-07-23_product-blueprint_PRODUCT_SPEC.md` §9 第 3 条），自述无命令行、未核实触发条件，明确要求排障成员复核。本轮我全部复验，**三处均属实，且不止三处**。

### 逐处读出的默认答案原值

| # | 位置 | 命中的表单题 | 实际填进表单的值 | 这是什么性质 |
|---|---|---|---|---|
| A | `shared/answer_routing.mjs:178-180` + `shared/answer_bank.json:118` | "你有合法工作授权吗"（Ashby 单选/多选题） | **`Yes`** | 关于本人的事实陈述 |
| B | `shared/greenhouse_apply_driver.mjs:1570` + `answer_bank.json:118` | "Are you legally authorized to work in the United States?" | **`Yes`** | 同上 |
| C | `shared/greenhouse_apply_driver.mjs:1569` | 含 "master's / masters / graduate degree" 的下拉题 | **`No`**（写死在代码里，不读档案） | 同上 |
| D | `shared/ashby_apply_driver.mjs:512` + `answer_bank.json:123` | 含 "veteran" 的题 | **`I am not a protected veteran`** | 同上 |
| E（新增，pm 未列） | `shared/answer_routing.mjs:175-177` + `answer_bank.json:119` | "将来是否需要签证担保" | **`Yes`** | 同上，且方向对用户不利 |

### 实跑证据（本轮唯一一次执行代码，纯函数、无浏览器、无提交）

对 `deriveWorkAuthAnswers()`（工作授权答案推导函数）喂 5 种档案，配上仓库里**真实出货的** `shared/answer_bank.json`：

```
US citizen (授权、无需担保)          -> authorized: Yes | sponsorship_future: Yes
NOT authorized (F-1 尚无 CPT/OPT)   -> authorized: Yes | sponsorship_future: Yes
work_authorization 字段全缺          -> authorized: Yes | sponsorship_future: Yes
连 work_authorization 整块都没有      -> authorized: Yes | sponsorship_future: Yes
当前真实用户 (F-1 OPT)               -> authorized: Yes | sponsorship_future: Yes
```

**这个函数在当前配置下是一个常数函数——无论档案说什么，永远 Yes/Yes。** 第 2 行（明确填了"未获授权"）和第 1 行（明确填了"不需要担保"）都是**明确的不实陈述**。

---

## 二、根因（Why it happened）

### 修 bug 三问（动代码前必答，本轮不修但必须答完才敢下结论）

**问 1：真正的根因是什么？**
不是"少写了一个判空"。根因是一个贯穿全仓库的写法习惯：**用 JavaScript 的真假判断（truthy check）去读一个三态字段**。

工作授权这类字段有三种状态，含义完全不同：`true`（用户说是）、`false`（用户说否）、`null / undefined`（还没问过）。代码写的是 `字段 ? 'Yes' : 默认值`——这个写法把 `false` 和 `null` 压成同一类，双双掉进"默认值"分支。而默认值又恰好被配成 `Yes`。于是"用户明确说不"和"从没问过"，最后都变成表单上的 "Yes"。

用生活化的话说：这好比一张体检表，"是否吸烟"这一栏只准填"是"，勾"否"和空着不填都被前台自动改成"是"。

**问 2：同一根因还会在别的地方爆吗？**
会，而且已经爆在 5 处（上表 A-E）。同模式扫描结果见第三节。

**问 3：这个修法是"绕过症状"还是"消除根因"？**
（本轮不修，但建议的修法必须过这一关——见第四节，我给的方案是把三态显式分开 + 把"没问过"变成阻塞项，属消除根因；给"给这几处各加一个 if"属绕过症状，我明确不推荐。）

### 逐条根因

**1. 工作授权 / 签证担保（A、B、E）**

(a) `shared/answer_routing.mjs:173-181` 原文：

```js
const sponsorAns = auth.requires_sponsorship_future
  ? 'Yes'
  : (bank.yes_no_defaults?.sponsorship_future || 'Yes');
const authorizedAns = auth.authorized_to_work_us
  ? 'Yes'
  : (bank.yes_no_defaults?.work_authorization || 'Yes');
```

配上 `answer_bank.json:118-119` 里 `work_authorization: "Yes"`、`sponsorship_future: "Yes"`，两条的 else 分支都落到 `Yes`。**函数的两个出口值相同 = 判断条件形同虚设。**

(b) **方向相反的那条（E）**：同文件的签证担保逻辑，`requires_sponsorship_future === false`（用户明确不需要担保）也走 else → `Yes`。**这会把一个美国公民在表单上标记成"需要签证担保"。**
证明这是疏漏而非设计：同一个仓库的 Greenhouse 驱动 `shared/greenhouse_apply_driver.mjs:1552-1555` 对同一件事写的是 `needsFutureSponsorship === false ? 'No' : (BANK... || 'Yes')`——**显式区分了 `false`，是对的**。两个平台对同一个事实用了两种写法，Ashby 那份写错了。

(c) `shared/greenhouse_apply_driver.mjs:1570` 更直接：`value = BANK.yes_no_defaults?.work_authorization || 'Yes'`，**整行不读档案**。而同文件的 `standardYesNoAnswerForLabel()`（第 597 行起的"标准是非题答案"函数，共处理 20 多类题）里**没有一条处理"legally authorized to work"**——我 grep 过整个文件，`authorized to work` 只在 1570 这一处出现。所以档案驱动的那条路在 Greenhouse 上对这道题**根本不存在**。

**2. 硕士学位（C）**

`shared/greenhouse_apply_driver.mjs:1569`：`else if (/master'?s|masters|graduate degree/i.test(lt)) { value = 'No'; }` —— 写死。

**这明确是疏漏，不是设计**：同一个文件里已经有一个读档案的判定函数 `isGraduateDegreeProfile()`（第 166-169 行，按 `education.degree` 判断是否研究生学位），并且在**同文件的另外两处**（第 617 行、第 1473 行）被正确使用，第 617 行还带上了溯源标记 `graduate_degree_from_profile`。唯独 1569 这一处漏了。

**3. 退伍军人身份（D）**

`shared/ashby_apply_driver.mjs:512`：`const veteranAns = BANK.yes_no_defaults?.veteran || 'I am not a protected veteran'`。
经 `shared/answer_buckets.mjs:101` 落到表单：`{ match: /veteran/i, choice: veteranAns, fallback: pna }`——**首选是事实陈述，"不愿回答"只是备胎。**

对照同一段代码里的其他 EEO（Equal Employment Opportunity，平等就业机会自愿披露）题：

| 题目 | 首选答案 | 性质 |
|---|---|---|
| 性别（`answer_buckets.mjs:98`） | `I prefer not to answer` | 拒答 ✅ |
| 种族 / 族裔（`:99`） | `I prefer not to answer` | 拒答 ✅ |
| 性取向（`:100`） | `I prefer not to answer` | 拒答 ✅ |
| 残疾（`:102`） | `I do not want to answer` | 拒答 ✅ |
| **退伍军人（`:101`）** | **`I am not a protected veteran`** | **事实陈述 ❌** |

**5 个 EEO 题里 4 个正确拒答，只有退伍军人这一个做了事实陈述。** pm 的判断（"这跟性别/种族那两项默认的不愿透露性质不同"）成立。

**4. 一条决定性的补充证据：那个"用户答过的"退伍军人身份，其实是模板预填的**

我一开始以为这条能豁免——因为真实档案 `~/.mrweirdo-jobs/profile.json` 里 `demographics.veteran_status` 确实有值 `"I am not a protected veteran"`。但对比 `shared/profile.template.json` 的出厂默认：

```json
"demographics": {
  "race": "Prefer not to say", "hispanic_or_latino": "Prefer not to say",
  "gender": "Prefer not to say", "veteran_status": "I am not a protected veteran",
  "disability_status": "I do not wish to answer"
}
```

**真实档案的这 5 个值与模板出厂值逐字节完全一致**，且我 grep 遍 `.claude/skills/mrweirdo-onboard/` 全部引导流程文件——**没有任何一处会问用户人口统计学问题**（唯二提及处是 `intake-and-profile.md:71` 的 `demographics: nullable unless explicit`（无明确输入时保持空值）和 `SKILL.md:54` 的红线本身）。

**结论：这个"退伍军人身份"从来不是用户说的，是模板出厂预填的。** 而模板预填了非空值这件事，本身就直接违反它自己那份规范里的 `nullable unless explicit`。

---

## 三、同模式风险扫描（Where else can it happen）

### 已扫描范围

全部 3 个会**自动提交**的平台驱动（`shared/apply_batch.mjs:151-153` 证实自动投递只走 greenhouse / ashby / lever 三家）+ 共享答案层 + 缺口分类器 + 6 个非自动平台的辅助文件（workday / icims / jobvite / smartrecruiters / handshake / lever）+ 运行期档案 + 投递日志 + 本地数据库。

### 扫出的新问题（pm 未列）

**扫描发现 1｜缺口分类器把人口统计学题判成"系统自己能填"，导致这类题永远进不了"该问用户"的清单**

`shared/apply_gap_report.mjs:137` 那条超长正则里，同时包含 `gender|race|ethnic|hispanic|latino|veteran|disability`、`legally authorized|authorized to work`、`bachelor`、`background check`、`compensation|salary|pay`，命中即 `return 'agent_profile_backed'`（系统按档案自动填）。

而红线原文（`docs/archive/PRD-v3.md:230` 第 4 条）说的是：

> 不编造底线（visa/GPA/demographic/attestation/background-check/relocation）不得被任何新路径旁路——`apply_gap_report.mjs` 的 `user_*` 与 `agent_attestation` 分类是底线。

**红线把 `apply_gap_report.mjs` 的分类指定为执行机制，而这台机器现在把红线点名保护的字段全部分到了"系统自动填"那一档。** 这是本轮扫描里最结构性的一条：不是某个驱动写错，是**守门人自己站错了队**。后果：即使把上面 5 处默认值全修好，这些题也永远不会出现在"下一轮该问用户什么"的清单里。

**扫描发现 2｜`standard_answers` 这个字段名在真实档案里根本不存在，6 个文件在读一个空对象**

`shared/ashby_helpers.js:816` 的原文与紧邻的注释：

```js
// Pass through original work_authorization / demographics / standard_qa
// so the existing guessYesNo / guessSelectAnswer heuristics keep working.
standard_answers: raw.standard_answers || {},
```

注释声称透传 `demographics`，代码读的却是 `standard_answers`。而真实档案 `~/.mrweirdo-jobs/profile.json` 的顶层字段是 `personal / education / work_authorization / demographics / ... / legal_attestations`——**没有 `standard_answers`**。`shared/profile.template.json` 里也没有。

于是 `guessSelectAnswer()`（`ashby_helpers.js:1229-1237`，负责按档案回答性别/种族/退伍军人/残疾）永远拿到 `{}`，永远返回 `null`，档案驱动的 EEO 路径**是一条死路**——真正生效的就是上面 D 那个写死的默认值。

同一处错误名出现在：`shared/smartrecruiters_helpers.js:113,541`、`shared/jobvite_helpers.js:331`、`shared/icims_helpers.js:301`、`shared/handshake_helpers.js:330`、`shared/workday/workday_helpers.js:245`，以及 6 份 workday 公司配置里的 `profile_path: "standard_answers.veteran_status"` 等 8 条映射。

**严重程度分层**：Ashby 是自动提交平台，**这条要紧**；其余 5 个平台目前只走人工技能、不自动提交（`apply_batch.mjs:151-153` 证实），属"接线时会踩的坑"，可以排在后面。

**扫描发现 3｜Lever 与 Greenhouse 的退伍军人题也偏向事实陈述，但比 Ashby 轻**

- `shared/lever_apply_driver.mjs:275`：`[demographics.veteran_status, 'I am not a protected veteran', 'No']` —— 先读档案（Lever 是唯一正确读了 `PROFILE.demographics` 的驱动，`:217`），读不到才退到事实陈述。**比 Ashby 好，但兜底方向仍是陈述而非拒答。**
- `shared/greenhouse_apply_driver.mjs:1643-1644`：候选顺序 `['No', "I don't wish to answer", 'I prefer not to answer', 'Prefer not to answer', BANK 默认]`——**`'No'` 排在最前**。按 `reactSelectOneOf`（第 1175 行起）的语义是逐个试、第一个能选中的就用；标准 Greenhouse 退伍军人下拉一般没有裸 "No" 选项，所以实际大概率落到第 2 个"不愿回答"，**但这属于运气，不属于设计**。相比之下同文件性别（`:1638`）、种族（`:1641`）的候选表第一项就是拒答，是对的。

**扫描发现 4｜系统没有"答了什么"的审计留痕，导致"有没有发生过"这个问题结构性无法回答**

- `~/.mrweirdo-jobs/feedback.jsonl`（126 行）：15 条 `submitted` 里只有 2 条带 `fields_filled` 字段，其余 13 条是 `null`。
- 本地数据库 `jobs.db` 的 `feedback` 表只有 `id / job_id / ts / outcome / reason / detail` 六列，`detail` 里存的是**跳过时缺了哪些字段**（`missing`），**不存填进去了什么**。
- 数据库计数：`submitted_at` 非空 158 行、`auto_submitted_at` 非空 183 行。

**这意味着 180 多条真实投递里，绝大多数答了什么已经不可考。** 这条本身就是需要修的东西——它同时也是 pm 那条 US-4 验收项（"每轮总结里能看到 N 条来自你亲口给的事实、M 条来自系统默认"）的前置条件。

### 扫描后仍判定为"没问题"的（列出来免得以为漏了）

- 性别 / 种族 / 族裔 / 性取向 / 残疾：三个自动提交平台**一致拒答**，符合 EEO 类问题的正确做法。
- Ashby 的"特定城市居住 / 通勤事实"守卫（`shared/ashby_apply_driver.mjs:516-539`）：设计正确且注释详尽——不替用户承诺没确认过的具体城市生活事实，转为待问。**这说明团队本来就知道这条红线怎么落地，只是没覆盖到工作授权/学位/退伍军人这几类。**
- Greenhouse 的语言水平（`:1598-1601`）、出口管制（`:604-606`）、竞业条款（`:622-625`）、亲属任职（`:651-661`）：档案里没有就返回 `needs_user_answer`（转为待问）**而不是编一个**，写法正确，可作为修复模板。

---

## 四、修复方案（How to fix）— 建议，本轮不执行

> 每条都标了"消除根因"还是"绕过症状"，并说明为什么。排序 = 建议的动手顺序。

**F1｜把三态判断显式写开，"没问过"必须变成阻塞项（消除根因）**
`shared/answer_routing.mjs:173-181` 改成显式三分支：`=== true → 'Yes'`、`=== false → 'No'`、其余（`null`/`undefined`/缺失）→ 返回 `{ needs_user_answer: true, note: 'work_authorization_required' }`，交给现成的待问机制（该机制已在同仓库多处正常工作，见上面"没问题"清单）。签证担保同样处理。
**为什么不是"把默认值从 Yes 改成 No"**：那只是把说假话的方向掉个头，仍然是编造。
**为什么不是"给这几处各加一个 if"**：那是绕过症状——根因是三态字段用真假判断读，不显式写开就一定会在下一个新平台上重犯。

**F2｜Greenhouse 的三处改成走档案（消除根因）**
- `:1570` 改为调用 `deriveWorkAuthAnswers()`（F1 修好之后），或走同文件的 `standardYesNoAnswerForLabel()` 并给它补上"legally authorized"这一条。
- `:1569` 改为调用同文件已有的 `isGraduateDegreeProfile()`，与 `:617`、`:1473` 保持一致。这条改动最小、风险最低，**建议第一个做**。
- `:1644` 候选表把 `'No'` 从第一位挪走，与同文件性别/种族的写法对齐。

**F3｜退伍军人题的默认改成拒答（消除根因）**
`shared/ashby_apply_driver.mjs:512` 与 `shared/answer_bank.json:123`：默认值改为 `I don't wish to answer` 一类的拒答，与性别/种族/残疾一致；只有用户**明确回答过**才做事实陈述。Lever `:275` 的兜底同理。

**F4｜模板不再预填人口统计学值（消除根因，且是 F3 的前提）**
`shared/profile.template.json` 的 `demographics` 五项改为 `null`，与其自身规范 `demographics: nullable unless explicit`（`intake-and-profile.md:71`）对齐。
**不做这条，F3 做了也白做**——因为代码无法分辨"用户答的"和"模板预填的"，现在这两者字节相同。

**F5｜把守门人拉回正确一边（消除根因，结构性）**
`shared/apply_gap_report.mjs:137`：把 `gender|race|ethnic|hispanic|latino|veteran|disability` 与 `legally authorized|authorized to work` 从 `agent_profile_backed` 里摘出来，改成"档案里有明确值才算系统能填，否则归 `user_*`"——同文件的 GPA（`:159`）、语言（`:154-158`）、最早到岗日（`:149`）**已经是这个写法**，照抄即可。
这条同时兑现 pm 提的"上一轮卡点变成下一轮前置问题"。

**F6｜补审计留痕（既是防回归手段，也是产品功能）**
每条提交在 `feedback.jsonl` 里记录字段级答案 + 每条答案的来源标记（`profile` 档案 / `user` 用户明确回答 / `bank_default` 共用默认值）。有了它才能回答"有没有发生过"，也才能做 pm 那条 US-4。
现成的模式已经存在：Greenhouse 的 `note: 'graduate_degree_from_profile'` / `'not_graduate_degree_from_profile'`（`:617`）就是溯源标记，只是没有被落盘。

**F7｜清理 `standard_answers` 字段名错配（消除根因）**
要么把 6 个辅助文件改读 `demographics` / `work_authorization` / `standard_qa`（与注释声称的一致），要么删掉这些永远返回 `null` 的死启发式。**留着最危险**——它让人误以为 EEO 有档案兜底，实际没有。

### 显式取舍面

| 取舍 | 我的建议 | 为什么 |
|---|---|---|
| 只修 pm 点名的 3 处 vs 修全部 7 条 | **全部**，但分两批：F1-F4 一批（不实陈述），F5-F7 一批（机制层） | 只修 3 处会留下方向相反的担保 bug（E）和守门人错位（F5），下一轮换个平台照样复发 |
| 缺值时"填保守默认" vs "阻塞该行" | **阻塞该行** | 项目自己的红线原文就是"未知的事实保持空值，或者变成问/跳过的阻塞项"；且已拍板的第 2 优先"单行缺信息只跳过该行、绝不中止整批"正好为此铺好了路 |
| 现在修 vs 排在"修投递读数"之后 | **F2 的学位一条可以立刻做**（3 行、零风险、同文件已有正确函数）；其余排在读数修复之后、**任何新用户上手之前** | 41 天零投递 = 不在着火；但一旦按 pm 的建议邀 3-5 个非创始人试用，这几条会同时对外爆开 |

---

## 五、防回归（How to prevent regression）

> 本轮未写代码，故未加测试。以下是**修复时必须一起加的**，按"先红后绿"（先写出会失败的测试，再改代码让它通过）。

1. **红线守卫测试**：`deriveWorkAuthAnswers()` 对 `authorized_to_work_us: false` 必须返回 `'No'` 或阻塞、对缺失必须阻塞。现有 `test/answer_routing.test.mjs:75-89` **只测了 `true` 的两种情形**，`false` 和缺失两种全部无覆盖——这正是它一路绿灯到今天的原因。
2. **常数函数检测**：断言"给 3 种不同档案，输出不能全部相同"。今天这个函数 5 种输入输出全同，任何一条这种断言都能当场抓住。
3. **EEO 一致性测试**：性别 / 种族 / 性取向 / 残疾 / 退伍军人五题的默认答案，必须全部落在"拒答"集合里；新增 EEO 题自动纳入。
4. **模板与规范一致性测试**：`profile.template.json` 的 `demographics` 五项必须为 `null`（对齐 `nullable unless explicit`）。
5. **分类器红线测试**：`classifyField()` 对"档案无明确值"的 demographic / visa / GPA / background-check / relocation / 薪资六类，必须返回 `user_*` 开头的分类。这是把 `PRD-v3.md:230` 那条红线**变成可执行断言**。
6. **字段名存在性测试**：断言驱动读取的每个档案路径都在 `profile.template.json` 里存在——直接杀掉 `standard_answers` 这类错配。

---

## 六、教训（What to remember）

> 以下 3 条我判断值得沉淀进项目记忆或岗位补充说明。**我不自己改项目记忆，提请 lead 决定。**

1. **"绝不编造个人事实"这条红线，此前只是一句写在文档里的话，没有任何可执行的守卫。** 红线原文自己指定了执行机制（`apply_gap_report.mjs` 的 `user_*` 分类），而那台机器恰好把红线保护的字段全判给了"系统自动填"。**教训：红线必须落成断言，否则它只是一句愿望。**

2. **三态字段（是 / 否 / 没问过）绝不能用真假判断读。** 这是本轮 5 处问题的同一个根因。建议写进岗位补充说明当作硬规矩：凡"关于用户本人的事实"字段，`true` / `false` / 缺失三条路必须显式写开，缺失一律阻塞。

3. **"默认值恰好等于当前唯一用户的真实情况"是最危险的一种绿灯。** 5 个默认值里 4 个碰巧对，所以 183 次投递没人发现异常；测试也全绿，因为测试只喂了"正确"的那种档案。**教训：只有一个用户的时候，测试必须主动喂"不像我"的档案。**

**另附一条给 pm 的答复**：pm 那份报告 §9 第 3 条的三处**全部属实**，判断（含"退伍军人这条与性别/种族性质不同"）**全部成立**，没有一处夸大。它未能核实的两点（实际触发频率、是否真的发生过），本轮结论是：**触发条件比 pm 估计的更宽**（不需要档案缺值，`false` 也照样触发；Greenhouse 那条压根不读档案），**但历史上没找到答错的证据，且系统没有留痕可供彻底证伪**。

---

## 试过的错误方向

**❌ 方向 1：以为 Greenhouse 有档案驱动的路径会抢在写死默认值之前，所以 `:1570` 不会真的触发**
起因是我先读到 `shared/greenhouse_helpers.js:382-384`，那里 `if (auth.authorized_to_work_us != null) addPick('legally authorized', ...)` 确实正确读了档案。
**失败原因**：我读了函数却没追调用顺序。追下去发现 `greenhouse_helpers` 的 `addPick` 属于**首轮批量填表**（按标签子串匹配），而 `:1570` 位于 `answerMissing()`（第 1367 行起）——**这是首轮填完之后针对"仍然空着的必填项"的补救轮**。也就是说 `:1570` 恰恰是在"档案驱动那条路没能填上"的时候才跑。**结论完全反转：不是不会触发，而是它专门在最该谨慎的时候触发。**

**❌ 方向 2：以为退伍军人这条有豁免——因为真实档案里 `demographics.veteran_status` 有值，说明用户答过**
一度成立，若成立则 D 降级为"用了用户自己给的答案"，不算编造。
**失败原因**：与 `shared/profile.template.json` 逐字段比对，真实档案那 5 个人口统计学值与模板出厂默认**逐字节完全一致**；再 grep 遍整个 onboard 引导流程，**没有任何一处会问人口统计学问题**。所以那不是用户的回答，是模板预填。这个方向翻车之后反而挖出了更硬的一条（F4：模板预填导致"用户说的"和"出厂默认"在数据上不可区分）。

**❌ 方向 3：以为投递日志和数据库能直接给出"历史上到底有没有答错"的答案**
计划是 grep `feedback.jsonl` + 查 `jobs.db` 的 feedback 表，统计这几类答案的历史取值。
**失败原因**：15 条 `submitted` 记录里只有 2 条带 `fields_filled`；数据库 feedback 表只有六列，`detail` 存的是**跳过时缺什么**，不存**填了什么**。退伍军人 / 硕士学位在全部日志里 0 命中——但这是"没记录"，不是"没发生"。**这个方向失败本身成了扫描发现 4（缺审计留痕）和建议 F6。**

**❌ 方向 4：以为把 `answer_bank.json` 里的默认值从 `Yes` 改成 `No` 就能解决**
最省事，改一个 JSON 文件即可。
**失败原因**：过不了修 bug 三问的第 3 问。这只是把说假话的方向掉个头——对一个真的有工作授权、但档案还没填的用户，答 `No` 同样是编造，而且直接害他被刷掉。根因是"三态压成两态"，不是"默认值选错了边"。

---

## 交付自查

- ☑ 修 bug 三问答完才下的结论；本轮**未动任何代码**（`git status` 无新增改动，只新增本报告）
- ☑ 找到的是根因（三态字段用真假判断读）不是症状层
- ☑ 同模式扫描做了：3 个自动提交平台 + 共享答案层 + 分类器 + 6 个非自动平台辅助文件，扫出 4 条 pm 未列的新问题
- ☑ 事实与推测严格分开：代码行号、实跑输出、日志/数据库计数 = 事实；"普通用户实际会不会撞上" = 推测（见下）
- ☑ 防回归方案给了 6 条，指出了现有测试的具体覆盖缺口（`test/answer_routing.test.mjs:75-89` 只测 `true`）
- ☑ 结构性教训写进"教训"段，提请 lead 决定是否沉淀，**未自行修改项目记忆**
- ☑ 数据库全程只读；未跑投递、未提交任何表单
- ☑ 英文术语均带中文注释；用词按项目术语表（用户 / 投递 / 岗位）
- ⚠️ **本轮的推测部分，明确标出**：① "普通用户走完引导后这些字段会不会被填上"——引导流程的 A0 硬边界问题确实会写入 `work_authorization`（`intake-and-profile.md:10-14`、`:54-66`），**但那是给模型的自然语言指令，不是代码强制**，我没有能力核实模型每次都照做；② 退伍军人 / 硕士学位**没有任何引导问题覆盖**，这两类是确定会撞上默认值的（事实，非推测）；③ Greenhouse 退伍军人题候选表里 `'No'` 排首位实际会不会被选中，取决于各家表单的选项文案，我**未在真实表单上验证**（任务禁止真跑）。
