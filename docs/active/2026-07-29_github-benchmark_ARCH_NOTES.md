---
Status: in_progress
Owner: arnold-architect
Type: benchmark_research
Reads: docs/specs/product-anatomy.md, docs/specs/learning-from-others.md, docs/specs/competitor-research.md, docs/active/2026-07-23_product-blueprint_TASK.md
Blocks: pm 实施方案
Updated: 2026-07-29
Iterations: 1
---

# GitHub 同类项目代码级调研（6 个仓库，只读，零执行）

> 读者：lead 与 pm。每条关键结论后面跟一句人话。所有仓库克隆在
> `/private/tmp/claude-501/…/scratchpad/benchmark-repos/`（只读研究，未执行任何一行别人的代码）。
> 星数 / 归档状态 / issue 数据取自 GitHub API，采集日 2026-07-29。

## 1. 调研对象与方法

| 仓库 | 星数 | 状态 | 为什么选它 |
|---|---|---|---|
| `santifer/career-ops` | **62,160** | 活跃（2026-04 创建，3.5 个月冲到 6 万星） | 与我们最同构：本地优先、跑在命令行 AI 里 |
| `feder-cr/Jobs_Applier_AI_Agent_AIHawk` | 30,065 | **已归档**（2026-05-17） | 赛道前旗舰，重点考古死因 |
| `PaulMcInnis/JobFunnel` | 2,174 | **已归档** | 归档说明明写死于反自动化 |
| `GodsScion/Auto_job_applier_linkedIn` | 2,635 | 活跃 | **还活着的**全自动投递器，「日百量级」唯一活样本 |
| `speedyapply/JobSpy` | 3,975 | 活跃 | 找岗侧（抓岗）平台覆盖的代表库 |
| `AkbarDevop/ai-job-agent` | 38 | 活跃（2026-03 创建） | 与我们几乎同一个产品：Claude Code 技能 + 5 个 ATS（招聘系统）驱动 + F-1 学生作者本人真投过 228+ 次 |

方法：`git clone --depth 1` 只读通读源码；AIHawk 最终版已把投递引擎整个删了，另克隆了归档前的
fork 快照 `pillow34/aihawk`（2024-10）考古投递引擎原貌；issue 区用 GitHub API 按评论数与关键词抽查。
**未执行任何克隆代码、未装依赖、未开浏览器、未真投。**

## 2. career-ops（62,160 星，与我们最同构，重点样本）

### 2.1 平台覆盖：65 个源，全部在「找岗侧」，投递侧覆盖为零（故意的）

- `providers/` 目录 **65 个平台模块**：greenhouse / ashby / lever / workday / icims / jobvite /
  smartrecruiters / successfactors / oraclecloud / workable / recruitee / personio / teamtailor /
  bamboohr / breezy…外加 remoteok、weworkremotely、hackernews 等聚合板。
- 怎么做到的：全走**雇主侧 ATS（招聘系统）的公开无鉴权 JSON 接口**，自称 zero-token（零模型花费）扫描。
  每个平台一个小模块，统一契约：默认导出 `{ id, fetch }`，`fetch` 返回归一化的 Job 数组
  （`providers/_types.js`：title/url 必填、url 当去重键）；`providers/_registry.mjs` 按字母序加载，
  **坏模块跳过不致命**。加一个平台 = 写一个几十行的小文件。
- **投递侧它一行自动化都不写**。`ARCHITECTURE.md` 原则区原文：*"Human-in-the-loop. The tool prepares
  and evaluates; the human reviews and clicks. It never submits applications on your behalf."*
- > 人话：赛道里平台覆盖最广的这家，广度全部铺在「帮你找」上，「替你点」它一个平台都不做——而且它是涨得最快的。

### 2.2 填表怎么填：AI 照说明书填，但「不许编」写成了字段级合同

