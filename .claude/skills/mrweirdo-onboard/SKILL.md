---
name: mrweirdo-onboard
description: Main entry skill for mrweirdo-jobs after install. Trigger for first-run setup, resume intake, student job/internship discovery, scoring, and guarded auto-apply. Collects resume + short questionnaire + explicit parse confirmation, then discovers jobs across public ATS boards, scores them, skips large-company quota rows, and auto-submits supported Greenhouse/Ashby rows. Do NOT trigger for a single URL/manual application; route those to mrweirdo-greenhouse, mrweirdo-ashby, or mrweirdo-lever.
---

# mrweirdo-onboard — v2 main entry

> **CRITICAL v2 BEHAVIOR — read the PRD red-line table before running this skill**:
> v2 retracted the v1 red line "Submit 永远人工". This skill auto-submits supported applications without per-app user confirmation after resume intake, short questionnaire, and explicit parse confirmation. Several v1 docs say "用户 手点 Submit" — that was v1 truth, NOT v2.
>
> Red lines that REMAIN in v2: LinkedIn / Indeed never automated; large-company quota guard skips ~25 capped companies; agent fills forms verbatim from resume (no invented info).

This is the **only** skill a user should need to invoke after install. It runs:

1. Resume → `search_intent.json` + `profile.json` (main agent vision over PDF)
2. explicit resume parse confirmation gate
3. Init / migrate `~/.mrweirdo-jobs/jobs.db` (v2 schema)
4. Discovery — multi-source dispatcher (Greenhouse, Ashby, Lever, YC, RemoteOK, and other board APIs)
5. Hard filter (rule-based: location, role, exclude) — drops ≥80%
6. AI scoring (main agent batches of 50, per `shared/scoring/score_prompt.md`)
7. Auto-apply gating (fit_score ≥ threshold AND not large-cap AND platform is supported)
8. Auto-submit dispatch to supported `mrweirdo-*-auto` helpers per row
9. Final report

---

## When to trigger

- **First-run path**: ~/.mrweirdo-jobs/.first_run sentinel exists (setup.sh wrote it on install) AND user's message even vaguely touches jobs / internships / "what now" / "start" / "how do I" — trigger PROACTIVELY without waiting for a slash command. New users don't know `/mrweirdo-onboard` exists; surfacing this is YOUR job.
- **Explicit invoke**: `/mrweirdo-onboard`
- **Natural phrases (any language)**:
  - EN: "I just installed", "first time using", "help me start", "how do I start", "what now", "next step", "start applying", "find me internships", "begin onboarding"
  - 中: "刚装完", "我刚装完", "怎么开始", "怎么用", "下一步", "找实习", "帮我找实习", "我想找暑期实习", "投实习", "上传简历开始", "用 mrweirdo 找工作", "找 PM 实习"

