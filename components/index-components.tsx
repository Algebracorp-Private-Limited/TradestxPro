"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { whenVisible } from "@/lib/client/visible";
import { loadCatalog, type CatalogItem } from "./index-picker";
import { Info } from "./options/info";

type Row = {
  symbol: string; name: string; industry: string | null; ltp: number | null; open: number | null; high: number | null; low: number | null;
  prevClose: number | null; change: number | null; changePct: number | null; volume: number | null; beta: number | null; corr: number | null; vsIndex: number | null; live: boolean;
};
type Data = {
  key: string; name: string; index: { ltp: number | null; change: number | null; changePct: number | null; live: boolean };
  rows: Row[]; broker: string | null; eodDate: string | null; notice?: string; breadth: { up: number; down: number; flat: number };
};
type SortKey = "symbol" | "ltp" | "open" | "high" | "low" | "change" | "changePct" | "volume" | "beta" | "corr" | "vsIndex";

const f2 = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const vol = (v: number | null) => {
  if (v === null || !Number.isFinite(v)) return "—";
  if (v >= 1e7) return (v / 1e7).toFixed(2) + " Cr";
  if (v >= 1e5) return (v / 1e5).toFixed(2) + " L";
  return v.toLocaleString("en-IN");
};
const tone = (v: number | null) => (v === null ? "text-muted" : v > 0 ? "text-up" : v < 0 ? "text-down" : "text-soft");
const sign = (v: number | null, d = 2) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}`);

const COLS: { k: SortKey; label: string; info?: string }[] = [
  { k: "symbol", label: "Stock" },
  { k: "ltp", label: "Price" },
  { k: "open", label: "Open" },
  { k: "high", label: "High" },
  { k: "low", label: "Low" },
  { k: "change", label: "Change" },
  { k: "changePct", label: "% Chg" },
  { k: "volume", label: "Volume", info: "Shares traded today (live) or in the last session." },
  { k: "beta", label: "Beta", info: "How much the stock moves for a 1% move in NIFTY 50, from the last year of daily closes. 1.2 = moves 20% more than the market; 0.8 = 20% less." },
  { k: "corr", label: "Correlation", info: "How closely the stock's daily moves follow NIFTY 50 over the last year: 1 = always together, 0 = unrelated." },
  { k: "vsIndex", label: "vs Index", info: "Stock % change minus the index % change today. Positive = outperforming the index." },
];

export function IndexComponents({ initial }: { initial: string }) {
  const router = useRouter();
  const [key, setKey] = useState(initial);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "changePct", dir: -1 });
  const [q, setQ] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    loadCatalog().then((g) => setCatalog(g.flatMap((x) => x.items).filter((i) => i.constituents))).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async (first: boolean) => {
      if (first) setLoading(true);
      try {
        const r = await fetch(`/api/markets/index-components?index=${encodeURIComponent(key)}`);
        const j = await r.json();
        if (!alive) return;
        if (!r.ok) throw new Error(j.error);
        setD(j);
        setErr(null);
        if (j.broker) timer.current = setTimeout(() => whenVisible(() => load(false)), 30_000);
      } catch (e) {
        if (alive) setErr((e as Error).message || "Could not load members.");
      } finally {
        if (alive) setLoading(false);
      }
    };
    load(true);
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, [key]);

  const pick = (k: string) => {
    setKey(k);
    router.replace(`/markets/indices?index=${encodeURIComponent(k)}`, { scroll: false });
  };

  const rows = useMemo(() => {
    const t = q.trim().toUpperCase();
    const list = (d?.rows ?? []).filter((r) => !t || r.symbol.includes(t) || r.name.toUpperCase().includes(t) || (r.industry ?? "").toUpperCase().includes(t));
    return [...list].sort((a, b) => {
      if (sort.k === "symbol") return a.symbol.localeCompare(b.symbol) * sort.dir;
      const x = a[sort.k], y = b[sort.k];
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * sort.dir;
    });
  }, [d, q, sort]);

  const nseItems = catalog.filter((c) => c.group === "NSE");
  const bseItems = catalog.filter((c) => c.group === "BSE");
  const total = d ? d.breadth.up + d.breadth.down + d.breadth.flat : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted">
          Index
          <select value={key} onChange={(e) => pick(e.target.value)} className="mt-1 block min-w-[240px] rounded-lg border border-line bg-panel px-3 py-2 text-sm text-white">
            {!catalog.length && <option value={key}>{key}</option>}
            {nseItems.length > 0 && <optgroup label="NSE">{nseItems.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</optgroup>}
            {bseItems.length > 0 && <optgroup label="BSE">{bseItems.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</optgroup>}
          </select>
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter stock or sector" aria-label="Filter members" className="rounded-lg border border-line bg-panel px-3 py-2 text-sm" />
        <span className={`ml-auto rounded-full px-2.5 py-1 text-[11px] ${d?.broker ? "bg-up/15 text-up" : "bg-gold/15 text-gold"}`}>
          {d ? (d.broker ? `Live · ${d.broker}` : `End of day${d.eodDate ? ` · ${d.eodDate}` : ""}`) : "…"}
        </span>
      </div>

      {d && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className={`rounded-xl border p-4 ${d.index.changePct === null ? "border-line bg-panel" : d.index.changePct >= 0 ? "border-up/40 bg-up/10" : "border-down/40 bg-down/10"}`}>
            <p className="truncate text-xs text-muted">{d.name}</p>
            <p className="mt-1 truncate font-mono text-lg">{f2(d.index.ltp)}</p>
            <p className={`font-mono text-xs ${tone(d.index.changePct)}`}>{d.index.change !== null ? `${sign(d.index.change)} ` : ""}({sign(d.index.changePct)}%)</p>
          </div>
          <div className="rounded-xl border border-line bg-panel p-4">
            <p className="text-xs text-muted">Members</p>
            <p className="mt-1 font-mono text-lg">{d.rows.length}</p>
            <p className="text-xs text-muted">{d.rows.filter((r) => r.live).length} live</p>
          </div>
          <div className="col-span-2 rounded-xl border border-line bg-panel p-4">
            <p className="text-xs text-muted">Breadth (advancing vs declining)</p>
            <p className="mt-1 font-mono text-sm"><span className="text-up">▲ {d.breadth.up}</span> · <span className="text-down">▼ {d.breadth.down}</span> · <span className="text-muted">{d.breadth.flat} flat</span></p>
            {total > 0 && (
              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/5">
                <span className="bg-up" style={{ width: `${(d.breadth.up / total) * 100}%` }} />
                <span className="bg-white/20" style={{ width: `${(d.breadth.flat / total) * 100}%` }} />
                <span className="bg-down" style={{ width: `${(d.breadth.down / total) * 100}%` }} />
              </div>
            )}
          </div>
        </div>
      )}

      {err && <p role="alert" className="text-sm text-rose-300">{err}</p>}
      {d?.notice && <p className="text-xs text-gold">{d.notice}</p>}

      <div className="max-h-[70vh] overflow-auto rounded-xl border border-line">
        <table className="w-full min-w-[960px] whitespace-nowrap text-sm">
          <thead className="sticky top-0 z-10 bg-panel text-xs text-muted">
            <tr>
              {COLS.map((c) => (
                <th key={c.k} className={`px-3 py-2 font-medium ${c.k === "symbol" ? "text-left" : "text-right"}`} aria-sort={sort.k === c.k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                  <button onClick={() => setSort((s) => ({ k: c.k, dir: s.k === c.k ? (s.dir === 1 ? -1 : 1) : c.k === "symbol" ? 1 : -1 }))} className="hover:text-white">
                    {c.label}{sort.k === c.k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                  </button>
                  {c.info && <Info term={c.label} text={c.info} place="bottom" />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !d && Array.from({ length: 10 }, (_, i) => (
              <tr key={i} className="border-t border-line"><td colSpan={COLS.length} className="px-3 py-2"><div className="h-4 animate-pulse rounded bg-white/5" /></td></tr>
            ))}
            {rows.map((r) => (
              <tr key={r.symbol} className="border-t border-line hover:bg-white/[0.03]">
                <td className="px-3 py-2">
                  <Link href={`/instrument/NSE/${encodeURIComponent(r.symbol)}`} className="font-mono font-medium hover:text-accent">{r.symbol}</Link>
                  <span className="block max-w-[220px] truncate text-[11px] text-muted" title={r.name}>{r.industry ?? r.name}</span>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{f2(r.ltp)}{r.live && <span className="ml-1 text-[9px] text-up">●</span>}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-soft">{f2(r.open)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-soft">{f2(r.high)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-soft">{f2(r.low)}</td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${tone(r.change)}`}>{sign(r.change)}</td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${tone(r.changePct)}`}>{r.changePct === null ? "—" : `${sign(r.changePct)}%`}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{vol(r.volume)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{r.beta === null ? "—" : r.beta.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{r.corr === null ? "—" : r.corr.toFixed(2)}</td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${tone(r.vsIndex)}`}>{r.vsIndex === null ? "—" : `${sign(r.vsIndex)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted">● live price. Beta and correlation are measured against NIFTY 50 using one year of daily closes. Research tool only — not investment advice.</p>
    </div>
  );
}
