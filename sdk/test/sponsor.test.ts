// The sponsor's rules, checked on real compiled transactions: it pays for
// craft, redeem, route and USDC withdrawals by the caller's own wallet, and
// for nothing else.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AccountRole,
  address,
  createKeyPairFromPrivateKeyBytes,
  generateKeyPair,
  getAddressFromPublicKey,
  getBase58Decoder,
  getTransactionDecoder,
  getTransactionEncoder,
  getU64Encoder,
  partiallySignTransaction,
  type Address,
  type Instruction,
} from "@solana/kit";

import {
  addressBytes,
  compileSponsored,
  craftInstructions,
  createSponsor,
  MEMO_PROGRAM,
  OPEN_RUN_DISCRIMINATOR,
  VERIFY_RUN_DISCRIMINATOR,
  WRITE_RUN_DISCRIMINATOR,
  CLOSE_RUN_DISCRIMINATOR,
  COMPUTE_BUDGET_PROGRAM,
  redeemInstruction,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  usdcTransferInstruction,
  type Deployment,
  type Grant,
  type Sponsor,
} from "../src/index.ts";

const rnd = async () => getAddressFromPublicKey((await generateKeyPair()).publicKey);

let sponsor: Sponsor;
let player: Address;
let playerKeys: CryptoKeyPair;
let stranger: Address;
let deployment: Deployment;
let quote: { feePayer: string; blockhash: string; lastValidBlockHeight: number };

async function setup() {
  const seed = new Uint8Array(32).fill(7);
  const feePayerKeys = await createKeyPairFromPrivateKeyBytes(seed);
  const feePayerAddress = await getAddressFromPublicKey(feePayerKeys.publicKey);
  const secret = new Uint8Array(64);
  secret.set(seed, 0);
  secret.set(addressBytes(feePayerAddress), 32);

  playerKeys = await generateKeyPair();
  player = await getAddressFromPublicKey(playerKeys.publicKey);
  stranger = await rnd();

  deployment = {
    cluster: "test",
    rpc: "http://localhost",
    programId: await rnd(),
    usdcMint: await rnd(),
    protocol: await rnd(),
    protocolTreasury: await rnd(),
    games: {
      "1": { game: await rnd(), vault: await rnd(), treasury: await rnd(), classes: { "1": { itemClass: await rnd(), mint: await rnd() } } },
      "2": { game: await rnd(), vault: await rnd(), treasury: await rnd(), classes: { "1": { itemClass: await rnd(), mint: await rnd() } } },
    },
  };
  sponsor = await createSponsor({ deployment, feePayerSecretKey: secret, rpc: {} as never });
  quote = { feePayer: sponsor.feePayer, blockhash: getBase58Decoder().decode(new Uint8Array(32).fill(3)), lastValidBlockHeight: 100 };
}

const grant = (gameId: number): Grant => ({
  gameId,
  classId: 1,
  seq: "0",
  expiresAt: 2_000_000_000,
  signer: "11111111111111111111111111111111",
  signature: btoa(String.fromCharCode(...new Uint8Array(64))),
});

async function signed(instructions: Instruction[], sign = true, who: CryptoKeyPair = playerKeys): Promise<Uint8Array> {
  const bytes = compileSponsored(instructions, quote);
  if (!sign) return bytes;
  const tx = await partiallySignTransaction([who], getTransactionDecoder().decode(bytes));
  return new Uint8Array(getTransactionEncoder().encode(tx));
}

const craft = (p: Address = player, rentPayer?: Address) =>
  craftInstructions(deployment, { player: p, rentPayer: rentPayer ?? address(quote.feePayer), grant: grant(1) });
const redeem = (p: Address = player) => redeemInstruction(deployment, p, { gameId: 1, classId: 1 });
const withdraw = (amount: bigint, owner: Address = player) =>
  usdcTransferInstruction(deployment, { owner, destination: stranger, amount });

test("sponsors a craft, a redeem, a route and a USDC withdrawal", async () => {
  await setup();
  assert.equal(sponsor.inspect(await signed(await craft()), player).kind, "craft");
  assert.equal(sponsor.inspect(await signed([await redeem()]), player).kind, "redeem");
  assert.equal(sponsor.inspect(await signed([await redeem(), ...(await craft())]), player).kind, "route");
  assert.equal(sponsor.inspect(await signed([await withdraw(250_000n)]), player).kind, "withdraw");
});

test("refuses draining the sponsor with a transfer or a priority fee", async () => {
  const transfer: Instruction = {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: address(quote.feePayer), role: AccountRole.WRITABLE_SIGNER },
      { address: player, role: AccountRole.WRITABLE_SIGNER },
    ],
    data: new Uint8Array([2, 0, 0, 0, ...getU64Encoder().encode(1_000_000_000n)]),
  };
  assert.match(sponsor.inspect(await signed([transfer]), player).reason!, /not sponsored/);
  const priority: Instruction = {
    programAddress: address("ComputeBudget111111111111111111111111111111"),
    accounts: [],
    data: new Uint8Array([3, ...getU64Encoder().encode(5_000_000n)]),
  };
  assert.match(sponsor.inspect(await signed([priority, ...(await craft())]), player).reason!, /only a compute unit limit/);
});

