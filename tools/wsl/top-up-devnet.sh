#!/usr/bin/env bash
# Reclaims SOL stranded in leftover deploy buffers and tops the deploy wallet
# up from the devnet faucet. Deploying the program needs about 2.4 SOL free,
# because the upload buffer is rent-exempt for the size of the binary.
set -uo pipefail
NEWEST=$(ls -d "$HOME"/.local/share/solana/install/releases/*/solana-release/bin 2>/dev/null | while read -r d; do echo "$("$d/solana" --version | awk '{print $2}') $d"; done | sort -V | tail -1 | cut -d' ' -f2)
export PATH="${NEWEST:-$HOME/.local/share/solana/install/active_release/bin}:$HOME/.cargo/bin:$PATH"

echo "balance before: $(solana balance --url devnet)"
solana program close --buffers --url devnet 2>&1 | tail -3
echo "after closing buffers: $(solana balance --url devnet)"

# The faucet caps each request, so ask a few times and keep going if it refuses.
for _ in 1 2 3; do
    solana airdrop 2 --url devnet 2>&1 | tail -1
    sleep 2
done
echo "balance after: $(solana balance --url devnet)"
