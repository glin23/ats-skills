---
name: mrweirdo-jobs
description: Batch-mode auto-applier across all supported ATSes. Reads "✅ Approved" jobs from your local SQLite dashboard (~/.mrweirdo-jobs/jobs.db), routes each URL to the right ATS helper, applies with one upfront batch authorization, auto-marks status on success, and records skip reasons to feedback.jsonl for the AI sourcing loop. Per-job sub-flows reuse mrweirdo-greenhouse / mrweirdo-ashby / mrweirdo-lever / etc. helpers — this skill orchestrates the loop.
---

# mrweirdo-jobs batch orchestrator (v0.9+)

**v0.9 (2026-05-24)**: Quota guard for large companies (Google/Meta/Microsoft/etc). Batch 主动 skip 限投公司，引导用户 cherry-pick + single-URL skill 手动投。

**v0.8 (2026-05-23)**: Slow-mode pacing (2-5 min jitter, 50/day cap by default); reads new profile.batch_pace config; URL-based dispatch extended to lever / smartrecruiters / icims / jobvite / handshake / workday.

**v0.5 (2026-05-23)**: Queue source = Notion "✅ Approved" view; URL-based ATS dispatch; Computer Use visual fallback for unknown selectors; feedback.jsonl write on success+fail; auto-mark Notion 已投 with confirmation_url.

One trigger. Skill loads the "✅ Approved (Ready to Apply)" Notion view (curated by 用户 in the dashboard after AI sourcing scored + 用户 approved), asks for a **single batch authorization** ("回 'go' 开始投这 N 家"), then dispatches each URL to its matching ATS helper (Greenhouse / Ashby) and runs end-to-end: fill → upload → submit → verify → mark Notion → append feedback. Failures are logged, skipped, and written to `~/.mrweirdo-jobs/feedback.jsonl` so the next sourcing run learns from them. Ends with a dashboard + feedback-loop status.

This is 用户's actual daily-use form: one command, walk away, come back to a report.

---

## 何时触发

- 用户说 "用 mrweirdo-jobs 投我的待投队列" / "投我的待投" / "/mrweirdo-jobs" / "/mrweirdo-jobs run"
- 用户说 "batch apply" / "跑一遍 Notion 队列" / "把未投投了"
- 单 URL 投递 → 用 `/mrweirdo-greenhouse` 或 `/mrweirdo-ashby`，**不**用这个 skill

---

## 关键设计原则

1. **一次 setup，一次 trigger**：所有 per-app 决策都在 Step 2 batch auth 时一次性确认。中间不再问用户。
2. **Batch authorization 满足 harness classifier**（per `feedback_ats_auto_apply_strategy_2026.md`）：Step 2 列完整 queue 让用户回 "go" 一次 = 对 list 里每家都算 per-app 显式授权。后续 submit click 都基于这一次 explicit 确认。
3. **fail skip, not loop**：每家 fail 都 log + 截图 + 继续；不阻塞整个 batch
4. **Claude-driven 字段兜底**：unrecognized required fields → 由 skill 执行时的我 (Claude) 读 label/options + profile context + 公司名 → 推理出合理值 → 填上
5. **Notion auto-sync**：成功 row 立刻 mark「✅ 已投」+ 投递日期 + 来源 + Bot 备注

---

## Step 0: Pre-flight 检查

跑这些。任何一项 fail → 报告退出。

```bash
# 0. mrweirdo-jobs env (v1.0+ multi-tenant)
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"
export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
[ -d "$MRWEIRDO_REPO_ROOT" ] || MRWEIRDO_REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"  # dev fallback

# 1. CDP 9222 alive?
curl -sf http://localhost:9222/json/version > /dev/null \
  || { echo "Chrome CDP 9222 not up. Run: bash $MRWEIRDO_REPO_ROOT/shared/chrome-cdp-launcher.sh"; exit 1; }

# 2. profile.json 存在且必填字段非空
PROFILE="$MRWEIRDO_HOME/profile.json"
[ -f "$PROFILE" ] || PROFILE="$MRWEIRDO_REPO_ROOT/shared/profile.json"  # legacy fallback
[ -f "$PROFILE" ] || { echo "Missing profile.json — run /mrweirdo-init first"; exit 1; }
node -e "
const p = require('$PROFILE');
const need = [['personal','first_name'],['personal','last_name'],['personal','email'],
              ['personal','phone'],['personal','linkedin'],['resume_path']];
const miss = need.filter(([a,b]) => b ? !p[a]?.[b] : !p[a]);
if (miss.length) { console.error('Missing profile fields:', miss); process.exit(1); }
"

# 3. Resume PDF 真实存在
RESUME=$(node -e "console.log(require('$PROFILE').resume_path)")
[ -f "$RESUME" ] || { echo "Resume not found: $RESUME"; exit 1; }

# 4. log dir
mkdir -p /tmp/mrweirdo-jobs/log/$(date +%F)

# 5. local_db jobs.db exists + has Approved rows
node --no-warnings -e "
import(\`${process.env.MRWEIRDO_REPO_ROOT}/shared/local_db.mjs\`).then(async m => {
  try {
    const rows = m.queryApprovedView();
    console.log('Approved view OK, ' + rows.length + ' rows visible');
    if (rows.length === 0) {
      console.error('No rows with status \"✅ Approved\". Open datasette (or your SQLite client) and set status to \"✅ Approved\" for jobs you want to batch-apply.');
      process.exit(1);
    }
  } catch (e) {
    console.error('local_db query failed: ' + e.message + '. Run /mrweirdo-init to initialize jobs.db.');
    process.exit(1);
  }
});
"

# 6. ~/.mrweirdo-jobs feedback dir
mkdir -p "$MRWEIRDO_HOME"
```

**输出给用户**："Pre-flight OK. CDP ✓ profile ✓ resume ✓ Approved view ✓ ($RESUME)."

---

## Batch Pacing Configuration (v0.8)

profile.json 的 `batch_pace` 字段控制投递速度：