- `modes/apply.md`（填表模式说明书）9 步工作流：识别页面 → 匹配已有评估报告 → **开工前双闸**
  （岗位还活着吗 + 公司/岗位对得上吗）→ **淘汰题预扫**（Step 5b：年限 / 学位 / 工作授权 / 期望薪资，
  预判「照档案答会被自动拒」就弹 `⚠️ KNOCK-OUT WARNING` 停下等用户）→ 逐题生成 → 用户复制粘贴 → 落档。
- 每道题带**字段合同**：`field_type / required / limit / options / needs_candidate_confirmation`。
  最后一项规定：法律 / 人口统计 / 工作授权 / 签证担保 / 薪资 / 残障 / 退伍军人 / 背调 / 搬迁 / 自我认同类问题，
  **除非答案明确写在 `config/profile.yml`，一律标「需用户确认」**。原文：*"Never invent answers for legal,
  demographic, work-authorization, visa/sponsorship, salary, disability, veteran, background-check,
  relocation, or self-identification fields."*
- > 人话：跟我们那条「绝不编造个人事实」红线一字不差,但它落成了每道题上的一个必填标记位，不是文档里的一句禁令。

### 2.3 「投出去了没有」怎么判：不判——人是传感器

- 人点提交，人declare状态。`application-answers.mjs:10` `VALID_STATES = ['filled','submitted']`，状态由用户走
  `set-status.mjs` 手动翻；每次真实状态变更**追加一行**进 `status-log.tsv`（append-only 转档账本，
  `set-status.mjs:42,391` 注释明写「tracker 管状态、账本管时间，账本永不原地改，改错补 correction 行」）。
- > 人话：它压根不碰我们最烂的那道题（机器判定「投没投出去」）——它把这道题让给了人，代价是一次也不替你点。

### 2.4 量与安全：不投递 = 没有封号面

扫描走公开接口无登录态，没有账号可封。issue 区前十条按评论数全是功能请求，第一名是 **#98「Token Usage」
（11 条评论，嫌模型花费高）**——它的最大用户抱怨是贵，不是坏。

### 2.5 最值得抄的五件（都有文件与 issue 编号）

1. **「文件为正典、数据库为派生」教义**（`ARCHITECTURE.md` 引 issue #918，定性为 settled doctrine）：
   `data/applications.md` 是唯一权威，SQLite 只是派生索引，**随时可删可重建**（`tracker.mjs sync`），
   并明说「永不允许第二个正典存储，哪怕 opt-in」。→ **正面解掉我们的结构病三（同一事实多份）**。
2. **系统层 / 用户层数据合同**（`DATA_CONTRACT.md`）：哪些文件属系统可自动更新、哪些属用户永不触碰，
   两张表逐文件列明，**用测试锁住**（`updater-migration-tests.mjs` 保证两层路径永不重叠）。
3. **verify-cv-facts.mjs：给模型产出加代码断言的现成范本**。生成的简历里每个「数字+可数名词」的声明
   （users/years/projects… 显式名词表）必须能在 `cv.md` 等来源文件里找到出处，找不到就红。
   → 与我们 personal_fact_gate 同构，且扩到了「散文里的数字」——正是我们第 19 处编造（作文渲染）那一类。
4. **golden 评测集**（`evals/README.md`）：说明书（提示词）驱动的打分行为，用 10 个冻结标签的金标准用例
   + 录制回放夹具（CI 零花费）测「换个模型/改个提示词后判断漂移了没有」。→ **解病二的另一半**：
   决策留在说明书里没关系，但说明书要有测试。
5. **回音闭环**：`reply-watch.mjs` + `reply-matcher.mjs`——**确定性**邮件→tracker 匹配（域名/角色词，
   带 high/medium/low 置信度），分类后**人批准**才翻状态。→ 我们「回音」块（confirmed_at 全 0）的现成参考形状。

### 2.6 烂在哪 / 风险

- 模型花费是第一抱怨（#98）；~70 个脚本平铺仓库根目录（#1386 论证过故意不整理，路径稳定性当特性）。
- 对拍板人诉求的坏消息：**它证明的是「不替人点」这条路能赢星**，没有回答「一键投递量越大越好」怎么做。

