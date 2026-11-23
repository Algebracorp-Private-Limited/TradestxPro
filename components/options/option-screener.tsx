"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Info } from "./info";

type Filters = {
  kind?: "all" | "index" | "stock"; opt?: "all" | "CE" | "PE"; expiry?: "near" | "next" | "all"; moneyness?: "all" | "itm" | "atm" | "otm";
  buildup?: "all" | "long" | "short" | "cover" | "unwind"; underlying?: string; minContracts?: number; minOiLots?: number;
  minPremium?: number; maxPremium?: number; minChgPct?: number; maxChgPct?: number; minOiChgPct?: number; minIv?: number; maxIv?: number;
};
type Sort = "contracts" | "oi" | "oiChg" | "oiChgPct" | "chgPct" | "iv" | "turnover";
type Row = {
  underlying: string; kind: "index" | "stock"; expiry: string; strike: number; opt: "CE" | "PE"; close: number; chgPct: number | null; spot: number | null;
  moneyness: string | null; oiLots: number; oiChgLots: number; oiChgPct: number | null; contracts: number; turnover: number; iv: number | null; buildup: string | null; lot: number;
};

const PRESETS: { id: string; name: string; filters: Filters; sort: Sort; dir?: "asc" | "desc"; help: string }[] = [
  { id: "active", name: "Most active contracts", filters: { expiry: "near" }, sort: "contracts", help: "Highest number of contracts traded in the nearest expiry." },
  { id: "active-ce", name: "Most active calls", filters: { opt: "CE", expiry: "near" }, sort: "contracts", help: "Call options with the most contracts traded." },
  { id: "active-pe", name: "Most active puts", filters: { opt: "PE", expiry: "near" }, sort: "contracts", help: "Put options with the most contracts traded." },
  { id: "long", name: "Long build-up", filters: { buildup: "long", minContracts: 500 }, sort: "oiChg", help: "Premium up and open interest up: fresh buying." },
  { id: "short", name: "Short build-up", filters: { buildup: "short", minContracts: 500 }, sort: "oiChg", help: "Premium down and open interest up: fresh writing (selling)." },
  { id: "cover", name: "Short covering", filters: { buildup: "cover", minContracts: 500 }, sort: "chgPct", help: "Premium up and open interest down: sellers closing positions." },
  { id: "unwind", name: "Long unwinding", filters: { buildup: "unwind", minContracts: 500 }, sort: "oiChg", dir: "asc", help: "Premium down and open interest down: buyers exiting." },
  { id: "oi-add", name: "Highest OI addition", filters: { expiry: "near" }, sort: "oiChg", help: "Strikes where the most new positions were opened. Big call OI often marks resistance, big put OI support." },
  { id: "gainers", name: "Top premium gainers", filters: { minContracts: 1000, minPremium: 2 }, sort: "chgPct", help: "Largest % rise in option price among liquid contracts." },
  { id: "high-iv", name: "High implied volatility", filters: { minContracts: 500, moneyness: "atm" }, sort: "iv", help: "At-the-money options priced for the biggest moves." },
  { id: "cheap-otm", name: "Liquid OTM under ₹20", filters: { moneyness: "otm", maxPremium: 20, minContracts: 2000, expiry: "near" }, sort: "contracts", help: "Low-premium out-of-the-money contracts with high activity." },
];

