import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { address, generateKeyPairSigner, type Address, type GetAccountInfoApi, type Rpc } from "@solana/kit";
import { findAssociatedTokenPda, getTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import { addressBytes, associatedTokenAddress, resolveUsdcAccount, TOKEN_PROGRAM, usdcTransferInstruction, type Deployment } from "../src/index.ts";

const deployment: Deployment = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8")).deployment;
const usdc = address(deployment.usdcMint);

test("USDC transfer matches the official token program client", async () => {
  const ownerSigner = await generateKeyPairSigner();
  const owner = ownerSigner.address;
  const destination = (await generateKeyPairSigner()).address;
  const ours = await usdcTransferInstruction(deployment, { owner, destination, amount: 1_234_567n });
  const [source] = await findAssociatedTokenPda({ owner, mint: usdc, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const theirs = getTransferCheckedInstruction({ source, mint: usdc, destination, authority: ownerSigner, amount: 1_234_567n, decimals: 6 });
  assert.equal(ours.programAddress, theirs.programAddress);
  assert.deepEqual(
    ours.accounts!.map((a) => [a.address, a.role]),
    theirs.accounts.map((a) => [a.address, a.role]),
  );
  assert.deepEqual(Array.from(ours.data!), Array.from(theirs.data));
});

function fakeRpc(accounts: Record<string, { owner: Address; data: Uint8Array }>): Rpc<GetAccountInfoApi> {
  return {
    getAccountInfo: (at: Address) => ({
      send: async () => {
        const acc = accounts[at];
        return { value: acc ? { owner: acc.owner, data: [Buffer.from(acc.data).toString("base64"), "base64"] } : null };
      },
    }),
  } as unknown as Rpc<GetAccountInfoApi>;
}

const tokenAccount = (mint: Address) => {
  const data = new Uint8Array(165);
  data.set(addressBytes(mint), 0);
  return { owner: TOKEN_PROGRAM, data };
};

test("resolves a wallet to its associated USDC account, or a USDC account to itself", async () => {
  const wallet = (await generateKeyPairSigner()).address;
  const ata = await associatedTokenAddress(wallet, usdc, TOKEN_PROGRAM);
  const exchangeAccount = (await generateKeyPairSigner()).address;
  const rpc = fakeRpc({ [ata]: tokenAccount(usdc), [exchangeAccount]: tokenAccount(usdc) });
  assert.equal(await resolveUsdcAccount(rpc, deployment, wallet), ata);
  assert.equal(await resolveUsdcAccount(rpc, deployment, exchangeAccount), exchangeAccount);
});

test("refuses wallets without a USDC account and token accounts for other mints", async () => {
  const wallet = (await generateKeyPairSigner()).address;
  const otherMintAccount = (await generateKeyPairSigner()).address;
  const rpc = fakeRpc({ [otherMintAccount]: tokenAccount((await generateKeyPairSigner()).address) });
  await assert.rejects(resolveUsdcAccount(rpc, deployment, wallet), /no USDC account/);
  await assert.rejects(resolveUsdcAccount(rpc, deployment, otherMintAccount), /other than USDC/);
});