## 3. AIHawk（30,065 星，已归档 2026-05-17）：死因考古

### 3.1 平台与形态

只做 LinkedIn Easy Apply（一键投递入口），Selenium 模拟点击，靠 CSS class 选择器认页面
（`artdeco-button--primary` / `jobs-easy-apply-content` / `pb4`——fork 快照 `src/aihawk_easy_applier.py`）。
**归档前它自己把投递引擎删了**：现存 main.py 里 `ai_hawk.job_manager` 等 import 整段注释掉，README 明写
*"due to copyright considerations, we have removed all third-party provider plugins"*。
> 人话：它死前先把「替你点 LinkedIn」这块自己切了——法律压力是死因的一部分,不只是技术。

### 3.2 填表怎么填：**编造是写进提示词的产品设计，不是 bug**

- 每题先查本地问答缓存（answers.json），没有就问 GPT。数字题提示词原文
  （fork `src/strings.py:263-275`）：*"If experience with a specific technology is not explicitly stated…
  provide a plausible number of years… estimate a reasonable number of years for Java."*
  —— **明文指示模型给没写过的技术编一个「像样的」年限**。
- 模型输出解析失败时兜底 `default_experience = 3`（`src/llm/llm_manager.py:559-575`）——**解析不出来就答「3 年」**。
- 用户骂的正是这个：issue #532「Answers provided are incorrect」、#491、#485。媒体也点名
  （README 自己挂的 Business Insider 标题就带 "risks inaccuracies mistakes"）。
- > 人话：我们靠三轮修复在拆的那颗雷（缺值→默认值→替用户说谎），它是当引擎装上去的。

### 3.3 「投出去了没有」怎么判：点了按钮 = 成功

`_next_or_submit()`（fork `aihawk_easy_applier.py:283-297`）：找到文案含 "submit application" 的按钮 →
点击 → sleep → **return True**。没有任何提交后页面校验。错误检查只在「下一页」路径上做。
> 人话：它的「已投递」= 「我点过那个按钮」。比我们被取证抓包的那版（读页面找"成功"字样）还要低一档。

### 3.4 量与安全：量真做到过，代价全兑现了

- 量：TechCrunch 报道（README 自挂）一名记者用它投了 **2,843 份、每小时 17 份**。
- 节流全部是随机 sleep（1.5-5 秒/动作，每 5 页随机睡 5-34 秒，`aihawk_job_manager.py`），无日上限。
- 封号实录：issue **#160**——小号测试，**12 小时内被 LinkedIn 限制、要求交政府证件**（2024-08）;
  #81「Best way to get banned your account」、#16 同主题。
- **最大声的抱怨不是封号，是静默空转**：评论数第一的 issue **#919（67 条）「Not applying to jobs」**——
  程序开着、翻页、睡觉、循环,一份也没投出去;同形状的还有 #137 / #171 / #418 / #648 / #1000 / #513。
  这就是「选择器烂掉→整条链静默失败」的用户端长相。
- > 人话：日百量级有人真做到过——代价是 12 小时封号、答案编造、以及坏了不说话的机器人。三样它全占，然后归档。

### 3.5 与我们同形的一个 bug（值得单独记）

问答缓存复用判定（fork `aihawk_easy_applier.py:646`）：`if sanitize(question_text) in item['question']`
——**子串包含当身份判定**，正反不对称。与我们 label-key-binding 那份 BUG_REPORT 的根因
（「键的词连着出现在题面里」的包含关系不对称）是同一个病。它从没修，我们已裁决按整题面比对修。

## 4. JobFunnel（2,174 星，已归档）：一句话死因，官方原文

