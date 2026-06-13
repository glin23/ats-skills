# Intake And Profile Reference

Use this reference during `/mrweirdo-onboard` Steps 1-3.

## Hard-Boundary Questions

Ask only the facts that must not be inferred. Use one UI call for A0/A1/A2
before discovery; do not split these into separate confirmation moments.

| ID | Question | Options |
|---|---|---|
| A0 | Work authorization | US citizen / green card; F-1 CPT/OPT; F-1 now and future sponsorship; other |
| A1 | Geography | current/school metro only; named metros; anywhere in the US; user-listed countries |
| A2 | Legal attestations | ask/skip sensitive legal questions when needed; explicitly confirm no blocking obligations/prohibited-possessor issue; other/uncertain |

Parse A1 into:

- `fixed_metros`: local only, no relocation.
- `selected_metros`: user-named metros.
- `anywhere_primary_country`: US only, relocation OK.
- `anywhere_legal_work`: exact user-listed countries, relocation OK.

Write A2 legal defaults only when explicitly confirmed. Otherwise keep nullable
fields null and let drivers skip legally sensitive rows. The recommended A2
default is ask/skip until a real form needs the fact.

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
