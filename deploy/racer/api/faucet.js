// Public devnet faucet for studios testing an integration: mints 2 mock USDC
// to any wallet, once per wallet, with a daily total cap. The mock mint's
// authority is the funder key; there is nothing like this on mainnet, where
// players bring real USDC.
//   POST /api/faucet { "wallet": "<address>" }   or   GET /api/faucet?wallet=<address>
import fs from "node:fs";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

import { rpc } from "./_lib/chain.js";
import { sql } from "./_lib/db.js";
import { HttpError, readBody, route } from "./_lib/http.js";

const chain = JSON.parse(fs.readFileSync(new URL("../data/chain.json", import.meta.url)));
const FAUCET_MICRO_USDC = Number(process.env.FAUCET_MICRO_USDC || 2_000_000);
const DAILY_GRANTS = Number(process.env.FAUCET_DAILY_GRANTS || 200);
/** One address can spin up wallets for free; it cannot spin up IPs as cheaply. */
const PER_IP_DAILY = Number(process.env.FAUCET_PER_IP_DAILY || 3);
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function funder() {
  const raw = process.env.FUNDER_SECRET;
  if (!raw) throw new Error("FUNDER_SECRET is not set");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

export default route(["GET", "POST"], async (req) => {
  if (chain.cluster !== "devnet") throw new HttpError(404, "the faucet only exists on devnet");
  const wallet = req.method === "GET" ? new URL(req.url, "http://localhost").searchParams.get("wallet") : readBody(req).wallet;
  let owner;
  try {
    owner = new PublicKey(String(wallet ?? ""));
  } catch {
    throw new HttpError(400, "pass a Solana wallet address as `wallet`");
  }

  const ip = String(req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "").split(",")[0].trim() || null;
  const [{ n, mine }] = await sql()`
    select count(*)::int as n, count(*) filter (where ip = ${ip})::int as mine
    from faucet_grants where created_at > now() - interval '1 day'`;
  if (n >= DAILY_GRANTS) throw new HttpError(429, "the faucet is empty for today; try tomorrow");
  if (ip && mine >= PER_IP_DAILY) throw new HttpError(429, "too many faucet requests from this network today");

  // Claim first, atomically, so two concurrent requests cannot both be paid.
  const claimed = await sql()`insert into faucet_grants (wallet, ip) values (${owner.toBase58()}, ${ip}) on conflict (wallet) do nothing returning wallet`;
  if (claimed.length === 0) throw new HttpError(409, "this wallet already received its test USDC");

  try {
    const payer = funder();
    const mint = new PublicKey(chain.usdcMint);
    const [account] = PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], ATA_PROGRAM);
    const amount = Buffer.alloc(8);
    amount.writeBigUInt64LE(BigInt(FAUCET_MICRO_USDC));
    const tx = new Transaction().add(
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
    return { signature, amount: FAUCET_MICRO_USDC, mint: chain.usdcMint, usdcAccount: account.toBase58() };
  } catch (e) {
    await sql()`delete from faucet_grants where wallet = ${owner.toBase58()}`;
    throw e;
  }
});
