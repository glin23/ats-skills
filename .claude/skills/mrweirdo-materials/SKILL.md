---
name: mrweirdo-materials
description: Draft per-job cover letters or essay materials for Mr. Weirdo Jobs. Trigger when the user asks for a cover letter, essay answer, or application material for a row id or URL. Uses truthful drafting plus reviewer checks, renders HTML/PDF when needed, and never connects generated materials to the auto-apply path.
---

# Mr. Weirdo Materials

Use this skill for one job at a time when the user wants a cover letter,
application essay, or reusable answer material.

Generated files live under:

```text
~/.mrweirdo-jobs/materials/
```

Metadata is append-only:

```text
~/.mrweirdo-jobs/materials/index.jsonl
```

## Trigger

- "给 row 123 写 cover letter"
- "帮这个 URL 写申请材料"
- "这题怎么回答"
- `/mrweirdo-materials`

## Inputs

Require a row id or URL. If the user gives a URL, look up the matching DB row
when possible. Ask exactly two material-specific questions:

1. Why this company/team?
2. Which proof point should be most visible?

Do not ask for facts that can be read from the resume/profile. Do ask when a
claim would otherwise be invented.

## Drafting Flow

1. Read the job row, resume/profile, `essay_profile.json`, answer bank, and
   `shared/references/truthfulness.md`.
2. Draft in the main session:
   - cover letter: 250-350 words;
   - short-answer essay: match the prompt and stay concise.
3. Run a reviewer pass that checks:
   - interview backtrack test;
   - unsupported or exaggerated claims;
   - JD coverage;
   - `essay_profile.voice` fit.
4. Reviewer returns JSON edits:

```json
[{ "file": "...", "old_string": "...", "new_string": "...", "reason": "..." }]
```

5. Apply safe edits, then render HTML. If PDF is needed, render HTML to PDF and
   read it back for a one-page layout/legibility check.

## Hard Rules

- Do not use LaTeX.
- Do not attach the generated file to auto-apply or set `cover_letter_path` for
  batch runs.
- Do not claim skills, employers, degrees, dates, GPA, authorization, awards,
  or projects that are not supported by local evidence.
- If a claim is useful but only partially supported, ask the user:
  "Keep, soften, or drop?"
- Mark `used_in_submission: false` in metadata unless the user later confirms
  they manually used the material.

## Metadata

Append one JSONL row per generated artifact:

```json
{
  "ts": "ISO timestamp",
  "row_id": 123,
  "type": "cover_letter",
  "path": "...",
  "profile_version_hash": "...",
  "reviewed": true,
  "used_in_submission": false
}
```