| Pace | Per-job 间隔 | 每日 cap | 用途 |
|---|---|---|---|
| `"fast"` | 5-15 sec jitter | 200 | 用户 自己 dogfood + 短 batch |
| `"normal"` | 30-60 sec jitter | 100 | 日常用 |
| `"slow"` | 2-5 min jitter | 50 | 平台反爬高时 + 过夜跑 (**default**) |
| `"stealth"` | 5-15 min jitter | 30 | 极度模拟人类，2-3 小时 50 个 |

默认 `"slow"` (per 用户 2026-05-23 vision: 模拟人工不让平台识别)。

### Pace lookup (canonical jitter ranges, in seconds)

```js
const BATCH_PACE = {
  fast:    { jitter: [5,   15],  daily_cap: 200 },
  normal:  { jitter: [30,  60],  daily_cap: 100 },
  slow:    { jitter: [120, 300], daily_cap: 50  },  // 2-5 min — DEFAULT
  stealth: { jitter: [300, 900], daily_cap: 30  },  // 5-15 min
};
const pace   = profile.batch_pace || 'slow';
const cfg    = BATCH_PACE[pace] || BATCH_PACE.slow;
const sleepS = cfg.jitter[0] + Math.random() * (cfg.jitter[1] - cfg.jitter[0]);
```

### 实施 (Step 3 loop hook)

Step 3 loop 内每个 job 完成后:
- `await sleep(jitter_range[pace])` —— jitter 是 uniform random in `[min, max]` seconds
- 检查今日已投递数 (`success_count + fail_count`) >= `daily_cap` → break batch 并提示"今日 cap N 已达，明日再 trigger / 或临时切 fast pace"
- 写 progress 到 `~/.mrweirdo-jobs/batch_progress.json` (含 `pace`, `started_at`, `last_job_at`, `success_count`, `fail_count`, `remaining_urls[]`)
- 容许中断恢复：下次 `/mrweirdo-jobs resume` 读 progress.json 接着跑（v0.8 stretch）
- 过夜跑 (stealth + 30 cap): 显示预计完成时间 = `now + remaining * avg_jitter`

### Daily cap 计算口径

- 计数包含**所有触发的 attempt**（success + fail + skipped），不是只算 success
- 跨日界限以本地时区 `America/New_York` 0:00 为准（用户 默认时区）
- daily cap counter 存 `~/.mrweirdo-jobs/daily_count.json`，按日期 key 累计

---

## Step 1: Load queue from local_db `v_approved` view (v1.1)

v1.1 query 本地 SQLite，过滤 `status = '✅ Approved'`。用户在 Datasette UI（或任何 SQLite 客户端）把 AI sourced row 改成 ✅ Approved 后才会进 batch。

调 `shared/local_db.mjs` 里的 `queryApprovedView()`：

```bash
node -e "
import(`${process.env.MRWEIRDO_REPO_ROOT}/shared/local_db.mjs`).then(async m => {
  const rows = await m.queryApprovedView();
  console.log(JSON.stringify(rows, null, 2));
});
" > /tmp/mrweirdo-jobs/queue.json
```

`queryApprovedView()` 在 `~/.mrweirdo-jobs/jobs.db` 上跑 `SELECT * FROM jobs WHERE status = '✅ Approved' ORDER BY fit_score DESC`. DB path 可通过 `MRWEIRDO_DB_PATH` env 覆盖。返回每行：

```js
{
  page_id, company, role, url, ats /* select value if set */, fit_score, location, status
}
```

后续 ATS dispatch 不再 trust Notion 里的 `ats` 字段——v0.5 改成在 Step 3 用 URL pattern 自动判定 (`ats` 字段仅在 dashboard print 时显示)。所以即便用户手动建的 row 没填 ATS 也照样跑。

筛选规则（v0.5 更宽松，因为 Approve flow 已经 vet 过）：

1. `状态` == `✅ Approved`（`queryApprovedView` 已 enforce）
2. `Apply URL` 非空（否则没法 navigate）
3. URL 必须能被 Step 3 dispatcher 识别为支持的 ATS（greenhouse / ashby v0.5；handshake / workday 留到 v0.6 / v0.7）——无法识别的 row 在 Step 3 当场 skip + feedback log，不在 Step 1 预过滤

队列为空 → 报告 "Notion '✅ Approved' view 里没有 row。先去 dashboard 标几个 AI sourced 岗位为 Approved 再来。" 退出。

---

## Step 2: Present queue + ask batch authorization (ONE prompt)

print 给用户：

```
即将投这 N 家（greenhouse + ashby，alive_exact/large_ats）：

| # | 公司         | 岗位                  | ATS        | Fit |
|---|--------------|-----------------------|------------|-----|
| 1 | Cresta       | DS Intern CS          | greenhouse | △   |
| 2 | Ramp         | CX Agent              | ashby      | ✓   |
| 3 | EnergyHub    | Eng Intern            | greenhouse | ✓   |
...

每家流程：填表 → 上传简历 → 截图 → click submit → 验证 → mark Notion 「✅ 已投」
失败的自动 skip + log，不阻塞 batch。

回 "go" 开始批量投这 N 家
   "skip <#>"      移除某家（可重复，例: "skip 3 5"）
   "only <#>"      只投这几家（例: "only 1 2 4"）
   "cancel"        取消
```

等用户回复。

- `go` → 进入 Step 3，对当前 list 每家执行
- `skip 3` / `skip 3 5 7` → 从 list 移除 → 再 print 一次 list 等下一次回应
- `only 1 2 4` → 重新筛 list 只保留这几个 → 再 print 一次 list 等下一次回应
- `cancel` / 任何其他文本 → 退出，不投任何家

**这个 "go" 就是 per-app explicit authorization**（per memory: 用户对话里说"投 X 公司"算 per-app 授权；这里 X = full list，等价于对每家都说一次）。后续每家的 submit click 都基于这一次 explicit batch 授权。

---

## Step 3: Batch run loop

对 list 里每个 `candidate`，按下方流程跑。一家 fail → log + 截图 + `continue` 下一家，**不**整体退出。

