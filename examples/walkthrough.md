# mrweirdo-jobs Historical Walkthrough — Real Dogfood (v0.2 era)

This is a real dogfood log from May 23, 2026 (when the project was still
called `ats-skills` and at v0.2). Names + URLs are kept; resume + profile
details are generic placeholders for privacy.

**Do not use this file as the current install guide.** It is kept as a
historical debugging record for old single-URL helpers. Current users
should follow `README.md`: install, run `/mrweirdo-doctor`, start Chrome
CDP, then run `/mrweirdo-onboard`.

## Setup

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/glin23/mrweirdo-jobs/main/setup.sh)
bash ~/.mrweirdo-jobs/repo/shared/chrome-cdp-launcher.sh
node ~/.mrweirdo-jobs/repo/shared/doctor.mjs --cdp
# then in Claude Code or Codex:
/mrweirdo-onboard
```

The rest of this walkthrough shows the old manual single-URL path.

```
> /mrweirdo-greenhouse https://job-boards.greenhouse.io/nice/jobs/4754106101
```

## Run 1: NiCE SDR Intern Sandy UT (Greenhouse)

Single-URL `/mrweirdo-greenhouse` flow. First helper-set dogfood.

Steps:
1. `cdp.mjs goto` → navigate to NiCE job board apply URL.
2. Inject `shared/greenhouse_helpers.js` via `Runtime.evaluate`.
3. Upload resume PDF via `DOM.setFileInputFiles`.
4. `GH.fillForm(profile)` → 12 text + select fields filled in one pass.
5. Country picker: `GH.pickIti("United States +1")` (iti widget; text has space before +).
6. Sponsorship Yes/No: `GH.pickerByLabel("Are you authorized…", "Yes")` — react-select v5 picker via `mousedown` event.
7. Pre-submit screenshot, then "go" → submit click.

Result: confirmation URL `/nice/jobs/4754106101/confirmation`, "Woohoo! We received your application!"

Lessons:
- react-select v5 picker requires mousedown event (not click) — v0.1 helpers handled correctly.
- Country picker text "United States +1" (with space) vs iti widget "Afghanistan+93" (no space) — string match is exact, normalize before pass.
- 12 required fields filled in ~2 minutes total.
- Picker out-of-viewport bug surfaced here — `openPicker()` had to `scrollIntoView({block: 'center'})` before option list renders (logged + fixed in v0.2).

## Run 2 (v0.2 batch dogfood): 6 URLs

Triggered `/mrweirdo-jobs` with an inline list of 6 URLs (no auto-load this run; explicit URLs). Single upfront authorization gate.

### Success: Cresta DS Intern (Greenhouse)
- 5 fields, `GH.fillForm` completed first try.
- Country picker "United States +1" pick worked.
- Confirmation URL hit, Notion auto-marked ✅ 已投 via batch orchestrator post-step.

### Skip: Twilio Graphic Design (Greenhouse)
- `candidate-location` Google Places autocomplete blocked v0.2 — no helper for the async option list.
- 8 other fields filled fine, but required field still empty after `findEmptyRequired()` → batch logged skip + continued.
- v0.3 adds `prepareLocationCombobox` + `pickLocationOption` to handle.

### Skip: EnergyHub Eng Intern Data (Greenhouse)
- Same `candidate-location` blocker as Twilio.
- 7 other fields filled. Role unfit anyway (Eng > current focus area).

### Success: Crusoe Motion Design Intern (Ashby)
- 6 fields via `Ashby.fillForm` plan → executed with CDP `Input.insertText` for text fields.
- Current Location combobox solved with real keyboard "Boston, Massachusetts" + option pick.
- Yes/No widget for sponsorship: single `click()` (v0.2 docs noted no mousedown), verified `_active_` class on the chosen button.
- Body text "successfully submitted" hit.

### Skip: Ramp Univ Grad CX Associate (Ashby)
- Role is FT new grad CX, not intern → violates user role filter.
- Plus 6 yes/no schedule pickers v0.2 helpers couldn't reliably handle.
- v0.3 `target_filters.role_types` will catch this earlier (in sourcing), before it ever hits the batch queue.

### Skip: Sierra University Recruiter (Ashby)
- Confirmed FT $160-200K senior recruiter role, not for students.
- v0.5 feedback loop will inject this skip reason into next sourcing prompt → AI will down-rank similar listings.

## Final Dashboard (v0.2)

```
Successful: 3/6 (Cresta DS, Crusoe Motion + earlier NiCE SDR)
Skipped:    4/6 (Twilio, EnergyHub, Ramp, Sierra) — logged with reasons in batch log
Time: ~25 min total
Cost: $0 (no AI scoring in v0.2)
```

## What v0.3+ Improves

- **Sourcing**: AI auto-fetches via Greenhouse + Ashby APIs → eliminates manual URL hunting.
- **Filtering**: `target_filters` in profile.json catches FT roles like Ramp/Sierra before they hit batch.
- **Location combobox**: v0.3 helpers handle Google Places autocomplete (Twilio/EnergyHub will work).
- **Feedback loop**: Sierra/Ramp skip reasons accumulate in `~/.mrweirdo-jobs/feedback.jsonl` → next sourcing rejects similar roles.
- **Computer Use fallback**: For unknown selectors, vision finds elements (no more silent failures).
