#!/usr/bin/env bash
# Mr. Weirdo Jobs bootstrap
# Curl-pipe friendly: bash <(curl -fsSL https://raw.githubusercontent.com/glin23/mrweirdo-jobs/main/setup.sh)
# Or run directly from a clone: bash setup.sh
#
# What it does:
#   1. Verify Node 24+, Chrome installed, git available
#   2. Clone (or update) the repo to ~/.mrweirdo-jobs/repo
#   3. Symlink .claude/skills/* into Claude Code and Codex skill locations
#   4. Create ~/.mrweirdo-jobs/ layout (log/, empty .env with chmod 600)
#   5. Print next-step: "open Claude Code or Codex, run /mrweirdo-onboard"
#
# Re-runnable. Idempotent.

set -e

REPO_URL="${MRWEIRDO_REPO_URL:-https://github.com/glin23/mrweirdo-jobs.git}"
REPO_BRANCH="${MRWEIRDO_BRANCH:-main}"
MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"
MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
CLAUDE_SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
CODEX_SKILLS_DIR="${CODEX_SKILLS_DIR:-$HOME/.codex/skills}"
CHROME_APP="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
blue()   { printf '\033[34m%s\033[0m\n' "$*"; }

blue "Mr. Weirdo Jobs public alpha bootstrap"
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
  # Don't auto-merge if user has local changes — just print
  if [ -n "$(git -C "$MRWEIRDO_REPO_ROOT" status --porcelain)" ]; then
    yellow "  Local changes present. Skipping git fetch/pull. Run manually after committing or stashing:"
    yellow "    git -C $MRWEIRDO_REPO_ROOT pull"
  else
    git -C "$MRWEIRDO_REPO_ROOT" fetch origin "$REPO_BRANCH" --quiet
    git -C "$MRWEIRDO_REPO_ROOT" pull --ff-only origin "$REPO_BRANCH" --quiet || \
      yellow "  Fast-forward pull failed (diverged?). Resolve manually in $MRWEIRDO_REPO_ROOT"
    green "  Updated ✓"
  fi
fi

SETUP_VERSION="$(cat "$MRWEIRDO_REPO_ROOT/VERSION" 2>/dev/null || echo "v0.0.0-alpha")"