```python
# pseudocode
for i, c in enumerate(list, 1):
    print(f"[{i}/{N}] {c.company} — {c.role} ({c.ats})")

    # v0.9 Quota Guard — skip large capped companies, do NOT batch
    company_entry = lookup_company(c.url)  # 从 company_list.json 找 (URL 公司名匹配)
    if company_entry and company_entry.get("apply_quota", {}).get("enabled") is True:
        q = company_entry["apply_quota"]
        msg = f"⚠️ {c.company} 是限投公司 (cap {q['limit_per_period']}/{q['period']}). 跳过 batch. 请用 /mrweirdo-{c.ats} <url> 单独投递。"
        print(f"  {msg}")
        log_feedback({
            "company": c.company,
            "role": c.role,
            "url": c.url,
            "ats": c.ats,
            "skip_reason": "quota_protect",
            "user_note": "mrweirdo-jobs batch 主动 skip 限投公司，避免烧 quota",
        })
        notion_mark_skipped(c.page_id, reason="Other",
                            user_note="Quota protect — manual single-URL only")
        continue  # 跳到下一家 — 注意不是 break batch

    try:
        result = apply_one(c)
        if result.ok:
            mark_notion_submitted(c.page_id)
            log_jsonl({**c.dict(), "success": True, "ts": now()})
            print(f"  ✅ submitted. Notion marked.")
        else:
            log_jsonl({**c.dict(), "success": False, "error": result.error, "ts": now()})
            print(f"  ❌ {result.error} — skipping, continuing batch.")
    except ClassifierBlocked:
        print(f"  ⛔ submit was not authorized at the classifier level. Aborting batch — try the single-URL skill (/mrweirdo-greenhouse <url> or /mrweirdo-ashby <url>) for per-application authorization on the remaining rows.")
        break  # ONLY case we exit batch early
    except Exception as e:
        log_jsonl({**c.dict(), "success": False, "error": str(e), "ts": now()})
        print(f"  ❌ {e} — skipping, continuing batch.")
```

注意：quota guard 跟 `ClassifierBlocked` 不同 —— **不 break batch，只 skip 这一家**，下一家继续。被 skip 的 row 写 feedback `skip_reason=quota_protect` 并在 Notion 上 mark 「⚠️ 跳过未投」+ user_note 说明是 quota 保护。

### Per-job flow (`apply_one(c)`)

对每个 candidate：

1. **Navigate**:
   ```bash
   TAB=$(node shared/cdp.mjs goto "$URL" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
   sleep 2  # 让 ATS SPA 渲染
   ```
   404 / `body.innerText` 含 "Job is no longer available" / "Job not found" → return `{ok: false, error: "URL dead"}` 让 caller skip。

2. **URL-based ATS dispatch (v0.5 / v0.8)** — 信 URL，不信 Notion 字段：

   ```js
   function detectATS(url) {
     if (/job-boards\.greenhouse\.io|boards\.greenhouse\.io|.*\.greenhouse\.io/.test(url)) return 'greenhouse';
     if (/jobs\.ashbyhq\.com/.test(url)) return 'ashby';
     if (/jobs\.lever\.co/.test(url)) return 'lever';                                  // v0.8
     if (/jobs\.smartrecruiters\.com/.test(url)) return 'smartrecruiters';             // v0.8 beta
     if (/careers-.*\.icims\.com|.*\.icims\.com/.test(url)) return 'icims';            // v0.8 alpha
     if (/jobs\.jobvite\.com/.test(url)) return 'jobvite';                             // v0.8 alpha
     if (/joinhandshake\.com|app\.joinhandshake\.com/.test(url)) return 'handshake';   // v0.6 beta
     if (/myworkdayjobs\.com|workday\.com/.test(url)) return 'workday';                // v0.7 stretch
     // sourcing-only — recognized but no auto-apply helper yet
     if (/wellfound\.com|angel\.co/.test(url)) return 'wellfound';
     if (/(work|jobs)\.ycombinator\.com/.test(url)) return 'yc';
     if (/bamboohr\.com/.test(url)) return 'bamboohr';
     if (/ats\.rippling\.com|app\.rippling\.com/.test(url)) return 'rippling';
     if (/recruitee\.com/.test(url)) return 'recruitee';
     if (/personio\.de|personio\.com/.test(url)) return 'personio';
     return 'unknown';
   }
   ```

   ### URL → helper dispatch 表 (v0.8)

   | URL pattern | ATS key | Helper status | Action |
   |---|---|---|---|
   | `*.greenhouse.io` / `boards.greenhouse.io` / `job-boards.greenhouse.io` | `greenhouse` | stable | route to `mrweirdo-greenhouse` |
   | `jobs.ashbyhq.com` | `ashby` | stable | route to `mrweirdo-ashby` |
   | `jobs.lever.co` | `lever` | v0.8 (new) | route to `mrweirdo-lever` |
   | `jobs.smartrecruiters.com` | `smartrecruiters` | v0.8 beta | route to `mrweirdo-smartrecruiters` (beta — verify before submit) |
   | `careers-*.icims.com` | `icims` | v0.8 alpha | route to `mrweirdo-icims` (alpha — may fail, log + continue) |
   | `jobs.jobvite.com` | `jobvite` | v0.8 alpha | route to `mrweirdo-jobvite` (alpha — may fail) |
   | `app.joinhandshake.com` | `handshake` | v0.6 beta | route to `mrweirdo-handshake` (beta) |
   | `*.myworkdayjobs.com` | `workday` | v0.7 stretch | route to `mrweirdo-workday` (per-company config required) |
   | `wellfound.com` / `angel.co` | `wellfound` | sourcing-only | skip + log `manual apply required (sourcing-only)` |
   | `(work|jobs).ycombinator.com` | `yc` | sourcing-only | skip + log `manual apply required (sourcing-only)` |
   | `bamboohr.com` | `bamboohr` | sourcing-only | skip + log `manual apply required (sourcing-only)` |
   | `ats.rippling.com` | `rippling` | sourcing-only | skip + log `manual apply required (sourcing-only)` |
   | `recruitee.com` | `recruitee` | sourcing-only | skip + log `manual apply required (sourcing-only)` |
   | `personio.de/com` | `personio` | sourcing-only | skip + log `manual apply required (sourcing-only)` |
   | (else) | `unknown` | — | skip + feedback `unknown URL pattern: <url>` |

   - alpha/beta helpers: still run but `feedback.jsonl` 标记 `experimental: true`，便于后期回归
   - sourcing-only: 从 Notion approved 队列里 vet 过的 row 也照 skip，理由 = `manual apply required (sourcing-only)`，**不**算 fail
   - 与 Notion 里 `ats` 字段不一致 → log warning（"Notion says X, URL says Y, going with URL"），继续

