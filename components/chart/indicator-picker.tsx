"use client";

import { useMemo, useState } from "react";
import { INDICATORS, INDICATOR_BY_ID, type IndicatorDef } from "@/lib/ta/catalog";
import type { ActiveIndicator } from "./price-chart";

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

export function IndicatorChips({ items, onChange }: { items: ActiveIndicator[]; onChange: (items: ActiveIndicator[]) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((it) => {
        const def = INDICATOR_BY_ID[it.id];
        if (!def) return null;
        const label = def.params.length ? `${def.short} ${def.params.map((p) => it.params[p.key]).join(",")}` : def.short;
        return (
          <div key={it.uid} className="relative">
            <span className="flex items-center rounded-md border border-line bg-ink text-xs">
              <button onClick={() => setEditing(editing === it.uid ? null : it.uid)} className="px-2 py-1 font-mono hover:text-white" aria-label={`Edit ${def.name}`} disabled={!def.params.length}>
                {label}
              </button>
              <button onClick={() => onChange(items.filter((x) => x.uid !== it.uid))} aria-label={`Remove ${def.name}`} className="border-l border-line px-1.5 py-1 text-muted hover:text-rose-300">✕</button>
            </span>
            {editing === it.uid && (
              <div className="absolute left-0 top-full z-40 mt-1 w-56 space-y-2 rounded-xl border border-line bg-panel p-3 shadow-2xl">
                <p className="text-xs font-medium">{def.name}</p>
                {def.params.map((p) => (
                  <label key={p.key} className="flex items-center justify-between gap-2 text-xs text-muted">
                    {p.label}
                    <input
                      type="number"
                      min={p.min}
                      max={p.max}
                      step={p.step ?? 1}
                      value={it.params[p.key]}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v)) return;
                        const clamped = Math.min(p.max, Math.max(p.min, v));
                        onChange(items.map((x) => (x.uid === it.uid ? { ...x, params: { ...x.params, [p.key]: clamped } } : x)));
                      }}
                      className="w-20 rounded border border-line bg-ink px-2 py-1 text-right font-mono text-soft"
                    />
                  </label>
                ))}
                <button onClick={() => setEditing(null)} className="w-full rounded-md bg-white py-1 text-xs font-semibold text-slate-950">Done</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
