import { allItems } from "../state/catalog";

/** A leaderboard name, framed in the Glyph Forge frame its owner holds on-chain (checked by the server). */
export function Nameplate({ name, frame }: { name: string; frame: string | null }) {
  const item = frame ? allItems.find((i) => i.key === frame && i.type === "frame") : undefined;
  if (!item) return <span className="name">{name}</span>;
  return (
    <span className="name">
      <span className="nameplate" style={{ ["--frame" as string]: item.value }} title={item.name}>
        {name}
      </span>
    </span>
  );
}
