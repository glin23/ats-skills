# Mr. Weirdo Jobs — Maintainer Handoff (v2.2.0)

Audience: a new maintainer (engineer or PM) inheriting this repo cold.
Read this file end-to-end before touching anything. It is the single
file you need open to get oriented; everything else is just code.

Last updated: 2026-05-28, after Greenhouse end-to-end fixes for
semester-only graduation selects, consent checkboxes, dead-job
redirects, and CDP bootstrapping diagnostics. Same day: verified the
role-type auto-apply gate (the fix for the 2026-05-27 full-time leak) —
`auto_apply_queue.mjs` now returns 0 rows because every fit≥5 row left on
Greenhouse/Ashby is `new_grad_FT` (correctly `role_type_not_allowed`) and
every remaining internship is fit≤4; the current local history has no
ready-to-submit supported-ATS internship rows. Also hardened `score_prompt.md` against
role-type score inflation and added a `factual_gap_fields` taxonomy
(below). Then ran a real realtime-discovery loop:
`discover_candidates.mjs --run --source-window-size "${MRWEIRDO_SOURCE_WINDOW_SIZE:-1000}"`
→ scored 3 new on-target internships → 2 verified Ashby submissions
(acorns Growth PM Intern, lambda Accounting AI Intern; confirmation
screenshots in `log/screenshots/`) + 1 honest skip (fuel-cycle: required
numeric salary field, not fabricated). Fixed and verified two
`ashby_apply_driver.mjs` gaps in the process: missing name-field buckets
(Legal/Preferred First/Last) and "How did you hear about this job?" being
forced through the radio handler when it is usually a textarea. A follow-up
hardening pass then closed three more issues the run exposed: (1) the
role-type gate trusted the job title over `employment_type`, so a permanent
full-time role titled "…Intern" could slip the intern gate — `role_types.mjs`
now emits a `roleTypeConflict` flag and discovery annotates/counts it (title
still wins, so legitimate full-time-hours internships are not blocked);
(2) the Ashby driver auto-committed the user to specific-city onsite/transport
*facts* — it now treats those as ask-or-skip (`specific_city_fact_unconfirmed`)
while keeping general relocation *willingness* auto-answered under an
`anywhere_legal_work` policy; (3) onboard Step 10 now surfaces the queued
company list before a real batch and fills impactful optional "why us" essays
from `essay_profile.json` rather than leaving them blank.

---

## 1. What this project is

Mr. Weirdo Jobs is the public project name and brand. The repo slug,
skill prefixes, and local state directory remain `mrweirdo-jobs` /
`mrweirdo-*` for compatibility. The tool is packaged as a Claude Code
+ Codex Skill collection plus a small Node 24 backend, installable on
any macOS machine via one curl command.

The pipeline is: resume PDF → AI-derived search intent + profile →
cross-platform job discovery (Greenhouse / Ashby / Lever boards, plus
RemoteOK and YC) → AI scoring → auto-apply on Greenhouse / Ashby,
with per-company quota guards, a public-alpha per-run cap, and a
Gmail-driven confirmation loop. The user must provide a resume, answer
the short questionnaire, and explicitly confirm the parsed profile
before the agent submits anything.

