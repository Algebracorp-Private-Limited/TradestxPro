"use client";

import { whenVisible } from "@/lib/client/visible";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { IndexPicker } from "./index-picker";

type Quote = { ltp: number; change: number | null; changePct: number | null; high: number | null; low: number | null; time: string | null };
type Tile = { key: string; name: string; group: "NSE" | "BSE"; chartSymbol: string; live: Quote | null; eod: { close: number; changePct: number | null; date: string } | null };
type State = { tiles: Tile[]; broker: string | null; error?: string; custom: boolean };

const f2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function MarketOverview() {
  const [s, setS] = useState<State | null>(null);
  const [picker, setPicker] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const loadRef = useRef<() => void>(() => {});
  const load = useCallback(async () => {
    clearTimeout(timer.current);
    try {
      const r = await fetch("/api/markets/overview");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setS(d);
      setErr(null);
      // Poll while a broker is supplying live prices.
      if (d.broker) timer.current = setTimeout(() => whenVisible(() => loadRef.current()), 15_000);
    } catch (e) {
      setErr((e as Error).message || "Could not load market overview.");
    }
  }, []);

  useEffect(() => {
    loadRef.current = load;
    Promise.resolve().then(load);
    return () => clearTimeout(timer.current);
  }, [load]);

  const [pending, setPending] = useState<string[] | null>(null);
  const save = async (keys: string[]) => {
    setPending(keys);
    setS((x) => (x ? { ...x, tiles: x.tiles.filter((t) => keys.includes(t.key)) } : x));
    await fetch("/api/prefs/dashboard", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ indices: keys }) });
    await load();
    setPending(null);
  };
  const keys = pending ?? s?.tiles.map((t) => t.key) ?? [];

  return (
    <section aria-labelledby="overview">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="overview" className="text-sm font-medium text-soft">
          Market overview
          {s?.broker ? (
            <span className="ml-2 rounded-full bg-up/15 px-2 py-0.5 text-[10px] font-normal text-up">Live · {s.broker}</span>
          ) : s ? (
            <span className="ml-2 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-normal text-gold">End of day</span>
          ) : null}
        </h2>
        <div className="flex gap-2">
          {s?.custom && <button onClick={() => save([])} className="rounded-lg px-2.5 py-1 text-xs text-muted hover:bg-white/5 hover:text-white">Reset</button>}
          <button onClick={() => setPicker(true)} className="rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-white/5">＋ Add / remove indices</button>
        </div>
      </div>
      {err && <p role="alert" className="mb-2 text-xs text-rose-300">{err}</p>}
      {s?.error && <p className="mb-2 text-xs text-gold">{s.error}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
        {(s?.tiles ?? []).map((t) => {
          const price = t.live?.ltp ?? t.eod?.close ?? null;
          const pct = t.live ? t.live.changePct : t.eod?.changePct ?? null;
          const up = (pct ?? 0) >= 0;
          return (
            <div key={t.key} className="group relative rounded-xl border border-line bg-panel transition hover:border-white/20">
              <Link href={`/charts?symbol=${encodeURIComponent(t.chartSymbol)}`} className="block p-4">
                <p className="flex items-center justify-between gap-2 text-xs text-muted">
                  <span className="truncate">{t.name}</span>
                  <span className="text-[9px]">{t.group}</span>
                </p>
                <p className="mt-2 truncate font-mono text-lg tabular-nums 2xl:text-xl" title={f2(price)}>{f2(price)}</p>
                <p className={`mt-0.5 truncate whitespace-nowrap font-mono text-[11px] ${pct === null ? "text-muted" : up ? "text-up" : "text-down"}`}>
                  {pct === null
                    ? "—"
                    : t.live?.change !== null && t.live?.change !== undefined
                      ? `${up ? "+" : ""}${f2(t.live.change)} (${up ? "+" : ""}${pct.toFixed(2)}%)`
                      : `${up ? "+" : ""}${pct.toFixed(2)}%`}
                </p>
                <p className="mt-1 text-[10px] text-muted">
                  {t.live ? "Live" : t.eod ? `EOD ${t.eod.date}` : t.group === "BSE" ? "Connect a broker for BSE" : "No data"}
                </p>
              </Link>
              <button
                onClick={() => save(keys.filter((k) => k !== t.key))}
                aria-label={`Remove ${t.name} from dashboard`}
                className="absolute right-1.5 top-1.5 hidden rounded px-1.5 text-xs text-muted hover:bg-white/10 hover:text-rose-300 group-hover:block group-focus-within:block"
              >
                ✕
              </button>
            </div>
          );
        })}
        {!s && !err && Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[104px] animate-pulse rounded-xl border border-line bg-panel" />)}
      </div>
      {picker && (
        <IndexPicker
          title="Indices on your dashboard"
          mode="multi"
          selected={keys}
          onToggle={(k, on) => save(on ? [...keys, k] : keys.filter((x) => x !== k))}
          onClose={() => setPicker(false)}
        />
      )}
    </section>
  );
}
