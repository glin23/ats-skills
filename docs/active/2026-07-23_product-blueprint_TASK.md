---
Topic: product-blueprint
Created: 2026-07-23
Status: in_progress
Owner: arnold-lead
Updated: 2026-07-23
Type: audit
Parent_task: docs/active/2026-07-23_competitor-research_TASK.md
Depends_on: none
Blocks: none
Spawned_subtasks: none
---

# TASK — 产品蓝图现状盘点与改进报告（Mr. Weirdo Jobs）

## 阶段 1 — lead-用户对话

- Round 1: 用户否掉「独立看板」方案 —— **看板不做成单独的地方，而是 skill 跑完之后自然给出的一份总结**；运行环境是「在 Codex 里装好这些 skills 就能用」。
- Round 2: 用户提出真正的诉求：「我的需求其实从一开始就不知道有没有表明得很清楚」「每次都要重新讲一遍太麻烦」→ 要一份**现状 + 改进建议报告**作为后续讨论的共同基准。
- Round 3: 用户明确 folder 架构乱、且**「目前可能也没有人真正上手试过，上手的体感和效果估计也不是很好」**——上手体感是本次的核心关切之一。

### 用户原话：期望的功能流程（5 步，一字不改照录）

> 1. 用户安装了这个 Skills 之后，可以上传自己的简历。
> 2. 我们读取他的简历，并根据简历内容向他提问（比如针对每个 application 需要的不同基础信息）。
> 3. 结合简历给他生成一些定制化的问题，让他回答。
> 4. 在他回答完之后，我们总结这些回答，生成一个用户画像。
> 5. 询问他想找什么样的工作，然后根据画像帮他寻找合适的工作并进行投递。

用户补充：「有一些细节我之前在里面写过，不知道你有没有看」——**仓库里有用户自己写过的需求细节，必须翻出来，不能漏**。

- Round 4: lead 派 arnold-architect（架构/目录/代码现状）与 arnold-pm（产品流程差距）**并行**盘点，各读同一批上游、互不读对方产物，汇合后由 lead 合并成一份报告。

## 阶段 2 — architect ‖ pm 并行盘点（status: in_progress）

- pm 侧完成（产物 `docs/active/2026-07-23_product-blueprint_PRODUCT_SPEC.md`）。核心判断 5 条：
  1. 5 步逐条核到文件行号：第 4 步（画像）最完整；第 5 步（投递）坏了；第 2-3 步（提问）内核对但位置在真投之后；第 1 步（上手）门槛最高（要打绝对路径 + 手起调试模式 Chrome）；用户最在意的"投了几家/几家回了"根本不在这 5 步里。
  2. **核实结论**：「问题集从真实表单反推 + 压缩」**确实实现了**（`shared/missing_field_questions.mjs:137-181` 带覆盖校验、按去重岗位数排序），但只覆盖投递**后**半程；"结合简历定制化"**零实现**——问题措辞是 12 类写死模板，跟简历无关。
  3. **最大发现是接线缺失不是功能缺失**：把卡点沉淀成下一轮前置问题这件事，用户在 `docs/archive/HANDOFF-v2.2.0.md:336-339` 与 `shared/essay_profile.template.json:80-83` 写了两遍，零件都在（`shared/apply_gap_report.mjs:407-417` 已在算清单），差最后一根线。
  4. **反驳**：用户口述的"投递前把定制化问题问完"与他自己 2026-06 的拍板（`docs/archive/PRD-onboarding-ux.md:121-127` 不做投递前探测）直接冲突，pm 站他当时那一边，改用"上一轮卡点喂下一轮前置提问"兑现同样体感。
  5. **需 lead 转派核实的对外风险**：工作授权/学位/退伍军人身份三处在档案缺值时使用共用默认答案（`shared/answer_routing.mjs:178-180`、`shared/greenhouse_apply_driver.mjs:1569-1570`、`shared/ashby_apply_driver.mjs:512`），与"绝不编造个人事实"红线冲突。pm 无命令行、只能读代码，实际触发条件未核实。
- pm 侧未做：一手用户访谈仍为 0（连续第三轮缺口）；定稿 living doc 未建（属 lead 职责，且本轮结论尚未过关卡）。
- architect 侧完成（产物 `docs/active/2026-07-23_product-blueprint_ARCH_AUDIT.md`）。三条关键发现：
  1. **主入口首跑必挂**：`mrweirdo-onboard/SKILL.md` 9 处用 `cd "$MRWEIRDO_REPO_ROOT"` 却从不设置该变量；`cd ""` 退出码 0 且不换目录 → 第一条命令静默"成功"、第二条抛裸错（实测 `bash: scripts/preflight.sh: No such file or directory`，退出码 127）。**lead 独立复验属实**：8 个次要技能（ashby/lever/workday/icims/jobvite/handshake/smartrecruiters/confirm）都写了兜底，唯独主入口漏了。这解释了"没人真正上手试过、体感不好"
  2. **修正 next-priorities 的核心诊断**：可投数量差异真因不是"字段只在跑批时刷新、重跑即可"——architect 实跑刷新程序（只算不写）结果放行 0 行、收回 1 行，**重跑解决不了**。真因是 `recompute_auto_apply_eligibility.mjs:81-83` 守卫：打分记录缺 `recommended` 字段一律不放行，DB 实查 244 行是 6 月中旬打分提示词升级前的旧数据。**出路只有"重新打分"或"改守卫策略"二选一，是取舍不是 bug**
  3. **两处对外安全承诺在默认安装下不成立**：免责声明写的"约 25 家大公司默认跳过保护名额"——`paths.mjs:75-82` 找不到用户自建名单就返回空数组、安装脚本不生成该文件，护栏对任何公司都不生效；免责声明描述的"解析确认门"已在 2026-06-13 改版拆除（`SKILL.md:231` 明写不等确认）
- architect 待拍板人补答 6 问，其中「folder 很乱指代码仓库还是 `~/.mrweirdo-jobs/` 状态目录」会改变改进方向（后者堆着历史残留，上轮规整没清到）
- Round 5: lead 派 arnold-bug 核实 pm 提的对外风险（工作授权/学位/退伍军人身份默认答案 vs「绝不编造个人事实」红线），产出 RISK_REPORT，进行中
- Round 6: lead 合并两侧盘点为定稿 docs/specs/product-blueprint.md
- Round 7: arnold-bug 完成风险核实（只查未修，代码零改动，DB 只读）。产出 `docs/active/2026-07-23_product-blueprint_RISK_REPORT.md`
- Round 7 结论: **pm 三条全部属实，触发条件比估计更宽**。实跑证据：`deriveWorkAuthAnswers()`（`answer_routing.mjs:173-181`）配出货的 answer_bank.json，喂 5 种档案（含"明确填了未获授权"与"字段全缺"）**5 次全部输出 Yes**，当前配置下没有能力输出 No。根因非漏判空，是**三态字段（是/否/没问过）被用真假判断读**，false 与 null 一起掉进默认分支、默认值恰好是 Yes。三处原值：工作授权 `Yes`、硕士学位 `No`（`greenhouse_apply_driver.mjs:1569` 写死不读档案）、退伍军人 `I am not a protected veteran`
- Round 7 新发现（pm 未提，方向相反）: 用户**不需要**担保时 Ashby 会答"我需要担保"（同函数 `:175-177`）——把美国公民标记成需担保，很多雇主直接刷。Greenhouse 对同一件事写的是 `=== false ? 'No' : ...` 是对的，**两平台写法不一致**，证明属疏漏
- Round 7 历史取证: **没找到答错的证据，但洗不清**。15 条 submitted 中仅 1 条留字段级痕迹（2026-05-28 lambda，与档案真实值一致），其余 14 条无留痕；退伍军人/硕士学位在日志与 DB 零命中。`feedback` 表只存"跳过时缺什么"不存"填了什么"，180+ 条投递答了什么已不可考——**这条本身就是需要修的**
- Round 7 结构性发现: ① 红线（`PRD-v3.md:230`）指定 `apply_gap_report.mjs` 的 `user_*` 分类当执行机制，而该分类器 `:137` 把 veteran/gender/race/disability/authorized-to-work 全判成"系统自动填"——**守门人站错了队** ② 真实档案的 `demographics.veteran_status` 与 `profile.template.json` 出厂默认逐字节一致、引导流程无任何人口统计学提问——**那不是用户答的，是模板预填的**，代码分辨不出"用户说的"与"出厂默认"
- Round 7 严重度: **P1 上线前必修，当前不着火**（41 天零投递；现有唯一用户 5 个默认值里 4 个碰巧与真实一致——巧合非机制保证）。根因之一：`test/answer_routing.test.mjs:75-89` 只覆盖 true 的两种情形，false 与缺失零覆盖

