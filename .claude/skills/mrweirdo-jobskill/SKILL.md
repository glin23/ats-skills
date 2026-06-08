---
name: mrweirdo-jobskill
description: Demo-friendly main entry for Mr. Weirdo Jobs. Trigger when the user types /mrweirdo-jobskill, /Mr-Weirdo-JobSkill, asks to run the Mr. Weirdo job skill, or wants the live end-to-end resume onboarding -> realtime job research -> scoring -> guarded auto-apply flow. This is an alias/wrapper over mrweirdo-onboard; do not use for single URL applications.
---

# Mr. Weirdo JobSkill

This is the user-facing live demo entrypoint. It deliberately routes to the
same production workflow as `mrweirdo-onboard`; the point is a clearer command
name and smoother first-run wording, not a separate code path.

When triggered, follow `.claude/skills/mrweirdo-onboard/SKILL.md` exactly, with
these demo-facing defaults:

- Say the product command is `/mrweirdo-jobskill`.
- First prompt:

```text
First of all, upload your resume PDF. Paste the absolute file path here.

Then talk to us about yourself in 5-10 sentences:
who you are, what kind of internship or part-time role you want, what
experiences you want companies to notice, preferred industries/functions, and
anything you want the applications to emphasize.

Before any real application is submitted, I will show you the parsed profile
and ask for one explicit confirmation.
```

- By default, process every currently eligible queued row. Use
  `MRWEIRDO_MAX_AUTO_APPLY=N` only when the user explicitly wants a cap.
- Stable unattended batch platforms are Greenhouse and Ashby. Lever remains a
  manual/single-URL helper until its batch upload path is proven reliable.
- If the user is doing a public/live demo, run `npm run demo:check` first and
  fix FAIL rows before continuing. WARN rows are allowed only when they are
  normal first-run onboarding warnings, such as missing profile/search files.
- After parse confirmation, proceed decisively through realtime discovery,
  scoring, queue preview, guarded auto-apply, missing-info retry, report, and
  pruning. Do not stop at a plan.

Do not route single URLs here. Use `mrweirdo-greenhouse`, `mrweirdo-ashby`, or
`mrweirdo-lever` for one-off applications.
