---
Status: draft
Owner: arnold-architect
Type: audit
Reads: docs/active/2026-07-23_product-blueprint_TASK.md, docs/active/2026-07-23_product-blueprint_ARCH_AUDIT.md, docs/specs/project-cleanup.md, docs/specs/product-blueprint.md, docs/active/2026-07-22_project-cleanup_TASK.md, .claude/phase_schemas.yaml, .claude/file_size_limits.json, ~/.mrweirdo-jobs/（只读盘点）
Blocks: none
Updated: 2026-07-25
Iterations: 1
---

# 本机状态目录盘点 + 仓库卫生复核 — Mr. Weirdo Jobs

> 说明一：**本次零删除、零修改**。除本报告外没有动任何文件，状态目录与数据库全程只读，没有投出任何一条、没有提交任何表单。
> 说明二：`.claude/arnold/roles/architect.md`（架构师岗位补充说明）**不存在**（该目录下只有 `_README.md` / `builder.md` / `lead.md`），按骨架规定跳过、不报错。
> 说明三：有另一位成员正在并行改 5 个文件（onboard 主入口说明书、`answer_routing.mjs`、`greenhouse_apply_driver.mjs`、`profile.template.json`、`answer_routing` 测试）。凡结论依赖这 5 个文件的，我都显式标注了「依赖并行修复、不作为独立结论」。
> 说明四：判据按拍板人 2026-07-23 关卡 1 的定调 —— 不是「整不整齐」，而是**「这些乱会不会妨碍一个新用户装上并用起来」**。

---

# 第一部分 · 给拍板人（人话）

## 1. 你电脑上那个文件夹，一句话

**`~/.mrweirdo-jobs/` 一共 620 MB，其中 602 MB（97%）是 Chrome 自己的缓存垃圾，跟你的求职数据一点关系都没有。**
真正属于你的东西加起来不到 18 MB。剩下的乱，来自 5 月底到 7 月初那几轮"边跑边修"留下的临时文件，从来没人回来清过。

顶层一共 30 个条目，我按"还有没有用"分成四堆：

| 堆 | 数量 | 是什么 | 占地 |
|---|---:|---|---:|
| **活的**（现在的流程真在读写） | 15 | 你的档案、简历、数据库、日志、Chrome 会话、报告 | 约 615 MB（其中 602 MB 是 Chrome 缓存） |
| **历史残留**（某个已废弃流程留下的） | 9 | 4 份 5 月的交接笔记、3 个写死你电脑路径的旧脚本、1 个 7 月 4 号的仓库快照、1 个备份档案 | 约 5.8 MB |
| **一次性产物**（跑完就没用了） | 3 | 6 月 10 号做演示视频的那套东西、一份营销草稿、一份档案的旧备份 | 约 95 KB |
| **说不清的** | 3 | `.env` 是空的、`locks/` 是空的、`repo` 是个指回你开发目录的快捷方式 | 0 B |

## 2. 有没有你的隐私？有，而且有几处没上锁

**先说结论：没有任何东西被上传到网上，全在你自己电脑里。但同一台电脑上的其他账号能直接读到其中一部分。**

系统里有一段代码专门给三份最敏感的档案上锁（只有你自己能读），它确实生效了：

| 上了锁的（权限 600，只有你能读） | 里面是什么 |
|---|---|
| `profile.json` | 姓名、邮箱、电话、家庭住址、LinkedIn/GitHub、学历、工作授权状态，**以及种族 / 性别 / 退伍军人身份 / 残障状况这四项人口统计学信息** |
| `search_intent.json` | 你的求职意向摘要 |
| `essay_profile.json` | 你的自我介绍原文、写作口吻、项目故事 |

**但下面这些同样含个人信息的，权限是 644（同机其他用户可读）：**

| 没上锁的 | 里面是什么 | 为什么会这样 |
|---|---|---|
| `resume.pdf` | 你的真实简历原件 | 5 月 25 日复制进来的；给简历上锁的代码是 6 月 12 日才加的 → **新用户今天装不会有这个问题，是你这台机器的历史遗留** |
| `cover_letter.pdf` | 你的求职信 | **全仓库没有任何一行代码给它上锁**，而且它是三个投递驱动的默认求职信 → **新用户也会是 644** |
| `log/screenshots/` 50 张截图 | 我打开其中一张核实过：**表单里的邮箱、电话是明文可见的** | 这是免责声明主动宣传的"投递留证"功能，但从没上过锁 |
| `materials/cover_letters/` 38 份 | 每一份都写着你的真名 | 同上 |
| `BUGS-from-onboard-run.md` | 文件第 4 行就写着你的**真名 + 学校 + 签证状态** | 5 月 25 日某次调试留下的笔记，不是产品文件 |
| `jobs.db` / `feedback.jsonl` / `essay_pending.jsonl` | 950 个岗位、292 条投递记录、99 条待答开放题 | 里面没检出你的姓名邮箱，但记录了你投过谁、被拒在哪一步 |

