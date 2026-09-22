// Builds PixelVault transactions by hand with @solana/kit. Account order and
// roles mirror the program's Accounts structs (see target/idl/pixelvault.json).
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getAddressEncoder,
  getProgramDerivedAddress,
  getTransactionEncoder,
  getU64Encoder,
  getI64Encoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";

import chain from "../data/chain.json";
import type { Grant } from "./api";

const PROGRAM = address(chain.programId);
const TOKEN = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ASSOCIATED_TOKEN = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM = address("11111111111111111111111111111111");
const INSTRUCTIONS_SYSVAR = address("Sysvar1nstructions1111111111111111111111111");
const ED25519 = address("Ed25519SigVerify111111111111111111111111111");

const CRAFT = new Uint8Array([161, 233, 177, 214, 243, 109, 161, 224]);
const REDEEM = new Uint8Array([184, 12, 86, 149, 70, 196, 97, 225]);

export const rpc = createSolanaRpc(chain.rpc);

type GameConfig = {
  game: string;
  vault: string;
  treasury: string;
  classes: Record<string, { itemClass: string; mint: string }>;
};

export function gameConfig(gameId: number): GameConfig {
  const config = (chain.games as Record<string, GameConfig>)[String(gameId)];
  if (!config) throw new Error(`game ${gameId} is not set up on ${chain.cluster}`);
  return config;
}

export function classConfig(gameId: number, classId: number) {
  const config = gameConfig(gameId).classes[String(classId)];
  if (!config) throw new Error(`item ${gameId}/${classId} is not set up on ${chain.cluster}`);
  return config;
}

async function ata(owner: Address, mint: Address, tokenProgram: Address): Promise<Address> {
  const [pda] = await findAssociatedTokenPda({ owner, mint, tokenProgram });
  return pda;
}

const addressEncoder = getAddressEncoder();
const addressBytes = (value: Address) => new Uint8Array(addressEncoder.encode(value));

async function playerStatePda(game: Address, player: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PROGRAM,
    seeds: [new TextEncoder().encode("player"), addressBytes(game), addressBytes(player)],
  });
  return pda;
}

/** The Ed25519 precompile instruction carrying the game server's grant signature. */
function ed25519Instruction(signer: Address, signature: Uint8Array, message: Uint8Array): Instruction {
  const pubkeyOffset = 16;
  const signatureOffset = pubkeyOffset + 32;
  const messageOffset = signatureOffset + 64;
  const data = new Uint8Array(messageOffset + message.length);
  const view = new DataView(data.buffer);
  data[0] = 1;
  const offsets = [signatureOffset, 0xffff, pubkeyOffset, 0xffff, messageOffset, message.length, 0xffff];
  offsets.forEach((value, i) => view.setUint16(2 + i * 2, value, true));
  data.set(addressBytes(signer), pubkeyOffset);
  data.set(signature, signatureOffset);
  data.set(message, messageOffset);
  return { programAddress: ED25519, accounts: [], data };
}

