---
name: mrweirdo-onboard
description: Main entry skill for Mr. Weirdo Jobs after install. Trigger for first-run setup, resume intake, optional self-introduction intake, student job/internship discovery, scoring, guarded queue preview, and explicit-gated auto-apply. Uses one intake prompt, one hard-boundary AskUserQuestion call, a soft parse correction window, and one queue gate before any real submissions. Do NOT trigger for a single URL/manual application; route those internally to the dedicated ATS skill.
---

# Mr. Weirdo Jobs Onboard

This is the main local skill after install. Every run belongs to the person
running the skill; all state stays on this machine.

State defaults and run artifacts are in `references/run-and-database.md`. The
flow is: intake -> parse soft window -> discovery/scoring -> queue gate ->
guarded apply -> missing-info retry -> report/prune. The only hard business
confirmation before spending applications is the queue gate in Step 5.

## Trigger

Use this skill when:

- first-run sentinel `~/.mrweirdo-jobs/.first_run` exists and the user asks how
  to start, says "start", "next step", "找实习", "投实习", or similar;
- user explicitly invokes `/mrweirdo-onboard` or `/mrweirdo-jobskill`;
- user wants the end-to-end resume-driven discovery + scoring + guarded batch
  apply loop.

When invoked with no concrete request yet, show a single AskUserQuestion main
menu with exactly these five choices and no slash commands:

1. `开始找实习 / Onboard` (recommended): continue directly into the full
   onboard flow, starting at Step 0/Step 1, with no command for the user to type.
2. `进度跟踪 / Tracker`: route internally to `mrweirdo-tracker`.
3. `扩充写作画像 / Expand`: route internally to `mrweirdo-expand`.
4. `技能提升 / Upskill`: route internally to `mrweirdo-upskill`.
5. `起草申请材料 / Materials`: route internally to `mrweirdo-materials`.

Do not show ATS platform commands in this menu. The one-off ATS skills,
confirmation sync, quota cherry-pick, doctor preflight, and `*-auto` engines
remain available for internal routing, but are not user-facing menu items.

Do not use this skill for:

- one URL/manual apply: route internally to the dedicated one-off ATS skill;
- large-company quota slots: route internally to `mrweirdo-cherry-pick`;
- install readiness only: route internally to `mrweirdo-doctor`;
- Gmail confirmation sync only: route internally to `mrweirdo-confirm`.

## Defaults And Safety

- Auto-apply threshold: `fit_score >= 5`.
- Stable batch auto-submit ATS: Greenhouse and Ashby.
- Per-company quota guard stays on for the user's local `company_list.user.json`.
- LinkedIn, Indeed, Glassdoor, non-GH/Ashby platforms, and
  `legitimacy="suspicious"` rows go to manual review.
- Do not invent personal facts. Visa, GPA, demographic, legal attestation,
  background-check, relocation, and salary-acceptance facts require explicit
  user input or must stay null/blocking.
- Do not run real apply batches in background mode. The user should see row
  progress and have an interrupt window.

## Output Presentation Rules

All user-facing progress, summaries, questions, queue previews, and final
reports should use the same compact terminal style:

```text
[Step X/7] <短标题> - <正在做什么> (~<大概多久>)
```

Presentation rules:

- Lead with the current step, one-line status, and the user's single next action.
- Put key counts in a compact funnel line or small table before details.
- Keep tables to seven columns or fewer. Put anomalies below the table as short
  tagged lines.
- Do not paste raw JSON, database rows, or unformatted command output to the
  user. Read artifacts, then summarize them.
- Use CN-leaning bilingual labels: short Chinese first, English when it helps
  scanning (for example `自动投 / auto`, `manual 清单 / manual`).
- Prefer calm labels over paragraphs: `状态`, `你要做`, `结果`, `路径`, `下一步`.
- Keep queue gate and final report clean. They are the main product moments.
- Never change the meaning of the queue gate, identity block, counts, consent,
  eligibility, thresholds, or apply flow while improving presentation.

## References

Read these only when needed:

- `references/intake-and-profile.md`: hard-boundary questions, profile/search
  JSON shape, adaptive follow-up rules, and parse soft-window rules.
- `references/run-and-database.md`: local DB contract, discovery/scoring/store
  commands, auto-apply supervisor, report, and pruning.
- `../../../shared/scoring/score_prompt.md`: required scoring rubric.
- `../../../shared/profile.template.json`: runtime `profile.json` shape.
- `../../../shared/intelligence/intent_schema.json`: `search_intent.json` schema.
- `../../../shared/references/truthfulness.md`: truthfulness rules for any
  agent-drafted open-text answer.

## Step 0 - Preflight

Show a short preamble. For first run:

```text
[Step 0/7] 启动 / Ready check - 确认本机环境 (~30 sec)

Mr. Weirdo Jobs 已准备开始。

你只需要给我一件东西：
| 必填 | 内容 |
|---|---|
| 简历 PDF 路径 | 例如 `/Users/you/Resume.pdf` |

可选：再加 1-2 句目标方向/偏好；不写也可以，我会只从简历安全推断。

接下来我会：
1. 读取简历并生成本地 profile。
2. 只问不能安全推断的硬边界问题。
3. 开始只读 discovery + scoring。
4. 在真实提交前给你 queue gate；你回复"开始"才会投。

你要做：发我简历 PDF 的绝对路径。
```

Then run:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
bash scripts/preflight.sh
```

Stop on any failure and tell the user what to fix.

## Step 1 - Resume, Intro, Hard Boundaries

Ask for one intake message:

```text
[Step 1/7] 简历 intake - 建立本地画像 (~1-2 min)

请发一条消息：

| 类型 | 是否必填 | 说明 |
|---|---:|---|
| 简历 PDF 绝对路径 | 必填 | 用来生成 profile/search intent |
| 目标方向/偏好 | 可选 | 1-2 句即可；不写不阻塞 |

我不会编造未知个人事实；简历里没有、又不能安全推断的内容会留空或后面统一问。
```

Copy the resume:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
bash scripts/intake_resume.sh "<path from user>"
```

Read `references/intake-and-profile.md`. Use exactly one AskUserQuestion call
with the three hard-boundary questions A0/A1/A2. For A2, the recommended
default is ask/skip sensitive legal questions when a form actually needs them.
Do not require a self-introduction. Treat `self_intro_raw` as optional and allow
it to be empty. Do not ask soft preference questions here unless the answer
would materially change discovery keywords and fits the one adaptive follow-up
call budget.

If `~/.mrweirdo-jobs/documents/` exists and is non-empty, mention that
`/mrweirdo-expand` can enrich writing memory later. Do not block onboarding on
that branch.

## Step 2 - Generate Local JSON

Read the resume PDF in the main agent session. Use any optional self-introduction
only as extra evidence. Generate:

- `$MRWEIRDO_HOME/profile.json`
- `$MRWEIRDO_HOME/search_intent.json` with required `target_function_anchor`
  (`self_reported_target_functions`, `resume_supported_functions`,
  `adjacent_functions`, `excluded_functions`, `rationale`)
- `$MRWEIRDO_HOME/essay_profile.json`

Use `references/intake-and-profile.md`, `shared/profile.template.json`, and
`shared/intelligence/intent_schema.json`. Mark inferred soft fields in your
summary as `[推断，可改]`; do not mark hard-boundary facts as inferred.
When no self-introduction was provided, generate `essay_profile.json` from the
resume only: infer writing voice, positioning, and proof points only where the
resume supports them; put genuinely unknown writing facts in
`dynamic_questions_to_ask_later` and sensitive/unverified claims in
`hard_no_claims`. Do not block onboarding just because `self_intro_raw` is empty.

The required `work_authorization` runtime shape is in
`references/intake-and-profile.md`; do not emit legacy-only keys.

After writing:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
bash scripts/secure_profile_files.sh
node shared/validate_user_profile.mjs
```

If validation fails, correct the generated JSON before continuing.

## Step 3 - Parse Soft Window

Show a concise parse summary before discovery:

- name, email, phone;
- school, major, graduation date;
- work authorization and sponsorship values;
- top role directions and industries;
- geography and relocation policy;
- writing themes and hard no-claims;
- exclude keywords.

Use this layout:

```text
[Step 3/7] 解析检查 / Parse window - 先给你扫一眼 (~30 sec)

| 模块 | 读到的内容 | 备注 |
|---|---|---|
| 身份 | <name> / <email> / <phone> | queue gate 会再复核 |
| 学校 | <school> / <major> / <graduation> | [推断，可改] where applicable |
| 工作授权 | <visa> / sponsorship <yes/no> | 不从专业推断 |
| 目标方向 | <functions / role categories> | 跟用户自报 + 简历走 |
| 地点 | <geo / relocation policy> | 影响 discovery |
| 写作素材 | <themes> | 只用有证据的内容 |
| 不写/不投 | <hard no-claims / excluded keywords> | 安全边界 |

你要做：如果身份或方向不对，直接纠正；否则我继续只读找岗。
```

Do not wait for a separate parse confirmation. Say:

```text
我会先开始只读 discovery；你现在或 discovery 期间都可以纠正。身份事实改完会在
queue gate 再复核；方向类字段如果改动，我会重跑 discovery。
```

If the user corrects identity facts, update the JSON and continue. If they
change target direction, update JSON and restart Step 4.

## Step 4 - Refresh Discovery, Score, Store

Read `references/run-and-database.md`.

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
node shared/init_db_cli.mjs
node shared/discover_candidates.mjs --plan
node shared/discover_candidates.mjs \
  --run \
  --source-window-size "${MRWEIRDO_SOURCE_WINDOW_SIZE:-1000}"
```