还有一处值得知道：那个 602 MB 的 Chrome 文件夹里存着 **244 个网站的登录凭据（cookie）**，包括 LinkedIn、Lever、Okta。**保存的密码是 0 条**，浏览历史 481 条里 95% 是招聘网站（只有 8 条是小红书）。所以它本身不算脏，但它等于"一串已登录的钥匙"——删了要重新登录一遍。

## 3. 一个新用户装完，这个文件夹会长成什么样

**安装脚本只建 6 样东西**：代码目录、`log/`、`chrome-profile/`、`generated_materials/`、一个空的 `.env`、一个首次运行标记。**其余 24 样全是后面跑流程时一点点长出来的。**

**装完立刻会缺、而且缺了会让功能悄悄失效的，有两个：**

1. **大公司名额保护名单（`company_list.user.json`）** —— 已知问题，这次复核确认没变：安装脚本不生成它，找不到就返回空名单，于是免责声明承诺的"约 25 家大公司默认跳过"**默认状态下一家都不保护**。
2. **配额计数账本（`quota.jsonl`）** —— 这次新发现的连带效应：它和上面那份名单是一套的。名单空 → 配额上限恒为空 → 这个账本永远算不出"还剩几个名额"。**等于整个配额体系是一副空架子，不是某一个文件缺失，是两个零件都不在。**

另外还有一个"不会崩、但没人告诉你"的：`cover_letter.pdf`。三个投递驱动都把它当默认求职信，但**README、免责声明、架构文档、安装脚本、主入口说明书里一个字都没提过它**。你自己 6 月 9 日手动放了一份进去，新用户不会知道有这回事。

**还有一个纯体积问题**：这个目录**没有任何清理机制**。报告已经攒到 100 个文件（2.8 MB）、截图 50 张（7.4 MB）、三个只增不减的流水账。跑了三周就这样，没人算过跑一年会多大。

## 4. 仓库那边：没有回潮，但线上落后于本地

**7 月 22 号那轮规整的成果完好**，我逐项复核过：

- 死代码隔离区 `_unwired/` 六个文件 + 说明书都在，没人偷偷往外挪；
- 7 月 22 号之后**一行业务代码都没提交过**，只有文档；
- 文档三线制（现行 / 过程 / 退役）结构没被破坏。

**但有一件事你可能不知道**：这两天小队产出的 13 份文档 + 2 处修改**全部还没提交、更没推到 GitHub**。也就是说——**如果你现在打开 GitHub 看这个仓库，它停留在 7 月 22 号，本轮所有盘点结论线上都看不到。** 如果你说的"GitHub 仓库很乱"指的是线上那份，那问题不是乱，是**旧**。

**从"新用户能不能用起来"的角度，仓库还缺三样**（主入口崩溃已在并行修，不重复报）：

1. **状态目录零说明。** README 只有一句"你的私人数据存在 `~/.mrweirdo-jobs/`"，架构文档列了 12 个文件，实际会长出 30 个——其中 8 个活文件**从没在任何文档里出现过**；反过来架构文档列的 2 个文件（配额账本、公司名单）**根本从来不会被创建**。用户打开这个文件夹，看到的东西跟文档对不上。
2. **README 让新用户 `cd ~/.mrweirdo-jobs/repo` 跑维护命令** —— 在**你自己这台机器上**，那是一个指向你开发目录的快捷方式。也就是说你哪天重跑一次安装命令，脚本会试着直接对你的开发工作区做代码更新（目前因为你有未提交的改动而被跳过了，属于运气好）。
3. **安装脚本的欢迎语仍在承诺两件已经不存在的事**（要"自我介绍"、要"确认解析结果"）——上一轮报告已列（B6/B11），本轮复核仍然成立，没被修掉。

## 5. 我的建议（只提议，一个字都没执行）

**可以放心删的（约 5.9 MB，删了什么都不影响）**：4 份 5 月的调试笔记、3 个写死你电脑路径的旧脚本、7 月 4 号那份仓库快照 + 补丁文件（我逐一验证过：那 14 个提交全部已在主线，补丁里的功能标识符也全部能在现行代码里找到，**没有任何未落地的工作会丢**）、6 月 10 号的演示素材、一份 6 月 14 日的档案旧备份。

**建议先备份再删的**：`archive-repo-20260704/state-backup-20260525/` 里那份 5 月 25 日的旧档案（它比现行版少了一半字段，但如果你想追溯"我当初填的是什么"，它是唯一一份）。

**不建议删的**：602 MB 的 Chrome 目录（删了要重登所有招聘网站；真嫌大可以只删缓存子目录，能回收约 175 MB 而不丢登录状态）、数据库、三份档案、报告与截图（截图是免责声明承诺的留证）。

