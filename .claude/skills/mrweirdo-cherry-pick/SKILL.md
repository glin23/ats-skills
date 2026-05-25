---
name: mrweirdo-cherry-pick
description: Opt-in flow for applying to large-quota companies (Google / Meta / Microsoft / FAANG / 投行 / etc.) that v2 onboard auto-apply DELIBERATELY SKIPS to protect the user's limited submission cap at each. User triggers manually when they're ready to invest a quota slot on a dream role. Uses v1 half-auto submit gate (PRE-SUBMIT REVIEW PRESERVED) — these are 1-shot-per-cycle bets, not batch fodder. Triggered via "/mrweirdo-cherry-pick", "投个大公司", "看下大公司限投".
---

# mrweirdo-cherry-pick — large-company opt-in (submit gate PRESERVED)

> ⚠️ **This skill preserves the v1 submit gate** even though v2 onboard auto-submits. Rationale per PRD §"Red lines: preserved":
> - Large companies have HARD submission quotas (Google ~3/6mo, Amazon ~10/yr, etc.)
> - Auto-applying burns the quota on a non-dream role = permanent loss until quota resets
> - These are 1-shot-per-cycle bets — humans must consciously pick the role + dot every i

## When to trigger

- User says: "投个大公司" / "/mrweirdo-cherry-pick" / "看下大公司队列" / "Google 那家想投" / "想用 1 个大厂 quota slot"
- User finished an `/mrweirdo-onboard` run and saw "N 家大公司限投 (skip 了)" in the report, now wants to invest
- User wants to apply to a specific large company by URL (e.g. they spotted a perfect role)

## When NOT to trigger

- User is mid-`/mrweirdo-onboard` run → that's batch flow; large-co are auto-skipped there by design
- User wants to investigate a non-large-cap URL → route to `/mrweirdo-greenhouse` / `-ashby` / `-lever`

---

## Flow

### Step 1 — List quota-capped candidates from DB

```bash
node -e "
import('$MRWEIRDO_REPO_ROOT/shared/local_db.mjs').then(async (m) => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(m.dbPath());
  const rows = db.prepare(\`
    SELECT id, company, title, apply_url, fit_score, location, apply_quota_limit, apply_quota_period
    FROM v_large_company_pending
    ORDER BY fit_score DESC NULLS LAST
    LIMIT 20
  \`).all();
  for (const r of rows) console.log(JSON.stringify(r));
});
" 2>/dev/null
```

Display the list to the user — fit_score, company, title, role URL, the quota (e.g. "Google: 3/6mo").

### Step 2 — Read the user's quota.jsonl for already-spent slots

```bash
cat "$MRWEIRDO_HOME/quota.jsonl" 2>/dev/null | tail -50 || echo "(no quota log yet)"
```

For each candidate company, compute remaining quota = `apply_quota_limit - count(quota.jsonl rows for that company within period)`.
If remaining ≤ 0 → **strikethrough** that row in the display + warn "quota exhausted, will not apply".

### Step 3 — Ask user which to invest

Use AskUserQuestion (single-select if presenting top-4, multi-select if user said "投这几家"). Each candidate is a separate option with company + role + fit_score in the label.

If candidates > 4 (AskUserQuestion limit), show the top-4 by fit_score in the first question; let user say "more" to see the next batch.

### Step 4 — For each user-chosen row: v1 half-auto flow

This is where cherry-pick **differs** from auto-submit. Dispatch to the v1 skill (NOT v2 auto):

- `ats_platform == 'greenhouse'` → invoke `/mrweirdo-greenhouse <url>` (v1, manual submit gate)
- `ats_platform == 'ashby'`      → `/mrweirdo-ashby <url>` (v1)
- `ats_platform == 'lever'`      → `/mrweirdo-lever <url>` (v1)
- `ats_platform == 'workday'`    → `/mrweirdo-workday <url>` (v1, per-company config)
- `ats_platform == 'smartrecruiters'` / `icims` / `jobvite` / `handshake` → v1 single-URL skill (still beta — user accepts risk)

The v1 skills pause before Submit + show pre-submit screenshot. User reviews + says "投" → Submit. **This human gate is intentional for large-co.**

### Step 5 — On Submit success, log to quota.jsonl

```bash
echo "{\"ts\":\"$(date -u -Iseconds)\",\"company\":\"$COMPANY\",\"role\":\"$ROLE\",\"apply_url\":\"$URL\",\"quota_consumed\":1}" \
  >> "$MRWEIRDO_HOME/quota.jsonl"
```

Also update jobs.db row: `status='✅ 已投'`, `submitted_at=now`, `bot_note='mrweirdo-cherry-pick (large-co quota)'`.

### Step 6 — Report

Print:
- 投了 N 家
- 每家 quota 剩余 (e.g. "Google: 用了 1/3, 还剩 2")
- 下次 quota reset 大致时间

---

## What this skill DOES NOT do

- Does not auto-click Submit — that's the whole point; large-co get human review
- Does not bypass quota — if user picks a company already at cap, refuse + explain
- Does not silently spend quota — every cherry-pick submit logs to quota.jsonl

## What this skill DOES preserve from v1

- Pre-submit screenshot shown to user
- User explicitly says "投" to commit each Submit
- Per-row submit gate (NOT batch authorization)

## Reference

- v2 PRD §"Red lines: preserved" — large-company quota guard rationale
- `shared/quota.mjs` — quota counting utilities
- v1 single-URL skills: `.claude/skills/mrweirdo-{greenhouse,ashby,lever,workday}/SKILL.md`
- jobs.db view `v_large_company_pending` — candidate source
