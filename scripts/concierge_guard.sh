#!/usr/bin/env bash
# Refuses a home that a concierge run has marked as off limits, and refuses a
# concierge sandbox whose marker note has gone missing.
#
# A concierge run = someone else's resume, run on this machine. Its isolation
# rides on two environment variables, and environment variables do not survive
# from one bash block to the next: every block re-exports
# MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}", so one block that was
# not prefixed used to write the stranger's data into the owner's own home
# without a word. The marker file survives between shells, which is the point.
#
# Two halves, because one is only ever a one-way check:
#   .concierge_run_active  in the owner's home   — "do not write here"
#   .concierge_sandbox     in the sandbox        — "the note above must exist"
# The note alone only speaks when it is present, so forgetting to leave it (or
# deleting it early) switched the entire protection off silently. The second
# half is what lets a run notice that its own protection is gone.
#
# The Node side does the same two checks in shared/paths.mjs; this exists for
# the entry points that copy files with `cp` and never reach Node. The two
# copies of the wording are held together by test/concierge_isolation.test.mjs,
# which fails if they drift apart.
#
# Usage: bash scripts/concierge_guard.sh "$MRWEIRDO_HOME"
set -euo pipefail

HOME_DIR="${1:?usage: concierge_guard.sh <home-dir>}"
LOCK="$HOME_DIR/.concierge_run_active"
MARKER="$HOME_DIR/.concierge_sandbox"

first_line() { head -n 1 "$1" 2>/dev/null | tr -d '\r' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'; }

if [ -f "$LOCK" ]; then
  SANDBOX="$(first_line "$LOCK")"
  [ -n "$SANDBOX" ] || SANDBOX="（纸条里没写，打开这个文件看一眼）"
  cat >&2 <<EOF
[mrweirdo] 这台电脑正在「帮别人跑」，所以你自己的家暂时上锁了：$HOME_DIR

▶ 想跑你自己的求职？撕掉那张纸条就全部恢复正常。整行复制：
    rm $LOCK

▶ 还在帮别人跑？那是刚才那条命令漏了开关。这次代跑的家是：
    $SANDBOX
  把命令改成下面这样重跑（前面两个开关一个都不能少）：
    MRWEIRDO_HOME=$SANDBOX MRWEIRDO_ONBOARD_TMP_DIR=$SANDBOX/run-tmp <刚才那条命令>

（什么都没写坏：它是拒绝干活，不是出错。）
EOF
  exit 3
fi

# The positive half: this home says it is a concierge sandbox, so the note it
# depends on had better still be in the owner's home, pointing back here.
[ -f "$MARKER" ] || exit 0
OWNER="$(first_line "$MARKER")"

refuse_sandbox() {
  cat >&2 <<EOF
[mrweirdo] 这里是一次「帮别人跑」的沙箱：$HOME_DIR
$1

$2

（在纸条贴回去之前，你自己的家是敞开的：任何一段漏了开关的命令都会悄悄写进去。）
EOF
  exit 3
}

if [ -z "$OWNER" ]; then
  refuse_sandbox "但沙箱标记 $MARKER 里没写你自己的家在哪，没法确认纸条贴没贴。" \
"▶ 回操作卡第 1 步，把那一段重新整段复制一次。"
fi

OWNER_LOCK="$OWNER/.concierge_run_active"
if [ ! -f "$OWNER_LOCK" ]; then
  refuse_sandbox "但你自己家里那张「勿入」纸条不见了：$OWNER_LOCK" \
"▶ 整行复制，把纸条贴回去：
    echo \"$HOME_DIR\" > $OWNER_LOCK
▶ 如果这次代跑已经结束，把沙箱删掉就行：
    rm -rf $HOME_DIR"
fi

POINTS_AT="$(first_line "$OWNER_LOCK")"
if [ "$POINTS_AT" != "$HOME_DIR" ]; then
  [ -n "$POINTS_AT" ] || POINTS_AT="（空的）"
  refuse_sandbox "但你自己家里那张纸条指的是另一个地方：$POINTS_AT" \
"▶ 两边对不上，说明有两次代跑串了。整行复制，让纸条指回这一次：
    echo \"$HOME_DIR\" > $OWNER_LOCK"
fi

exit 0