When in doubt and the first-run sentinel exists, trigger this skill. False-positive cost (showing Welcome to someone who didn't need it) is much lower than false-negative cost (new user types "hi" and gets nothing).

## When NOT to trigger

- User wants to manually investigate a single URL → route to `/mrweirdo-greenhouse` / `-ashby` / `-lever` (v1 half-auto helpers, with submit gate)
- User wants to cherry-pick large-company applications → route to `/mrweirdo-cherry-pick`
- User wants to check whether setup is ready → route to `/mrweirdo-doctor`
- User wants to re-score without re-discovery → explain that this recovery skill is not packaged yet; rerun `/mrweirdo-onboard` or inspect `jobs.db`
- User wants only the Gmail confirmation loop → route to `/mrweirdo-confirm`

---

## Defaults (v2)

These are the safety-net knobs. Hard-coded for v2.1; users can edit `~/.mrweirdo-jobs/profile.json` post-onboard to override.

| Knob | Default | Meaning |
|---|---|---|
| `fit_score_threshold` | 7 | Only auto-apply when `fit_score >= 7` (out of 10) |
| `quota_guard_enabled` | true | Skip the ~25 large companies marked `apply_quota.enabled = true` (per-company quota, not daily blanket — protects against ATS bot-flag) |
| `score_batch_size` | 50 | Jobs per main-agent scoring turn |
| `max_auto_apply_per_run` | 10 | Public beta default. Override with `MRWEIRDO_MAX_AUTO_APPLY=50` only after the user explicitly asks for a larger batch. |

---

## Step 0 — Welcome (display first, always)

**Before running any Bash**, print this banner to the user. This is the user's first impression — it is non-negotiable. The wording sets expectations for the 3-stage flow + the auto-apply contract.

If `~/.mrweirdo-jobs/.first_run` exists, this is genuinely their first run — be extra welcoming and explain what's about to happen. After Step 11 (final report) succeeds, delete the sentinel so subsequent runs skip the lengthier preamble. If the sentinel does NOT exist, print only the compact preamble (3 lines) — don't re-welcome a returning user.

### First-run banner (print verbatim, no markdown fence)

```
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║          👋  Welcome to Mr. Weirdo Jobs (v2.1.3)                 ║
║                                                                  ║
║   Your resume-driven internship / new-grad application agent.    ║
║                                                                  ║
║   Here's what happens next:                                      ║
║                                                                  ║
║     1️⃣   You drop one resume (PDF, absolute path)                ║
║     2️⃣   I read it + ask ~7 short questions to lock your        ║
║          search intent (work auth, target roles, location)       ║
║     3️⃣   I discover jobs across public ATS boards, score them,  ║
║          and auto-submit supported Greenhouse/Ashby matches.     ║
║                                                                  ║
║   You'll watch progress in your terminal. Afterwards, inspect    ║
║   the local DB and Gmail confirmations. Run /mrweirdo-confirm    ║
║   later to close the email loop.                                 ║
║                                                                  ║
║   📂  All state lives at ~/.mrweirdo-jobs/                       ║
║       Jobs database: ~/.mrweirdo-jobs/jobs.db (inspect with      ║
║       sqlite3 or `datasette serve <path> --open`)                ║
║                                                                  ║
║   👉  Ready? Drop your resume path on the next prompt.           ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

Then immediately segue: "First let me do a 10-second pre-flight check, then I'll ask for your resume." → continue to Step 0.5.

### Returning-user preamble (compact, when no sentinel)

```
mrweirdo onboard — resume → score → auto-apply (fit≥7, no daily blanket cap; per-company quota still on).
Running pre-flight checks…
```

---

## Step 0.5 — Pre-flight checks (~10 seconds)

Run these via Bash. Any FAIL → report and stop (with the fix the user needs to make).

```bash
# 0.1 Resolve env
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"
export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
[ -d "$MRWEIRDO_REPO_ROOT" ] || MRWEIRDO_REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"  # dev fallback

mkdir -p "$MRWEIRDO_HOME/log"
if [ -z "${CDP_HOST:-}" ] && [ -f "$MRWEIRDO_HOME/cdp_host" ]; then
  export CDP_HOST="$(cat "$MRWEIRDO_HOME/cdp_host")"
fi
export ATS_CDP_PORT="${ATS_CDP_PORT:-${CDP_HOST##*:}}"
[ -n "$ATS_CDP_PORT" ] || ATS_CDP_PORT=9222
export CDP_HOST="${CDP_HOST:-localhost:$ATS_CDP_PORT}"

# 0.2 Chrome CDP must be up (for Step 8 auto-submit). If missing, launch it once.
if ! curl -sf "http://$CDP_HOST/json/version" >/dev/null 2>&1; then
  echo "Chrome CDP not up at $CDP_HOST. Launching dedicated Chrome…"
  ATS_CDP_PORT="$ATS_CDP_PORT" bash "$MRWEIRDO_REPO_ROOT/shared/chrome-cdp-launcher.sh" || {
    echo "❌ Could not launch Chrome CDP."
    echo "   Run /mrweirdo-doctor for setup details, then retry /mrweirdo-onboard."
    exit 1
  }
fi

node "$MRWEIRDO_REPO_ROOT/shared/doctor.mjs" --cdp || {
  echo "❌ Doctor found install/runtime issues."
  echo "   Fix FAIL rows above, then retry /mrweirdo-onboard."
  exit 1
}

# 0.3 Node 24+ (for built-in sqlite + fetch)
NODE_MAJOR=$(node --version | sed -E 's/^v([0-9]+).*/\1/')
[ "$NODE_MAJOR" -ge 24 ] || { echo "❌ Node 24+ required, found $(node --version)"; exit 1; }

echo "✅ Pre-flight OK. CDP $CDP_HOST alive, Node $NODE_MAJOR."
```

---

## Step 1 — Ask for resume path

Say to the user (Chinese-first since the project is bilingual but 用户 speaks Chinese):

> 把你的简历 PDF 完整路径贴给我（绝对路径，例如 `/Users/you/Desktop/resume.pdf`）。我会读一遍 → 问几个关键问题 → 让你确认解析结果 → 跨平台找岗位 → 评分 → 小批量自动投递。确认解析前不会提交任何申请。

Wait for user to give a path. Validate via Bash:

```bash
RESUME_PATH="<path from user>"
[ -f "$RESUME_PATH" ] || { echo "❌ Resume not found at $RESUME_PATH"; exit 1; }
file "$RESUME_PATH" | grep -qi "pdf" || { echo "❌ Not a PDF: $RESUME_PATH"; exit 1; }
cp "$RESUME_PATH" "$MRWEIRDO_HOME/resume.pdf"
echo "✅ Resume copied to $MRWEIRDO_HOME/resume.pdf"
```

---

## Step 2 — Read resume + generate search_intent + profile (main agent vision)

**This step is done by you (the main agent session)**, not by a subprocess. Use the Read tool on `$MRWEIRDO_HOME/resume.pdf` to ingest the PDF (Claude Code supports PDF vision via Read), then produce TWO JSON files inline.

Read the schema from `shared/intelligence/intent_schema.json` for the `search_intent.json` shape.

For `profile.json`, follow `shared/profile.template.json` shape (personal / education / work_authorization / demographics / experience_summary / skills / languages / target_filters).

### Inline prompt — apply to the PDF you just read:

```
You are analyzing a resume PDF to produce TWO JSON artifacts at once:

1. profile.json — form-fill data the agent will paste into ATS applications. Keys:
   - personal { first_name, last_name, preferred_name?, email, phone, phone_country?,
       linkedin?, github?, website?, address { city, state, country, zip } }
   - education { school, degree, major, minor?, graduation_date, gpa?, honors? }
   - work_authorization { status: "citizen"|"permanent_resident"|"f1_opt"|"f1_cpt"|"h1b"|"other"|null,
       needs_sponsor: boolean|null, sponsor_when?: string|null }
   - demographics { gender?, race?, veteran?, disability? } — null unless explicit on resume
   - experience_summary [ { company, title, dates, key_skills [up to 5] } ] — top 5 recent
   - skills [string] — top 15 hard skills
   - languages [string]
   - resume_path: "<the path on disk>"
   - standard_qa { ... } — leave EMPTY {} for v2; mrweirdo-onboard does not solicit Q&A; auto-apply
       skills will derive answers per-form from resume + intent at fill time.
   - target_filters — leave EMPTY {} for v2; search_intent supersedes this.

2. search_intent.json — what jobs to look for (separate file, per shared/intelligence/intent_schema.json).

CRITICAL principles (do NOT skip):

- ZERO hard-coded majors. This tool serves ALL US college students — business, CS,
  nursing, mechanical eng, fine arts, pre-law, public health, journalism, anything.
- Read the resume's ACTUAL trajectory (coursework, projects, work, skills) — that's the
  signal. A marketing student wants marketing/media internships, NOT SWE. A nursing
  student wants clinical internships, NOT product management. Etc.
- Role titles must be SPECIFIC. "Product Manager Intern" is useful; "internship" is not.
- Honesty over flattery. A sophomore with one club project should NOT be marked
  competitive for FAANG-tier roles. caliber_signals must reflect reality.
- Verbatim filling — DO NOT INVENT personal info. If a field isn't on the resume,
  use null. The agent auto-submits; inventing info propagates to N applications.

For search_intent.role_categories — 5–10 entries, mix of:
  high   (direct match to resume),
  medium (adjacent / stretch),
  low    (1–2 exploratory).
Each title_pattern is what a recruiter would actually post.

For search_intent.exclude_role_keywords — only titles that would create OBVIOUS noise.
A business student's excludes: "software engineer", "ml engineer", "data engineer",
"backend engineer", "devops", "sre". A CS student's: "sales associate", "cashier",
"retail associate". Derived from the resume profile.

For search_intent.geographic_preference:
  primary_country = "US" unless resume strongly says otherwise.
  preferred_metros = derived from school location + any explicit city mentions.
  remote_acceptable = true unless resume is location-anchored.

For search_intent.seniority:
  intern         = currently mid-program (any year not graduating within 6 mo)
  new_grad_FT    = final year / graduating within 6 mo
  both           = ambiguous (graduating 6–12 mo out)

caliber_signals.competitive_strengths — be SPECIFIC. "Prior Stripe internship" not
"strong background". caliber_signals.growth_areas — honest gaps. "First internship search,
no industry experience yet" / "GPA below median for top-tier".

Output ONLY two JSON code blocks back-to-back: first profile.json, then search_intent.json.
No prose between or around. The driver will parse them.
```

You read the PDF, you apply the prompt, you produce both JSON blobs in your response.

**Do NOT write these to disk yet** — Step 2.5 may refine them.

---

## Step 2.5 — Generate adaptive ABCD questionnaire

After producing draft `profile.json` + `search_intent.json`, you (the main agent session) decide which questions to ask. The goal is to disambiguate things the resume cannot answer reliably, NOT to re-ask things the resume already says.

### Always-ask 5 questions (every user, every run)

These 5 cover info almost no resume states explicitly. Skip them only if the resume contains an unambiguous answer (rare).

| # | Question | Mode | Options | Default heuristic |
|---|---|---|---|---|
| A1 | Intern cycle target | **multi-select** | `A) Summer 2026  B) Fall 2026  C) Spring 2027  D) Summer 2027` | Pre-tick the cycle(s) most aligned with `graduation_target`. Users often target 2+ cycles. |
| A2 | Work authorization | **single-select** | `A) US Citizen / GC  B) F-1 (CPT/OPT 可)  C) F-1 + FT 需 sponsor  D) 其他` | Infer from resume signals (Chinese name + Beijing internship → default C). |
| A3 | Geographic flexibility | **single-select** | `A) 仅 [school city] 附近  B) [school city] + 1-2 个主 metro  C) 全美 anywhere  D) 仅 Remote` | Default B; expand to C if resume shows multi-metro history. |
| A4 | Intern hourly floor | **single-select** | `A) $20+/hr  B) $30+/hr  C) $40+/hr  D) 不限` | Default A; bump to C if caliber_signals show top-tier. |
| A5 | Onsite preference | **single-select** | `A) 必须 Onsite  B) Onsite > Hybrid > Remote  C) 都行  D) 仅 Remote` | Default B. |

Single-select reasoning: A2 / A3 / A4 / A5 are semantically exclusive choices — you have ONE work-auth status, ONE current relocate floor, ONE salary floor, ONE work-mode policy.

Multi-select reasoning: A1 — users often pursue Summer 2026 AND Fall 2026 simultaneously.

### Conditional (ask only if resume signals ambiguity)

For each, decide AT INSPECTION TIME based on the resume you just read. If the trigger doesn't match, **skip — do not ask**:

| # | Trigger | Question | Mode | Options |
|---|---|---|---|---|
| B1 | Resume spans 2+ distinct functions | 你想要的 function (可多选) | **multi-select** | **3 AI-derived options based on resume's top-3 best-fit functions** — e.g. for a business student with PM projects + VC analyst + growth-ops experience: `A) Product Manager  B) Operations / Growth  C) Investment / VC Analyst`. **Do NOT use the fixed PM/Growth/Eng/Strategy list** — generate per resume. Other (auto) lets user add custom (e.g. "Investment Banking") |
| B2 | Resume spans 2+ industries | 行业偏好 (可多选) | **multi-select** | **3 AI-derived options based on resume's top-3 best-fit industries** — e.g. `A) AI / ML startups  B) B2B SaaS  C) Venture Capital`. Other for user-added (e.g. "EdTech", "Healthcare AI") |
| B3 | Resume shows major-switch trajectory (e.g. business undergrad + recent CS bootcamp) | 你的主攻方向 (可多选) | **multi-select** | `A) 沿用原专业  B) 转型方向  C) 桥接位置 (e.g. Solutions Eng / AI PM)  D) 让我推荐` |
| B4 | Senior + mentions both intern + new-grad | intern 还是 FT (可多选) | **multi-select** | `A) 仅 intern  B) 仅 new grad FT  C) 都看` — multi-select lets user pick "intern + new grad" without "都看" framing |
| B5 | No strong caliber signals | target 公司 tier (可多选) | **multi-select** | `A) 早期 startup  B) 中型 (Series B-C)  C) 大公司/上市` — multi-select lets user pick "startup + 大公司" while skipping mid (a common "barbell" pattern) |

### Hard cap on question count

- Always-ask: 5
- Conditional: 0-5 depending on resume
- **Cap: 10 questions total**. If your conditional logic would fire ≥6, pick the 5 highest-impact and skip the rest.

### How to ask

`AskUserQuestion` accepts **max 4 questions per call** (tool constraint).

- If total questions ≤ 4 → one call.
- If total > 4 (e.g. 5 always + 2 conditional = 7) → **two calls back-to-back**, first call = the 4 highest-decision-impact questions, second = the remainder.
- Hard cap: **2 calls total / 8 questions max**. If your logic would require more, drop the lowest-impact conditional ones.

Each question's options array has 4 entries (A/B/C/D). The user can pick any A/B/C/D OR use the auto-provided "Other" to type a free-text custom answer (Claude Code adds Other automatically — do NOT manually add an "E" option, it would be redundant + take a slot from real options).

Each question's first option should be the **AI-inferred default** based on the resume (so the user can rapid-fire pick all defaults and still get a sensible result). Use the `(Recommended)` suffix on the first option's label.

### Decision-impact ranking (for picking top 4 when needed)

In rough order:
1. A2 work authorization (controls visa-compatible filtering — affects what JDs are even visible)
2. A1 intern cycle target (controls which postings are timely)
3. A3 geographic flexibility (controls location filter)
4. B1 function preference (controls role_categories ranking) — only if triggered
5. B3 major-switch direction (controls whether to switch entire role_categories list) — only if triggered
6. B4 intern vs FT (controls seniority filter) — only if triggered
7. B2 industry preference (re-ranks industry_targets) — only if triggered
8. A5 onsite preference (refines location scoring)
9. A4 salary floor (refines scoring, soft signal)
10. B5 company tier (refines caliber calibration) — only if triggered

---

## Step 2.6 — Wait for answers

The user submits answers via the AskUserQuestion UI. You receive back the choice (or "Other" with custom text) for each question.

If user answered "Other" with free text:
- Parse the text into the appropriate field.
- Example: A2 "Other" with text "H-1B from current employer" → set `user_summary.work_authorization = "H-1B"`, `user_summary.needs_sponsorship = false`.
- Example: A3 "Other" with text "Boston + LA + Austin" → set `geographic_preference.preferred_metros = ["Boston", "Los Angeles", "Austin"]`.

If user did not answer (e.g. timed out, AskUserQuestion returned no answers): treat as accept-all-defaults — use each question's recommended option.

---

## Step 2.7 — Refine search_intent + profile with answers

Now you have the questionnaire results. Update your draft JSONs:

- **A1 → `search_intent.seniority`** + a new `target_cycle` field (`Summer 2026` etc.) → write into `search_intent.search_intent.seniority` and add `target_cycle` as a sibling field for the discovery layer.
- **A2 → `user_summary.work_authorization`** + `user_summary.needs_sponsorship`.
- **A3 → `geographic_preference.preferred_metros`** (expand based on choice) and `remote_acceptable`.
- **A4 → `salary_floor_hourly`** added to `search_intent.search_intent` as a new field — the AI scorer (Step 7) will consider it when JD lists comp.
- **A5 → `geographic_preference.work_mode_preference`** = `"onsite" | "onsite_pref" | "any" | "remote_only"`.
- **B1 (multi-select) → `function_area`** = **array** of selected functions (e.g. `["Product", "Operations", "Investment"]`). Re-derive `role_categories` to put HIGH-priority titles for EACH selected function, not just one.
- **B2 (multi-select) → `industry_targets`** = re-ranked list with selected industries first.
- **B3 (multi-select) → re-derive `role_categories`**: if user picked multiple paths, generate HIGH-priority entries for each path. Old single-track high entries become medium/low.
- **B4 (multi-select) → `seniority`** = derived: 1 choice ("仅 intern" / "仅 new grad FT") sets explicit; 2+ choices sets `"both"`.
- **B5 (multi-select) → `caliber_signals.target_company_tiers`** = array (e.g. `["early_startup", "large_public"]` for barbell pattern). Scorer uses this to weight which tier-of-companies to surface.

After refinement, your `profile.json` and `search_intent.json` are FINAL. Proceed to Step 3 (parse confirmation gate) with the refined versions.

---

## Step 3 — Write JSON + informed confirmation

Save both JSONs:

```bash
# Save what you produced (paste each JSON block to its file)
cat > "$MRWEIRDO_HOME/profile.json" << 'EOF'
<profile.json content from Step 2>
EOF