**建议改的两处权限**：给 `cover_letter.pdf`、截图目录、求职信目录上锁（这是代码要改，不是手动 `chmod` 一次了事——否则下一份新文件又是 644）。

**建议安装脚本补的三件事**：生成默认大公司名单（兑现免责声明）、生成一份带注释的空配额账本、在状态目录里放一份 `README` 说明每个文件是干什么的（新用户打开这个文件夹时至少不发懵）。

---

# 第二部分 · 给技术

## 1. 逐文件归属表（顶层 30 项，全部实测）

判定口径：**活** = 现行代码路径有读或写；**残** = 历史流程遗留，现行代码零引用；**一次性** = 特定活动产物，事后无消费方；**来源不明** = 无法定位产生方。
"生产方 / 消费方" 均为 grep 实证（排除 `node_modules` / `.git` / `docs/archive` / `CHANGELOG`）。

| # | 路径 | 权限 | 大小 | 最后修改 | 生产方 | 消费方 | 判定 |
|---:|---|---:|---:|---|---|---|---|
| 1 | `profile.json` | 600 | 8 K | 06-14 16:58 | 主会话（onboard Step 2）写；`scripts/secure_profile_files.sh:6` 上锁 | `shared/paths.mjs:37,50` 全链路 | **活 · 核心** |
| 2 | `profile.json.bak.20260614` | 600 | 8 K | 06-14 16:19 | 无代码生产（人手备份） | 零消费 | 一次性 |
| 3 | `search_intent.json` | 600 | 8 K | 06-08 11:23 | 主会话写 | `auto_apply_queue.mjs:22`、`queue_diagnostics.mjs:19`、`recompute_auto_apply_eligibility.mjs:17`、`discover_candidates.mjs` | **活 · 核心** |
| 4 | `essay_profile.json` | 600 | 28 K | 05-28 21:12 | 主会话写 | `mrweirdo-materials` 技能、`cover_letter_materials.mjs` | **活** |
| 5 | `resume.pdf` | **644** | 116 K | 05-25 21:38 | `scripts/intake_resume.sh:20` | `supervisor_preflight.mjs:85`、三个驱动、`doctor.mjs:317` | **活 · 权限异常**（见 §2） |
| 6 | `cover_letter.pdf` | **644** | 32 K | 06-09 22:29 | **无代码生产（人手放入）** | `greenhouse_apply_driver.mjs:48`、`ashby_apply_driver.mjs:64`、`lever_apply_driver.mjs:35` 的 `DEFAULT_COVER_LETTER` | **活 · 零文档 · 权限无人管** |
| 7 | `jobs.db` | 644 | 1.6 M | 06-20 21:42 | `store_scored_jobs.mjs` 等 | 全链路（jobs 950 行 / feedback 292 行） | **活 · 核心** |
| 8 | `feedback.jsonl` | 644 | 72 K | 06-14 17:29 | `shared/feedback.mjs` | `apply_gap_report.mjs`（126 行） | **活** |
| 9 | `essay_pending.jsonl` | 644 | 120 K | 06-14 17:28 | `ashby_apply_driver.mjs:51`、`greenhouse_apply_driver.mjs:54` | `ashby_apply_driver.mjs:969` 回填（99 行） | **活** |
| 10 | `daily_count.jsonl` | 644 | 24 K | 06-14 17:26 | `apply_batch.mjs:374` | **零消费方**（139 行） | **活（只写不读）** — ARCH_AUDIT B7 |
| 11 | `source_cursor.json` | 644 | 4 K | 06-20 20:47 | `discover_candidates.mjs:389` | 同处 | **活** |
| 12 | `cdp_host` | 600 | <4 K | 06-20 20:25 | `chrome-cdp-launcher.sh:15,28,88` | `cdp.mjs:15`、`supervisor_preflight.mjs:37`、`doctor.mjs:61`、`greenhouse_apply_driver.mjs:89` | **活** |
| 13 | `chrome-profile/` | 755 | **602 M** | 06-20 23:49 | `setup.sh:132` 建目录；`chrome-cdp-launcher.sh:14` 使用 | Chrome 本体 | **活 · 体积异常**（见 §3） |
| 14 | `log/` | 755 | 7.4 M | 05-25 22:12 | `setup.sh:132`；截图由各 `-auto` 技能写（如 `mrweirdo-greenhouse-auto/SKILL.md:139`） | 人工查阅；`DISCLAIMER.md:55` 承诺的留证 | **活 · 无轮转** |
| 15 | `reports/` | 755 | 2.8 M | 06-14 16:58 | `apply_report.mjs:30`、`queue_review_report.mjs:74`、`apply_capacity_plan.mjs:114`、`rescore_review.mjs:144`、`upskill_report.mjs:181`、`analyze_patterns.mjs:214`、`job_report.mjs:311`、`supervisor_status.mjs:66` | `supervisor_status.mjs:65 latestReport()` 只取最新一份 | **活 · 无轮转**（100 份，99 份永不再读） |
| 16 | `materials/` | 755 | 164 K | 06-14 15:35 | `cover_letter_materials.mjs:291,344` | `mrweirdo-materials/SKILL.md:20` | **活 · 未在架构文档登记** |
| 17 | `generated_materials/` | 755 | 8 K | 05-28 18:28 | `setup.sh:132` 建空目录 | **零代码消费**；内含 `gtm-drafts-2026-05-28.md`（营销草稿，含真名） | 目录活 / 内容一次性 |
| 18 | `locks/` | 755 | 0 B | 06-14 16:47 | `apply_batch.mjs:158-159` 建 `apply_batch.lock` | 同处（`:193` unlink） | **活 · 当前空 = 正常** |
| 19 | `.env` | 600 | 0 B | 05-25 20:01 | `setup.sh:133` | `paths.mjs:111 loadEnv()` | **活 · 当前空 = 无外部集成** |
| 20 | `repo` → `/Users/lee/Projects/mrweirdo-jobs` | symlink | — | 07-04 22:53 | 人手建（正常安装是 `setup.sh:65` 的真实 clone） | `README.md:57,64` 引导用户 `cd` 进来 | **活 · 本机特有拓扑**（见 §5.2） |
| 21 | `BUGS-from-onboard-run.md` | 644 | 20 K | 05-25 22:25 | agent 手写（首跑 bug 清单） | 零引用 | **残 · 含 PII** |
| 22 | `HANDOFF-continue-applications.md` | 644 | 8 K | 05-26 01:14 | agent 手写（会话交接） | 零引用 | **残** |
| 23 | `NEXT-SESSION-TODO.md` | 644 | 8 K | 05-26 16:05 | agent 手写 | 零引用 | **残** |
| 24 | `NEXT-SESSION-PUSH-TO-100.md` | 644 | 8 K | 05-28 20:01 | agent 手写 | 零引用 | **残** |
| 25 | `batch_apply.sh` | 755 | 4 K | 05-26 13:18 | agent 手写；**第 6 行硬编码 `REPO=/Users/lee/Projects/mrweirdo-jobs`** | 零引用 | **残 · 不可移植** |
| 26 | `directive_batch.sh` | 755 | 8 K | 05-26 15:06 | 同上（第 4 行同款硬编码） | 零引用 | **残 · 不可移植** |
| 27 | `essay_filler.sh` | 644 | 4 K | 05-26 15:05 | 同上（第 4 行同款硬编码） | 零引用 | **残 · 不可移植** |
| 28 | `demo/` | 755 | 80 K | 06-10 19:07 | 6-10 演示录制活动（12 个文件：runbook / 配音稿 / 隐私遮罩脚本 / 渲染脚本 / clean-assets） | 零引用 | **一次性** |
| 29 | `archive-repo-20260704/` | 755 | 5.7 M | 07-04 22:53 | 7-04 人手归档（含 14 提交的仓库快照 + 70 K 未合并补丁 + 5-25 状态备份 + 3 个演示脚本） | 零引用 | **残**（见 §4 的删除风险实证） |
| 30 | `archive-repo-20260722/` | 755 | 8 K | 07-22 21:38 | 7-22 规整拍板要求的删前备份（`docs/active/2026-07-22_project-cleanup_BUILD.md:76`） | 审计追溯 | **活（审计凭据）· 保留** |

