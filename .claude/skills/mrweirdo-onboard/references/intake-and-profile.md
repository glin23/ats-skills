# Intake And Profile Reference

Use this reference during `/mrweirdo-onboard` Steps 1-3.

## Hard-Boundary Questions

Ask only the facts that must not be inferred. Use one UI call for A0/A1/A2
before discovery; do not split these into separate confirmation moments.

| ID | Question | Options |
|---|---|---|
| A0 | Which kind of person are you (three yes/no questions, see below) | yes / no / “说不清楚” on Q3 only |
| A1 | Geography | current/school metro only; named metros; anywhere in the US; user-listed countries |
| A2 | Legal attestations + age | ask/skip sensitive legal questions when needed; explicitly confirm no blocking obligations/prohibited-possessor issue, and confirm 「你已满 18 岁了吗」 in the same breath; other/uncertain |

### A0: ask what he is, never whether he is authorized

拍板原话（关卡 3 ①）：问「你是美国公民或绿卡吗？」「你是持 F-1 的留学生吗？」，
**不许问「你有没有工作授权」——这没人能知道**。「有没有工作授权」是一个法律结论：
对 F-1 学生来说，它取决于岗位能不能走 CPT、学校批不批、什么时候批。让用户自己下这个结论，
答错了两个方向都伤他（国际生说「有」是不实陈述，公民说「没有」会被直接刷掉）。
所以只问他能从自己证件上读出来的事实，结论交给代码推。

Ask in order and stop as soon as the answers settle the case. The exact wording
lives in `shared/work_auth_identity.mjs` (`IDENTITY_QUESTIONS`) — read it from
there rather than retyping it, so the guide and the code cannot drift:

1. Q1（总是问）：你是美国公民，或者持有绿卡（永久居民卡）吗？
2. Q2（Q1 答否时问）：你是持学生签证在美国读书的留学生吗？（就是学校给你办的那种身份）
3. Q3（Q2 答是时问）：你现在手上已经有一份批下来的、允许你在美国工作的证件吗？
   —— 三档：`有` / `还没有（正常，大多数人在这一档）` / `说不清楚`。
   后两档都不是「不合格」，它们只是往下多问一题。
4. Q4（Q3 答「还没有 / 说不清楚」时问；Q2 答否时紧接 Q5 之后也问）：
   投递表单会问一句「你现在有在美国工作的许可吗」。这道题我不能替你判断——没有人能替别人下这个判断。所以我只问你一句：碰到这道题，你要我怎么办？
   —— 三档：`填「有」` / `填「没有」` / `这类题别替我答——碰到就停下，把这些岗位单独列给我`（**默认**）。
   —— **必带提示，一个字都不许省**（`Q4_NOTICE`，关卡 8 决定一）：选「填有」或「填没有」的话，
   **这三个字会被原样打到真实雇主的表单上**；不确定就先选默认那档，随时能改。
5. Q5（只在 Q2 答否时问）：将来你想在美国长期工作的话，需要公司帮你办手续吗？
   —— 三档：`需要` / `不需要` / `说不清楚`。「说不清楚」零代价，它只是走 Q4 那一档。

问句与选项的准确文案一律从 `IDENTITY_QUESTIONS` / `Q4_NOTICE` 读，不要在这里重新打一遍。
它们仍然放在**同一个** AskUserQuestion 调用里（与 A1/A2 一起，不拆成多轮确认）：后面几题
各带一个「不适用（上一题已经答完了）」选项。「不适用」= 没问过 = `null`，
不要把它当成「否」——`workAuthAnswers()` 会因为上一题已定案而拒绝一个多余的答案并报错，
这是故意的：它宁可报错也不猜。

把答案交给 `workAuthAnswers()`，用它返回的 **`write_groups`**（一组一次
`shared/record_profile_answers.mjs`，`--source` 用组里那个）——**分两组是关键**：
他自己说的（`user_answer`）和我们按身份推的（`onboarding_a0`）在档案里字节相同，
只有留痕能分开它们。**它只写它能确定的格子**：一个还没拿到证件的留学生，
`authorized_to_work_us` **一格都不写**（除非他在 Q4 里明说要填什么；写 `false`
与「用户亲口说没有」在档案里字节相同，而且会让他被雇主直接刷掉）。
`requires_sponsorship_future` 对全部留学生情形都是 `true`（包括「说不清楚」那一档），
这一格是身份本身决定的、能推。

