---
Status: done
Owner: arnold-bug
Type: BUG_REPORT
Iterations: 1
Updated: 2026-07-26
Reads:
  - docs/active/2026-07-23_product-blueprint_VERIFY_REPORT.md §5.1.5 / §5.1.6
  - docs/active/2026-07-23_product-blueprint_BUILD.md（第 8-9 轮）
  - docs/active/2026-07-23_product-blueprint_DESIGN.md ADR-3 / ADR-4 / §13.5
  - shared/apply_gap_report.mjs / shared/missing_field_questions.mjs
  - PROJECT_MEMORY.md（长期原则 1、2、5）
Blocks:
  - 本轮只诊断不施工；修法由 lead 拍板后派 arnold-builder
---

# 键与题面之间只有字符串关系，没有身份关系

> **本轮零代码改动。** 产品代码（`shared/`）一行没碰，`git status` 里 `shared/` 干净。
> 所有结论都是**用出货代码跑出来的**，不是读代码推的。

## 一、现场（What happened）

### 1.1 两个方向的错，一个根因

验收第 4 轮实测报了两件事，它们是同一枚硬币的两面：

- **果一（假阳性）**：6 个「与档案里已有的键共享一段连续词、但问的是另一件事」的题面，
  被判成「档案里有，交给系统填」。危害是**把一个不相干的档案值填到表上**
  （拿「你现在住的城市」去填「你的出生城市」）——命中项目记忆第 1 条红线「绝不编造个人事实」。
- **果二（假阴性）**：拍板人档案里 2 条已经答过的事实仍被反复问
  （`lives_in_west_end_neighborhood` / `previously_employed_here_default`）。

### 1.2 我自己重跑的复现（三棵树对照，出货 CLI，未改一字）

方法：`git archive` 把三棵树各解出一份只读检出（**不用 `git worktree add`，避免对仓库做任何 git 写操作**），
把拍板人真实档案**整份复制出来**放进沙箱家目录，一道题一份结果文件喂给真实的缺口报告 CLI，
用 `MRWEIRDO_HOME` / `MRWEIRDO_ONBOARD_TMP_DIR` / `MRWEIRDO_DB_PATH` 三个开关把读写全部圈进沙箱。

| 树 | 是什么 |
|---|---|
| `a1ffd15` | `ce48d4f` 之前——桶非空即算已答（`nonEmpty(custom_facts)`） |
| `a4a865e` | 本轮（`953e99a`）之前——`ce48d4f` 已把「按题面逐条比对」接进白名单那条路 |
| `7a3d5aa` | 今天的出货代码（HEAD） |

**果一复现（验收那 6 道碰撞题）**：

| 题面 | `a1ffd15` | `a4a865e`（改前） | `7a3d5aa`（HEAD） |
|---|---|---|---|
| What is your **current city** of birth? | 照问 | 照问 | ❌ 系统填 |
| What was your **permanent residence state** before 2020? | 照问 | 照问 | ❌ 系统填 |
| Are you a **US citizen** of the country where you will work? | 照问 | 照问 | ❌ 系统填 |
| Who in your household is a **US citizen**? | 照问 | 照问 | ❌ 系统填 |
| How many years of **Figma proficiency** does your team have? | 照问 | 照问 | ❌ 系统填 |
| Which **Excel proficiency** certification have you earned? | 走别的规则 | 同左 | 同左 |

**果二复现**：验收那 10 道自然题面，HEAD 上 8 道不问、2 道仍问，与验收 §5.1.1 逐格一致。

### 1.3 「机制没变、射程变宽」这句话——**实证成立，但只成立一半**

派遣单要求我自己实证这句话，我实证了，结论要分两半说：

**成立的那一半**：我自己造了 6 道「同时命中题面白名单 + 与不相干的键有连续词碰撞」的题，
**三棵树全部误判成「系统填」**——包括 `ce48d4f` 之前那棵。同一批题在
「`custom_facts` 清空」的对照档案上三棵树全部翻回「照问」，说明**确实是键↔题面的字符串关系在做决定**：

| 我造的题面（都带驱动的「这格没值」标记） | `a1ffd15` 满/空 | `a4a865e` 满/空 | HEAD 满/空 |
|---|---|---|---|
| Do you live in the same **permanent residence state** as your parents? | 系统填 / 照问 | 系统填 / 照问 | 系统填 / 照问 |
| What is your preferred name in your **current city** office directory? | 系统填 / 照问 | 系统填 / 照问 | 系统填 / 照问 |
| Where do you currently live, if not the **current city** on your resume? | 系统填 / 照问 | 系统填 / 照问 | 系统填 / 照问 |
| What is your primary phone in your **current city**? | 系统填 / 照问 | 系统填 / 照问 | 系统填 / 照问 |
| Do you reside in the West End neighborhood of a **US citizen** household? | 系统填 / 照问 | 系统填 / 照问 | 系统填 / 照问 |
| What is your expected graduation month for your **Excel proficiency** certificate? | 系统填 / 照问 | 系统填 / 照问 | 系统填 / 照问 |

