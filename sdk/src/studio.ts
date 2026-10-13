// What a studio does once: register its game, create its item classes, and
// later rotate its grant signer, pause crafting or raise its cap. Account
// order and roles mirror the program's Accounts structs in
// pixelvault/programs/pixelvault/src/instructions/{register_game,create_item_class,update_game}.rs.
import {
  AccountRole,
  address,
  getAddressDecoder,
  getProgramDerivedAddress,
  getU16Encoder,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";

import {
  addressBytes,
  associatedTokenAddress,
  ASSOCIATED_TOKEN_PROGRAM,
  gamePda,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "./accounts.ts";
import type { Deployment, GameDeployment } from "./deployment.ts";
import { MAX_BACKING_BPS, MIN_BACKING_BPS } from "./economy.ts";

/** Anchor discriminators: sha256("global:<name>")[0..8]. */
export const REGISTER_GAME_DISCRIMINATOR = new Uint8Array([122, 44, 95, 58, 89, 33, 40, 59]);
export const CREATE_ITEM_CLASS_DISCRIMINATOR = new Uint8Array([170, 115, 85, 141, 77, 15, 35, 144]);
export const UPDATE_GAME_DISCRIMINATOR = new Uint8Array([159, 61, 132, 131, 3, 234, 209, 220]);

/** Game layout: discriminator (8), authority (32), grant_signer (32), ... */
export const GAME_GRANT_SIGNER_OFFSET = 8 + 32;

const text = new TextEncoder();
const u64 = (v: number | bigint) => new Uint8Array(getU64Encoder().encode(BigInt(v)));
const u16 = (v: number) => new Uint8Array(getU16Encoder().encode(v));

const concat = (...parts: ArrayLike<number>[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

/** Borsh string: u32 little-endian byte length, then UTF-8. */
function borshString(value: string): Uint8Array {
  const bytes = text.encode(value);
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

export async function itemClassPda(programId: Address, game: Address, classId: number | bigint): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [text.encode("class"), addressBytes(game), u64(classId)],
  });
  return pda;
}

/** The protocol half of a deployment: everything a studio needs before it has registered. */
export type ProtocolDeployment = Pick<Deployment, "cluster" | "rpc" | "programId" | "usdcMint" | "protocol" | "protocolTreasury">;

export type RegisterGameParams = {
  /** The studio key. Owns the game from then on and pays rent for the game account and its vault. */
  authority: Address;
  gameId: number;
  /** Shown in explorers and events; up to 32 bytes. */
  name: string;
  /** The public key your server signs grants with. Rotate it any time with `updateGameInstruction`. */
  grantSigner: Address;
  /** The studio's USDC token account, where its share of every craft's margin is paid. */
  treasury: Address;
  /** Cap on total USDC backing this game may hold, in base units; 0 for no cap. */
  backedCap?: number | bigint;
};

/**
 * Registers a game and creates its vault, a USDC account owned by the game's
 * program address that no key can withdraw from. Permissionless: any studio
 * may register any unused game id.
 */
export async function registerGameInstruction(deployment: ProtocolDeployment, params: RegisterGameParams): Promise<Instruction> {
  const programId = address(deployment.programId);
  const usdcMint = address(deployment.usdcMint);
  const game = await gamePda(programId, params.gameId);
  return {
    programAddress: programId,
    accounts: [
      { address: params.authority, role: AccountRole.WRITABLE_SIGNER },
      { address: address(deployment.protocol), role: AccountRole.READONLY },
      { address: game, role: AccountRole.WRITABLE },
      { address: usdcMint, role: AccountRole.READONLY },
      { address: await associatedTokenAddress(game, usdcMint, TOKEN_PROGRAM), role: AccountRole.WRITABLE },
      { address: params.treasury, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: concat(
      REGISTER_GAME_DISCRIMINATOR,
      u64(params.gameId),
      borshString(params.name),
      addressBytes(params.grantSigner),
      u64(params.backedCap ?? 0),
    ),
  };
}

export type CreateItemClassParams = {
  authority: Address;
  gameId: number;
  classId: number;
  /** A fresh keypair's address; it must sign the transaction and is never needed again. */
  mint: Address;
  /** In USDC base units (6 decimals). */
  price: number | bigint;
  /** Share of the price locked as backing, in basis points: 5000 to 9500. */
  backingBps: number;
  /** Units that may ever be crafted; 0 for unlimited. */
  maxSupply?: number | bigint;
};

/** Creates an item class with a Token-2022 mint that only the game's program address can mint. */
export async function createItemClassInstruction(deployment: ProtocolDeployment, params: CreateItemClassParams): Promise<Instruction> {
  if (params.backingBps < MIN_BACKING_BPS || params.backingBps > MAX_BACKING_BPS) {
    throw new Error(`backingBps must be between ${MIN_BACKING_BPS} and ${MAX_BACKING_BPS}`);
  }
  const programId = address(deployment.programId);
  const game = await gamePda(programId, params.gameId);
  return {
    programAddress: programId,
    accounts: [
      { address: params.authority, role: AccountRole.WRITABLE_SIGNER },
      { address: game, role: AccountRole.READONLY },
      { address: await itemClassPda(programId, game, params.classId), role: AccountRole.WRITABLE },
      { address: params.mint, role: AccountRole.WRITABLE_SIGNER },
      { address: TOKEN_2022_PROGRAM, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: concat(
      CREATE_ITEM_CLASS_DISCRIMINATOR,
      u64(params.classId),
      u64(params.price),
      u16(params.backingBps),
      u64(params.maxSupply ?? 0),
    ),
  };
}

export type UpdateGameParams = {
  authority: Address;
  gameId: number;
  /** Pausing stops crafting only; redemption can never be paused. */
  craftingPaused?: boolean;
  grantSigner?: Address;
  backedCap?: number | bigint;
};

/** Studio controls: pause or resume crafting, rotate the grant signer, change the backing cap. */
export async function updateGameInstruction(deployment: ProtocolDeployment, params: UpdateGameParams): Promise<Instruction> {
  const programId = address(deployment.programId);
  const option = (present: boolean, bytes: ArrayLike<number>) => (present ? concat([1], bytes) : Uint8Array.of(0));
  return {
    programAddress: programId,
    accounts: [
      { address: params.authority, role: AccountRole.READONLY_SIGNER },
      { address: await gamePda(programId, params.gameId), role: AccountRole.WRITABLE },
    ],
    data: concat(
      UPDATE_GAME_DISCRIMINATOR,
      option(params.craftingPaused !== undefined, [params.craftingPaused ? 1 : 0]),
      option(params.grantSigner !== undefined, params.grantSigner ? addressBytes(params.grantSigner) : []),
      option(params.backedCap !== undefined, params.backedCap !== undefined ? u64(params.backedCap) : []),
    ),
  };
}

/** Creates a token account for `owner` if it does not exist yet (the associated token program's idempotent create). */
export async function createAssociatedTokenAccountInstruction(
  payer: Address,
  owner: Address,
  mint: Address,
  tokenProgram: Address = TOKEN_PROGRAM,
): Promise<Instruction> {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: await associatedTokenAddress(owner, mint, tokenProgram), role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: tokenProgram, role: AccountRole.READONLY },
    ],
    data: Uint8Array.of(1),
  };
}

/**
 * The addresses of a game and its classes, derived rather than fetched, so a
 * studio can write its own `Deployment` entry right after registering.
 */
export async function deriveGameDeployment(
  deployment: ProtocolDeployment,
  gameId: number,
  treasury: Address,
  classes: { classId: number; mint: Address }[],
): Promise<GameDeployment> {
  const programId = address(deployment.programId);
  const game = await gamePda(programId, gameId);
  const entries = await Promise.all(
    classes.map(async (c) => [String(c.classId), { itemClass: await itemClassPda(programId, game, c.classId), mint: c.mint }] as const),
  );
  return {
    game,
    vault: await associatedTokenAddress(game, address(deployment.usdcMint), TOKEN_PROGRAM),
    treasury,
    classes: Object.fromEntries(entries),
  };
}

/** Reads the grant signer a registered game currently trusts, from the raw game account data. */
export function grantSignerOf(gameAccountData: Uint8Array): Address {
  return getAddressDecoder().decode(gameAccountData.subarray(GAME_GRANT_SIGNER_OFFSET, GAME_GRANT_SIGNER_OFFSET + 32));
}