**关卡 1 决策**：🩺 🔒 [用户] 拍板 — ① 编造事实 bug **确认要修**；② 「folder 很乱」指**两处都要查**：本机状态目录 `~/.mrweirdo-jobs/` + GitHub 仓库；③ 用户表述真实目标：**「我希望做的这东西最后能有人用，现在我感觉不会有人用」**——本目标写入项目记忆，后续排序以「能不能让人用起来」为第一判据
- Round 8: lead 判定「有人用」的第一阻塞是主入口首跑必挂（任何人装了都走不到第二步），与编造事实 bug 合并成一个施工包派 builder；同时派 architect 盘本机状态目录（上轮规整未覆盖），两线并行、文件不重叠
- Round 9: arnold-architect 完成状态目录盘点（只读零删除）。产出 `docs/active/2026-07-23_product-blueprint_STATE_AUDIT.md`
- Round 9 规模: `~/.mrweirdo-jobs/` 共 620M，其中 **602M 是 Chrome 自建缓存**，真正属于用户的不到 18M。顶层 30 项 = 活 15 / 历史残留 9 / 一次性 3 / 空占位 3
- Round 9 隐私裂口（**现行缺陷，非仅历史遗留**）: 上锁机制只覆盖 3 个 JSON。`cover_letter.pdf` 全仓库零 chmod（新用户同样 644）、50 张投递截图 644（architect 打开一张核实：**邮箱电话明文可见**，而免责声明正把「数据不出本机」当卖点）、38 份求职信全含真名。`resume.pdf` 644 属本机历史遗留（chmod 是 6-12 才加），新装不受影响
- Round 9: 配额护栏是**两个零件都缺**——除已知 `company_list.user.json` 空，`quota.jsonl` 同样从无生成方，补一个没用必须一起补
- Round 9: `archive-repo-20260704/` 5.7M **可安全删**（实证：14 个提交 merge-base 全在主线、补丁特征标识符现行代码全找得到），唯一要留手的是内含的 5-25 旧档案（唯一历史副本）
- Round 9 仓库侧: 7-22 成果零回潮，但**13 份新文档 + 2 处修改全部未提交**——GitHub 停在 7-22，本轮所有结论线上看不到
- Round 10: lead 就 2 个卡住安装脚本修法的问题向拍板人取决定（截图/报告保留期限、cover_letter.pdf 定位）
- Round 11: arnold-builder 完成两个阻塞缺陷的修复（产物 `docs/active/2026-07-23_product-blueprint_BUILD.md`）。**CI 四步本地串行全跑、退出码 0/0/0/0**；`npm test` 138 pass / 0 fail（新增 10 条用例）；主流程冒烟 `npm run demo:check` exit=0
- Round 11 缺陷一: 主入口 9 处 `cd "$MRWEIRDO_REPO_ROOT"` 已按 8 个次要技能的现成范本加环境兜底。**干净环境实测**：改前（cwd 不在仓库）`exit=127`「No such file or directory」；改后 Step 0/4/5 的只读命令全部 exit=0（apply_supervisor 的 exit=2 是「尚未引导」的正确报错，非路径崩溃）。**范围扩展**：另 5 个技能（ashby-auto / greenhouse-auto / tracker / expand / upskill）同一 bug 共 11 处一并修——auto 引擎在真投批次里被派发、tracker 在主流程末端，留着等于主链路仍埋雷。不认可可单独回滚
- Round 11 缺陷二: 五项全做完。三态显式分支 + 缺值走阻塞（新增纯函数 `workAuthGapFor()` 把阻塞真正接到 Ashby 驱动上，不接线等于返回 null 让驱动填空）；担保题 `=== false → No` 与 Greenhouse 统一；硕士学位改调 `isGraduateDegreeProfile()`；退伍军人默认改拒答（answer_bank + 两个驱动内置兜底 bank + Ashby 取值行 + Lever 兜底 4 处）；`profile.template.json` demographics 五项置 null
- Round 11 差点翻车（已避免，记为教训）: 按派遣单字面把硕士学位改成调 `isGraduateDegreeProfile()` 后，实算发现该函数正则**无词边界**——`Bachelor of Science in Information Systems`（"Syste-ms"）、`BS in Marketing`（"Ma-rketing"）都会被判成研究生学位。**照字面改完等于亲手引入一个新的编造**：市场营销本科生会被答成"我有硕士学位"。已把判定抽成纯函数 `isGraduateDegree()` 落进受单测覆盖的 `greenhouse_value_rules.mjs` 并加词边界（22 个正反样本），驱动委托给它
- Round 11 先红后绿有据: 两轮红的原始报错都记在 BUILD 第 2 节（`does not provide an export named 'workAuthGapFor'` / veteran 默认值断言失败 / 模板预填断言失败 / 硕士学位源码守卫抓到 `value = 'No'`）。改动模块行覆盖 94.8%-100%
- Round 11 CI 真红过一次: `public_alpha_gate` 的「onboard 技能 ≤ 500 行」被撑到 504 行当场红（三行 export），压成两行后 495 行转绿。**只跑 npm test 的话这次会带着红门禁出门**——岗位家规那条铁律本轮兑现了价值
- Round 11 明确未做（须拍板）: ① **F5 未修 = 被阻塞的行仍进不了「该问用户」清单**，用户体感是「卡住但不知道卡在哪」（`apply_gap_report.mjs:137` 把工作授权/人口统计学全判成系统自动填）② F6 审计留痕未做 ③ **Greenhouse `:1570` 工作授权仍写死 `Yes` 不读档案**——派遣单只点名 `:1569`，故 Ashby 侧堵住了、Greenhouse 侧同一道题还在编造，建议紧接着做 ④ Greenhouse 退伍军人候选表 `'No'` 仍排第一 ⑤ `standard_answers` 字段名错配（F7）未动
- Round 11: arnold-builder 完成两缺陷修复（本轮零 commit，未 push）。产出 `docs/active/2026-07-23_product-blueprint_BUILD.md` + 新增 `test/personal_facts_guard.test.mjs`
- Round 11 缺陷一: 主入口 9 处已按范本加环境兜底。干净环境实测改前 exit=127、改后 Step 0/4/5 只读命令全 exit=0。**范围扩展**：另 5 个技能（ashby-auto / greenhouse-auto / tracker / expand / upskill）共 11 处同一 bug 一并修——auto 引擎在真投批次里被派发、tracker 在主流程末端，留着等于主链路埋雷
- Round 11 缺陷二: 五项全做完（三态显式分支 + 新增纯函数 `workAuthGapFor()` 把阻塞真正接到 Ashby 驱动、担保题 false→No 与 Greenhouse 统一、硕士学位改读档案、退伍军人默认改拒答 4 处、模板 demographics 置 null、测试先红后绿）。RISK_REPORT 那 5 种档案实跑已从"5 行全 Yes"变为"该 Yes 的 Yes、该 No 的 No、没问过的阻塞"
- Round 11 **差点翻车（已避免）**: 照派遣单字面改硕士学位后，实算发现 `isGraduateDegreeProfile()` 正则无词边界——`BS in Marketing`（Ma-rketing）、`Bachelor of Science in Information Systems`（Syste-ms）都会被判成研究生学位，**等于亲手引入一个新的编造**。已抽成受单测覆盖的 `isGraduateDegree()` 并加词边界（22 个正反样本）
- Round 11 证据: npm test 138 pass/0 fail=0、role_guard_smoke=0、public_alpha_gate=0（曾真红过一次：onboard 技能 504>500 行门槛，压行后转绿）、node --check 81 文件=0、demo:check=0
- Round 11 **未修完的要害**: `greenhouse_apply_driver.mjs:1570` 工作授权**仍写死 Yes 不读档案**——Ashby 已堵住，Greenhouse 同一道题还在编造。而 292 个够格存量里 **256 个（88%）在 Greenhouse**
- Round 11 F5 复述: 未修意味着被阻塞的行会正确跳过、不再编造，但用户不会被问「你到底有没有工作授权」，体感是"卡住但不知道卡在哪"
- Round 12: lead 派 builder 补修 Greenhouse 工作授权（同类修复，属已拍板「bug 肯定要修」范围内的收尾，非新增范围）
- Round 12: arnold-builder 完成（零 commit、未 push）。产物：`BUILD.md` 追加第 12-18 节 + 新增 `test/greenhouse_work_auth_driver.test.mjs`。改 `greenhouse_apply_driver.mjs` 5 处（守卫 `:1511`、授权题 `:1567`、担保题 `:1627`、取值源 `:1552`、未来移民支持 `:712-713`）+ `answer_routing.mjs` 题面正则 1 处；文件 1917→**1914 行**（超限文件净减，符合铁律）
- Round 12 修法: 严格复用上一轮的 `workAuthGapFor()` / `deriveWorkAuthAnswers()`，未另写判定。与 Ashby 的两处有意差异已标注：① 阻塞信号用 `needs_user_answer` 而非 `pending_for_main_claude`（Greenhouse `main():1875` 只为能找到文本框的题登记 pending，下拉框题会静默丢失）② 守卫落点在 `standardYesNoAnswerForLabel()` 之前而非函数最前（文件膨胀铁律逼出来的，源码断言已锁住"先于所有工作授权取值分支"）
- Round 12 实跑证据（6 档案 × 4 真实题面，同一套真驱动代码跑 before/after）: **改前 6 行全是 `Yes`**；改后 → 明确未获授权答 `No`、美国公民担保题答 `No`、三种"没问过"（`{}` / 无该块 / 显式 null）**4 题全阻塞、一个字都不填**；当前真实用户（F-1 OPT）逐格零变化
- Round 12 测试突破: 上一轮判定"驱动是 CLI 入口、无法单测"。本轮做到了——取原始源码、只删末尾 `main()` 调用、把 6 个碰浏览器的函数换成替身，其余判定逐字是驱动自己的代码。**Greenhouse 驱动首次有了行为级测试**（此前零测试，只有源码字符串断言）。测试自带 harness 失效检测，函数改名会报错而非假绿
- Round 12 证据: npm test **146 pass / 0 fail**（新增 8 条，先红后绿原始报错见 BUILD 第 13 节）、role_guard_smoke=0、public_alpha_gate=0、node --check 81 文件=0、demo:check=0（两条 WARN 与本轮无关：没开 Chrome）
- Round 12 顺手加固: 实算发现 `workAuthGapFor()` 题面正则里裸词 `visa` 会命中 "ad**visa**ble"，已加词边界 `\bvisas?\b`。公司名叫 "Visa" 的情况**修不了也不该修**（那里 visa 确实是独立单词），后果只是多问用户一题，如实留作已知限制
- Round 12 **同模式扫描：11 处只报告未改，等拍板**（BUILD 第 16 节全表）。最要害的是 **I: `profile.template.json:41-43` 出厂预填 `authorized_to_work_us: true` 等三个值**——与上一轮 demographics 同一个病，出厂值与"用户亲口说的"字节相同，**只要它还在，跑过引导流程的用户就绕过本轮新增的阻塞**，等于把本轮成果打折。其次 B（居住地 `|| 'No'` 兜底，档案无城市也答"我不住那儿"）、G（`answer_templates.mjs:12-14` 把三态压两态写进作文正文）、D（逃犯 / 非法居留 / 管制药品三题写死 `No`，而同文件重罪题却是没问过就阻塞——两套标准）
- Round 12 未做: F5 / F6 按派遣单未碰。**F5 的后果本轮被放大**——阻塞面从 12% 扩到 100%，而被阻塞的行仍进不了"该问用户"清单，"卡住但不知道卡在哪"的面同步扩大，建议 F5 排在 F6 之前
- Round 13: arnold-builder 完成 Greenhouse 工作授权修复（净 -3 行，1917→1914）。复用上轮 `workAuthGapFor()` 守卫；`:1567` 工作授权与 `:1627` 担保改读 `deriveWorkAuthAnswers()`；`:1552` 去掉 bank 默认来源；`:712-713`「未来移民支持」也改阻塞。新增 `test/greenhouse_work_auth_driver.test.mjs`（跑出货驱动本身，8 例先红后绿），npm test 146/146，CI 四步 0/0/0/0
- Round 13 实跑验证: 6 种档案 × 4 种真实问法，同一驱动代码改前后对比——改前 6 行全 Yes；改后明确未获授权答 No、公民答"不需要担保"、三种没问过的形态全部不填并浮出为缺口。现有真实用户（F-1 OPT）逐字节不变
- Round 13 陷阱复核: 未信函数名，实测 `workAuthGapFor` 的 `visa` 词元无词边界、会在 "ad-visa-ble" 上误触发，已修为 `\bvisas?\b`。名字就叫 Visa 的公司仍会命中，但只会多问不会多答，记为已知限制
- Round 13 **要害发现（使本轮修复几乎失效）**: `shared/profile.template.json:41-43` 出厂预填 `authorized_to_work_us: true`——与上轮修掉的 demographics 预填同一个病。**只要它还在，任何走完引导流程的新用户都会直接绕过刚加的阻塞**
- Round 13 同模式扫描: 共 11 处同病未改（BUILD §16 列出），次要几处：`:1614`/`:1694` 居住地 `|| 'No'`、`answer_templates.mjs:12-14` 把两态断言写进求职信正文、逃犯/非法居留/管制药物三问写死 `No`（而紧邻的重罪问题在未问时会阻塞）
- Round 13 F5 影响升级: 阻塞面从 12% 扩到 **100%**，而被阻塞的行仍进不了「该问用户」清单——**F5 不修，产品会从"说谎"变成"全面静默跳过且不告诉用户为什么"**
- Round 14: lead 判定 template 预填修复与 F5 **必须同时落地**（单修 template = 全面阻塞无提示；单修 F5 = 预填仍绕过），派 architect 设计二者合一的方案
- Round 15: arnold-architect 完成设计（产物 `docs/active/2026-07-23_product-blueprint_DESIGN.md`，零代码改动）。方案 = **三层一条通路**：① 出厂一律 null（非 null ⇒ 一定有人说过，最便宜的来源可区分性）② 只对「缺了会阻塞 ≥80% 行」的事实设前置门——量下来全项目**只有工作授权两格够格**，且它本来就是引导 A0 该问的，所以不违反 2026-06「不做投递前探测」拍板 ③ 其余全部走既有的「真实表单反推 + 压缩提问」，本轮只是把它们**接进**这条路
- Round 15 关键发现（上游未提，是 F5 断链的真正第一环）: `apply_gap_report.mjs:91` 写的是 `push(b.question || b, 'blocker')` —— 阻塞项是 `{question, note}` 对象，取了 `.question` 字符串之后**驱动标注的 note 被整个丢掉**。所以就算改分类正则也接不上，必须先把 note 保住（改成 `push(b, 'blocker')`，`fieldLabel` 本来就会读 `question`）
- Round 15 第二发现: 今天被误判成 `agent_profile_backed` 的行会落进 `agent_actions`，动作文案是「Do not ask the user first. Fill from existing profile」（`:368`）——**系统被告知"你自己从档案里填"而档案恰恰没有** → 重试 → 再卡。这就是「卡住但不知道卡在哪」的具体机器，不是比喻
- Round 15 陷阱预警: `classifyField:110` 的 note 变量带 `outcome.reason` 兜底，而 `classifyUnsubmitted()` 的行级 reason 里有 3 个字符串**与字段级 note 同名**。新增的 note 查表必须只读 `field.note`，否则同一行里无关字段会被张冠李戴——**看起来修好了，行为是错的**
- Round 15 §16 十一处逐条给了处置: 改 9 处 / **待拍板 2 处**。① D 项（逃犯 / 非法居留 / 管制药物）实为**同一份联邦禁枪清单的 10 道题**，档案里对应的就是一个 `no_prohibited_possessor_status`，紧邻重罪题（`:728-731`）已是正确写法——合并成一条三态分支后**净减约 6 行**，正好给同批其它改动腾驱动行数额度；② C 项（年满 18）与 H 项（无限制授权答 No）需拍板人一句话，我给了建议与代价对比，**没有替他决定**
- Round 15 分批: A（分类通路 + 写回命令 + 那道门 + 清模板预填）**必须整批**，且给了 A1→A4 的提交顺序论证——**逐个提交点都不比今天差**（关键：门先上线、模板预填最后清）。B（另 6 处编造）**硬依赖 A**，A 没上就做 B 等于把这个死结原样再造一遍。C 收尾
- Round 15 待拍板人回答 2 问（C 项 / H 项），另有 1 条需 lead 授权：设计要求**修改 `test/apply_gap_report.test.mjs:135` 一条现有断言**（它锁住的正是 RISK_REPORT 判定为缺陷的行为：EEO 归"系统按档案自动填"而档案是空的），已在 ADR-6 写明论证，要求 builder 交活时单独说明、供 verify 复核
- Round 15: arnold-architect 完成设计（904 行，零代码改动）。产出 `docs/active/2026-07-23_product-blueprint_DESIGN.md`
- Round 15 方案一句话: 出厂一律空白 + 只对「缺了会阻塞 ≥80% 行」的事实设一道开工前的门（量下来全项目只有工作授权两格够格，且它本就是引导 A0 该问的，**不违反「不做投递前探测」拍板**）+ 其余全部接进既有的「真实表单反推 → 压缩提问 → 写回 → 重投」通路
- Round 15 挖出三条上游没发现的事实: ① **F5 断链第一环不在分类器在收集器**——`apply_gap_report.mjs:91` 是 `push(b.question || b, 'blocker')`，阻塞项本是 `{question, note}` 对象，取 `.question` 后驱动标注的 note 被整个丢掉，只改分类正则接不上 ② **「卡住但不知道卡在哪」有具体机器**：误判成 `agent_profile_backed` 的行落进 `agent_actions`，动作文案是 `Do not ask the user first. Fill from existing profile`（`:368`）——系统被告知"自己从档案填"而档案恰恰没有，于是重试、再卡、不出声地循环 ③ **陷阱**：`classifyField:110` 的 note 变量带 `outcome.reason` 兜底，而 `classifyUnsubmitted()` 行级 reason 有 3 个字符串与字段级 note 同名，新查表必须只读 `field.note`
- Round 15 §16 十一处处置: 改 9 处、待拍板 2 处。**D 项（逃犯/非法居留/管制药物）实为同一份联邦禁枪清单的 10 道题**，档案里对应的就是一个 `no_prohibited_possessor_status`，紧邻的重罪题已是正确写法——合并成一条三态分支后**净减约 6 行**，正好解掉驱动文件净增必须为 0 的死结
- Round 15 lead 授权: 同意按 ADR-6 修改 `test/apply_gap_report.test.mjs:135` 的现有断言——该断言锁住的正是 RISK_REPORT 判定为缺陷的行为（工程层可逆，lead 权限内）。**但要求 builder 在施工记录里显式说明改了哪条断言、为什么，并由 verify 独立复核这不是"改测试迁就代码"**
- Round 16: lead 把 2 个待拍板问题端给用户（年满 18 是否改阻塞 / 无限制授权未知时保守答还是阻塞），连同截图核对那条一并取决定

