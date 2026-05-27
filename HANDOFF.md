# mrweirdo-jobs — Maintainer Handoff (v2.1.2)

Audience: a new maintainer (engineer or PM) inheriting this repo cold.
Read this file end-to-end before touching anything. It is the single
file you need open to get oriented; everything else is just code.

Last updated: 2026-05-27, after the v2.1.2 Skill packaging/productization patch.

---

## 1. What this project is

mrweirdo-jobs is a personal job-application automation tool, originally
built for the author (Lee Lin, Babson junior, F-1 OPT, hunting US PM /
Growth / Ops internships). It is shipped as a Claude Code skill
collection plus a small Node 24 backend, installable on any macOS
machine via one curl command.

The pipeline is: resume PDF → AI-derived search intent + profile →
cross-platform job discovery (Greenhouse / Ashby / Lever boards, plus
RemoteOK and YC) → AI scoring → auto-apply on Greenhouse / Ashby /
Lever, with per-company quota guards and a Gmail-driven confirmation
loop. The user's only mandatory action is uploading the resume; their
feedback channel is their Gmail inbox.

Latest field data (2026-05-26 session): local DB now has 38 submitted
rows. This includes the v2.1.1 follow-up wins: 8 Directive Ashby rows
unblocked, Cloudflare Greenhouse row 247 submitted, and 6
`essay_pending` Ashby rows submitted through the main-Claude-in-loop
answer-bank workflow. Expected cadence going forward: one
`/mrweirdo-onboard` run per week, ~30 applications per cycle.

Packaging note (v2.1.2): the tracked canonical Skill source is still
`.claude/skills/*`. `setup.sh` links that source into both
`~/.claude/skills` and `~/.codex/skills`, then generates
repo-local `.agents/skills` symlinks for Codex desktop. `.agents/` is
gitignored on purpose; do not edit it as a second source of truth.

---

## 2. File-by-file map

The files a new maintainer must know about, in rough priority order:

**Bootstrapping**
- `setup.sh` — install script. Clones the repo to
  `~/.mrweirdo-jobs/repo`, symlinks `.claude/skills/*` into
  `~/.claude/skills/`, creates the user-state dir layout. Idempotent.
- `VERSION` — current release tag, `v2.1.2` as of this write.
- `CHANGELOG.md` — version history. Read the top entries (v2.1, v1.3)
  for current state; older entries are historical.

**Skills (user-facing entry points)**
- `.claude/skills/mrweirdo-onboard/SKILL.md` — the main entry point.
  Users invoke this; it runs the whole pipeline end-to-end.
- `.claude/skills/mrweirdo-greenhouse-auto/SKILL.md` — auto-submit
  Greenhouse helper, called by onboard. Single URL in.
- `.claude/skills/mrweirdo-ashby-auto/SKILL.md` — same for Ashby.
- `.claude/skills/mrweirdo-lever-auto/SKILL.md` — same for Lever
  (currently flaky; see §4).
- `.claude/skills/mrweirdo-confirm/SKILL.md` — Gmail confirmation
  loop; promotes ✅ 已投 rows to ✅ 已确认.
- `.claude/skills/mrweirdo-cherry-pick/SKILL.md` — manual large-company
  flow with Submit gate. Preserved from v1.

**Shared runtime (the actual code)**
- `shared/cdp.mjs` — Chrome DevTools wrapper. Stable, zero-dep. Do not
  touch unless you are sure.
- `shared/ashby_apply_driver.mjs` — v2.1 Ashby driver. Submit-error
  driven. ~80% success rate in field testing.
- `shared/greenhouse_apply_driver.mjs` — v2.1 GH driver. Newer,
  less battle-tested.
- `shared/ashby_helpers.js` / `shared/greenhouse_helpers.js` —
  page-injected DOM helpers. The drivers eval these into the page.
- `shared/answer_bank.json` — v2.1 externalized answer templates,
  Yes/No defaults, multichoice prefs. Edit here,
  not in driver code.
- `shared/lever_helpers.js` — Lever DOM helpers. See §4 for dragons.
- `shared/quota.mjs` — per-company submission quota tracking.
- `shared/local_db.mjs` — SQLite wrapper around `~/.mrweirdo-jobs/jobs.db`.
- `shared/paths.mjs` — path / env-var resolver. Read this when you are
  confused about where state lives.
