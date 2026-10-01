// End to end against the compiled program in litesvm: everything a studio does
// after setup goes through the SDK. Runs when the program has been built
// (anchor build) and the protocol admin keypair is available, as in CI.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { test } from "node:test";

import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  lamports,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  type Address,
  type GetAccountInfoApi,
  type Instruction,
  type KeyPairSigner,
  type Rpc,
} from "@solana/kit";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";

import {
  associatedTokenAddress,
  ASSOCIATED_TOKEN_PROGRAM,
  craftInstructions,
  createGrantSigner,
  fetchNextGrantSeq,
  gamePda,
  redeemInstruction,
  resolveUsdcAccount,
  routeInstructions,
  signGrant,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  usdcTransferInstruction,
  type Deployment,
  type GrantSigner,
} from "../src/index.ts";

const PROGRAM_SO = process.env.PIXELVAULT_SO ?? new URL("../../pixelvault/target/deploy/pixelvault.so", import.meta.url).pathname;
const ADMIN_KEYPAIR = process.env.PIXELVAULT_ADMIN_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
const missing = [PROGRAM_SO, ADMIN_KEYPAIR].filter((p) => !existsSync(p));
const skip = missing.length ? `needs ${missing.join(" and ")} (run anchor build; see README)` : false;
if (skip && process.env.PIXELVAULT_REQUIRE_PROGRAM) throw new Error(`program tests cannot run: ${skip}`);

const PROGRAM_ID = address("AANvcGamRqQccnrx3XHnynJAXh4KCdJAa2XYnazNsuoZ");
const FEE_BPS = 1_250;
const USDC = 1_000_000n;

const addressBytes = (a: Address) => new Uint8Array(getAddressEncoder().encode(a));
const u16 = (v: number) => {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, v, true);
  return b;
};
const u64 = (v: number | bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
  return b;
};
const borshString = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  return concat(new Uint8Array(new Uint32Array([bytes.length]).buffer), bytes);
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};
const discriminator = (name: string) => new Uint8Array(createHash("sha256").update(`global:${name}`).digest().subarray(0, 8));

const w = (a: Address) => ({ address: a, role: AccountRole.WRITABLE });
const r = (a: Address) => ({ address: a, role: AccountRole.READONLY });
const ws = (a: Address) => ({ address: a, role: AccountRole.WRITABLE_SIGNER });

class World {
  svm = new LiteSVM();
  deployment!: Deployment;
  grantSigner!: GrantSigner;
  admin!: KeyPairSigner;
  sponsor!: KeyPairSigner;
  player!: KeyPairSigner;
  usdcMint!: Address;

  async send(feePayer: KeyPairSigner, instructions: Instruction[], signers: KeyPairSigner[] = []) {
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(feePayer.address, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: this.svm.latestBlockhash(), lastValidBlockHeight: 1_000_000n }, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const unique = new Map([feePayer, ...signers].map((s) => [s.address, s.keyPair]));
    const tx = await signTransaction([...unique.values()], compileTransaction(message));
    return this.svm.sendTransaction(tx);
  }

  async ok(feePayer: KeyPairSigner, instructions: Instruction[], signers: KeyPairSigner[] = []) {
    const result = await this.send(feePayer, instructions, signers);
    if (result instanceof FailedTransactionMetadata) {
      assert.fail(`transaction failed: ${result.toString()}\n${result.meta().prettyLogs()}`);
    }
    this.svm.expireBlockhash();
    return result;
  }

  setTokenAccount(at: Address, mint: Address, owner: Address, amount: bigint) {
    const data = new Uint8Array(165);
    data.set(addressBytes(mint), 0);
    data.set(addressBytes(owner), 32);
    data.set(u64(amount), 64);
    data[108] = 1; // initialized
    this.svm.setAccount({
      address: at,
      data,
      executable: false,
      lamports: lamports(this.svm.minimumBalanceForRentExemption(165n)),
      programAddress: TOKEN_PROGRAM,
      space: 165n,
    });
  }

  usdcOf(account: Address): bigint {
    const acc = this.svm.getAccount(account);
    return acc.exists ? new DataView(acc.data.buffer, acc.data.byteOffset).getBigUint64(64, true) : 0n;
  }

  async itemsOf(owner: Address, gameId: number, classId: number): Promise<bigint> {
    const mint = address(this.deployment.games[gameId].classes[classId].mint);
    const acc = this.svm.getAccount(await associatedTokenAddress(owner, mint, TOKEN_2022_PROGRAM));
    return acc.exists ? new DataView(acc.data.buffer, acc.data.byteOffset).getBigUint64(64, true) : 0n;
  }