Before discovery, tell the user:

```text
[Step 4/7] 找岗 + 打分 / Discovery & scoring - 生成候选队列 (~5-15 min)

状态：先只读抓岗位，不会提交申请。
你可以去做别的；我会用漏斗数字汇报进度。
```

After discovery, summarize the funnel in Chinese with this compact shape: raw
discovered, hard-filter dropped, auto-supported rows, manual rows, and rows to
score. Tell the user they can watch the live dashboard with:

```text
[Step 4/7] Discovery 漏斗

raw <R> -> hard-filter dropped <D> -> auto-supported <A> -> manual <M> -> to score <S>

| 阶段 | 数量 | 含义 |
|---|---:|---|
| raw | <R> | 初始发现 |
| hard-filter dropped | <D> | 明显不合适/不可用 |
| auto-supported | <A> | 平台可自动投 |
| manual | <M> | 需要人工处理 |
| to score | <S> | 进入打分 |

看板：`npm run status`
```

Score `$MRWEIRDO_HOME/run-tmp/to_score.json` in batches of 50 using
`shared/scoring/score_prompt.md`. After each batch, output one line:

```text
[Step 4/7] 评分进度 / Scoring - 100/216 | fit≥5 暂计 N | 下一批 50
```

Do not continue until every usable row has the complete score object required in
`references/run-and-database.md`.

Store:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
node shared/store_scored_jobs.mjs \
  --to-score "$MRWEIRDO_HOME/run-tmp/to_score.json" \
  --scored "$MRWEIRDO_HOME/run-tmp/scored.json" \
  > "$MRWEIRDO_HOME/run-tmp/db_result.json"
```

Summarize stored count, eligible count, manual/unsupported count, quota-guarded
count, suspicious count, and the DB path with this layout:

```text
[Step 4/7] 入库完成 / Stored

| 指标 | 数量 |
|---|---:|
| stored | <N> |
| auto-eligible | <N> |
| manual/unsupported | <N> |
| quota protected | <N> |
| suspicious review | <N> |

路径：DB `<path>`
下一步：queue gate，给你看将要自动投的具体队列。
```

## Step 5 - Queue Gate

Before a real batch, run a dry-run and diagnostics:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
node shared/apply_supervisor.mjs --dry-run > "$MRWEIRDO_HOME/run-tmp/dry-run.json"
node shared/queue_diagnostics.mjs --json > "$MRWEIRDO_HOME/run-tmp/queue-diagnostics.json"
```

Surface a compact queue preview. Include company, title, fit score, ATS,
location when available, and mark abnormal liveness/legitimacy fields when
present. If more than seven columns would be needed, keep the main table compact
and list only abnormal rows below it.

Always present the queue gate as the clean hero moment. Use this structure,
while preserving the identity block, counts, manual/quota/suspicious meanings,
cover-letter disclosure, and "开始" consent:

Always include this identity block and fixed statement inside the queue gate:

```text
[Step 5/7] Queue gate - 最终确认后才真实提交 (~1 min review)

身份 / Identity
将以以下身份提交：<name> / <email> / <phone> / <visa 状态>（来源 <source>）

本批次 / Batch counts
自动投 <N> 行 | manual 清单 <M> 行（不会替你投）| quota 保护 <Q> 行 | suspicious 待复核 <S> 行

自动投队列 / Auto queue
| # | Company | Role | Fit | ATS | Location | Flags |
|---:|---|---|---:|---|---|---|
| 1 | <company> | <title> | <score> | <ats> | <location> | <ok/anomaly> |

规则 / Rules
若 dry-run 输出的 `profile_gate.ok` 为 false，先问那一个问题、按 `remediation_command` 记录答案再往下走（否则整批投不出去）。
只有标记 auto 的行会被自动提交；manual 清单在 $MRWEIRDO_HOME/run-tmp/manual_or_unsupported.json，系统不会替你处理。
对需要 cover letter 的岗位，我会基于你的简历/profile/essay_profile/answer_bank 与岗位匹配证据自动生成并附上 cover letter；不会编造个人或公司事实。

你要做 / Action
回复"开始"执行，或先指出需要修改的行/字段。
```

Honor requested row drops before the batch starts. Continue only after the user
explicitly says "开始" or an equally clear start command. Do not re-confirm each
row after the batch begins.

Run the real foreground batch:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
if [ -n "${MRWEIRDO_MAX_AUTO_APPLY:-}" ]; then
  node shared/apply_supervisor.mjs --real --max "$MRWEIRDO_MAX_AUTO_APPLY"
