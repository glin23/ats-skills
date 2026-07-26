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