**架构文档登记但磁盘上从不存在的 2 项**：`quota.jsonl`（`docs/ARCHITECTURE.md:37`）、`company_list.user.json`（`:38`）。二者是同一套配额体系的两个零件，**都没有生成方**。
**磁盘上存在但架构文档零登记的 8 项活文件**：`materials/`、`reports/`、`locks/`、`daily_count.jsonl`、`essay_pending.jsonl`、`cdp_host`、`cover_letter.pdf`、`.first_run`。

## 2. 权限与隐私矩阵（PII 落点）

上锁机制只有一处：`scripts/secure_profile_files.sh`（3 个文件白名单）+ `intake_resume.sh:21` + `chrome-cdp-launcher.sh` 的 `cdp_host` + `setup.sh` 的 `.env` / `.first_run`。**其余一律走系统默认 umask 022 → 644。**

| 载体 | 权限 | PII 内容（实证方式） | 风险 |
|---|---:|---|---|
| `profile.json` | 600 | `personal` 18 字段（含 `address_street/city/state/zip`、`phone`、`email`、`linkedin`）、`demographics` 5 字段（`race` / `hispanic_or_latino` / `gender` / `veteran_status` / `disability_status`）、`work_authorization`、`legal_attestations` — **只读键名，未打印取值** | 已上锁 ✅ |
| `resume.pdf` | **644** | 真实简历原件 | 同机他账号可读。**根因已定位**：`intake_resume.sh` 的 `chmod 600` 由 `983da60`（2026-06-12）引入，本文件是 05-25 落盘的 → **新装用户不受影响，仅本机历史遗留** |
| `cover_letter.pdf` | **644** | 真实求职信 | **全仓库零 chmod**，`grep -rn chmod` 只有 5 处、均不覆盖它 → **新用户同样是 644**，是现行缺陷不是历史遗留 |
| `log/screenshots/` 50 张 PNG | 644 | **实测**：我打开 `angi_20260526T042433_pre_submit.png` 核实——邮箱与电话在图中明文可见 | `DISCLAIMER.md:55` 把它当卖点宣传，但从未上锁 |
| `materials/cover_letters/` 38 份 HTML+PDF | 644 | `grep -l <真名>` 命中 **38/38** | 同上 |
| `BUGS-from-onboard-run.md` | 644 | 第 4 行明文：真名 · 学校 · 年级 · 签证类型 · 求职方向 | 非产品文件，纯残留 |
| `generated_materials/gtm-drafts-2026-05-28.md` | 644 | `grep -l <真名>` 命中 1/1 | 一次性营销草稿 |
| `archive-repo-20260704/state-backup-20260525/` | 内层 600 | 旧 `profile.json` + `resume.pdf` 副本 | 上锁正确 ✅ |
| `jobs.db` / `feedback.jsonl` / `essay_pending.jsonl` / `daily_count.jsonl` | 644 | 姓名邮箱 grep **零命中**；但含完整投递轨迹（投过谁 / 卡在哪 / 开放题作答） | 行为画像级敏感 |
| `chrome-profile/Default/` | 内层 600 | Cookies 244 条（`.linkedin.com` 6 / `.lever.co` 8 / `.okta.com` 12 …）、History 481 条（95% 招聘站，8 条小红书）、**Login Data 保存密码 0 条** | Chrome 自带 600，本体不脏；等价于一串已登录钥匙 |

