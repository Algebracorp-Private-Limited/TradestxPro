"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChartApi, PriceLineApi, SeriesApi } from "@/lib/xchart-sdk";
import type { ChartSpec, Element } from "@/lib/intelligence/tradevision/spec";
import { Card, Empty, FreshnessBadge, KV, Loading, Notice, fmt, inr, type Prov } from "./ui";

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
type Annot = { summary: string; notes: { elementId: string; text: string }[]; levels: Element[]; rejected: string[]; source: string; model: string | null; fallbackReason: string | null };
type Resp = { symbol: string; name: string; bars: Bar[]; spec: ChartSpec | null; specIssues: { path: string; message: string }[]; annotation: Annot | null; setupStatus: string | null; notices: string[]; provenance: Prov; insufficient?: string[] };
type Scn = {
  status: string; missing?: string[]; strategy: { id: string; name: string; classification: string; risk: string }; expiry: string; spot: number; lots: number; lotSize: number; notices: string[];
  legs: { side: string; right: string; strike: number | null; expiry: string; ratio: number; premium: number }[] | null;
  curves: { dates: { label: string; date: string; points: { s: number; pnl: number }[] }[]; model: string };
  grid: { moves: number[]; ivShifts: number[]; values: number[][]; daysForward: number }; gridWeek: Scn["grid"];
  risk: { greeks: { delta: number; gamma: number; theta: number; vega: number }; stress: { rows: { name: string; move: number; ivShiftPp: number; days: number; pnl: number }[]; worst: { name: string; pnl: number } | null; notes: string[] }; flags: string[]; marginNote: string };
  disclaimer: string; provenance: Prov;
};

/** Layer groups the workspace can toggle. */
const LAYERS: { key: string; label: string; match: (e: Element) => boolean; color: string }[] = [
  { key: "sr", label: "Support / resistance", match: (e) => e.kind === "level" && (e.role === "support" || e.role === "resistance"), color: "#94a3b8" },
  { key: "zones", label: "Demand / supply zones", match: (e) => e.kind === "zone" && (e.role === "demand" || e.role === "supply"), color: "#22c55e" },
  { key: "range", label: "Volatility range", match: (e) => e.kind === "zone" && e.role === "expected-move", color: "#38bdf8" },
  { key: "plan", label: "Trade plan", match: (e) => e.id.startsWith("plan-"), color: "#f59e0b" },
  { key: "ai", label: "AI levels", match: (e) => e.source === "ai", color: "#c084fc" },
  { key: "last", label: "Last close", match: (e) => e.kind === "level" && e.role === "last-close", color: "#e2e8f0" },
];
const ROLE_COLOR: Record<string, string> = { support: "#22c55e", resistance: "#ef4444", stop: "#ef4444", target: "#22c55e", entry: "#f59e0b", demand: "#22c55e", supply: "#ef4444", "expected-move": "#38bdf8", "last-close": "#e2e8f0" };
const PREF_KEY = "txp.tradevision.layers";

function loadPrefs(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}"); } catch { return {}; }
}

function ChartView({ bars, elements, visible }: { bars: Bar[]; elements: Element[]; visible: Record<string, boolean> }) {
  const box = useRef<HTMLDivElement>(null);
  const ref = useRef<{ chart: ChartApi; candles: SeriesApi<"candlestick">; lines: PriceLineApi[] } | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    import("@/lib/xchart-sdk").then(({ createChart }) => {
      if (disposed || !box.current) return;
      const dark = !document.documentElement.classList.contains("light");
      const chart = createChart(box.current, { theme: dark ? "dark" : "light", autoSize: true, crosshair: true, priceScale: { precision: 2 } });
      const candles = chart.addCandlestickSeries({ upColor: "#22c55e", downColor: "#ef4444" });
      candles.setData(bars.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v })));
      ref.current = { chart, candles, lines: [] };
      setReady(true);
    });
    return () => { disposed = true; ref.current?.chart.remove(); ref.current = null; setReady(false); };
  }, [bars]);
  useEffect(() => {
    const r = ref.current;
    if (!ready || !r) return;
    for (const l of r.lines) r.candles.removePriceLine(l);
    r.lines = [];
    r.chart.clearDrawings();
    const shown = elements.filter((e) => LAYERS.some((L) => L.match(e) && visible[L.key] !== false));
    const lastT = bars.at(-1)?.t ?? 0;
    for (const e of shown) {
      const color = e.source === "ai" ? "#c084fc" : ROLE_COLOR["role" in e ? e.role : ""] ?? "#94a3b8";
      if (e.kind === "level") r.lines.push(r.candles.createPriceLine({ price: e.price, title: e.label.slice(0, 32), color, lineStyle: e.role === "support" || e.role === "resistance" ? "dashed" : "solid", axisLabelVisible: true }));
      else if (e.kind === "zone") r.chart.addDrawing({ type: "rectangle", points: [{ time: e.from, price: e.high }, { time: e.to ?? lastT, price: e.low }], style: { color, fillColor: color, fillOpacity: 0.12, lineWidth: 1, extendRight: e.to === null }, text: e.label.slice(0, 40), locked: true });
    }
    r.candles.setMarkers(shown.filter((e) => e.kind === "marker").map((e) => e.kind === "marker" ? { time: e.time, position: e.position, shape: e.shape, text: e.label.slice(0, 12) } : null!).filter(Boolean));
  }, [ready, elements, visible, bars]);
  return <div ref={box} className="h-[420px] w-full sm:h-[520px]" role="img" aria-label="Price chart with computed levels and zones" />;
}

