# ats-skills v1.1 launch posts — drafts

> 不 commit 也行，但放 examples/ 留底。用户 改完后撕掉。

---

## 1. Twitter / X (English, dev-tool framing)

**Tone**: dev-tool announce, screenshot-driven. 3 tweet thread.

### Tweet 1 (hook)

```
Spent enough time copy-pasting the same name/email/visa answers
into 100 job applications that I built a Claude Code skill for it.

Open-sourced today: ats-skills v1.1
- AI sources from 250+ companies' public job boards
- Local SQLite dashboard (zero cloud)
- Fills the form, you click Submit

🧵
```

### Tweet 2 (mechanics)

```
The trick: hybrid Chrome DevTools Protocol + Computer Use vision fallback.

CDP fills 95% of fields (real keyboard events, isTrusted=true).
The other 5% — weird selectors, react-select v5 pickers — get
escalated to Sonnet via screenshot.

Zero npm deps. Node 24 + built-in node:sqlite.
Submits NEVER happen without your per-batch confirmation.
```

### Tweet 3 (CTA + link)

```
Install on macOS:

bash <(curl -fsSL https://raw.githubusercontent.com/glin23/ats-skills/main/setup.sh)

Then in Claude Code:  /ats-init

MIT licensed.  github.com/glin23/ats-skills

Built mostly with Claude Code itself — about 20k lines across two weeks.
```

**Image suggestions**: (a) Datasette UI screenshot showing v_ai_sourced view with fit_score column, (b) a terminal screenshot of the batch run output (the Step 5 dashboard with ✅ list).

---

## 2. LinkedIn (English, longer form, OSS announce)

**Tone**: lessons + audience = PMs / recruiters / founders. 200-250 words.

```
I open-sourced ats-skills v1.1 — a Claude Code skill bundle that
turns job-search into a single pipeline:

  AI sourcing → local SQLite dashboard → batch CDP form-fill → Gmail confirmation loop

Why build it: the actual painful part of applying isn't writing the resume
or the cover letter, it's the third pass of typing the same address,
phone, school, work-authorization yes/no into a slightly different form.

What I learned shipping this:

1. The submit button stays human. Submit is the consent gate; I never
   auto-click it. Every other step (navigation, form fill, screenshot)
   the skill does for you, then hands the page back.

2. Per-company opt-in beats LinkedIn-style aggregators. The repo ships
   a 250-company seed list across Greenhouse / Ashby / Lever / SmartRecruiters
   / iCIMS / JobVite. Sourcing is via each ATS's public board API, not scraping.

3. Zero cloud DB. v1.0 used Notion. v1.1 switched to local SQLite +
   optional Datasette web UI. Lower friction (no integration token,
   no parent page, no view setup), better privacy.

MIT license. Install in one curl-piped command:

https://github.com/glin23/ats-skills

Open to PRs, especially helper fixes when an ATS changes their DOM.
```

**Image suggestions**: same as Twitter — Datasette UI screenshot or pipeline diagram from README.

---

## 3. 小红书 (中文，等 user uses xhs MCP 搜爆款后 finalize)

**记得先走 dbs 流程**：用 xhs MCP `search_feeds` 搜 2-3 个关键词（如「AI 找实习」「Claude Code 自动投简历」「自动投递工具」），学结构不抄文字。然后用 dbs-xhs-title 工具挑标题公式。

下面是 framework 草稿 (~600 字，符合 ≤1000 char 限)：

### 候选标题（≤20 char）
- 「我把投简历全自动了 开源 demo 在这」
- 「投 100 家实习的工具我开源了」
- 「Claude Code 自动投实习 我刚开源」
- 「实习季手投太累 写了个工具开源了」

（最终要走 dbs-xhs-title 公式匹配 + 搜竞品决定）

### Body 草稿

```
实习季每次填到第 50 家就开始疯：

姓名 邮箱 学校 LinkedIn visa Y/N 工作授权 Y/N

填完一家忘了下一家又是新一套 UI

最后写了一个 Claude Code 工具自动做这件事

GitHub 搜 ats-skills（链接放 profile）

----
能做的事:

1. AI 从 250+ 公司的公开招聘 board 拉新岗位
   Greenhouse / Ashby / Lever / SmartRecruiters / iCIMS / JobVite 全打通

2. 用 Sonnet 给每个岗位打 6 维度分数
   role_fit / skills / location / visa / seniority / exclude_check
   ~$0.003 / job

3. 你在本地 SQLite dashboard 看（Datasette 一行命令起 web UI）
   approve 的岗位进队列

4. 一句 /ats-skills 触发 batch
   工具自动开浏览器 → 导航 → 填字段 → 上传简历 → 截图
   你看截图点 Submit（永远不自动 submit）

5. 投完 Gmail 自动 label 的 confirmation 邮件
   自动 mark 进度

----
关键设计:

- 零 cloud DB（所有数据在你本地 SQLite）
- 零 npm deps（Node 24 + node:sqlite + fetch built-in）
- Submit 必须人工授权（一次 batch authorization 不绕 classifier）
- 大公司限投自动跳过 (Google/Meta 等配额保护)
- MIT license

整个工具我用 Claude Code 自己 vibe code 两周
约 20k 行代码 / 12 个 skill / 100% 中文 + 英文注释

#ai #claudecode #自动化 #开源
```

**Image suggestions**:
- 9 张图卡片：
  1. 标题封面（标 v1.1 / 开源 / Claude Code）
  2. 痛点对比（手投 10 小时 vs 自动 2 小时）
  3. Datasette UI 截图
  4. AI 评分输出截图
  5. Batch report 截图（Step 5 dashboard）
  6. 流程图（README 里那个 ASCII pipeline 转成可读图）
  7. CDP + Computer Use 架构图
  8. GitHub repo 截图（star/fork count if any）
  9. install 一行命令 + /ats-init

可以用 baoyu-image-cards skill 出图。

---

## 发布顺序建议

1. 先 X（最快，10 min 草稿 + 截图）— 测试 dev community 反应
2. 24h 后 LinkedIn — 拉 OSS / PM 圈层
3. 48h 后 XHS — 走完整 dbs 流程（搜爆款 + dbs-xhs-title 公式 + baoyu-image-cards 出图）

平台间错开 24h+ 避免 cross-pollination 看着像 spam。

每个平台都附 `github.com/glin23/ats-skills` 链接（XHS profile bio 放，正文不要长 URL）。
