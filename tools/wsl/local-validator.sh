#!/usr/bin/env bash
# Runs a throwaway local validator with the program deployed, for testing the
# client's on-chain path without spending devnet SOL.
#   start  - reset the ledger, launch, deploy the program, print the program id
#   stop   - kill it
set -uo pipefail
NEWEST=$(ls -d "$HOME"/.local/share/solana/install/releases/*/solana-release/bin 2>/dev/null | while read -r d; do echo "$("$d/solana" --version | awk '{print $2}') $d"; done | sort -V | tail -1 | cut -d' ' -f2)
export PATH="${NEWEST:-$HOME/.local/share/solana/install/active_release/bin}:$HOME/.cargo/bin:$PATH"

REPO=/mnt/c/Users/My/Desktop/Crypto_World_Fair
LEDGER=/tmp/pv-validator
URL=http://127.0.0.1:8899

case "${1:-start}" in
start)
    pkill -f solana-test-validator >/dev/null 2>&1
    sleep 2
    rm -rf "$LEDGER"
    mkdir -p "$LEDGER"
    cd "$LEDGER" || exit 1
    nohup solana-test-validator --quiet --reset --ledger "$LEDGER" >/tmp/validator.log 2>&1 &
    for _ in $(seq 1 30); do
        sleep 2
        if solana cluster-version --url "$URL" >/dev/null 2>&1; then
            break
        fi
    done
    solana cluster-version --url "$URL" || { echo "validator did not start"; tail -5 /tmp/validator.log; exit 1; }

    solana airdrop 100 --url "$URL" >/dev/null 2>&1
    solana program deploy "$REPO/pixelvault/target/deploy/pixelvault.so" \
        --program-id "$REPO/pixelvault/target/deploy/pixelvault-keypair.json" --url "$URL"
    echo "wallet: $(solana address) with $(solana balance --url "$URL")"
    ;;
stop)
    pkill -f solana-test-validator >/dev/null 2>&1
    echo "stopped"
    ;;
esac