**⇒ 假阳性面在 `953e99a` 之前就存在，而且在 `ce48d4f` 之前更宽**：那时的谓词是「桶里有东西就算答过」，
连词段碰撞都不需要——任何命中白名单的题，只要驱动说「这格没值」，就一律判「系统填」。
**`ce48d4f` 其实是把这个面收窄了，`953e99a` 是把收窄后的规则铺到了兜底那条路。**

**不成立的那一半**：验收把「白名单那条路和标记表那条路早就在用」并列，
但**标记表那条路根本走不到词段匹配**——`NOTE_CATEGORY` 的 17 个值里没有 `unknown_user_fact`，
`categoryAnswered()` 永远不会在那条路上调到 `customFactAnswered()`。
标记表那条路上确实有别的「键↔题面字符串关系」（见 §3.1 的第 12、16 条规则），但不是这一条。
**这是措辞不准，不改变结论。**

## 二、根因（Why it happened）

### 2.1 一句话根因

**`custom_facts`（无处安放的事实桶）里的键，既当"存哪儿"的地址，又当"这条答的是哪道题"的身份证；
而它当身份证用的时候，靠的只是「键的词连着出现在题面里」——一个字符串包含关系，不是身份关系。**

包含关系天生不对称、不排他：
- `current_city` ⊂ `current city of birth` → **多认了**（假阳性）
- `lives_in_west_end_neighborhood` ⊄ `do you live in the west end neighborhood` → **少认了**（假阴性）

同一个谓词，同一个方向的缺陷，两个方向的果。这就是验收说"分开修两次不划算"的道理，我核实了，成立。

### 2.2 完整判定链路（**本项目此前没人完整写下来过**）

一道题从驱动发出到最后被判成「问用户 / 系统填」，一共走五段、21 道规则。

**第 1 段 · 现场采集（驱动侧）**
`shared/greenhouse_apply_driver.mjs:1703` 填不出来时发出
`{ok:false, note:'value_empty_for:' + 题面小写前 30 个字符}`；Ashby / Lever 同理（还有 `no_bucket_for:` 前缀）。
⚠️ **题面在这里就被截断到 30 字符**——note 只带得动「我这格没值」，带不动「我说的是哪道题」。

**第 2 段 · 收集** `apply_gap_report.mjs:84-116 collectFields()`
从结果文件的 7 个数组（blockers / remaining / missing / last_missing / still_missing / pending）
再加 `answer_pass` 的两趟，整成 `{label, source, note, options}`。

**第 3 段 · 判定** `classifyField()`（`:161-320`），**21 道规则从上往下，第一个命中即返回**：

| # | 行 | 规则 | 查不查档案 |
|--:|---|---|---|
| 1 | :235 | captcha（人机验证）→ 人工 | 否 |
| 2 | :251-258 | **标记表**：字段自己的 note 精确命中 `NOTE_CATEGORY` 的 17 个静态键 → 该类目；再用同名谓词复查档案，有值就翻成「系统填」 | 是 |
| 3 | :260 | 隐私 / 同意 / 仲裁 / **certification（证书）** / true and complete → 系统声明 | **否，无条件** |
| 4 | :261 | confirm…true/correct/accurate → 系统声明 | 否 |
| 5 | :266 | 工作授权正则 → 双布尔三态齐了才算已答 | 是 |
| 6 | :269 | EEO（平等就业机会自愿披露）正则 | 是 |
| 7 | :272 | **题面白名单**（约 30 个片段：preferred name / phone / currently live / compensation / resume / expected graduation / major …）→ 驱动说「这格没值」就走 `noValueCategory()`（**词段匹配入口 ①**），否则**直接判系统填** | 半 |
| 8-11 | :273-288 | 外部表单 / 竞业与供应商关系 / 完整地址 / 地址 note | 是 |
| 12 | :289 | onsite / hybrid / 城市名 → 把 `work_location_commitments` 的**键当整词**去题面里 `\b…\b` 匹配 | 是（**键↔题面字符串关系**） |
| 13-15 | :294-300 | 开始日期 / 高中 / 政府亲属 | 是（高中除外） |
| 16 | :301 | 语言 → 把 `language_proficiency` 的**键当子串**去题面里 `includes` 匹配（**连词边界都没有**） | 是（**键↔题面字符串关系**） |
| 17-18 | :306-307 | GPA / 通勤与驾照 | GPA 查、通勤不查 |
| 19 | :308 | **work environment / previously employed / previously worked at / ever worked at → 系统填** | **否，无条件** |
| 20 | :309-311 | agent_pending 来源 / essay / why・explain・describe… → 系统起草 | 否 |
| 21 | :319 | **兜底 → `noValueCategory()`**（**词段匹配入口 ②，本轮新接**） | 是（**键↔题面字符串关系**） |

