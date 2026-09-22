// One-time starter USDC for new players, so their first craft costs them
// nothing. On devnet the funder is the mock USDC mint authority and mints;
// on mainnet it would transfer from a funded treasury instead.
import fs from "node:fs";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

import { rpc } from "./_lib/chain.js";
import { sql } from "./_lib/db.js";
import { HttpError, readBody, route } from "./_lib/http.js";
import { upsertPlayer } from "./_lib/players.js";
import { verifyInitData } from "./_lib/telegram.js";

const chain = JSON.parse(fs.readFileSync(new URL("../data/chain.json", import.meta.url)));
const STARTER_MICRO_USDC = Number(process.env.STARTER_MICRO_USDC || 2_000_000);
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function funder() {
  const raw = process.env.FUNDER_SECRET;
  if (!raw) throw new Error("FUNDER_SECRET is not set");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

export default route(["POST"], async (req) => {
  const body = readBody(req);
  const user = verifyInitData(body.initData);
  const player = await upsertPlayer(user, body.wallet);
  if (!player.wallet || player.wallet !== body.wallet) {
    throw new HttpError(400, "wallet does not match this player");
  }

  // Claim first, atomically, so two concurrent requests cannot both be paid.
  const claimed = await sql()`
    update players set starter_granted_at = now()
    where telegram_id = ${user.id} and starter_granted_at is null
    returning telegram_id`;
  if (claimed.length === 0) {
    return { signature: null, amount: 0 };
  }

  try {
    const payer = funder();
    const owner = new PublicKey(player.wallet);
    const mint = new PublicKey(chain.usdcMint);
    const [account] = PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], ATA_PROGRAM);

    const amount = Buffer.alloc(8);
    amount.writeBigUInt64LE(BigInt(STARTER_MICRO_USDC));
    const tx = new Transaction().add(
      // Create the player's USDC account if needed (the funder pays the rent).
      new TransactionInstruction({
        programId: ATA_PROGRAM,
        keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: account, isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: false, isWritable: false },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: TOKEN, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([1]),
      }),
      // MintTo (tag 7).
      new TransactionInstruction({
        programId: TOKEN,
        keys: [
          { pubkey: mint, isSigner: false, isWritable: true },
          { pubkey: account, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        ],
        data: Buffer.concat([Buffer.from([7]), amount]),
      }),
    );
    const signature = await rpc().sendTransaction(tx, [payer]);
    await rpc().confirmTransaction(signature, "confirmed");
    return { signature, amount: STARTER_MICRO_USDC };
  } catch (e) {
    // Release the claim so the player can try again.
    await sql()`update players set starter_granted_at = null where telegram_id = ${user.id}`;
    throw e;
  }
});