  /** A minimal RPC over litesvm, enough for the SDK's chain reads. */
  rpc(): Rpc<GetAccountInfoApi> {
    const svm = this.svm;
    return {
      getAccountInfo: (at: Address) => ({
        send: async () => {
          const acc = svm.getAccount(at);
          return {
            value: acc.exists ? { owner: acc.programAddress, data: [Buffer.from(acc.data).toString("base64"), "base64"] } : null,
          };
        },
      }),
    } as unknown as Rpc<GetAccountInfoApi>;
  }

  async registerGame(gameId: number, name: string, classes: { classId: number; price: bigint; backingBps: number }[]) {
    const studio = await generateKeyPairSigner();
    this.svm.airdrop(studio.address, lamports(10_000_000_000n));
    const game = await gamePda(PROGRAM_ID, gameId);
    const vault = await associatedTokenAddress(game, this.usdcMint, TOKEN_PROGRAM);
    const treasury = (await generateKeyPairSigner()).address;
    this.setTokenAccount(treasury, this.usdcMint, studio.address, 0n);
    await this.ok(studio, [
      {
        programAddress: PROGRAM_ID,
        accounts: [
          ws(studio.address),
          r(this.deployment.protocol as Address),
          w(game),
          r(this.usdcMint),
          w(vault),
          r(treasury),
          r(TOKEN_PROGRAM),
          r(ASSOCIATED_TOKEN_PROGRAM),
          r(SYSTEM_PROGRAM),
        ],
        data: concat(discriminator("register_game"), u64(gameId), borshString(name), addressBytes(this.grantSigner.address), u64(0)),
      },
    ]);

    const deployed: Deployment["games"][string] = { game, vault, treasury, classes: {} };
    for (const c of classes) {
      const mint = await generateKeyPairSigner();
      const [itemClass] = await getProgramDerivedAddress({
        programAddress: PROGRAM_ID,
        seeds: [new TextEncoder().encode("class"), addressBytes(game), u64(c.classId)],
      });
      await this.ok(
        studio,
        [
          {
            programAddress: PROGRAM_ID,
            accounts: [ws(studio.address), r(game), w(itemClass), ws(mint.address), r(TOKEN_2022_PROGRAM), r(SYSTEM_PROGRAM)],
            data: concat(discriminator("create_item_class"), u64(c.classId), u64(c.price), u16(c.backingBps), u64(0)),
          },
        ],
        [mint],
      );
      deployed.classes[c.classId] = { itemClass, mint: mint.address };
    }
    this.deployment.games[gameId] = deployed;
  }
}

async function setup(): Promise<World> {
  const world = new World();
  const { svm } = world;
  svm.addProgramFromFile(PROGRAM_ID, PROGRAM_SO);

  world.admin = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(ADMIN_KEYPAIR, "utf8"))));
  world.sponsor = await generateKeyPairSigner();
  world.player = await generateKeyPairSigner(); // never funded with SOL
  world.grantSigner = await createGrantSigner(
    JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8")).signerSecret,
  );
  svm.airdrop(world.admin.address, lamports(10_000_000_000n));
  svm.airdrop(world.sponsor.address, lamports(10_000_000_000n));

  // A USDC stand-in: 6 decimals, minted straight into the player's account.
  world.usdcMint = (await generateKeyPairSigner()).address;
  const mint = new Uint8Array(82);
  mint.set(u64(1_000n * USDC), 36);
  mint[44] = 6;
  mint[45] = 1;
  svm.setAccount({
    address: world.usdcMint,
    data: mint,
    executable: false,
    lamports: lamports(svm.minimumBalanceForRentExemption(82n)),
    programAddress: TOKEN_PROGRAM,
    space: 82n,
  });
  world.setTokenAccount(await associatedTokenAddress(world.player.address, world.usdcMint, TOKEN_PROGRAM), world.usdcMint, world.player.address, 5n * USDC);

  const [protocol] = await getProgramDerivedAddress({ programAddress: PROGRAM_ID, seeds: [new TextEncoder().encode("protocol")] });
  const protocolTreasury = (await generateKeyPairSigner()).address;
  world.setTokenAccount(protocolTreasury, world.usdcMint, world.admin.address, 0n);
  await world.ok(world.admin, [
    {
      programAddress: PROGRAM_ID,
      accounts: [ws(world.admin.address), w(protocol), r(world.usdcMint), r(protocolTreasury), r(SYSTEM_PROGRAM)],
      data: concat(discriminator("init_protocol"), u16(FEE_BPS), u64(0), u64(0)),
    },
  ]);

  world.deployment = {
    cluster: "litesvm",
    rpc: "",
    programId: PROGRAM_ID,
    usdcMint: world.usdcMint,
    protocol,
    protocolTreasury,
    games: {},
  };
  await world.registerGame(1, "Neon Racer", [{ classId: 1, price: USDC, backingBps: 8_000 }]);
  await world.registerGame(2, "Glyph Forge", [{ classId: 1, price: USDC / 2n, backingBps: 9_000 }]);
  return world;
}