**关卡 2 决策**：🩺 🔒 [用户] 拍板 — ① 50 张投递截图**先核对再删**（核对「工作授权/学位/退伍军人」当时实填了什么，看完再决定删不删）；② 满 18 岁 → **引导时问一次**，不默认不阻塞；③ 无限制工作授权未知 → **阻塞，问清楚再投**（答错双向都伤：国际生说成"有"是不实陈述、公民说成"没有"会被直接刷）
- Round 17: lead 派 arnold-builder 做 DESIGN 批次 A（一个施工包，A1→A4 顺序不拆），并派 arnold-bug 做 50 张截图取证核对，两线文件不重叠
- Round 18: arnold-bug 完成 50 张截图逐张取证（无抽样，只读）。产出 `docs/active/2026-07-23_product-blueprint_FORENSIC.md`（bug 未改 TASK 档案以避免与并行施工写冲突，本条由 lead 统一回写）
- Round 18 取证结论: **没有找到任何一次答错，但也洗不清**。50 张里仅 **2 张**真拍到那三类题——① Cloudflare（05-26 Greenhouse）担保题填 `Yes`，对 F-1 OPT 是**实话、答对**（但该 `Yes` 与 answer_bank 共用默认值字面相同，"按默认填"还是"按档案填"从截图分辨不出，正是 PROJECT_MEMORY 教训第 3 条的实例）；② Binti（05-26 Ashby）红色报错「Missing entry for required field: Are you authorized to work in the United States?」——**系统当时留空被表单拦下，没编造**，`feedback.jsonl` 同日两条 skip 记录该字段 `currentValue:""` 双重佐证
- Round 18 其余 48 张无法判定的根因: **不是失真是构图**——截图为单屏非整页，而这三类题在表单中下部；拍摄时机只有"提交前（视口停顶部）"与"提交后（已跳确认页）"两种，两个时机都拍不到。硕士学位与退伍军人在 50 张 + 126 行日志中 **0 命中**。结论：这批截图回答不了"过去 183 次答了什么"，**不需要联系任何公司更正**
- Round 18 **意外发现（比截图删不删严重）**: **6 张文件名写 `..._ashby_success_...` 的截图，页面写的是「We couldn't submit your application」**（Directive 一家 7 个岗位的重复投递拦截，仅 1 张真成功）；另有 3 张 `post_submit` 画面无提交确认（angi ×2、opusclip ×1）。**投递留证的文件名在把失败标成成功，直接污染"投了几家"这个用户最在意的数字**。若按 `success` 筛选抽样则此 bug 永不可见——印证派遣单"不许抽样"那条
- Round 18 bug 的建议（R1-R4）: ① R1 文件名判定改为落盘前读页面文案、读不出写 `unknown` ② R2 截图/求职信/cover_letter.pdf 写入侧统一上锁 ③ R3 保留策略按投递结果分层（依赖 R1）④ R4 若要截图真能当证据须改为提交前滚到底截整页（现命中率 2/50 等于没有）。**R1 修好前删截图 = 把该 bug 唯一现场物证一起扔掉**
- Round 18 lead 判断: **R1 修复点落在 ashby/greenhouse 两个驱动文件内，与正在跑的批次 A 直接冲突** → R1 排队至批次 A 落地后再派，不并行。F6（字段级审计留痕）优先级按 bug 建议上调——历史证据链已走完且走不通，只有 F6 能让"以后"可查
- Round 12: arnold-builder 完成**批次 A**（4 个提交 A1→A4，顺序未乱未合并；`20c6f6d` / `f009f95` / `b11ee22` / `71c3bef`）。产物追加进 `docs/active/2026-07-23_product-blueprint_BUILD.md` 第 19-27 节。**CI 四步本地串行全跑 0/0/0/0**，`npm test` 177 pass / 0 fail（146→177，新增 31 条），主流程冒烟 `npm run demo:check` exit=0
- Round 12 两个必做场景实测: ① **现有用户零变化** —— `git worktree` 检出批次 A 之前的 `6e31883`，同一份 24 道真实题面夹具喂旧树 / 新树 + 拍板人真实档案（只读），逐题对照 **identical 24/24**；`demo:check` 里新增检查项 `work_authorization_answered: ok=true` 对真实档案直接放行 ② **新用户模拟** —— 出厂空白档案同一夹具 **changed 8/24**（3 条工作授权 + 5 条 EEO，正好是该变的），全流程沙箱家目录、零浏览器、零投递
- Round 12 闭环实证: 新增 `test/missing_info_loop.test.mjs` 跑真 CLI —— 阻塞 → 问题（`user_work_authorization`、进重试清单、不进 agent_actions）→ 记录命令写回 → **重跑报告问题清单变空**；第二条用例证明闭环是按「事实」闭的不是按「行」闭的
- Round 12 三个新模块行覆盖 **100% / 100% / 100%**（`personal_fact_gate` / `answer_provenance` / `record_profile_answers`，DESIGN 要求 ≥90%）
- Round 12 Iterations=3，**6 个被否决方向**，其中 4 个是实算 / 覆盖率数字揪出来的：① DESIGN 让新类目 priority 取 0，实算发现 `priority || 99` 把 0 吃掉、排序反而垫底（改 0.5）② DESIGN 让既有模板一律补 `value_type:'string'`，实核发现两个 legal 字段是 boolean、5 个 standard_qa 是 object，照字面写会让写回口对一半类目 exit 4 回滚 ③ **闭环测试逼出设计内部不一致** —— §3.2 把 note→类目写成无条件查表，但 §4.3 描述的正确行为要求「档案已有值就不再问」；不补这一道谓词，用户答完之后同一个问题会被永远问下去 ④ 覆盖率戳穿一条「名字正确、断言正确、却什么都没证明」的回滚测试（注入的假校验器第一次就失败，命令在前置检查就返回，真正的回滚分支从没被跑到）
- Round 12 偏离 DESIGN 8 处**全部显式标注**（BUILD 第 24 节），其中 3 处建议回改设计文档；ADR-6 授权的那条测试断言修改单独写在第 25 节供 verify 复核
- Round 12 **需 lead 确认的一处**: 派遣单要求「只改 `:135` 一条断言」，但**同一条断言在同一用例里出现两次**（`:135` 是 `--summary` 调用、`:154` 是紧接着的 `--result-dir` 调用，同一份 fixture / 同一个结果文件 / 同一份档案），只改一处测试必红。已当作「同一条断言的两次实例」一并改、两处都加了注释 —— 请 lead 认可这个理解
- Round 12 只报告未改的旧 bug 3 条（BUILD 第 26 节）: ① `ashby_apply_driver.mjs:1142` 把阻塞项的 `note` 整个丢掉 —— DESIGN 说「驱动侧已接线」对 Greenhouse 成立、**对 Ashby 不成立**，本轮靠题面正则兜住了工作授权，但 Ashby 侧的法律声明 / 居住地 note 到不了分类表，**批次 B 会撞上**（一行内可修且净增 0，但驱动不在批次 A 文件清单里）② `profile.template.json` 仍出厂预填 `gpa: "3.9"` 与 `earliest_start_date: "MM/DD/YYYY"` —— 与本轮 I 项同病，DESIGN §16 的 11 处清单漏了它，新加的留痕现在会把它标成 `legacy_unverified` 自己照出来 ③ 报告 JSON 展开整个模板对象带出新字段噪音
- Round 12 提交归属瑕疵（**需 lead 决定是否整理历史**）: 开工时工作区压着第 1、2 轮全部未提交改动（Round 11 记的「本轮零 commit」），按文件 `git add` 时 A1 扫进了那两轮的 CHANGELOG 条目、A2 扫进了 SKILL.md 的 11 处 `export MRWEIRDO_*` 兜底、A4 扫进了 `profile.template.json` 的 demographics 置 null 与整个 `test/personal_facts_guard.test.mjs`。**内容同属本任务、没丢失、没 push**，但署名混进了我的 4 个提交；另有约 30 个文件仍未提交，未碰
- Round 12 边界: 未 push、未动远端、未真跑投递、未提交表单、未发邮件、**对 `~/.mrweirdo-jobs/` 零写入**（仅两处只读并已声明：`demo:check` 与零变化对照实测，后者把 `MRWEIRDO_DB_PATH` 指向不存在路径确保 SQLite 不被打开），未碰投递截图目录
- Round 19: arnold-builder 完成批次 A（4 个提交按序：`20c6f6d` A1 信号通路 → `f009f95` A2 写回 → `b11ee22` A3 门 → `71c3bef` A4 模板；18 文件 +2069/-89，未 push）
- Round 19 证据: npm test **177/177**（原 146）=0、role_guard_smoke=0、public_alpha_gate=0（SKILL.md 496/500）、node --check 84 文件=0、demo:check=0；新模块 personal_fact_gate / answer_provenance / record_profile_answers 行覆盖率均 **100%**
- Round 19 两个必测场景实跑: ① **现有用户零变化**——checkout `6e31883` 到 worktree，同一份 24 问 fixture 在新旧两棵树上跑真实档案（只读，DB 路径指向不存在文件确保 SQLite 不开），结果 **24/24 完全一致** ② **新用户**——同 fixture 跑空白模板，**8/24 变化，恰好是 3 个工作授权 + 5 个 EEO 问题**；沙盒完整走查：门在约 5s 阻塞且不开浏览器、白名单违规 exit 2 且档案 shasum 逐字节不变、把 "Yes" 塞进三态布尔 exit 3、答完 → 门开 → 校验 exit 0
- **lead 裁决三条**（builder 提请）:
  1. **断言改动实为 2 行**——`test/apply_gap_report.test.mjs:135` 与 `:154` 是同一断言应用于同一 fixture 的两次调用（`--summary` 与 `--result-dir`），只改一处套件必红。**lead 确认此读法成立**：授权的是"那一条断言"，其两个调用点属同一条，不算越界
  2. **DESIGN 内部矛盾由 builder 就地解决**（§3.2 说 NOTE_CATEGORY 无条件查表、§4.3 描述相反行为；结果文件在用户答完后会重读，无条件查表 = 同一问题永远问下去，闭环测试抓到）。8 处偏离全列在 BUILD §24，其中 3 处（本条、`priority: 0` 假值陷阱、`value_type: 'string'` 对布尔/对象路径不成立）**照设计字面实现会出静默缺陷**。**lead 裁决：DESIGN 需按 BUILD §24 修正后才可启动批次 B**
  3. **提交归属混入前两轮未提交内容**（Round 1-2 的 CHANGELOG、SKILL.md 环境变量修复、demographics 置空与 personal_facts_guard 测试被按文件名扫进 A1/A2/A4；另有约 30 个文件仍未提交）。**lead 裁决：不重组 git 历史**——未 push、无丢失、同属一个任务，重组只有风险没有收益；剩余文件另起一个文档提交收尾