**谁优先、谁兜底**：标记表（2）> 一长串题面正则（3-20）> 词段兜底（21）。
⚠️ **ADR-3「note 主导、题面正则退为兜底」只落实了一半**：标记表只认 17 个**静态** note，
而驱动实际发出的绝大多数是**动态** note（`value_empty_for:` / `no_bucket_for:`），
它们进不了标记表（后缀无界，注释 `:146-158` 自己写明了），
于是仍旧由题面正则领跑、由词段兜底收尾——**这才是设计意图与实现之间的漂移，也是这个 bug 的土壤。**

**第 4 段 · 归并与出口**（`:421-521`）
- 按类目分组，按 `label::company` 去重
- `user_*` / `unknown_user_fact` → `user_questions` + `condensed_missing_questions`
  ——**这是全系统唯一会去问用户的出口**；`unknown_user_fact` 每条还额外发布 `profile_key`（写回键）
- `agent_*` → `agent_actions`，文案写死 **"Do not ask the user first. Fill from existing profile…"**
  （**一句给模型的自然语言指令**，不是代码）
- 三类里凡在 `RETRYABLE_CATEGORIES`（`:345-363`）的行 → `retry_candidates`，
  带 `requires_user_answer` / `agent_can_handle` 两个布尔

**第 5 段 · 消费**
- `.claude/skills/mrweirdo-onboard/SKILL.md:392-408`：模型读报告，只有 `condensed_missing_questions` 非空才问用户（一次最多 4 题）
- `shared/retry_gap_rows.mjs`：按 `retry_candidates` 把行重新排队 → `apply_supervisor.mjs --real` 再跑驱动

### 2.3 判错成「系统填」到底会发生什么——**验收的伤害判断要修正一处**

我用出货 CLI 单跑一道真实题面（`Are you open to starting full-time immediately after your internship?…`，
沙箱档案里放了 `school` 这个键），拿到完整报告：

```
user_questions:                []      ← 用户永远不会被问到
condensed_missing_questions:   []      ← 同上
agent_actions: [{ category: "agent_profile_backed",
                  action: "Do not ask the user first. Fill from existing profile, ..." }]
retry_candidates: [{ row_id: 4242, requires_user_answer: false, agent_can_handle: true }]
```

再加一条我自己核的事实：**全仓库除了 `apply_gap_report.mjs` 自己，没有任何代码读 `standard_qa.custom_facts`**
（`grep -rn custom_facts shared/ .claude/skills/ scripts/ bin/`，命中全是注释和这一条规则本身）。

所以一次假阳性同时产生**两种**后果，不是一种：

1. **编造（红线）**——报告白纸黑字命令模型「别问用户，从现有档案里填」。
   模型去档案里找，能找到的只有那个撞上的、意思完全不同的值。
   **这是项目记忆第 1 条最典型的复发形态：红线的执行者自己站错了队。**
2. **静默卡死**——用户这一侧的出口是空的（`user_questions: []`），代码这一侧的驱动读不到 `custom_facts`，
   下一轮照样发同样的 note、照样判「系统填」、照样重排队。
   **除非模型自己编一个值填进去，这一行会永远转圈，而且不会有任何人被问到。**

> ⚠️ **验收 §5.1.5 第 2 点写的「不产生死锁：行不会被永远卡住」——在代码层面不成立。**
> 它成立的前提是「模型会把它填掉」，而模型把它填掉恰恰就是第 1 种后果（编造）。
> **两种后果二选一，没有第三条路。** 这是我对上游结论的修正，严重度仍是 P2，但性质要说准。

## 三、同模式风险扫描（Where else can it happen）

### 3.1 「键↔题面只有字符串关系」在本文件里一共三处，不止一处

| 处 | 行 | 拿什么去撞题面 | 匹配强度 | 今天的射程 |
|---|---|---|---|---|
| ① 通用事实桶 | :231 / :250 | `custom_facts` 的键 | 连续词段（带词边界） | 本报告主角 |
| ② 地点承诺 | :172-186 | `work_location_commitments` 的键 | 整词 `\b…\b` | 键是城市名，碰撞概率低 |
| ③ 语言水平 | :301-305 | `language_proficiency` 的键 | **裸 `includes`，连词边界都没有** | 键是语言名；实测 `Is English your first language?` 被判「系统填」，而档案里那格记的是**熟练度**，答的不是「是不是母语」 |