**一条依赖并行修复的链条（不作为独立结论，请 builder 顺带确认）**：`secure_profile_files.sh` 是三份档案上 600 的**唯一**执行点，而它在主入口说明书里是以 `bash scripts/secure_profile_files.sh` 相对路径调用的（读取时刻观察到在 `SKILL.md:195`）。若 ARCH_AUDIT B1 的目录变量缺陷未修，该行在非仓库目录启动时会 `No such file or directory` → **新用户三份档案将停留在 644**。B1 修好后此链条自动解除。因该文件正被并行修改，此处只提示复验，不下结论。

## 3. 体积构成与保留策略（当前：零保留策略）

```
620 M  总计
├── 602 M  chrome-profile/            97%
│   ├── 427 M  Default/               （其中 Cookies 116 K / History 608 K = 真正有价值的部分）
│   ├──  48 M  optimization_guide_model_store/   Chrome ML 模型缓存
│   ├──  44 M  WasmTtsEngine/                    Chrome 语音引擎
│   ├──  34 M  component_crx_cache/              Chrome 组件缓存
│   ├──  22 M  Safe Browsing/
│   └──  ~27 M 其余 Chrome 内部缓存
├── 7.4 M  log/          （screenshots/ 50 张 PNG）
├── 5.7 M  archive-repo-20260704/
├── 2.8 M  reports/      （100 份，其中 99 份永不再读）
├── 1.6 M  jobs.db
└── < 1 M  其余全部
```

**全仓库 grep `unlinkSync|rmSync|rotate|maxAge` 结果**：唯一的删除动作是 `apply_batch.mjs:193` 删批次锁。**报告、截图、三个 jsonl 全部只增不减，没有任何轮转 / 上限 / 过期逻辑。** 三周产生 100 份报告 + 50 张截图 —— 这不是眼下的问题，但它是"给别人用"之前必须有答案的问题（新用户不会像你一样知道哪些能删）。

**Chrome 缓存可回收量实测**：`optimization_guide_model_store` + `WasmTtsEngine` + `component_crx_cache` + `Safe Browsing` ≈ 148 M，加上 `GraphiteDawnCache` / `OnDeviceHeadSuggestModel` / `CertificateRevocation` ≈ 175 M —— 全部是 Chrome 自建可再生缓存，删除不影响 `Default/` 里的登录态。

## 4. 清理建议清单（每条：路径 + 为什么 + 删错的风险 + 建议）

> **全部为建议，本次一条都没执行。** 风险列写的是"如果照做、最坏会失去什么"。