- Round 19 **两条会影响批次 B 的发现**: ① `shared/ashby_apply_driver.mjs:1142` 构建 pending 列表时丢掉 `a.note`——DESIGN 所称"驱动侧已接线"**只对 Greenhouse 成立**；工作授权靠标签兜底仍能正确分类，但 Ashby 的法律声明与居住地 note 永远到不了表里，**而批次 B 恰恰依赖它**（同行修复、净增 0，但驱动不在批次 A 文件清单内故未动）② **模板仍出厂预填 `gpa: "3.9"`**——同一个病，且**不在 §16 的十一处清单里**
- Round 20: lead 派 arnold-verify 独立验收批次 A（重点复核断言改动是否属"改测试迁就代码"）
- Round 21: arnold-verify 完成独立验收（重派后成功；首次派工崩于 API 连接中断，未产出）。产出 `docs/active/2026-07-23_product-blueprint_VERIFY_REPORT.md`。**质量分 3/5 — 回炉**
- Round 21 最高优先项结论: **断言改动不是「改测试迁就代码」**。verify 把 `6e31883` 检出到独立工作树、用原用例原始夹具跑旧代码，**亲眼看到** `Gender` / `Are you Hispanic/Latino?` 被判成 `agent_profile_backed`、动作文案 `Do not ask the user first. Fill from existing profile`，而该夹具档案根本没有 demographics 块——**旧断言锁的正是 RISK_REPORT 判定的缺陷**。新断言更严（多锁一个类目 + 锁排序），同用例另 4 条断言未动，且有反向守卫（档案有值时须变回 `agent_profile_backed`，实测成立）。lead 对「两调用点属同一条」的读法亦成立
- Round 21 **P0 真 bug**: **这 4 个提交单独检出是坏的**。`git worktree add /tmp/x 71c3bef && npm test` → **165 条测试 6 条红 exit 1**；该提交里 `greenhouse_apply_driver.mjs:1570` 仍是 `BANK.yes_no_defaults?.work_authorization || 'Yes'`，`answer_routing.mjs` 里 `threeStateYesNo` 根本不存在。**真正的修复散在 18 个未提交文件里**——"CI 0/0/0/0"只对脏工作副本成立（verify 复现了），对任何可检出提交都不成立
- Round 21 **lead 自我纠正**: Round 19 裁决 3 说「剩余文件另起一个**文档**提交收尾」——**该判断错误**，那 18 个文件不是文档而是本轮缺陷的主体修复代码。裁决更正为：**必须先把修复代码正确提交、在干净检出上重跑 CI 全绿，批次 A 才算完成**
- Round 21 **P1 同类漏网第三条**（DESIGN §16 十一处与 BUILD §26 均无）: **出厂模板让新用户答应搬去纽约**。跑出货驱动，「你愿意搬到我们纽约办公室吗」——5 种档案全部 BLOCKED，唯独出厂模板 `FILLED "Yes"`。二分定位到两个各自足够触发的预填：`willing_to_relocate_scope: "Anywhere US"` 与 `target_filters.relocation_policy: "anywhere_primary_country"`。而 `relocation` **明确写在红线原文点名清单里**
- Round 21 **P2**: `secure_profile_files.sh` 新加的可选文件上锁块跑不到——必需文件循环遇缺失先 `exit 1`，而那正是它想覆盖的时间窗（实测 `answer_provenance.json` 留在 644）。缓解：写回口自己已 chmod 600
- Round 21 已复验通过: 现有用户 24/24 零变化；新用户实质变化就是那 8 条（verify 首次跑出 13 条，追下去是 `:400` 的 8 条展示截断、非回归——BUILD 应补注释）；闭环真 CLI 跑通且 `agent_actions` 为空（静默重试路径确未触发）；退出码 2/3/4 与「档案逐字节不变」实测；三个新模块行覆盖 100/100/100 由 verify 自测；**8 处偏离全部属实，其中 3 处「照设计字面写会出静默缺陷」逐条独立复核全部正确**
- Round 22: lead 派 builder 回炉（P0 提交修复 + 干净检出重跑 CI + P1 搬迁预填 + P2 上锁脚本）；同时把「我不确定工作授权时怎么办」端给拍板人——两份文档互相矛盾（`intake-and-profile.md` 说留 null 导致整批死锁 / DESIGN §6 说写 false 本身即一次编造），代码只实现了前者
- Round 23: arnold-builder 完成回炉（BUILD.md 第 28-35 节）。**P0 用重排而非追加**：批次 A 的 6 条守卫断言的对象全在那 18 个未提交文件里，守卫必须站在被守代码之后，否则中间四个提交仍是红的（`git bisect` 假阳性）；四个提交未 push（`origin/main` = `6e31883`）故重排零风险。新链 `6e31883` → `4713af9` 技能路径 → `a4cdf5e` 驱动三态 → A1 `36b38ba` → A2 `7c7e389` → A3 `ef48368` → A4 `93cc41f` → P1 `91e2708` → P2 `8846a62` → docs `946ddf6`；旧链留 `batchA-backup` 分支作安全绳。还原保真已用 `git diff | shasum` 逐字节校验，`git diff batchA-backup HEAD` 恰为那 17 个文件
- Round 23 **干净检出证据**（`git worktree add --detach`，0 脏文件）: 链上 **9 个提交逐个 `npm test` 全绿**（128→183 递增，fail 全 0，exit 全 0）；CI 四步在干净树上 **0/0/0/0**（tests 183/183、role_guard_smoke ok、public_alpha_gate ok 105 PASS、node --check 84 文件）；`demo:check` exit 0。对照旧 `71c3bef` 同法 **165/159/6 exit 1**
- Round 23 P1: 模板三处出厂值清空（`willing_to_relocate`→null、`willing_to_relocate_scope`→""、`target_filters.relocation_policy`→""），守卫**先写先看红**（原始报错 `FILLED "Yes"` 已贴 BUILD §31）。8 档案实跑：6 种没答过的全 BLOCKED、2 种**真答过的仍 FILLED "Yes"**（反向守卫，防矫枉过正）。闭环未断：note `location_not_in_profile_preferences` → 既有类目 `user_work_location_commitment`，零新增类目。清空 `relocation_policy` 不触碰校验器（required 的是 search_intent 那一份）
- Round 23 P2: 可选文件循环挪到必需循环之前，必需文件缺失**仍 exit 1 未放松**；该脚本此前只有 `bash -n`，本轮补 3 例测试。**未做并上报**：脚本只有一个调用点（onboard SKILL.md:198，Step 2，那时 `answer_provenance.json` 尚未生成），顺序修好在正常引导流程里仍轮不到——彻底解法是 STATE_AUDIT C11 / 批次 B R2「写入侧统一上锁」，加第二个调用点属绕行补丁且 SKILL.md 只剩 5 行预算，**请拍板人排期**
- Round 23 边界: 未 push、未动远端（`origin/main` 仍 `6e31883`）、未真跑投递、未提交表单；`~/.mrweirdo-jobs/` 跑前跑后 mtime 快照 `diff` 逐行一致 = 零写入。派遣单点名排队的三条（`ashby_apply_driver.mjs:1142` 丢 note、模板 `gpa: "3.9"`、截图文件名标错）**一行未碰**
- Round 24: arnold-builder 完成回炉，最终提交 `61c70f0`，工作区 0 脏文件，未 push。**P0 用重排而非追加**（判据：批次 A 那 6 条守卫断言的对象全在那 18 个未提交文件里，守卫必须站在被守代码之后，否则中间提交照旧红、git bisect 撞进去是假阳性；四提交未 push 重排零风险）。新链 10 个提交，旧链留本地分支 `batchA-backup` 当安全绳
- Round 24 builder 自证: 链上 9 个提交逐个 npm test 全绿（128→183 递增）；tip CI 四步 0/0/0/0；对照旧 `71c3bef` 同法为 165/159 pass/6 fail/exit 1。还原保真用 `git diff | shasum` 校过逐字节一致
- Round 24 **lead 独立复验（不采信自述）**: 全新 `git worktree add --detach` 干净副本 → tip `61c70f0` **183/183 pass、fail 0**；抽查中间提交 `a4cdf5e`（旧链翻车位置）**140/140 pass、fail 0**；主仓工作区 0 脏文件。**P0 确认已真正修复**
- Round 24 P1: 守卫先红后绿（原始报错 `FILLED "Yes"` 已存档），改后 8 档案实跑——6 种没答过的全 BLOCKED，2 种真答过的仍 FILLED "Yes"（**故意的反向守卫**，防止清空出厂值变成一律拒答）。闭环未断：note 映射到既有类目 `user_work_location_commitment`，零新增类目
- Round 24 **P2 未彻底修（builder 主动申报）**: `secure_profile_files.sh` 只有一个调用点（onboard SKILL.md:198 Step 2），那时 `answer_provenance.json` 尚未生成，顺序修好在正常引导流程里仍轮不到它。彻底解法是 STATE_AUDIT C11 / 批次 B R2「写入侧统一上锁」（还能覆盖求职信与投递截图）。**lead 裁决：不加绕行补丁，并入批次 B R2**
- Round 24 lead 裁决其余两条: ① builder 改了 A4 的提交信息（原文「其余约 30 个文件仍未提交」重排后已不成立，留着会让人找一批不存在的文件），代码一行未动——**同意** ② 「搬迁意愿」须补进 DESIGN §16 同类清单——**同意，与 BUILD §24 的 8 处设计修正合并，由 architect 在批次 B 启动前一并完成**
- Round 24 排队未碰: `ashby_apply_driver.mjs:1142` 丢 `a.note`、模板 `gpa: "3.9"`、截图文件名把失败标成成功
- Round 25: lead 判定批次 A 达标，等拍板人决定是否 push（10 个提交，对外动作）

**关卡 3 决策**：🩺 🔒 [用户] 拍板 — ① **工作授权改成能对号入座的问法**：问「你是美国公民或绿卡吗？」「你是持 F-1 的留学生吗？」，**不许问「你有没有工作授权」**（用户原话：这没人能知道）。此为批次 B 的引导提问设计依据 ② **批准 push**（条件：已验证完成——lead 已用干净 worktree 独立复验 tip 183/183、中间提交 140/140）
- Round 26: lead 派 arnold-ops 推送 10 个提交
- Round 27: arnold-architect 完成 DESIGN 修正（只动 DESIGN.md，+667/-37，未碰代码、未做 git 写）
- Round 27 八处偏离逐条改正（新增 §13.1 索引表，每处写「原来怎么说 / 为什么错 / 现在怎么说」）: ① note 查表——设计内部自相矛盾，现写死「查表命中后必过『该类目已答吗』谓词，档案有最终发言权、note 只负责问哪件事」，并规定新增映射必须同时补谓词条目 ② `priority` 不许取 0——`|| 99` 把 0 当假值吃掉，最该先问的排到最后、每批只问四组等于永远问不到，改 0.5/5.5/15 ③ `value_type` 非全为字符串——两个法律字段是布尔、五个 `standard_qa` 是对象，照字面写会让写回口对一半类目拒写，改为 `path_value_types` 覆盖表。architect 并主动降级自己 §1.1「驱动侧已接线」为「只对 Greenhouse 成立」（当时只读到信号发出、没跟到写进结果文件）
- Round 27 **§16 清单从十一处扩到十八处**: 补登搬迁意愿（L，已修 `91e2708`）与 `gpa: "3.9"`（M）；重扫又发现 **5 处**——学位占位符被当事实解析成「我不在读研」（N）、`earliest_start_date: "MM/DD/YYYY"` 既填进表单又让「你何时能开始」永不被问（O）、`how_did_you_hear: "LinkedIn"`（P）、**`why_company/why_role` 占位散文会被当成用户自己写的话渲染进作文**（Q）、`preferred_work_arrangement`（R）
- Round 27 **漏掉的根因是扫法不是疏忽**（§10.2）: 原扫描是「在驱动里逐行找写死的答案」= **汇点扫描**；搬迁意愿的填表代码完全正常，有毒的是喂给它的出厂值，**现场没有指纹，顺着代码永远扫不到**。补法 = 加一次方向相反的**源点扫描** + 固化成测试（出厂非空值必须登记「配置 or 已论证例外」否则测试红，ADR-10）
- Round 27 **整平台漏网（§13.6）**: `lever_apply_driver.mjs:265` 至今对「你是否有在美国工作的授权」**无条件答 Yes**，担保题两态压三态（没问过 = 我不需要担保，对国际生方向有害）。取证报告里有 **5 家真实 Lever 投递**。零件现成、文件 489 行不受净增 0 约束
- Round 27 批次 B 内容重写: ① **对号入座提问**（§13.3）三个是非题（公民/绿卡？→ F-1？→ 学校批下工作许可了吗？），不出现 CPT/OPT 术语、三个布尔由代码推导；5 情形 × 4 字段真值表，「F-1 还没批下来」明确不许顺手写 false；「说不清楚」给三条查证去处（学校国际学生办公室 / I-20 那一栏 / EAD 卡）+「这批先不投、查到一条命令就续上」+ 同批不重复问；**并删掉原 §6「不确定就写 false」那句——那本身就是一次编造**（verify 当面指出，architect 认对） ② **写入侧统一上锁**（§13.4 ADR-8）谁写谁锁 + 一次全量补锁挂 preflight（补锁不可省，因 `cover_letter.pdf` 根本没有生产方） ③ **Ashby 丢 note 实为两个洞**（§13.5）——除 `a.note` 被丢，`addPendingQuestion` 还要求必须有选择器，**下拉框形态的阻塞题连题带 note 一起蒸发** ④ **投递截图**（§13.7 ADR-9）先读页面文案定判定再命名、读不出写 `unknown`、**禁止默认成功**，并改成提交前滚到底整页截图（只修文件名会得到「一批诚实但依然无用的截图」）
- Round 27 **lead 裁决**: Lever（S）与工作方式（R）**纳入范围**——二者均属已拍板「bug 肯定要修」的同一缺陷在第三个平台/第 18 处的收尾，非新增范围。理由与此前批准 Greenhouse 补修一致
- Round 27 lead 采纳 architect 的排期建议: B3（留证 + 上锁）与 B2 都碰 `-auto` 技能说明书，**串行不并行**
- Round 28: arnold-builder 完成两处小修（`8e5a30b` 模板 GPA 置空、`360ff2f` Ashby 带出 note），证据取自干净检出
- Round 28 GPA 实测确认缺陷真实存在: 出厂模板喂给出货 Greenhouse 驱动，问「What is your GPA?」→ `mode=text_fill value="3.9"`，**3.9 真的被打到表单上**；且 `"3.9"` 是 truthy，`apply_gap_report.mjs:266` 把该题归成 `agent_profile_backed`（"不要问用户，从档案里填"）→ **照抄模板的人永远不会被问 GPA**
- Round 28 清空后下游行为实跑（阻塞而非填 0/空串）: Greenhouse 文本框阻塞 `value_empty_for:`（""/null/数字 0 三种全试）、下拉框本就无规则、Lever 答案空→unresolved、`greenhouse_helpers.js:372` addText 自带空值过滤、缺口报告归 `user_gpa` 进「该问用户」清单、闭环写回 3.4 后归 `agent_profile_backed` 且问句消失。反向守卫：用户自报 3.2 仍照填
- Round 28 Ashby 实测: 驱动对三个真实题面返回 `specific_city_fact_unconfirmed` / `work_authorization_required`，出货那行造出的条目 `{question,selector,tag}` **note 一字未带**。后果比自报更具体——`Do you currently live in the San Francisco Bay Area?` 改前落 **`agent_profile_backed`**（驱动恰恰因档案没这事实才停，报告却说"从档案里填"，该行被拦下且永远不会被问），改后落 `user_logistics_fact`。文件改前改后均 1170 行，净增 0 成立
- Round 28 证据: 守卫先写先红（5 条原始报错存 BUILD §37.2）、测试 183→**190** pass 190 fail 0、CI 四步跑在 `git worktree add --detach` 干净检出上 0/0/0/0、链上每个提交单独检出逐个跑过（183/187/190/190 全绿）、demo:check exit 0、`~/.mrweirdo-jobs/` 198 条目 stat 快照跑前跑后 diff 逐行一致 = 零写入、只 stage 自己的 8 个文件、DESIGN.md 全程未碰
- Round 28 **lead 独立复验**: 干净 worktree 检出 tip `ce8e092` → **190/190 pass、fail 0**，脏文件 0。确认属实
- Round 28 builder 报告两条（一行未改，归批次 B）: ① `value_empty_for:<题面>` 这类 note 不在 `NOTE_CATEGORY` 表里——GPA 题今天能正确归类靠的是报告侧题面规则 `/gpa/` 而非 note 通路，**而件二刚证明题面猜测会把"居住地"猜成 agent_profile_backed**，建议做成前缀规则 ② Ashby 的 `relocation_commitment_policy_unset` / `no_bucket_for:` 两个 note 现在能到报告侧但表里没有（实测不变差，只是没变准）