cat > "$MRWEIRDO_HOME/search_intent.json" << 'EOF'
<search_intent.json content from Step 2>
EOF

chmod 600 "$MRWEIRDO_HOME"/{profile.json,search_intent.json}
```

Then **show the user a parse summary and confirm via AskUserQuestion** — this is the only chance to spot a parse error before the agent starts spending applications. (The previous `sleep 5` opt-out window was unreachable from Bash since `sleep` cannot receive user input mid-execution.)

Display the summary in your assistant message:

```
我读完你的简历, parse 出:
   姓名:     <profile.personal.first_name> <profile.personal.last_name>
   邮箱:     <profile.personal.email>
   电话:     <profile.personal.phone>
   学校:     <profile.education.school> · <profile.education.major>
   毕业:     <profile.education.graduation_date>
   工签:     <profile.work_authorization.status> (sponsor=<needs_sponsor>)
   求职方向: <search_intent.search_intent.role_categories[0..3].title_pattern>
   行业:     <search_intent.search_intent.industry_targets[0..3]>
   地理:     <search_intent.geographic_preference.preferred_metros>
   排除:     <search_intent.exclude_role_keywords[0..5]>
```

Then ask once via AskUserQuestion (single-select, 2 options, "继续" is the default-recommended first option):

- **Question**: `上面的解析对吗？确认后立刻开始 discovery + AI scoring + 自动投递。`
- **Header**: `Resume parse`
- **Option A (default, first)**: label = `继续 — 解析正确`, description = `确认 profile/search_intent，进入 Step 4 init DB → discovery → 自动投递。`
- **Option B**: label = `停 — 解析有错`, description = `Skill 立即终止。用户 自己编辑 ~/.mrweirdo-jobs/{profile,search_intent}.json 后再次运行 /mrweirdo-onboard。`

If user picks B (or supplies "Other" custom text indicating disagreement): print which files to edit, then halt — do NOT proceed to Step 4. If user picks A: proceed to Step 4.

---

## Step 4 — Init / migrate jobs.db

```bash
node -e "import('$MRWEIRDO_REPO_ROOT/shared/local_db.mjs').then(m => m.initDb()).then(r => console.log(JSON.stringify(r)))"
# Expected: {"ok":true,"path":"~/.mrweirdo-jobs/jobs.db"}
```

The init is idempotent + handles pre-v2 schemas (adds 5 v2 columns via ALTER TABLE).

Generate a `discovery_run_id` for this run:

```bash
RUN_ID="run-$(date -u +%Y%m%dT%H%M%S)-$(openssl rand -hex 4)"
echo "Run ID: $RUN_ID"
```

---

## Step 5 — Discovery (multi-source dispatcher)

v2 fans out the user's keyword intent to ALL discovery sources in parallel via `shared/sourcing/dispatcher.mjs`. The platform list is fixed-broad regardless of major. The user's `search_intent.search_intent.role_categories[].title_pattern` is what scopes the search; LinkedIn and Indeed are permanently excluded (red line).

```bash
mkdir -p /tmp/mrweirdo-onboard

