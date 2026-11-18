"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PRESETS, type Filters, type SortKey } from "@/lib/screener";

type Result = {
  symbol: string; name: string; close: number; changePct: number; volume: number; relVol: number | null; rsi: number | null;
  adx: number | null; atrPct: number | null; supertrend: number | null; ret20: number | null; ret60: number | null;
  dist52h: number | null; trend: "up" | "down" | "mixed" | null; fno: boolean;
};

const f2 = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fVol = (v: number) => (v >= 1e7 ? (v / 1e7).toFixed(2) + " Cr" : v >= 1e5 ? (v / 1e5).toFixed(2) + " L" : v.toLocaleString("en-IN"));
const tone = (v: number | null | undefined) => (v === null || v === undefined ? "" : v >= 0 ? "text-up" : "text-down");

function Num({ label, k, f, set, step = 1, placeholder }: { label: string; k: keyof Filters; f: Filters; set: (f: Filters) => void; step?: number; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted">
      {label}
      <input
        type="number"
        step={step}
        placeholder={placeholder ?? "any"}
        value={(f[k] as number | undefined) ?? ""}
        onChange={(e) => set({ ...f, [k]: e.target.value === "" ? undefined : Number(e.target.value) })}
        className="w-full rounded-md border border-line bg-ink px-2 py-1.5 font-mono text-xs text-soft"
      />
    </label>
  );
}

function Check({ label, k, f, set }: { label: string; k: keyof Filters; f: Filters; set: (f: Filters) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-soft">
      <input type="checkbox" checked={Boolean(f[k])} onChange={(e) => set({ ...f, [k]: e.target.checked || undefined })} className="accent-sky-400" />
      {label}
    </label>
  );
}

const COLS: { key: SortKey; label: string; right?: boolean; hideSm?: boolean }[] = [
  { key: "symbol", label: "Symbol" },
  { key: "close", label: "Close", right: true },
  { key: "change_pct", label: "Chg %", right: true },
  { key: "volume", label: "Volume", right: true, hideSm: true },
  { key: "rel_vol", label: "Rel vol", right: true },
  { key: "rsi14", label: "RSI", right: true },
  { key: "adx14", label: "ADX", right: true, hideSm: true },
  { key: "ret20", label: "20D %", right: true, hideSm: true },
  { key: "dist52h", label: "vs 52W H", right: true, hideSm: true },
];

