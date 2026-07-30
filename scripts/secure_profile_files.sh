#!/usr/bin/env bash
set -euo pipefail

export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$(dirname "$SCRIPT_DIR")}"

# Locking is delegated to the single carrier list in shared/state_file_lock.mjs
# (PII_TARGETS). This script used to keep its own list of three-then-five files
# and missed everything else — cover_letter.pdf, screenshots, cover letters —
# so it no longer maintains a second list that can rot.
#
# The sweep runs FIRST, before the required-file check: locking what IS on disk
# must not depend on the home being complete (measured 2026-07-26:
# answer_provenance.json was left at 644 exactly because a required-file loop
# exited before the optional lock ever ran).
node "$REPO_ROOT/shared/state_file_lock.mjs" sweep > /dev/null

# Still a hard failure: a home missing one of the required trio is a real
# problem and the caller has to hear about it. Securing what exists first does
# not make the gap quieter.
for file in profile.json search_intent.json essay_profile.json; do
  path="$MRWEIRDO_HOME/$file"
  [ -f "$path" ] || { echo "Missing required profile file: $path" >&2; exit 1; }
done