3. **Inject helpers** (v0.8 — switch on detected ATS):
   ```bash
   case "$ATS" in
     greenhouse)      node shared/cdp.mjs eval "$TAB" "$(cat shared/greenhouse_helpers.js)" ;;
     ashby)           node shared/cdp.mjs eval "$TAB" "$(cat shared/ashby_helpers.js)" ;;
     lever)           node shared/cdp.mjs eval "$TAB" "$(cat shared/lever_helpers.js)" ;;             # v0.8
     smartrecruiters) node shared/cdp.mjs eval "$TAB" "$(cat shared/smartrecruiters_helpers.js)" ;;   # v0.8 beta
     icims)           node shared/cdp.mjs eval "$TAB" "$(cat shared/icims_helpers.js)" ;;             # v0.8 alpha
     jobvite)         node shared/cdp.mjs eval "$TAB" "$(cat shared/jobvite_helpers.js)" ;;           # v0.8 alpha
     handshake)       node shared/cdp.mjs eval "$TAB" "$(cat shared/handshake_helpers.js)" ;;         # v0.6 beta
     workday)         node shared/cdp.mjs eval "$TAB" "$(cat shared/workday/$COMPANY_TENANT.js)" ;;   # v0.7 stretch
     *) echo "skip — no helper for $ATS"; continue ;;
   esac
   ```
   应返回类似 `"GH ready: ..."` / `"Ashby ready: ..."` / `"Lever ready: ..."`。helper 文件不存在 = ATS 还没实现 → log + skip + feedback `helper missing for $ATS`。

   **Stability flags** (写到 feedback.jsonl 的 `experimental` 字段以便后期回归)：

   | ATS | stable? | experimental flag |
   |---|---|---|
   | greenhouse | ✓ | no |
   | ashby | ✓ | no |
   | lever | new (v0.8) | yes (first 50 submits) |
   | smartrecruiters | beta | yes |
   | icims | alpha | yes |
   | jobvite | alpha | yes |
   | handshake | beta | yes |
   | workday | stretch | yes |

4. **Resume upload** (early — Ashby `_systemfield_resume` 有时 reveal conditional fields):
   ```bash
   if [ "$ATS" = "greenhouse" ]; then
     node shared/cdp.mjs upload "$TAB" "#resume_input" "$RESUME"
   else
     node shared/cdp.mjs upload "$TAB" "#_systemfield_resume" "$RESUME"
   fi
   ```

5. **Fill form via helpers**:
   ```bash
   PROFILE_JSON=$(cat "$PROFILE")
   if [ "$ATS" = "greenhouse" ]; then
     RESULT=$(node shared/cdp.mjs eval "$TAB" "(async () => JSON.stringify(await GH.fillForm($PROFILE_JSON)))()")
   else
     # Ashby fillForm returns a plan, then per-action dispatch (see mrweirdo-ashby SKILL.md step 5)
     PLAN=$(node shared/cdp.mjs eval "$TAB" "JSON.stringify(Ashby.fillForm($PROFILE_JSON))")
     # Loop plan items, dispatch typetext / yesno / select / date
     # See mrweirdo-ashby SKILL.md for exact dispatch logic
   fi
   ```

6. **Claude-driven 字段兜底**（the v0.2 hard part — see next section）

7. **Pre-submit screenshot**:
   ```bash
   SS_DIR=/tmp/mrweirdo-jobs/log/$(date +%F)
   node shared/cdp.mjs screenshot "$TAB" "$SS_DIR/${COMPANY// /_}_pre_submit.png"
   ```

8. **Click submit**:
   ```bash
   if [ "$ATS" = "greenhouse" ]; then
     SEL=$(node shared/cdp.mjs eval "$TAB" "JSON.stringify(GH.findSubmit())" | jq -r '.selector')
   else
     SEL=$(node shared/cdp.mjs eval "$TAB" "JSON.stringify(Ashby.findSubmit())" | jq -r '.selector')
   fi
   node shared/cdp.mjs eval "$TAB" "document.querySelector('$SEL').click(); 'clicked'"
   sleep 4
   ```

   **如果 cdp eval 命令本身被 Bash classifier 拦截** → throw `ClassifierBlocked` → caller break batch（唯一中断 batch 的 case）。

9. **Verify success**:
   ```bash
   if [ "$ATS" = "greenhouse" ]; then
     OK=$(node shared/cdp.mjs eval "$TAB" "JSON.stringify(GH.checkSuccess())" | jq -r '.ok')
   else
     OK=$(node shared/cdp.mjs eval "$TAB" "JSON.stringify(Ashby.checkSuccess())" | jq -r '.ok')
   fi
   ```
   `ok == false` → 再等 4s 重试一次 check（有时 Ashby in-place 替换慢）；仍 false → screenshot post-submit + return `{ok: false, error: "submit did not produce success state"}`

10. **Post-submit screenshot** (always, even on fail — debugging evidence):
    ```bash
    node shared/cdp.mjs screenshot "$TAB" "$SS_DIR/${COMPANY// /_}_post_submit.png"
    ```

11. return `{ok: true, screenshots: [...]}` or `{ok: false, error: "..."}`

---

## Step 3.5: Claude-driven 字段兜底（v0.2 核心）

`fillForm` 跑完不代表所有 required 都填了——经常有 conditional Q ("If Yes above, please specify") / custom Q ("Why this company?" / "Available start date?") / 公司专属 picker。

### 检测未填 required

调 helper `findEmptyRequired()`（v0.2 helpers 会 ship 这个函数）。返回数组：

