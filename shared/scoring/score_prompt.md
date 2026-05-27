# Job Fit Scorer — Inline Scoring Prompt (v2)

> **Used by**: `.claude/skills/mrweirdo-onboard/SKILL.md` (and any future re-score skill).
> The main agent session reads this as part of the SKILL.md flow and applies it to a batch of jobs in one turn. No separate API call.

You are scoring how well a specific job listing matches the user's **search_intent** (derived from their resume). Output strict JSON per the schema below — one object per job.

---

## Inputs you have in context

1. **`search_intent.json`** — the user's AI-derived job-search intent. Keys to use:
   - `user_summary.field_of_study`, `user_summary.school`, `user_summary.education_level`, `user_summary.year_or_status`, `user_summary.work_authorization`, `user_summary.needs_sponsorship`
   - `search_intent.role_categories[]` (each has `title_pattern`, `priority`, `rationale`) — what the user is looking for
   - `search_intent.industry_targets[]`
   - `search_intent.function_area` (may be null)
   - `search_intent.exclude_role_keywords[]` — titles that should kill the score
   - `search_intent.geographic_preference` (`primary_country`, `preferred_metros`, `remote_acceptable`)
   - `search_intent.seniority` (`intern` / `new_grad_FT` / `both`)
   - `search_intent.caliber_signals.competitive_strengths[]` and `growth_areas[]` — calibrate which-tier-of-company is realistic for this user

2. **Recent skip feedback** (last 20 entries from `~/.mrweirdo-jobs/feedback.jsonl`) — patterns the user has already rejected. **Don't recommend more of the same.** Inject the gist of these into your reasoning.

3. **A batch of jobs to score** — each with `company`, `title`, `location`, `description` (truncated), `source` (e.g. `remoteok`), `apply_url`, and the platform.

---

## Output — strict JSON per job

For each job in the batch, output one object in this exact shape (no preamble, no markdown fence):

```json
{
  "apply_url": "https://...",
  "fit_score": 7,
  "role_type_match": "intern",
  "recommended": true,
  "dim_scores": {
    "role_fit": 8,
    "skills_match": 7,
    "location_fit": 9,
    "visa_compatible": 8,
    "seniority_match": 9,
    "exclude_check": 10
  },
  "key_alignment": ["..."],
  "key_gaps": ["..."],
  "honest_reason": "1-2 sentence summary."
}
```

Return the whole batch as a JSON array `[ {...}, {...}, ... ]`.

---

## Field rules

- `apply_url` — copy verbatim from input. Used to join scores back to the DB row.
- `fit_score` — integer 0–10.
- `role_type_match` — one of `"intern"`, `"new_grad_FT"`, `"other"`. Derive from job title + description versus `search_intent.seniority`.
- `recommended` — boolean. **True iff every `dim_scores` value is ≥ 5 AND `fit_score` ≥ 6.** (Conservative.)
- `dim_scores` — all six keys required, each integer 0–10:
  - **role_fit**: does the role description match the user's `search_intent.role_categories` + `industry_targets` + `function_area`? High if the role is in one of the user's high-priority categories; medium if adjacent; low if unrelated to the user's resume trajectory.
  - **skills_match**: overlap between user resume's skills/projects and the JD's stated requirements.
  - **location_fit**: 10 if remote and `geographic_preference.remote_acceptable`; 8–10 if location matches a `preferred_metros` entry; 5–7 if same country (`primary_country`) but unfamiliar metro; 0–3 if outside `primary_country`.
  - **visa_compatible**: 10 if explicitly says "no sponsorship needed" matches user (`needs_sponsorship == false`) OR "sponsors visa" matches user (`needs_sponsorship == true`); 5 if not mentioned (default unknown); 0–2 if JD says "no sponsorship" and user needs it.
  - **seniority_match**: 10 if `role_type_match == search_intent.seniority` OR `search_intent.seniority == "both"`; 4–6 if adjacent (e.g. user wants intern, role is new-grad); 0–2 if clearly mid-senior FT and user is intern.
  - **exclude_check**: 10 if title contains NO `search_intent.exclude_role_keywords[]` (case-insensitive whole-word match); 0 if any exclude keyword matched. **Binary.**
- `key_alignment` — 1–3 concrete short strings: specific reasons the user is well-matched. Reference actual things from resume/intent. ❌ "good fit"  ✅ "Marketing concentration + 2 prior brand internships align with brand-marketing intern title".
- `key_gaps` — 1–3 concrete short strings: specific reasons it might not be a fit. ❌ "some skills missing"  ✅ "JD requires SQL + Tableau; user resume only mentions Excel".
- `honest_reason` — 1–2 sentence overall summary. Match the score — don't be flattering when score is low.

---

## Hard exclusions (force score down)

These override scoring rubrics:

- **Exclude keyword match**: any of `search_intent.exclude_role_keywords` appears as a whole word in the job title → set `exclude_check = 0`, subtract 5 from `fit_score`, set `recommended = false`. **This is a hard block.** Example: a marketing student's intent has `"software engineer"` in excludes; if title is "Software Engineer Intern", drop the score.
- **Wrong role type**: user wants intern but job is clearly senior FT (e.g. title "Senior Manager"); user wants new_grad_FT but job is internship → `seniority_match ≤ 3`, fit_score reduced accordingly.
- **Recruiter-FOR-students role**: job title is "University Recruiter" / "Campus Recruiter" / "Talent Acquisition Specialist" — this is recruiting people LIKE the user, not a role FOR the user. `fit_score ≤ 2`.
- **Location hard miss**: location explicitly outside `primary_country` (e.g. "Berlin, Germany" when user wants US) AND not remote → `location_fit ≤ 2`, fit_score reduced.

---

## Caliber calibration

Use `search_intent.caliber_signals` to keep the funnel honest:

- If `caliber_signals.competitive_strengths` is rich (prior FAANG internships, top-tier school, top-tier GPA, published work) → user is competitive for high-tier roles; full score range available.
- If `caliber_signals.growth_areas` includes "first internship search" / "early academic stage" / "no industry experience yet" → cap `fit_score ≤ 8` for FAANG-equivalent positions (the user has real shot but should weigh smaller / friendlier companies higher). For roles at smaller companies / less-prestigious brands, no cap.

---

## Be honest, not generous

The user does NOT review these — they auto-apply when `fit_score ≥ threshold`. **False positives directly translate to wasted applications + potential ATS account flags.** When in doubt between adjacent scores, pick the lower one. When a role is clearly wrong, score it < 4 and let the rule-based gating filter it out.

---

## Output discipline

Output ONLY the JSON array. No preamble, no markdown fence, no commentary. Each object's `apply_url` must match an input job's `apply_url` exactly so the SKILL.md driver can join scores back to DB rows.
