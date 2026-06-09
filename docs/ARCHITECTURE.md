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

Auto-submit helpers are called by the onboard flow:

- `mrweirdo-greenhouse-auto`
- `mrweirdo-ashby-auto`
- `mrweirdo-lever-auto`

Manual single-URL helpers preserve a final Submit gate:

- `mrweirdo-greenhouse`
- `mrweirdo-ashby`
- `mrweirdo-lever`
- `mrweirdo-smartrecruiters`
- `mrweirdo-icims`
- `mrweirdo-jobvite`
- `mrweirdo-handshake`
- `mrweirdo-workday`

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
- Notion: optional user-owned mirror, off by default.
- Google Sheets/Airtable/custom UI: possible future mirrors, but should sync
  back to SQLite rather than replace it.

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
