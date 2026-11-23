"use client";

import { useEffect, useMemo, useState } from "react";

export type CatalogItem = { key: string; name: string; group: "NSE" | "BSE" | "MCX"; category?: string; available: boolean; note?: string; constituents: boolean };
type Group = { group: "NSE" | "BSE" | "MCX"; items: CatalogItem[] };

let cached: Group[] | null = null;
export async function loadCatalog(): Promise<Group[]> {
  if (cached) return cached;
  const r = await fetch("/api/markets/index-catalog");
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "Could not load indices.");
  cached = d.groups;
  return d.groups;
}

const GROUP_LABEL = { NSE: "NSE indices", BSE: "BSE indices", MCX: "Commodities — MCX" };

/**
 * Searchable index list grouped by exchange.
 * multi: checkboxes (selected keys). single: click to pick; `onlyConstituents` limits to indices with member lists.
 */
export function IndexPicker({
  title,
  mode,
  selected = [],
  onToggle,
  onPick,
  onlyConstituents = false,
  onClose,
}: {
  title: string;
  mode: "multi" | "single";
  selected?: string[];
  onToggle?: (key: string, on: boolean) => void;
  onPick?: (item: CatalogItem) => void;
  onlyConstituents?: boolean;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<Group[] | null>(cached);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ NSE: true, BSE: true, MCX: true });

  useEffect(() => {
    if (!cached) loadCatalog().then(setGroups).catch((e) => setErr(e.message));
  }, []);

  const shown = useMemo(() => {
    const t = q.trim().toUpperCase();
    return (groups ?? []).map((g) => ({
      ...g,
      items: g.items.filter((i) => (!onlyConstituents || i.constituents) && (!t || i.key.includes(t) || i.name.toUpperCase().includes(t))),
    }));
  }, [groups, q, onlyConstituents]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded px-2 py-1 text-muted hover:bg-white/5">✕</button>
        </div>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onClose()} placeholder="Search indices" aria-label="Search indices"
          className="border-b border-line bg-ink px-4 py-2.5 text-sm focus:outline-none" />
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {err && <p role="alert" className="p-4 text-sm text-rose-300">{err}</p>}
          {!groups && !err && <p className="p-4 text-sm text-muted">Loading…</p>}
          {shown.map((g) => g.items.length > 0 && (
            <section key={g.group}>
              <button onClick={() => setOpen((o) => ({ ...o, [g.group]: !o[g.group] }))} aria-expanded={open[g.group]}
                className="sticky top-0 flex w-full items-center justify-between bg-panel px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {GROUP_LABEL[g.group]} <span>{open[g.group] ? "▾" : "▸"} {g.items.length}</span>
              </button>
              {open[g.group] && g.items.map((i, n) => {
                const on = selected.includes(i.key);
                const head = i.category && i.category !== g.items[n - 1]?.category
                  ? <p key={"h" + i.category} className="px-4 pb-1 pt-2.5 text-[11px] font-medium text-accent">{i.category}</p>
                  : null;
                const disabled = !i.available;
                const row = mode === "multi" ? (
                  <label key={i.key} className={`flex items-center justify-between gap-3 px-4 py-1.5 text-sm ${disabled ? "text-muted/60" : "cursor-pointer hover:bg-white/[0.04]"}`}>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onToggle?.(i.key, e.target.checked)} className="h-4 w-4 accent-sky-400" />
                      <span className="truncate">{i.name}</span>
                    </span>
                    {i.note && <span className="shrink-0 text-[10px] text-muted">{i.note}</span>}
                  </label>
                ) : (
                  <button key={i.key} disabled={disabled} onClick={() => onPick?.(i)} className="flex w-full items-center justify-between px-4 py-1.5 text-left text-sm hover:bg-white/[0.04] disabled:text-muted/60">
                    <span className="truncate">{i.name}</span>
                    {i.note && <span className="text-[10px] text-muted">{i.note}</span>}
                  </button>
                );
                return head ? [head, row] : row;
              })}
            </section>
          ))}
        </div>
        {mode === "multi" && (
          <div className="border-t border-line px-4 py-3 text-right">
            <button onClick={onClose} className="rounded-lg bg-white px-4 py-1.5 text-sm font-semibold text-slate-950 hover:bg-slate-200">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
