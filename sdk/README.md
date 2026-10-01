# @pixelvault/sdk

Add refundable, USDC-backed items to a game. Your server decides when a player has earned a craft and signs a grant; the player's client turns the grant into a transaction; the PixelVault program takes the USDC, locks the backing in your game's vault, and mints the item. Players can redeem any item for its backing at any time, without your server.

One dependency: [`@solana/kit`](https://github.com/anza-xyz/kit) 8.x. Works in browsers and Node 20+.

## 1. Register your game

Your studio key calls `register_game` (your game id, name, grant signer public key, and a backing cap) and `create_item_class` for each item (price, backing between 50% and 95%, optional supply cap). `tools/setup-devnet.mjs` in this repository does both and writes the addresses into a `Deployment` object (`chain.json`). Keep the grant signer's secret key on your server only.

## 2. Server: sign a grant when a player earns a craft

```ts
import { createGrantSigner, fetchNextGrantSeq, signGrant } from "@pixelvault/sdk";
import { address, createSolanaRpc } from "@solana/kit";

const signer = await createGrantSigner(JSON.parse(process.env.GRANT_SIGNER_SECRET!));
const rpc = createSolanaRpc(deployment.rpc);

// After your own checks: did this player earn the item, and have you reserved what it costs them?
const player = address(walletFromRequest);
const seq = await fetchNextGrantSeq(rpc, deployment, GAME_ID, player);
const grant = await signGrant(deployment, signer, { gameId: GAME_ID, classId, player, seq });
// Send `grant` to the client. It expires after GRANT_TTL_SECONDS (180 s).
```

A grant is bound to your program deployment, game, item class, player, sequence number and expiry. The program accepts each sequence number once, so a grant cannot be replayed, forged, or reused for another item or player.

## 3. Client: craft, redeem, move

```ts
import { compileSponsored, craftInstructions, redeemInstruction, routeInstructions } from "@pixelvault/sdk";

// Craft: the grant's signature check, then craft. rentPayer may be the player or a fee sponsor.
const ixs = await craftInstructions(deployment, { player, rentPayer, grant });

// Redeem: burn one unit, receive its backing in USDC.
const ix = await redeemInstruction(deployment, player, { gameId, classId });

// Move value to another game at par, in one transaction (grant from the destination game's server).
const route = await routeInstructions(deployment, { player, rentPayer, from: { gameId, classId }, grant });
```

### Players without SOL

`compileSponsored(instructions, quote)` builds a transaction whose fee payer is a sponsor. The player signs it, and the sponsor co-signs and submits. See `deploy/racer/api/sponsor.js` for a relayer that refuses anything except PixelVault, Ed25519 and Memo instructions, and lets the sponsor appear only as `craft`'s rent payer (`CRAFT_RENT_PAYER_INDEX`).

## Reading state

- `fetchBalances(rpc, deployment, owner)`: USDC and every item a wallet holds.
- `splitPrice(price, backingBps, feeBps)`: exactly where a craft's USDC goes (backing, protocol fee, studio cut), with the program's rounding.
- `refundOf(price, backingBps)`: what redeeming one unit returns.

## Tests

```bash
npm test
```

`test/vectors.test.ts` pins every byte the SDK produces to reference vectors. `test/program.test.ts` runs the full flow against the compiled program in [litesvm](https://github.com/LiteSVM/litesvm): two studios, a zero-SOL player, craft, redeem, route and a rejected replay. It needs `anchor build` output and the protocol admin keypair, and is skipped otherwise; CI always runs it.