async function craft(world: World, gameId: number, classId: number, seq?: bigint) {
  const player = world.player.address;
  const nextSeq = seq ?? (await fetchNextGrantSeq(world.rpc(), world.deployment, gameId, player));
  const grant = await signGrant(world.deployment, world.grantSigner, { gameId, classId, player, seq: nextSeq });
  const ixs = await craftInstructions(world.deployment, { player, rentPayer: world.sponsor.address, grant });
  return world.send(world.sponsor, ixs, [world.player]);
}

test("zero-SOL player crafts and redeems through the SDK, sponsor paying", { skip }, async () => {
  const world = await setup();
  const player = world.player.address;
  const playerUsdc = await associatedTokenAddress(player, world.usdcMint, TOKEN_PROGRAM);
  const vault = address(world.deployment.games[1].vault);

  const crafted = await craft(world, 1, 1);
  assert.ok(!(crafted instanceof FailedTransactionMetadata), String(crafted));
  world.svm.expireBlockhash();
  assert.equal(await world.itemsOf(player, 1, 1), 1n);
  assert.equal(world.usdcOf(vault), 800_000n);
  assert.equal(world.usdcOf(address(world.deployment.games[1].treasury)), 175_000n);
  assert.equal(world.usdcOf(address(world.deployment.protocolTreasury)), 25_000n);
  assert.equal(world.usdcOf(playerUsdc), 4n * USDC);
  assert.equal(await fetchNextGrantSeq(world.rpc(), world.deployment, 1, player), 1n);

  await world.ok(world.sponsor, [await redeemInstruction(world.deployment, player, { gameId: 1, classId: 1 })], [world.player]);
  assert.equal(await world.itemsOf(player, 1, 1), 0n);
  assert.equal(world.usdcOf(vault), 0n);
  assert.equal(world.usdcOf(playerUsdc), 4_800_000n);

  // Cash out: the player sends USDC to another wallet's USDC account, sponsor paying the fee.
  const elsewhere = address(world.deployment.games[2].treasury);
  const destination = await resolveUsdcAccount(world.rpc(), world.deployment, elsewhere);
  await world.ok(world.sponsor, [await usdcTransferInstruction(world.deployment, { owner: player, destination, amount: 800_000n })], [world.player]);
  assert.equal(world.usdcOf(playerUsdc), 4n * USDC);
  assert.equal(world.usdcOf(elsewhere), 800_000n);
  assert.equal(world.svm.getBalance(player) ?? 0n, 0n);
});

test("route moves value between two studios' games in one transaction", { skip }, async () => {
  const world = await setup();
  const player = world.player.address;
  assert.ok(!((await craft(world, 1, 1)) instanceof FailedTransactionMetadata));
  world.svm.expireBlockhash();

  const seq = await fetchNextGrantSeq(world.rpc(), world.deployment, 2, player);
  const grant = await signGrant(world.deployment, world.grantSigner, { gameId: 2, classId: 1, player, seq });
  const ixs = await routeInstructions(world.deployment, {
    player,
    rentPayer: world.sponsor.address,
    from: { gameId: 1, classId: 1 },
    grant,
  });
  await world.ok(world.sponsor, ixs, [world.player]);

  assert.equal(await world.itemsOf(player, 1, 1), 0n);
  assert.equal(await world.itemsOf(player, 2, 1), 1n);
  assert.equal(world.usdcOf(address(world.deployment.games[1].vault)), 0n);
  assert.equal(world.usdcOf(address(world.deployment.games[2].vault)), 450_000n);
});

test("a replayed SDK grant is rejected with GrantAlreadyUsed", { skip }, async () => {
  const world = await setup();
  assert.ok(!((await craft(world, 1, 1, 0n)) instanceof FailedTransactionMetadata));
  world.svm.expireBlockhash();
  const replay = await craft(world, 1, 1, 0n);
  assert.ok(replay instanceof FailedTransactionMetadata, "replay should fail");
  assert.match(replay.meta().logs().join("\n"), /GrantAlreadyUsed/);
});
