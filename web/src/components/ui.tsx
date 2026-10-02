import type { ReactNode } from "react";

import { catalog } from "../state/catalog";
import type { Medal } from "../lib/api";

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
