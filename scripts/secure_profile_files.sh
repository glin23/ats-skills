#!/usr/bin/env bash
set -euo pipefail

export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"
for file in profile.json search_intent.json essay_profile.json; do
  path="$MRWEIRDO_HOME/$file"
  [ -f "$path" ] || { echo "Missing required profile file: $path" >&2; exit 1; }
  chmod 600 "$path"
done

# Files that only exist once the user has answered something. Absent is normal,
# so these are locked down when present rather than demanded.
# `[ -f x ] && chmod` would abort the whole script under `set -e` the moment one
# of these is absent, which is the normal case. Spelled out as an `if`.
for file in answer_provenance.json profile.json.bak; do
  path="$MRWEIRDO_HOME/$file"
  if [ -f "$path" ]; then
    chmod 600 "$path"
  fi
done