- `shared/sourcing/` — Greenhouse / Ashby / Lever / RemoteOK / YC
  board-API clients for discovery.
- `shared/scoring/` — AI-scoring prompt + helpers.

**User state (gitignored, per-machine)**
- `~/.mrweirdo-jobs/jobs.db` — SQLite. Every discovered, scored, and
  applied job lives here.
- `~/.mrweirdo-jobs/profile.json` — form-fill data, generated from resume.
- `~/.mrweirdo-jobs/search_intent.json` — AI-derived search params.
- `~/.mrweirdo-jobs/resume.pdf` — the user's resume.
- `~/.mrweirdo-jobs/feedback.jsonl` — append-only audit log; one line
  per apply attempt with outcome + screenshot path.
- `~/.mrweirdo-jobs/chrome-profile/` — isolated CDP Chrome profile.
  Do not share. Do not push.

**Reference data**
- `examples/lee_company_list.json` — author's curated 248-company list.
  NOT used by default in v2; example only.

---

## 3. How a typical run goes

1. User invokes `/mrweirdo-onboard` (or a natural-language trigger like
   "帮我找实习" or "I just installed").
2. The skill runs 11 numbered steps sequentially: welcome banner,
   resume ingest, search intent inference, ABCD confirmation,
   cross-platform discovery, AI scoring, hard filter, dedupe,
   quota check, **auto-apply loop**, summary.
3. Step 10 (auto-apply) is the heart of the system. For each eligible
   row, the main agent invokes one of `mrweirdo-{greenhouse,ashby,lever}-auto`
   which calls the matching `shared/<platform>_apply_driver.mjs`. The
   driver fills, submits, parses validation errors, and retries up to
   4 rounds before giving up.
4. Outcome is written to `jobs.db` (status `✅ 已投` or skip reason)
   and `feedback.jsonl` (full audit).
5. Hours/days later, Gmail confirmation emails arrive. The user
   manually labels them `applied-jobs`. Running `/mrweirdo-confirm`
   promotes rows from ✅ 已投 to ✅ 已确认.

---

## 4. Where the dragons are

The 6 things a new maintainer will trip over within the first hour.
Internalize these.

**1. CSS selectors with leading-digit ids fail.** Ashby uses uuid
ids (`72b55bca-...`). Naked `#72b55bca-...` is invalid CSS in
WebKit/Blink. Always use `[id="..."]` or `'#' + CSS.escape(id)`.
We learned this twice; do not unlearn it. Helpers + drivers handle
it correctly today — preserve the existing code.

**2. React unmounts `#resume` immediately after `setFileInputFiles`.**
The driver's `uploadResume` no longer tries to re-access the element
post-upload. It verifies via body text. If you "fix" the driver to
re-read the file input, it will crash.

**3. react-select Location combobox needs a synthetic `mousedown`.**
Plain `.click()` silently fails to open the async Google Places picker.
The working pattern is `MouseEvent("mousedown", {button: 0, buttons: 1, clientX, clientY})`
followed by typing and option click. Reference impl: `reactSelect()`
in `shared/greenhouse_apply_driver.mjs`. Use it.

**4. Ashby Yes/No widgets sometimes ignore clicks, and directive's
ack is not a Yes/No widget.** `Ashby.clickAckWidget` in
`shared/ashby_helpers.js` runs a 5-strategy fallback for hidden-checkbox
Yes/No controls. The 2026-05-26 directive blocker looked similar, but
field testing showed the real "Please confirm that you acknowledge..."
control is a single-option radio (`I can confirm...`). Calling
`clickAckWidget(/Please confirm/)` is a false-positive trap because it
can climb to a large parent container and target an earlier Yes/No
checkbox. The working fix lives in `shared/ashby_apply_driver.mjs`:
detect the ack label, click the single radio/label, and treat
Directive's "already applied ... application will be reviewed" limiter
as confirmation.

**5. Native Ashby radio/checkbox clicks can report success without
updating React state.** Chai and Julius both exposed this. A plain
`input.click()` can leave the form still reporting the same missing
field. The working pattern is: click the input/label, call the native
`HTMLInputElement.prototype.checked` setter, then dispatch both `input`
and `change`. Keep that in `shared/ashby_apply_driver.mjs`.

