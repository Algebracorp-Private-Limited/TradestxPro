"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { InstrumentSearch, type SearchResult } from "./instrument-search";
import { IndexPicker } from "./index-picker";

type Item = { id: number; exchange: string; symbol: string; name: string; hasDerivatives: boolean };
type List = { id: number; name: string; items: Item[] };

async function call(url: string, method = "GET", body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

type Q = { ltp: number; changePct: number | null; volume: number | null };
type Quotes = { broker: string | null; error?: string; quotes: Record<string, Q>; eod: Record<string, { close: number; changePct: number | null; volume: number | null; date: string }> };
const fmt = (v: number | undefined | null) => (v === undefined || v === null ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtVol = (v: number) => (v >= 1e7 ? (v / 1e7).toFixed(2) + " Cr" : v >= 1e5 ? (v / 1e5).toFixed(2) + " L" : v.toLocaleString("en-IN"));

export function WatchlistManager() {
  const [lists, setLists] = useState<List[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [indexPick, setIndexPick] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [quotes, setQuotes] = useState<Quotes | null>(null);
  const qTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const apply = useCallback((d: { watchlists: List[] }) => {
    setLists(d.watchlists);
    setActiveId((cur) => (d.watchlists.some((l) => l.id === cur) ? cur : (d.watchlists[0]?.id ?? null)));
  }, []);
  const load = useCallback(() => call("/api/watchlists").then(apply), [apply]);

  useEffect(() => {
    call("/api/watchlists").then(apply).catch((e) => setError(e.message));
  }, [apply]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const active = lists?.find((l) => l.id === activeId) ?? null;
  const itemsKey = active ? `${active.id}:${active.items.map((i) => i.id).join(",")}` : "";

  // Live quotes (from the connected broker) with end-of-day fallback; polls while live.
  useEffect(() => {
    if (!active || !active.items.length) return;
    let alive = true;
    const id = active.id;
    const tick = async () => {
      try {
        const d = await call(`/api/watchlists/${id}/quotes`);
        if (!alive) return;
        setQuotes(d);
        if (d.broker) qTimer.current = setTimeout(tick, 20_000);
      } catch {}
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(qTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  if (lists === null) return <p className="text-sm text-muted">{error ?? "Loading watchlists…"}</p>;

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Watchlists" className="flex flex-wrap gap-1.5">
          {lists.map((l) => (
            <button
              key={l.id}
              role="tab"
              aria-selected={l.id === activeId}
              onClick={() => { setActiveId(l.id); setRenaming(null); setAdding(false); setSel(new Set()); setNotice(null); }}
              className={`rounded-lg px-3 py-1.5 text-sm ${l.id === activeId ? "bg-white text-slate-950" : "border border-line text-soft hover:bg-white/5"}`}
            >
              {l.name} <span className="opacity-60">{l.items.length}</span>
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = newName.trim();
            if (!name) return;
            run(async () => {
              const d = await call("/api/watchlists", "POST", { name });
              setActiveId(d.id);
              setNewName("");
            });
          }}
          className="flex gap-1.5"
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={40}
            placeholder={lists.length ? "New list name" : "Name your first watchlist"}
            aria-label="New watchlist name"
            className="w-44 rounded-lg border border-line bg-ink px-3 py-1.5 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />
          <button className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-white/5">Create</button>
        </form>
      </div>

      {!active ? (
        <div className="rounded-2xl border border-dashed border-line p-8 text-center">
          <p className="font-medium">No watchlists yet</p>
          <p className="mt-1 text-sm text-muted">Create one above, or add symbols from any instrument page.</p>
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-line bg-panel">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            {renaming !== null ? (
              <form
                className="flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    await call(`/api/watchlists/${active.id}`, "PATCH", { name: renaming });
                    setRenaming(null);
                  });
                }}
              >
                <input value={renaming} onChange={(e) => setRenaming(e.target.value)} maxLength={40} autoFocus aria-label="Watchlist name"
                  className="rounded-lg border border-line bg-ink px-3 py-1.5 text-sm focus:border-accent focus:outline-none" />
                <button className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-slate-950">Save</button>
                <button type="button" onClick={() => setRenaming(null)} className="rounded-lg px-3 py-1.5 text-sm text-muted">Cancel</button>
              </form>
            ) : (
              <h2 className="font-semibold">{active.name}</h2>
            )}
            <div className="flex gap-1.5">
              <button onClick={() => setAdding((a) => !a)} className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-slate-200">
                {adding ? "Done" : "＋ Add symbol"}
              </button>
              <button onClick={() => setIndexPick(true)} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-white/5">＋ Add index stocks</button>
              <button onClick={() => setRenaming(active.name)} className="rounded-lg border border-line px-3 py-1.5 text-sm text-soft hover:bg-white/5">Rename</button>
              <button
                onClick={() => {
                  if (confirm(`Delete watchlist “${active.name}”?`)) run(() => call(`/api/watchlists/${active.id}`, "DELETE"));
                }}
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-rose-300 hover:bg-down/10"
              >
                Delete
              </button>
            </div>
          </div>

          {adding && (
            <div className="border-b border-line bg-ink/40 p-4">
              <InstrumentSearch
                autoFocus
                limit={8}
                placeholder="Search a symbol to add"
                onPick={(r: SearchResult) => run(() => call(`/api/watchlists/${active.id}/items`, "POST", { instrumentId: r.id }))}
              />
            </div>
          )}

          {notice && <p role="status" className="border-b border-line bg-up/10 px-4 py-2 text-sm text-emerald-200">{notice}</p>}
          {active.items.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-xs">
              <span className="text-muted">{quotes?.broker ? <span className="text-up">● Live · {quotes.broker}</span> : "End-of-day prices · connect a broker for live"}</span>
              {quotes?.error && <span className="text-gold">{quotes.error}</span>}
              <span className="ml-auto flex gap-2">
                {sel.size > 0 && (
                  <button
                    onClick={() => run(async () => { await call(`/api/watchlists/${active.id}/items/remove`, "POST", { instrumentIds: [...sel] }); setSel(new Set()); })}
                    className="rounded-md bg-down/15 px-2.5 py-1 font-medium text-rose-300 hover:bg-down/25"
                  >
                    🗑 Remove selected ({sel.size})
                  </button>
                )}
                <button
                  onClick={() => { if (confirm(`Remove all ${active.items.length} symbols from “${active.name}”?`)) run(() => call(`/api/watchlists/${active.id}/items/remove`, "POST", { all: true })); }}
                  className="rounded-md px-2.5 py-1 text-muted hover:bg-white/5 hover:text-rose-300"
                >
                  Clear list
                </button>
              </span>
            </div>
          )}
          {active.items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">This list is empty. Use “Add symbol” to start tracking.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th scope="col" className="w-8 pl-4">
                      <input type="checkbox" aria-label="Select all" checked={sel.size === active.items.length} onChange={(e) => setSel(e.target.checked ? new Set(active.items.map((i) => i.id)) : new Set())} className="accent-sky-400" />
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">Symbol</th>
                    <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Name</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">LTP</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Chg %</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Volume</th>
                    <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {active.items.map((i) => {
                    const lq = quotes?.quotes?.[String(i.id)];
                    const eq = quotes?.eod?.[i.symbol];
                    const ltp = lq?.ltp ?? eq?.close;
                    const pct = lq ? lq.changePct : eq?.changePct;
                    const vol = lq?.volume ?? eq?.volume;
                    return (
                    <tr key={i.id} className={sel.has(i.id) ? "bg-accent/5" : ""}>
                      <td className="pl-4">
                        <input type="checkbox" aria-label={`Select ${i.symbol}`} checked={sel.has(i.id)} onChange={(e) => setSel((s0) => { const n = new Set(s0); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })} className="accent-sky-400" />
                      </td>
                      <td className="px-4 py-2.5">
                        <Link href={`/instrument/${i.exchange}/${encodeURIComponent(i.symbol)}`} className="font-mono font-semibold hover:text-accent">{i.symbol}</Link>
                        <span className="ml-2 text-[10px] text-muted">{i.exchange}</span>
                        {i.hasDerivatives && <span className="ml-1.5 rounded bg-accent/15 px-1 py-0.5 text-[10px] text-accent">F&amp;O</span>}
                      </td>
                      <td className="hidden max-w-xs truncate px-4 py-2.5 text-muted md:table-cell">{i.name}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{fmt(ltp)}{!lq && ltp !== undefined && <span className="ml-1 text-[9px] text-muted">EOD</span>}</td>
                      <td className={`px-4 py-2.5 text-right font-mono ${pct === undefined || pct === null ? "text-muted" : pct >= 0 ? "text-up" : "text-down"}`}>{pct === undefined || pct === null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}`}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-muted">{vol ? fmtVol(vol) : "—"}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => run(() => call(`/api/watchlists/${active.id}/items/${i.id}`, "DELETE"))}
                          aria-label={`Remove ${i.symbol}`}
                          title="Remove from watchlist"
                          className="rounded px-2 py-1 text-xs text-muted hover:bg-down/10 hover:text-rose-300"
                        >
                          ✕ Remove
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {indexPick && active && (
        <IndexPicker
          title="Add all stocks of an index"
          mode="single"
          onlyConstituents
          onClose={() => setIndexPick(false)}
          onPick={(ix) => {
            setIndexPick(false);
            setNotice(`Adding ${ix.name} constituents…`);
            run(async () => {
              const d = await call(`/api/watchlists/${active.id}/items/bulk`, "POST", { index: ix.key });
              setNotice(`Added ${d.added} stocks from ${ix.name}${d.skipped ? ` (${d.skipped} were already in the list)` : ""}.`);
            }).then(() => setNotice((n) => (n?.startsWith("Adding") ? null : n)));
          }}
        />
      )}
    </div>
  );
}
