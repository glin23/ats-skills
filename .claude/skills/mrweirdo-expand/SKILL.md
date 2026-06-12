---
name: mrweirdo-expand
description: Expand Mr. Weirdo Jobs writing memory from local documents. Trigger when the user asks to enrich their profile, add LinkedIn/portfolio/transcript/past application material, or scan ~/.mrweirdo-jobs/documents. Builds additive/conflict buckets and never writes sensitive ATS facts without explicit confirmation.
---

# Mr. Weirdo Expand

Use this skill to enrich writing memory from documents the user has placed in:

```text
~/.mrweirdo-jobs/documents/
```

Suggested subfolders:

- `transcripts/`
- `linkedin/`
- `portfolio/`
- `past_applications/`

## Trigger

- "扩充我的画像"
- "读取 documents"
- "把 LinkedIn/portfolio 加进求职画像"
- `/mrweirdo-expand`

## Workflow

1. Scan `~/.mrweirdo-jobs/documents/` and list discovered files.
2. Read `profile.json`, `search_intent.json`, and `essay_profile.json`.
3. Diff new material into two buckets:
   - additive: new writing evidence, projects, phrasing, proof points;
   - conflicting: values that disagree with existing profile/search files.
4. Ask for one batch confirmation before writing additive items.
5. Ask conflicting items one by one with `[keep]`, `[replace]`, or `[manual]`.
6. After any write, run:

```bash
cd "$MRWEIRDO_REPO_ROOT"
node shared/validate_user_profile.mjs
```

## Write Rules

- Add writing/proof material to `essay_profile.json` with a `source` note.
- Behavioral inference may enter `essay_profile.json` only when marked
  `[inferred]`.
- Do not overwrite existing data silently; the second run must be idempotent.
- Do not write to these read-only areas:
  - `work_authorization`;
  - legal attestations;
  - demographics;
  - background-check answers;
  - salary acceptance;
  - relocation commitments.
- If a document appears to contain an ATS-submitted personal fact, warn before
  any write and ask explicit confirmation for that exact field.

## Safety

This skill enriches future writing and gap answers. It does not submit
applications, does not change queue eligibility, and does not make claims the
user could not explain in an interview.