③ 值得单列：它是三处里匹配最松的一处（一个叫 `Ga` 的语言会撞上 `Chicago`），
而且**标记表那条路和题面那条路对同一件事用了两套谓词**——
标记表用「桶非空」（`:218`），题面用「按语言逐个撞」（`:303`），
同一道题走哪条路进来，答案可能不一样。这是同根同源的第二个入口。

### 3.2 无条件判「系统填 / 系统声明」的规则——**代跑射程不是零**

验收 §5.1.5 第 1 点用「代跑场景射程为零」给这条 bug 降了级。
**对①号入口而言这句话成立**（我实测：107 道真实题面在空桶档案上，判定与满桶档案**逐条相同，0 处差异**）。
**但对同族的第 3、19 条规则不成立**——它们压根不查档案：

我造了一份「全新代跑学生」档案（各桶全空、GPA 空、地址空），跑出货 CLI：

| 题面 | 空档案上的判定 |
|---|---|
| `Have you previously worked at Faraday Future?` | ❌ **系统填**（第 19 条，无条件） |
| `What do you value in a work environment/work culture? What motivates you…`（**真实题面**） | ❌ **系统填**（第 19 条抢在第 20 条「essay 交给模型起草」之前命中 `work environment`） |
| `Statement of interest (500 word limit)…`（**真实题面**） | ⚠️ 系统声明（第 3 条撞上 `certification`… 实为 `interest` 段里的词） |

**⇒ 一份什么都没有的档案，也会被告知「这题从现有档案里填」。**
这是同一个根因（规则与题面之间只有字符串关系）走到极端的样子，且**它在本轮交付的代跑场景里是活的**。

顺带纠正验收 §5.1.1 表格第 8 行的读法：`Have you previously worked at Faraday Future?` 改前改后都「不问」，
但**不是因为档案里有 `previously_worked_at_faraday_future`**，而是被第 19 条无条件拦下了。
把它记成「碰巧结论对了」比记成「档案认出来了」更准确。

### 3.3 我没有扩大修复范围

以上两条（§3.1 ③、§3.2）**属于同一根因家族、同一严重度（P2）**，
按行为卡我停在这里、不自行扩范围，也不认为它们够格触发「立即停下报告」的升级。
**建议 lead 把它们和主案并成同一件活排给 builder**，理由同验收：分开修三次不划算。

## 四、量了多少（现存的面）

**语料来源**：拍板人真实运行留痕（`feedback.jsonl` 126 行 + `essay_pending.jsonl` 99 行 + `reports/` 102 份），
只抽取表单**题面文本**（雇主写的题目，不是个人数据），去重后 **107 道真实题面**。
**只读**，证据见 §7。

### 4.1 存量（今天这一刻）

| 方向 | 数字 | 怎么量的 |
|---|---:|---|
| 假阳性（判成「系统填」，实为编造） | **0 / 107** | 同一批真实题面，满桶档案 vs 空桶档案跑出货 CLI，**逐条判定完全相同**；本轮改动（`a4a865e` → HEAD）对这 107 条也是 **0 处差异** |
| 假阴性（已答仍被问） | **2 / 10** | 拍板人 11 条已答事实对应的 10 道自然题面，HEAD 上 2 道仍问（复现验收 §5.1.1） |
| 代跑（空档案）假阳性 | **1 / 107** | `What do you value in a work environment…` 被无条件判「系统填」（§3.2，属同族第 19 条） |

**⚠️ 存量为 0 不等于面为 0——面会自我增殖。**

### 4.2 增量：这个面是**用户每答一题就自己长大一圈**

107 道真实题面里，**53 道**落进通用桶、去留完全由「键↔题面字符串关系」决定。
报告会为这 53 道各发布一个写回键，其中 **10 个只有 ≤2 个词**（`name` / `school` / `email` / `resume` / `degree` / `finance` …）——词越短越容易撞上别的题。

**决定性实验**：把这 53 道题里 3 道的**报告自己发布的键**写进沙箱档案，再拿**同一批真实题面**重跑出货 CLI：

| 写进去的键（报告自己发的） | 来自哪道真实题面 | 结果：另一道**真实题面**跟着翻车 | 在改前树上 |
|---|---|---|---|
| `name` | `Name` | `What is your preferred name?` → ❌ 系统填 | ❌ 改前就翻（走白名单那条路） |
| `school` | `School` | `Are you open to starting full-time immediately after your internship? (either graduated or willing to take time off from school)` → ❌ 系统填 | ✅ 改前照问（**这一条是本轮射程放宽新添的**） |

