"use client";

import { useEffect, useRef, useState } from "react";
import type { ChartApi, SyncGroup } from "@/lib/xchart-sdk";
import { Card, Empty, Loading, Notice } from "./ui";

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
type Level = { price: number; label: string; kind: string };
type Resp = {
  underlying: { symbol: string; source: string; notice: string | null; bars: Bar[] };
  premium: { symbol: string; name: string; source: string; notice: string | null; bars: Bar[] };
  analytics: { points: { t: number; iv: number | null; extrinsic: number | null }[]; matched: number; ivSolved: number; note: string } | null;
  levels: { underlying: Level[]; premium: Level[] }; lotSize: number | null; tf: string; tfs: string[]; notices: string[];
};
const COLOR: Record<string, string> = { strike: "#94a3b8", breakeven: "#f59e0b", range: "#38bdf8", stop: "#ef4444", entry: "#f59e0b", target: "#22c55e" };
const field = "mt-1 block rounded-md border border-line bg-ink px-2 py-1.5 text-sm text-white";

/** Four synchronised XChart panes: underlying, option premium, model IV, extrinsic value. */
function Panes({ d }: { d: Resp }) {
  const rU = useRef<HTMLDivElement>(null), rP = useRef<HTMLDivElement>(null), rI = useRef<HTMLDivElement>(null), rE = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let charts: ChartApi[] = [];
    let group: SyncGroup | null = null;
    import("@/lib/xchart-sdk").then(({ createChart, syncCharts }) => {
      if (disposed) return;
      const dark = !document.documentElement.classList.contains("light");
      const mk = (el: HTMLDivElement | null) => (el ? createChart(el, { theme: dark ? "dark" : "light", autoSize: true, crosshair: true, priceScale: { precision: 2 } }) : null);
      const cu = mk(rU.current), cp = mk(rP.current), ci = mk(rI.current), ce = mk(rE.current);
      const candles = (c: ChartApi | null, bars: Bar[], levels: Level[]) => {
        if (!c || !bars.length) return;
        const s = c.addCandlestickSeries({ upColor: "#22c55e", downColor: "#ef4444" });
        s.setData(bars.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v })));
        for (const l of levels) s.createPriceLine({ price: l.price, title: l.label.slice(0, 28), color: COLOR[l.kind] ?? "#94a3b8", lineStyle: l.kind === "range" ? "dashed" : "solid", axisLabelVisible: true });
      };
      candles(cu, d.underlying.bars, d.levels.underlying);
      candles(cp, d.premium.bars, d.levels.premium);
      const pts = d.analytics?.points ?? [];
      if (ci && pts.some((p) => p.iv !== null)) ci.addLineSeries({ color: "#c084fc", lineWidth: 2, title: "Model IV %" }).setData(pts.filter((p) => p.iv !== null).map((p) => ({ time: p.t, value: p.iv! })));
      if (ce && pts.some((p) => p.extrinsic !== null)) ce.addLineSeries({ color: "#38bdf8", lineWidth: 2, title: "Extrinsic ₹" }).setData(pts.filter((p) => p.extrinsic !== null).map((p) => ({ time: p.t, value: p.extrinsic! })));
      charts = [cu, cp, ci, ce].filter((c): c is ChartApi => c !== null);
      group = syncCharts(charts, { timeRange: true, crosshair: true });
    });
    return () => { disposed = true; group?.destroy(); for (const c of charts) c.remove(); };
  }, [d]);
  const hasPrem = d.premium.bars.length > 0;
  return (
    <div className="space-y-3">
      <Card title={`Underlying · ${d.underlying.symbol}`} right={<span className="text-[10px] text-muted">{d.underlying.source}</span>}>
        {d.underlying.bars.length ? <div ref={rU} className="h-[300px] w-full" role="img" aria-label="Underlying price chart" /> : <Empty>{d.underlying.notice ?? "No underlying bars for this timeframe."}</Empty>}
      </Card>
      <Card title={`Option premium · ${d.premium.name}`} right={<span className="text-[10px] text-muted">{d.premium.source}</span>}>
        {hasPrem ? <div ref={rP} className="h-[240px] w-full" role="img" aria-label="Option premium chart" /> : <Notice tone="warn">INSUFFICIENT DATA: {d.premium.notice}</Notice>}
      </Card>
      {hasPrem && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="Model IV (%)"><div ref={rI} className="h-[180px] w-full" role="img" aria-label="Implied volatility chart" /></Card>
          <Card title="Extrinsic (time) value (₹)"><div ref={rE} className="h-[180px] w-full" role="img" aria-label="Extrinsic value chart" /></Card>
        </div>
      )}
      {d.analytics && <p className="text-[11px] text-muted">{d.analytics.note} {d.analytics.matched} of {d.premium.bars.length} premium bars matched an underlying bar; IV solved for {d.analytics.ivSolved}.</p>}
    </div>
  );
}

export function Workspace({ initial }: { initial: { u?: string; expiry?: string; strike?: string; right?: string } }) {
  const [f, setF] = useState({ u: initial.u ?? "NIFTY", expiry: initial.expiry ?? "", strike: initial.strike ?? "", right: initial.right === "PE" ? "PE" : "CE", tf: "15m" });
  const [d, setD] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = (q: typeof f) => {
    if (!q.u || !q.expiry || !q.strike) return;
    setBusy(true);
    fetch(`/api/intelligence/workspace?${new URLSearchParams({ u: q.u.toUpperCase(), expiry: q.expiry, strike: q.strike, right: q.right, tf: q.tf })}`).then(async (r) => {
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Could not load the workspace"); setD(null); } else { setErr(null); setD(j); }
      setBusy(false);
    }, () => { setErr("Network error"); setBusy(false); });
  };
  useEffect(() => { if (initial.u && initial.expiry && initial.strike) Promise.resolve().then(() => load(f)); /* initial deep link only */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2 text-xs text-muted" onSubmit={(e) => { e.preventDefault(); load(f); }}>
        <label>Underlying<input required value={f.u} onChange={(e) => setF({ ...f, u: e.target.value })} className={`${field} w-28`} /></label>
        <label>Expiry<input required type="date" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} className={field} /></label>
        <label>Strike<input required type="number" step="any" value={f.strike} onChange={(e) => setF({ ...f, strike: e.target.value })} className={`${field} w-24`} /></label>
        <label>Right<select value={f.right} onChange={(e) => setF({ ...f, right: e.target.value })} className={field}><option>CE</option><option>PE</option></select></label>
        <label>Timeframe<select value={f.tf} onChange={(e) => { const n = { ...f, tf: e.target.value }; setF(n); if (d) load(n); }} className={field}>{["5m", "15m", "1h", "1D"].map((t) => <option key={t}>{t}</option>)}</select></label>
        <button disabled={busy} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-slate-950 disabled:opacity-50">{busy ? "Loading…" : "Open workspace"}</button>
      </form>
      {err && <Notice tone="error">{err}</Notice>}
      {busy && !d && <Loading />}
      {d && (
        <>
          {d.notices.map((n) => <Notice key={n} tone="warn">{n}</Notice>)}
          <Panes d={d} />
        </>
      )}
      {!d && !busy && !err && <Empty>Choose a contract to open the synchronised underlying and option charts. Premium history needs a connected broker (Dhan or ICICI Direct).</Empty>}
    </div>
  );
}
