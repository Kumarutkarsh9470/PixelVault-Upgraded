// One-shot devnet bootstrap for the PixelVault economy:
//   mock USDC mint -> protocol -> two games (two studios) -> every catalogue
//   item class -> web/src/data/chain.json.
// Idempotent: accounts that already exist are skipped, and generated keys are
// kept in secrets/ (gitignored) so reruns reuse them.
// Usage: node tools/setup-devnet.mjs
import fs from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(new URL("../deploy/racer/package.json", import.meta.url));
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const PROGRAM = new PublicKey("AANvcGamRqQccnrx3XHnynJAXh4KCdJAa2XYnazNsuoZ");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SECRETS = new URL("../secrets/", import.meta.url);
const ADMIN_PATH = "\\\\wsl.localhost\\Ubuntu\\root\\.config\\solana\\id.json";

const PROTOCOL_FEE_BPS = 1250;
const MAX_BACKED_PER_PLAYER = 25_000_000; // $25 lifetime per player per game during beta

const catalog = JSON.parse(fs.readFileSync(new URL("../web/src/data/catalog.json", import.meta.url)));
const connection = new Connection(RPC, "confirmed");

// ---------- helpers ----------

const readKey = (path) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));

function secretKey(name) {
  fs.mkdirSync(SECRETS, { recursive: true });
  const path = new URL(`${name}.json`, SECRETS);
  if (fs.existsSync(path)) return readKey(path);
  const key = Keypair.generate();
  fs.writeFileSync(path, JSON.stringify(Array.from(key.secretKey)));
  console.log(`generated secrets/${name}.json -> ${key.publicKey.toBase58()}`);
  return key;
}

const disc = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const u16 = (v) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
};
const u64 = (v) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
};
const str = (s) => Buffer.concat([Buffer.from(Uint32Array.of(Buffer.byteLength(s)).buffer), Buffer.from(s)]);
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM)[0];
const ata = (owner, mint, tokenProgram = TOKEN) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];

const meta = (pubkey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });
const ix = (keys, data, programId = PROGRAM) => new TransactionInstruction({ programId, keys, data });

async function send(payer, instructions, extraSigners = []) {
  const tx = new Transaction().add(...instructions);
  return sendAndConfirmTransaction(connection, tx, [payer, ...extraSigners], { commitment: "confirmed" });
}

const exists = async (address) => (await connection.getAccountInfo(address)) !== null;

function createAtaIdempotent(payer, owner, mint, tokenProgram = TOKEN) {
  return ix(
    [
      meta(payer, true, true),
      meta(ata(owner, mint, tokenProgram), true),
      meta(owner),
      meta(mint),
      meta(SystemProgram.programId),
      meta(tokenProgram),
    ],
    Buffer.from([1]), // CreateIdempotent
    ATA_PROGRAM,
  );
}

async function fund(admin, to, sol) {
  const balance = await connection.getBalance(to);
  if (balance >= sol * LAMPORTS_PER_SOL * 0.5) return;
  await send(admin, [SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: to, lamports: sol * LAMPORTS_PER_SOL })]);
  console.log(`funded ${to.toBase58()} with ${sol} SOL`);
}

// ---------- steps ----------

