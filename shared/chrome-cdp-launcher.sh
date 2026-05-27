#!/usr/bin/env bash
# Launch a dedicated Chrome instance with remote debugging on port 9222.
#
# Uses `open -na` to start an independent process group, so the launched
# window does NOT take over (or get killed by) your daily Chrome.
#
# Profile lives at ~/.mrweirdo-jobs/chrome-profile — log into LinkedIn etc.
# there. Your default Chrome profile is untouched.

set -e

PORT="${ATS_CDP_PORT:-9222}"
MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"
PROFILE_DIR="${MRWEIRDO_CHROME_PROFILE:-$MRWEIRDO_HOME/chrome-profile}"
CDP_HOST_FILE="$MRWEIRDO_HOME/cdp_host"
CHROME_APP="/Applications/Google Chrome.app"
CHROME_BIN="$CHROME_APP/Contents/MacOS/Google Chrome"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

# 1. Is something already on port 9222?
if curl -s --max-time 1 "http://localhost:$PORT/json/version" >/dev/null 2>&1; then
  mkdir -p "$MRWEIRDO_HOME"
  echo "localhost:$PORT" > "$CDP_HOST_FILE"
  chmod 600 "$CDP_HOST_FILE" 2>/dev/null || true
  green "Chrome with CDP already running on port $PORT."
  curl -s "http://localhost:$PORT/json/version" | head -c 400
  echo ""
  exit 0
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  red "Port $PORT is in use by another process, but it does not look like Chrome CDP."
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
  red "Free the port, or use another one:"
  red "  ATS_CDP_PORT=9223 bash ~/.mrweirdo-jobs/repo/shared/chrome-cdp-launcher.sh"
  exit 1
fi

# 2. Check Chrome
if [ ! -x "$CHROME_BIN" ]; then
  red "Google Chrome not found at $CHROME_BIN"
  yellow "If you use Chromium, Brave, or another Chromium-based browser, edit"
  yellow "CHROME_APP / CHROME_BIN in this script."
  exit 2
fi

# 3. Make profile dir
mkdir -p "$PROFILE_DIR"
mkdir -p "$MRWEIRDO_HOME"

green "Launching dedicated Chrome instance"
echo "  profile : $PROFILE_DIR"
echo "  port    : $PORT"
echo ""

# 4. `open -na` forces a NEW Chrome instance, separate from your daily Chrome.
#    Without -n, macOS just brings the existing Chrome to the front and ignores
#    the args. -a names the app bundle. `--args` passes everything after to
#    Chrome itself.
if ! open -na "$CHROME_APP" --args \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  --disable-features=ChromeWhatsNewUI; then
  yellow "macOS open failed; falling back to Chrome executable directly."
  "$CHROME_BIN" \
    --remote-debugging-port="$PORT" \
    --user-data-dir="$PROFILE_DIR" \
    --no-first-run \
    --no-default-browser-check \
    --disable-features=ChromeWhatsNewUI \
    >/dev/null 2>&1 &
fi

# 5. Wait briefly for CDP to come up so the user gets a clear OK.
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s --max-time 1 "http://localhost:$PORT/json/version" >/dev/null 2>&1; then
    echo "localhost:$PORT" > "$CDP_HOST_FILE"
    chmod 600 "$CDP_HOST_FILE" 2>/dev/null || true
    green "CDP is up on port $PORT."
    green "Wrote CDP host to $CDP_HOST_FILE"
    exit 0
  fi
  sleep 0.5
done

yellow "Launched Chrome, but CDP did not respond on port $PORT within 5s."
yellow "Check the Chrome window and try again."
exit 1
