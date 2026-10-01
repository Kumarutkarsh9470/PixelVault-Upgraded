// The SDK must produce exactly the bytes the racer's original client and server did.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import { address, getCompiledTransactionMessageDecoder, getTransactionDecoder, type Instruction } from "@solana/kit";

import {
  compileSponsored,
  craftInstructions,
  createGrantSigner,
  gamePda,
  grantMessage,
  playerStatePda,
  redeemInstruction,
  refundOf,
  routeInstructions,
  signGrant,
  splitPrice,
  type Deployment,
} from "../src/index.ts";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"));
const deployment: Deployment = fixtures.deployment;
const programId = address(deployment.programId);
const player = address(fixtures.player);
const rentPayer = address(fixtures.rentPayer);

const hex = (b: ArrayLike<number>) => Buffer.from(Uint8Array.from(b)).toString("hex");
const asJson = (ix: Instruction) => ({
  programAddress: ix.programAddress,
  accounts: (ix.accounts ?? []).map((a) => ({ address: a.address, role: a.role })),
  data: hex(ix.data ?? []),
});

for (const c of fixtures.cases) {
  const label = `game ${c.gameId} class ${c.classId} seq ${c.seq}`;
  const game = address(deployment.games[c.gameId].game);

  test(`${label}: grant digest matches`, async () => {
    const message = await grantMessage({ programId, game, classId: c.classId, player, seq: BigInt(c.seq), expiresAt: c.expiresAt });
    assert.equal(hex(message), c.message);
  });

  test(`${label}: signed grant matches`, async () => {
    const signer = await createGrantSigner(fixtures.signerSecret);
    const grant = await signGrant(deployment, signer, {
      gameId: c.gameId,
      classId: c.classId,
      player,
      seq: BigInt(c.seq),
      expiresAt: c.expiresAt,
    });
    assert.equal(grant.signer, c.signer);
    assert.equal(grant.signature, c.signature);
    assert.equal(grant.seq, c.seq);
  });

  test(`${label}: craft instructions match`, async () => {
    const grant = { gameId: c.gameId, classId: c.classId, seq: c.seq, expiresAt: c.expiresAt, signer: c.signer, signature: c.signature };
    const ixs = await craftInstructions(deployment, { player, rentPayer, grant });
    assert.deepEqual(ixs.map(asJson), c.craft);
  });

  test(`${label}: redeem instruction matches`, async () => {
    const ix = await redeemInstruction(deployment, player, { gameId: c.gameId, classId: c.classId });
    assert.deepEqual(asJson(ix), c.redeem);
  });

  test(`${label}: PDAs match the deployment`, async () => {
    assert.equal(await gamePda(programId, c.gameId), game);
    assert.equal(await playerStatePda(programId, game, player), c.playerState);
  });
}

test("route is redeem followed by craft", async () => {
  const [from, to] = fixtures.cases;
  const grant = { gameId: to.gameId, classId: to.classId, seq: to.seq, expiresAt: to.expiresAt, signer: to.signer, signature: to.signature };
  const ixs = await routeInstructions(deployment, { player, rentPayer, from: { gameId: from.gameId, classId: from.classId }, grant });
  assert.deepEqual(ixs.map(asJson), [from.redeem, ...to.craft]);
});

test("price split matches the program's integration test", () => {
  // EXPECTED_* constants in pixelvault/programs/pixelvault/tests/test_vault.rs
  assert.deepEqual(splitPrice(1_000_000, 8_000, 1_250), { backing: 800_000n, protocolFee: 25_000n, studioCut: 175_000n });
  assert.equal(refundOf(600_000, 8_000), 480_000n);
  // Rounds down like apply_bps.
  assert.deepEqual(splitPrice(333, 7_000, 1_250), { backing: 233n, protocolFee: 12n, studioCut: 88n });
});

test("sponsored transaction puts the sponsor first, as the relayer requires", async () => {
  const c = fixtures.cases[0];
  const grant = { gameId: c.gameId, classId: c.classId, seq: c.seq, expiresAt: c.expiresAt, signer: c.signer, signature: c.signature };
  const ixs = await craftInstructions(deployment, { player, rentPayer, grant });
  const bytes = compileSponsored(ixs, { feePayer: rentPayer, blockhash: "CmpNeggWJ4JaWJeJ8YKN1Zypmk7uvQq3PECGUCAEMbky", lastValidBlockHeight: 100 });
  const tx = getTransactionDecoder().decode(bytes);
  const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  assert.equal(message.staticAccounts[0], rentPayer);
  assert.equal(message.header.numSignerAccounts, 2);
});