| # | 路径 | 为什么该动 | 删错的风险 | 建议 |
|---:|---|---|---|---|
| C1 | `BUGS-from-onboard-run.md` / `HANDOFF-continue-applications.md` / `NEXT-SESSION-TODO.md` / `NEXT-SESSION-PUSH-TO-100.md` | 5 月调试期的 agent 交接笔记，零代码引用；其中第一份含真名/学校/签证 | 失去 5 月首跑的 bug 现场记录 —— 但 ARCH_AUDIT 与 `docs/archive/` 已覆盖同期结论 | **移进 `docs/archive/`（若有史料价值）或删**。不建议原地留在状态目录 |
| C2 | `batch_apply.sh` / `directive_batch.sh` / `essay_filler.sh` | 5-26 手写一次性脚本，**均硬编码 `/Users/lee/Projects/mrweirdo-jobs`**，换台机器必挂；零引用 | 若还想手动跑批，得重写 —— 但现行 `apply_batch.mjs` 已完全覆盖其功能 | **删** |
| C3 | `demo/`（12 项） | 6-10 演示录制的一次性素材（runbook / 配音稿 / 渲染脚本 / 隐私遮罩） | 下次录演示要重做这套流程 | **移进仓库 `docs/archive/demo-kit/`（若还要录）或删**；不该留在用户状态目录 |
| C4 | `archive-repo-20260704/repo-snapshot-stale14commits/` + `unmerged-changes-20260610.patch` | 7-04 的仓库快照 + 未合并补丁，5.7 M。**已实证全部被主线吸收**：14 个提交 `git merge-base --is-ancestor` 逐个验证 = 全部 yes；补丁涉及 11 个文件，其特征标识符 `isSpecificCityLogisticsFact` / `mentionsConfirmedCity` / `fill_text_in_question` / `availableUntil` 在现行 `shared/` 与 `test/` 中**全部能找到** | **实证为零** —— 没有任何未落地的工作会丢 | **删** |
| C5 | `archive-repo-20260704/state-backup-20260525/`（含旧 `profile.json` 1.5 K + `resume.pdf` 副本） | 5-25 的状态快照，比现行档案少约一半字段 | **有风险**：它是"当初填了什么"的唯一留存 | **先另存一份再删**，或整体保留（仅 384 K，成本极低）。**不建议无脑删** |
| C6 | `archive-repo-20260704/` 其余（3 个演示脚本 + `tmp-from-repo/`） | 同 C3 性质 | 无 | **删** |
| C7 | `profile.json.bak.20260614` | 06-14 人手备份，无生产方无消费方 | 失去 6-14 那次改动前的档案 | **删**（现行档案已包含其全部字段的演进版） |
| C8 | `generated_materials/gtm-drafts-2026-05-28.md` | 一次性营销草稿，含真名，与求职流程无关 | 失去一份 GTM 草稿 | **移进仓库文档区或删**；目录本身要保留（`setup.sh:132` 会重建） |
| C9 | `reports/` 100 份 | 只有最新 1 份被 `supervisor_status.mjs:65` 读取，其余 99 份永不再读 | 失去历史投递批次的可视化留证（数据本体在 `jobs.db`，不丢） | **不删。改为加保留策略**（如只留最近 20 份 + 每月最后一份），由代码执行而非人手 |
| C10 | `log/screenshots/` 50 张 | 免责声明承诺的留证；含明文邮箱电话 | **删了等于撤回对外承诺的审计能力** | **不删。改权限 + 加保留策略**（见 C11 / C9） |
| C11 | `cover_letter.pdf` / `log/screenshots/` / `materials/cover_letters/` 权限 | 三处含 PII 却是 644，且**没有代码在管** | 无（只收紧不删除） | **扩展 `secure_profile_files.sh` 的覆盖面**，或在写入侧统一 chmod。手动 chmod 一次没用 —— 下一份新文件仍是 644 |
| C12 | `chrome-profile/` 的 Chrome 自建缓存子目录（约 175 M） | 纯可再生缓存，与登录态无关 | 下次启动 Chrome 会重新下载这些模型/组件（一次性网络开销） | **可清**，但优先级低。**`Default/` 绝对不能动**（244 条 cookie = 招聘站登录态） |
| C13 | `.env`（0 B）/ `locks/`（空） | 空 = 正常状态，非垃圾 | 删了 `.env` 会让 doctor 报 WARN | **保留** |

## 5. 安装脚本该补什么（`setup.sh` §6 现状 vs 应有）

**现状（`setup.sh:132-146`）只做 3 件事**：
```bash
mkdir -p "$MRWEIRDO_HOME"/log "$MRWEIRDO_HOME"/chrome-profile "$MRWEIRDO_HOME"/generated_materials
[ -f "$MRWEIRDO_HOME/.env" ] || (touch ... && chmod 600 ...)
[ ! -f profile.json ] && write .first_run (chmod 600)
```

### 5.1 建议新增（按"缺了会静默失效"排序）

