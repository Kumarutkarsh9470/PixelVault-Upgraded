import catalogData from "../data/catalog.json";

export type Item = (typeof catalogData.games)[number]["items"][number] & { gameId: number };

export const catalog = catalogData;
export const allItems: Item[] = catalogData.games.flatMap((g) => g.items.map((i) => ({ ...i, gameId: g.gameId })));

export const gameName = (gameId: number) => catalog.games.find((g) => g.gameId === gameId)?.name ?? `Game ${gameId}`;

/** What redeeming one unit returns, in USDC base units. */
export const refundOf = (item: Item) => Math.floor((item.price * item.backingBps) / 10_000);