async function main() {
  const admin = readKey(ADMIN_PATH);
  const funder = secretKey("funder-devnet"); // mock USDC mint authority; pays starter grants
  const grantSigner = secretKey("grant-signer-devnet");
  const usdcMint = secretKey("usdc-mint-devnet");
  console.log("admin", admin.publicKey.toBase58(), (await connection.getBalance(admin.publicKey)) / LAMPORTS_PER_SOL, "SOL");

  // Mock USDC: SPL Token mint with 6 decimals, mint authority = funder.
  if (!(await exists(usdcMint.publicKey))) {
    const space = 82;
    const lamports = await connection.getMinimumBalanceForRentExemption(space);
    await send(
      admin,
      [
        SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: usdcMint.publicKey,
          lamports,
          space,
          programId: TOKEN,
        }),
        // InitializeMint2: tag 20, decimals, mint authority, no freeze authority.
        ix([meta(usdcMint.publicKey, true)], Buffer.concat([Buffer.from([20, 6]), funder.publicKey.toBuffer(), Buffer.from([0])]), TOKEN),
      ],
      [usdcMint],
    );
    console.log("created mock USDC mint", usdcMint.publicKey.toBase58());
  }
  await fund(admin, funder.publicKey, 0.25);

  // Protocol fee treasury: the admin's USDC account.
  const protocolTreasury = ata(admin.publicKey, usdcMint.publicKey);
  const protocol = pda(Buffer.from("protocol"));
  if (!(await exists(protocol))) {
    await send(admin, [
      createAtaIdempotent(admin.publicKey, admin.publicKey, usdcMint.publicKey),
      ix(
        [meta(admin.publicKey, true, true), meta(protocol, true), meta(usdcMint.publicKey), meta(protocolTreasury), meta(SystemProgram.programId)],
        Buffer.concat([disc("init_protocol"), u16(PROTOCOL_FEE_BPS), u64(MAX_BACKED_PER_PLAYER), u64(0)]),
      ),
    ]);
    console.log("initialised protocol", protocol.toBase58());
  }

  const chain = {
    cluster: "devnet",
    rpc: RPC,
    programId: PROGRAM.toBase58(),
    usdcMint: usdcMint.publicKey.toBase58(),
    protocol: protocol.toBase58(),
    protocolTreasury: protocolTreasury.toBase58(),
    grantSigner: grantSigner.publicKey.toBase58(),
    games: {},
  };

  for (const game of catalog.games) {
    // Each game belongs to its own studio key, so studio revenue is distinct from protocol fees.
    const studio = secretKey(`studio-${game.key}-devnet`);
    await fund(admin, studio.publicKey, 0.2);
    const gameAddress = pda(Buffer.from("game"), u64(game.gameId));
    const vault = ata(gameAddress, usdcMint.publicKey);
    const treasury = ata(studio.publicKey, usdcMint.publicKey);

    if (!(await exists(gameAddress))) {
      await send(studio, [
        createAtaIdempotent(studio.publicKey, studio.publicKey, usdcMint.publicKey),
        ix(
          [
            meta(studio.publicKey, true, true),
            meta(protocol),
            meta(gameAddress, true),
            meta(usdcMint.publicKey),
            meta(vault, true),
            meta(treasury),
            meta(TOKEN),
            meta(ATA_PROGRAM),
            meta(SystemProgram.programId),
          ],
          Buffer.concat([disc("register_game"), u64(game.gameId), str(game.name), grantSigner.publicKey.toBuffer(), u64(0)]),
        ),
      ]);
      console.log(`registered game ${game.gameId} ${game.name}`, gameAddress.toBase58());
    }

    const classes = {};
    for (const item of game.items) {
      const itemClass = pda(Buffer.from("class"), gameAddress.toBuffer(), u64(item.classId));
      const mint = secretKey(`mint-${game.key}-${item.classId}-devnet`);
      if (!(await exists(itemClass))) {
        await send(
          studio,
          [
            ix(
              [
                meta(studio.publicKey, true, true),
                meta(gameAddress),
                meta(itemClass, true),
                meta(mint.publicKey, true, true),
                meta(TOKEN_2022),
                meta(SystemProgram.programId),
              ],
              Buffer.concat([disc("create_item_class"), u64(item.classId), u64(item.price), u16(item.backingBps), u64(item.maxSupply)]),
            ),
          ],
          [mint],
        );
        console.log(`  created class ${item.classId} ${item.name}`);
      }
      classes[item.classId] = { itemClass: itemClass.toBase58(), mint: mint.publicKey.toBase58() };
    }
    chain.games[game.gameId] = { game: gameAddress.toBase58(), vault: vault.toBase58(), treasury: treasury.toBase58(), classes };
  }

  fs.writeFileSync(new URL("../web/src/data/chain.json", import.meta.url), JSON.stringify(chain, null, 2) + "\n");
  console.log("wrote web/src/data/chain.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
