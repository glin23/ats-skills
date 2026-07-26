#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: bash scripts/intake_resume.sh <resume.pdf>" >&2
  exit 2
fi

RESUME_PATH="$1"
case "$RESUME_PATH" in
  "~/"*) RESUME_PATH="$HOME/${RESUME_PATH#~/}" ;;
esac

export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"
# Before the copy, not after: a resume is the one file that must never land in
# somebody else's home, and the line above happily falls back to this machine's
# owner when nothing was inherited.
bash "$(dirname "${BASH_SOURCE[0]}")/concierge_guard.sh" "$MRWEIRDO_HOME"
mkdir -p "$MRWEIRDO_HOME"

[ -f "$RESUME_PATH" ] || { echo "Resume not found: $RESUME_PATH" >&2; exit 1; }
file "$RESUME_PATH" | grep -qi "pdf" || { echo "Not a PDF: $RESUME_PATH" >&2; exit 1; }

cp "$RESUME_PATH" "$MRWEIRDO_HOME/resume.pdf"
chmod 600 "$MRWEIRDO_HOME/resume.pdf"
echo "$MRWEIRDO_HOME/resume.pdf"