else
  node shared/apply_supervisor.mjs --real
fi
```

Follow `references/run-and-database.md` for the `--real` permission prompt,
serial liveness gate, and `--skip-liveness` escape hatch.

## Step 6 - Missing Info Follow-Up And Retry

After every real batch, inspect:

```text
$MRWEIRDO_HOME/run-tmp/apply-gap-report.json
$MRWEIRDO_HOME/run-tmp/apply-gap-report.md
```

Before asking the user anything, handle open-text answers as agent work per
`references/run-and-database.md` and `shared/references/truthfulness.md`; do not
invent facts.

If `condensed_missing_questions` is non-empty, ask at most four grouped
questions from that list in one AskUserQuestion call. Present them by impact,
using `unblocks_n_jobs`, for example `补 <field> 可解锁 <N> 个岗位`. Ask only
facts that cannot be safely inferred from the resume or existing profile, and
do not use a fixed checklist. If a category appears as a singleton, keep it as
its own clear question instead of forcing it into an unnatural group.

Use this user-facing lead-in before the one AskUserQuestion call:

```text
[Step 6/7] 补缺口 / Missing info - 一次补最有用的信息 (~2 min)

我已经先自动起草开放题；这里只问必须由你确认、且能解锁最多岗位的事实。

| 优先级 | 要补的信息 | 可解锁 | 覆盖哪些原始缺口 |
|---:|---|---:|---|
| 1 | <one grouped question> | <N> 个岗位 | <categories> |
| 2 | <one grouped question> | <N> 个岗位 | <categories> |

你要做：一次性回答下面这些分组问题；不知道的可以留空，我不会编。
```

Never list each job's missing fields line by line for the user. The user should
see the minimal cross-application question set, not a manual application audit.
Leave lower-impact grouped questions for a later batch.

After the user answers, record the answers with `shared/record_profile_answers.mjs`
(never hand-write profile.json; see `references/run-and-database.md`), then requeue:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
node shared/record_profile_answers.mjs --json '<answers>' --source user_answer --category <category>
node shared/validate_user_profile.mjs
node shared/retry_gap_rows.mjs \
  --apply \
  --gap-report "$MRWEIRDO_HOME/run-tmp/apply-gap-report.json"
if [ -n "${MRWEIRDO_MAX_AUTO_APPLY:-}" ]; then
  node shared/apply_supervisor.mjs --real --max "$MRWEIRDO_MAX_AUTO_APPLY"
else
  node shared/apply_supervisor.mjs --real
fi
```

Use the second batch as the conversion-rate check. If the gap report lists
`onboarding_candidates`, summarize the recurring fields for the maintainer.

## Step 7 - Report, Prune, Next Steps

Generate the report and prune without an extra pause:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
REPORT_PATH=$(node shared/apply_report.mjs --since "$(date -u +%Y-%m-%d)")
echo "$REPORT_PATH"
node shared/prune_discovered_jobs.mjs \
  --apply \
  --delete-skipped --skipped-days "${MRWEIRDO_PRUNE_SKIPPED_DAYS:-0}" \
  --delete-unusable-url \
  --delete-low-fit --low-fit-days "${MRWEIRDO_PRUNE_LOW_FIT_DAYS:-0}" \
  --delete-unsupported --unsupported-days "${MRWEIRDO_PRUNE_UNSUPPORTED_DAYS:-14}" \
  --delete-stale --stale-days "${MRWEIRDO_PRUNE_STALE_DAYS:-30}" \
  --retry-limit "${MRWEIRDO_PRUNE_RETRY_LIMIT:-3}" \
  --clear-first-run \
  --json > "$MRWEIRDO_HOME/run-tmp/prune-summary.json"
```

End with a compact final report, not raw JSON:

```text
[Step 7/7] 本轮完成 / Batch report - 结果与下一步 (~1 min)

漏斗 / Funnel
discovered <D> -> scored <S> -> queued <Q> -> submitted <A> -> gaps <G>

| 结果 | 数量 | 说明 |
|---|---:|---|
| 已提交 | <N> | driver 验证成功 |
| 缺信息 | <N> | 已归纳到 Step 6 |
| manual | <N> | 不会自动处理 |
| quota/suspicious | <N> | 保护/复核 |

路径 / Files
- 本轮报告：`<REPORT_PATH>`
- DB：`<DB_PATH>`
- manual 清单：`$MRWEIRDO_HOME/run-tmp/manual_or_unsupported.json`
- prune：<one-line summary>

下一步 / Next
- 48h 后同步确认邮件：`/mrweirdo-confirm`
- 有 OA/interview/rejection 后记录进度：`/mrweirdo-tracker`
- manual 清单里的岗位单独处理
```
