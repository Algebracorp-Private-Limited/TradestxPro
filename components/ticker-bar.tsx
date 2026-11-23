"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { whenVisible } from "@/lib/client/visible";

type Item = {
  key: string;
  name: string;
  chartSymbol: string;
  live: { ltp: number; change: number | null; changePct: number | null } | null;
  eod: { close: number; changePct: number | null; date: string } | null;
};

const SHORT: Record<string, string> = { "NIFTY 50": "NIFTY 50", SENSEX: "SENSEX", "NIFTY BANK": "BANK NIFTY", "INDIA VIX": "INDIA VIX" };
const f2 = (v: number) => v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Always-visible strip with NIFTY 50, SENSEX, BANK NIFTY and INDIA VIX. */
export function TickerBar() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [live, setLive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/markets/ticker");
        const d = await r.json();
        if (!alive || !r.ok) return;
        setItems(d.items);
        setLive(Boolean(d.broker));
        timer.current = setTimeout(() => whenVisible(load), d.broker ? 15_000 : 120_000);
      } catch {
        if (alive) timer.current = setTimeout(() => whenVisible(load), 60_000);
      }
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-line bg-panel/70 px-3 py-1.5 text-xs" aria-label="Market ticker">
      {(items ?? Object.keys(SHORT).map((k) => ({ key: k, name: k, chartSymbol: "", live: null, eod: null }))).map((t) => {
        const price = t.live?.ltp ?? t.eod?.close ?? null;
        const pct = t.live ? t.live.changePct : t.eod?.changePct ?? null;
        const ch = t.live?.change ?? null;
        const up = (pct ?? 0) >= 0;
        const tone = pct === null ? "text-muted" : up ? "text-up" : "text-down";
        return (
          <Link
            key={t.key}
            href={t.chartSymbol ? `/charts?symbol=${encodeURIComponent(t.chartSymbol)}` : "/markets"}
            className="flex shrink-0 items-baseline gap-2 rounded-md px-2.5 py-1 hover:bg-white/5"
          >
            <span className="font-medium text-soft">{SHORT[t.key] ?? t.key}</span>
            <span className="font-mono tabular-nums">{price === null ? "—" : f2(price)}</span>
            <span className={`font-mono tabular-nums ${tone}`}>
              {pct === null ? "" : `${up ? "▲" : "▼"} ${ch !== null ? `${f2(Math.abs(ch))} ` : ""}(${up ? "+" : ""}${pct.toFixed(2)}%)`}
            </span>
          </Link>
        );
      })}
      <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] ${live ? "bg-up/15 text-up" : "bg-gold/15 text-gold"}`}>
        {items ? (live ? "Live" : "End of day") : "…"}
      </span>
    </div>
  );
}