```js
[
  {
    label: "If selected, when can you start?",
    id: "question_28394",
    type: "text",
    required: true,
    currentValue: ""
  },
  {
    label: "Do you require visa sponsorship now or in the future?",
    id: "question_28395",
    type: "react-select",
    options: ["Yes", "No"],
    required: true,
    currentValue: "Select..."
  },
  {
    label: "Hispanic or Latino?",
    id: "question_28396",
    type: "react-select",
    options: ["Yes", "No", "Decline to self-identify"],
    required: false,  # technically optional, but some forms reject submit if blank
    currentValue: ""
  },
  ...
]
```

### 推理 + 填值（loop, 最多 3 轮）

对每个 unfilled field，由 **skill 执行时的 Claude (我)** 综合：

- `field.label` — 字段问的是什么
- `field.options` (若是 picker)
- `c.company`, `c.role` — 上下文
- `profile.standard_qa`, `profile.work_authorization`, `profile.demographics` — 用户偏好
- 已知 patterns (visa, sponsorship, hispanic, gender, race, veteran, disability, criminal history, OFCCP) → 套 `profile.demographics`
- 文本类（"why this company" / "why this role" / "earliest start" / "biggest project"）→ 套 `profile.standard_qa.*` 模板 + 公司名 inject

→ 决定值 `v`，按 type 填：

- **text / textarea**:
  - Greenhouse: `node shared/cdp.mjs eval $TAB "GH.setText('$id', $JSON_QUOTED_V)"`
  - Ashby: `node shared/cdp.mjs typetext $TAB "#$id" "$v"` (必须真键盘，**不**用 setVal)
- **react-select**:
  - Greenhouse: `node shared/cdp.mjs eval $TAB "GH.openPicker('$id').then(_ => GH.pickOption('$v'))"`
  - Ashby: `node shared/cdp.mjs eval $TAB "Ashby.pickSelect('$id','$v').then(r => console.log(JSON.stringify(r)))"`
- **yesno** (Ashby button widget): `node shared/cdp.mjs eval $TAB "JSON.stringify(Ashby.clickYesNo('$uuid','$v'))"`
- **date**: `node shared/cdp.mjs eval $TAB "JSON.stringify(Ashby.setDate('$id','$v'))"`

填完一轮 → 重新调 `findEmptyRequired()` → 还有空 → 再推理一轮。最多 3 轮。

### Location combobox 特例（v0.3 → v0.5）

如果 `field.type` 是 `location-combobox`（Greenhouse Google Places picker）或 `ashby-location-combobox`（Ashby 地点 combobox）——这俩用普通 react-select 路径填不进去：

1. 调 `GH.prepareLocationCombobox(fieldId)` 或 `Ashby.prepareLocationCombobox(fieldElement)` → 返回 `{ ok, selector }`（一个 temp CSS selector 指向已 focus 的输入框）
2. `node shared/cdp.mjs typetext $TAB "<temp selector>" "<location text from profile>"`（真键盘输入，触发 autocomplete）
3. 等约 1500ms 让下拉出现
4. 调 `GH.pickLocationOption("<location text>")` 或 `Ashby.pickLocationOption("<location text>")` → 选第一个 match 项
5. 失败 → 进入下方 Computer Use vision fallback

### Computer Use vision fallback（v0.5 新增）

**仅在**：Claude 推理出"该填什么"但找不到对应 selector / element ID（label 文本和 DOM 名字对不上、或字段动态渲染）时启用。

流程：

1. 调 `shared/computer_use_locator.mjs` 里的 `shouldEscalateToVision(unidentifiedFields, attemptCount)`
   - 返 `{ok: false, reason: "..."}` → 不升级，按现有 3-round 逻辑继续 / skip
   - 返 `{ok: true, fieldsToLocate: [...]}` → 进 vision 路径
2. 调 `captureFrame(tabId)` 把当前 DOM frame 截到 `/tmp/mrweirdo-jobs/locator-frame.png`
3. 对每个要找的 field：
   - 调 `buildVisionPrompt(field, { url, atsPlatform, formTitle })` 拿到 prompt
   - 用 `mcp__computer-use__screenshot` 取当前屏幕（或读 saved frame），按 prompt 分析定位
   - Claude 返 `{selector, x, y, confidence}` JSON
4. 三种结果：
   - `confidence < 0.5` → log + skip 这个 field
   - `selector` 非空 → 切回 CDP 快路径：`node shared/cdp.mjs typetext $TAB "<selector>" "<value>"`
   - `selector` 空但有 `x, y` → 调 `fillViaCoordsPlan(x, y, text)` 拿 action 数组，用 `mcp__computer-use__left_click` + `mcp__computer-use__type` 顺序执行
5. 每次尝试调 `logAttempt({fieldLabel, strategy, result, confidence, attempt, ats})` 写 `~/.mrweirdo-jobs/log/locator.jsonl`
6. 同一 form 内 vision 升级最多 3 次（`MAX_VISION_ATTEMPTS_PER_FORM`）；超过即不再 escalate

**3 轮 Claude 兜底 + Computer Use vision fallback 都跑完仍有空 required** → return `{ok: false, error: "still N empty required after 3 rounds + vision: <labels>"}` → caller skip + feedback log。

### Claude 推理时的规则

不要瞎填。优先级：

1. profile 里有明确字段（visa / hispanic / gender / etc.）→ 直接用
2. profile.standard_qa 里有模板 → 用模板，公司名 inject (`{company}` → `c.company`)
3. 短文本（< 100 字）且没模板 → 用合理 default：
   - "earliest start date" → profile.standard_qa.earliest_start_date 或 "Summer 2026"
   - "are you authorized to work" → profile.work_authorization.authorized_to_work_us
   - "are you 18+" → "Yes"
   - "willing to relocate" → profile.standard_qa.willing_to_relocate
4. 长文本（covered letter, "tell us about a project"）→ 没 profile 模板 → 写一段 60-120 字 generic、用 profile 已知信息（school/major）+ 公司名
5. **picker options 必须从 `field.options` 里选**——不许编造。如果都不合理（例：required picker 但 profile 没指示），选 "Decline to self-identify" / "Prefer not to say" 类 option；都没有 → 选第一个非"Select..."的。
6. 千万**不要**把"是否需要签证赞助"答错——必须严格 follow `profile.work_authorization.requires_sponsorship_now` / `_future`

---

## Step 4: Mark Notion + write feedback.jsonl (v0.5)