export function Screener() {
  const [filters, setFilters] = useState<Filters>(PRESETS[0].filters);
  const [preset, setPreset] = useState<string>(PRESETS[0].id);
  const [sort, setSort] = useState<SortKey>(PRESETS[0].sort);
  const [dir, setDir] = useState<"asc" | "desc">(PRESETS[0].dir);
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; results: Result[]; total: number; asOf: string | null; error?: string }>({ status: "loading", results: [], total: 0, asOf: null });

  const run = useCallback(async (f: Filters, s: SortKey, d: "asc" | "desc") => {
    setState((x) => ({ ...x, status: "loading" }));
    try {
      const res = await fetch("/api/screeners/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters: f, sort: s, dir: d, limit: 200 }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setState({ status: "ready", results: data.results, total: data.total, asOf: data.asOf });
    } catch (e) {
      setState((x) => ({ ...x, status: "error", error: (e as Error).message || "Screener failed." }));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => run(filters, sort, dir), 250);
    return () => clearTimeout(t);
  }, [filters, sort, dir, run]);

  const set = (f: Filters) => {
    setFilters(f);
    setPreset("");
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <section aria-labelledby="presets" className="rounded-2xl border border-line bg-panel p-3">
          <h2 id="presets" className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-muted">Presets</h2>
          <div className="flex flex-wrap gap-1.5 xl:flex-col">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setFilters(p.filters);
                  setSort(p.sort);
                  setDir(p.dir);
                  setPreset(p.id);
                }}
                aria-pressed={preset === p.id}
                title={p.description}
                className={`rounded-lg px-3 py-2 text-left text-sm ${preset === p.id ? "bg-white text-slate-950" : "border border-line text-soft hover:bg-white/5"}`}
              >
                <span className="block font-medium">{p.name}</span>
                <span className={`hidden text-[11px] xl:block ${preset === p.id ? "text-slate-600" : "text-muted"}`}>{p.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="filters" className="space-y-3 rounded-2xl border border-line bg-panel p-3">
          <div className="flex items-center justify-between px-1">
            <h2 id="filters" className="text-xs font-medium uppercase tracking-wider text-muted">Filters</h2>
            <button onClick={() => set({})} className="text-xs text-accent hover:underline">Clear all</button>
          </div>
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            Universe
            <select value={filters.universe ?? "all"} onChange={(e) => set({ ...filters, universe: e.target.value === "fno" ? "fno" : undefined })} className="rounded-md border border-line bg-ink px-2 py-1.5 text-xs text-soft">
              <option value="all">All NSE equities</option>
              <option value="fno">F&amp;O stocks only</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Price min ₹" k="priceMin" f={filters} set={set} />
            <Num label="Price max ₹" k="priceMax" f={filters} set={set} />
            <Num label="Change % min" k="changeMin" f={filters} set={set} step={0.5} />
            <Num label="Change % max" k="changeMax" f={filters} set={set} step={0.5} />
            <Num label="Volume min" k="volumeMin" f={filters} set={set} step={10000} />
            <Num label="Rel. volume min ×" k="relVolMin" f={filters} set={set} step={0.1} />
            <Num label="RSI min" k="rsiMin" f={filters} set={set} />
            <Num label="RSI max" k="rsiMax" f={filters} set={set} />
            <Num label="ADX min" k="adxMin" f={filters} set={set} />
            <Num label="20-day % min" k="ret20Min" f={filters} set={set} />
            <Num label="Within % of 52W high" k="near52High" f={filters} set={set} step={0.5} />
            <Num label="Within % of 52W low" k="near52Low" f={filters} set={set} step={0.5} />
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
            <Check label="Above EMA 20" k="aboveEma20" f={filters} set={set} />
            <Check label="Above EMA 50" k="aboveEma50" f={filters} set={set} />
            <Check label="Above EMA 200" k="aboveEma200" f={filters} set={set} />
            <Check label="Below EMA 200" k="belowEma200" f={filters} set={set} />
            <Check label="EMA stack ▲" k="emaStack" f={filters} set={set} />
            <Check label="Below EMA 50" k="belowEma50" f={filters} set={set} />
            <Check label="MACD bull cross" k="macdBullCross" f={filters} set={set} />
            <Check label="MACD bear cross" k="macdBearCross" f={filters} set={set} />
          </div>
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            Supertrend (10, 3)
            <select value={filters.supertrend ?? ""} onChange={(e) => set({ ...filters, supertrend: (e.target.value || undefined) as Filters["supertrend"] })} className="rounded-md border border-line bg-ink px-2 py-1.5 text-xs text-soft">
              <option value="">Any</option>
              <option value="up">Uptrend</option>
              <option value="down">Downtrend</option>
            </select>
          </label>
        </section>
      </aside>

      <section aria-labelledby="results" className="min-w-0 overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 id="results" className="text-sm font-medium">
            {state.status === "loading" ? "Scanning…" : `${state.total.toLocaleString("en-IN")} matches`}
            {state.total > state.results.length && <span className="text-muted"> · showing top {state.results.length}</span>}
          </h2>
          <span className="text-[11px] text-muted">End-of-day data{state.asOf ? ` · session ${state.asOf}` : ""}</span>
        </div>
        {state.status === "error" ? (
          <p role="alert" className="p-6 text-sm text-rose-300">{state.error}</p>
        ) : state.status === "ready" && state.results.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">No stocks match these filters. Try loosening one.</p>
        ) : (
          <div className={`overflow-x-auto ${state.status === "loading" ? "opacity-60" : ""}`}>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} scope="col" aria-sort={sort === c.key ? (dir === "asc" ? "ascending" : "descending") : "none"} className={`px-3 py-2 font-medium ${c.right ? "text-right" : "text-left"} ${c.hideSm ? "hidden md:table-cell" : ""}`}>
                      <button
                        onClick={() => {
                          if (sort === c.key) setDir(dir === "asc" ? "desc" : "asc");
                          else {
                            setSort(c.key);
                            setDir(c.key === "symbol" ? "asc" : "desc");
                          }
                        }}
                        className="hover:text-white"
                      >
                        {c.label}{sort === c.key ? (dir === "asc" ? " ↑" : " ↓") : ""}
                      </button>
                    </th>
                  ))}
                  <th scope="col" className="hidden px-3 py-2 text-left font-medium lg:table-cell">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {state.results.map((r) => (
                  <tr key={r.symbol} className="hover:bg-white/[0.03]">
                    <td className="px-3 py-2">
                      <Link href={`/charts?symbol=NSE:${encodeURIComponent(r.symbol)}`} className="font-mono font-semibold hover:text-accent">{r.symbol}</Link>
                      {r.fno && <span className="ml-1.5 rounded bg-accent/15 px-1 py-0.5 text-[10px] text-accent">F&amp;O</span>}
                      <span className="block max-w-[200px] truncate text-[11px] text-muted">{r.name}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{f2(r.close)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${tone(r.changePct)}`}>{f2(r.changePct)}</td>
                    <td className="hidden px-3 py-2 text-right font-mono text-muted md:table-cell">{fVol(r.volume)}</td>
                    <td className="px-3 py-2 text-right font-mono">{f2(r.relVol)}×</td>
                    <td className={`px-3 py-2 text-right font-mono ${r.rsi !== null && r.rsi >= 70 ? "text-down" : r.rsi !== null && r.rsi <= 30 ? "text-up" : ""}`}>{f2(r.rsi, 1)}</td>
                    <td className="hidden px-3 py-2 text-right font-mono md:table-cell">{f2(r.adx, 1)}</td>
                    <td className={`hidden px-3 py-2 text-right font-mono md:table-cell ${tone(r.ret20)}`}>{f2(r.ret20, 1)}</td>
                    <td className="hidden px-3 py-2 text-right font-mono text-muted md:table-cell">{f2(r.dist52h, 1)}%</td>
                    <td className="hidden px-3 py-2 lg:table-cell">
                      {r.trend && (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ${r.trend === "up" ? "bg-up/15 text-up" : r.trend === "down" ? "bg-down/15 text-down" : "bg-white/5 text-muted"}`}>
                          {r.trend === "up" ? "Uptrend" : r.trend === "down" ? "Below 200 EMA" : "Mixed"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-line px-4 py-2 text-[11px] text-muted">
          Indicators computed from NSE end-of-day data: RSI 14, EMA 20/50/200, MACD 12/26/9, ADX 14, Supertrend 10/3. Results are research screens, not recommendations.
        </p>
      </section>
    </div>
  );
}