# ---------- 5. Symlink skills for Claude Code + Codex ----------
link_skill_tree() {
  local dest_dir="$1"
  local label="$2"
  mkdir -p "$dest_dir"
  blue "Linking skills for $label → $dest_dir"

  for skill_dir in "$MRWEIRDO_REPO_ROOT/.claude/skills"/*/; do
    [ -d "$skill_dir" ] || continue
    skill_name=$(basename "$skill_dir")
    target="$dest_dir/$skill_name"
    if [ -L "$target" ]; then
      existing=$(readlink "$target")
      if [ "$existing" = "$skill_dir" ] || [ "$existing" = "${skill_dir%/}" ]; then
        green "  ${skill_name} ✓ (already linked)"
        continue
      fi
      if [ "${MRWEIRDO_FORCE_LINK:-0}" = "1" ]; then
        yellow "  ${skill_name} ← replacing existing symlink ($existing)."
        rm "$target"
      else
        yellow "  ${skill_name} ← existing symlink points elsewhere ($existing). Skipping. Set MRWEIRDO_FORCE_LINK=1 to replace."
        continue
      fi
    elif [ -e "$target" ]; then
      if [ "${MRWEIRDO_FORCE_LINK:-0}" = "1" ] && [[ "$target" == "$MRWEIRDO_REPO_ROOT/.agents/skills/"* ]]; then
        yellow "  ${skill_name} ← replacing generated workspace copy at $target."
        rm -rf "$target"
      else
        yellow "  ${skill_name} ← existing non-symlink at $target. Skipping (move it aside manually, or set MRWEIRDO_FORCE_LINK=1 for generated .agents links)."
        continue
      fi
    fi
    if ln -s "${skill_dir%/}" "$target"; then
      green "  ${skill_name} ✓ linked"
    else
      yellow "  ${skill_name} ← could not create link at $target. Continuing."
    fi
  done
}

link_skill_tree "$CLAUDE_SKILLS_DIR" "Claude Code"
link_skill_tree "$CODEX_SKILLS_DIR" "Codex user skills"

# Codex desktop also discovers workspace-local skills under .agents/skills.
# Treat this as a generated compatibility mirror; it is intentionally gitignored.
link_skill_tree "$MRWEIRDO_REPO_ROOT/.agents/skills" "Codex workspace skills"

# ---------- 6. ~/.mrweirdo-jobs/ layout ----------
mkdir -p "$MRWEIRDO_HOME"/log "$MRWEIRDO_HOME"/chrome-profile "$MRWEIRDO_HOME"/generated_materials
[ -f "$MRWEIRDO_HOME/.env" ] || (touch "$MRWEIRDO_HOME/.env" && chmod 600 "$MRWEIRDO_HOME/.env")
green "  ~/.mrweirdo-jobs/ layout ✓"

# ---------- 7. First-run sentinel ----------
# Skip if user already has a populated profile.json (they're re-running setup,
# not installing for the first time). Otherwise write the sentinel so the
# onboard skill knows to surface its Welcome banner proactively.
if [ ! -f "$MRWEIRDO_HOME/profile.json" ]; then
  cat > "$MRWEIRDO_HOME/.first_run" <<EOF
{"installed_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","setup_version":"$SETUP_VERSION"}
EOF
  chmod 600 "$MRWEIRDO_HOME/.first_run"
  IS_FIRST_RUN=1
else
  IS_FIRST_RUN=0
fi

# ---------- 8. Install health check ----------
blue "Running install health check"
if node "$MRWEIRDO_REPO_ROOT/shared/doctor.mjs" --install-check; then
  green "  doctor ✓"
else
  yellow "  doctor found install issues. Fix FAIL rows above before running real applications."
fi

# ---------- 9. Welcome / next steps ----------
echo ""
if [ "$IS_FIRST_RUN" = "1" ]; then
  cat <<WELCOME

Welcome to Mr. Weirdo Jobs ($SETUP_VERSION)

Public alpha: resume-driven US student job application skill.

Three steps to start:
  1. Drop your resume PDF and a short self-introduction.
  2. Answer 3 hard-boundary questions:
     work authorization, location, and legal/attestation policy.
  3. Confirm the parsed profile/search intent, then run a small batch.
     Supported Greenhouse / Ashby rows can auto-submit after that consent.

Before the first run, start the dedicated Chrome launcher.
Then open Claude Code or Codex and type:

  /mrweirdo-onboard

You can also say: "I want to start applying for internships."

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
    /mrweirdo-greenhouse      <url>    gated (you click Submit) single GH
    /mrweirdo-ashby           <url>    gated single Ashby
    /mrweirdo-lever           <url>    gated single Lever
    /mrweirdo-confirm                  Gmail confirmation → mark DB ✅ 已投
    /mrweirdo-doctor                   check install + Chrome CDP readiness
    node ~/.mrweirdo-jobs/repo/scripts/dashboard.mjs    live申请记录

REF
echo "  Skills installed for Claude Code and Codex."
echo "  Start Chrome CDP: bash \"$MRWEIRDO_REPO_ROOT/shared/chrome-cdp-launcher.sh\""
echo "  If 9222 is busy: ATS_CDP_PORT=9223 bash \"$MRWEIRDO_REPO_ROOT/shared/chrome-cdp-launcher.sh\""
echo "  Before first real run: node $MRWEIRDO_REPO_ROOT/shared/doctor.mjs --cdp"
echo "  Update later with:  git -C $MRWEIRDO_REPO_ROOT pull"
echo ""
green "Done."