## 阶段 3 — 批次 B（2026-07-26 起）

**关卡 4 决策**：🩺 🔒 [用户] 拍板 —
① **批准推送**本地 7 个提交（2 个代码 + 5 个文档；代码内容与已复验的 `ce8e092` 逐字节相同，其上仅压一个纯文档提交，故复验结论仍成立）；
② **下一摊 = B0+B1 先做，同时并行派 pm 查「为什么没人用」**。剩余四件（Lever / 出厂模板另 5 处 / 写入侧上锁 / 投递留证）排在其后。
③ 用户重申唯一目标：**「我希望这东西最后能有人用，现在我感觉不会有人用」**，后续排序以「能不能让人用起来」为第一判据。

- Round 29: lead 向用户报「批次 B 六件里只有 B0+B1 压在『能不能用』这条线上，其余四件是『别出事』不是『有人用』」，并指出蓝图第八节的诚实缺口——**连续三轮零一手用户访谈**，不补则后续每次排序都是猜。用户采纳该排期
- Round 29: arnold-ops 完成推送。`origin/main` 由 `61c70f0` → **`8f9e546`**，`git status -sb` 无 ahead/behind，`origin/main..HEAD` 计数 0。ops 报一处偏差：未跟踪项 `.claude/arnold_state/hook_hits.jsonl`（插件本次会话自写的 hook 命中日志），已跟踪文件 diff 为空，不参与 push，未 stash 未提交未删除；**是否加进 `.gitignore` 待拍板人决定**
- Round 29 lead 开工前实查 B0/B1 起点（不采信文档自述）: ① **B0 洞 1 已修**（`ashby_apply_driver.mjs:1142` 已带 `note: a.note || null`）；**洞 2 未修**——`addPendingQuestion:1039` 的守卫仍是 `!item?.question || !item?.selector`，`:1142` 仍是 `if (sel)`，去重键仍是 `(question, selector)`，故下拉框形态的阻塞题仍连题带 note 一起蒸发 ② `NOTE_CATEGORY`（`apply_gap_report.mjs:120-137`）16 条已带 `categoryAnswered` 谓词（批次 A 成果），**缺前缀规则**与 `relocation_commitment_policy_unset` ③ **B1 零起点**——`shared/work_auth_identity.mjs` 不存在；引导文件实际路径是 `.claude/skills/mrweirdo-onboard/references/intake-and-profile.md`（DESIGN §13.3 未写全路径）
- Round 29: lead 派 arnold-builder 做 B0（洞 2 + note 表补全）+ B1（对号入座提问），一个施工包串行
- Round 29: lead 并行派 arnold-pm 回答「为什么没人用 / 第一个真用户从哪来」，产物 `docs/active/2026-07-26_first-user_PRODUCT_SPEC.md`，与施工线文件不重叠
- Round 30: arnold-pm 完成（409 行，零代码改动）。**主张 = 人肉门房版首跑（concierge run）**：不让人装，创始人先做访谈、再拿对方简历在隔离家目录（`MRWEIRDO_HOME=/tmp/concierge-<代号>`）代跑到 Step 4 打分为止、**绝不替对方投递**，24 小时内给一份带理由的岗位清单。零代码、本周可做。诊断：**第一分钟里没有一个字是关于他的**——风险前置、价值后置
- Round 30 pm 五个产品层面病因: ① 信任曲线是反的（最重的一次授权放在最便宜的一秒）② 首次价值兑现 20-40 分钟（C 级对照数字，方向可参考）③ **没有任何一档「先看看」**——`--dry-run` 零件已在 Step 5 跑着，只是没做成用户看得见的入口，与蓝图第五节「不是功能缺失是接线缺失」同病 ④ README 全英文而运行界面中文优先（`SKILL.md:63-79` 自称 CN-leaning），**两个人群必有一个在第一分钟被劝退，而我们从没决定过是哪一个** ⑤ **社交成本**（用自动投递工具本身要被同学问「那不就是海投机器人」），我们唯四的真实差异点全压在免责声明里当风险提示用
- Round 30 pm 给了可执行访谈方案: 找谁按转化率排序（今春投过实习没拿到 offer 的熟人 5 人 → 非本专业 3 人 → 社团/CSSA 征集 → **Reddit 明确不做**）；开场白不许说「我做了个工具你试试」；**Mom Test 8 问只问过去发生的具体行为**；三条可证伪判据 H1/H2/H3 各自写明「推翻信号 + 推翻后产品怎么变」；饱和判据与样本判据；**访谈笔记按三态记（是/否/没问到），「没问到」绝不许当「否」**——借 PROJECT_MEMORY 原则 2
- Round 30 **pm 反驳 lead 五条，lead 逐条裁决**：
  1. **B0 只完成一半**（`if (sel)` 守卫与 `addPendingQuestion` 的选择器强制仍在）→ **不构成新信息**：lead 在 Round 29 开工前实查已独立发现同一处，且已写进 builder 派遣单。**两条独立路径同向命中，判定属实**，无需追加动作
  2. **Lever 三处正在说谎属红线、红线不参与排序** → **lead 采纳**。pm 实读 `lever_apply_driver.mjs:255-279` 比 DESIGN §13.6 多抓一处（`:266`「你目前在读/会返校继续学业吗」无条件 `Yes`，**对即将毕业的大四生就是假话**）。**裁决：立即生效一条约束——292 存量里的 16 个 Lever 岗位，在这三处修好之前一条都不许投**；这是约束不是排期项
  3. **B3 投递留证提到 B2 之前** → **lead 采纳并更改排期**。判据：产品交给用户的唯一交付物是那份报告，而报告里「已提交 N 条」这个数字**今天是假的**（6 张 `ashby_success` 页面写着投递失败）；且 pm 接上一条 lead 没接上的线——`submission_evidence.mjs` 的「什么算真的投出去了」**是回执测量的前置**，B3 不做，`confirmed_at` 做出来也是建在假地基上
  4. **B1 依据是 n=1，建议排在首轮访谈之后** → **lead 不采纳，但上报拍板人**。理由：① 关卡 3 是拍板人本人直接拍的问法，lead 无权凭一份内部备忘录推翻用户拍板 ② pm 说「公民看到『你是美国公民或绿卡吗』会觉得是废题」——废题的代价是多答一次是非题，而现状的代价是**整批投递死锁在一道没人答得出的问题上**，两者不同量级 ③ 问法即使日后按访谈调整，模块与门的接线不白做。**已上报，等拍板人裁**
  5. **写入侧上锁从「安全」自我降级为「叙事一致性」** → **lead 接受该降级**（pm 主动降级自己的论点，判断诚实）。仍与留证同批，不单独排
- Round 30 pm 明确报了两处卡住（未自行填平）: ① 门房版的隔离跑法只读了 `shared/paths.mjs:37`，**无命令行、未实跑**，需工程侧十分钟核实 `MRWEIRDO_HOME` 是否真能把一次代跑完全隔离在临时目录 ② `docs/specs/first-user.md` 未建，属 lead 收口职责，pm 按边界没碰
- Round 30 pm 如实留的缺口: **连续第四轮零一手访谈**；P2（非技术背景美国大学生）**仍是纯假设，本轮未加任何新推测**；新提 P3（在美中国留学生）同为假设；定价与流失率数字全部 C 级、未打开原网页

**关卡 5 决策**：🩺 🔒 [用户] 拍板 —
① **人肉门房版首跑 + 5 人访谈照做，拍板人本人去找人**（访谈是创始人不可替代的动作，小队代不了）；
② **B1 继续做完**，不采纳 pm「排在访谈之后」的建议。

- Round 31: arnold-builder 完成 B0+B1（4 个本地提交，未 push）：`8eb581c` 信号通路 → `66882ab` 对号入座问法 → `5e4f76a` 变更日志 → `a1ffd15` 施工记录。产物 BUILD.md 第 45-54 节
- Round 31 B0 洞 2: Ashby 守卫放宽成只认题面、`:1142` 没选择器也进 pending、去重键改题面（builder 实测发现 **Ashby 每次重试都换 id，旧的 `(question, selector)` 键本来就挡不住重复**）。`ashby_apply_driver.mjs` **1170 → 1170，净增 0 成立**
- Round 31 B0 附加: 动态 note 走前缀规则 + `relocation_commitment_policy_unset` 进精确表，全部过 `categoryAnswered` 谓词，只读 `field.note`（行级 reason 张冠李戴的陷阱有反向测试钉住）
- Round 31 B1: 新建 `shared/work_auth_identity.mjs`（纯函数，5 情形 × 4 字段 20 格逐格断言）；门阻塞时同时给「卡在哪 / 三条查证去处 / 查到就能续上」并带 `asked_in_this_batch`；引导说明书 A0 改三个是非题、**删掉「留 null 让门去问」那段**、A2 加满 18 岁半句
- Round 31 证据: 测试 190 → **212 全绿**（新增 22 条，先红后绿报错原文进 BUILD）；CI 四步 × 链上 4 个提交各自在 `git worktree --detach` 干净检出上跑全 exit 0；`demo:check` exit 0；`~/.mrweirdo-jobs/` 跑前跑后 stat 快照 **7205 条零差异**；`+997 / −28`
- Round 31 **lead 独立复验（不采信自述）**: 全新 `git worktree add --detach` 干净检出 tip `a1ffd15` → **212/212 pass、fail 0**，工作区 0 脏文件。属实
- Round 31 builder 申报偏离设计 3 处（BUILD §52）: ① 前缀规则不做成「前缀→类目」查表——照字面写 GPA 题会丢掉自己的问句与写回路径 ② **顺手改了地点类目的「已答过吗」谓词**——不改的话新加的 note 会让真实用户的 Denver 题变成「档案里有别问」而驱动手里根本没这个值。**这是本轮唯一一处真实用户可见的行为改变**（自述 60 格对照 57 格一致、变的 3 格全在地点族）③ A2 满 18 岁只加问句、没加档案字段
- Round 31 **lead 裁决偏离 ③**: A2 那半句**并入 B2，不留待解**——只问不写档意味着用户答完答案无处可去，属静默降级。已要求 verify 确认「没有任何地方在假装它被存下来了」
- Round 32: lead 派 arnold-verify 独立验收 B0+B1，重点复核偏离 ②「是不是改判定迁就代码」（照 VERIFY_REPORT §5.1 的严格度）；并把 pm 报的门房版隔离跑法卡点一并交 verify 实测（`MRWEIRDO_HOME` 指到临时目录时，档案/简历/求职信/截图/数据库/日志/留痕有没有任何一样会漏回创始人真实家目录）——**结论出来前不许拿真人简历开跑**
- Round 32: lead 唤回 arnold-pm 追加交付 `docs/active/2026-07-26_first-user_INTERVIEW_KIT.md`（一页行动卡：开场白逐字稿中英各一版 / 8 问逐字问法 + 每题在测什么 / 现场记录表 / 三条判据速查卡 / 转门房版那句话 / 隔离红线提醒），要求全文大白话、不许出现产品方法论术语。lead 收口时改掉其中一处裸代号「等 lead 回你」→「等我回你」，并建定稿 `docs/specs/first-user.md`
- Round 33: arnold-verify 完成 B0+B1 独立验收。产物追加进 `docs/active/2026-07-23_product-blueprint_VERIFY_REPORT.md` 第 2 轮章节。**质量分 4/5 — 放行，带三件必做**。未改一行产品代码、未 push、真实家目录 7205 条目 stat diff = 0
- Round 33 **偏离 ② 独立结论：不是「改判定迁就代码」**。verify 搭了 95 格矩阵重跑（比 builder 自建的大 50%），88 格一致、7 格变、全在地点族。两条硬证据：① **新谓词是旧谓词的真子集，严格收紧不是放宽**——「迁就」的形状是放宽 ② **旧代码本身自相矛盾**（builder 自己都没说）：同一道 onsite 题、同一份真实档案，不带 note 判「问用户」，带上「档案里没有这个地点」的 note 反而判「档案里有」。builder 做的是把两条路统一，统一后与旧代码那条正确的路逐字一致。**代价比自述还小**：已答过的城市（New York / Bay Area）零变化，只有没答过的城市多问一次
- Round 33 verify 其余复核: 偏离 ① 的红**自己写回去复现成功**（212→209，GPA 守卫红，理由属实）；偏离 ③ 说明书明写只问不写档、`at_least_18` 全仓库零代码读，**不构成静默降级**（但三个驱动对该题仍无条件答 Yes，属 B2）；**10 次突变测试全红、无假绿**（批次 A 曾抓到过「名字对、断言对、什么都没证明」的测试，本轮没有）；链上 4 个提交各自干净检出 CI 四步全绿、`demo:check` exit 0；漏检率自报 12.5%
- Round 33 **❌ 真 bug 1 处（P2，不阻断合入）**: **B0 的前缀规则对唯一真实用户 100% 不生效**。`unknown_user_fact` 的谓词是 `nonEmpty(standard_qa.custom_facts)`——问的是「这个桶里有没有任何东西」，而真实档案那桶里有 11 条，于是恒返回 `agent_profile_backed`，**正好是前缀规则被设计出来要否掉的结论**。实测三格（Preferred name / Primary phone / Expected graduation month）真实档案全没变、清空 `custom_facts` 后才生效。**builder 的 60 格对照表抓不到的原因**：他比的是「旧 vs 新」，这三格新旧都是 `agent_profile_backed`——**看起来「零变化」，实际是「新功能没启动」；零变化在这里不是好消息**。同款形状是本项目老坑：看起来修好了、行为没变
- Round 33 **⚠️ D 项：隔离不成立（两个洞）**。好消息：**没有漏回创始人 `~/.mrweirdo-jobs/`**（实测 stat diff = 0，7205 条目一字节没动）。坏消息：
  - **洞 1（数据漏出沙箱）**：过程文件走的是**另一个**开关 `MRWEIRDO_ONBOARD_TMP_DIR`，`shared/onboard_tmp.mjs` 默认值写死 `/tmp/mrweirdo-onboard`，而该变量**在全部技能说明书与脚本里一次都没被设过**（grep 零命中）。该目录 755、167 个条目全是创始人历史数据；verify 那次代跑真往里写了带**代跑对象工作身份**的文件。会落进去的还有 `apply-result-*.jsonl`（**表单上填了什么**）、`apply-gap-report.json`（**哪些个人问题没答**）。**除隐私外还有正确性风险**：`store_scored_jobs.mjs` 默认从该目录读 `to_score.json` / `scored.json`，下一次运行可能读到上一个人留下的文件
  - **洞 2（更致命，与代码无关）**：**环境变量不跨 bash 调用存活**。技能说明书里全是 `${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}`——继承不到就**静默**用创始人自己的家。在「每个 bash 块一个新 shell」的环境里，只要一个块漏了前缀就前功尽弃且无任何提示
  - verify 另提醒：代跑目录里 `jobs.db` 是 644（别人的岗位与投递记录同机可读），属 B3-a 范围；pm 方案「只跑到打分为止」在路径上是安全的，**真正的风险与跑多远无关**
