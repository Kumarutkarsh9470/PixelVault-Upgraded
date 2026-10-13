import type { ReactNode } from "react";

import { allItems, catalog } from "../state/catalog";
import { formatUsdc, type Medal } from "../lib/api";

export function MaterialChip({ id, amount, need }: { id: string; amount: number; need?: number }) {
  const material = catalog.materials.find((m) => m.id === id);
  const short = need !== undefined && amount < need;
  return (
    <span className={`chip ${short ? "chip-short" : ""}`} style={{ ["--c" as string]: material?.color ?? "#fff" }}>
      <i />
      {material?.name ?? id}
      <b>{need !== undefined ? `${amount}/${need}` : amount}</b>
    </span>
  );
}

export function MedalBadge({ medal, size = "md" }: { medal: Medal; size?: "sm" | "md" | "lg" }) {
  if (!medal) return <span className={`medal medal-none medal-${size}`}>No medal</span>;
  return <span className={`medal medal-${medal} medal-${size}`}>{medal}</span>;
}

export function Sheet({ title, children, onClose }: { title?: string; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="sheet">
      {(title || onClose) && (
        <header>
          {title && <h2>{title}</h2>}
          {onClose && (
            <button className="icon-button" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </header>
      )}
      {children}
    </div>
  );
}

export function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className={`stat ${accent ? "stat-accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/** Price against refund: the bar is the share of the price that is locked as USDC. */
export function BackingMeter({ price, backingBps, count }: { price: number; backingBps: number; count?: number }) {
  const refund = Math.floor((price * backingBps) / 10_000);
  const units = count && count > 1 ? count : 1;
  return (
    <div className="backing">
      <div className="backing-row">
        <span>
          <small>Price</small>
          <b>{formatUsdc(price)}</b>
        </span>
        <span className="backing-mid">
          <i style={{ width: `${backingBps / 100}%` }} />
          <em>{backingBps / 100}% locked</em>
        </span>
        <span className="backing-refund">
          <small>Refund{units > 1 ? ` ×${units}` : ""}</small>
          <b>{formatUsdc(refund * units)}</b>
        </span>
      </div>
    </div>
  );
}

export type PodiumEntry = { name: string; frame: string | null; value: string };

/** The top three, centre first. */
export function Podium({ entries, render }: { entries: PodiumEntry[]; render: (e: PodiumEntry) => ReactNode }) {
  if (entries.length === 0) return null;
  const order = [entries[1], entries[0], entries[2]].filter(Boolean) as PodiumEntry[];
  const place = (e: PodiumEntry) => entries.indexOf(e) + 1;
  return (
    <div className="podium">
      {order.map((e) => (
        <div key={place(e)} className={`podium-step place-${place(e)}`} style={{ ["--frame" as string]: frameColor(e.frame) }}>
          <span className="podium-rank">{place(e)}</span>
          <span className="podium-avatar">{initials(e.name)}</span>
          <span className="podium-name">{render(e)}</span>
          <b className="podium-value">{e.value}</b>
        </div>
      ))}
    </div>
  );
}

function frameColor(frame: string | null): string {
  const item = frame ? allItems.find((i) => i.key === frame && i.type === "frame") : undefined;
  return item?.value ?? "transparent";
}

export function initials(name: string): string {
  const clean = name.replace(/^@/, "").trim();
  const parts = clean.split(/[\s_.-]+/).filter(Boolean);
  const text = parts.length >= 2 ? parts[0][0] + parts[1][0] : clean.slice(0, 2);
  return text.toUpperCase() || "?";
}

/** Shimmering placeholder rows while a list loads. */
export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" style={{ ["--i" as string]: i }} />
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <b>{title}</b>
      <p className="muted small">{hint}</p>
    </div>
  );
}
