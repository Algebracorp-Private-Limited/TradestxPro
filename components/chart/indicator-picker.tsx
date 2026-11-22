"use client";

import { useMemo, useState } from "react";
import { INDICATORS, type IndicatorDef } from "@/lib/ta/catalog";

export function IndicatorPicker({ onAdd, onClose }: { onAdd: (def: IndicatorDef) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return INDICATORS.filter((d) => !t || d.name.toLowerCase().includes(t) || d.short.toLowerCase().includes(t));
  }, [q]);
  const groups = ["Trend", "Momentum", "Volatility", "Volume"] as const;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Indicators" onClick={(e) => e.stopPropagation()} className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">Indicators</h2>
          <button onClick={onClose} aria-label="Close" className="rounded px-2 py-1 text-muted hover:bg-white/5">✕</button>
        </div>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
          placeholder="Search indicators"
          aria-label="Search indicators"
          className="w-full border-b border-line bg-ink px-4 py-2.5 text-sm focus:outline-none"
        />
        <div className="max-h-[60vh] overflow-auto p-2">
          {groups.map((g) => {
            const items = list.filter((d) => d.category === g);
            if (!items.length) return null;
            return (
              <div key={g} className="mb-2">
                <p className="px-2 py-1 text-[11px] uppercase tracking-wider text-muted">{g}</p>
                {items.map((d) => (
                  <button key={d.id} onClick={() => onAdd(d)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-white/[0.05]">
                    <span>{d.name} <span className="font-mono text-xs text-muted">({d.short})</span></span>
                    <span className="text-[11px] text-muted">{d.pane === "overlay" ? "on chart" : "own pane"}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