Latest validation notes: the first post-readiness 10-row Greenhouse run
produced 1 verified submission (`attentive` row 432) and a useful
postmortem: most misses were unsupported custom questions, non-standard
Greenhouse landing pages with no file input, and location/profile
requirements, not generic CDP failure. v2.1.4 adds
`shared/dedupe_jobs.mjs` and wires it into Step 10 so duplicate
company/title rows cannot repeatedly consume apply attempts. The
follow-up 3-row test did not produce a new submission; it showed
Cloudflare's remaining blockers are Austin residency/confirmed plans
and graduation-date select matching, while Alpine needs GPA, essay,
Austin relocation, and EEO/source checkboxes. v2.1.5 fixes the technical
parts of that finding; the profile-specific questions remain user/input
blockers. v2.1.6 promotes relocation into the upfront questionnaire:
users can now explicitly choose fixed metros, named metros, anywhere in
the US, or any legally workable location across countries the user lists. The answer
is stored as `relocation_policy`, `countries_open_to`, and
`willing_to_relocate_for_internship` so discovery, scoring, and ATS
answers share one source of truth. A later pass aligns auto-apply with the
recall-first calibration: `fit_score >= 5` is eligible, while
dedupe/quota/platform guards still apply.
Expected cadence going forward: start external users with
`/mrweirdo-doctor`, then one `/mrweirdo-onboard` run capped at 10
auto-submits. Maintainers should raise `MRWEIRDO_MAX_AUTO_APPLY` only
after the first run looks sane.
The next Greenhouse validation pass exposed three more reusable lessons:
some boards expose graduation choices only as semester-end dates
(`June YYYY` / `December YYYY`), consent checkboxes may be visible while
their inputs are hidden, and retired Greenhouse job IDs can 302 to a
company careers index with no form. The driver now treats those as
first-class cases instead of generic form failures.

Packaging note (v2.1.3): the tracked canonical Skill source is still
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
  Claude Code + Codex skill locations, creates the user-state dir
  layout, and runs the install doctor. Idempotent.
- `VERSION` — current release tag, currently `v2.2.0`.
- `CHANGELOG.md` — version history. Read the top entries (v2.1, v1.3)
  for current state; older entries are historical.

**Skills (user-facing entry points)**
- `.claude/skills/mrweirdo-onboard/SKILL.md` — the main entry point.
  Users invoke this; it runs the whole pipeline end-to-end.
- `.claude/skills/mrweirdo-doctor/SKILL.md` — local readiness check.
  It runs `shared/doctor.mjs`; it never submits applications.
- `.claude/skills/mrweirdo-greenhouse-auto/SKILL.md` — auto-submit
  Greenhouse helper, called by onboard. Single URL in.
- `.claude/skills/mrweirdo-ashby-auto/SKILL.md` — same for Ashby.
- `.claude/skills/mrweirdo-lever-auto/SKILL.md` — preserved internal
  helper for experimentation. Not part of public-alpha batch auto-submit
  until the Lever upload issue is fixed.
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
- `shared/doctor.mjs` — user-safe readiness checker for install,
  Skill links, user-state files, and optional Chrome CDP.
- `shared/dedupe_jobs.mjs` — idempotent jobs.db duplicate guard. It
  marks duplicate pending rows as skipped by normalized company + title
  before Step 10 selects an auto-apply queue.
- `shared/discover_candidates.mjs` — reusable discovery + hard-filter
  wrapper. `--plan` prints target-role-safe keywords and sources without
  network; `--run` writes `/tmp/mrweirdo-onboard/to_score.json`.
- `shared/supervisor_status.mjs` — one-command local snapshot for
  maintainers. It reports CDP state, whether a real apply batch is ready,
  latest report, DB status counts, ready row count, remaining target, and
  next safe commands. If CDP is down, the first next commands are the
  visible-terminal recovery commands to start Chrome CDP.
- `shared/recompute_auto_apply_eligibility.mjs` — recalculates stale
  `auto_apply_eligible` flags from current role targets, fit threshold,
  platform support, and quota guards before Step 10 builds the queue.
- `shared/apply_supervisor.mjs` — simplest CLI entrypoint for verification
  runs. `--dry-run` validates without submitting; `--real` verifies or
  launches Chrome CDP before delegating to `shared/apply_batch.mjs`.
- `shared/apply_batch.mjs` — foreground supervisor runner for verification or
  production batches. It runs preflight, builds the guarded queue, validates
  each row, runs the platform driver, calls the outcome recorder, paces rows,
  generates the final HTML report, and holds a local batch lock so concurrent
  apply runs cannot double-submit the same user data.