**6. Lever rejects CDP uploads with a bogus "File exceeds 100MB" error.**
On a resume that is visibly 200 KB. No fix yet. The current code
skips Lever rows on this error rather than retrying. Try drag-drop
upload if you want to take a swing at it; do not retry the same
`setFileInputFiles` call expecting different results.

---

## 5. Daily / weekly workflow for the maintainer

- **Weekly**: run `/mrweirdo-onboard` to refresh discovery + apply to
  the new pool.
- **After each run**: read `~/.mrweirdo-jobs/feedback.jsonl`. Group
  `outcome: stuck_on_same_missing` and `outcome: essay_pending` rows
  by company; categorize new skip reasons.
- **As form shapes drift**: add new essay templates and Yes/No defaults
  to `shared/answer_bank.json`. No code change needed.
- **Per-company quota tuning**: edit `examples/lee_company_list.json`
  (or the user's `~/.mrweirdo-jobs/company_list.user.json`) to adjust
  caps on specific employers.

---

## 6. Specifically what NOT to do

- **Do not write a pure-bash batch dispatcher.** The v1-era lesson, paid
  for in real submissions: bash loops without main-agent-in-the-loop
  cannot reason about per-row form variance. They will always stall on
  custom Q's. Always keep the main agent in the loop for ATS forms.
- **Do not mark a row "submitted" without verifying the success page text.**
  Ashby's "Success!" upload-status toast is NOT a submission
  confirmation. Look for the post-submit URL change or the explicit
  confirmation copy in the body.
- **Do not push secrets.** `~/.mrweirdo-jobs/` is gitignored for a
  reason. Resume PDFs, profile.json, .env, and the chrome-profile
  all live there. Never `git add` outside the repo, and never copy
  anything from `~/.mrweirdo-jobs/` into the repo.
- **Do not bypass the per-company quota guard.** It exists so that
  one batch run does not burn the user's only shot at Google / Meta /
  Stripe etc. The `/mrweirdo-cherry-pick` flow is the only sanctioned
  way to spend quota.

---

## 7. How to know things are working

- DB row count of `status='✅ 已投'` grows weekly.
- `feedback.jsonl` has new `outcome: submitted` lines with screenshot
  paths that actually exist on disk.
- Gmail confirmation emails arrive within 24h of each apply. Once the
  user labels them `applied-jobs`, `/mrweirdo-confirm` will promote
  the row to ✅ 已确认.
- The Datasette UI (`datasette serve ~/.mrweirdo-jobs/jobs.db`) shows
  the `v_auto_submitted` view filling up.

---

## 8. Open issues for the next maintainer

In rough priority order:

1. **Fix Base Power date-picker + auth-combobox edge case.** Row 122
   still stalls on earliest start date + work authorization. The auth
   options include "U.S. citizen or permanent resident" as the first
   "Yes" match; do not choose it for Lee. Correct choices are CPT/OPT
   depending on the wording.
2. **Formalize the essay consumer.** The main-Claude-in-loop workflow is
   proven: rows 166, 235, 345, 682, 716, and 719 were submitted after
   answer-bank templates were added and the driver was rerun. Still
   worth packaging as a standalone CLI/skill that reads
   `essay_pending.jsonl`, drafts/records answers, reruns, and writes DB
   outcomes.
3. **Solve Lever anti-CDP file upload.** Today it is effectively
   broken. Either find the detection signal and bypass it, or
   replace `setFileInputFiles` with a drag-drop emulation.
4. **Better discovery.** Today's pool was 813 jobs of which only ~30
   were actionable. Sources skew remote-tech-heavy. v2.2 should add
   YC Work-At-A-Startup, Wellfound, and at least one industry-specific
   board (healthcare, education).
5. **Profile asset gaps.** GPA, SAT/ACT, 1-minute intro video, official
   transcript — roughly 3 high-fit jobs per session require these and
   are skipped. Either prompt the user to provide them at onboard time
   or add a "supplemental_assets" section to `profile.json`.

---

## 9. Contact + getting unstuck

The original author is Lee Lin (GitHub: `glin23`). The CHANGELOG is
the project's narrative memory — when something looks wrong, read the
relevant version entry first; the rationale for almost every weird
choice is in there.