- Round 33 **lead 裁决**: ① B0+B1 **判定达标合入**（4/5 放行，未 push）② 必做 1（谓词细粒度化 + 闭环测试）与必做 2（隔离两个洞 + 操作卡）**立即派 builder**，属工程层可逆，lead 权限内 ③ **代跑红线维持并升级为实证**：拍板人已被告知「实测通过前不许拿真人简历开跑」，现在有了实测依据——**不是怕漏进他自己的家（实测不会），而是过程文件会落进共享 `/tmp` 且一个 bash 块漏前缀就前功尽弃** ④ 必做 3 属产品取舍，**上报拍板人**
- Round 34: lead 派 arnold-builder 修两件必做（谓词细粒度化 + `onboard_tmp.mjs` 默认值 + 给「静默回落」加可见出口 + 写 `docs/active/2026-07-26_concierge-run_RUNBOOK.md` 固定操作卡）。派遣单点名要求：兼容性（既有 167 个 `/tmp` 文件）必须显式处理并写清楚，**发现真冲突停下报告，不许静默降级、不许删任何既有 `/tmp` 文件**

- Round 35: arnold-builder 完成两件必做（4 个提交 `ce48d4f` 谓词 → `210cd7a` 隔离 → `229fd1b` 文档 → `a4a865e` 施工记录，未 push）。新产物 `docs/active/2026-07-26_concierge-run_RUNBOOK.md`
- Round 35 件一: `unknown_user_fact` 谓词改成「这道题的那条事实答过没有」，与偏离 ② 同构。**并做了一件派遣单没要求的事**：报告把「答案该写回哪个键」（`profile_key`）跟着问题一起发出去。builder 理由——**键是模型自己起名的，不公布则测试里绿、真人那边仍被反复问**，不做等于假绿。自述真实档案 40 格探针 14 格变（全在「驱动明说没值可填」那列，含 verify 点名三格），补上 `preferred_name` 后该格立刻变回「不用问」
- Round 35 件二: 过程文件默认值改成 `<家>/run-tmp`。**兼容性一处真冲突，未绕过**——说明书里 20 多处把 `/tmp/mrweirdo-onboard` 写死在命令里，只改代码会让主链路当场断（发现写新目录、打分读旧目录），故一并换成 `$MRWEIRDO_HOME/run-tmp`；**不留回退读**（那正是跨人串档的洞）
- Round 35 「不静默回落」的形态: 家目录里放一张纸条 `~/.mrweirdo-jobs/.concierge_run_active`，`atsHome()` 与 shell 入口看见就**拒绝这个家并报错**（带沙箱路径 + 重跑命令）。关键判据是**「解析后的家」而不是「变量有没有设」**——说明书的 `${VAR:-default}` 写法让变量永远是设上的。`intake_resume.sh` 用 `cp` 不经过 Node，单独加 shell 侧守卫
- Round 35 顺带发现: **CI 第 2 步自己就在往共享目录漏文件**（改前 2 个/次，改后 0 个）
- Round 35 证据: 测试 212 → **224**（新增 12）、CI 四步 × 4 提交干净检出全 exit 0、`demo:check` exit 0、7 处突变测试全红、操作卡用假家目录从头走通（漏开关时 exit 3 且简历没被拷进去）、创始人真实家目录 stat diff **0 行 / 7205 条目**
- Round 35 **lead 独立复验**: 干净 worktree 检出 tip `a4a865e` → **224/224 pass、fail 0**
- Round 35 **lead 发现一处数字对不上，不接受推测**: verify 上一轮报共享目录 **167 条目**，builder 自述「旧文件一个没删没搬」同时又说「复原 165」。**差 2 个，且删除是不可逆动作** → 已列为本轮验收最高优先项，要求实证「有没有任何一个创始人的历史文件被删」，排除不了就明说排除不了
- Round 36: lead 派 arnold-verify 第 3 轮验收，七块重点：A 不可逆动作核实（167/165 差额）、B 用最坏意图破「纸条守卫」（尤其**纸条忘了删导致创始人自己被锁在门外**这个最可能真实发生的失败模式）、C 谓库细粒度化 + **那处未经授权的自主扩范围该保留还是回退**、D 20 多处写死路径一并替换的兼容性、E **照操作卡当一次拍板人真跑一遍**（含故意制造污染看核对命令查不查得出）、F 老坑回归、G 对 builder 三条待拍板给技术判断
- Round 36 builder 报三条待拍板（BUILD §63）: ① `.claude/settings.json` 里读旧目录的权限未代改，新目录可能多一次授权提示 ② **`store_scored_jobs.mjs` 读不到输入文件返回空数组不报错**（既有写法，本轮改动多了一种触发方式）——是否改成 Fail Fast ③ `jobs.db` 644 按派遣单未做，已如实写进操作卡

- Round 37: arnold-verify 完成第 3 轮验收（报告第 1124 行起）。**质量分 3/5 — 回炉**。产品代码一行未改、未 push
- Round 37 **A 项结论：能排除，没删创始人任何东西**。共享目录 165 个文件**全是 `apply-batch-summary-*.json`**、出生时刻 2026-07-22 21:29 同秒，164 份是 `Batch Co` 测试夹具、1 份真实公司也是 `dry_run:true`——**那里从来就没有过创始人的求职历史**。四路互证（文件名时间戳 vs mtime 165/165 零偏差、成对结构 82 对 + 1 单份零孤儿、施工侧三份快照逐字节相同、清单与全部快照一致）。**167 与 165 不是差额**——verify **自我更正**：第 2 轮把 `ls -la` 的目录链接数当成了条目数（本机链接数 = 文件数 + 2，已做对照实验坐实）。verify 自己复验时漏进 4 份，按边界**未删**
- Round 37 B 项: 守卫**破不掉**（纸条在、漏前缀时 4 个 node 入口全抛错、`preflight.sh` exit 3；`intake_resume.sh` 走 `cp` 那条独立验过 exit 3 且**简历没被拷进去**）。但「忘撕纸条」是真风险——**报错主推的补救是错的**（让用户带开关重跑，而操作卡第 6 步已把沙箱删了），正确动作「撕纸条」排第 6 行、全英文、Node 侧带整段调用栈。**守卫没漏，是人读不懂**。纸条忘放则完全静默
- Round 37 C-4 裁决: 那处未经授权的自主扩范围**保留不回退**——理由成立（不公布键则闭环闭不上，实测坐实）、零泄露（纯题面派生）、属必要收尾非蔓延。**但它兑现不了自己的承诺**：兜底路径 `return 'unknown_user_fact'` **从不查新谓词**，实测拍板人真实档案 11 个已答事实里 **6 个照问不误**（**`us_citizen` 已答 `false` 仍在问**），3 个还指导写重复键。verify 并证实**改完 224/224 全绿 = 那条路一条测试都没有**
- Round 37 E 项: **操作卡跑不通**——从拍板人真实落脚点走，第 3 步当场 `No such file or directory`，**卡里搜「cd / 仓库」命中 0，从头到尾没说代码在哪个文件夹**。其余三项良好（污染核对命令实测有效、`jobs.db` 644 如实写明、零内部代号）
- Round 38: lead 派 arnold-builder 回炉三件（兜底谓词先补会红的测试再改 / 守卫文案中文优先且正确动作排第一 + 处理「纸条忘放」的静默 / 操作卡补进仓库那步并从拍板人落脚点重走）
- Round 39: arnold-builder 完成回炉（6 个提交 `953e99a`→`b9d4b5b`，未 push）
- Round 39 件一: 先补测试看红（原始报错进 BUILD）再改兜底 1 行。**builder 自测 8/10 照问不误 → 2/10**，并主动说明「验收报 6，我测出 8，**以我的为准**」（取较差数字）；3 处「指导写重复键」归零。**剩的 2 个不是同一个 bug**——那两个键是当初手写进档案的、非报告发出，修它要引入模糊匹配，而模糊匹配错的方向是「说他答过其实没答」= 死锁，**builder 停手交拍板**（符合家规：要么彻底解决、要么明确列出来问）
- Round 39 件二: 报错改中文人话、第一行即可复制的删除命令、去掉调用栈、node 与 shell 逐字节相同（有测试防漂移）。**「纸条忘放」做成双向配对**——沙箱里加一张回执，缺任一半或两半对不上，4 个 node 入口 + `cp` 那条全部拒绝、exit 3、简历不落地。**盖不住的一格主动明写**：操作卡第 1 步整段跳过时两张纸条都没有，只能沉默，已写进操作卡「不能跳」
- Round 39 件三: 从拍板人的用户文件夹原样粘贴走通全卡；删简历拆成第 7 步，写错文件名会说「简历还在」而不是「清理完成」
- Round 39 证据: **232/232 全绿**、CI 四步 × 6 提交各自干净检出全绿、`demo:check` 0、创始人家目录 7205 条目零差异、`/tmp/mrweirdo-onboard` 169→169 未删
- Round 39 **lead 独立复验**: 干净 worktree 检出 tip `b9d4b5b` → **232/232 pass、fail 0**；创始人家目录 29 项、共享目录 169 个均未减少
- Round 39 builder 另报一个旧洞（只报未改）: **两个驱动的投递截图写死公共 `/tmp`**（`ashby_apply_driver.mjs:1083`、`greenhouse_apply_driver.mjs:1834`）——与 DESIGN §13.7 所列一致，属 B3-b 范围
- Round 40: lead 派 arnold-verify 第 4 轮聚焦复核（回炉三件 + 双向配对新机制），并要求**解释 6 与 8 这个数字分歧的来源**、以及给出最终一句话结论：**拍板人现在能不能照卡安全代跑一次真实学生的简历**

- Round 41: arnold-verify 完成第 4 轮聚焦复核。**质量分 4/5 — 放行，无必须回炉的真 bug**。漏检率自报 **50%**（本轮两条问题都是它上一轮该发现没发现的）
- Round 41 **数字分歧解决，verify 自认错在自己**: 独立重测 **8/10 → 2/10，与 builder 一致**。6 与 8 不是口径差异，是 verify 第 3 轮两处硬伤——表只列 9 道题（漏了 `previously_employed_here_default`）、正文写 6 而自己那张表数出来是 7。**以 8 为准**。`us_citizen=false` **已归零**（不再问）；反向守卫成立（没答过的仍问、空档案全问）；**撤销那一行修复，测试当场变红**
- Round 41 剩余 2 题: builder 的说法**全部成立**，「接受多问一次」是正确取舍——verify 按公布的键写回再问一遍，**两题都闭上、能自愈**
- Round 41 守卫: **16 个攻击场景没破掉**（缺任一半 / 两半对不上 / 尾斜杠 / CRLF / 多行 / 空文件全部 exit 3 且简历不落地；配对正确时零噪音通过、232 条测试不误伤）。忘撕纸条的报错**拍板人读得懂**：第一行即可复制的 `rm`、全中文、无调用栈。「逐字节相同」用 `cmp` 验 4 个文案变体**为真**；但**防漂移测试只覆盖 1/4**（改另 3 个变体里一个字全量测试全绿放过，P3）
- Round 41 **最终结论：可以代跑**。全卡 7 步从拍板人的用户文件夹原样粘贴跑通，`cd` 已补，写错文件名说「简历还在」。**两个附带条件**：① **第 1 步不能跳**（该句现埋在卡最末尾，建议搬到第 1 步下面）② **不要越过第 4 步**
- Round 41 **新挖出一条 builder 没测的（P2）**: 兜底谓词**射程放宽后假阳性面同步放大**——6 个「共享词段但问的是另一件事」的题面里 **5 个从「问他」翻成「系统按档案填」**，命中「绝不编造个人事实」红线。**代跑场景射程为零**（新学生档案是空的，实测），故不阻断本轮。verify 建议与「剩下 2 题的键迁移」**并成一件活**交 bug 成员——**根因同一个：键与题面只有字符串关系，没有身份关系**
- Round 41 其余核实: `git rev-list origin/main..HEAD` 实数 **15**，施工记录写 14（那次计数漏了自己）；两个驱动投递截图写死公共 `/tmp` **属实**，但 `--dry-run` 在代码里早于驱动启动就 `continue`，**「碰不到」是结构性的**
- Round 42: lead 派 arnold-builder 做三处收尾小修（操作卡把「第 1 步不能跳」搬到第 1 步下方并说清跳了会怎样 + 「不要越过第 4 步」在第 4 步位置显式出现 / 防漂移测试补到覆盖全部 4 个文案变体 / 改正领先提交数）。派遣单明确圈出 P2 假阳性**不许顺手动**，lead 另行排期

