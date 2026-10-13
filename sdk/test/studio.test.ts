// The studio builders encode exactly what the program's Accounts structs and
// Anchor's Borsh layout expect; the on-chain behaviour is covered end to end
// in program.test.ts, which registers its games through these builders.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { AccountRole, generateKeyPair, getAddressFromPublicKey, getProgramDerivedAddress } from "@solana/kit";

import {
  addressBytes,
  associatedTokenAddress,
  ASSOCIATED_TOKEN_PROGRAM,
  createItemClassInstruction,
  deriveGameDeployment,
  DEVNET,
  gamePda,
  grantSignerOf,
  itemClassPda,
  registerGameInstruction,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  updateGameInstruction,
} from "../src/index.ts";

const rnd = async () => getAddressFromPublicKey((await generateKeyPair()).publicKey);
const disc = (name: string) => new Uint8Array(createHash("sha256").update(`global:${name}`).digest().subarray(0, 8));
const u64 = (v: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
};

test("register_game: accounts in the program's order, Borsh data", async () => {
  const authority = await rnd();
  const signer = await rnd();
  const treasury = await rnd();
  const ix = await registerGameInstruction(DEVNET, { authority, gameId: 9, name: "Sky", grantSigner: signer, treasury, backedCap: 5 });
  const game = await gamePda(DEVNET.programId as never, 9);
  assert.equal(ix.programAddress, DEVNET.programId);
  assert.deepEqual(
    ix.accounts!.map((a) => [a.address, a.role]),
    [
      [authority, AccountRole.WRITABLE_SIGNER],
      [DEVNET.protocol, AccountRole.READONLY],
      [game, AccountRole.WRITABLE],
      [DEVNET.usdcMint, AccountRole.READONLY],
      [await associatedTokenAddress(game, DEVNET.usdcMint as never, TOKEN_PROGRAM), AccountRole.WRITABLE],
      [treasury, AccountRole.READONLY],
      [TOKEN_PROGRAM, AccountRole.READONLY],
      [ASSOCIATED_TOKEN_PROGRAM, AccountRole.READONLY],
      [SYSTEM_PROGRAM, AccountRole.READONLY],
    ],
  );
  const expected = new Uint8Array([...disc("register_game"), ...u64(9n), 3, 0, 0, 0, ...new TextEncoder().encode("Sky"), ...addressBytes(signer), ...u64(5n)]);
  assert.deepEqual(new Uint8Array(ix.data!), expected);
});

test("create_item_class: mint signs, class PDA derives from the game, band enforced", async () => {
  const authority = await rnd();
  const mint = await rnd();
  const ix = await createItemClassInstruction(DEVNET, { authority, gameId: 9, classId: 3, mint, price: 1_000_000, backingBps: 9500, maxSupply: 100 });
  const game = await gamePda(DEVNET.programId as never, 9);
  const [pda] = await getProgramDerivedAddress({
    programAddress: DEVNET.programId as never,
    seeds: [new TextEncoder().encode("class"), addressBytes(game), u64(3n)],
  });
  assert.equal(await itemClassPda(DEVNET.programId as never, game, 3), pda);
  assert.deepEqual(
    ix.accounts!.map((a) => [a.address, a.role]),
    [
      [authority, AccountRole.WRITABLE_SIGNER],
      [game, AccountRole.READONLY],
      [pda, AccountRole.WRITABLE],
      [mint, AccountRole.WRITABLE_SIGNER],
      [TOKEN_2022_PROGRAM, AccountRole.READONLY],
      [SYSTEM_PROGRAM, AccountRole.READONLY],
    ],
  );
  assert.deepEqual(new Uint8Array(ix.data!), new Uint8Array([...disc("create_item_class"), ...u64(3n), ...u64(1_000_000n), 0x1c, 0x25, ...u64(100n)]));
  await assert.rejects(createItemClassInstruction(DEVNET, { authority, gameId: 9, classId: 4, mint, price: 1, backingBps: 9600 }), /between/);
  await assert.rejects(createItemClassInstruction(DEVNET, { authority, gameId: 9, classId: 4, mint, price: 1, backingBps: 4999 }), /between/);
});

test("update_game: Option encoding for each field", async () => {
  const authority = await rnd();
  const signer = await rnd();
  const none = await updateGameInstruction(DEVNET, { authority, gameId: 9 });
  assert.deepEqual(new Uint8Array(none.data!), new Uint8Array([...disc("update_game"), 0, 0, 0]));
  const rotate = await updateGameInstruction(DEVNET, { authority, gameId: 9, grantSigner: signer });
  assert.deepEqual(new Uint8Array(rotate.data!), new Uint8Array([...disc("update_game"), 0, 1, ...addressBytes(signer), 0]));
  const all = await updateGameInstruction(DEVNET, { authority, gameId: 9, craftingPaused: true, grantSigner: signer, backedCap: 7 });
  assert.deepEqual(new Uint8Array(all.data!), new Uint8Array([...disc("update_game"), 1, 1, 1, ...addressBytes(signer), 1, ...u64(7n)]));
  assert.equal(all.accounts![0].role, AccountRole.READONLY_SIGNER);
  assert.equal(all.accounts![1].address, await gamePda(DEVNET.programId as never, 9));
});

test("a derived deployment matches the PDAs, and the grant signer reads back from account data", async () => {
  const treasury = await rnd();
  const mint = await rnd();
  const signer = await rnd();
  const deployed = await deriveGameDeployment(DEVNET, 9, treasury, [{ classId: 3, mint }]);
  const game = await gamePda(DEVNET.programId as never, 9);
  assert.equal(deployed.game, game);
  assert.equal(deployed.vault, await associatedTokenAddress(game, DEVNET.usdcMint as never, TOKEN_PROGRAM));
  assert.equal(deployed.classes["3"].itemClass, await itemClassPda(DEVNET.programId as never, game, 3));
  assert.equal(deployed.classes["3"].mint, mint);
  const data = new Uint8Array(8 + 32 + 32 + 16);
  data.set(addressBytes(signer), 40);
  assert.equal(grantSignerOf(data), signer);
});