**上手门槛的账（写在明处，不许说成「问题数没变」）**：公民 / 绿卡 **1 题**；
已有证件的留学生 **3 题**；常态留学生 **4 题**；其他情形 **4 题**（Q1/Q2/Q5/Q4）。

Parse A1 into:

- `fixed_metros`: local only, no relocation.
- `selected_metros`: user-named metros.
- `anywhere_primary_country`: US only, relocation OK.
- `anywhere_legal_work`: exact user-listed countries, relocation OK.

Write A2 legal defaults only when explicitly confirmed. Otherwise keep nullable
fields null and let drivers skip legally sensitive rows. The recommended A2
default is ask/skip until a real form needs the fact.

A0 and A2 answers must reach `profile.json` through
`shared/record_profile_answers.mjs` (see `run-and-database.md`), not by writing
the file by hand. The four `work_authorization` keys are three-state — `true`,
`false`, or `null` meaning "never asked".

If the answers do not settle `authorized_to_work_us` / `requires_sponsorship_future`
(Q3 answered “说不清楚”, or a status other than citizen/green card/F-1), those keys
stay `null` — and that is **not** a normal path to be left alone. The batch cannot
start with them unanswered, so say all three of these to the user in the same
breath, before he walks away thinking he is set up:

1. 卡在哪：投递表单几乎每一份都会问工作身份，这一格没人能替他猜。
2. 去哪里查 —— 三个具体去处，读 `WHERE_TO_CHECK` from `shared/work_auth_identity.mjs`
   （学校国际学生办公室 / I-20 第 2 页 Employment Authorization 那一栏 / EAD 卡）。
3. 查清楚之前会怎样：这一批先不投，查到了说一声，一条命令就能续上，排好的队列不会白排。

The pre-batch gate repeats the same three things and marks `asked_in_this_batch`
once he has answered once, so nobody asks him the same unanswerable question twice.

A2 的年龄半句（关卡 2 ②）：与法律声明同一组里顺带确认「你已满 18 岁了吗」，**不新增独立问题**。
档案里目前还没有这一格（`legal_attestations.at_least_18` 与驱动侧的三态判定一起落地，
见设计稿 §10-C）；在那之前只问、不手写档案——`record_profile_answers.mjs` 会拒绝一个
没有任何问题声明过的路径，这是设计如此，不要绕过它。

## Profile Generation Prompt

Analyze the resume PDF plus the self-introduction and produce three JSON artifacts:

1. `profile.json`: ATS form-fill facts.
2. `search_intent.json`: what jobs to discover and score.
3. `essay_profile.json`: reusable writing memory for essays/cover letters.

Principles:

- Serve any US college student: business, CS, nursing, engineering, arts, public health, journalism, etc.
- Read the resume's actual trajectory. Do not hard-code PM/growth/startup assumptions.
- Treat the user's self-reported target functions as the anchor when provided.
  The major is evidence, not destiny: never infer that the target function must
  equal the major, and never override an explicit target function just because
  the degree points elsewhere.
- Use specific role titles recruiters post, not generic "internship".
- Prefer honesty over flattery. Caliber and gaps must reflect the real resume.
- Never invent personal info. Unknown facts stay null or become ask/skip blockers.
- Keep every writing claim grounded in the resume, self-introduction, or explicit answers.

Required `profile.json` shape:

- `personal`: name, email, phone, LinkedIn/GitHub/website if present, address if present.
- `education`: school, degree, major, graduation date, GPA only if known.
- `work_authorization`: use the runtime shape from `shared/profile.template.json`:
  - `visa_status`: human-readable status such as `US Citizen`, `Green Card`, `F-1 CPT`, `F-1 OPT`, `H-1B`, or `Other`.
  - `authorized_to_work_us`: boolean or null.
  - `requires_sponsorship_now`: boolean or null.
  - `requires_sponsorship_future`: boolean or null.
  - Do not emit only `status`, `needs_sponsor`, or `sponsor_when`; the application drivers do not rely on those legacy keys.