- Round 43: arnold-builder 完成三处收尾小修（tip `7a3d5aa`，本地领先 **18**，未 push）。① 操作卡两条警告各自搬到对应步骤正下方、末尾改成复述；② 防漂移测试补到 4/4（先取回旧测试证明缺口真实——3 个变体突变全绿 13/0，再参数化；4 个变体各改一字各红一次）；③ 领先提交数 14→15 改正，并把 CHANGELOG 里「有测试守住文案」那句只兑现 1/4 的**过度声明**一并改准
- Round 43 **builder 把新写的因果实跑验证了**（不是照抄验收的话）: 跳过第 1 步 → **退出码 0、屏幕 0 条提示、简历确实落进创始人自己家**；跑过第 1 步再删纸条 → 退出码 3、简历没被拷。**这才是那条警告必须前置的实证**
- Round 43 证据: 测试 232 → **235**、CI 四步 + `demo:check` 在 3 个干净检出上全跑 exit 全 0、创始人家 7205 条目全程零差异、`/tmp/mrweirdo-onboard` 169→169；改完后从拍板人落脚点原样重走全卡 7 步全通；范围外 9 项逐条对账零改动（BUILD §82）
- Round 43 **lead 独立复验**: 干净 worktree tip `7a3d5aa` → **235/235 pass、fail 0**；领先 18 个提交实数核对无误；创始人家目录 29 项、共享目录 169 个均未减少

**关卡 7（用户当面纠正设计前提）**：🩺 🔒 [用户] —— **「F-1 学生不需要先批下工作许可才能投工作，他是先投完工作之后才会批下工作许可。」**（原话该处用的是旧词，本档按术语规范统一为「投递 / 投」，语义未改）
- **这条推翻的是 DESIGN §13.3 的设计前提，不是一个参数**。现行行为：对号入座第三问「学校批下工作许可了吗」答「还没有」→ 三个格子都不写 → **门拦下整批，一个岗位也投不出去**。
- **按用户所述实情，「还没批下来」是绝大多数正在找实习的 F-1 学生的正常状态，不是异常状态** → **等于把核心用户群整个挡在门外，且挡得毫无道理**（他本来就该在这个阶段投）。
- lead 判断：ADR-1「缺了会阻塞 ≥80% 行的事实才设门」这条判据下，**第三问压根不该是一道门**；而表单上那句 `Are you authorized to work in the US?` 对尚未拿到 CPT 的 F-1 到底该怎么答，正是用户自己在关卡 3 说的「这没人能知道」——**不是随手能定的，需要 pm + architect 重定这一段**。
- **有利条件：这批代码还没推**（`origin/main` 仍 `8f9e546`），改起来干净。
- lead 已向用户提议派 pm + architect 重定该段，**等用户放行**。

- Round 44: lead 三线并发 —— pm（产品侧：pre-CPT 的 F-1 该怎么对待）‖ architect（架构侧：门与三问重定）‖ bug（根因：键与题面只有字面关系）。前两者互不读对方产物，回来由 lead 合并
- Round 44 **lead 自我纠正**: 上一轮问过用户「要不要派」后停下等，等太久了。用户的纠正本身就是最强授权，不该二次确认。已向用户认这一条
- Round 44 lead 直接裁决（未占用用户拍板额度）: `store_scored_jobs.mjs` 读不到输入文件返回空数组 → **改成 Fail Fast**。依据家规「出错如实报告不遮盖、不许带病运行」，且「0 个岗位」与「文件丢了」在用户眼里完全同形
- Round 45: arnold-pm 完成（产物 `docs/active/2026-07-26_work-auth-rethink_PRODUCT_SPEC.md`，零代码改动）
- Round 45 pm 主张: **门留着、判据不变，改的是「什么算一个合格的回答」**——今天只接受「有/没有」两种事实性回答，加第三种**指令性回答**「这类题别替我答，碰到就把岗位单独列给我」。这把钥匙**不需要任何人对法律下判断**，因此保证一条不变量：**任何身份的用户都存在一条能把门打开的路径**。今天该不变量不成立，这就是本轮全部问题的形状
- Round 45 pm 对那道表单题选第三条路: 产品**一个字都不替用户决定**，只问一次「碰到这道题你要我怎么办」（A 填有 / B 填没有 / C 别替我答，**默认 C**）。选 A/B 时**必须先告知「这三个字会被原样打到真实雇主表单上」**——不讲就是诱导。留空一路**已被 Binti 实证否决**（表单当场红字拦下）。逐条代价见 §5.2
- Round 45 pm 反驳三条，**最要害的是第 19 处编造**: `answer_templates.mjs:9-19` 的 `authSummary()` 把 `visa_status` **逐字**渲染进 `{{WORK_AUTH_SUMMARY}}`，而 `answer_bank.json:82` 的可到岗时间模板**正在用它**（live）。于是设计自己发明的标签 `'F-1 without current work permission'` 会变成一句**用户从没说过的、主动向雇主宣告「我没有工作许可」的英文**——**比答错是非题更狠：是非题是被问的，这句是我们替他写的散文**。第二个洞：`f1_permission_unclear` / `other_status` 把**用户原话**写进 `visa_status`（夹具里就有中文「我不知道，学校说要等」），会被原样渲染进英文表单自由文本框。**不在 §16 十八处清单里，属第 19 处**，正好印证项目记忆第 5 条（扫源点不只扫汇点）
- Round 45 pm 另两条反驳: ① 「说不清楚」那三条查证去处**全是「确认你有没有」，没有一条能让还没投工作的人拿到许可**——查完回来门照样不开，是礼貌的死胡同 ② `other_status`（非公民非 F-1）四格全不写 = **第二个永久死锁，上游从没被点名过**
- Round 46: arnold-architect 完成 DESIGN 修正（+599 行，只改 DESIGN.md，全程 Edit，未写实现代码、未 git 写，创始人家目录 stat 零差异）
- Round 46 **80% 判据首次真按定义量**（72 个真实投递 × 263 条真实题面，出货驱动跑，语料 `essay_pending.jsonl` 只读）: 常态用户（还没批许可）**5.6%（4/72）**、最坏情形 22.2%、公民与已有证件 **0%**；**而今天那道门实际阻塞 100%**（隔离家目录实跑 preflight，整批 0 行）。**判据不达标**。5.6% 已标明是**下界**（语料只记驱动没填上的题），未包装成点估计
- Round 46 门去留结论: **不删，把谓词从「值在不在」换成「三个身份问题问过没问过」**；并给 ADR-1 补第二个必要条件「**可获得性**」——**用户答不出来的事实，门再对也是墙**
- Round 46 architect 顺带修掉一处漏写: 「说不清楚」那行漏了 `requires_sponsorship_future: true`——**实测补上这一格就让被阻塞投递从 16/72 降到 4/72**
- Round 46 **architect 独立发现（打自己脸）**: **现行 Q3 问句里的 CPT / EAD 违反关卡 3 自己的硬约束**（拍板人明令不许出现该术语）。连坐排查共 **15 处**（本设计 9 处已改或标注，代码与说明书 6 处只列不改交 builder）。ADR-11 已写（错在哪三层 / 错的来源 / 防再犯三条动作）
- Round 46 迁移: **叠加不回退**。18 个未推提交里只有 `66882ab` 带错误前提且主体仍正确；其后有 16 个提交、两个又改过同一文件，回退要动已验收的历史，而 Round 24 那次重排的理由（守卫顺序）这次不成立
- Round 46 **lead 合并两侧**: pm 的 Q4（一次性策略问句）与 architect 的门谓词（问过没问过）**互补不冲突**——architect 的「分支 B 按行提问」被他自己标为可能越关卡 3 线，而 **pm 的 Q4 正是对该反对意见的更好答案**（一次性、非法律题）。**两处待拍板实为同一个问题**：关卡 3 那条线到底禁的是什么，故合并成一问端给用户
- Round 46 lead 直接裁决: architect 第 2 问（保留那道「引导完成度」检查）**采纳他的建议保留**，属工程层可逆，不占用户拍板额度
- Round 47: bug 完成根因诊断（产物 `docs/active/2026-07-26_label-key-binding_BUG_REPORT.md`，代码零改动）
- Round 47 根因: **`custom_facts` 的键既当「存哪儿」的地址、又当「这条答的是哪道题」的身份证**，而当身份证用时只靠「键的词连着出现在题面里」——**包含关系不对称**，正着漏认、反着多认
- Round 47 **判定链路首次画全**: **五段 21 道规则**（BUG_REPORT §2.2，此前无人写全）。优先级 = 标记表 > 18 条题面正则 > 词段兜底。**附带发现 ADR-3「note 主导」只落实了静态 note 那一半**——动态 note（占绝大多数）进不了标记表，**题面正则至今仍在领跑**
- Round 47 量出的数（107 道真实题面，来自拍板人历史投递留痕，只读）: 存量假阳性 **0/107**、假阴性 2/10。**但面会自我增殖**——把报告自己发布的键写回去再跑同一批真实题面，**立刻出 2 处真实假阳性**（`Name`→盖住 `preferred name`；`School`→盖住「实习后能否转全职」）。**用得越多，认错越多**
- Round 47 推荐: **先 B（收紧成整题面比对，代价实测 = 拍板人多答 3 次、代跑用户零代价），A（键带题面元信息）排后，两件都做**。理由：两个方向的错**不对等**——判成「问用户」有界可自愈，判成「系统填」无界不可自愈。**注意 A 不能挂 `answer_provenance.json`，会废掉 ADR-4**
- Round 47 **bug 反过来修正 verify 两条**: ① verify 说的「不产生死锁」**在代码层面不成立**（用户出口是空的、驱动读不到该桶，只有模型编个值才解得开——**编造与死锁二选一**）② **「代跑射程为零」只对通用桶成立**，同族的无条件规则（`:308` `previously employed|work environment`）在**全空档案**上照样判「系统填」，真实题面里已命中 1 条
- Round 47 **lead 不采信自己的推断**: 上条②直接卡着拍板人当前要做的代跑，lead 初判「只跑到打分为止不受影响」但**要求 bug 用实证回答**，第一句必须「代跑安全 / 不安全」二选一。**在回话前代跑继续按住**

- Round 48 **bug 实证回答：代跑安全**（非推理）。假学生空档案（**已先验证它确实触发那条误判**）+ 假家目录，Step 0-4 按操作卡真跑一遍（真联网抓岗、真入库、真出清单），挂模块加载记录器：
  - 全链条加载 **174 个模块，`apply_gap_report` / `missing_field_questions` 0 次加载**；**阳性对照**（拿分类器自跑）能记到 2 条告警，**证明仪器有效**
  - 逐条扫全部 13 个产物（含 sqlite 二进制）：① 无表单写入（`apply-result` 0、`feedback.jsonl` 0、DB 已提交 0 行）② 清单里 6 个分类器关键词**全 0 命中**、`gap_fields: []` ③ 学生 `profile.json` 跑前跑后 **sha256 逐字节相同**
  - 机理：那条误判活在缺口报告里、输入是投递结果文件；**不真投就没有输入，这段代码这一轮压根没运行**
- Round 48 ⚠️ **必须守的线**：**Step 5 队列关卡一开就会把分类器链拉进来**（`apply_batch.mjs` 静态依赖已验证）。线守在「打分排序结束、不点关卡」——操作卡第 4 步下方已写
- Round 48 **bug 自己抓住一次假证据**: 第一版记录器记到 0 条、**差点当证据交**；`--import` 不等于注册钩子，**是他自己起疑加阳性对照才发现仪器没通电**。本项目反复吃「测试全绿但什么都没测」的亏，这次是自查抓住的
- Round 48 **lead 裁决（工程层，未占用户拍板额度）**: 键与题面绑定 **先 B（整题面比对）再 A（键带题面元信息），两件都做**。依据 bug 实测的**不对等性**——判错成「问用户」有界可自愈，判错成「系统填」无界不自愈且踩红线；B 的代价是拍板人多答 3 次、代跑用户零代价
- Round 48 lead 收口: 建定稿 `docs/specs/label-key-binding.md`（含五段 21 道规则链路、自我增殖现象、两方向不对等、代跑不受影响的实证、以及对上游两条结论的修正）
- Round 48 **lead 向用户放行代跑**：访谈随时开始；拿到简历照操作卡跑到打分为止；**不许点第 4 步之后那一关**