抓 Indeed / Monster / Glassdoor 的静态 HTML 出 CSV。归档说明（readme.md 顶部）原文：
*"most job boards have moved to much more aggressive anti-automation and bot-detection. Re-implementing
JobFunnel on top of full browser automation… is technically possible, but too slow, fragile, and
operationally complex."*
> 人话：**死的不是「抓岗位」这件事,是「抓聚合大站 HTML」这条路**。career-ops 和我们走的
> 雇主侧 ATS 公开 JSON 接口不在这条死路上——这是该庆幸也该守住的架构选择。

## 5. GodsScion/Auto_job_applier_linkedIn（2,635 星，活着的全自动投递器）

### 5.1 量：README 第 2 行自称 "Can apply 100+ jobs in less than 1 hour"

LinkedIn 单平台，Selenium + 可选 `undetected_chromedriver`（反检测驱动，`modules/open_chrome.py:20-21`）。
节流只有 `click_gap`（秒级）配置，无日上限。issue 区几乎没有封号帖（#92 问反爬政策，0 回复）,
**但满屏是「Chrome 一升级就坏」**（#90 / #38 / #79 / #55）与「bot 不投了」（#11 / #27）。
> 人话：活着的秘诀不是解了反自动化,是作者一直在追着 LinkedIn 改版修——这是一台跑步机,不是一条护城河。

### 5.2 填表怎么填：全局一口价答案 + 答不出就随机

- 答案是配置文件常量（`config/questions.py`）：`years_of_experience = "5"` **对所有年限题统一答 5**、
  `require_visa = "No"`、`us_citizenship` 一档选死（留空则不答，但注明有些表单必填）。
- 选项对不上时（`runAiBot.py:521`）日志原文 *"answering randomly!"*——**随机选一个**，
  同时把这道题记进 `randomly_answered_questions` 集合，**跑完在总结里整体打印**（`:1254`）。
- 有两道可选的人闸：`pause_at_failed_question`、`pause_before_submit`。
- > 人话：它对「编造」的态度是「编,但跑完告诉你编了哪些」——比 AIHawk 诚实半格,仍踩我们的红线。

### 5.3 「投出去了没有」怎么判：点击成功 = 已投；点不到就弹窗问人

`runAiBot.py:1088-1098`：点到 "Submit application" → 记 `date_applied`；点不到且开了提交前暂停 →
**pyautogui 弹窗问用户原文 "You submitted the application, didn't you 😒?"**——人肉传感器兜底；
都不行才计失败并丢弃。
### 5.4 值得抄的一件：字段级投递留痕

`submitted_jobs()`（`runAiBot.py:832-851`）每条已投记录**连同这次真实答了什么（questions_list）一起写进 CSV**。
> 人话：我们 Round 7 取证「180+ 条投递答了什么已不可考」的那个洞，这个 2,635 星的单人项目是默认就记的——
> 即我们排期里的 F6（字段级审计留痕），别人已实现，形状就是「每条投递带上全部问答落盘」。

## 6. JobSpy（3,975 星，活跃）：找岗侧的另一半地图

8 个板块（LinkedIn / Indeed / ZipRecruiter / Glassdoor / Google / Bayt / Naukri / BDJobs），
每板一模块 + 统一 pydantic JobPost 模型。Indeed 走内部 GraphQL 接口（`jobspy/indeed/constant.py`），
README:179 自评 *"Indeed is the best scraper currently with no rate limiting"*；
README:181 *"LinkedIn is the most restrictive and usually rate limits around the 10th page with one ip.
Proxies are a must basically"*；FAQ（:208）*"All of the job board sites are aggressive with blocking."*
> 人话：连**只读抓岗**这件事，碰聚合大站都得上代理池；雇主侧 ATS 接口则不设防。
> 「平台越多」在找岗侧的分界线不是技术,是「你抓的是谁家的门」。

## 7. ai-job-agent（38 星，单人项目，与我们几乎同一个产品）

作者 = 密苏里大学 F-1 本科生（与我们的目标用户画像重合），Claude Code 原生：13 个技能 + 5 个 ATS 驱动
（LinkedIn / Greenhouse / Lever / Jobvite / Ashby），自述真投 228+ 份、CAPTCHA（人机验证）如实记 blocked。

