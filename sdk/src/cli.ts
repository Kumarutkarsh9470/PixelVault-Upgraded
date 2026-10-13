#!/usr/bin/env node
// pixelvault setup: registers a game and creates its item classes from a
// catalog file, then writes the Deployment JSON the SDK reads at runtime.
// Idempotent: a registered game is kept (its grant signer is rotated if the
// key given differs), existing classes are skipped, missing ones are created.
//
//   npx pixelvault setup --catalog game.json --studio studio.json --grant-signer signer.json --out chain.json [--network devnet] [--rpc URL]
//
// Catalog: { "gameId": 7, "name": "My Game", "backedCap": 0,
//            "items": [{ "classId": 1, "name": "Sword", "price": 500000, "backingBps": 8000, "maxSupply": 0 }] }
// A catalog with { "games": [...] } also works with --game <id>.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  generateKeyPair,
  getAddressFromPublicKey,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  type Address,
  type Instruction,
} from "@solana/kit";

import { associatedTokenAddress, TOKEN_PROGRAM } from "./accounts.ts";
import type { Deployment } from "./deployment.ts";
import { NETWORKS } from "./networks.ts";
import { waitForConfirmation } from "./sponsor.ts";
import {
  createAssociatedTokenAccountInstruction,
  createItemClassInstruction,
  deriveGameDeployment,
  grantSignerOf,
  itemClassPda,
  registerGameInstruction,
  updateGameInstruction,
  type ProtocolDeployment,
} from "./studio.ts";
import { gamePda } from "./accounts.ts";

type CatalogItem = { classId: number; name?: string; price: number; backingBps: number; maxSupply?: number };
type CatalogGame = { gameId: number; name: string; backedCap?: number; items: CatalogItem[] };

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else out[key] = "true";
    }
  }
  return out;
}

const USAGE = `usage:
  pixelvault setup --catalog game.json --studio studio.json --grant-signer signer.json --out chain.json
                   [--network devnet | --deployment protocol.json] [--rpc URL] [--game <id>]

  --catalog       the game and its items (see the comment at the top of this file)
  --studio        the studio keypair JSON; it owns the game and pays rent
  --grant-signer  the keypair JSON your server signs grants with (only its public key is used)
  --out           where to write the Deployment JSON; merged into the file if it exists
  --network       a known protocol deployment (default: devnet)
  --deployment    or a JSON file with programId, usdcMint, protocol, protocolTreasury, rpc, cluster
`;

