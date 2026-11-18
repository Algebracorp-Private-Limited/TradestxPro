"use client";

import { useEffect, useRef, useState } from "react";

type Sym = { symbol: string; name: string; kind: "index" | "stock" | "crypto"; exchange: string };

const KIND_LABEL = { index: "Index", stock: "NSE", crypto: "Crypto" };

export function SymbolSearch({ symbol, name, onPick }: { symbol: string; name: string; onPick: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Sym[]>([]);
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const req = useRef(0);

  useEffect(() => {
    if (!open) return;
    const id = ++req.current;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/charts/symbols?q=${encodeURIComponent(q)}`);
        const d = await r.json();
        if (id === req.current && r.ok) {
          setResults(d.results);
          setHi(0);
        }
      } catch {}
    }, 150);
    return () => clearTimeout(t);
  }, [q, open]);

  const pick = (s: Sym) => {
    onPick(s.symbol);
    setOpen(false);
    setQ("");
  };

  const short = symbol.split(":").slice(1).join(":");

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen(true);
          setTimeout(() => input.current?.focus(), 0);
        }}
        className="flex max-w-[240px] items-center gap-2 rounded-lg border border-line bg-ink px-3 py-1.5 text-left hover:border-white/25"
        aria-haspopup="dialog"
        title={name}
      >
        <span className="text-muted" aria-hidden>⌕</span>
        <span className="truncate font-mono text-sm font-semibold">{short}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div role="dialog" aria-label="Search symbol" className="absolute left-0 top-full z-50 mt-1 w-[min(92vw,420px)] overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "ArrowDown") setHi((h) => Math.min(results.length - 1, h + 1));
                if (e.key === "ArrowUp") setHi((h) => Math.max(0, h - 1));
                if (e.key === "Enter" && results[hi]) pick(results[hi]);
              }}
              placeholder="Symbol, index or crypto — e.g. RELIANCE, NIFTY BANK, BTC"
              aria-label="Search symbol"
              className="w-full border-b border-line bg-ink px-3 py-2.5 text-sm focus:outline-none"
            />
            <ul className="max-h-[360px] overflow-auto py-1" role="listbox">
              {results.map((r, i) => (
                <li key={r.symbol} role="option" aria-selected={i === hi}>
                  <button
                    onMouseEnter={() => setHi(i)}
                    onClick={() => pick(r)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${i === hi ? "bg-white/[0.06]" : ""}`}
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-sm">{r.symbol.split(":").slice(1).join(":")}</span>
                      <span className="block truncate text-xs text-muted">{r.name}</span>
                    </span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${r.kind === "crypto" ? "bg-gold/15 text-gold" : r.kind === "index" ? "bg-accent/15 text-accent" : "bg-white/5 text-muted"}`}>
                      {KIND_LABEL[r.kind]}
                    </span>
                  </button>
                </li>
              ))}
              {results.length === 0 && <li className="px-3 py-3 text-sm text-muted">No matches.</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