### 7.1 驱动瘦、变量外置

5 个驱动 229-705 行（我们 Greenhouse 一个 1,914 行）。瘦的原因：**每次投递的可变部分（哪个字段填什么）
外置成 per-job 配置 JSON**，驱动只做机械执行；URL 按域名路由（`skills/job-apply/SKILL.md` 路由表）。

### 7.2 红线写法与我们同源，但它多一层「合同」

`CLAUDE.md:152-156` 原则原文：*"Truthfulness first: Prefer truthful, submittable applications over
aggressive volume"*；*"Work authorization: Skip hard citizen/green-card gated roles unless the form
provides a truthful path for the candidate's actual status"*；*"Captcha honesty: log it as 'blocked' —
never inflate submitted counts."*
**默认 dry-run（试跑不提交），`--submit` 显式开**；技能说明书明写 autoSubmit 标志
*"do not silently flip it without confirming"*——连 AI 都不许悄悄替用户打开自动提交。

### 7.3 「投出去了没有」：同样读页面文案，但有两处比我们强

`scripts/greenhouse-apply.js:141-160` `monitorSubmission()`：轮询页面文本正则
`/application submitted|thank you|your application has been submitted|we have received your application/i`
+ 检测 CAPTCHA iframe。**与我们同一档的字面判定**，但：
1. **五个驱动统一退出码合同**：0=提交成功 / 1=崩溃 / 2=卡在答不出的必填题 / 3=CAPTCHA 或超时 / 4=步数超限,
   全部输出结构化 JSON——**没有任何路径默认成功**；
2. 「blocked」「captcha」是一等公民状态，不是失败的遮羞布。
> 人话：机器判定「投没投出去」这道题他也没真解掉（还是认页面上的字），但他保证了**判不出时绝不谎报成功**——
> 这正是我们 6 张 `ashby_success` 截图写着「没能提交」那个事故的反面。

### 7.4 回音块：他闭环了

`outlook-triage.js` 读邮箱 → 确认/面试/拒信三分类 → `/job-status` 翻 tracker 行 → `/job-patterns` 月度诊断。
tracker CSV 为唯一正典，markdown 是派生镜像（`CLAUDE.md:64-66` 明写 source of truth 归属）。
> 人话：我们八大块里唯一「压根没跑起来过」的回音块，这个 38 星单人项目用「邮箱三分类 + 人工确认翻状态」闭上了。

## 8. 横向对比（一张表）

| | career-ops | AIHawk | JobFunnel | GodsScion | JobSpy | ai-job-agent | **我们** |
|---|---|---|---|---|---|---|---|
| 星数/状态 | 62,160 活 | 30,065 **归档** | 2,174 **归档** | 2,635 活 | 3,975 活 | 38 活 | — |
| 找岗侧覆盖 | **65 源**（公开 ATS 接口） | 1（LinkedIn） | 3（聚合站 HTML，死） | 1 | 8（聚合站，需代理） | 借 LinkedIn 搜索 | 9 源（公开 ATS 接口 + 板块） |
| 投递侧覆盖 | **0（故意）** | 1 | 0 | 1 | 0 | 5 | 3 全 + 5 半 |
| 谁点提交 | 人 | 机器 | — | 机器（可选人闸） | — | 机器（默认 dry-run） | 机器（有队列关卡） |
| 「投出去了」判定 | 人 declare | **点了按钮=成功** | — | 点击成功=成功，兜底**弹窗问人** | — | 页面文案+**统一退出码，判不出不谎报** | 页面文案，曾把失败标成功 |
| 编造防线 | 字段合同+代码断言 | **提示词明令编造** | — | 一口价答案+随机兜底（但披露） | — | 红线写进 CLAUDE.md+dry-run 默认 | 三轮修复进行中 |
| 字段级留痕 | 答案落报告 | 问答缓存（复用用） | — | **每投递全问答进 CSV** | — | tracker+JSON 输出 | 无（F6 排期中） |
| 回音闭环 | 邮件确定性匹配+人批准 | 无 | — | 无 | — | **邮箱三分类闭环** | confirmed_at 全 0 |
| 封号证据 | 无面 | **12 小时（#160）** | 站方封杀（归档文） | issue 区无实锤 | LinkedIn 10 页限流 | 无报告 | 不碰 LinkedIn，无面 |