**这两条都不是我编的题面，是拍板人自己表单上真出现过的原句。**
第一条会让系统把**法定姓名**填进**惯用名**那一格；
第二条会让系统拿**学校名**去回答**"实习结束能不能立刻转全职"**——两条都是编造。

**⇒ 量化结论：存量 0，但只要用户按报告的指示答完这批题，立刻产生 2 处真实假阳性，
其中 1 处是本轮射程放宽新增的。这个面随档案增长单调变大，且增长是系统自己驱动的。**

### 4.3 样本局限（如实交代）

- 107 道题面来自**单一用户、约 200 次历史投递**，且**绝大部分采集于这 11 条事实被写进档案之前**——
  所以「存量 0」有一半是采集顺序造成的，不能读成「这条 bug 不存在」。
- 107 道里 43 道是 essay（走第 20 条），真正落桶的只有 53 道，统计基数偏小。
- 没有第二个用户的语料可交叉验证。

## 五、修复方案（How to fix）

### 5.1 两个方向的错，伤在哪 —— 必须先把这条讲清楚，它决定选型

| 判错方向 | 后果 | 有界吗 | 能自愈吗 |
|---|---|---|---|
| 判成**「问用户」**（假阴性） | 多问一次 | **有界**：每条事实最多多问一次 | **能**，验收 §5.1.6 已实测跑通闭环：按报告发布的键写回 → 再问同一题 → 不问了 |
| 判成**「系统填」**（假阳性） | ① 编造（红线）或 ② 静默卡死，二选一（§2.3） | **无界**：随档案增长单调变大 | **不能**：用户根本不会被问到，没有任何人能把它掰回来 |

**两个方向不对等，差得很远。** 在信息最丰富处解决的原则下，
**任何修法都应当在拿不准时倒向「问用户」，而不是倒向「系统填」。**

### 5.2 三条候选

#### 候选 A：给键加「这条键管哪道题」的元信息（验收候选一）

`custom_facts` 的值从裸标量改成 `{value, asked_label}`，判定改成比对归一化后的原题面。

- **代价**：`custom_facts` 的形状变了 → `record_profile_answers.mjs` 的类型校验、
  `validate_user_profile.mjs` 都要跟着改；现有 11 条裸标量要做向后兼容（老条目退回今天的词段匹配，或一次性回填）。
- **⚠️ 一条不能走的近路**：`answer_provenance.json`（留痕旁挂文件）已经有 `category` / `asked_by` 两格，
  看起来是白捡的落点。**不行**——**ADR-4 白纸黑字规定留痕不参与填表判断**，
  理由正是「留痕文件损坏 / 丢失不影响投递，是纯增益组件」。
  把判定依赖挂上去等于当场废掉 ADR-4。要做就在 `profile.json` 里做。
- **好处**：把「地址」和「身份证」拆成两件东西——这是根因层面的解法，不是收紧参数。

#### 候选 B：把匹配收紧成整题面比对（验收候选二）

判定改成 `customFactKey(题面)` 与键**完全相等**。

- **我实测的代价（拍板人真实档案）**：认得出的从 **7/10 掉到 4/10**——
  `excel_proficiency` / `figma_proficiency` / `google_sheets_proficiency` 三条会**多问一次**
  （题面是 `Rate your Excel proficiency`，收紧后要求的键是 `rate_your_excel_proficiency`）。
  加上原本就问的 2 条，**假阴性从 2/10 变成 5/10**。
- **派遣单点名要答的问题「收紧会不会把果二变得更严重」——会，从 2 变 5。**
  但这 3 条**每条只多问一次就永久闭上**（验收已实测闭环自愈），
  且**代跑新用户的代价为零**（桶是空的，没有存量键要重新认）。
- **另一项代价**：对「同一件事换个说法」零容忍。真实语料里已有 3 对近义题面
  （`Will you now or in the future require visa sponsorship?` vs `Will you require VISA sponsorship now or in the future?` —— 词完全相同、顺序不同，键就不同）。
  这 3 对今天都走别的规则，暂时打不着桶，但换个用户就未必。

#### 候选 C：什么都不改，只把伤害口子堵上

不动匹配，改把 `agent_profile_backed` 这一类**同时**也进 `user_questions`（"我打算这么填，对吗"）。

- **代价**：每轮多问一堆本来不用问的题，直接违反「问题集要收敛」的产品决策；
  而且不解决根因，只是把编造改成了骚扰。**我不推荐，列在这里是为了让取舍面完整。**

### 5.3 我的推荐：**B 先落地，A 排在后面；两件都做，不是二选一**

**理由（显式列取舍面）**：