v0.5 在 success 和 fail 两条路径上都写 feedback——success 沉淀"哪类 form 这套 helper 能搞定"，fail 沉淀"下次 sourcing 要规避哪类 pattern"。

### Success path

调 `shared/local_db.mjs` 的 `markApplied(page_id, info)`：

```bash
node -e "
import(`${process.env.MRWEIRDO_REPO_ROOT}/shared/local_db.mjs`).then(async m => {
  const r = await m.markApplied('$PAGE_ID', {
    bot_note: 'mrweirdo-jobs batch',
    confirmation_url: '$CONFIRMATION_URL'  // 如有, e.g. submit 后落地页 URL
  });
  console.log(JSON.stringify(r));
});
"
```

`markApplied` 内部把状态置 `✅ 已投`、投递日期 = 今天、链接质量 = `submitted`、来源 = `ATS 直投`，并把 `confirmation_url`（如有）附到 `Bot 备注`。

DB update 失败 → log warning 但**不**算 fail（已经投出去了，人工补 mark 也行）。

#### Quota tracking (v1.1.x)

如果这家公司在 `company_list.json` 里标 `apply_quota` (大公司 limit)，记一笔到 quota.jsonl 用于下次 sourcing 自动屏蔽：

```bash
node -e "
import(\`\${process.env.MRWEIRDO_REPO_ROOT}/shared/quota.mjs\`).then(async m => {
  // Only call if the company has a quota cap
  const company = '$COMPANY';
  const quota_limit = $APPLY_QUOTA_LIMIT || 0;   // from company_list.json
  const quota_period = '$APPLY_QUOTA_PERIOD';     // 'semester' / 'year' / 'lifetime'
  if (quota_limit > 0) {
    const r = await m.recordApply({
      company,
      apply_quota_limit: quota_limit,
      apply_quota_period: quota_period,
      apply_url: '$URL',
      role_title: '$ROLE'
    });
    console.log('quota recorded:', JSON.stringify(r));
    const remaining = await m.getRemaining({company, apply_quota_limit: quota_limit, apply_quota_period: quota_period});
    console.log('remaining:', remaining.remaining, '/', remaining.limit, 'for period', remaining.period);
  }
});
"
```

下次 sourcing (`/mrweirdo-source`) 跑 `isCapReached(companyEntry)` 自动 skip 配额耗尽的公司，导向 「🏢 大公司限投」 view 让用户 cherry-pick 剩余配额给真 dream role。

### Fail path (v0.5 新增 feedback write)

调 `shared/feedback.mjs` 的 `append({company, role, url, ats, skip_reason, user_note})`：

```bash
node -e "
import(`${process.env.MRWEIRDO_REPO_ROOT}/shared/feedback.mjs`).then(m => {
  m.append({
    company: '$COMPANY',
    role: '$ROLE',
    url: '$URL',
    ats: '$ATS',
    skip_reason: 'Submit failed',   // 或 'ATS unsupported' / 'Required field' / 'URL dead' / 'Captcha' / etc.
    user_note: '$ERROR_MESSAGE'      // 原始报错文本
  });
});
"
```

`feedback.append` 会写到 `~/.mrweirdo-jobs/feedback.jsonl`（每行一个 JSON 记录，含 `ts`）。

下次 sourcing pipeline 起手时 (`shared/feedback.mjs` 的 `loadRecent(20)` + `formatForPrompt`) 会把最近 skip 注入 AI scorer 的 system prompt，让 scorer 学会"上周 Sierra/Ramp 这种 FT recruiter role 用户嫌弃 → 这次别推"。

注：feedback 是 sourcing 调优用的，不是 retry 用的。Fail 的 row 在 Notion 里保持原状（依然 `✅ Approved`），用户可以手动改 reason / 改成 `⚠️ 跳过未投` / 重新触发 batch。如果想自动 mark 跳过，调 `markSkipped(page_id, reason, user_note)`——v0.5 默认 **不**调，留 user note 后续 review。

---

## Step 5: Final dashboard

batch loop 结束（无论 break 还是 done），print。v0.8 起 dashboard 顶部多一段 **pace context**（当前 pace + 今日 cap + 剩余配额 + 预计完成时间），方便过夜跑回来一眼看到状态：

```
## mrweirdo-jobs batch report — 2026-05-23

Pace: slow (2-5 min jitter, daily cap 50)
Today so far: 12/50 attempts (38 left)
ETA for next 38 @ 3.5min avg = ~2h13m  (finishes ~22:47 local)

投了 8/10 家：

✅ 成功 (8):
  - [1]  Cresta — DS Intern CS  (greenhouse)
  - [2]  Ramp — CX Agent  (ashby)
  - [3]  EnergyHub — Eng Intern  (greenhouse)
  - [4]  NiCE — SDR Intern  (greenhouse)
  - [5]  Sierra — Univ Recruiter  (ashby)
  - [6]  Polymarket — Ops Intern  (ashby)
  - [7]  Cresta SR — Solutions Eng  (greenhouse)
  - [8]  Twilio — Marketing Intern  (greenhouse)

❌ 失败 (2):
  - [9]  Crusoe — Motion Designer  (greenhouse)
         fillForm 卡死: "no .select__option visible after 1500ms" on country picker
         截图: /tmp/mrweirdo-jobs/log/2026-05-23/Crusoe_pre_submit.png
  - [10] Polymarket — Graphic Design  (ashby)
         submit click 后 4+4s 仍没 "successfully submitted" 文字，可能 captcha
         截图: /tmp/mrweirdo-jobs/log/2026-05-23/Polymarket_post_submit.png

🏢 v0.9 Quota guard skipped (2):
  - [11] Google — Product Mgmt Intern  (greenhouse)
         apply_quota cap 3/semester — 用 single-URL skill cherry-pick 手动投
  - [12] Anthropic — TPM Intern  (greenhouse)
         apply_quota cap 3/semester — 用 single-URL skill cherry-pick 手动投

  → 这些 row 已被 mark 「⚠️ 跳过未投」 + user_note="Quota protect — manual single-URL only"
  → 去 Notion 「🏢 大公司限投 (待手动选)」 view 看完整 capped 队列
  → 心里挑出 dream 那 1-3 家 → 用 `/mrweirdo-greenhouse <url>` / `/mrweirdo-ashby <url>` 单独投
  → 投完手动在 「🏢 大公司投递配额追踪」 sub-page 记一笔（Google 1/3 etc.）

Notion: 已 auto-mark 8 个「✅ 已投」+ 投递日期 + 来源="ATS 直投" (+ confirmation_url 落进 Bot 备注).
Inbox check: confirmation emails 到用户注册邮箱 (Greenhouse 通常有, Ashby 小 startup 经常没).

Log: /tmp/mrweirdo-jobs/log/2026-05-23.jsonl
Screenshots: /tmp/mrweirdo-jobs/log/2026-05-23/
Feedback log: ~/.mrweirdo-jobs/feedback.jsonl (新 append 2 条 fail 记录)

## v0.5 feedback loop status

跑一遍 `node -e "import(`${process.env.MRWEIRDO_REPO_ROOT}/shared/feedback.mjs`).then(m => console.log(JSON.stringify(m.summarize(m.loadRecent(50)), null, 2)))"`，
列出 top-3 skip 模式 (累积 50 条):

  • "Wrong Role" × 12 → 下次 sourcing 会 inject "user keeps rejecting senior-level non-intern roles"
  • "Submit failed" × 5 → helpers 有 systematic bug，建议 check log 看是不是同一 selector 反复挂
  • "ATS unsupported" × 3 → handshake/workday 未实现（v0.6/v0.7 任务）

→ 下次 sourcing 时 AI scorer 会自动把这些 context 注入 system prompt，过滤掉同类岗位。
→ 想看更系统的偏差分析，跑 `node shared/patterns.mjs analyze`（v0.5+ 配套工具）→ 会建议
  你 update `profile.json` 的 `target_filters.exclude_keywords`。
```

