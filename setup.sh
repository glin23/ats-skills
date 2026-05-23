#!/usr/bin/env bash
# ats-skills setup
# One-time initialization: checks dependencies and seeds shared/profile.json.
# Zero install steps. No brew, no npm, no pip.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHARED_DIR="$SCRIPT_DIR/shared"
TEMPLATE="$SHARED_DIR/profile.template.json"
PROFILE="$SHARED_DIR/profile.json"
CHROME_APP="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
blue()   { printf '\033[34m%s\033[0m\n' "$*"; }

blue "ats-skills setup"
echo ""

# 1. Check Node 24+
if ! command -v node >/dev/null 2>&1; then
  red "Node.js is not installed. Install Node 24 or later, then re-run this script."
  red "  https://nodejs.org/ or: brew install node"
  exit 1
fi

NODE_VERSION="$(node --version)"           # e.g. v24.1.0
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"

if [ "$NODE_MAJOR" -lt 24 ]; then
  red "Node $NODE_VERSION found, but Node 24+ is required."
  red "The CDP driver uses Node's built-in WebSocket, available in 24+."
  exit 1
fi
green "  Node $NODE_VERSION ok"

# 2. Check Chrome
if [ ! -x "$CHROME_APP" ]; then
  red "Google Chrome not found at:"
  red "  $CHROME_APP"
  yellow "If you have Chromium, Brave, or another Chromium-based browser, edit"
  yellow "shared/chrome-cdp-launcher.sh to point at its binary."
  exit 2
fi
green "  Google Chrome ok"

# 3. Seed profile.json from template
if [ ! -f "$TEMPLATE" ]; then
  red "Missing $TEMPLATE — repository looks incomplete."
  exit 1
fi

if [ -f "$PROFILE" ]; then
  yellow "  shared/profile.json already exists, leaving it alone"
else
  cp "$TEMPLATE" "$PROFILE"
  green "  Created shared/profile.json from template"
fi

# 4. Check resume path inside profile.json (best-effort)
RESUME_PATH="$(node -e "
  try {
    const p = require('$PROFILE');
    process.stdout.write(p.resume_path || '');
  } catch (e) { process.stdout.write(''); }
" 2>/dev/null || true)"

if [ -z "$RESUME_PATH" ] || [ "$RESUME_PATH" = "/absolute/path/to/your_resume.pdf" ]; then
  yellow ""
  yellow "  resume_path in shared/profile.json is still the placeholder."
  yellow "  Edit it to point at your actual resume PDF before running the skills."
elif [ ! -f "$RESUME_PATH" ]; then
  red ""
  red "  resume_path = $RESUME_PATH"
  red "  ...but that file does not exist. Fix it before running the skills."
  exit 3
else
  green "  Resume found at $RESUME_PATH"
fi

# v0.2: ensure log directory exists
LOG_DIR="$HOME/.ats-skills/log"
mkdir -p "$LOG_DIR"
green "Log directory ready: $LOG_DIR"
echo ""
echo "Next time you open Claude Code, try one of:"
echo "  /ats-skills                  # batch mode (v0.2) — recommended"
echo "  /ats-greenhouse <url>        # single Greenhouse URL"
echo "  /ats-ashby <url>             # single Ashby URL"
echo ""
echo "When you run a batch, the skill prints the queue and asks 'go' once — that single confirmation covers every application in the batch."

echo ""
blue "Next steps:"
echo "  1. Edit shared/profile.json with your personal info."
echo "  2. Launch the dedicated Chrome instance:"
echo "       ./shared/chrome-cdp-launcher.sh"
echo "  3. Inside that Chrome window, log into LinkedIn and any other sites you"
echo "     want auto-filled by the browser itself."
echo "  4. In Claude Code, ask:"
echo "       Use ats-greenhouse to fill in this application: <url>"
echo ""
green "Setup complete."