**关卡 8 决策**：🩺 🔒 [用户] 拍板（2026-07-29）——
① **那道表单题「你有没有在美国工作的许可」：一开始就问他一句「你要我怎么办」**（采用 pm 的 Q4：填有 / 填没有 / **别替我答，默认**；问一次管全部；选前两档必须先告知「这三个字会被原样打到真实雇主表单上」）。**architect 的「真投时碰一次问一次」分支被否，不保留为备选。**
② **既不是公民/绿卡也不是 F-1 的人（其他签证）：给他多问一题**（「将来长期在美国工作，需要雇主帮你办签证吗」），**而不是**让「别替我答」一把覆盖整族。**⚠️ 此选择与 lead 和 pm 的建议相反**——二者倾向一把覆盖，用户选了多问一题，照办。lead 已要求 architect 把这一题设计得不越关卡 3 那条线（不出现签证类别术语；若判断仍会滑向法律判断须明说交拍板人）。

- Round 49 **lead 自我纠正（用户当面指出）**: 「关卡」这个词从头到尾没跟用户解释过，且被写成「关卡 3 那条线」这种省略形式。已向用户解释——**关卡 = 我停下来等你拍板的那个点，编号是为了下次不用重讲**；并按用户要求改为**一次只问一个问题、用问题形式问、不出现内部词**
- Round 49: lead 把全部待办列成清单端给用户（等你一句话 2 件 / 已定排队 5 件 / 红线约束 1 件 / 已知未排期 5 件 / 大件没碰 4 件 / 用户自己要做 2 件 / 压着 1 件）
- Round 50: lead 唤回 arnold-architect，把关卡 8 两条决定落进 DESIGN 出可施工定稿；并要求**把 pm 查出的第 19 处编造纳入本批**（`authSummary()` 逐字渲染 `visa_status` 给雇主）——理由：与本次改动同源，**留着等于一边修编造一边继续编造**

**关卡 9 决策**：🩺 🔒 [用户] 重新定向（2026-07-29）——
① **对外找用户暂缓**（门房版首跑 + 5 人访谈**暂缓不是取消**）：「对外走这件事其实先不重要。我自己也会用这些东西，我自己在本地如果能用得不错，我会觉得挺好。」
② **需求重申（A 级，用户本人即当前唯一用户）**：「我要一键投递工作，不想自己去投递。平台越多，投递的工作越多越好。我一天投 100 家。」
③ **先学习别人**：「我不希望我们做这东西最后还不如别人做得好」——要求真正调研 GitHub 同类项目的 best practice，好处与问题都要看。
④ **对 pm 的明确要求**：「PM 你要跟我说怎么实现，要给我一个完整的方案。你不能老是问我。」
⑤ lead 已当面指出「一天 100 家」与用户自己拍过的「20-30/天上限」（账号风险）冲突——**未重新裁决，留给方案里给选项**。

- Round 51: lead 停掉接续施工（额度中断后刚重启、仅读了文件未动代码），改派两线流水线：
  ① arnold-architect 做 **GitHub 同类项目代码级调研**（允许 `git clone --depth 1` 到 scratch 只读研究，**绝对禁止运行克隆代码**；重点：平台覆盖怎么做的、「投出去了没有」怎么判、日百量级有没有人真做到过及代价、我们三处结构病别人解了没有），产物 `docs/active/2026-07-29_github-benchmark_ARCH_NOTES.md`
  ② arnold-pm 先做产品级最佳实践调研（「一键多平台大批量」品类里做得最好的长什么样、日百量级谁声称做到及口碑），**再读 architect 产物**，产出**完整实施方案** `docs/active/2026-07-29_master-plan_PRODUCT_SPEC.md`——从八大块现状到「本地一键大批量投」分阶段、每阶段用户可感知交付 + 可证伪验收；必须直面 100/天 vs 20-30/天冲突给爬坡方案；红线（Lever 16 岗不许投）与半截身份问答如何收尾都要进方案
- Round 51 现场备忘: 工作区仍有 1 脏文件（`test/personal_fact_gate.test.mjs`，5 条红测试，被叫停施工的半成品）——**未处理，等方案定了一起收**；本地领先 origin/main 20 提交未推
- Round 52: 两线均遭基础设施中断（pm 服务器错误 / architect 断流卡住 600s + 二次 529 过载）。lead 逐次检查磁盘断点后接续，未盲目重试。**architect 第二次中断前已把 306 行调研笔记完整落盘** `docs/active/2026-07-29_github-benchmark_ARCH_NOTES.md`（13 节全、7 仓库全挖、含横向对比表）
- Round 52 调研核心结论: ① 「日百量级」有人真做到过（AIHawk 2843 份 @17/时），**代价三件全收**：封号 12 小时实录、点了按钮=成功、编造/随机答案；该项目已归档 ② **投递侧没有任何人做到过「广」**（最多 5 个 ATS）；唯一活得好的广覆盖（career-ops 65 源）全铺在**找岗侧**，靠「每平台一个小模块 + 统一契约 + 坏一个不连坐」③ 市场星数流向「找得广+帮得可信」不流向「点得狠」（62k 活 vs 30k 归档），但 architect 判「我们不退回不代点」——拍板人 n=1 真实需求压过大盘星数，且 ai-job-agent 证明「机器点+诚实失败态+默认 dry-run」可守红线 ④ **我们三处结构病三处都有人解过**，最值得抄：career-ops「文件为唯一正典、数据库为派生」教义，与已拍板的「切口选『什么算投出去了』」严丝合缝 ⑤ 通用表单识别（一套代码认所有 ATS）**没有幸存者证据** ⑥ 反面清单：不碰 LinkedIn、不许「点了按钮=成功」、不许全局一口价答案、选择器烂掉必须响
- Round 53: arnold-pm 基于 ARCH_NOTES 完成**完整实施方案** `docs/active/2026-07-29_master-plan_PRODUCT_SPEC.md`（325 行，边写边落盘）。**五阶段**：0 收尾（红测试变绿+push 消灭版本分叉）→ 1 「什么算投出去了」地基（唯一正典+统一退出码+全问答落盘+整页留证）→ 2 恢复投递（修 Lever 四处、预览=实投、日上限真执行、260 旧分重打；**45 天零投递结束**）→ 3 回音接上+爬坡 10→25→50/天 → 4 找岗侧 provider 契约铺广+投递侧 5 半成品转正、日处理 100 家
- Round 53 pm 直面「100/天 vs 20-30/天」: 把 20-30 从拍死上限改为爬坡一档，每档连续 3 批质量达标才升，**超 30 那档须拍板人亲自点头**（数字是他拍的只能他改）；「100」按「日处理 100 家」兑现——当前供给实测仅约 10 合适岗/天，硬凑 100 只能放水相关性关，那是死掉那几家走的路（Greenhouse 有按邮箱记的垃圾投递黑名单）。**100 的正确打开方式 = 先扩来源（阶段 4）**
- Round 53 pm 反驳两处（均附替代）: 日百字面兑现（给爬坡+供给扩张）、平台越多≠投递侧多写驱动（广度落找岗侧）。§4.8 写入知情项「要不要彻底不代点」判不退

**关卡 10 决策**：🩺 🔒 [用户] 拍板（2026-07-29）—— 三件全批：
① **五阶段顺序照做**（先把「投出去了没有」变成真话，再恢复投递、再提量、最后铺平台）；
② **爬坡照做**：10→25→50/天，每档连续 3 批质量达标才升，**超 30 那档须拍板人亲自点头**；「100」按「日处理 100 家」兑现；
③ **防拉黑规则采纳**：同一家公司 60 天内最多投 2 次。
注：阶段 0 的交付明写「把改好的东西推上 GitHub」，本次拍板即含该次推送的授权（lead 将在推送前再报一声，不另行等待）。

- Round 54: lead 建定稿 `docs/specs/master-plan.md`（五阶段 + 爬坡 + 防拉黑，只存结论）；派 arnold-builder 启动**阶段 0**——接续被中断两次的身份问答施工（5 条红测试转绿、两层接缝、visa_status 降级 ADR-12、连坐 C1-C14），完成并验收后推送
- Round 55: 阶段 0 施工在**连续 7 次基础设施中断**（断流卡住 × 4、连接中断 × 2、529 过载 × 1）下靠「小步提交」纪律完成**全部代码活**。6 个新提交：`165dc6f` 门改看「问过没问过」（ADR-11）→ `635c143` defer_to_user 独立类目 → `5f5b40d` visa_status 不打给雇主（ADR-12）→ `9dbfe79` 四处正则推断点不再拿自由文本猜答案 → `77ed7a7` visa_status 读点白名单守卫 → `264a7af` 引导说明书跟上 + 变更日志。**5 条红测试清零，244 → 257 全绿**
- Round 55 **lead 独立复验（代替 builder 跑长跑验证，builder 四次断在长跑上）**: ① tip `264a7af` 干净检出 CI 四步全绿（tests 257/257、role_guard_smoke 0、public_alpha_gate 0、node --check 全过）+ demo:check exit 0 ② **6 个提交逐个独立路径干净检出 npm test 全绿**（244→247→249→254→257 小步递增）
- Round 55 **lead 自查纠错**: 第一轮链上验证曾报「5 个中间提交各红 1 条」——复核发现是 lead 自己的检查脚本工作树建删打架造成的**误报**，专用路径逐个重跑全绿。差点冤枉 builder 回炉，记为教训：**验证工具自身也要先排除**
- Round 55 **文档欠账（显式挂账，不静默）**: BUILD.md 的阶段 0 章节（§85：ADR-12 删的 5 句原文对照、C1-C14 对账表、真实用户对照）**四次尝试均因断线未写成**。事实链在：提交信息 + lead 验证数字 + 本档案。**等基础设施稳定后由 builder 一次 Edit 补上**，不再重试烧钱
- Round 56: lead 派 arnold-verify 第 5 轮验收阶段 0（完全独立实测，施工记录缺失更不采信自述；已提醒 lead 误报教训——链上复核须用独立路径）。**verify 判「可推」前不推送**
- Round 57 **暂停记录（2026-07-30 凌晨）**: 基础设施一夜 10 次中断（断流卡住 / 连接中断 / 529 过载），builder 与 verify 均反复被杀。verify 第 5 轮已落盘章节骨架（VERIFY_REPORT `:2343`），验到 A1 门语义探针为止。**lead 按预算停止重试**，等基础设施稳定后续验
- Round 57 暂停时的现场快照: tip `264a7af`、本地领先 origin/main **26** 提交未推、工作区脏 3 文件（TASK.md 与 hook_hits 为 lead 改动；BUILD.md 仅 frontmatter 两行为 builder 遗留）、npm test **257/257 全绿**（lead 干净检出验过 + 链上 6 提交逐个验绿）
- Round 57 续跑清单（谁接手谁照办）: ① 续 verify 第 5 轮（从 A1 接，按「先最小证据链、每项落盘」的优先级）② verify 判「可推」→ lead 推送（拍板人已授权，推前知会）③ builder 补 BUILD §85（一次 Edit，60 行内）④ 推送后进阶段 1「数字变真」（方案见 `docs/specs/master-plan.md`） **持 F-1 但学校还没批下工作许可的学生，产品是永远拦着他，还是给一条别的路？** 这是产品取舍，工程定不了。verify 并建议把三个驱动「年满 18」无条件答 Yes 与 §10-C 的 ①③④ 一起排进 B2，否则引导里「问了满 18 岁」这半句**现在是纯负收益**
- Round 31 arnold-builder 完成 B0 + B1（3 个本地提交 `8eb581c` / `66882ab` / `5e4f76a`，未 push，`origin/main` 仍 `8f9e546`）: ① **B0 洞 2 修完**（守卫放宽成只认题面、`:1142` 无选择器也进 pending、去重键改题面），`ashby_apply_driver.mjs` **1170 → 1170 净增 0**；② **B0 附加**：动态 note 前缀规则落地，但**不是「前缀→类目」查表**（偏离 1，见 BUILD §52）——前缀只否掉唯一那条不看档案的结论 `agent_profile_backed`，类目仍由题面给、并统一过 `categoryAnswered`；`relocation_commitment_policy_unset` 进精确表；③ **B1 全做完**：新建 `shared/work_auth_identity.mjs`（纯函数，5 情形 × 4 字段 20 格全断言，行/分支/函数覆盖率均 100%），门在阻塞时同时给「卡在哪 / 三条查证去处 / 查到就能续上」并带 `asked_in_this_batch`（判据取自 `answer_provenance`，不是从 `visa_status` 非空猜），引导说明书 A0 改三个是非题、删掉「留 null 让门去问」那段、A2 加满 18 岁半句
- Round 31 证据: `npm test` **190 → 212 全绿**；CI 四步 × **链上三个提交**各自在 `git worktree --detach` 干净检出上跑（全 exit 0）；`demo:check` exit 0；`~/.mrweirdo-jobs/` 跑前跑后 stat 快照 7205 条**逐行零差异**
- Round 31 **唯一一处真实用户可见的行为改变，需 verify 重点复核**: 地点类目的「已答过吗」谓词从 `commitments 非空` 改成**按城市判**（偏离 2）。60 格新旧对照 **57 格逐字一致**，变的 3 格全在地点族——他答过 Bay Area/NY/US 却没答过 Denver，旧谓词让报告说「档案里有，别问用户」而驱动手里根本没这个值 = **行无声卡住**；改后变成问他一句。**代价：将来可能被多问一次没答过的城市**
- Round 31 builder 报的缺口（未自行扩范围）: ① **A2「满 18 岁」只加了问句、没有档案字段**——`legal_attestations.at_least_18` 属 DESIGN §10-C 第 ① 步（B2），拆开会留「有答案没人读」的中间态，故未做，说明书已写明在字段到位前只问不写档 ② note 路径分不出「拒答」档（他明确说不去的城市走 note 路径是 `agent_profile_backed` 而非 `system_profile_declined_location`），属批次 A 遗留、跨全表重构，已用测试钉住现状 ③ `no_value_rule_text:` 也是动态 note、同样不在表里，方向不危险（不会变成"从档案填"），建议 B2 一并评估