如果是因为 **daily cap 触顶** 提前 break (v0.8)：

```
⏸️  batch 暂停在 [50/87] —— 今日 cap (50, slow pace) 已达。

已投 47 家 ✅ / fail 3 家 ❌

未投 37 家（仍在 Notion「✅ Approved」队列里，下次跑接着投）。

下次触发:
  - 等本地时间 0:00 (America/New_York) 后跑 `/mrweirdo-jobs`，剩余 37 家自动续接。
  - 临时切 fast pace: 把 profile.json 的 batch_pace 改成 "normal" 或 "fast" → 立刻可以接着跑（但平台反爬风险↑）。
  - 跑 `/mrweirdo-jobs resume` 直接从 ~/.mrweirdo-jobs/batch_progress.json 续接（v0.8 stretch）。
```

如果是因为 `ClassifierBlocked` 提前 break：

```
⛔ batch 中断在 [4/10] —— submit 没有在 classifier 层获得授权。

已投 3 家:
  - [1] Cresta ✅
  - [2] Ramp ✅
  - [3] EnergyHub ✅

未投 7 家（保留在 Notion「🔵 未投」）:
  - [4] NiCE, [5] Sierra, [6] Polymarket, [7] Cresta SR,
  - [8] Twilio, [9] Crusoe, [10] Polymarket Graphic

修复:
  对剩下的 row 用 single-URL skill 一家一家投 — `/mrweirdo-greenhouse <url>` 或 `/mrweirdo-ashby <url>` 拿 per-application 授权。
```

---

## 大公司限投保护 (v0.9 Quota Guard)

### 为什么 batch 必须主动 skip

大公司（Google / Meta / Microsoft / Amazon / Apple / Stripe / Anthropic / OpenAI / 投行系列 etc.）的招聘系统对每位 candidate 有 **submission cap**。最有名的：

- Google careers: 3 applications / 6 months（hard-blocked）
- Amazon Jobs: 系统阻挡在 10/yr
- Apple / Netflix / Stripe / Anthropic / OpenAI: 没明文 cap 但 self-restraint 3/sem
- 投行 (Goldman / JPMorgan / Morgan Stanley): 行业规范 3/sem

**如果 batch 自动投这些**：配额会烧在 **非 dream role** 上，等用户想投真正梦中岗位时已 hit cap = 失败。

**Hard product constraint**，不是 nice-to-have。

### 检测 (Step 3 dispatch 头部)

每个 URL 进 dispatch 前：

1. lookup `shared/sourcing/company_list.json` 的对应公司 entry（用 URL 解析或 Notion row 上的 company 名）
2. 若 entry 含 `apply_quota.enabled == true` → 跳过本 row，**不 break batch，只 skip**：
   - print `⚠️ {company} 是限投公司 (cap {limit}/{period}). 跳过 batch. 请用 /mrweirdo-{ats} <url> 单独投递。`
   - 写 `~/.mrweirdo-jobs/feedback.jsonl` 一条 `skip_reason=quota_protect` 记录
   - Notion 上 mark `状态 = ⚠️ 跳过未投` + `skip_reason = Other` + `user_note = Quota protect — manual single-URL only`
   - `continue` 跳到下一家
3. 否则继续 v0.8 dispatch logic

### 与 ClassifierBlocked 的差别

| 触发场景 | break batch? | feedback log | Notion 状态 |
|---|---|---|---|
| `ClassifierBlocked` (Bash classifier 拦 submit) | **break** 整个 batch | n/a (没投出去) | 保留 ✅ Approved |
| **Quota guard skip** (v0.9) | **不 break**, 只 skip 这家 | 写 `skip_reason=quota_protect` | mark `⚠️ 跳过未投` + user_note |

quota guard 是 **设计内** 的 skip，不是 fail；ClassifierBlocked 是 **harness 层** 阻断，需用户切 single-URL 路径。

### 用户操作流（被 skip 之后）

1. batch 跑完，dashboard 看到 "🏢 N 家因 quota 保护被 skip"
2. 用户打开 Notion 「📋 岗位追踪」 → 「🏢 大公司限投 (待手动选)」 view
3. 心里挑出最 dream 的 1-3 家（每个公司 1 个 role）
4. 对每个 cherry-pick 的 row 单独跑 `/mrweirdo-greenhouse <url>` / `/mrweirdo-ashby <url>` 等 single-URL skill
5. 投完去 「🏢 大公司投递配额追踪」 sub-page 手动 +1（"Google 用了 1/3，剩 2"）
6. 剩下的 capped row 留在 view 里，下一 cycle 再 review

