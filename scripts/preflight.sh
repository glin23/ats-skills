#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"

cd "$MRWEIRDO_REPO_ROOT"
mkdir -p "$MRWEIRDO_HOME/log" /tmp/mrweirdo-onboard

NODE_MAJOR="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "Node 24+ required, found $(node --version)" >&2
  exit 1
fi

if [ -z "${CDP_HOST:-}" ] && [ -f "$MRWEIRDO_HOME/cdp_host" ]; then
  export CDP_HOST="$(cat "$MRWEIRDO_HOME/cdp_host")"
fi
export ATS_CDP_PORT="${ATS_CDP_PORT:-${CDP_HOST##*:}}"
[ -n "$ATS_CDP_PORT" ] || ATS_CDP_PORT=9222
export CDP_HOST="${CDP_HOST:-localhost:$ATS_CDP_PORT}"

if ! curl -sf "http://$CDP_HOST/json/version" >/dev/null 2>&1; then
  echo "[mrweirdo] Chrome CDP is not running; launching Chrome on $CDP_HOST..." >&2
  ATS_CDP_PORT="$ATS_CDP_PORT" bash shared/chrome-cdp-launcher.sh
fi

node shared/doctor.mjs --cdp
echo "[mrweirdo] preflight ready home=$MRWEIRDO_HOME cdp=$CDP_HOST"