- `shared/queue_diagnostics.mjs` — explains why an auto-apply batch cannot
  reach the requested size: low fit score, unsupported ATS, quota guard, role
  boundary, or same company/title already submitted.
- `shared/queue_review_report.mjs` — local HTML queue review for the user or
  maintainer. It separates ready-to-apply rows from fit-one-below-threshold
  rows to review and unsupported-ATS rows.
- `shared/rescore_review.mjs` — local HTML/JSON/CSV review for
  fit-one-below-threshold rows. It never changes the DB unless the user
  supplies explicit IDs with `--promote ... --apply`.
- `shared/apply_readiness_plan.mjs` — local HTML/JSON target-count readiness
  report. It shows whether a requested batch size can be reached from ready
  rows, rows to review, unsupported ATS rows, or the next realtime discovery
  run. `shared/apply_capacity_plan.mjs` is kept only as a compatibility alias.
- `shared/record_apply_outcome.mjs` — evidence-bound outcome recorder.
  Step 10 feeds it the per-row driver output; it marks `✅ 已投` only when
  the driver emitted `outcome:"submitted"`, otherwise it records a
  specific skip reason.
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
- `examples/example_company_list.json` — optional company-list format example.
  NOT used by default in v2.

---

## 3. How a typical run goes

1. User invokes `/mrweirdo-onboard` (or a natural-language trigger like
   "帮我找实习" or "I just installed").
2. The skill runs 11 numbered steps sequentially: welcome banner,
   resume ingest, search intent inference, ABCD confirmation,
   cross-platform discovery, AI scoring, hard filter, dedupe,
   quota check, **auto-apply loop**, summary.
3. Step 10 (auto-apply) is the heart of the system. Public alpha caps
   the queue at 10 rows per run by default. For each eligible row,
   the main agent invokes one of `mrweirdo-{greenhouse,ashby}-auto`
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

The 12 things a new maintainer will trip over within the first hour.
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
in `shared/greenhouse_apply_driver.mjs`. Use it. Ashby can expose the
same pattern under labels like "Where are you located?"; try the
question-scoped combobox path before falling back to text fill.

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
For relocation questions with full-sentence options, prefer explicit
choice lists such as "Yes, I am open to relocation" over generic Yes/No
fallbacks; the wrong fallback silently changes the candidate's answer.

**6. Lever rejects CDP uploads with a bogus "File exceeds 100MB" error.**
On a resume that is visibly 200 KB. No fix yet. The current code
skips Lever rows on this error rather than retrying. Try drag-drop
upload if you want to take a swing at it; do not retry the same
`setFileInputFiles` call expecting different results.

**7. Greenhouse confirmations do not always say "submitted."**
AccuWeather reached `/confirmation` with "Thank you for your interest"
and "receiving an email soon" copy, but the old strict regex returned
`no_errors_no_success`. v2.1.4 treats `/confirmation` plus Greenhouse
next-step/email copy as a valid submission signal. Still do not count a
row as submitted on button click alone.

**8. Greenhouse graduation date selects may be semester-only.**
Some tenants offer only `June YYYY` / `December YYYY` even when the
profile says `May YYYY`. For graduation-date react-select fields, try
the profile value first, then the nearest semester-end month in the same
year. Otherwise high-quality rows can stall on a technically fillable
field.

**9. Greenhouse consent checkboxes can have hidden inputs.**
Do not filter checkboxes by `offsetParent` alone. The label or wrapper
can be visible while the actual `<input type="checkbox">` is hidden.
For acknowledge/confirm/privacy/policy controls, click the visible label
when present, then call the native checked setter and dispatch `input`
+ `change`.

**10. Retired Greenhouse job IDs can redirect to careers indexes.**
When a `boards.greenhouse.io/.../jobs/<id>` URL redirects to a company
careers page with no file input or submit button, record
`job_unavailable` instead of `resume_upload_failed`. This is data decay,
not an upload bug.

