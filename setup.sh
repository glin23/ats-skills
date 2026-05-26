#!/usr/bin/env bash
# mrweirdo-jobs (v2.0) bootstrap
# Curl-pipe friendly: bash <(curl -fsSL https://raw.githubusercontent.com/glin23/mrweirdo-jobs/main/setup.sh)
# Or run directly from a clone: bash setup.sh
#
# What it does:
#   1. Verify Node 24+, Chrome installed, git available
#   2. Clone (or update) the repo to ~/.mrweirdo-jobs/repo
#   3. Symlink .claude/skills/* into ~/.claude/skills/ so Claude Code picks them up
#   4. Create ~/.mrweirdo-jobs/ layout (log/, empty .env with chmod 600)
#   5. Print next-step: "open Claude Code, run /mrweirdo-onboard"
#
# Re-runnable. Idempotent.

set -e

REPO_URL="${MRWEIRDO_REPO_URL:-https://github.com/glin23/mrweirdo-jobs.git}"
REPO_BRANCH="${MRWEIRDO_BRANCH:-main}"
MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"
MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
CLAUDE_SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
CHROME_APP="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
blue()   { printf '\033[34m%s\033[0m\n' "$*"; }

blue "mrweirdo-jobs (v2.0) bootstrap"
echo ""

# ---------- 1. Check Node 24+ ----------
if ! command -v node >/dev/null 2>&1; then
  red "Node.js not found. Install Node 24+ then re-run."
  red "  brew install node    # or https://nodejs.org/"
  exit 1
fi
NODE_MAJOR=$(node --version | sed -E 's/^v([0-9]+).*/\1/')
if [ "$NODE_MAJOR" -lt 24 ]; then
  red "Node $(node --version) found, but Node 24+ required (built-in WebSocket / PDF fetch)."
  exit 1
fi
green "  Node $(node --version) ✓"

# ---------- 2. Check Chrome (macOS only for now) ----------
if [ ! -x "$CHROME_APP" ]; then
  yellow "  Google Chrome not at default path. CDP launcher may need editing."
  yellow "  Edit shared/chrome-cdp-launcher.sh after install if needed."
else
  green "  Chrome ✓"
fi

# ---------- 3. Check git ----------
if ! command -v git >/dev/null 2>&1; then
  red "git not found. Install git, then re-run."
  exit 1
fi
green "  git ✓"

# ---------- 4. Clone or update repo ----------
mkdir -p "$MRWEIRDO_HOME"
if [ ! -d "$MRWEIRDO_REPO_ROOT/.git" ]; then
  blue "Cloning $REPO_URL → $MRWEIRDO_REPO_ROOT"
  git clone --branch "$REPO_BRANCH" "$REPO_URL" "$MRWEIRDO_REPO_ROOT"
  green "  Cloned ✓"
else
  blue "Updating existing checkout at $MRWEIRDO_REPO_ROOT"
  git -C "$MRWEIRDO_REPO_ROOT" fetch origin "$REPO_BRANCH" --quiet
  # Don't auto-merge if user has local changes — just print
  if [ -n "$(git -C "$MRWEIRDO_REPO_ROOT" status --porcelain)" ]; then
    yellow "  Local changes present. Skipping git pull. Run: git -C $MRWEIRDO_REPO_ROOT pull"
  else
    git -C "$MRWEIRDO_REPO_ROOT" pull --ff-only origin "$REPO_BRANCH" --quiet || \
      yellow "  Fast-forward pull failed (diverged?). Resolve manually in $MRWEIRDO_REPO_ROOT"
    green "  Updated ✓"
  fi
fi

