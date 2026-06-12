#!/usr/bin/env bash
set -euo pipefail

export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"
for file in profile.json search_intent.json essay_profile.json; do
  path="$MRWEIRDO_HOME/$file"
  [ -f "$path" ] || { echo "Missing required profile file: $path" >&2; exit 1; }
  chmod 600 "$path"
done
