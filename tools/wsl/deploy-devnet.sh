#!/usr/bin/env bash
# Upgrades the devnet program in place, extending its data account first if
# the new binary is larger than the space already allocated.
set -uo pipefail
# Prefer the newest installed Agave CLI: older ones reject SBPF v3 binaries in
# their local pre-deploy check even where the cluster has the feature enabled.
NEWEST=$(ls -d "$HOME"/.local/share/solana/install/releases/*/solana-release/bin 2>/dev/null | while read -r d; do echo "$("$d/solana" --version | awk '{print $2}') $d"; done | sort -V | tail -1 | cut -d' ' -f2)
export PATH="${NEWEST:-$HOME/.local/share/solana/install/active_release/bin}:$HOME/.cargo/bin:$PATH"
echo "using $(solana --version)"
cd "$(dirname "$0")/../../pixelvault" || exit 1

PROGRAM_ID=AANvcGamRqQccnrx3XHnynJAXh4KCdJAa2XYnazNsuoZ
SO=target/deploy/pixelvault.so

echo "wallet balance: $(solana balance --url devnet)"
new_size=$(stat -c %s "$SO")
current=$(solana program show "$PROGRAM_ID" --url devnet | awk '/Data Length/ {print $3}')
echo "binary $new_size bytes, allocated ${current:-0} bytes"

if [ -n "$current" ] && [ "$new_size" -gt "$current" ]; then
    extra=$((new_size - current + 20000))
    echo "extending program by $extra bytes"
    solana program extend "$PROGRAM_ID" "$extra" --url devnet
fi

# Reclaim SOL from buffers left behind by interrupted deploys.
solana program close --buffers --url devnet || true

# The public devnet RPC rate-limits the many buffer-write transactions, so
# retry signatures patiently.
solana program deploy "$SO" --program-id target/deploy/pixelvault-keypair.json --url devnet --max-sign-attempts 60
solana program show "$PROGRAM_ID" --url devnet
echo "wallet balance: $(solana balance --url devnet)"