| 优先 | 补什么 | 为什么 | 不做会怎样 |
|---|---|---|---|
| **P0** | 生成默认 `company_list.user.json`（约 25 家大公司 + 配额上限） | `paths.mjs:75-82` 找不到即返回 `{companies: []}`，`loadCompanyList()` 的注释明写"deliberately no bundled default" —— 但 `DISCLAIMER.md:53` 与 `README.md:104` 把它当**已生效**的缓解措施陈述 | 默认安装下 `apply_quota_limit` 恒为 null，护栏对任何公司不生效（= ARCH_AUDIT B5，本轮复核未变） |
| **P0** | 生成空 `quota.jsonl`（带 `_notes` 头） | 与上条同属一套配额体系；`shared/quota.mjs:14` 与 `mrweirdo-cherry-pick/SKILL.md:51` 都读它，读不到就当 0 | **新发现的连带效应**：即便补了公司名单，没有计数账本仍算不出剩余名额。**两个零件必须一起补** |
| **P1** | 写一份 `~/.mrweirdo-jobs/README.md`（每个文件干什么 / 哪些能删 / 敏感度标注） | 新用户打开这个目录会看到 20+ 个文件，无任何说明 | 用户不敢删也不敢碰 —— 这正是拍板人"folder 很乱"体感的直接来源 |
| **P1** | 把 `cover_letter.pdf` 写进安装引导（或删掉它作为默认值的地位） | 三个驱动的 `DEFAULT_COVER_LETTER` 指向它，但 README/DISCLAIMER/ARCHITECTURE/setup.sh/主入口说明书**零提及**（实测 grep 全空） | 用户永远不知道能放一份通用求职信；老用户（拍板人）放了但纯属自己知道 |
| **P2** | 把 chmod 覆盖面从 3 个 JSON 扩到全部 PII 载体 | `secure_profile_files.sh` 只锁 3 个 JSON；`cover_letter.pdf` / 截图 / 求职信全裸 | 多用户机器上同机他账号可读简历、求职信、含明文联系方式的截图 |
| **P2** | 报告 / 截图保留策略（代码级，不是文档建议） | 全仓库零轮转逻辑 | 状态目录无上限增长；三周 = 10 M，一年无人知道 |

### 5.2 一处安装拓扑隐患（本机特有，但值得记）

`setup.sh:21` 定义 `MRWEIRDO_REPO_ROOT="$MRWEIRDO_HOME/repo"`，`:63` 用 `[ ! -d "$MRWEIRDO_REPO_ROOT/.git" ]` 判断是否已装。**本机 `~/.mrweirdo-jobs/repo` 是指向 `/Users/lee/Projects/mrweirdo-jobs` 的符号链接**，`-d` 会跟随链接 → 脚本认定"已安装"，走 `:69` 的更新分支，**对开发工作区执行 `git fetch/pull`**。当前因 `git status --porcelain` 非空而被 `:70-73` 跳过（有本地改动就不动），属运气好而非设计保证。
同时 `README.md:57,64` 引导所有用户 `cd ~/.mrweirdo-jobs/repo` 跑 `npm run release:alpha` / `npm run demo:check` —— 在拍板人机器上这等于直接在开发目录跑。**建议**：`setup.sh` 增加一行符号链接检测，命中时打印"检测到开发模式安装，跳过自动更新"。

## 6. 仓库侧复核（轻量，逐项对照 7-22 成果）

| 复核项 | 7-22 定的规则 | 现状 | 判定 |
|---|---|---|---|
| 死代码隔离 | 代码只有两种状态：接线的 / 在 `_unwired/` 里 | `_unwired/` 6 模块 + README 完好；`_executors/` 仍是单文件目录 | **未回潮**。但 ARCH_AUDIT §1 指出的两个例外（`handshake_search.mjs` 未注册、`wellfound_search.mjs` 注册后被注释排除）**仍在**，本轮无变化 |
| 新增死代码 | — | 7-22 后**零业务代码提交**（10 个 commit 全是当轮清理本身 + 1 个 `_unwired` 路径修复） | **无新增** |
| 文档三线制 | 根 = 现行 / `active` = 过程 / `archive` = 退役 / `specs` = 定稿 | 四层结构完整；本轮 13 份新文档全部落位正确 | **未破坏** |
| 文件大小红线 | `.claude/file_size_limits.json` 只减不增 | 无代码提交 → 无变化 | **无违反** |
| 提交与同步 | — | **13 份未跟踪文档 + 2 处修改全部未提交**；`git log` 最新为 `6e31883`（7-22） | **⚠️ 线上落后**：GitHub 上看不到本轮任何盘点结论 |

**从"新用户能不能用起来"看仓库还缺的**（主入口崩溃在并行修，不重复）：

