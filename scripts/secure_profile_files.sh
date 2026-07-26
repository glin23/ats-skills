#!/usr/bin/env bash
set -euo pipefail

export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"

# Files that only exist once the user has answered something. Absent is normal,
# so these are locked down when present rather than demanded.
# `[ -f x ] && chmod` would abort the whole script under `set -e` the moment one
# of these is absent, which is the normal case. Spelled out as an `if`.
#
# Deliberately BEFORE the required-file loop, which exits on the first file it
# cannot find. answer_provenance.json is written at the A0 write-back while
# search_intent.json is not written until a later step, so a home in exactly the
# state this block exists to cover is also a home that makes the loop below
# exit — measured 2026-07-26, the file was left at 644. Locking what is on disk
# does not depend on the rest of the home being complete.
for file in answer_provenance.json profile.json.bak; do
  path="$MRWEIRDO_HOME/$file"
  if [ -f "$path" ]; then
    chmod 600 "$path"
  fi
done

for file in profile.json search_intent.json essay_profile.json; do
  path="$MRWEIRDO_HOME/$file"
  [ -f "$path" ] || { echo "Missing required profile file: $path" >&2; exit 1; }
  chmod 600 "$path"
done
