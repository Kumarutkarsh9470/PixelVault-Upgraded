#!/usr/bin/env bash
# Builds the Anchor program inside WSL. Prints errors with context and the
# final artifact; the full log is kept at $HOME/pixelvault-logs/anchor-build.log.
set -uo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
cd "$(dirname "$0")/../../pixelvault" || exit 1
mkdir -p "$HOME/pixelvault-logs"

anchor build > $HOME/pixelvault-logs/anchor-build.log 2>&1
status=$?

grep -E -A10 "^error" $HOME/pixelvault-logs/anchor-build.log | head -150
tail -3 $HOME/pixelvault-logs/anchor-build.log
ls -la target/deploy/pixelvault.so 2>/dev/null
echo "build exit status: $status"
exit $status
