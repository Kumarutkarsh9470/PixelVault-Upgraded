#!/usr/bin/env bash
# Runs the program's litesvm tests inside WSL.
# Usage: test-program.sh [test-name-filter]
set -uo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
cd "$(dirname "$0")/../../pixelvault" || exit 1
mkdir -p "$HOME/pixelvault-logs"

cargo test ${1:+"$1"} > $HOME/pixelvault-logs/anchor-test.log 2>&1
status=$?

grep -E -A10 "^error" $HOME/pixelvault-logs/anchor-test.log | head -120
grep -E "^test |test result" $HOME/pixelvault-logs/anchor-test.log | head -40
grep -A6 "panicked at" $HOME/pixelvault-logs/anchor-test.log | head -60
echo "test exit status: $status"
exit $status