Example runtime shape:

```json
"work_authorization": {
  "visa_status": "F-1 OPT eligible",
  "authorized_to_work_us": true,
  "requires_sponsorship_now": false,
  "requires_sponsorship_future": true
}
```

- `legal_attestations`: nullable unless explicitly confirmed.
- `demographics`: nullable unless explicit.
- `experience_summary`: top recent experiences with key skills.
- `skills`, `languages`, `resume_path`, `standard_qa`, `target_filters`.

Required `search_intent.json` guidance:

- Set `role_type_targets` using only `intern`, `part_time`, `new_grad_FT`.
- Keep legacy `seniority` aligned: `intern`, `part_time`, `intern_or_part_time`, `new_grad_FT`, or `both`.
- Always produce `target_function_anchor` per
  `shared/intelligence/intent_schema.json`: include
  `self_reported_target_functions`, `resume_supported_functions`,
  `adjacent_functions`, `excluded_functions`, and `rationale`. In
  `excluded_functions`, list functions that clearly sit outside the user's
  target-function anchor and should not auto-submit, such as SWE/Nursing/Design/Data
  for an Operations/PM target. Never populate exclusions solely from the user's
  major; use explicit target direction plus resume-supported evidence.
- Generate 5-10 `role_categories` from the user's self-reported target
  functions plus resume-supported evidence:
  - high = direct target-function match;
  - medium = clearly adjacent function;
  - low = exploratory but still adjacent to the target function.
- Do not create cross-functional exploratory categories. For example, an
  Operations/PM target can include Ops, PM, BizOps, Strategy, APM, or Program
  Management, but not SWE, Nursing, Design, or Data unless the user explicitly
  asks for those functions. A SWE target can include Software Engineering,
  Backend, Frontend, Full-Stack, Platform, DevOps, QA, or closely adjacent
  technical roles, but not unrelated marketing/accounting/nursing/design roles.
- Generate `exclude_role_keywords` only for obvious noise or functions that are
  clearly outside the user's target-function anchor. Do not add exclusions just
  because the user's major differs from the target function.
- Default `geographic_preference.primary_country` to US unless the user says otherwise.
- Use the hard-boundary geography answer for metros, countries, relocation policy, and remote acceptability.

Required `essay_profile.json` guidance:

- Preserve `self_intro_raw`.
- Include writing voice, candidate positioning, proof points, project stories, role/industry banks, cover-letter defaults, `hard_no_claims`, and `dynamic_questions_to_ask_later`.
- Put unconfirmed sensitive or personal facts in `hard_no_claims`.

## Adaptive Follow-Up Rules

After the first draft, ask follow-ups only for real ambiguity that would
materially change discovery keywords. Do not re-ask hard-boundary questions
unless the answer was unusable.

Allowed adaptive follow-ups:

- Multiple functions in resume: ask target functions using three resume-derived options.
- Senior / mixed signals: ask internship, part-time, new-grad, or multiple.

Limits:

- Maximum 3 adaptive follow-up questions.
- Maximum 1 adaptive follow-up UI call.
- First option should be the AI-inferred default and labeled recommended.
- Industry, company tier, and writing-emphasis ambiguity should normally be
  inferred from the resume/self-intro, marked `[推断，可改]`, and left for the
  soft correction window.

## Parse Soft Window

Before discovery, show a concise parse summary:

- name, email, phone
- school, major, graduation date
- work authorization and sponsorship using `visa_status`, `authorized_to_work_us`, `requires_sponsorship_now`, and `requires_sponsorship_future`
- top job directions and industries
- geography/relocation policy
- strongest writing themes
- hard no-claims
- exclude keywords

Do not require an independent hard confirmation before discovery. Tell the user
discovery is read-only and can run while they correct the parse. Mark inferred
soft fields as `[推断，可改]`. Hard-boundary facts must come from A0/A1/A2 or
stay nullable/blocking; never mark visa, GPA, demographic, legal attestation,
background-check, relocation, or salary-acceptance facts as inferred.

If the user corrects identity facts, update the JSON and continue. If the user
changes target direction, update JSON and rerun discovery. Identity facts are
shown again in the queue gate before any real submission.