# ---------- 5. Symlink Claude Code skills ----------
mkdir -p "$CLAUDE_SKILLS_DIR"
for skill_dir in "$MRWEIRDO_REPO_ROOT/.claude/skills"/*/; do
  skill_name=$(basename "$skill_dir")
  target="$CLAUDE_SKILLS_DIR/$skill_name"
  if [ -L "$target" ]; then
    existing=$(readlink "$target")
    if [ "$existing" = "$skill_dir" ] || [ "$existing" = "${skill_dir%/}" ]; then
      green "  ${skill_name} ✓ (already linked)"
      continue
    fi
    yellow "  ${skill_name} ← existing symlink points elsewhere ($existing). Removing + relinking."
    rm "$target"
  elif [ -e "$target" ]; then
    yellow "  ${skill_name} ← existing non-symlink at $target. Skipping (move it aside manually if you want the symlink)."
    continue
  fi
  ln -s "${skill_dir%/}" "$target"
  green "  ${skill_name} ✓ linked"
done

# ---------- 6. ~/.mrweirdo-jobs/ layout ----------
mkdir -p "$MRWEIRDO_HOME"/log
[ -f "$MRWEIRDO_HOME/.env" ] || (touch "$MRWEIRDO_HOME/.env" && chmod 600 "$MRWEIRDO_HOME/.env")
green "  ~/.mrweirdo-jobs/ layout ✓"

# ---------- 7. First-run sentinel ----------
# Skip if user already has a populated profile.json (they're re-running setup,
# not installing for the first time). Otherwise write the sentinel so the
# onboard skill knows to surface its Welcome banner proactively.
if [ ! -f "$MRWEIRDO_HOME/profile.json" ]; then
  cat > "$MRWEIRDO_HOME/.first_run" <<EOF
{"installed_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","setup_version":"v2.0"}
EOF
  chmod 600 "$MRWEIRDO_HOME/.first_run"
  IS_FIRST_RUN=1
else
  IS_FIRST_RUN=0
fi

# ---------- 8. Welcome / next steps ----------
echo ""
if [ "$IS_FIRST_RUN" = "1" ]; then
  cat <<'WELCOME'

╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║          👋  Welcome to Mr. Weirdo Jobs  (v2.0)                  ║
║                                                                  ║
║   Your zero-touch internship / new-grad application agent.       ║
║                                                                  ║
║   Three steps to start applying:                                 ║
║                                                                  ║
║     1️⃣   Drop your resume (PDF)                                  ║
║     2️⃣   Answer 7 quick questions (work auth · target roles)    ║
║     3️⃣   Sit back — auto-apply up to 50 jobs/day                ║
║                                                                  ║
║   ──────────────────────────────────────────────────────────     ║
║                                                                  ║
║   👉  Open Claude Code, then type:                               ║
║                                                                  ║
║          /mrweirdo-onboard                                       ║
║                                                                  ║
║       (or just say "I want to start applying for internships"    ║
║        — the agent will surface onboarding on its own)           ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝

WELCOME
else
  blue "Setup re-run — existing profile detected at ~/.mrweirdo-jobs/profile.json"
  echo "  Skipping first-run banner. Type /mrweirdo-onboard to re-onboard, or"
  echo "  use /mrweirdo-cherry-pick / /mrweirdo-confirm for daily ops."
  echo ""
fi

cat <<'REF'
  Reference (advanced):
    /mrweirdo-cherry-pick              hand-pick from scored queue, gated apply
    /mrweirdo-greenhouse-auto <url>    zero-touch single Greenhouse URL
    /mrweirdo-ashby-auto      <url>    zero-touch single Ashby URL
    /mrweirdo-lever-auto      <url>    zero-touch single Lever URL
    /mrweirdo-greenhouse      <url>    gated (you click Submit) single GH
    /mrweirdo-ashby           <url>    gated single Ashby
    /mrweirdo-lever           <url>    gated single Lever
    /mrweirdo-confirm                  Gmail confirmation → mark DB ✅ 已投
    node ~/.mrweirdo-jobs/repo/scripts/dashboard.mjs    live申请记录

REF
echo "  Update later with:  git -C $MRWEIRDO_REPO_ROOT pull"
echo ""
green "Done."