const f2 = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const n0 = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("en-IN"));
const cr = (v: number) => (v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)} L` : `₹${Math.round(v).toLocaleString("en-IN")}`);
const tone = (v: number | null) => (v === null ? "text-muted" : v > 0 ? "text-up" : v < 0 ? "text-down" : "text-soft");
const BU: Record<string, string> = { "Long build-up": "text-up", "Short covering": "text-up", "Short build-up": "text-down", "Long unwinding": "text-down" };

const COLS: { k: Sort | null; label: string; info?: string }[] = [
  { k: null, label: "Contract" },
  { k: null, label: "Price" },
  { k: "chgPct", label: "% Chg" },
  { k: "contracts", label: "Contracts", info: "Number of contracts traded in the session." },
  { k: "oi", label: "OI (lots)", info: "Open interest in lots at the close." },
  { k: "oiChg", label: "OI chg (lots)", info: "Change in open interest versus the previous session." },
  { k: "oiChgPct", label: "OI chg %" },
  { k: "iv", label: "IV %", info: "Implied volatility from the closing price (Black-Scholes, 6.5% rate)." },
  { k: "turnover", label: "Premium traded", info: "Contracts × lot size × price." },
  { k: null, label: "Signal", info: "Price and OI together: long build-up (↑↑), short build-up (↓↑), short covering (↑↓), long unwinding (↓↓)." },
];

export function OptionScreener() {
  const [preset, setPreset] = useState(PRESETS[0].id);
  const [filters, setFilters] = useState<Filters>(PRESETS[0].filters);
  const [sort, setSort] = useState<Sort>(PRESETS[0].sort);
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [showForm, setShowForm] = useState(false);
  const [st, setSt] = useState<{ status: "loading" | "ready" | "error"; rows: Row[]; total: number; asOf: string | null; error?: string }>({ status: "loading", rows: [], total: 0, asOf: null });

  const run = useCallback(async (f: Filters, s: Sort, d: "asc" | "desc") => {
    setSt((x) => ({ ...x, status: "loading" }));
    try {
      const r = await fetch("/api/options/screener", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters: f, sort: s, dir: d, limit: 300 }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setSt({ status: "ready", rows: j.rows, total: j.total, asOf: j.asOf });
    } catch (e) {
      setSt((x) => ({ ...x, status: "error", error: (e as Error).message || "Option screener failed." }));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => run(filters, sort, dir), 200);
    return () => clearTimeout(t);
  }, [filters, sort, dir, run]);

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPreset(id);
    setFilters(p.filters);
    setSort(p.sort);
    setDir(p.dir ?? "desc");
  };
  const set = (patch: Partial<Filters>) => {
    setPreset("");
    setFilters((f) => ({ ...f, ...patch }));
  };
  const numIn = (k: keyof Filters, label: string, placeholder = "") => (
    <label className="text-xs text-muted">
      {label}
      <input
        type="number" inputMode="decimal" placeholder={placeholder}
        value={(filters[k] as number | undefined) ?? ""}
        onChange={(e) => set({ [k]: e.target.value === "" ? undefined : Number(e.target.value) } as Partial<Filters>)}
        className="mt-1 block w-full rounded-lg border border-line bg-ink px-2 py-1.5 text-sm text-white"
      />
    </label>
  );
  const sel = <K extends keyof Filters>(k: K, label: string, opts: [string, string][]) => (
    <label className="text-xs text-muted">
      {label}
      <select value={(filters[k] as string | undefined) ?? "all"} onChange={(e) => set({ [k]: e.target.value } as Partial<Filters>)} className="mt-1 block w-full rounded-lg border border-line bg-ink px-2 py-1.5 text-sm text-white">
        {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
  const p = PRESETS.find((x) => x.id === preset);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel px-3 py-2.5">
        <label className="flex items-center gap-2 text-xs text-muted">
          Preset
          <select value={preset} onChange={(e) => applyPreset(e.target.value)} className="rounded-lg border border-line bg-ink px-2 py-1.5 text-sm text-soft">
            <option value="">Custom</option>
            {PRESETS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <input
          value={filters.underlying ?? ""}
          onChange={(e) => set({ underlying: e.target.value.toUpperCase() || undefined })}
          placeholder="Underlying (e.g. NIFTY)" aria-label="Underlying"
          className="w-44 rounded-lg border border-line bg-ink px-2 py-1.5 text-sm"
        />
        <button onClick={() => setShowForm((s) => !s)} className="ml-auto rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-slate-200">
          {showForm ? "Hide filters" : "＋ Build / edit filters"}
        </button>
      </div>
      {p && <p className="text-xs text-muted">{p.help}</p>}

      {showForm && (
        <section aria-label="Filters" className="grid gap-3 rounded-2xl border border-line bg-panel p-4 sm:grid-cols-3 lg:grid-cols-6">
          {sel("kind", "Underlying type", [["all", "All"], ["index", "Index options"], ["stock", "Stock options"]])}
          {sel("opt", "Call / Put", [["all", "Both"], ["CE", "Calls"], ["PE", "Puts"]])}
          {sel("expiry", "Expiry", [["all", "All expiries"], ["near", "Nearest"], ["next", "Next"]])}
          {sel("moneyness", "Moneyness", [["all", "All"], ["itm", "In the money"], ["atm", "At the money"], ["otm", "Out of the money"]])}
          {sel("buildup", "OI signal", [["all", "Any"], ["long", "Long build-up"], ["short", "Short build-up"], ["cover", "Short covering"], ["unwind", "Long unwinding"]])}
          {numIn("minContracts", "Min contracts")}
          {numIn("minOiLots", "Min OI (lots)")}
          {numIn("minPremium", "Min price ₹")}
          {numIn("maxPremium", "Max price ₹")}
          {numIn("minChgPct", "Min % change")}
          {numIn("maxChgPct", "Max % change")}
          {numIn("minOiChgPct", "Min OI change %")}
          {numIn("minIv", "Min IV %")}
          {numIn("maxIv", "Max IV %")}
          <div className="flex items-end">
            <button onClick={() => { setPreset(""); setFilters({}); }} className="text-xs text-accent hover:underline">Clear all filters</button>
          </div>
        </section>
      )}

      <section className="min-w-0 overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="font-semibold">{p?.name ?? "Custom option screen"}</h2>
          <p className="text-xs text-muted">
            {st.status === "loading" ? "Scanning…" : `${st.total.toLocaleString("en-IN")} contracts`}
            {st.total > st.rows.length && ` · showing top ${st.rows.length}`}
            {st.asOf ? ` · NSE F&O end of day, session ${st.asOf}` : ""}
          </p>
        </div>
        {st.status === "error" ? (
          <p role="alert" className="p-6 text-sm text-rose-300">{st.error}</p>
        ) : st.status === "ready" && !st.asOf ? (
          <p className="p-8 text-center text-sm text-muted">Option contract data loads with the nightly NSE F&amp;O update. Check back after 8:15 pm IST.</p>
        ) : st.status === "ready" && !st.rows.length ? (
          <p className="p-8 text-center text-sm text-muted">No contracts match these filters. Try loosening one.</p>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="sticky top-0 z-10 bg-panel text-xs text-muted">
                <tr>
                  {COLS.map((c) => (
                    <th key={c.label} className={`px-3 py-2 font-medium ${c.label === "Contract" ? "text-left" : "text-right"}`}>
                      {c.k ? (
                        <button onClick={() => { setPreset(""); if (sort === c.k) setDir((d) => (d === "desc" ? "asc" : "desc")); else { setSort(c.k!); setDir("desc"); } }} className="hover:text-white">
                          {c.label}{sort === c.k ? (dir === "desc" ? " ↓" : " ↑") : ""}
                        </button>
                      ) : c.label}
                      {c.info && <Info term={c.label} text={c.info} place="bottom" />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={st.status === "loading" ? "opacity-50" : ""}>
                {st.rows.map((r) => (
                  <tr key={`${r.underlying}${r.expiry}${r.strike}${r.opt}`} className="border-t border-line hover:bg-white/[0.03]">
                    <td className="px-3 py-2">
                      <Link href={`/options?u=${encodeURIComponent(r.underlying)}&expiry=${r.expiry}`} className="font-medium hover:text-accent">
                        {r.underlying} {r.strike} <span className={r.opt === "CE" ? "text-up" : "text-down"}>{r.opt}</span>
                      </Link>
                      <span className="block text-[11px] text-muted">{r.expiry} · {r.moneyness ?? "—"}{r.spot ? ` · spot ${f2(r.spot)}` : ""} · lot {r.lot}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{f2(r.close)}</td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums ${tone(r.chgPct)}`}>{r.chgPct === null ? "—" : `${r.chgPct > 0 ? "+" : ""}${r.chgPct.toFixed(1)}%`}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{n0(r.contracts)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{n0(r.oiLots)}</td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums ${tone(r.oiChgLots)}`}>{r.oiChgLots > 0 ? "+" : ""}{n0(r.oiChgLots)}</td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums ${tone(r.oiChgPct)}`}>{r.oiChgPct === null ? "—" : `${r.oiChgPct > 0 ? "+" : ""}${r.oiChgPct.toFixed(0)}%`}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{r.iv === null ? "—" : r.iv.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{cr(r.turnover)}</td>
                    <td className={`px-3 py-2 text-right text-xs ${r.buildup ? BU[r.buildup] : "text-muted"}`}>{r.buildup ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-[11px] text-muted">Research tool only — not investment advice. Live chain and greeks are on the Options page.</p>
    </div>
  );
}