## 9. 拍板人核心诉求的答案：「平台越多、量越大」别人怎么做的、代价是什么

1. **平台覆盖最广的（career-ops，65 个）全部铺在找岗侧,靠三件套做到**：公开无鉴权接口（不设防、无封号面）
   + 每平台一个统一契约的小模块 + 坏一个不连坐的注册表。**投递侧没有任何人做到过「广」**：
   最多的是 ai-job-agent 的 5 个（与我们相同的一批 ATS），全自动老牌们都只有 LinkedIn 1 个。
2. **「日百量级」有人真做到过**（AIHawk 2,843 份 @17/小时；GodsScion 自称 100+/小时），**代价三件全收**：
   ① 封号（12 小时实录）② 假成功（点了按钮就算数）③ 投错（编造答案/随机答案）。做到量的两家,
   一家已归档,一家活在每次 Chrome/LinkedIn 改版的维修跑步机上。
3. **市场投票很直白**：不替人点的（62k 星,3.5 个月）> 替人点的旗舰（30k 星,归档）。
   星数流向「找得广 + 帮得可信」，不流向「点得狠」。
4. **对我们的推论（多写驱动还是换架构）**：**广度铺在找岗侧（照 career-ops 的 provider 契约把 9 源做成
   可按周加的插件层）；投递侧不追广、按 ATS 家族收敛做深**（我们存量 88% 在 Greenhouse——先把 3 个家族的
   「真投出去了」做到可信，比加第 6 个驱动值钱）。量的上限不由驱动数决定,由「判定可信 + 不编造」决定——
   这两样不解决,量越大 = 假成功和错答案越多。

## 10. 我们的三处结构病，别人解了几处、怎么解的

**结论：三处都有人解过,没有一家是靠「更聪明的字符串匹配」解的。**

- **病一（判定靠字面、规则链无守护）**：AIHawk 把同一个病带进棺材（子串包含判缓存复用,见 §3.5）。
  career-ops 的解法是**收窄用途 + 人批准**：确定性匹配只用于低风险场景（邮件归属），带置信度分层,
  翻状态前人过目；事实攸关处不用匹配,用**代码断言对出处**（verify-cv-facts）。
  → 佐证 lead 已裁决的方向（整题面比对 + 键带元信息），并提示：匹配结果动状态前设「人批准」一闸。
- **病二（决策在说明书、代码只事后查）**：career-ops **不搬回代码,而是治理说明书**——说明书是版本化的
  系统层资产（数据合同管辖、更新器统一发版），行为用金标准评测集钉住,产出用代码断言兜底。
  → 与我们「给模型产出加代码断言」的既定路线同向,补上我们缺的一块：**给打分/分类说明书配 golden 评测**。
- **病三（同一事实多份、谁也不是权威）**：career-ops 用**教义 + 测试**解：文件唯一正典、数据库明文降级为
  「可删可重建的派生索引」、状态变更走 append-only 账本、层边界有迁移测试守。ai-job-agent 小一号同形
  （CSV 正典、markdown 派生镜像）。→ 我们「三个数字三处三个样」的病,方子是现成的:
  **指定唯一正典 + 其余全部标成派生并给出重建命令 + 转档只走追加账本**。

## 11. 对我们的方案意味着什么（给 pm 写实施方案用）

1. **最值得抄的一条：career-ops 的「文件为正典、数据库为派生」教义（issue #918）**。
   直接治病三——先拍「什么算投出去了」的唯一正典放哪，其余数字全部改为派生 + 可重建。
   这与已拍板的「只修一处，切口选『什么算投出去了』」严丝合缝，等于给那个切口一个业内已验证的落法。
