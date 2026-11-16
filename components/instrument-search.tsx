"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

export type SearchResult = {
  id: number;
  exchange: "NSE" | "BSE";
  symbol: string;
  name: string;
  series: string | null;
  hasDerivatives: boolean;
};

type Props = {
  autoFocus?: boolean;
  placeholder?: string;
  /** When given, results become buttons calling this instead of links to the instrument page. */
  onPick?: (r: SearchResult) => void;
  limit?: number;
};

export function InstrumentSearch({ autoFocus, placeholder = "Search stocks by symbol, name or ISIN — e.g. RELIANCE", onPick, limit = 12 }: Props) {
  const [q, setQ] = useState("");
  const [exchange, setExchange] = useState<"" | "NSE" | "BSE">("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const reqId = useRef(0);
  const listId = useId();

  useEffect(() => {
    const term = q.trim();
    const id = ++reqId.current;
    if (!term) return;
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: term, limit: String(limit) });
        if (exchange) params.set("exchange", exchange);
        const res = await fetch(`/api/markets/instruments?${params}`);
        const data = await res.json();
        if (id !== reqId.current) return;
        if (!res.ok) throw new Error(data.error);
        setResults(data.results);
        setState("done");
      } catch {
        if (id === reqId.current) setState("error");
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, exchange, limit]);

  return (
    <div>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor={listId + "-q"}>Search instruments</label>
        <input
          id={listId + "-q"}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setState(e.target.value.trim() ? "loading" : "idle");
          }}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-line bg-ink px-3 py-2.5 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none"
        />
        <label className="sr-only" htmlFor={listId + "-ex"}>Exchange</label>
        <select
          id={listId + "-ex"}
          value={exchange}
          onChange={(e) => {
            setExchange(e.target.value as "" | "NSE" | "BSE");
            if (q.trim()) setState("loading");
          }}
          className="rounded-lg border border-line bg-ink px-2 py-2.5 text-sm text-soft focus:border-accent focus:outline-none"
        >
          <option value="">All</option>
          <option value="NSE">NSE</option>
          <option value="BSE">BSE</option>
        </select>
      </div>

      <div aria-live="polite" className="mt-2">
        {state === "loading" && <p className="px-1 py-2 text-sm text-muted">Searching…</p>}
        {state === "error" && <p className="px-1 py-2 text-sm text-rose-300">Search failed. Please try again.</p>}
        {state === "done" && results.length === 0 && <p className="px-1 py-2 text-sm text-muted">No instruments match “{q.trim()}”.</p>}
        {results.length > 0 && state === "done" && (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {results.map((r) => {
              const body = (
                <>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{r.symbol}</span>
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted">{r.exchange}</span>
                      {r.hasDerivatives && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">F&amp;O</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">{r.name}</span>
                  </span>
                  <span className="text-xs text-muted" aria-hidden>{onPick ? "＋" : "→"}</span>
                </>
              );
              const cls = "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-white/[0.04]";
              return (
                <li key={r.id}>
                  {onPick ? (
                    <button type="button" className={cls} onClick={() => onPick(r)}>{body}</button>
                  ) : (
                    <Link className={cls} href={`/instrument/${r.exchange}/${encodeURIComponent(r.symbol)}`}>{body}</Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
