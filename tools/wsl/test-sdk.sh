#!/usr/bin/env bash
# Runs the SDK's tests inside WSL, where litesvm's native binding exists, so the
# program test (two studios against the compiled program) runs locally too.
# Usage: test-sdk.sh [test-file-filter]
set -uo pipefail
SRC="$(cd "$(dirname "$0")/../../sdk" && pwd)"
WORK=/tmp/pixelvault-sdk
rm -rf "$WORK" && mkdir -p "$WORK"
cp -r "$SRC/src" "$SRC/test" "$SRC/package.json" "$SRC/package-lock.json" "$SRC/tsconfig.json" "$SRC/tsconfig.build.json" "$WORK/"
# The program test reads the compiled program and the admin key from the repo and ~/.config/solana.
mkdir -p "$WORK/../pixelvault/target/deploy" 2>/dev/null || true
cd "$WORK" || exit 1
npm ci --no-audit --no-fund >/tmp/pixelvault-sdk-install.log 2>&1 || { tail -5 /tmp/pixelvault-sdk-install.log; exit 1; }
# A lockfile written on Windows omits the Linux binding (npm/cli#4828); add it explicitly.
npm install --no-save --no-audit --no-fund "litesvm-linux-x64-gnu@$(node -p "require('litesvm/package.json').version")" >>/tmp/pixelvault-sdk-install.log 2>&1 || true
export PIXELVAULT_PROGRAM_SO="$SRC/../pixelvault/target/deploy/pixelvault.so"
node --import tsx --test test/${1:-*}.test.ts 2>&1 | grep -E "^# (tests|pass|fail|skipped)|^not ok|^ok|Error:|AssertionError" | head -60
