#!/usr/bin/env bash
# mrweirdo-jobs (v1.2) bootstrap
# Curl-pipe friendly: bash <(curl -fsSL https://raw.githubusercontent.com/glin23/mrweirdo-jobs/main/setup.sh)
# Or run directly from a clone: bash setup.sh
#
# What it does:
#   1. Verify Node 24+, Chrome installed, git available
#   2. Clone (or update) the repo to ~/.ats-skills/repo
#   3. Symlink .claude/skills/* into ~/.claude/skills/ so Claude Code picks them up
#   4. Create ~/.ats-skills/ layout (log/, empty .env with chmod 600)
#   5. Print next-step: "open Claude Code, run /mrweirdo-init"
#
# Re-runnable. Idempotent.

set -e

REPO_URL="${ATS_SKILLS_REPO_URL:-https://github.com/glin23/mrweirdo-jobs.git}"
REPO_BRANCH="${ATS_SKILLS_BRANCH:-main}"
ATS_HOME="${ATS_HOME:-$HOME/.ats-skills}"
ATS_REPO_ROOT="${ATS_REPO_ROOT:-$ATS_HOME/repo}"
CLAUDE_SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
CHROME_APP="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
blue()   { printf '\033[34m%s\033[0m\n' "$*"; }

blue "mrweirdo-jobs (v1.2) bootstrap"
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
mkdir -p "$ATS_HOME"
if [ ! -d "$ATS_REPO_ROOT/.git" ]; then
  blue "Cloning $REPO_URL → $ATS_REPO_ROOT"
  git clone --branch "$REPO_BRANCH" "$REPO_URL" "$ATS_REPO_ROOT"
  green "  Cloned ✓"
else
  blue "Updating existing checkout at $ATS_REPO_ROOT"
  git -C "$ATS_REPO_ROOT" fetch origin "$REPO_BRANCH" --quiet
  # Don't auto-merge if user has local changes — just print
  if [ -n "$(git -C "$ATS_REPO_ROOT" status --porcelain)" ]; then
    yellow "  Local changes present. Skipping git pull. Run: git -C $ATS_REPO_ROOT pull"
  else
    git -C "$ATS_REPO_ROOT" pull --ff-only origin "$REPO_BRANCH" --quiet || \
      yellow "  Fast-forward pull failed (diverged?). Resolve manually in $ATS_REPO_ROOT"
    green "  Updated ✓"
  fi
fi

# ---------- 5. Symlink Claude Code skills ----------
mkdir -p "$CLAUDE_SKILLS_DIR"
for skill_dir in "$ATS_REPO_ROOT/.claude/skills"/*/; do
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

# ---------- 6. ~/.ats-skills/ layout ----------
mkdir -p "$ATS_HOME"/log
[ -f "$ATS_HOME/.env" ] || (touch "$ATS_HOME/.env" && chmod 600 "$ATS_HOME/.env")
green "  ~/.ats-skills/ layout ✓"

# ---------- 7. Next steps ----------
echo ""
blue "Setup complete. Next steps:"
echo "  1. Open Claude Code (any directory)"
echo "  2. Run: /mrweirdo-init"
echo "       → Collects Anthropic + Notion API keys, parses your resume,"
echo "         provisions a Notion 「📋 岗位追踪」 database, asks 4 questions"
echo "         to set up target_filters."
echo ""
echo "  After /mrweirdo-init you can use:"
echo "      /mrweirdo-source            — AI-scored job sourcing → Notion"
echo "      /mrweirdo-jobs            — batch apply Approved queue"
echo "      /mrweirdo-greenhouse <url>  — single Greenhouse URL"
echo "      /mrweirdo-ashby      <url>  — single Ashby URL"
echo "      /mrweirdo-lever      <url>  — single Lever URL"
echo "      /mrweirdo-confirm           — Gmail confirmation → Notion mark"
echo ""
echo "  Update later with:  git -C $ATS_REPO_ROOT pull"
echo ""
green "Done."
