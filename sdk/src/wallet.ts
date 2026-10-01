// Cashing out: moving a player's USDC (for example, redeemed backing) to any Solana wallet.
import { AccountRole, address, type Address, type GetAccountInfoApi, type Instruction, type Rpc } from "@solana/kit";

import { addressBytes, associatedTokenAddress, TOKEN_PROGRAM } from "./accounts.ts";
import type { Deployment } from "./deployment.ts";

export const USDC_DECIMALS = 6;
const TRANSFER_CHECKED = 12;
const TOKEN_ACCOUNT_SIZE = 165;

/**
 * The USDC token account that should receive a transfer to `target`. Accepts a
 * wallet address (uses its associated USDC account) or a USDC token account.
 * Throws if neither exists, because creating one would cost the payer rent.
 */
export async function resolveUsdcAccount(rpc: Rpc<GetAccountInfoApi>, deployment: Deployment, target: Address): Promise<Address> {
  const usdcMint = address(deployment.usdcMint);
  const direct = (await rpc.getAccountInfo(target, { encoding: "base64" }).send()).value;
  if (direct && direct.owner === TOKEN_PROGRAM) {
    const data = Uint8Array.from(atob(direct.data[0]), (c) => c.charCodeAt(0));
    const mint = data.subarray(0, 32);
    if (data.length === TOKEN_ACCOUNT_SIZE && mint.every((b, i) => b === addressBytes(usdcMint)[i])) return target;
    throw new Error("that address is a token account for something other than USDC");
  }
  const ata = await associatedTokenAddress(target, usdcMint, TOKEN_PROGRAM);
  if (!(await rpc.getAccountInfo(ata, { encoding: "base64" }).send()).value) {
    throw new Error("that wallet has no USDC account yet; send it any amount of USDC first, or use an exchange deposit address");
  }
  return ata;
}

/** A TransferChecked of `amount` USDC base units from `owner`'s associated USDC account to `destination`. */
export async function usdcTransferInstruction(
  deployment: Deployment,
  { owner, destination, amount }: { owner: Address; destination: Address; amount: bigint },
): Promise<Instruction> {
  const usdcMint = address(deployment.usdcMint);
  const data = new Uint8Array(10);
  data[0] = TRANSFER_CHECKED;
  new DataView(data.buffer).setBigUint64(1, amount, true);
  data[9] = USDC_DECIMALS;
  return {
    programAddress: TOKEN_PROGRAM,
    accounts: [
      { address: await associatedTokenAddress(owner, usdcMint, TOKEN_PROGRAM), role: AccountRole.WRITABLE },
      { address: usdcMint, role: AccountRole.READONLY },
      { address: destination, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY_SIGNER },
    ],
    data,
  };
}
