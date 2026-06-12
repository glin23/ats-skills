# Engineering Backlog

## 2026-06-12

- Investigate intermittent `node:sqlite` child-process SIGSEGV on process exit
  after discovery runs. Current field observation: roughly one in three
  subprocess exits can crash after useful work has completed. A pragmatic
  mitigation is to add an explicit `process.exit(0)` at the end of
  `shared/discover_candidates.mjs`; validate that this avoids the crash without
  masking real non-zero failures.
