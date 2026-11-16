"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { InstrumentSearch, type SearchResult } from "./instrument-search";
import { Dash } from "./feed-banner";

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

export function WatchlistManager() {
  const [lists, setLists] = useState<List[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

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
              onClick={() => { setActiveId(l.id); setRenaming(null); setAdding(false); }}
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

          {active.items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">This list is empty. Use “Add symbol” to start tracking.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">Symbol</th>
                    <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Name</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">LTP</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Chg %</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Volume</th>
                    <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {active.items.map((i) => (
                    <tr key={i.id}>
                      <td className="px-4 py-2.5">
                        <Link href={`/instrument/${i.exchange}/${encodeURIComponent(i.symbol)}`} className="font-mono font-semibold hover:text-accent">{i.symbol}</Link>
                        <span className="ml-2 text-[10px] text-muted">{i.exchange}</span>
                        {i.hasDerivatives && <span className="ml-1.5 rounded bg-accent/15 px-1 py-0.5 text-[10px] text-accent">F&amp;O</span>}
                      </td>
                      <td className="hidden max-w-xs truncate px-4 py-2.5 text-muted md:table-cell">{i.name}</td>
                      <td className="px-4 py-2.5 text-right"><Dash /></td>
                      <td className="px-4 py-2.5 text-right"><Dash /></td>
                      <td className="px-4 py-2.5 text-right"><Dash /></td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => run(() => call(`/api/watchlists/${active.id}/items/${i.id}`, "DELETE"))}
                          aria-label={`Remove ${i.symbol}`}
                          className="rounded px-2 py-1 text-muted hover:bg-white/5 hover:text-rose-300"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