- **快 vs 彻底**：B 是收紧参数，A 是改数据结构。B 能在几行内落地并立刻**把无界的那一侧堵死**；
  A 才是根因解法，但它动 `profile.json` 的形状、牵三个校验器，是独立一件活。
- **两个方向的错不对等（§5.1）**：B 用「假阴性 2→5」换「假阳性面从自我增殖变成 0」——
  拿**有界可自愈的代价**换**无界不可自愈的风险**，这笔账在红线面前没有第二种算法。
- **代跑场景（本轮交付的场景）B 的代价恰好为零**，成本全部落在拍板人自己那份老档案上，
  而他一共只需要多答 3 次。
- **B 落地后 A 依然值得做**：B 把「键即题面指纹」这件事变成硬约定，
  A 只是把这个指纹从「猜出来的」升级成「记下来的」，两者不冲突、是同一条路的两段。

**B 落地时必须一并做的两件事**（否则会新造 bug）：
1. 现有 11 条键里有 3 条是手写的短键，收紧后会失配。**必须在报告里明确告诉用户「这 3 题会再问你一次，答完就好」**，
   不能让它表现成"系统忘了我说过的话"。
2. 收紧的是①号入口，**②③号入口（§3.1）和第 3、19 条无条件规则（§3.2）要同批处理**，
   否则修完主案，同一根因换个入口照样出。

## 六、防回归（How to prevent regression）

**本轮零改动，以下是给 builder 的施工清单，不是我做过的事。**

现有守卫（`test/custom_fact_key.test.mjs`）只守了假阴性那一侧
（"桶里有一条不等于所有题都答过"、`us` 不该答 `bonus`），**假阳性那一侧一条守卫都没有**。
`test/apply_gap_report.test.mjs` 里那条 grep 断言只守 note 名字改动，也守不到这里。

建议补（先红后绿，先写测试看它真红再改代码）：

1. **反向断言（必补）**：`customFactAnswered('What is your current city of birth?', {current_city:'X'})` 必须为 `false`——
   今天是 `true`，**这条测试现在就会红**。同一组把 §4.2 那两条真实题面（`name`→`preferred name`、
   `school`→`…time off from school`）也写死进去。
2. **自碰撞不变量**：对一批真实题面，`customFactKey(A)` 不得让 `customFactAnswered(B)` 为真（A≠B）。
   这条把「面会自我增殖」变成机器能拦的断言。
3. **空档案不变量**：一份各桶全空的档案跑一批真实题面，**不允许出现任何 `agent_profile_backed`**——
   这条会当场拦下 §3.2 那两条无条件规则。
4. **三入口一致性**：同一道题走标记表和走题面正则必须得到同一个答案（今天语言那一处不一致，§3.1 ③）。
5. **真实题面夹具**：把这 107 道题面（只有题面、无任何个人数据）落成一份仓库内夹具，
   让上面 4 条都跑在真实语料上，而不是手造的示例上。

## 七、边界与零写入证据

| 边界 | 怎么守的 |
|---|---|
| 不改产品代码 | `shared/` 全程未改；三棵树用 `git archive` 解到临时目录跑，**没用 `git worktree add`**（那是 git 写操作） |
| 不写拍板人 `~/.mrweirdo-jobs/` | **只读声明**：读了 `profile.json` / `feedback.jsonl` / `essay_pending.jsonl` / `reports/`；所有运行用 `MRWEIRDO_HOME` 等三个开关指向临时沙箱 |
| 零写入证据 | 跑前跑后各做一次全目录 stat 快照（541 个条目，含大小 / mtime / 权限），`diff` **完全一致** |
| 不删 `/tmp/mrweirdo-onboard` | 跑前跑后均为 **169 个文件**，未读未写未删 |
| 不投递 / 不开浏览器 / 不发邮件 | 全程只跑 `apply_gap_report.mjs` 这一个纯分析 CLI（只读结果文件、只写沙箱） |
| 不做 git 写操作 / 不 push | 只用了 `git log` / `git show` / `git archive` / `git status` |
| 不改 TASK 档案 | 未碰 |

## 八、教训（What to remember）

1. **建议沉淀进 `PROJECT_MEMORY.md` 长期原则**（由 lead 决定，我不自己改）：
   > **凡是"靠字符串包含关系认身份"的地方，都要问一句：反方向会不会多认？**
   > 包含关系不对称也不排他，天生同时产生"少认"和"多认"两种错。
   > 本项目实证：同一个谓词，正着看是"已答的还在问"，反着看是"没答的说已答"——
   > 而这两种错的代价差着一个数量级（多问一次 vs 编造个人事实）。
   > **认不准的时候必须倒向"问用户"。**