function Heat({ g, label }: { g: Scn["grid"]; label: string }) {
  const max = Math.max(1, ...g.values.flat().map(Math.abs));
  return (
    <div className="overflow-x-auto">
      <p className="mb-1 text-[11px] text-muted">{label}: rows = underlying move, columns = IV shift (percentage points). ₹ P&L of the position.</p>
      <table className="w-full text-right font-mono text-[11px]">
        <thead><tr><th className="text-left text-muted">Move</th>{g.ivShifts.map((v) => <th key={v} className="px-1 text-muted">IV {v > 0 ? "+" : ""}{v}</th>)}</tr></thead>
        <tbody>{g.moves.map((m, i) => (
          <tr key={m}><td className="pr-2 text-left text-muted">{m > 0 ? "+" : ""}{m}%</td>
            {g.values[i].map((v, j) => <td key={j} className="px-1 py-0.5" style={{ background: v >= 0 ? `rgba(34,197,94,${0.08 + 0.45 * (v / max)})` : `rgba(239,68,68,${0.08 + 0.45 * (-v / max)})` }}>{fmt(v, 0)}</td>)}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function ScenarioLab({ initialU }: { initialU: string }) {
  const [u, setU] = useState(initialU);
  const [strategy, setStrategy] = useState("bull-call-spread");
  const [lots, setLots] = useState(1);
  const [d, setD] = useState<Scn | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opts, setOpts] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/intelligence/strategy/registry").then((r) => r.json()).then((j) => alive && j.ok && setOpts(j.strategies.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }))), () => {});
    return () => { alive = false; };
  }, []);
  const run = () => {
    setBusy(true);
    fetch(`/api/intelligence/tradevision/scenario?${new URLSearchParams({ u, strategy, lots: String(lots) })}`).then(async (r) => {
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Scenario failed"); setD(null); } else { setErr(null); setD(j); }
      setBusy(false);
    }, () => { setErr("Network error"); setBusy(false); });
  };
  const colors = ["#38bdf8", "#f59e0b", "#e2e8f0"];
  return (
    <Card title="Scenario lab (options and futures strategies)">
      <form className="flex flex-wrap items-end gap-2 text-xs" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <label className="text-muted">Underlying<input value={u} onChange={(e) => setU(e.target.value.toUpperCase())} className="mt-1 block w-28 rounded-md border border-line bg-ink px-2 py-1.5 text-sm text-white" /></label>
        <label className="text-muted">Strategy<select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="mt-1 block max-w-[16rem] rounded-md border border-line bg-ink px-2 py-1.5 text-sm text-soft">{(opts.length ? opts : [{ id: strategy, name: strategy }]).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label className="text-muted">Lots<input type="number" min={1} max={50} value={lots} onChange={(e) => setLots(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} className="mt-1 block w-16 rounded-md border border-line bg-ink px-2 py-1.5 text-sm text-white" /></label>
        <button className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-slate-950">Run scenarios</button>
      </form>
      {err && <div className="mt-2"><Notice tone="error">{err}</Notice></div>}
      {busy && <Loading label="Pricing scenarios…" />}
      {d && !busy && (d.status !== "OK" ? <div className="mt-2"><Notice tone="warn">Insufficient data: {d.missing?.join(", ")}</Notice></div> : (
        <div className="mt-3 space-y-4 text-xs">
          <div className="flex flex-wrap items-center gap-2"><b className="text-sm">{d.strategy.name}</b><span className="text-muted">{d.expiry} · spot {inr(d.spot)} · {d.lots} lot(s) of {d.lotSize} · {d.strategy.risk} risk</span><FreshnessBadge p={d.provenance} /></div>
          {d.notices.map((n) => <Notice key={n} tone="warn">{n}</Notice>)}
          {d.legs && <p className="font-mono text-[11px] text-muted">{d.legs.map((l) => `${l.side} ${l.ratio > 1 ? l.ratio + "× " : ""}${l.right}${l.strike ? " " + l.strike : ""} @ ${fmt(l.premium)}`).join(" · ")}</p>}
          <div>
            <div className="flex flex-wrap gap-3 text-[11px]">{d.curves.dates.map((c, i) => <span key={c.label} style={{ color: colors[i] }}>■ {c.label} ({c.date})</span>)}</div>
            <MultiPayoff curves={d.curves.dates.map((c) => c.points)} colors={colors} spot={d.spot} />
            <p className="text-[10px] text-muted">{d.curves.model}; P&L in ₹ for the whole position. {d.disclaimer}</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2"><Heat g={d.grid} label="Today" /><Heat g={d.gridWeek} label="In 7 days" /></div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-1 font-semibold">Stress tests</p>
              <table className="w-full text-left text-[11px]"><thead className="text-muted"><tr><th>Scenario</th><th>Move</th><th>IV</th><th>Days</th><th className="text-right">P&L</th></tr></thead>
                <tbody>{d.risk.stress.rows.map((r) => <tr key={r.name} className="border-t border-line"><td>{r.name}</td><td>{r.move}%</td><td>{r.ivShiftPp > 0 ? "+" : ""}{r.ivShiftPp}</td><td>{r.days}</td><td className={`text-right font-mono ${r.pnl >= 0 ? "text-up" : "text-down"}`}>{fmt(r.pnl, 0)}</td></tr>)}</tbody></table>
              {d.risk.stress.notes.map((n) => <p key={n} className="mt-1 text-[10px] text-muted">{n}</p>)}
            </div>
            <div className="space-y-2">
              <p className="font-semibold">Risk intelligence</p>
              <KV items={[["Net delta (units)", fmt(d.risk.greeks.delta)], ["Net gamma", fmt(d.risk.greeks.gamma, 4)], ["Theta (₹/day)", inr(d.risk.greeks.theta)], ["Vega (₹ per IV pp)", inr(d.risk.greeks.vega)], ["Worst stress result", d.risk.stress.worst ? `${d.risk.stress.worst.name}: ${inr(d.risk.stress.worst.pnl, 0)}` : "—"], ["Margin", d.risk.marginNote]]} />
              {d.risk.flags.length > 0 && <ul className="list-disc pl-4 text-gold">{d.risk.flags.map((f) => <li key={f}>{f}</li>)}</ul>}
            </div>
          </div>
        </div>
      ))}
    </Card>
  );
}

function MultiPayoff({ curves, colors, spot }: { curves: { s: number; pnl: number }[][]; colors: string[]; spot: number }) {
  const all = curves.flat();
  if (all.length < 2) return null;
  const W = 640, H = 200, P = 8;
  const x0 = Math.min(...all.map((p) => p.s)), x1 = Math.max(...all.map((p) => p.s)), y0 = Math.min(0, ...all.map((p) => p.pnl)), y1 = Math.max(0, ...all.map((p) => p.pnl));
  const X = (v: number) => P + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * P), Y = (v: number) => H - P - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * P);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Position P&L by underlying price at three dates">
      <line x1={P} x2={W - P} y1={Y(0)} y2={Y(0)} className="stroke-line" />
      <line x1={X(spot)} x2={X(spot)} y1={P} y2={H - P} className="stroke-accent" strokeDasharray="3 3" />
      {curves.map((c, i) => <polyline key={i} points={c.map((p) => `${X(p.s)},${Y(p.pnl)}`).join(" ")} fill="none" stroke={colors[i]} strokeWidth={1.6} />)}
      <text x={P} y={14} className="fill-muted text-[10px]">{inr(y1, 0)}</text>
      <text x={P} y={H - 10} className="fill-muted text-[10px]">{inr(y0, 0)}</text>
      <text x={W - P} y={H - 10} textAnchor="end" className="fill-muted text-[10px]">{fmt(x0, 0)} → {fmt(x1, 0)}</text>
    </svg>
  );
}

export function TradeVision({ initial }: { initial?: string }) {
  const [input, setInput] = useState(initial || "RELIANCE");
  const [symbol, setSymbol] = useState(initial || "RELIANCE");
  const [d, setD] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [annotating, setAnnotating] = useState(false);
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  useEffect(() => { Promise.resolve().then(() => setVisible(loadPrefs())); }, []);
  const toggle = (k: string) => setVisible((v) => {
    const n = { ...v, [k]: v[k] === false };
    try { localStorage.setItem(PREF_KEY, JSON.stringify(n)); } catch { /* storage unavailable: preference not kept */ }
    return n;
  });
  const fetchChart = useCallback((annotate: boolean) => fetch(`/api/intelligence/tradevision?${new URLSearchParams({ symbol, ...(annotate ? { annotate: "1" } : {}) })}`).then(async (r) => {
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Could not load the chart");
    return j as Resp;
  }), [symbol]);
  useEffect(() => {
    let alive = true;
    fetchChart(false).then((j) => { if (alive) { setD(j); setErr(null); setBusy(false); } }, (e) => { if (alive) { setErr(e.message); setD(null); setBusy(false); } });
    return () => { alive = false; };
  }, [fetchChart]);
  const elements = useMemo(() => [...(d?.spec?.elements ?? []), ...(d?.annotation?.levels ?? [])], [d]);
  const notesById = useMemo(() => new Map((d?.annotation?.notes ?? []).map((n) => [n.elementId, n.text])), [d]);
  const exportSpec = () => {
    if (!d?.spec) return;
    const blob = new Blob([JSON.stringify({ ...d.spec, elements }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${d.symbol}-tradevision-spec.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const v = input.trim().toUpperCase(); if (v && v !== symbol) { setBusy(true); setSymbol(v); } }}>
        <label className="text-xs text-muted">NSE symbol<input value={input} onChange={(e) => setInput(e.target.value)} className="mt-1 block w-36 rounded-md border border-line bg-ink px-2 py-1.5 text-sm text-white" aria-label="NSE symbol" /></label>
        <button className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-slate-950">Load chart</button>
        <button type="button" disabled={!d?.spec || annotating} onClick={() => { setAnnotating(true); fetchChart(true).then((j) => { setD(j); setAnnotating(false); }, (e) => { setErr(e.message); setAnnotating(false); }); }} className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-40">{annotating ? "Annotating…" : "AI annotate"}</button>
        <button type="button" disabled={!d?.spec} onClick={exportSpec} className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-40">Export spec (JSON)</button>
      </form>
      {err && <Notice tone="error">{err}</Notice>}
      {busy && <Loading label="Loading chart…" />}
      {d && !busy && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs"><b className="text-sm">{d.symbol}</b><span className="text-muted">{d.name}</span><FreshnessBadge p={d.provenance} />{d.setupStatus && <span className="text-muted">Equity setup: {d.setupStatus}</span>}</div>
          {d.notices.map((n) => <Notice key={n} tone="warn">{n}</Notice>)}
          {d.insufficient && <Notice tone="warn">Insufficient data: {d.insufficient.join(", ")}</Notice>}
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
            <Card title="TradeVision chart (daily)">{d.bars.length ? <ChartView bars={d.bars} elements={elements} visible={visible} /> : <Empty>No price history.</Empty>}</Card>
            <Card title="Layers">
              <div className="space-y-1 text-xs">
                {LAYERS.map((L) => {
                  const n = elements.filter(L.match).length;
                  return <label key={L.key} className="flex items-center gap-2"><input type="checkbox" checked={visible[L.key] !== false} onChange={() => toggle(L.key)} disabled={!n} /><span style={{ color: L.color }}>■</span>{L.label}<span className="ml-auto text-muted">{n}</span></label>;
                })}
              </div>
              <p className="mt-2 text-[10px] text-muted">Layer choices are remembered on this device.</p>
            </Card>
          </div>
          {d.annotation && (
            <Card title={d.annotation.source === "ai" ? `AI annotation · ${d.annotation.model}` : `Annotation (deterministic: ${d.annotation.fallbackReason ?? "AI unavailable"})`}>
              <p className="text-sm leading-6">{d.annotation.summary}</p>
              {d.annotation.rejected.length > 0 && <p className="mt-2 text-[11px] text-gold">Rejected AI output (failed validation or grounding): {d.annotation.rejected.join("; ")}</p>}
            </Card>
          )}
          <Card title="Elements and evidence">
            {!elements.length ? <Empty>No levels or zones could be computed.</Empty> : (
              <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-muted"><tr><th className="py-1">Element</th><th>Price</th><th>Source</th><th>Evidence</th></tr></thead>
                <tbody>{elements.filter((e) => e.kind === "level" || e.kind === "zone").map((e) => (
                  <tr key={e.id} className="border-t border-line align-top"><td className="py-1 pr-2">{e.label}</td>
                    <td className="pr-2 font-mono">{e.kind === "level" ? fmt(e.price) : e.kind === "zone" ? `${fmt(e.low)}–${fmt(e.high)}` : "—"}</td>
                    <td className="pr-2">{e.source === "ai" ? "AI (validated)" : "Engine"}</td>
                    <td className="text-muted">{e.evidence}{notesById.get(e.id) ? <span className="block text-soft">AI note: {notesById.get(e.id)}</span> : null}</td></tr>
                ))}</tbody></table></div>
            )}
            {d.spec?.notes.map((n) => <p key={n} className="mt-1 text-[11px] text-muted">{n}</p>)}
            {d.specIssues.length > 0 && <p className="mt-1 text-[11px] text-gold">{d.specIssues.length} engine element(s) failed validation and were not drawn.</p>}
          </Card>
        </>
      )}
      <ScenarioLab initialU="NIFTY" />
    </div>
  );
}
