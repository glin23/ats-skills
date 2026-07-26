#!/usr/bin/env bash
# Refuses a home that a concierge run has marked as off limits.
#
# A concierge run = someone else's resume, run on this machine. Its isolation
# rides on two environment variables, and environment variables do not survive
# from one bash block to the next: every block re-exports
# MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}", so one block that was
# not prefixed used to write the stranger's data into the owner's own home
# without a word. The marker file survives between shells, which is the point.
#
# The Node side does the same check in shared/paths.mjs; this exists for the
# entry points that copy files with `cp` and never reach Node. One message, one
# place — two copies drift.
#
# Usage: bash scripts/concierge_guard.sh "$MRWEIRDO_HOME"
set -euo pipefail

HOME_DIR="${1:?usage: concierge_guard.sh <home-dir>}"
LOCK="$HOME_DIR/.concierge_run_active"

[ -f "$LOCK" ] || exit 0

SANDBOX="$(head -n 1 "$LOCK" 2>/dev/null || true)"
[ -n "$SANDBOX" ] || SANDBOX="<see the file>"

cat >&2 <<EOF
[mrweirdo] refusing to use $HOME_DIR: a concierge run is in progress, so this home is off limits.
This run belongs in: $SANDBOX
Re-run the command with both switches in front of it, e.g.
  MRWEIRDO_HOME=$SANDBOX MRWEIRDO_ONBOARD_TMP_DIR=$SANDBOX/run-tmp bash <script>
When the concierge run is finished, delete $LOCK.
EOF
exit 3
