"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PriceChart, type ActiveIndicator, type ChartStyle } from "./chart/price-chart";
import { useBars } from "./chart/use-bars";
import { INDICATORS, INDICATOR_BY_ID, defaultParams } from "@/lib/ta/catalog";

export type IndexRow = { key: string; name: string; lastDate: string | null; close: number | null; changePct: number | null; pe: number | null; pb: number | null; divYield: number | null };

const PRIORITY = ["NIFTY 50", "NIFTY BANK", "NIFTY NEXT 50", "NIFTY 100", "NIFTY 200", "NIFTY 500", "INDIA VIX", "NIFTY FINANCIAL SERVICES", "NIFTY MIDCAP 100", "NIFTY SMALLCAP 100", "NIFTY IT", "NIFTY AUTO", "NIFTY PHARMA", "NIFTY FMCG", "NIFTY METAL", "NIFTY REALTY", "NIFTY ENERGY", "NIFTY PSU BANK"];
const n2 = (v: number | null, d = 2) => (v === null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));

function IndicatorSelect({ value, onChange, label }: { value: string; onChange: (id: string) => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-line bg-ink px-2 py-1.5 text-xs text-soft">
        <option value="">None</option>
        {INDICATORS.filter((d) => d.id !== "vwap").map((d) => (
          <option key={d.id} value={d.id}>{d.short} — {d.name}</option>
        ))}
      </select>
    </label>
  );
}

export function IndexChart({ indices }: { indices: IndexRow[] }) {
  const sorted = useMemo(() => {
    const rank = (k: string) => (PRIORITY.includes(k) ? PRIORITY.indexOf(k) : 999);
    return [...indices].sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
  }, [indices]);
  const [key, setKey] = useState(sorted[0]?.key ?? "NIFTY 50");
  const [tf, setTf] = useState("1D");
  const [style, setStyle] = useState<ChartStyle>("line");
  const [ind1, setInd1] = useState("ema");
  const [ind2, setInd2] = useState("rsi");
  const data = useBars(`NSEIDX:${key}`, tf);
  const row = indices.find((i) => i.key === key);

  const active: ActiveIndicator[] = useMemo(
    () => [ind1, ind2].filter(Boolean).map((id, i) => ({ uid: `${i}-${id}`, id, params: defaultParams(INDICATOR_BY_ID[id]) })),
    [ind1, ind2],
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem("txp.marketIndex");
      if (saved && indices.some((i) => i.key === saved)) Promise.resolve().then(() => setKey(saved));
    } catch {}
  }, [indices]);

  return (
    <section aria-labelledby="index-chart" className="overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3">
        <h2 id="index-chart" className="sr-only">Index chart</h2>
        <label className="sr-only" htmlFor="index-select">Index</label>
        <select
          id="index-select"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            try { localStorage.setItem("txp.marketIndex", e.target.value); } catch {}
          }}
          className="max-w-[260px] rounded-lg border border-line bg-ink px-3 py-2 text-sm font-semibold"
        >
          {sorted.map((i) => (
            <option key={i.key} value={i.key}>{i.name}</option>
          ))}
        </select>
        {(() => {
          // Header follows the chart's latest bar (live today when a broker is connected).
          const b = data.bars;
          const lastC = b.length ? b[b.length - 1].c : row?.close ?? null;
          const prevC = b.length > 1 ? b[b.length - 2].c : null;
          const pct = lastC !== null && prevC ? ((lastC - prevC) / prevC) * 100 : row?.changePct ?? null;
          return lastC !== null ? (
            <div className="flex items-baseline gap-2 font-mono">
              <span className="text-xl font-semibold">{n2(lastC)}</span>
              <span className={`text-sm ${(pct ?? 0) >= 0 ? "text-up" : "text-down"}`}>{(pct ?? 0) >= 0 ? "+" : ""}{n2(pct)}%</span>
              {!data.delayed && <span className="rounded-full bg-up/15 px-1.5 py-0.5 font-sans text-[10px] text-up">Live</span>}
            </div>
          ) : null;
        })()}
        {row && (
          <dl className="flex gap-3 text-xs text-muted">
            <div><dt className="inline">P/E </dt><dd className="inline text-soft">{n2(row.pe)}</dd></div>
            <div><dt className="inline">P/B </dt><dd className="inline text-soft">{n2(row.pb)}</dd></div>
            <div><dt className="inline">Div </dt><dd className="inline text-soft">{n2(row.divYield)}%</dd></div>
          </dl>
        )}
        <Link href={`/charts?symbol=${encodeURIComponent("NSEIDX:" + key)}`} className="ml-auto rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-white/5">
          Open in Advanced Chart →
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2">
        <div role="group" aria-label="Timeframe" className="flex rounded-md border border-line p-0.5">
          {["1D", "1W", "1M"].map((t) => (
            <button key={t} onClick={() => setTf(t)} aria-pressed={tf === t} className={`rounded px-2.5 py-1 text-xs ${tf === t ? "bg-white text-slate-950" : "text-soft"}`}>{t}</button>
          ))}
        </div>
        <div role="group" aria-label="Chart type" className="flex rounded-md border border-line p-0.5">
          {(["line", "area", "candles"] as const).map((s) => (
            <button key={s} onClick={() => setStyle(s)} aria-pressed={style === s} className={`rounded px-2.5 py-1 text-xs capitalize ${style === s ? "bg-white text-slate-950" : "text-soft"}`}>{s}</button>
          ))}
        </div>
        <IndicatorSelect label="Indicator 1" value={ind1} onChange={setInd1} />
        <IndicatorSelect label="Indicator 2" value={ind2} onChange={setInd2} />
      </div>

      <div className="relative h-[440px]">
        {data.status === "ready" && data.bars.length > 0 ? (
          <PriceChart bars={data.bars} style={style} indicators={active} tf={tf} className="h-full" />
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted">
            {data.status === "error" ? data.error : data.status === "ready" ? "No history for this index yet." : "Loading chart…"}
          </div>
        )}
      </div>
      <p className="border-t border-line px-4 py-2 text-[11px] text-muted">
        {data.delayed ?? "Live"} data · source: {data.source || "—"}{row?.lastDate ? ` · last session ${row.lastDate}` : ""}. Scroll to zoom, drag to pan, double-click to reset.
      </p>
    </section>
  );
}

