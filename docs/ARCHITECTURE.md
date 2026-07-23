# Architecture Notes

Mr. Weirdo Jobs is a local-first skill collection. The main repo contains the
skills, ATS drivers, discovery code, install scripts, and docs. Each user's
private state lives outside the repo under `~/.mrweirdo-jobs/`.

## Local State Model

The database is local to the person running the skill, not a shared demo corpus
or remote backend.

- `jobs.db` is the local history and de-dupe ledger. Submitted and confirmed
  rows are kept as history.
- Each discovery run inserts newly seen postings, updates re-seen postings, and
  prunes stale or no-longer-useful discovered rows.
- `source_cursor.json` advances after discovery so repeated runs crawl new
  slices of public board sources.
- `feedback.jsonl` records per-apply outcomes for audit and debugging.
- `quota.jsonl` tracks large-company quota usage for cherry-pick flows.

## File Layout

```text
~/.mrweirdo-jobs/
+-- profile.json
+-- search_intent.json
+-- essay_profile.json
+-- generated_materials/
+-- resume.pdf
+-- jobs.db
+-- source_cursor.json
+-- feedback.jsonl
+-- quota.jsonl
+-- company_list.user.json
+-- log/
+-- chrome-profile/

~/.claude/skills/        -> repo/.claude/skills/*
~/.codex/skills/         -> repo/.claude/skills/*
repo/.agents/skills/     -> generated Codex workspace-local links
```

## Skill Layout

The main demo command is `/mrweirdo-jobskill`. It delegates to the same workflow
as `/mrweirdo-onboard`, with friendlier product language.

Auto-submit helpers called by the onboard flow:

- `mrweirdo-greenhouse-auto`
- `mrweirdo-ashby-auto`

Greenhouse and Ashby are the only two platforms in the auto-apply queue.
`SUPPORTED_AUTO_PLATFORMS` in `shared/sourcing/apply_url_classification.mjs` is
the single source of truth for that, and it currently reads
`new Set(['greenhouse', 'ashby'])`.

- `mrweirdo-lever-auto` — the driver exists and works, but `lever` is listed in
  `KNOWN_UNSUPPORTED_PLATFORMS`, so the onboard flow never dispatches to it.
  Re-enabling it is tracked as the third priority in `docs/PRD-improvements.md`;
  until that lands, treat Lever as manual-only.

Manual single-URL helpers preserve a final Submit gate:

- `mrweirdo-greenhouse`
- `mrweirdo-ashby`
- `mrweirdo-lever`
- `mrweirdo-smartrecruiters`
- `mrweirdo-icims`
- `mrweirdo-jobvite`
- `mrweirdo-handshake`
- `mrweirdo-workday` — v0.7 scaffolding only. Every file in
  `shared/workday/companies/` is still `_template.json` or
  `placeholder_company_1..5.json`; the flow has never been run against a real
  Workday tenant.

Supporting skills (not part of the apply path itself):

- `mrweirdo-doctor` — install and readiness check before a real run.
- `mrweirdo-cherry-pick` — opt-in flow for large-quota companies that batch
  auto-apply deliberately skips, keeping the pre-submit review gate.
- `mrweirdo-confirm` — reads Gmail confirmation threads and moves matching rows
  from submitted to confirmed.
- `mrweirdo-expand` — enriches writing memory from local documents.
- `mrweirdo-materials` — drafts per-job cover letters and essay answers on
  demand, kept separate from the cover-letter path the onboard flow controls.
- `mrweirdo-tracker` — records post-application outcomes and funnel views.
- `mrweirdo-upskill` — read-only skill-gap report built from scored rows.

## Driver Model

The most reliable path is Greenhouse + Ashby.

The v2 drivers are submit-error-driven:

1. Open the application URL through Chrome CDP.
2. Upload resume and dispatch the real form change event.
3. Fill standard fields such as name, email, phone, country, and location.
4. Click Submit.
5. Parse the form's own validation errors.
6. Match missing fields to profile values or `shared/answer_bank.json`.
7. Retry up to a fixed limit.
8. Record submitted, skipped, stuck, or essay-pending outcomes.

Essay and cover-letter questions are surfaced back to the main agent session.
The agent drafts truthful answers from `essay_profile.json` plus job context.

## Discovery Sources

`shared/sourcing/dispatcher.mjs` owns an `ADAPTERS` registry, and `ALL_SOURCES`
is derived from its keys. Six sources are wired in:

`remoteok`, `greenhouse_bulk`, `ashby_bulk`, `lever_bulk`, `wellfound`, `yc_waas`

The three bulk crawlers import the matching `*_board_api.mjs` and read a tenant
list from `shared/sourcing/data/`. `icims_board_api.mjs` and
`jobvite_board_api.mjs` sit flat in `shared/sourcing/` but are not dispatcher
sources; the corresponding single-URL skills call them on demand.

Anything under `shared/sourcing/_unwired/` is reachable from nothing at all —
board scrapers for SmartRecruiters, Rippling, Personio, BambooHR and Recruitee,
plus the vision fallback locator. They are kept as stock rather than deleted, and
wiring one up is a product decision, not a cleanup step. See
`shared/sourcing/_unwired/README.md`.

The rule: flat in `shared/sourcing/` means the dispatcher can reach it,
`_unwired/` means it cannot. Nothing should sit in between.

## AI Work

Interactive runs do not require a separate Anthropic API key. AI reasoning uses
the active Claude Code or Codex session:

| Stage | LLM source |
|---|---|
| Resume + self-introduction parse | Main agent session |
| Semantic filtering | Main agent session |
| Fit scoring | Main agent session |
| Form-field reasoning | Main agent session |
| Discovery API fetches | No LLM |

Future scheduled/background runs may need a separate API key, but the current
public alpha is designed around interactive local use.

## Review Surfaces

SQLite is the source of truth.

Optional review surfaces:

- Datasette: easiest local audit UI.
- Google Sheets/Airtable/custom UI: possible future mirrors, but should sync
  back to SQLite rather than replace it.

Notion was a v1.0 review surface and is **gone**, not merely off by default.
`shared/local_db.mjs` replaced the Notion sync module, which was removed once it
had no callers left. There is no supported way to mirror to Notion today.

Datasette example:

```bash
pip install datasette
datasette serve ~/.mrweirdo-jobs/jobs.db --open --port 8001
```

Useful views include submitted rows, skipped rows, large-company pending rows,
and current auto-apply eligible rows.

## Operational Checks

Before inviting users:

```bash
cd ~/.mrweirdo-jobs/repo
npm run release:alpha
```

Before a live demo:

```bash
cd ~/.mrweirdo-jobs/repo
npm run demo:check
```

For a local health snapshot:

```bash
node ~/.mrweirdo-jobs/repo/shared/supervisor_status.mjs --target 100
```
