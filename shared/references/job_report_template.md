# Job Report Template

Phase 2 `shared/job_report.mjs` should render per-job reports with this shape.

## Human Sections

- Job summary: company, title, location, ATS, source, apply URL.
- Fit summary: `fit_score`, six `dim_scores`, `key_alignment`, `key_gaps`.
- Legitimacy: `legitimacy` plus up to two `legitimacy_signals`.
- Submission audit, when available: submitted answers summary, screenshot paths,
  timestamp, recorder outcome.

## Machine Summary

Append a fenced YAML block headed `## Machine Summary`. Keep the allowlist to:

```yaml
row_id:
company:
title:
fit_score:
dim_scores:
legitimacy:
outcome_status:
ats_platform:
submitted_at:
gap_fields:
```

The report layer may read from execution artifacts and `jobs.db`, but it must
not mutate application status or trigger submissions.