# Pass BROAD tokens to the dispatcher (per v2 design: bulk crawlers do a wide net,
# AI scoring in Step 7 does the precision filter using search_intent semantically).
# Lesson from initial Greenhouse bulk-crawl validation: literal multi-word phrases
# like "Product Manager Intern" match only ~2% of actual posted titles
# ("PM Intern, Summer 2026" / "Intern - Product" / "2026 Product Management Internship"
# / etc. all evade word-boundary literal match). Broader tokens like "Intern" surface
# 50-100x more candidates, with the AI scorer applying real relevance downstream.
#
# Derive seniority-keyword set from the user's A1 questionnaire answer:
#   - "intern" cycles → ["Intern", "Internship", "Co-op", "Coop", "Summer", "APM"]
#   - "new_grad_FT"   → ["New Grad", "New Graduate", "Early Career", "Associate", "Graduate"]
#   - "both"          → union of above
KEYWORDS_JSON=$(node -e "
const intent = JSON.parse(require('fs').readFileSync('$MRWEIRDO_HOME/search_intent.json'));
const s = intent.search_intent.seniority || 'intern';
const internKws = ['Intern', 'Internship', 'Co-op', 'Coop', 'APM', 'Summer'];
const ftKws = ['New Grad', 'New Graduate', 'Early Career', 'Associate', 'Graduate'];
const kws = s === 'intern' ? internKws : s === 'new_grad_FT' ? ftKws : [...internKws, ...ftKws];
console.log(JSON.stringify(kws));
")

node -e "
import('$MRWEIRDO_REPO_ROOT/shared/sourcing/dispatcher.mjs').then(async (m) => {
  const keywords = $KEYWORDS_JSON;
  process.stderr.write('[discovery] dispatching to ' + m.DEFAULT_SOURCES.join(', ') + '\n');
  process.stderr.write('[discovery] keywords: ' + keywords.join(' | ') + '\n');
  const result = await m.discoverAll({
    keywords,
    sources: m.DEFAULT_SOURCES,
    concurrency_per_source: 10,
    limit_per_source: 500,
    onProgress: (src, count) => process.stderr.write('  [' + src + '] ' + count + ' jobs\n'),
  });
  process.stderr.write('[discovery] total unique: ' + result.jobs.length + ' (after dedupe across sources)\n');
  if (result.errors.length) {
    for (const e of result.errors) process.stderr.write('  ERROR [' + e.source + ']: ' + e.error + '\n');
  }
  process.stdout.write(JSON.stringify(result.jobs));
});
" > /tmp/mrweirdo-onboard/discovered.json 2>>"$MRWEIRDO_HOME/log/onboard.log"

JOB_COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/mrweirdo-onboard/discovered.json')).length)")
echo "[discovery] $JOB_COUNT unique jobs across all sources"
```

**Coverage gate (v2 launch criterion per PRD §"Discovery sources & coverage matrix")**: if `JOB_COUNT < N` where N is the bucket-specific threshold for the user's major (see PRD), the dispatcher logs "deferred — bucket below threshold" and the run continues, but the final report surfaces this so the user knows v2 sources are insufficient for their field. v2.1 (Computer-Use-driven Handshake / Wellfound / school portals) is the unlock.

Sources currently active (per dispatcher's `DEFAULT_SOURCES`):
- `greenhouse_bulk` — ~thousands of companies via Greenhouse public board API
- `ashby_bulk` — Ashby public posting API
- `lever_bulk` — Lever public posting API
- `yc_waas` — YC's public Algolia + company directory
- `remoteok` — RemoteOK aggregator (remote-only, mostly tech)

Not currently in the default set:
- `wellfound` — gated stub (DataDome). Keep disabled until a CDP-backed implementation ships.

LinkedIn / Indeed / Glassdoor: **never** added to sources (red line — PRD §"Red lines: preserved").

---

## Step 6 — Hard filter (rule-based, no LLM)

Drop ≥80% noise via pure rules from `search_intent`. Cheap before scoring.

```bash
node -e "
const fs = require('fs');
const intent = JSON.parse(fs.readFileSync('$MRWEIRDO_HOME/search_intent.json'));
const jobs  = JSON.parse(fs.readFileSync('/tmp/mrweirdo-onboard/discovered.json'));

const excludes = (intent.search_intent.exclude_role_keywords || []).map(s => s.toLowerCase());
const allowedCountry = (intent.search_intent.geographic_preference?.primary_country || 'US').toLowerCase();
const remoteOK = intent.search_intent.geographic_preference?.remote_acceptable !== false;
const preferredMetros = (intent.search_intent.geographic_preference?.preferred_metros || []).map(s => s.toLowerCase());
const seniority = intent.search_intent.seniority || 'both';

function passesExclude(title) {
  const t = (title || '').toLowerCase();
  return !excludes.some(kw => {
    const re = new RegExp('\\\\b' + kw.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\\$&') + '\\\\b', 'i');
    return re.test(t);
  });
}

function passesLocation(loc) {
  if (!loc) return true;
  const l = loc.toLowerCase();
  if (remoteOK && (l.includes('remote') || l.includes('anywhere') || l.includes('worldwide'))) return true;
  if (preferredMetros.some(m => l.includes(m.toLowerCase()))) return true;
  // accept any US mention (US-focused MVP)
  if (allowedCountry === 'us' && (l.includes('united states') || l.includes('usa') || /\\bu\\.s\\.?\\b/.test(l))) return true;
  // reject clear non-US (expanded after T13 dogfood — RemoteOK leaked many foreign locales)
  const foreign = [
    // Europe
    'berlin', 'london', 'paris', 'amsterdam', 'madrid', 'barcelona', 'rome', 'milan',
    'lisbon', 'warsaw', 'prague', 'vienna', 'zurich', 'stockholm', 'copenhagen',
    'dublin', 'manchester', 'edinburgh', 'helsinki', 'oslo', 'budapest',
    // East Asia
    'tokyo', 'osaka', 'shanghai', 'beijing', 'shenzhen', 'hong kong', 'taipei',
    'seoul', 'singapore',
    // South/Southeast Asia
    'bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad', 'pune', 'chennai',
    'kuala lumpur', 'jakarta', 'manila', 'bangkok',
    // Middle East
    'dubai', 'abu dhabi', 'tel aviv', 'riyadh', 'doha', 'jeddah', 'kuwait',
    // Latin America
    'sao paulo', 'são paulo', 'rio de janeiro', 'brasil', 'brazil', 'mexico city',
    'buenos aires', 'lima', 'bogota', 'santiago', 'monterrey', 'guatemala',
    // Canada (intentionally excluded — most US users don't need TN/PR friction)
    'toronto', 'vancouver', 'montreal', 'calgary', 'ottawa',
    // Australia / NZ
    'sydney', 'melbourne', 'brisbane', 'auckland',
    // Africa
    'lagos', 'nairobi', 'cairo', 'cape town', 'johannesburg',
  ];
  if (foreign.some(f => l.includes(f))) return false;
  // country-name catch-all (covers locations rendered as just country)
  const foreignCountries = [' uae', 'united arab emirates', 'india', 'germany', 'france',
    'spain', 'italy', 'netherlands', 'sweden', 'norway', 'denmark', 'finland', 'poland',
    'mexico', 'colombia', 'argentina', 'chile', 'peru', 'japan', 'china', 'south korea',
    'thailand', 'vietnam', 'philippines', 'indonesia', 'malaysia', 'pakistan', 'bangladesh',
    'south africa', 'kenya', 'nigeria', 'egypt', 'saudi arabia', 'qatar', 'turkey', 'israel',
    'canada', 'australia', 'new zealand', 'austria', 'ireland', 'belgium', 'switzerland',
    'portugal', 'czechia', 'czech republic', 'hungary', 'greece', 'romania'];
  if (foreignCountries.some(c => l.includes(c))) return false;
  return true; // unknown → keep, scorer will judge
}

function passesSeniority(title, seniority) {
  const t = (title || '').toLowerCase();
  // hard reject senior / staff / principal / director / VP regardless of intent
  if (/\\b(senior|staff|principal|director|vp |head of |chief )\\b/.test(t)) return false;
  // intern-only mode: require explicit intern signal AND reject explicit FT signal
  if (seniority === 'intern') {
    const internSignal = /\\b(intern|internship|co-?op|summer|apm|fellowship)\\b/.test(t);
    const ftSignal     = /\\b(full[\\s-]?time|associate|new grad|new graduate|early career)\\b/.test(t);
    if (!internSignal || ftSignal) return false;
  }
  return true;
}

const kept = jobs.filter(j => passesExclude(j.title) && passesLocation(j.location) && passesSeniority(j.title, seniority));
process.stderr.write('[hard-filter] ' + jobs.length + ' → ' + kept.length + '\n');
process.stdout.write(JSON.stringify(kept));
" > /tmp/mrweirdo-onboard/filtered.json 2>>"$MRWEIRDO_HOME/log/onboard.log"

FILTERED_COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/mrweirdo-onboard/filtered.json')).length)")
echo "[hard-filter] $FILTERED_COUNT jobs after rule-based filter"
```

If `FILTERED_COUNT == 0`: report "no matches across all sources for your profile — likely needs v2.1 (Computer-Use Handshake / school portals / industry boards) for non-tech majors" and stop the run.

If `FILTERED_COUNT > 300`: cap to top 300 (sort by description length as quality proxy — longer JDs are more legit). Raised from 100 to give the AI scorer enough candidates that ~50–100 actually clear the fit≥7 gate.

```bash
node -e "
const fs = require('fs');
let jobs = JSON.parse(fs.readFileSync('/tmp/mrweirdo-onboard/filtered.json'));
if (jobs.length > 300) {
  jobs.sort((a, b) => (b.description?.length || 0) - (a.description?.length || 0));
  jobs = jobs.slice(0, 300);
}
fs.writeFileSync('/tmp/mrweirdo-onboard/to_score.json', JSON.stringify(jobs));
console.log('to_score:', jobs.length);
"
```

---

## Step 7 — AI scoring (main agent, batches of 50)

**This step is done by you (the main agent session)**, not a subprocess.

Read the scoring prompt:
```bash
cat $MRWEIRDO_REPO_ROOT/shared/scoring/score_prompt.md
```

Read `$MRWEIRDO_HOME/search_intent.json` (use Read tool — you need this in context).

Read recent feedback for skip-pattern injection:
```bash
test -f $MRWEIRDO_HOME/feedback.jsonl && tail -20 $MRWEIRDO_HOME/feedback.jsonl || echo "(no prior feedback)"
```

Read `/tmp/mrweirdo-onboard/to_score.json` and chunk into batches of 50.

For each batch (4–6 batches typical at 300 jobs cap):
- Apply the `score_prompt.md` instructions
- Output the JSON array `[{ apply_url, fit_score, role_type_match, recommended, dim_scores, key_alignment, key_gaps, honest_reason }, ...]`
- Write the batch result to `/tmp/mrweirdo-onboard/scored-batchN.json`

After all batches, merge:
```bash
node -e "
const fs = require('fs');
const files = require('child_process').execSync('ls /tmp/mrweirdo-onboard/scored-batch*.json').toString().trim().split('\n');
const merged = [].concat(...files.map(f => JSON.parse(fs.readFileSync(f))));
fs.writeFileSync('/tmp/mrweirdo-onboard/scored.json', JSON.stringify(merged));
console.log('scored:', merged.length);
"
```

---

## Step 8 — Auto-apply gating (write to DB + mark eligible)

Joins scoring results back to the discovery records, writes to jobs.db, computes `auto_apply_eligible`.

```bash
node -e "
const fs = require('fs');
const path = require('path');
const repo = process.env.MRWEIRDO_REPO_ROOT;
const home = process.env.MRWEIRDO_HOME;
const RUN_ID = process.env.RUN_ID;
const THRESHOLD = 7;

(async () => {
  const db = await import(repo + '/shared/local_db.mjs');
  // v2 quota guard: examples/lee_company_list.json provides the baseline of large-capped companies
  // (用户's curated list; users can override with ~/.mrweirdo-jobs/company_list.user.json).
  // Best-effort: missing file → no quota guard active.
  const candidatePaths = [
    process.env.MRWEIRDO_HOME + '/company_list.user.json',
    repo + '/examples/lee_company_list.json',
  ];
  let companies = { companies: [] };
  for (const p of candidatePaths) {
    try {
      companies = JSON.parse(fs.readFileSync(p, 'utf8'));
      break;
    } catch (_) {
      // try next
    }
  }
  const cappedNames = new Set();
  for (const c of (companies.companies || [])) {
    if (c.apply_quota?.enabled) cappedNames.add(c.name.toLowerCase());
  }

  const filtered = JSON.parse(fs.readFileSync('/tmp/mrweirdo-onboard/to_score.json'));
  const scored = JSON.parse(fs.readFileSync('/tmp/mrweirdo-onboard/scored.json'));
  const byUrl = new Map(scored.map(s => [s.apply_url, s]));

  function platformFromUrl(url) {
    const u = (url || '').toLowerCase();
    if (u.includes('greenhouse.io')) return 'greenhouse';
    if (u.includes('ashbyhq.com'))   return 'ashby';
    if (u.includes('lever.co'))      return 'lever';
    if (u.includes('jobs.smartrecruiters.com')) return 'smartrecruiters';
    if (u.includes('icims.com')) return 'icims';
    if (u.includes('jobs.jobvite.com')) return 'jobvite';
    if (u.includes('joinhandshake.com')) return 'handshake';
    if (u.includes('myworkdayjobs.com')) return 'workday';
    return 'other'; // includes remoteok aggregator pages
  }

  // Public beta stable auto-submit path. Lever is discoverable/scored but
  // excluded from batch auto-submit until the CDP upload "100MB" issue is fixed.
  const SUPPORTED_AUTO = new Set(['greenhouse', 'ashby']);

  let eligible = 0;
  let stored  = 0;
  for (const j of filtered) {
    const s = byUrl.get(j.apply_url) || {};
    const platform = platformFromUrl(j.apply_url);
    const capped = cappedNames.has((j.company || '').toLowerCase());
    const passThreshold = (s.fit_score ?? 0) >= THRESHOLD;
    const ok = passThreshold && !capped && SUPPORTED_AUTO.has(platform);

    const row = {
      company: j.company || '(unknown)',
      title: j.title,
      apply_url: j.apply_url,
      location: j.location,
      source: j.source || j._discovery_source || 'unknown',
      status: '🤖 AI sourced',
      fit_score: s.fit_score ?? null,
      key_gaps: Array.isArray(s.key_gaps) ? s.key_gaps.join(' / ') : null,
      role_type_match: s.role_type_match || null,
      dim_scores: s.dim_scores || null,
      ats_platform: platform,
      apply_quota_limit: capped ? 1 : null,
      scored: s.fit_score != null ? 1 : 0,
      auto_apply_eligible: ok ? 1 : 0,
      search_source: j._discovery_source || j.search_source || j.source || 'unknown',
      discovery_run_id: RUN_ID,
      user_note: s.honest_reason || null,
    };
    await db.upsertJob(row);
    stored++;
    if (ok) eligible++;
  }

  process.stderr.write('[db] stored=' + stored + '  eligible=' + eligible + '\n');
  process.stdout.write(JSON.stringify({ stored, eligible }));
})();
" > /tmp/mrweirdo-onboard/db_result.json 2>>"$MRWEIRDO_HOME/log/onboard.log"

cat /tmp/mrweirdo-onboard/db_result.json
```

---

## Step 9 — Today's submission count (informational, no cap)

```bash
TODAY=$(date -u +%Y-%m-%d)
TODAY_COUNT=$(grep -c "\"date\":\"$TODAY\"" "$MRWEIRDO_HOME/daily_count.jsonl" 2>/dev/null || echo 0)
echo "[info] $TODAY_COUNT submissions already logged today (no daily cap — apply count is user-driven)."
```

Daily blanket cap was removed by user decision (2026-05-26). Per-company quota (Step 8 `quota_guard_enabled`) is still active — that protects against Cloudflare / Google / etc. flagging us as a bot when we'd otherwise mass-apply to 8 openings in one batch.

---

## Step 10 — Auto-apply dispatch loop

For each eligible row in `v_auto_apply_eligible`, dispatch to the platform's `-auto` skill. Public beta default: process at most 10 rows per run unless the user explicitly asks for a bigger batch. Lee/maintainers can override with `MRWEIRDO_MAX_AUTO_APPLY=50`.

```bash
MAX_AUTO_APPLY="${MRWEIRDO_MAX_AUTO_APPLY:-10}"
MRWEIRDO_MAX_AUTO_APPLY="$MAX_AUTO_APPLY" node -e "
import('$MRWEIRDO_REPO_ROOT/shared/local_db.mjs').then(async (m) => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(m.dbPath());
  const maxRows = Math.max(1, Number(process.env.MRWEIRDO_MAX_AUTO_APPLY || 10));
  const rows = db.prepare('SELECT id, company, title, apply_url, ats_platform, fit_score FROM v_auto_apply_eligible ORDER BY fit_score DESC, updated_at DESC LIMIT ?').all(maxRows);
  for (const r of rows) console.log(JSON.stringify(r));
});
" > /tmp/mrweirdo-onboard/queue.jsonl

QUEUE_SIZE=$(wc -l < /tmp/mrweirdo-onboard/queue.jsonl)
echo "[apply] dispatching $QUEUE_SIZE rows (cap=$MAX_AUTO_APPLY)"
```

**Per row in the queue**: invoke the matching platform skill **inline** (you, the main agent, follow each sub-skill's instructions per row):

- `ats_platform == 'greenhouse'` → follow `.claude/skills/mrweirdo-greenhouse-auto/SKILL.md` for that URL. After `GH.fillForm` and the gap-fill pass (Step 5.5 in that skill), upload the resume and submit.
- `ats_platform == 'ashby'`      → follow `.claude/skills/mrweirdo-ashby-auto/SKILL.md`. Ashby's `fillForm` returns a `plan` array that MUST be dispatched via `shared/sourcing/_executors/ashby_plan_executor.mjs` (the skill walks you through the call). Don't try to dispatch typetext from in-page JS — Ashby's react-hook-form requires CDP `Input.insertText` (`isTrusted=true`).
- `ats_platform == 'lever'`      → do not auto-submit in public beta. Mark skipped with `skip_reason='lever_upload_unstable_public_beta'` unless the user explicitly chose a manual Lever single-URL flow.

After EACH successful auto-submit, append to `daily_count.jsonl`:

```bash
echo "{\"date\":\"$TODAY\",\"company\":\"$COMPANY\",\"apply_url\":\"$URL\",\"submitted_at\":\"$(date -u -Iseconds)\"}" >> "$MRWEIRDO_HOME/daily_count.jsonl"
```

And mark the DB row:

```bash
node -e "
import('$MRWEIRDO_REPO_ROOT/shared/local_db.mjs').then(async (m) => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(m.dbPath());
  db.prepare(\"UPDATE jobs SET status='✅ 已投', auto_submitted_at=datetime('now'), bot_note='mrweirdo-onboard v2 auto-apply' WHERE id = ?\").run($ROW_ID);
});
"
```

Failure handling per row (PRD §Verification §4):
- Form selector miss / network timeout / CAPTCHA appears → log to `feedback.jsonl` with `outcome='skip'`, mark `status='⚠️ 跳过未投'`, **continue to next row** (don't abort batch)
- **NEVER retry an apply more than once per onboard run** (avoid duplicate submissions if uncertain)

---

## Step 11 — Final report + cleanup first-run sentinel

After the dispatch loop finishes:

1. **Print the report** (template below).
2. **Then delete the first-run sentinel** so subsequent runs use the compact preamble:
   ```bash
   [ -f "$MRWEIRDO_HOME/.first_run" ] && rm -f "$MRWEIRDO_HOME/.first_run"
   ```
   (If the run failed before Step 10, leave the sentinel — next run still deserves the full Welcome.)

Report template:

```
=== mrweirdo-onboard run-$(RUN_ID) report ===

简历:       $(profile.personal.first_name) $(profile.personal.last_name) · $(profile.education.school) · $(profile.education.major)
方向:       $(search_intent.role_categories[0..2].title_pattern)

Discovery:  $SOURCES_USED → $JOB_COUNT raw → $FILTERED_COUNT after hard-filter → $SCORED_COUNT scored
Auto-applied: $N_SUBMITTED 家
  - greenhouse:  $N_GH
  - ashby:       $N_ASHBY
  - lever:       $N_LEVER

Skipped (rule):
  - large-company quota guard:  $N_CAPPED 家 (Google/Meta/... — use /mrweirdo-cherry-pick)
  - other-platform unsupported: $N_OTHER 家 (SmartRecruiters/iCIMS/JobVite/Handshake — v2.4+)
  - fit_score < 7:              $N_LOW 家

Failures (auto-apply error):    $N_FAIL 家 (logged to ~/.mrweirdo-jobs/log/onboard.log)

📂 Your local database: ~/.mrweirdo-jobs/jobs.db
  Everything from this run is here. You can inspect it any time:

  • Browse in browser:
      datasette serve ~/.mrweirdo-jobs/jobs.db --open

  • Top fits (CLI):
      sqlite3 ~/.mrweirdo-jobs/jobs.db "SELECT company,title,fit_score,status FROM jobs ORDER BY fit_score DESC LIMIT 30;"

  • What got filtered out:
      sqlite3 ~/.mrweirdo-jobs/jobs.db "SELECT company,title,skip_reason FROM v_skipped;"

  • Score distribution:
      sqlite3 ~/.mrweirdo-jobs/jobs.db "SELECT fit_score, COUNT(*) FROM jobs GROUP BY fit_score ORDER BY fit_score DESC;"

Next steps:
  1. 等 Gmail confirmation 邮件 (15min – 24h)
  2. (可选) 跑 /mrweirdo-confirm 自动 sync confirmations 进 DB
  3. (可选) 想投大公司？跑 /mrweirdo-cherry-pick

⚠️ Coverage reminder: current public ATS sources still skew startup/tech-adjacent.
   If this student's field is healthcare, education, government, arts, or other
   non-tech-heavy paths, the queue may be thin until more industry-specific
   sources are added.
```

---

## What this skill explicitly DOES NOT do

- Does not ask for per-application approval after resume, questionnaire, and parse confirmation
- Does not preview every application before submitting (parse confirmation gate is in Step 3)
- Does not touch LinkedIn / Indeed / Glassdoor (permanent red line)
- Does not auto-submit to large-quota companies (use `/mrweirdo-cherry-pick`)
- Does not auto-submit to SmartRecruiters / iCIMS / JobVite / Handshake / Workday (current stable batch scope — those use v1 half-auto helpers manually)
- Does not invent personal info / answer JD questions creatively (verbatim only)
- Does not retry a failed apply (one shot per row)

## Critical do-nots

- ❌ Do NOT pause to ask user "OK to submit?" — that breaks v2 design
- ❌ Do NOT skip the explicit parse confirmation gate in Step 3 — that is the safety net against bad resume parses
- ❌ Do NOT batch-submit at >1/15s aggregate cadence (looks like a bot to ATS) — Step 10 should pace 30-90s between submits with jitter
- ❌ Do NOT commit `~/.mrweirdo-jobs/` contents to git (all is user-private state)
- ❌ Do NOT use the v1 `shared/matching/ai_scorer.mjs` (deleted) or `shared/onboarding/resume_parser.mjs` (deleted). All LLM work is inline by you in this skill.

---

## Pacing between auto-submits

Use a jitter sleep between rows in Step 10:

```bash
sleep $((30 + RANDOM % 60))   # 30–90s between auto-submits
```

This mimics human pacing + spreads load across the day. With the public beta default cap of 10 rows, expect roughly 15–30 minutes for the apply phase after discovery/scoring. Larger explicit batches take longer: ~50 rows can take about 75 minutes, ~100 rows can take 2.5 hours.