/** Byte-for-byte the message the program rebuilds in grant::grant_message. */
function grantMessage(game: Address, classId: number, player: Address, seq: bigint, expiresAt: number): Uint8Array {
  const parts = [
    new TextEncoder().encode("PIXELVAULT_GRANT_V1"),
    addressBytes(PROGRAM),
    addressBytes(game),
    getU64Encoder().encode(BigInt(classId)),
    addressBytes(player),
    getU64Encoder().encode(seq),
    getI64Encoder().encode(BigInt(expiresAt)),
  ].map((p) => new Uint8Array(p));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const concat = (...parts: ArrayLike<number>[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

export async function craftInstructions(player: Address, rentPayer: Address, grant: Grant): Promise<Instruction[]> {
  const game = gameConfig(grant.gameId);
  const item = classConfig(grant.gameId, grant.classId);
  const gameAddress = address(game.game);
  const mint = address(item.mint);
  const usdcMint = address(chain.usdcMint);
  const seq = BigInt(grant.seq);

  const signature = Uint8Array.from(atob(grant.signature), (c) => c.charCodeAt(0));
  const message = grantMessage(gameAddress, grant.classId, player, seq, grant.expiresAt);

  const craft: Instruction = {
    programAddress: PROGRAM,
    accounts: [
      { address: player, role: AccountRole.READONLY_SIGNER },
      { address: rentPayer, role: AccountRole.WRITABLE_SIGNER },
      { address: address(chain.protocol), role: AccountRole.WRITABLE },
      { address: gameAddress, role: AccountRole.WRITABLE },
      { address: address(item.itemClass), role: AccountRole.WRITABLE },
      { address: await playerStatePda(gameAddress, player), role: AccountRole.WRITABLE },
      { address: usdcMint, role: AccountRole.READONLY },
      { address: await ata(player, usdcMint, TOKEN), role: AccountRole.WRITABLE },
      { address: address(game.vault), role: AccountRole.WRITABLE },
      { address: address(game.treasury), role: AccountRole.WRITABLE },
      { address: address(chain.protocolTreasury), role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.WRITABLE },
      { address: await ata(player, mint, TOKEN_2022), role: AccountRole.WRITABLE },
      { address: INSTRUCTIONS_SYSVAR, role: AccountRole.READONLY },
      { address: TOKEN, role: AccountRole.READONLY },
      { address: TOKEN_2022, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN, role: AccountRole.READONLY },
      { address: SYSTEM, role: AccountRole.READONLY },
    ],
    data: concat(CRAFT, getU64Encoder().encode(seq), getI64Encoder().encode(BigInt(grant.expiresAt))),
  };
  return [ed25519Instruction(address(grant.signer), signature, message), craft];
}

export async function redeemInstruction(player: Address, gameId: number, classId: number): Promise<Instruction> {
  const game = gameConfig(gameId);
  const item = classConfig(gameId, classId);
  const mint = address(item.mint);
  const usdcMint = address(chain.usdcMint);
  return {
    programAddress: PROGRAM,
    accounts: [
      { address: player, role: AccountRole.READONLY_SIGNER },
      { address: address(chain.protocol), role: AccountRole.WRITABLE },
      { address: address(game.game), role: AccountRole.WRITABLE },
      { address: address(item.itemClass), role: AccountRole.WRITABLE },
      { address: usdcMint, role: AccountRole.READONLY },
      { address: await ata(player, usdcMint, TOKEN), role: AccountRole.WRITABLE },
      { address: address(game.vault), role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.WRITABLE },
      { address: await ata(player, mint, TOKEN_2022), role: AccountRole.WRITABLE },
      { address: TOKEN, role: AccountRole.READONLY },
      { address: TOKEN_2022, role: AccountRole.READONLY },
    ],
    data: REDEEM,
  };
}

export type Quote = { feePayer: string; blockhash: string; lastValidBlockHeight: number };

/** Compiles instructions into a transaction the relayer pays for. */
export function compileSponsored(instructions: Instruction[], quote: Quote): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(quote.feePayer), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: quote.blockhash as Blockhash, lastValidBlockHeight: BigInt(quote.lastValidBlockHeight) },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

/** Item balances (Token-2022) and USDC balance for a wallet. */
export async function balancesOf(owner: string): Promise<{ usdc: number; items: Record<string, number> }> {
  const ownerAddress = address(owner);
  const [itemAccounts, usdcAccount] = await Promise.all([
    rpc.getTokenAccountsByOwner(ownerAddress, { programId: TOKEN_2022 }, { encoding: "jsonParsed" }).send(),
    ata(ownerAddress, address(chain.usdcMint), TOKEN).then((a) =>
      rpc
        .getTokenAccountBalance(a)
        .send()
        .catch(() => null),
    ),
  ]);
  const items: Record<string, number> = {};
  for (const account of itemAccounts.value) {
    const info = (account.account.data as { parsed: { info: { mint: string; tokenAmount: { amount: string } } } })
      .parsed.info;
    items[info.mint] = Number(info.tokenAmount.amount);
  }
  return { usdc: usdcAccount ? Number(usdcAccount.value.amount) : 0, items };
}

export { chain };