### 不要做的事

- ❌ 不要让 quota guard 报错 / throw —— 它是设计内的 skip，dashboard 单独成组
- ❌ 不要在 batch 中"绕过"或"覆盖" quota guard —— 即使用户在 Notion 把 capped row 改成 ✅ Approved，batch 还是要 skip。要投 capped 公司，**唯一方式**是 single-URL skill
- ❌ 不要 hardcode capped 公司名单 —— 全部从 `company_list.json` 的 `apply_quota` 字段读
- ❌ 不要把被 skip 的 row 计入 daily_cap 计数 —— 它没真投，不算 attempt

---

## Error handling speedrun

| 情形 | 处理 |
|---|---|
| Pre-flight any check fail | 报错退出，**不**进 Step 1 |
| Notion view query 返回空 | "队列空，没东西可投" → 退出 |
| 单家 URL 404 / Job no longer available | log + skip + continue batch |
| 单家 CDP goto timeout | retry 一次，仍 fail → skip + continue |
| 单家 fillForm helper 报错 | log error + screenshot + skip + continue |
| 单家 3 轮 Claude 兜底仍有 empty required | log fields + screenshot + skip + continue |
| 单家 submit click 后 verify fail | 再等 4s 重 check，仍 fail → screenshot + skip + continue |
| **submit click 未获 classifier 授权**（Bash 命令被拦） | **break batch**, 跳到 Step 5 with `ClassifierBlocked` message — 让用户用 single-URL skill 继续剩余 row |
| Notion update-page 失败 | log warning，**不**算 fail（已投出去了） |
| Chrome 9222 中途挂掉 | break batch + 让用户重启 launcher |
| **今日 daily cap 触顶** (v0.8) | **pause batch** → 写 progress.json + 跳到 Step 5 with daily-cap message — 剩余 row 留在 Approved 队列，明天 0:00 后自动续接 |
| 中途 ATS helper 文件不存在 (v0.8 alpha/beta) | log + feedback `helper missing for $ATS` + skip + continue |
| **公司 `apply_quota.enabled == true`** (v0.9) | skip 这家 + feedback `skip_reason=quota_protect` + Notion mark `⚠️ 跳过未投`，**不**break batch，引导用户用 single-URL skill cherry-pick |

---

## 不要做的事

- ❌ 不要 hardcode 用户 个人信息——全部从 `profile.json` 读
- ❌ 不要 silent 失败——每个 fail 在 dashboard 都要 surface
- ❌ 不要 retry 同一家超过 2 次（除非用户明确要求）
- ❌ 不要在 batch 中途 ask user "确认投 X 家吗"——所有 per-app 决策在 Step 2 一次性收完
- ❌ 不要绕过 harness classifier（混淆 selector / 拆 eval 等）——那是 malicious bypass
- ❌ 不要 git commit / push 到 mrweirdo-jobs repo——这个 skill 是 runtime，不是 build
- ❌ 不要假装 v0.8 新 ATS helpers 已 stable——lever/smartrecruiters/icims/jobvite/handshake/workday 都还是 alpha/beta，必须写 `experimental: true` 进 feedback.jsonl，遇 fail 立刻 skip 不重试
- ❌ 不要绕过 batch_pace jitter——即使用户嫌慢也不能临时调到 fast 之外的速度，否则平台容易识别为 bot
- ❌ 不要投 alive_careers row——那是 landing page，没 specific role URL，会跑到 careers 主页填假表

---

## Log format (`/tmp/mrweirdo-jobs/log/<date>.jsonl`)

每行一个 JSON：

```json
{"ts":"2026-05-23T14:32:11-04:00","ats":"greenhouse","company":"Cresta","role":"DS Intern CS","url":"https://...","page_id":"...","success":true,"screenshots":["/tmp/mrweirdo-jobs/log/2026-05-23/Cresta_pre_submit.png","/tmp/mrweirdo-jobs/log/2026-05-23/Cresta_post_submit.png"]}
{"ts":"2026-05-23T14:34:02-04:00","ats":"greenhouse","company":"Crusoe","role":"Motion Designer","url":"https://...","page_id":"...","success":false,"error":"no .select__option visible after 1500ms on #country","screenshots":["/tmp/mrweirdo-jobs/log/2026-05-23/Crusoe_pre_submit.png"]}
```

可供后续 retry / 统计 / debug 分析。

---

## 参考

- `shared/cdp.mjs` — Node 24 WebSocket CDP driver (tabs / goto / eval / upload / screenshot / typetext)
- `shared/greenhouse_helpers.js` — `GH.fillForm`, `GH.openPicker`, `GH.findSubmit`, `GH.checkSuccess`, etc. (stable)
- `shared/ashby_helpers.js` — `Ashby.fillForm`, `Ashby.clickYesNo`, `Ashby.pickSelect`, `Ashby.checkSuccess`, etc. (stable)
- `shared/lever_helpers.js` — v0.8 (new, mark experimental in feedback)
- `shared/smartrecruiters_helpers.js` — v0.8 beta
- `shared/icims_helpers.js` — v0.8 alpha
- `shared/jobvite_helpers.js` — v0.8 alpha
- `shared/handshake_helpers.js` — v0.6 beta
- `shared/workday/<tenant>.js` — v0.7 stretch, per-company config
- `shared/profile.json` — 用户填的真实 profile (gitignored)
- `.claude/skills/mrweirdo-greenhouse/SKILL.md` — single-URL Greenhouse flow (本 skill 是 batch 版)
- `.claude/skills/mrweirdo-ashby/SKILL.md` — single-URL Ashby flow
- Notion DB / data_source IDs come from `~/.mrweirdo-jobs/config.json` (see `shared/config.template.json`). For 用户's legacy setup the defaults in `shared/paths.mjs` apply.
- Harness classifier rule: `feedback_ats_auto_apply_strategy_2026.md`
- react-select mousedown trick: `feedback_ats_react_select_mousedown.md`
