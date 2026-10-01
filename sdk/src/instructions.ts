// Account order and roles mirror the program's Accounts structs in
// pixelvault/programs/pixelvault/src/instructions/{craft,redeem}.rs.
import { AccountRole, address, getI64Encoder, getU64Encoder, type Address, type Instruction } from "@solana/kit";

import {
  addressBytes,
  associatedTokenAddress,
  ASSOCIATED_TOKEN_PROGRAM,
  ED25519_PROGRAM,
  INSTRUCTIONS_SYSVAR,
  playerStatePda,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "./accounts.ts";
import { classDeployment, gameDeployment, type Deployment } from "./deployment.ts";
import { fromBase64, grantMessage, type Grant } from "./grant.ts";

/** Anchor discriminators: sha256("global:<name>")[0..8]. */
export const CRAFT_DISCRIMINATOR = new Uint8Array([161, 233, 177, 214, 243, 109, 161, 224]);
export const REDEEM_DISCRIMINATOR = new Uint8Array([184, 12, 86, 149, 70, 196, 97, 225]);

/** Account index of `rent_payer` in `craft`: the only role a fee sponsor may take. */
export const CRAFT_RENT_PAYER_INDEX = 1;

const concat = (...parts: ArrayLike<number>[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

/** The Ed25519 precompile instruction that must sit immediately before `craft`. */
export function ed25519VerifyInstruction(signer: Address, signature: Uint8Array, message: Uint8Array): Instruction {
  const pubkeyOffset = 16;
  const signatureOffset = pubkeyOffset + 32;
  const messageOffset = signatureOffset + 64;
  const data = new Uint8Array(messageOffset + message.length);
  const view = new DataView(data.buffer);
  data[0] = 1;
  // u16::MAX instruction indexes mean "in this same instruction", which the program requires.
  const offsets = [signatureOffset, 0xffff, pubkeyOffset, 0xffff, messageOffset, message.length, 0xffff];
  offsets.forEach((value, i) => view.setUint16(2 + i * 2, value, true));
  data.set(addressBytes(signer), pubkeyOffset);
  data.set(signature, signatureOffset);
  data.set(message, messageOffset);
  return { programAddress: ED25519_PROGRAM, accounts: [], data };
}

export type CraftParams = {
  player: Address;
  /** Pays rent for any accounts craft creates; usually the fee sponsor. May equal `player`. */
  rentPayer: Address;
  grant: Grant;
};

/** The two instructions that craft one unit: the grant's signature check, then `craft`. */
export async function craftInstructions(deployment: Deployment, { player, rentPayer, grant }: CraftParams): Promise<Instruction[]> {
  const programId = address(deployment.programId);
  const game = gameDeployment(deployment, grant.gameId);
  const item = classDeployment(deployment, grant.gameId, grant.classId);
  const gameAddress = address(game.game);
  const mint = address(item.mint);
  const usdcMint = address(deployment.usdcMint);
  const seq = BigInt(grant.seq);

  const message = await grantMessage({
    programId,
    game: gameAddress,
    classId: grant.classId,
    player,
    seq,
    expiresAt: grant.expiresAt,
  });

  const craft: Instruction = {
    programAddress: programId,
    accounts: [
      { address: player, role: AccountRole.READONLY_SIGNER },
      { address: rentPayer, role: AccountRole.WRITABLE_SIGNER },
      { address: address(deployment.protocol), role: AccountRole.WRITABLE },
      { address: gameAddress, role: AccountRole.WRITABLE },
      { address: address(item.itemClass), role: AccountRole.WRITABLE },
      { address: await playerStatePda(programId, gameAddress, player), role: AccountRole.WRITABLE },
      { address: usdcMint, role: AccountRole.READONLY },
      { address: await associatedTokenAddress(player, usdcMint, TOKEN_PROGRAM), role: AccountRole.WRITABLE },
      { address: address(game.vault), role: AccountRole.WRITABLE },
      { address: address(game.treasury), role: AccountRole.WRITABLE },
      { address: address(deployment.protocolTreasury), role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.WRITABLE },
      { address: await associatedTokenAddress(player, mint, TOKEN_2022_PROGRAM), role: AccountRole.WRITABLE },
      { address: INSTRUCTIONS_SYSVAR, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: TOKEN_2022_PROGRAM, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: concat(CRAFT_DISCRIMINATOR, getU64Encoder().encode(seq), getI64Encoder().encode(BigInt(grant.expiresAt))),
  };
  return [ed25519VerifyInstruction(address(grant.signer), fromBase64(grant.signature), message), craft];
}

export type ItemRef = { gameId: number; classId: number };

/** Burns one unit of an item and pays its backing to the player's USDC account. */
export async function redeemInstruction(deployment: Deployment, player: Address, { gameId, classId }: ItemRef): Promise<Instruction> {
  const game = gameDeployment(deployment, gameId);
  const item = classDeployment(deployment, gameId, classId);
  const mint = address(item.mint);
  const usdcMint = address(deployment.usdcMint);
  return {
    programAddress: address(deployment.programId),
    accounts: [
      { address: player, role: AccountRole.READONLY_SIGNER },
      { address: address(deployment.protocol), role: AccountRole.WRITABLE },
      { address: address(game.game), role: AccountRole.WRITABLE },
      { address: address(item.itemClass), role: AccountRole.WRITABLE },
      { address: usdcMint, role: AccountRole.READONLY },
      { address: await associatedTokenAddress(player, usdcMint, TOKEN_PROGRAM), role: AccountRole.WRITABLE },
      { address: address(game.vault), role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.WRITABLE },
      { address: await associatedTokenAddress(player, mint, TOKEN_2022_PROGRAM), role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: TOKEN_2022_PROGRAM, role: AccountRole.READONLY },
    ],
    data: REDEEM_DISCRIMINATOR,
  };
}

/**
 * Moves value between games in one transaction: redeem `from`, then craft the
 * item `grant` authorises. The backing released by the redeem pays for most of
 * the new item, so the player needs USDC only for the difference.
 */
export async function routeInstructions(
  deployment: Deployment,
  { player, rentPayer, from, grant }: CraftParams & { from: ItemRef },
): Promise<Instruction[]> {
  return [
    await redeemInstruction(deployment, player, from),
    ...(await craftInstructions(deployment, { player, rentPayer, grant })),
  ];
}