2. **判定「投出去了没有」没有银弹，但有底线合同**：抄 ai-job-agent 的五驱动统一退出码
   （提交成功 / 崩溃 / 卡必填 / CAPTCHA / 超限，无路径默认成功）+ 抄 GodsScion 的「每条投递带全问答落盘」
   （= 我们的 F6）+ 我们 B3 已定的「读页面文案、读不出写 unknown」。三件合起来就是「诚实的投递留证」。
3. **编造防线的业内最佳形状是三层**：字段合同（career-ops 的 needs_candidate_confirmation 标记位）
   + 出处断言（verify-cv-facts 式，含散文里的数字——覆盖我们第 19 处那类）+ 默认 dry-run、显式开投
   （ai-job-agent）。我们批次 A/B 已建前两层的雏形，第三层（dry-run 做成用户看得见的默认档）与 pm
   「先看看」的诊断（蓝图第五节）互相印证。
4. **回音块启动别自研判定**：照 career-ops（确定性匹配 + 置信度 + 人批准翻状态）或 ai-job-agent
   （邮箱三分类 + 人确认）起步，先把 confirmed_at 从 0 变成有数,再谈自动化。
5. **找岗侧广度是安全的增长面**：把 `shared/sourcing/` 的 9 个源整成 career-ops 式 provider 契约
   （统一导出 + 归一化岗位 + 坏源不连坐），此后「平台越多」按周加源,不碰投递风险。
6. **投递侧的反面清单**（别人用尸体标好的雷）：不碰 LinkedIn（AIHawk #160 十二小时封号）；
   不许任何「点了按钮 = 成功」路径；不许全局一口价答案；选择器烂掉必须响（AIHawk #919 六十七条评论
   骂的就是静默空转）——我们主链路的冒烟检查应加「驱动找不到关键元素时显式报错而非跳过」这条断言。

## 12. 讨论中辩驳过的方向

- **「照 GodsScion 上 undetected_chromedriver（反检测驱动）把量做上去」——否**。它活着靠的是维修跑步机
  不是反检测（issue 区全是改版即坏）；且我们不碰 LinkedIn,最大封号面本来就不存在,上反检测是给自己
  买一个不需要的军备竞赛。
- **「投递侧也照 career-ops 砍成 0、彻底不替用户点」——否（但值得端给拍板人知情）**。市场信号确实指向
  不点的赢星,但拍板人的目标是「他自己本地用得好、不想自己动手投」,n=1 的真实需求压过大盘星数;
  且 ai-job-agent 证明「机器点 + 诚实失败态 + 默认 dry-run」是可守红线的中间形态。
- **「平台覆盖靠通用表单识别（一套代码认所有 ATS）」——否**。六个仓库没有一家做成通用识别;
  唯一活得好的广覆盖（career-ops 65 源）恰恰是「每平台一个小驱动 + 统一契约」。通用识别在这个赛道
  没有幸存者证据。

## 13. Anything UNCLEAR（未明点，如实）

1. career-ops 62k 星里有多少是真用户（星数≠跑起来的人数,我们自己的定稿早有此戒）——**判不了**,
   它 issue 里有 "i-got-hired" 模板但我没统计填报量。
2. ai-job-agent 的 228+ 真投与「2/8 LinkedIn 触达接受」全部是作者自述（README），无第三方佐证。
3. AIHawk 投递引擎考古基于 2024-10 的 fork 快照,与被删除前的最终版可能有出入（删除发生在快照之后,
   核心机制方向一致但行号可能漂移）。
4. AIHawk 归档的直接导火索（法律函/自愿/商业转型 laboro.co）只有间接证据（README 措辞 + 推广痕迹）,
   没有当事方声明原文。
5. issue 考古是按评论数与关键词抽查,不是全量读——「最多人骂」的排序可信,长尾里可能还有没浮出的坑。
