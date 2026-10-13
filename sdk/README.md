# pixelvault-sdk

[![npm](https://img.shields.io/npm/v/pixelvault-sdk)](https://www.npmjs.com/package/pixelvault-sdk)

Add refundable, USDC-backed items to a game. Your server decides when a player has earned a craft and signs a grant; the player's client turns the grant into a transaction; the PixelVault program takes the USDC, locks the backing in your game's vault, and mints the item. Players can redeem any item for its backing at any time, without your server.

One dependency: [`@solana/kit`](https://github.com/anza-xyz/kit) 8.x. Works in browsers and Node 20+.

```bash
npm install pixelvault-sdk @solana/kit
```

## Quickstart: a game with one item in ten minutes

**1. Two keypairs.** A studio key (owns the game, pays rent) and a grant-signer key (stays on your server).

```bash
solana-keygen new -o studio.json --no-bip39-passphrase
solana-keygen new -o signer.json --no-bip39-passphrase
solana airdrop 1 $(solana-keygen pubkey studio.json) --url devnet
```

**2. A catalog.** Prices are USDC base units (6 decimals); backing is basis points between 5000 and 9500.

```json
{
  "gameId": 42,
  "name": "Sky Pirates",
  "items": [
    { "classId": 1, "name": "Brass Goggles", "price": 500000, "backingBps": 8000, "maxSupply": 0 },
    { "classId": 2, "name": "Founder's Sail", "price": 2000000, "backingBps": 9500, "maxSupply": 100 }
  ]
}
```

**3. Register.** One command creates the game, its vault and every item class on devnet, and writes the addresses your code needs. Re-run it any time: it skips what exists and rotates the grant signer if you pass a new one.

```bash
npx pixelvault setup --catalog game.json --studio studio.json --grant-signer signer.json --out chain.json
```

**4. Server: sign a grant when a player earns a craft.**

```ts
import { createGrantSigner, fetchNextGrantSeq, signGrant, type Deployment } from "pixelvault-sdk";
import { address, createSolanaRpc } from "@solana/kit";
import deployment from "./chain.json" with { type: "json" };

const signer = await createGrantSigner(JSON.parse(process.env.GRANT_SIGNER_SECRET!));
const rpc = createSolanaRpc(deployment.rpc);

// After your own checks: did this player earn the item, and have you charged them for it in-game?
const player = address(walletFromRequest);
const seq = await fetchNextGrantSeq(rpc, deployment as Deployment, 42, player);
const grant = await signGrant(deployment as Deployment, signer, { gameId: 42, classId: 1, player, seq });
// Send `grant` to the client. It expires after GRANT_TTL_SECONDS (180 s).
```

A grant is bound to your program deployment, game, item class, player, sequence number and expiry. The program accepts each sequence number once, so a grant cannot be replayed, forged, or reused for another item or player.

**5. Client: craft, redeem, move.**

```ts
import { compileSponsored, craftInstructions, redeemInstruction, routeInstructions } from "pixelvault-sdk";

// Craft: the grant's signature check, then craft. rentPayer may be the player or a fee sponsor.
const ixs = await craftInstructions(deployment, { player, rentPayer, grant });

// Redeem: burn one unit, receive its backing in USDC. Works without your server, forever.
const ix = await redeemInstruction(deployment, player, { gameId: 42, classId: 1 });

// Move value to another game at par, in one transaction (grant from the destination game's server).
const route = await routeInstructions(deployment, { player, rentPayer, from: { gameId: 42, classId: 1 }, grant });
```

**6. Players without SOL: run a sponsor.** `createSponsor` is the fee-payer relayer with the rules already written: it pays only for `craft`, `redeem`, a redeem-then-craft route, and USDC withdrawals by the caller's own wallet; it refuses priority fees, lookup tables, other programs, other signers, and any use of the sponsor key except as `craft`'s rent payer. You decide who the caller is and how often they may ask.

```ts
import { createSponsor } from "pixelvault-sdk";
import { createSolanaRpc } from "@solana/kit";

const sponsor = await createSponsor({
  deployment,
  feePayerSecretKey: JSON.parse(process.env.SPONSOR_SECRET_KEY!),
  rpc: createSolanaRpc(deployment.rpc),
  beforeSubmit: async (player, kind) => rateLimit.check(player, kind), // throw to refuse
});

app.get("/api/sponsor", async (req, res) => res.json(await sponsor.quote()));
app.post("/api/sponsor", async (req, res) => {
  const player = await yourAuth(req); // session, Telegram launch data, a signed nonce: your call
  const bytes = Buffer.from(req.body.transaction, "base64");
  res.json(await sponsor.submit(bytes, player)); // { signature, kind } or throws with the refusal
});
```

On the client, `compileSponsored(instructions, await fetch("/api/sponsor").then((r) => r.json()))` builds the transaction the player signs; post the signed bytes back.

## Studio operations

Everything the CLI does is also an instruction builder, for your own tooling:

- `registerGameInstruction(protocol, { authority, gameId, name, grantSigner, treasury, backedCap })`
- `createItemClassInstruction(protocol, { authority, gameId, classId, mint, price, backingBps, maxSupply })`: `mint` is a fresh keypair that signs once and is never needed again
- `updateGameInstruction(protocol, { authority, gameId, craftingPaused?, grantSigner?, backedCap? })`: pausing stops crafting only; redemption can never be paused
- `createAssociatedTokenAccountInstruction(payer, owner, mint)` for the studio's USDC treasury
- `deriveGameDeployment(protocol, gameId, treasury, classes)` writes the `Deployment` entry without a fetch
- `DEVNET` is the protocol on Solana devnet; pass your own `ProtocolDeployment` for another cluster

What the program guarantees your players, whatever your server does: the backing sits in a vault only `redeem` can move; backing can be raised but never lowered; the band is 50–95%; and `redeem` reads no pause flag.

## Reading state

- `fetchBalances(rpc, deployment, owner)`: USDC and every item a wallet holds.
- `itemBalance(rpc, deployment, owner, { gameId, classId })`: one item's count in a single call. Use it to honour another game's items; Glyph Forge and Neon Racer both use it for leaderboard frames.
- `resolveUsdcAccount` and `usdcTransferInstruction`: let players cash out to any wallet or exchange address.
- `splitPrice(price, backingBps, feeBps)`: exactly where a craft's USDC goes (backing, protocol fee, studio cut), with the program's rounding.
- `refundOf(price, backingBps)`: what redeeming one unit returns.

## Tests

```bash
npm test
```

`test/vectors.test.ts` pins every byte the SDK produces to reference vectors. `test/studio.test.ts` checks the studio builders against the program's account layout. `test/sponsor.test.ts` runs every sponsor rule on real compiled transactions. `test/program.test.ts` runs the full flow against the compiled program in [litesvm](https://github.com/LiteSVM/litesvm): two studios registered through the builders, a zero-SOL player, craft, redeem, route, a withdrawal, a rejected replay, and a grant-signer rotation. It needs `anchor build` output and the protocol admin keypair, and is skipped otherwise; CI always runs it.
