---
name: mrweirdo-upskill
description: Generate a read-only upskill report from Mr. Weirdo Jobs scored rows. Trigger when the user asks what skills to improve, wants an upskill plan, or wants to analyze recurring key_gaps. Reads jobs.db and may research current learning resources, but never fabricates resources and never changes profile/search config automatically.
---

# Mr. Weirdo Upskill

Use this skill to turn scored job gaps into a learning plan.

## Trigger

- "我该补什么技能"
- "生成 upskill 报告"
- "哪些 gap 最影响我"
- `/mrweirdo-upskill`

## Run The Local Aggregation

```bash
cd "$MRWEIRDO_REPO_ROOT"
node shared/upskill_report.mjs --json
```

Open the generated Markdown report. It contains:

- role category;
- normalized gap;
- weighted frequency using `(10 - fit_score) / 10`;
- example companies/roles;
- diff from the previous report when one exists.

## Resource Research

If the user asks for learning resources, search the web using current-year
queries. Never fabricate resources, course names, pricing, availability, or
links. Prefer official docs, university/open-course pages, and reputable
provider pages. Include links.

Keep recommendations practical:

- 2-3 priority gaps;
- one short project or proof artifact per gap;
- one resource per gap unless the user asks for more.

## Hard Rules

- Read-only: do not update `jobs.db`, `profile.json`, or `search_intent.json`.
- Do not turn a gap into a fake resume claim. A skill becomes usable only after
  the user has real work they can explain in an interview.
- Do not run auto-apply from here.