export function IndicesTable({ indices }: { indices: IndexRow[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"name" | "chg">("chg");
  const rows = useMemo(() => {
    const t = q.trim().toUpperCase();
    const r = indices.filter((i) => !t || i.key.includes(t));
    return sort === "chg" ? r.sort((a, b) => (b.changePct ?? -1e9) - (a.changePct ?? -1e9)) : r.sort((a, b) => a.key.localeCompare(b.key));
  }, [indices, q, sort]);
  return (
    <section aria-labelledby="all-indices" className="overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 id="all-indices" className="text-sm font-medium text-soft">All NSE indices ({indices.length})</h2>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter indices" className="w-40 rounded-md border border-line bg-ink px-2.5 py-1.5 text-xs" />
          <select value={sort} onChange={(e) => setSort(e.target.value as "name" | "chg")} aria-label="Sort" className="rounded-md border border-line bg-ink px-2 py-1.5 text-xs text-soft">
            <option value="chg">Sort: change %</option>
            <option value="name">Sort: name</option>
          </select>
        </div>
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-panel text-left text-xs text-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Index</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Close</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Chg %</th>
              <th scope="col" className="hidden px-4 py-2 text-right font-medium sm:table-cell">P/E</th>
              <th scope="col" className="hidden px-4 py-2 text-right font-medium sm:table-cell">P/B</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.key} className="hover:bg-white/[0.03]">
                <td className="px-4 py-2">
                  <Link href={`/charts?symbol=${encodeURIComponent("NSEIDX:" + r.key)}`} className="hover:text-accent">{r.name}</Link>
                </td>
                <td className="px-4 py-2 text-right font-mono">{n2(r.close)}</td>
                <td className={`px-4 py-2 text-right font-mono ${(r.changePct ?? 0) >= 0 ? "text-up" : "text-down"}`}>{n2(r.changePct)}</td>
                <td className="hidden px-4 py-2 text-right font-mono text-muted sm:table-cell">{n2(r.pe)}</td>
                <td className="hidden px-4 py-2 text-right font-mono text-muted sm:table-cell">{n2(r.pb)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
