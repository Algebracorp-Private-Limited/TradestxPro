"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadCatalog, type CatalogItem } from "./index-picker";

type Item = { id: number; exchange: string; symbol: string; name: string; hasDerivatives: boolean };
type List = { id: number; name: string; items: Item[] };
type Pick = { kind: "stock"; symbol: string; exchange: string } | { kind: "index"; key: string; group: "NSE" | "BSE" | "MCX" };

const INDEX_TO_UNDERLYING: Record<string, string> = { "NIFTY 50": "NIFTY", "NIFTY BANK": "BANKNIFTY", "NIFTY FINANCIAL SERVICES": "FINNIFTY", "NIFTY MIDCAP SELECT": "MIDCPNIFTY", "NIFTY NEXT 50": "NIFTYNXT50", SENSEX: "SENSEX", BANKEX: "BANKEX" };
const f2 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Where a picked scrip should go, given the page the user is on. */
function targetFor(p: Pick, path: string, search: URLSearchParams): string {
  const idxSymbol = (k: string, g: string) => `${g === "BSE" ? "BSEIDX" : "NSEIDX"}:${k}`;
  if (path.startsWith("/charts")) {
    const tf = search.get("tf");
    const sym = p.kind === "stock" ? `NSE:${p.symbol}` : idxSymbol(p.key, p.group);
    return `/charts?symbol=${encodeURIComponent(sym)}${tf ? `&tf=${tf}` : ""}`;
  }
  if (path.startsWith("/options")) {
    if (p.kind === "stock") return `/options?u=${encodeURIComponent(p.symbol)}`;
    const u = INDEX_TO_UNDERLYING[p.key];
    if (u) return `/options?u=${u}`;
    return `/charts?symbol=${encodeURIComponent(idxSymbol(p.key, p.group))}`;
  }
  if (path.startsWith("/derivatives")) {
    if (p.kind === "stock") return `/derivatives/${encodeURIComponent(p.symbol)}`;
    const u = INDEX_TO_UNDERLYING[p.key];
    return u ? `/derivatives/${u}` : `/charts?symbol=${encodeURIComponent(idxSymbol(p.key, p.group))}`;
  }
  return p.kind === "stock" ? `/instrument/${p.exchange}/${encodeURIComponent(p.symbol)}` : `/charts?symbol=${encodeURIComponent(idxSymbol(p.key, p.group))}`;
}