function loadKey(path: string) {
  return Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (command !== "setup" || !args.catalog || !args.studio || !args["grant-signer"] || !args.out) {
    console.error(USAGE);
    process.exit(command === "setup" ? 2 : 1);
  }

  const protocol: ProtocolDeployment = args.deployment
    ? (JSON.parse(readFileSync(args.deployment, "utf8")) as ProtocolDeployment)
    : NETWORKS[args.network ?? "devnet"];
  if (!protocol) throw new Error(`unknown network ${args.network}; pass --deployment`);
  const rpcUrl = args.rpc ?? protocol.rpc;
  const rpc = createSolanaRpc(rpcUrl);

  const catalogFile = JSON.parse(readFileSync(args.catalog, "utf8")) as CatalogGame | { games: CatalogGame[] };
  const game: CatalogGame | undefined =
    "games" in catalogFile
      ? catalogFile.games.find((g) => String(g.gameId) === (args.game ?? String(catalogFile.games[0]?.gameId)))
      : catalogFile;
  if (!game) throw new Error("no game found in the catalog; pass --game <id>");

  const studioKeys = await createKeyPairFromBytes(loadKey(args.studio));
  const studio = await getAddressFromPublicKey(studioKeys.publicKey);
  const grantSignerKeys = await createKeyPairFromBytes(loadKey(args["grant-signer"]));
  const grantSigner = await getAddressFromPublicKey(grantSignerKeys.publicKey);
  const programId = address(protocol.programId);
  const usdcMint = address(protocol.usdcMint);

  console.log(`studio ${studio} on ${protocol.cluster} (${rpcUrl})`);

  const send = async (instructions: Instruction[], extraSigners: CryptoKeyPair[] = []) => {
    const { value } = await rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(studio, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(value, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const signed = await signTransaction([studioKeys, ...extraSigners], compileTransaction(message));
    const signature = await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" }).send();
    await waitForConfirmation(rpc, signature);
    return signature;
  };

  const exists = async (at: Address) => (await rpc.getAccountInfo(at, { encoding: "base64" }).send()).value !== null;

  const gameAddress = await gamePda(programId, game.gameId);
  const treasury = await associatedTokenAddress(studio, usdcMint, TOKEN_PROGRAM);
  const gameInfo = await rpc.getAccountInfo(gameAddress, { encoding: "base64" }).send();

  if (!gameInfo.value) {
    const ixs = [
      await createAssociatedTokenAccountInstruction(studio, studio, usdcMint),
      await registerGameInstruction(protocol, {
        authority: studio,
        gameId: game.gameId,
        name: game.name,
        grantSigner,
        treasury,
        backedCap: game.backedCap ?? 0,
      }),
    ];
    console.log(`registered game ${game.gameId} "${game.name}" ${gameAddress} in ${await send(ixs)}`);
  } else {
    const data = Uint8Array.from(atob(gameInfo.value.data[0]), (c) => c.charCodeAt(0));
    const current = grantSignerOf(data);
    if (current !== grantSigner) {
      const sig = await send([await updateGameInstruction(protocol, { authority: studio, gameId: game.gameId, grantSigner })]);
      console.log(`rotated grant signer ${current} -> ${grantSigner} in ${sig}`);
    } else {
      console.log(`game ${game.gameId} already registered at ${gameAddress}`);
    }
  }

  const classes: { classId: number; mint: Address }[] = [];
  const existing = args.out && existsSync(args.out) ? (JSON.parse(readFileSync(args.out, "utf8")) as Partial<Deployment>) : {};
  const known = existing.games?.[String(game.gameId)]?.classes ?? {};
  for (const item of game.items) {
    const itemClass = await itemClassPda(programId, gameAddress, item.classId);
    if (await exists(itemClass)) {
      const mint = known[String(item.classId)]?.mint;
      if (!mint) {
        throw new Error(
          `class ${item.classId} exists on-chain but its mint is not in ${args.out}; keep the chain.json from the first run`,
        );
      }
      classes.push({ classId: item.classId, mint: address(mint) });
      console.log(`  class ${item.classId} ${item.name ?? ""} already exists`);
      continue;
    }
    const mintKeys = await generateKeyPair();
    const mint = await getAddressFromPublicKey(mintKeys.publicKey);
    const sig = await send(
      [
        await createItemClassInstruction(protocol, {
          authority: studio,
          gameId: game.gameId,
          classId: item.classId,
          mint,
          price: item.price,
          backingBps: item.backingBps,
          maxSupply: item.maxSupply ?? 0,
        }),
      ],
      [mintKeys],
    );
    classes.push({ classId: item.classId, mint });
    console.log(`  created class ${item.classId} ${item.name ?? ""} (mint ${mint}) in ${sig}`);
  }

  const deployment: Deployment = {
    cluster: protocol.cluster,
    rpc: rpcUrl,
    programId: protocol.programId,
    usdcMint: protocol.usdcMint,
    protocol: protocol.protocol,
    protocolTreasury: protocol.protocolTreasury,
    games: { ...(existing.games ?? {}), [String(game.gameId)]: await deriveGameDeployment(protocol, game.gameId, treasury, classes) },
  };
  writeFileSync(args.out, JSON.stringify(deployment, null, 2) + "\n");
  console.log(`wrote ${args.out}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
