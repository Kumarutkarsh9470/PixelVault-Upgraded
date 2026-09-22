# PixelVault

**In-game purchases you can refund.** Every item holds USDC that a Solana program, not the studio, guarantees the player can take back.

Built for the Colosseum Crypto World's Fair hackathon (Solana track).

## Why

Web3 games have mostly died, and taken players' money with them. PixelVault makes a game item a claim on real value:

- **A protocol-enforced backing floor.** Studios choose a backing ratio per item class inside a 50–95% band. The backing sits in a program-owned vault the studio can never withdraw.
- **Redemption survives the studio.** Burning an item returns its backing. Redemption has no pause switch and needs no game server.
- **Value moves between games at par.** Burn an item in one game and mint in another in a single transaction, with no market or liquidity provider in between.

Studios earn the unbacked margin on every craft, and can price items far higher because the player's real cost is only that margin. The protocol takes 12.5% of the margin; redemption and routing are free.

## Repository

| Path | What it is |
|---|---|
| `pixelvault/` | Anchor program: game vaults, Token-2022 item classes, craft, redeem, and integration tests (litesvm) |
| `game/` | Unity 6 racing game, built for the web and run as a Telegram Mini App |
| `web/` | Wallet and player UI (React, Privy embedded Solana wallets, seamless Telegram login) |
| `deploy/racer/` | Vercel deployment: the game build, the web build, and API functions such as the fee-sponsoring relayer |
| `tools/` | Local server and end-to-end relayer tests |

Devnet program: `AANvcGamRqQccnrx3XHnynJAXh4KCdJAa2XYnazNsuoZ`

## Running it

**Program** (inside WSL, with the Solana and Anchor toolchains installed):

```bash
cd pixelvault
anchor build
cargo test
```

The workspace pins Rust 1.98.1 for host builds (tests and IDL generation). On-chain binaries are always compiled by the Solana toolchain's own bundled compiler.

**Web** (writes into `deploy/racer/wallet`):

```bash
cd web && npm install && npm run build
```

**Game:** open `game/` in Unity 6000.0.84f1 and run *PixelVault → Build Web Spike*, or build headless with `-executeMethod SpikeBuilder.BuildWebGL`.

**Local server** with the API functions:

```bash
node tools/serve-web.mjs deploy/racer 8091
```

## Prior work disclosure

This project builds on an idea the author explored in an earlier hackathon: [PixelVault on Initia](https://github.com/Kumarutkarsh9470/INITIA_Hack), a cross-game economy built around per-game tokens, an AMM and ERC-6551 player accounts on an Initia MiniEVM rollup.

This repository is a new codebase started during the Crypto World's Fair. It shares no code with that project and deliberately abandons its core model: the per-game-token design is replaced by USDC-backed items with a protocol-enforced redemption floor, on Solana.
