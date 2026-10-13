# Submission text

Copy from here into the Colosseum portal and the Superteam Earn listings. Fields marked **[you]** need a personal answer.

## Product name

PixelVault

## One line

In-game purchases you can refund: every item holds USDC that a Solana program, not the studio, guarantees the player can take back.

## Description

Web3 games have mostly died and taken their players' money with them. Tokens went to zero, NFTs found no buyers, and studios that shut down left items worth nothing. PixelVault makes a game item a claim on real value.

When a player crafts an item, most of its price is locked as USDC in a vault owned by the PixelVault program, not by the studio. Burning the item at any time returns that backing to the player's wallet. The studio picks each item's backing inside a 50–95% band that is compiled into the program, can raise it but never lower it, and cannot withdraw the vault or pause redemption. A studio can go offline and every item it ever sold is still worth what it says on the label.

Studios earn the unbacked margin on every craft and can price items higher than today, because the player's real cost is only that margin. The protocol takes 12.5% of the margin; redemption is free.

The submission is a working product, live on Solana devnet as a Telegram Mini App:

- **Neon Racer**, a Unity racing game. Medals earn materials; materials plus USDC craft chassis, underglow and trails; every item shows its refund value before you pay; the Vault redeems it in one tap.
- **Glyph Forge**, a second game built as an outside studio would build it, through `@pixelvault/sdk` only, with its own backend and its own on-chain grant key. Every run is replayed on the server from the player's inputs. Items move between the two games in a single transaction, at par.
- **Embedded wallets with no SOL.** Telegram login creates a Privy wallet; a relayer sponsors every fee and only co-signs a strict allowlist of instructions.
- **A studio integrates with one command.** `npx pixelvault setup` registers a game and its item classes from a catalog file and writes the addresses the SDK needs; `createSponsor` gives any studio the fee-payer relayer with its safety rules built in, behind their own login. A third game was registered on devnet this way with a throwaway key: https://explorer.solana.com/address/F8Wb3An2AjWC2xGMzaJHskSvpzxtFeqCzYvL4L3CduvN?cluster=devnet
- **Twelve adversarial program tests**, SDK tests against the compiled program, sponsor-rule tests on real compiled transactions, relayer attack tests, and a threat model that maps each attack to the test that stops it, all in CI.

The on-chain program is about 1,200 lines of Anchor across eight instructions. It uses Token-2022 semi-fungible mints per item class, an Ed25519 precompile check for server-signed craft grants with per-player sequence numbers, and a solvency assertion on every craft, redeem and backing raise.

## Blockchains and tools

Solana (devnet), Anchor 1.2, Token-2022, Ed25519 precompile, @solana/kit, litesvm, Privy embedded Solana wallets, Telegram Mini Apps, Unity 6 WebGL, React and Vite, Vercel serverless functions, Neon Postgres, GitHub Actions.

## Links

- Repository: https://github.com/Kumarutkarsh9470/PixelVault-Upgraded
- Live Mini App: https://t.me/pixelvault_racer_bot/race (or https://pixelvault-racer.vercel.app)
- Program on devnet: https://explorer.solana.com/address/AANvcGamRqQccnrx3XHnynJAXh4KCdJAa2XYnazNsuoZ?cluster=devnet
- Threat model: https://github.com/Kumarutkarsh9470/PixelVault-Upgraded/blob/main/docs/THREAT_MODEL.md
- Studio SDK guide: https://github.com/Kumarutkarsh9470/PixelVault-Upgraded/blob/main/sdk/README.md
- Verified runs, in progress (the program re-drives each race from the player's inputs): https://github.com/Kumarutkarsh9470/PixelVault-Upgraded/tree/verified-runs

## Team

- **[you]** Name, role, background: for example "Solo builder. Game and smart contract developer; previously built PixelVault on Initia (hackathon). Unity, Rust, TypeScript."
- Location: India **[you: city]**

## Go-to-market

**Wedge: Telegram mini-game studios.** They already have the players, the sign-in and the payments problem, and their players already distrust in-game purchases. PixelVault ships as a Telegram Mini App with embedded wallets, so a studio's players never see a seed phrase or hold SOL. The integration is a server that signs grants plus a client that builds two instructions, which is what `@pixelvault/sdk` packages.

**Business model.** The protocol fee is 12.5% of the studio's margin on every craft, so the protocol earns only when studios sell. Redemption and moving items between games are free, which is what makes the guarantee credible.

**Sequence.**
1. Mainnet launch with real USDC, launch caps per player and per game, and the admin key moved to a multisig.
2. Two or three outside studios integrated through the SDK, each a new game in the same wallet.
3. A public solvency dashboard: every vault, what it owes, read from the chain.

## Demand validation

**[you: replace with what is true]** Suggested honest framing:

- The second game, Glyph Forge, was built entirely through the public SDK as the first integration test of the studio experience.
- Early testers on Telegram **[you: number]** crafted and redeemed items on devnet; the Vault's live solvency panel showed every vault covering what it owed throughout.
- The failed per-game-token design from our earlier Initia hackathon project is what led to the fixed-backing model; the feedback there was that players wanted a floor, not a market.

## Distribution

- Telegram: the Mini App is shareable as a link, and every game built on PixelVault is a new entry point into the same wallet.
- Superteam India and the Solana games community for the first studio integrations.
- The SDK on npm with a thirty-line integration guide.

## Prior work disclosure (required)

This project builds on an idea the author explored in an earlier hackathon: PixelVault on Initia (https://github.com/Kumarutkarsh9470/INITIA_Hack), a cross-game economy built around per-game tokens, an AMM and ERC-6551 player accounts on an Initia MiniEVM rollup.

This repository is a new codebase started during the Crypto World's Fair window. It shares no code with that project and abandons its core model: the per-game-token design is replaced by USDC-backed items with a protocol-enforced redemption floor, on Solana. The Unity games use Kenney's CC0 Car Kit and Racing Kit assets.

## Where to submit

| Where | Notes |
|---|---|
| Colosseum portal (Solana track) | Required first; country must be India for the Superteam India sidetrack |
| Superteam Earn: Superteam India Track | Regional, India only; requires the Colosseum submission |
| Superteam Earn: CertiK Security Audit Credits | Open to any project |
| Superteam Earn: Adevar Labs pre-audit credits | Open to any project |
| Superteam Earn: RPC Fast infrastructure sidetrack | Check its scope; fits only if the listing accepts general Solana apps |
| Superteam Earn: Panta API, Solami | Only if the listing does not require using their product |

Every other Superteam Earn track is regional and restricted to residents of that country. Submitting to those risks disqualification under the global rules.