2. **对项目记忆第 5 条（双向扫）的补充**：这一轮又一次验证了它。
   施工侧只量了「该不问的问不问」，验收反方向一扫当场 6 个。
   我这一轮再往前推一步：**只量"存量"还不够，还要量"面"**——
   我第一次用真实题面量存量得到 0，差点得出"这 bug 今天不存在"的结论；
   真正的危险是它**随用户回答自我增殖**，得量"答完这批之后会怎样"。

3. **给验收的两处修正**（都不改结论，只改性质判断）：
   ① 「不产生死锁」不成立——代码层面就是死循环，全靠模型编个值才解得开（§2.3）；
   ② 「代跑射程为零」只对①号入口成立，同族的无条件规则在空档案上照样开火（§3.2）。

4. **ADR-3 的漂移要记一笔**：「note 主导、题面正则退为兜底」只落实了静态 note 那一半，
   动态 note 占绝大多数却进不了标记表，题面正则实际上仍在领跑。
   **这个漂移不修，同类 bug 会一直从题面正则这条路上冒出来。**

## 九、试过的错误方向

**❌ 方向 1：用「本轮改动让多少道真实题面翻转」来量这个 bug 的面。**
我把 107 道真实题面在改前树和 HEAD 上各跑一遍，得到 **0 处差异**；
又在满桶 / 空桶两份档案上各跑一遍，还是 **0 处差异**。
按这个数走，结论会是"这条 bug 今天一处都不发生"。
**失败原因**：这批题面是在那 11 条事实被写进档案**之前**采集的，本来就不可能与它们碰撞——
用它量"存量"没错，用它量"面"是错的。这个面不是静态的，是**用户每按报告答一题就长大一圈**。
改用「把报告自己发布的键写回去，再拿同一批真实题面重跑」才量出真数（2 处，§4.2）。

**❌ 方向 2：想把「这条键管哪道题」的元信息挂到 `answer_provenance.json`。**
那个旁挂文件已经有 `category` / `asked_by` 两格，看起来是白捡的落点，改动面还小。
**失败原因**：DESIGN ADR-4 明文规定留痕**不参与填表判断**，理由是"留痕文件损坏 / 丢失不影响投递，
是纯增益组件"。把判定依赖挂上去，等于让一个可以丢失的文件决定要不要向用户提问——
当场废掉 ADR-4 的全部价值。**读了 ADR 才发现，光读代码发现不了。**

**❌ 方向 3：想直接判定「收紧成整题面比对」是零代价的保守选择。**
直觉上收紧只会让系统更爱问，而多问是有界的、可自愈的。
**失败原因**：拿出货的 `customFactKey` / `customFactAnswered` 在拍板人真实档案上实测，
认得出的从 7/10 掉到 4/10——**多出来的 3 条全是他早就答过的事实**，
体验上表现为"系统把我说过的话忘了"。代价确实有界（每条一次），但**不是零**，
而且如果不在报告里主动解释，会被读成新 bug。这条必须写进施工清单（§5.3 第 1 点）。

**❌ 方向 4：一开始想把「机制没变、射程变宽」当成派遣单给的前提直接采信。**
派遣单要求我自己实证，我照做了，结果发现它**只对了一半**：
白名单那条路确实早就在用词段匹配（我造的 6 道题在三棵树上全部误判，实证成立），
但**标记表那条路根本走不到这个谓词**（`NOTE_CATEGORY` 的 17 个值里没有 `unknown_user_fact`）。
**失败原因**：如果直接采信，我会把标记表那条路也算进"已有假阳性面"，
多算一个入口，也就会漏掉「标记表和题面正则对语言那件事用了两套谓词」这个**真正的**第二入口（§3.1 ③）。
**说法听着合理，也必须自己跑一遍。**

**❌ 方向 5（追问阶段）：第一版「模块加载记录器」记到 0 条，我差点直接把这个 0 当成证据交上去。**
我用 `node --import 一个导出 resolve 的文件` 装钩子，跑完 Step 0-4，日志里 0 条加载记录，
看上去正是我想要的结论「分类器一次都没被加载」。
**失败原因**：`--import` 只是执行那个文件，**不会**把它注册成模块钩子——必须在里面调 `module.register()`。
**记到 0 不是"没加载"，是仪器根本没通电。** 加了一条阳性对照（拿分类器自己跑一遍，
必须记到 >0）才发现，修好后同一条链路记到 174 个模块、分类器 0 次。
**教训：任何"没有发生"的结论，都必须先证明你的探测器在"发生"时会响。**

---

## 十、追问补答：只跑到打分为止的代跑，安不安全