**11. Discovery can duplicate the same company/title many times.**
This is especially common when a company board appears under both
`company` and `companyjobs` slugs, or when an ATS exposes the same row
through multiple source paths. Never let Step 10 dispatch raw
`v_auto_apply_eligible` rows directly. Run `shared/dedupe_jobs.mjs`
first; it is idempotent and safe to repeat.

**12. CDP port ownership and agent sandboxes are different problems.**
If `localhost:9222/json/version` fails but `lsof` shows Chrome listening
on 9222, that Chrome was probably launched without remote debugging.
Use a fresh port, usually `ATS_CDP_PORT=9223 bash shared/chrome-cdp-launcher.sh`,
then pass the same `ATS_CDP_PORT=9223` into preflight and apply runs.
If the launcher reports macOS/Crashpad permission errors inside Codex or
another sandboxed agent, run the launcher from the visible Terminal or
Cloud Code terminal instead; the apply drivers only need the resulting
CDP endpoint.

---

## 5. Daily / weekly workflow for the maintainer

- **Weekly**: run `/mrweirdo-onboard` to refresh discovery + apply to
  the new pool.
- **After each run**: read `~/.mrweirdo-jobs/feedback.jsonl`. Group
  `outcome: stuck_on_same_missing` and `outcome: essay_pending` rows
  by company; categorize new skip reasons.
- **As form shapes drift**: add new essay templates and Yes/No defaults
  to `shared/answer_bank.json`. No code change needed.
- **When a row stalls on a fact you can't infer** (permanent address,
  social handles, comp acceptance, a third-party/game account, a personal
  opinion, a separate cover letter): that field belongs in the
  `factual_gap_fields` block of `essay_profile.json` (schema in
  `shared/essay_profile.template.json`). Mark it `unknown` and surface it to
  the user upfront — never invent it. Onboard should batch-ask these before
  the apply loop so it does not re-stall mid-application. Rows 190/197/625
  are the worked examples.
- **Per-company quota tuning**: edit `examples/example_company_list.json`
  as reference only; edit the user's `~/.mrweirdo-jobs/company_list.user.json`
  to adjust caps on specific employers for real runs.

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
   "Yes" match; for F-1 users, correct choices are CPT/OPT depending
   on the wording.
2. **Formalize the essay consumer.** The main-Claude-in-loop workflow is
   proven: rows 166, 235, 345, 682, 716, and 719 were submitted after
   answer-bank templates were added and the driver was rerun. Still
   worth packaging as a standalone CLI/skill that reads
   `essay_pending.jsonl`, drafts/records answers, reruns, and writes DB
   outcomes.
3. **Solve Lever anti-CDP file upload.** Today it is effectively
   broken. Either find the detection signal and bypass it, or
   replace `setFileInputFiles` with a drag-drop emulation.
4. **Better discovery — now the immediate gating lever.** As of 2026-05-28 the current local history has no ready supported-ATS (Greenhouse/Ashby)
   internship rows: `auto_apply_queue.mjs` returns 0 rows
   because all fit≥5 rows left are full-time (gate-blocked) and all
   remaining internships are fit≤4 off-target crafts. The old
   `NO_URL:yc_waas:<id>` dead rows are now filtered before scoring and pruned
   from the local history. A real apply run still cannot happen again
   until the next realtime discovery/scoring run finds new on-target
   supported-ATS rows. Source-windowed
   discovery now rotates through public board lists; next work should improve
   Greenhouse/Ashby yield for US student roles and add at least one
   industry-specific board (healthcare, education).
5. **Profile asset gaps.** GPA, SAT/ACT, 1-minute intro video, official
   transcript — roughly 3 high-fit jobs per session require these and
   are skipped. Either prompt the user to provide them at onboard time
   or add a "supplemental_assets" section to `profile.json`.

---

## 9. Contact + getting unstuck

The CHANGELOG is the project's narrative memory — when something looks wrong,
read the relevant version entry first; the rationale for almost every weird
choice is in there.
