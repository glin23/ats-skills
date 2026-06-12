---
name: mrweirdo-jobskill
description: Demo-friendly main entry for Mr. Weirdo Jobs. Trigger when the user types /mrweirdo-jobskill, /Mr-Weirdo-JobSkill, asks to run the Mr. Weirdo job skill, wants the command menu, or wants the live end-to-end resume onboarding, realtime job research, scoring, guarded queue gate, and auto-apply flow. This is an alias/wrapper over mrweirdo-onboard; do not use for single URL applications.
---

# Mr. Weirdo JobSkill

This is the user-facing live demo entrypoint. It routes to the same production
workflow as `mrweirdo-onboard`; the point is a clearer command name and smoother
first-run wording, not a separate code path.

If invoked with no concrete request yet, show this concise menu:

```text
/mrweirdo-onboard：首跑/续跑，简历 intake -> discovery -> queue gate -> 自动投递
/mrweirdo-greenhouse <url>：单个 Greenhouse，保留提交前人工确认
/mrweirdo-ashby <url>：单个 Ashby，保留提交前人工确认
/mrweirdo-lever <url>：单个 Lever，保留提交前人工确认
/mrweirdo-cherry-pick：大公司限额位，逐个 slot 手动确认
/mrweirdo-confirm：48 小时后同步确认邮件
/mrweirdo-doctor：只检查安装/Chrome/CDP 状态
/mrweirdo-tracker：记录 OA、面试、拒信、offer 等进展
/mrweirdo-expand：从 documents/ 扩充写作画像
/mrweirdo-upskill：汇总技能缺口并生成学习建议
/mrweirdo-materials：为指定岗位起草 cover letter/essay 材料
```

When the user wants the full run, follow
`.claude/skills/mrweirdo-onboard/SKILL.md` exactly, with these demo-facing
defaults:

- Say the product command is `/mrweirdo-jobskill`.
- Keep the first prompt to one intake message: resume PDF path plus 5-10
  sentences of self-introduction.
- Ask the three hard-boundary questions in one UI call, then use the parse soft
  window rather than a separate parse hard gate.
- By default, process every currently eligible queued row. Use
  `MRWEIRDO_MAX_AUTO_APPLY=N` only when the user explicitly wants a cap.
- Stable unattended batch platforms are Greenhouse and Ashby. Lever remains a
  manual/single-URL helper until its batch upload path is proven reliable.
- If the user is doing a public/live demo, run `npm run demo:check` first and
  fix FAIL rows before continuing. WARN rows are allowed only when they are
  normal first-run onboarding warnings, such as missing profile/search files.
- Proceed through realtime discovery, scoring, queue preview, guarded
  auto-apply, missing-info retry, report, and pruning. Do not stop at a plan.

Do not route single URLs here. Use `mrweirdo-greenhouse`, `mrweirdo-ashby`, or
`mrweirdo-lever` for one-off applications. Do not add career-ops-style keyword
routing that guesses "JD vs command" from generic responsibility text.