> lead 追问：我修正的「无条件判系统填」那一类，在「只跑到 Step 4、不进队列关卡、不真投」这条路径上会不会有后果。

### 10.1 结论

**代跑安全。** 我修正的那一类误判，在只跑到打分为止的路径上**根本不会被执行到**——
产生它的那段代码（`classifyField`）从头到尾**没有被加载进内存**。

### 10.2 实证一：整条链路真跑，分类器一次都没被加载

用假学生档案（各事实桶全空，**先验证过它确实会触发我修正的那条误判**：
`What do you value in a work environment…` → `agent_profile_backed`）+ 假家目录，
把 Step 0-4 **按操作卡原样真跑一遍**（真联网抓岗位、真入库、真出报告），
全程挂一个模块加载记录器：

| | 数字 |
|---|---:|
| **阳性对照**（拿分类器自己跑一遍，验明仪器有效） | 记到 22 个模块，**分类器告警 2 条** ✅ |
| Step 0-4 全链条实际加载的模块 | **174 个** |
| 其中 `apply_gap_report.mjs` / `missing_field_questions.mjs` | **0 次** |

跑的命令（操作卡 Step 0 + Step 4 原样）：
`doctor` → `validate_user_profile` → `init_db_cli` → `discover_candidates --plan` →
`discover_candidates --run` → `store_scored_jobs` → `queue_diagnostics` → `job_report --batch`。
真实漏斗：discovered 58 → filtered 37 → to_score 1 → stored 1 / eligible 1。

**静态交叉验证**（传递依赖闭包，按磁盘上真实文件算）：
Step 0-4 的 6 个入口脚本，依赖 3-21 个文件，**没有一个能到达分类器**；
对照组 `apply_batch.mjs`（Step 5 才跑）**会**加载 `missing_field_questions.mjs`。
**分界线正好落在队列关卡上。**

### 10.3 实证二：lead 问的三件事，逐条扫产物

跑完后把假家目录里**全部 13 个产物**（含 sqlite 数据库二进制）逐个扫：

| lead 的问题 | 实测 |
|---|---|
| ① 有没有值被写进任何表单 | **没有**：`apply-result-*` 0 个、`feedback.jsonl` 0 个、DB 里 `submitted_at`/`auto_submitted_at` 非空的行 **0** 行。整轮没开过浏览器 |
| ② 有没有编造的内容进到要发回给学生的岗位清单 | **没有**：`agent_profile_backed` / `unknown_user_fact` / `Do not ask the user first` / `apply-gap-report` / `user_questions` / `condensed_missing` **六个关键词全仓 0 命中**。清单（`reports/jobs/1-*.md`）里 `## 4. 缺口` 段写的是"暂无关键缺口"，机读块 `gap_fields: []` 是**空的**——那一段的数据源是打分结果，不是分类器 |
| ③ 学生档案有没有被写进他没说过的东西 | **没有**：`profile.json` 跑前跑后 **sha256 逐字节相同**；`custom_facts` / `language_proficiency` / `work_authorization` / `demographics` / `legal_attestations` 跑完仍全是空 `{}` |

### 10.4 为什么会这样（一句话机理）

那条误判活在**缺口报告**里，而缺口报告的输入是**投递结果文件**（`apply-result-*.jsonl`）——
只有真投过、驱动填不出格子，才会有这种文件。
**只跑到打分为止，一份结果文件都不存在，报告没有输入，分类器也就没有被启动的理由。**
它不是"跑了但结果没被采用"，是**这段代码这一轮压根没运行**。

### 10.5 一条给拍板人的口头提醒（不是阻塞项）

只跑到 Step 4 **安全**；但**Step 5（队列关卡）一开始，`apply_batch.mjs` 就会把分类器链拉进来**。
所以那条线要守住：**只跑到打分排序，不点队列关卡**。

**验收上一轮「可以代跑」的结论不受我这条修正影响，依据换了但结论没换**：
原依据是"通用桶在空档案上射程为零"（这条我实测仍成立），
真正更硬的依据是上面这条——**只跑到打分为止，这段代码不运行**。

### 10.6 本次追问的边界证据

| 边界 | 实测 |
|---|---|
| 创始人 `~/.mrweirdo-jobs/` 零写入 | 追问实验做完后**第三次** stat 全目录快照，与最初快照 `diff` **完全一致** |
| `/tmp/mrweirdo-onboard` | 仍 **169** 个文件，未读未写未删 |
| 产品代码零改动 | `git status --porcelain shared/` **0 行** |
| 不真投 / 不开浏览器 | 全程只跑只读的岗位板 HTTP 查询（discovery 本来就是只读抓取），未加载任何驱动、未启动 CDP |
| 不做 git 写操作 | 只用了 `git status` |
