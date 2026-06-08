# Public Alpha Release Gate

Mr. Weirdo Jobs is in public alpha. That means the repo can be shared with
technical early users, but it is not ready for broad beta promotion.

## Release Command

Run this before publishing a tag, sending the repo to classmates, or posting a
public alpha announcement:

```bash
npm run release:alpha
```

This checks unit tests, role-guard smoke coverage, public-facing wording,
version consistency, setup syntax, and the absence of stale shared-pool or
personal-example logic.

## Fresh Install Test

Use a clean local state directory when testing the alpha path:

```bash
export MRWEIRDO_HOME=/tmp/mrweirdo-alpha-home
export MRWEIRDO_REPO_ROOT="$(pwd)"
export CLAUDE_SKILLS_DIR=/tmp/mrweirdo-alpha-claude-skills
export CODEX_SKILLS_DIR=/tmp/mrweirdo-alpha-codex-skills
bash setup.sh
bash "$MRWEIRDO_REPO_ROOT/shared/chrome-cdp-launcher.sh"
node "$MRWEIRDO_REPO_ROOT/shared/doctor.mjs" --cdp
```

Then run `/mrweirdo-onboard` from Claude Code or Codex with a real resume PDF
and a short self-introduction.

## Alpha Success Criteria

- Fresh install completes without FAIL rows.
- Onboarding creates `profile.json`, `search_intent.json`, and
  `essay_profile.json` under the user's own `MRWEIRDO_HOME`.
- Discovery runs in realtime and advances that user's `source_cursor.json`.
- `jobs.db` records only that user's seen/applied/skipped history.
- If ready rows exist, Greenhouse/Ashby/Lever batch apply can submit a small run after
  the user confirms the parsed profile/search intent.
- If no ready rows exist, `supervisor_status` and `apply_readiness_plan` explain
  what blocked the run and point to review or next realtime discovery.

## Move To Closed Classmate Testing

Invite classmates only after the maintainer has completed at least one clean
fresh-install run and inspected the resulting report/screenshots. Start with
3-5 US college students across different majors or targets.

## Move To Broader Beta

Broader beta should wait until several fresh users can install, onboard, discover
reasonable role-targeted rows, and either submit a small batch or receive a
clear no-ready-rows explanation without maintainer intervention.