1. **状态目录文档与现实的双向漂移**：`docs/ARCHITECTURE.md:26-41` 的 File Layout 列 12 项 —— 其中 **2 项永不会被创建**（`quota.jsonl`、`company_list.user.json`），另有 **8 项活文件从未登记**（`materials/` `reports/` `locks/` `daily_count.jsonl` `essay_pending.jsonl` `cdp_host` `cover_letter.pdf` `.first_run`）。这是文档与代码在同一处同时向两个方向漂。
2. **`setup.sh:168` 欢迎语的两处过期承诺**（要"self-introduction"、要"Confirm the parsed profile"）**本轮复核仍在**，与 ARCH_AUDIT B6/B11 同源，未被修。
3. **安装尾屏 `setup.sh:189-198` 主动列 6 个平台命令**，与"入口/菜单永不出现平台命令"的验收条款（`docs/archive/PRD-onboarding-ux.md` §10）冲突 —— ARCH_AUDIT 已记，本轮确认未变。

## 7. Anything UNCLEAR（我不猜，需知情人补答）

1. **`log/screenshots/` 与 `reports/` 的保留期限该定多久？** 二者是免责声明承诺的留证（`DISCLAIMER.md:55`），删太狠会削弱对外承诺，不删则无上限增长。**这是产品与法务的取舍，不是工程能单方面定的。** 我给的技术选项：按份数（最近 N 份）、按时长（N 天）、或按投递状态（已确认的留、已失败的删）。
2. **`cover_letter.pdf` 到底是"产品功能"还是"你自己的临时办法"？** 三个驱动都依赖它，但零文档。若是功能 → 安装引导要补 + 要上锁；若是临时办法 → 应该从 `DEFAULT_COVER_LETTER` 里摘掉，统一走 D1 逐行生成。**两条路的工程量都不大，但方向相反。**
3. **`archive-repo-20260704/state-backup-20260525/` 的旧档案要不要留？** 我实证了它比现行版少约一半字段，但它是"5 月 25 日你当初填了什么"的唯一留存。删 = 省 384 K，留 = 保留追溯能力。**这是你的数据，我不替你决定。**
4. **`.env` 空文件是否意味着永久不接外部集成？** 它现在 0 B，`loadEnv()` 空转。若确定不再接 Notion / 第三方，`paths.mjs:131-155` 那三个零调用的 `notion*` 函数（ARCH_AUDIT B11 已列）可以一并清掉。
5. **多用户机器是不是要考虑的场景？** 本次列的所有 644 权限问题，只有在"同一台电脑有别人的账号"时才是真风险。如果目标用户全是自己电脑单人使用，那 C11 的优先级应该降。**这个前提我没有依据，不敢自己假定。**
6. **`shared/sourcing/_executors/` 单文件目录的意图** —— 沿用 7-22 的 UNCLEAR-7 与 ARCH_AUDIT 的第 3 问，**至今三轮无人作答**。

## 8. 讨论中辩驳过的方向（自我否决记录）

1. **「602 M 太大了，把 `chrome-profile/` 整个删掉」—— 否决。** 体积 97% 确实在这里，删了立刻清爽。但 `Default/` 里 244 条 cookie 是 LinkedIn / Lever / Okta 的登录态，删了下次投递要重新逐站登录，而"登录态在不在"正好是拍板人最怕的静默失败类型。改为只建议清可再生缓存（约 175 M），且标为低优先级。
2. **「历史残留一次性全删，一步到位」—— 否决。** C5 那份 5-25 状态备份是唯一的历史档案留存，C4 那份仓库快照我验证过可以安全删（14 提交全在主线 + 补丁标识符全部落地），但两者混在同一个父目录里。**一刀切会连带删掉唯一副本**，所以拆成两条独立建议、风险分别标注。
3. **「顺手把 644 的文件 chmod 一遍」—— 否决（作为解决方案）。** 手动 chmod 能立刻消掉当前风险，但下一次投递写出的新截图、新求职信仍是 644 —— 这是典型的"用兜底掩盖 bug"。真正的解法在写入侧或 `secure_profile_files.sh` 的覆盖面，属代码改动，不是本次盘点该执行的动作。
4. **「把状态目录整体重构成 `data/` `cache/` `logs/` 三层」—— 否决。** 结构上确实更干净，但 `paths.mjs` 的路径契约被 20 个技能说明 + 32 个测试文件写死，收益是"看起来整齐"，风险落在唯一能用的主链路上。与 7-22 对 `shared/` 平铺 69 文件的判断同理：**真正的"乱"不在结构，在于没文档 + 没保留策略 + 权限不一致**，这三样都能不动结构解决。
5. **「把本轮结论直接提交推上 GitHub」—— 否决（越界）。** 线上落后本地确实是事实，但推送是对外动作，7-22 那轮同类动作走的是关卡拍板（关卡 3）。我只报告，不代拍板人决定推什么。
