// What the relayer will and will not pay for. Offline: builds transactions and
// runs them through the same `inspect` the endpoint uses.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";

import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { inspect, MIN_WITHDRAW } from "../api/sponsor.js";

const chain = JSON.parse(fs.readFileSync(new URL("../data/chain.json", import.meta.url)));
const PROGRAM = new PublicKey(chain.programId);
const USDC = new PublicKey(chain.usdcMint);
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const ED25519 = new PublicKey("Ed25519SigVerify111111111111111111111111111");

const sponsor = Keypair.generate();
const player = Keypair.generate();
const other = Keypair.generate();
const blockhash = "CmpNeggWJ4JaWJeJ8YKN1Zypmk7uvQq3PECGUCAEMbky";

const disc = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const acct = (pubkey, isSigner = false, isWritable = true) => ({ pubkey, isSigner, isWritable });
const filler = (n) => Array.from({ length: n }, () => acct(Keypair.generate().publicKey));

const craft = (rentPayer = sponsor.publicKey, extra = 16) =>
  new TransactionInstruction({
    programId: PROGRAM,
    keys: [acct(player.publicKey, true, false), acct(rentPayer, true, true), ...filler(extra)],
    data: Buffer.concat([disc("craft"), Buffer.alloc(16)]),
  });
const ed25519 = (size = 144) => new TransactionInstruction({ programId: ED25519, keys: [], data: Buffer.alloc(size) });
const redeem = () =>
  new TransactionInstruction({ programId: PROGRAM, keys: [acct(player.publicKey, true, false), ...filler(10)], data: disc("redeem") });

function transferChecked({ amount = 1_000_000n, mint = USDC, authority = player.publicKey, opcode = 12 } = {}) {
  const data = Buffer.alloc(10);
  data[0] = opcode;
  data.writeBigUInt64LE(amount, 1);
  data[9] = 6;
  return new TransactionInstruction({
    programId: TOKEN,
    keys: [acct(Keypair.generate().publicKey), acct(mint, false, false), acct(Keypair.generate().publicKey), acct(authority, true, false)],
    data,
  });
}

function tx(instructions, { payer = sponsor.publicKey, signers = [player] } = {}) {
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message();
  const t = new VersionedTransaction(message);
  t.sign(signers);
  return t;
}

const check = (t) => inspect(t, sponsor.publicKey, player.publicKey);

test("sponsors a craft, a redeem, a route and a USDC withdrawal", () => {
  assert.deepEqual(check(tx([ed25519(), craft()])), { kind: "craft" });
  assert.deepEqual(check(tx([redeem()])), { kind: "redeem" });
  assert.deepEqual(check(tx([redeem(), ed25519(), craft()])), { kind: "route" });
  assert.deepEqual(check(tx([transferChecked()])), { kind: "withdraw" });
});

test("refuses draining the sponsor with a transfer", () => {
  const drain = SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: player.publicKey, lamports: 1_000_000 });
  assert.match(check(tx([ed25519(), craft(), drain])).reason, /not sponsored/);
});

test("refuses a priority fee the sponsor would pay", () => {
  const fee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000_000 });
  assert.match(check(tx([fee, ed25519(), craft()])).reason, /not sponsored/);
});

test("refuses the sponsor in any role but craft's rent payer", () => {
  const memo = new TransactionInstruction({ programId: MEMO, keys: [acct(player.publicKey, true, false), acct(sponsor.publicKey, true, true)], data: Buffer.from("x") });
  assert.match(check(tx([memo, ed25519(), craft()])).reason, /rent payer of craft/);
  const signed = new TransactionInstruction({ programId: MEMO, keys: [acct(player.publicKey, true, false)], data: Buffer.from("x") });
  assert.match(check(tx([signed, transferChecked({ authority: sponsor.publicKey })])).reason, /rent payer of craft/);
});

test("refuses anything that is not craft or redeem in PixelVault", () => {
  const register = new TransactionInstruction({ programId: PROGRAM, keys: [acct(player.publicKey, true, true)], data: disc("register_game") });
  assert.match(check(tx([register])).reason, /only craft and redeem/);
});

test("refuses transactions with nothing to sponsor", () => {
  const memo = new TransactionInstruction({ programId: MEMO, keys: [acct(player.publicKey, true, false)], data: Buffer.from("hi") });
  assert.match(check(tx([memo])).reason, /nothing to sponsor/);
});

test("refuses signers other than the caller's linked wallet", () => {
  const theirs = new TransactionInstruction({ programId: PROGRAM, keys: [acct(other.publicKey, true, false)], data: disc("redeem") });
  assert.match(check(tx([theirs], { signers: [other] })).reason, /your wallet/);
  const both = new TransactionInstruction({
    programId: PROGRAM,
    keys: [acct(player.publicKey, true, false), acct(other.publicKey, true, false)],
    data: disc("redeem"),
  });
  assert.match(check(tx([both], { signers: [player, other] })).reason, /your wallet/);
});

test("refuses a transaction the player has not signed", () => {
  assert.match(check(tx([redeem()], { signers: [] })).reason, /missing your signature/);
});

test("refuses a different fee payer", () => {
  assert.match(inspect(tx([redeem()], { payer: player.publicKey }), sponsor.publicKey, player.publicKey).reason, /fee payer/);
});

test("withdrawals: USDC only, TransferChecked only, at least the minimum, on their own", () => {
  assert.match(check(tx([transferChecked({ mint: Keypair.generate().publicKey })])).reason, /only USDC/);
  assert.match(check(tx([transferChecked({ opcode: 3 })])).reason, /TransferChecked/);
  assert.match(check(tx([transferChecked({ amount: MIN_WITHDRAW - 1n })])).reason, /under \$0\.10/);
  assert.deepEqual(check(tx([transferChecked({ amount: MIN_WITHDRAW })])), { kind: "withdraw" });
  assert.match(check(tx([transferChecked(), redeem()])).reason, /on their own/);
});

test("one craft and one redeem per transaction", () => {
  assert.match(check(tx([ed25519(8), craft(sponsor.publicKey, 2), ed25519(8), craft(sponsor.publicKey, 2)])).reason, /one craft/);
});