function currentSymbol(path: string, search: URLSearchParams): string | null {
  if (path.startsWith("/charts")) return search.get("symbol");
  if (path.startsWith("/options")) return search.get("u");
  const m = path.match(/^\/(?:instrument\/[A-Z]+|derivatives)\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function WatchTab({ onPick, current }: { onPick: (p: Pick) => void; current: string | null }) {
  const [lists, setLists] = useState<List[] | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [quotes, setQuotes] = useState<{ broker: string | null; quotes: Record<string, { ltp: number; changePct: number | null }>; eod: Record<string, { close: number; changePct: number | null }> } | null>(null);

  useEffect(() => {
    fetch("/api/watchlists").then((r) => r.json()).then((d) => {
      if (!d.ok) return;
      setLists(d.watchlists);
      let saved: number | null = null;
      try { saved = Number(localStorage.getItem("txp.panel.list")) || null; } catch {}
      setActive(d.watchlists.find((l: List) => l.id === saved)?.id ?? d.watchlists[0]?.id ?? null);
    }).catch(() => setLists([]));
  }, []);

  const list = lists?.find((l) => l.id === active) ?? null;
  useEffect(() => {
    if (!list || !list.items.length) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = () =>
      fetch(`/api/watchlists/${list.id}/quotes`).then((r) => r.json()).then((d) => {
        if (!alive) return;
        setQuotes(d);
        if (d.broker) t = setTimeout(tick, 20_000);
      }).catch(() => {});
    tick();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [list]);

  if (lists === null) return <p className="p-3 text-xs text-muted">Loading…</p>;
  if (!lists.length) return <p className="p-3 text-xs text-muted">No watchlists yet. Create one on the Watchlists page.</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-2 py-1.5">
        <select
          value={active ?? ""}
          onChange={(e) => {
            setActive(Number(e.target.value));
            setQuotes(null);
            try { localStorage.setItem("txp.panel.list", e.target.value); } catch {}
          }}
          aria-label="Watchlist"
          className="min-w-0 flex-1 rounded-md border border-line bg-ink px-2 py-1 text-xs"
        >
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.items.length})</option>)}
        </select>
        {quotes?.broker && <span className="text-[10px] text-up" title={`Live from ${quotes.broker}`}>● Live</span>}
      </div>
      <ul className="min-h-0 flex-1 overflow-auto">
        {list?.items.map((i) => {
          const q = quotes?.quotes?.[String(i.id)];
          const e = quotes?.eod?.[i.symbol];
          const px = q?.ltp ?? e?.close;
          const pct = q ? q.changePct : e?.changePct;
          const on = current?.toUpperCase().endsWith(i.symbol);
          return (
            <li key={i.id}>
              <button onClick={() => onPick({ kind: "stock", symbol: i.symbol, exchange: i.exchange })}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs ${on ? "bg-accent/15" : "hover:bg-white/[0.04]"}`}>
                <span className="min-w-0">
                  <span className="block truncate font-mono font-semibold">{i.symbol}</span>
                  <span className="block truncate text-[10px] text-muted">{i.name}</span>
                </span>
                <span className="shrink-0 text-right font-mono">
                  <span className="block">{f2(px)}</span>
                  <span className={`block text-[10px] ${pct === null || pct === undefined ? "text-muted" : pct >= 0 ? "text-up" : "text-down"}`}>
                    {pct === null || pct === undefined ? "" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {list && !list.items.length && <li className="p-3 text-xs text-muted">This list is empty.</li>}
      </ul>
    </div>
  );
}

function IndicesTab({ onPick, current }: { onPick: (p: Pick) => void; current: string | null }) {
  const [groups, setGroups] = useState<{ group: "NSE" | "BSE" | "MCX"; items: CatalogItem[] }[] | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, { symbol: string; name: string }[] | "loading">>({});

  useEffect(() => {
    loadCatalog().then(setGroups).catch(() => setGroups([]));
  }, []);

  const toggle = (key: string) => {
    setOpen((o) => (o === key ? null : key));
    if (!members[key]) {
      setMembers((m) => ({ ...m, [key]: "loading" }));
      fetch(`/api/markets/constituents?index=${encodeURIComponent(key)}`).then((r) => r.json()).then((d) => setMembers((m) => ({ ...m, [key]: d.ok ? d.constituents : [] })));
    }
  };

  const t = q.trim().toUpperCase();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter indices" aria-label="Filter indices" className="m-2 rounded-md border border-line bg-ink px-2 py-1 text-xs" />
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {(groups ?? []).map((g) => {
          const items = g.items.filter((i) => !t || i.key.includes(t) || i.name.toUpperCase().includes(t));
          if (!items.length) return null;
          return (
            <section key={g.group}>
              <p className="sticky top-0 bg-panel px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{g.group}</p>
              {items.map((i) => {
                const m = members[i.key];
                const on = current && (current.endsWith(":" + i.key) || current === INDEX_TO_UNDERLYING[i.key]);
                return (
                  <div key={i.key}>
                    <div className={`flex items-center ${on ? "bg-accent/15" : "hover:bg-white/[0.04]"}`}>
                      {i.constituents ? (
                        <button onClick={() => toggle(i.key)} aria-expanded={open === i.key} aria-label={`${open === i.key ? "Hide" : "Show"} ${i.name} stocks`} className="w-6 py-1.5 text-[10px] text-muted hover:text-white">
                          {open === i.key ? "▾" : "▸"}
                        </button>
                      ) : <span className="w-6" />}
                      <button
                        disabled={!i.available || g.group === "MCX"}
                        onClick={() => onPick({ kind: "index", key: i.key, group: g.group })}
                        onDoubleClick={() => i.constituents && toggle(i.key)}
                        className="min-w-0 flex-1 truncate py-1.5 pr-2 text-left text-xs disabled:text-muted/50"
                        title={i.note ?? i.name}
                      >
                        {i.name}
                      </button>
                    </div>
                    {open === i.key && (
                      <ul className="ml-3 border-l border-line">
                        {m === "loading" || !m ? <li className="px-3 py-1 text-[10px] text-muted">Loading…</li> : m.map((s) => (
                          <li key={s.symbol}>
                            <button onClick={() => onPick({ kind: "stock", symbol: s.symbol, exchange: "NSE" })} className="flex w-full justify-between gap-2 px-3 py-1 text-left text-[11px] hover:bg-white/[0.04]" title={s.name}>
                              <span className="font-mono">{s.symbol}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Right-hand market panel (watchlists + indices) shown on every terminal page. */
export function MarketPanel() {
  const path = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<"watch" | "indices">("watch");
  const [open, setOpen] = useState<boolean | null>(null);
  const [drawer, setDrawer] = useState(false);
  const firstPath = useRef(path);

  useEffect(() => {
    let v: string | null = null;
    try {
      v = localStorage.getItem("txp.panel.open");
      const t = localStorage.getItem("txp.panel.tab");
      if (t === "indices" || t === "watch") Promise.resolve().then(() => setTab(t));
    } catch {}
    // Collapsed by default on the Options page (it has its own lists); open elsewhere.
    Promise.resolve().then(() => setOpen(v === null ? !firstPath.current.startsWith("/options") : v === "1"));
  }, []);

  const setOpenSaved = (o: boolean) => {
    setOpen(o);
    try { localStorage.setItem("txp.panel.open", o ? "1" : "0"); } catch {}
  };
  const setTabSaved = (t: "watch" | "indices") => {
    setTab(t);
    try { localStorage.setItem("txp.panel.tab", t); } catch {}
  };

  const current = useMemo(() => currentSymbol(path, new URLSearchParams(search.toString())), [path, search]);
  const pick = useCallback((p: Pick) => {
    router.push(targetFor(p, path, new URLSearchParams(search.toString())));
    setDrawer(false);
  }, [router, path, search]);

  const body = (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Market panel" className="flex items-center border-b border-line">
        {([["watch", "Watchlist"], ["indices", "Indices"]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTabSaved(k)}
            className={`flex-1 border-b-2 py-2 text-xs font-semibold ${tab === k ? "border-accent text-white" : "border-transparent text-muted hover:text-white"}`}>
            {label}
          </button>
        ))}
        <button onClick={() => (drawer ? setDrawer(false) : setOpenSaved(false))} aria-label="Hide market panel" title="Hide panel" className="px-2 py-2 text-xs text-muted hover:text-white">⇥</button>
      </div>
      {tab === "watch" ? <WatchTab onPick={pick} current={current} /> : <IndicesTab onPick={pick} current={current} />}
    </div>
  );

  return (
    <>
      {open && (
        <aside aria-label="Market panel" className="sticky top-0 hidden h-[calc(100dvh-53px)] w-64 shrink-0 border-l border-line bg-panel xl:flex xl:flex-col">
          {body}
        </aside>
      )}
      {open === false && (
        <button onClick={() => setOpenSaved(true)} aria-label="Show market panel" title="Watchlist & indices"
          className="fixed bottom-24 right-0 z-30 hidden rounded-l-lg border border-r-0 border-line bg-panel px-1.5 py-3 text-xs text-soft shadow-lg [writing-mode:vertical-rl] hover:text-white xl:block">
          ☆ Watchlist
        </button>
      )}
      {/* Smaller screens: drawer */}
      <button onClick={() => setDrawer(true)} aria-label="Open watchlist and indices" className="fixed bottom-20 right-3 z-30 grid h-11 w-11 place-items-center rounded-full border border-line bg-panel text-lg shadow-xl xl:hidden">☆</button>
      {drawer && (
        <div className="fixed inset-0 z-50 xl:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside aria-label="Market panel" onClick={(e) => e.stopPropagation()} className="absolute inset-y-0 right-0 flex w-[85vw] max-w-sm flex-col border-l border-line bg-panel shadow-2xl">
            {body}
          </aside>
        </div>
      )}
    </>
  );
}