test("refuses the sponsor in any role but craft's rent payer", async () => {
  // A craft where the sponsor is the player and the player pays rent.
  const ixs = await craft(address(quote.feePayer), player);
  assert.match(sponsor.inspect(await signed(ixs), player).reason!, /never act as a player/);
});

test("refuses anything that is not craft or redeem in PixelVault, and empty transactions", async () => {
  const other: Instruction = {
    programAddress: address(deployment.programId),
    accounts: [{ address: player, role: AccountRole.READONLY_SIGNER }],
    data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
  };
  assert.match(sponsor.inspect(await signed([other]), player).reason!, /only craft, redeem and run verification/);
  const memo: Instruction = {
    programAddress: MEMO_PROGRAM,
    accounts: [{ address: player, role: AccountRole.READONLY_SIGNER }],
    data: new TextEncoder().encode("hello"),
  };
  assert.match(sponsor.inspect(await signed([memo]), player).reason!, /nothing to sponsor/);
});

test("refuses other signers, missing signatures and a different fee payer", async () => {
  assert.match(sponsor.inspect(await signed(await craft(stranger), false), player).reason!, /must be your wallet/);
  assert.match(sponsor.inspect(await signed(await craft(), false), player).reason!, /missing your signature/);
  const other = { ...quote, feePayer: stranger };
  const bytes = compileSponsored(await craft(), other);
  assert.match(sponsor.inspect(bytes, player).reason!, /fee payer must be the sponsor/);
});

test("withdrawals: USDC only, at least the minimum, by the caller, on their own", async () => {
  assert.match(sponsor.inspect(await signed([await withdraw(10n)]), player).reason!, /under the minimum/);
  assert.match(sponsor.inspect(await signed([await withdraw(250_000n), await redeem()]), player).reason!, /on their own/);
  const wrongMint: Deployment = { ...deployment, usdcMint: stranger };
  const foreign = await usdcTransferInstruction(wrongMint, { owner: player, destination: stranger, amount: 250_000n });
  assert.match(sponsor.inspect(await signed([foreign]), player).reason!, /only USDC transfers/);
  const raw: Instruction = {
    programAddress: TOKEN_PROGRAM,
    accounts: [{ address: player, role: AccountRole.READONLY_SIGNER }],
    data: new Uint8Array([3, 1, 0, 0, 0, 0, 0, 0, 0]),
  };
  assert.match(sponsor.inspect(await signed([raw]), player).reason!, /TransferChecked/);
});

test("one craft and one redeem per transaction", async () => {
  const two = [...(await craft()), ...(await craft())];
  assert.match(sponsor.inspect(await signed(two), player).reason!, /one craft and one redeem/);
});

test("submit refuses before touching the network", async () => {
  await assert.rejects(sponsor.submit(await signed(await craft(stranger), false), player), /must be your wallet/);
});

const runIx = (disc: Uint8Array, accounts: { address: Address; role: AccountRole }[]): Instruction => ({
  programAddress: address(deployment.programId),
  accounts,
  data: new Uint8Array([...disc, 0, 0, 0, 0, 0, 0, 0, 0]),
});
const openRun = () => runIx(OPEN_RUN_DISCRIMINATOR, [
  { address: address(quote.feePayer), role: AccountRole.WRITABLE_SIGNER },
  { address: player, role: AccountRole.READONLY_SIGNER },
  { address: stranger, role: AccountRole.READONLY },
]);
const writeRun = () => runIx(WRITE_RUN_DISCRIMINATOR, [{ address: player, role: AccountRole.READONLY_SIGNER }, { address: stranger, role: AccountRole.WRITABLE }]);
const verifyRun = () => runIx(VERIFY_RUN_DISCRIMINATOR, [{ address: player, role: AccountRole.READONLY_SIGNER }, { address: stranger, role: AccountRole.WRITABLE }]);
const closeRun = () => runIx(CLOSE_RUN_DISCRIMINATOR, [
  { address: player, role: AccountRole.READONLY_SIGNER },
  { address: stranger, role: AccountRole.WRITABLE },
  { address: address(quote.feePayer), role: AccountRole.WRITABLE },
]);
const computeLimit = (units: number): Instruction => {
  const data = new Uint8Array(5);
  data[0] = 2;
  new DataView(data.buffer).setUint32(1, units, true);
  return { programAddress: COMPUTE_BUDGET_PROGRAM, accounts: [], data };
};

test("sponsors run verification with a compute limit, and refuses prices and oversize limits", async () => {
  assert.equal(sponsor.inspect(await signed([openRun(), writeRun()]), player).kind, "verify");
  assert.equal(sponsor.inspect(await signed([computeLimit(1_350_000), verifyRun()]), player).kind, "verify");
  assert.equal(sponsor.inspect(await signed([closeRun()]), player).kind, "verify");
  assert.match(sponsor.inspect(await signed([computeLimit(2_000_000), verifyRun()]), player).reason!, /ceiling/);
  const price: Instruction = { programAddress: COMPUTE_BUDGET_PROGRAM, accounts: [], data: new Uint8Array([3, 1, 0, 0, 0, 0, 0, 0, 0]) };
  assert.match(sponsor.inspect(await signed([price, verifyRun()]), player).reason!, /unit limit/);
  assert.match(sponsor.inspect(await signed([verifyRun(), ...(await craft())]), player).reason!, /on its own/);
});
