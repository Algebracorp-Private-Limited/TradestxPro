"use client";

/**
 * XChart SDK v0.3.1 demo sections. Public SDK only; SYNTHETIC data (deterministic random walk),
 * never real market data. Each section shows working code and its limitations.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CandlestickData, ChartApi, DerivedKind, IndicatorApi, IndicatorDefinition, SeriesApi, XChartPlugin } from "@/lib/xchart-sdk";

type SDK = typeof import("@/lib/xchart-sdk");

function synthetic(n: number, start: number, step: number, seed = 7, base = 1000): CandlestickData[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let price = base;
  const out: CandlestickData[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = Math.max(1, open + (rnd() - 0.49) * base * 0.01);
    const high = Math.max(open, close) + rnd() * base * 0.004;
    const low = Math.min(open, close) - rnd() * base * 0.004;
    price = close;
    out[i] = { time: start + i * step, open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2), volume: Math.round(40_000 + rnd() * 160_000) };
  }
  return out;
}
const DAY = 86400;
const MIN = 60;
const DAILY_START = Date.UTC(2024, 0, 1) / 1000;
const INTRADAY_START = Date.UTC(2026, 2, 2, 3, 45) / 1000; // Monday 09:15 IST

const btn = "rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-white/5 disabled:opacity-40";
const sel = "rounded-lg border border-line bg-transparent px-2 py-1 text-xs";
const stat = "font-mono text-[11px] text-soft";

/** Creates charts for the lifetime of the component (browser only). */
function useCharts(count: number, setup: (sdk: SDK, charts: ChartApi[]) => void | (() => void)) {
  const boxes = useRef<(HTMLDivElement | null)[]>([]);
  const charts = useRef<ChartApi[]>([]);
  const sdk = useRef<SDK | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    let cleanup: void | (() => void);
    import("@/lib/xchart-sdk").then((m) => {
      if (disposed || boxes.current.slice(0, count).some((b) => !b)) return;
      sdk.current = m;
      charts.current = boxes.current.slice(0, count).map((b) => m.createChart(b!, { theme: "dark" }));
      cleanup = setup(m, charts.current);
      setReady(true);
    });
    return () => {
      disposed = true;
      cleanup?.();
      for (const c of charts.current) c.remove();
      charts.current = [];
    };
    // created once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ref = (i: number) => (el: HTMLDivElement | null) => {
    boxes.current[i] = el;
  };
  return { ref, charts, sdk, ready };
}

function Section({ id, title, children, code, limits }: { id: string; title: string; children: ReactNode; code: string; limits: string }) {
  return (
    <section id={id} className="space-y-2 rounded-2xl border border-line p-4" data-testid={`demo-${id}`}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Code</summary>
        <pre className="mt-1 overflow-x-auto rounded-lg border border-line p-2 font-mono text-[11px] leading-relaxed">{code}</pre>
      </details>
      <p className="text-xs text-muted"><span className="text-amber-300">Limitations: </span>{limits}</p>
    </section>
  );
}

const ChartBox = ({ r, h = 320 }: { r: (el: HTMLDivElement | null) => void; h?: number }) => (
  <div ref={r} style={{ height: h }} className="w-full overflow-hidden rounded-xl border border-line" />
);

// ---------- 1–5. Price-based chart types ----------
type PriceSpec = { kind: DerivedKind; title: string; runaway?: boolean; settings: (v: number) => Record<string, unknown>; control: { label: string; min: number; max: number; step: number; value: number }; code: string; limits: string };
const PRICE_TYPES: PriceSpec[] = [
  {
    kind: "renko", title: "Renko", runaway: true, control: { label: "Brick size", min: 2, max: 30, step: 1, value: 8 },
    settings: (v) => ({ method: "fixed", size: v, reversal: 2, wicks: true }),
    code: `chart.setChartType("renko", { method: "fixed", size: 8, reversal: 2, wicks: true });\nchart.getDerivedInfo(); // { points, provisional, methodology, hidden }`,
    limits: "Built from candles: the intrabar path (open → nearer extreme → farther extreme → close) is assumed and such bricks are flagged reconstructed. Bricks from the live candle are provisional until it closes. ATR sizes use the ATR of earlier candles (no look-ahead).",
  },
  {
    kind: "kagi", title: "Kagi", control: { label: "Reversal", min: 2, max: 40, step: 1, value: 12 },
    settings: (v) => ({ method: "fixed", reversal: v }),
    code: `chart.setChartType("kagi", { method: "fixed", reversal: 12, yangWidth: 3, yinWidth: 1 });`,
    limits: "Close-based by default; thick/thin switching at shoulders and waists. The last line is provisional while the live candle forms.",
  },
  {
    kind: "point-and-figure", title: "Point & Figure", runaway: true, control: { label: "Box size", min: 2, max: 20, step: 1, value: 5 },
    settings: (v) => ({ method: "fixed", boxSize: v, reversal: 3, source: "high-low" }),
    code: `chart.setChartType("point-and-figure", { boxSize: 5, reversal: 3, source: "high-low" });`,
    limits: "High-low method uses the Dorsey rule (extend first, reverse only without extension); with candles the order of high and low inside a bar is assumed.",
  },
  {
    kind: "line-break", title: "Line Break", control: { label: "Lines", min: 2, max: 5, step: 1, value: 3 },
    settings: (v) => ({ lines: v }),
    code: `chart.setChartType("line-break", { lines: 3 });`,
    limits: "Close-based. A reversal needs the close to exceed the extreme of the last N lines.",
  },
  {
    kind: "range-bars", title: "Range bars", runaway: true, control: { label: "Range", min: 2, max: 30, step: 1, value: 10 },
    settings: (v) => ({ method: "fixed", range: v }),
    code: `chart.setChartType("range-bars", { method: "fixed", range: 10 });  // or { method: "ticks", range: 40, tickSize: 0.05 }`,
    limits: "True range bars need tick data; tick input is not wired into charts in v0.3.1, so bars are reconstructed from candles (flagged). Gaps create the bars the move implies.",
  },
];

function PriceTypeSection({ spec }: { spec: PriceSpec }) {
  const [v, setV] = useState(spec.control.value);
  const [info, setInfo] = useState("");
  const live = useRef<{ s: SeriesApi<"candlestick">; data: CandlestickData[] } | null>(null);
  const apply = (c: ChartApi, size: number) => {
    try {
      c.setChartType(spec.kind as never, spec.settings(size) as never);
      const d = c.getDerivedInfo();
      setInfo(d ? `${d.points.length} elements (${d.provisional} provisional) · ${d.methodology}` : "");
    } catch (e) {
      setInfo(`Rejected (chart unchanged): ${(e as Error).message}`);
    }
  };
  const { ref, charts, ready } = useCharts(1, (_m, [c]) => {
    const data = synthetic(300, DAILY_START, DAY, 21);
    const s = c.addCandlestickSeries();
    s.setData(data);
    c.addIndicator("sma", { length: 10 });
    live.current = { s, data };
    apply(c, spec.control.value);
  });
  const tick = () => {
    const c = charts.current[0], l = live.current;
    if (!c || !l) return;
    const last = l.data[l.data.length - 1];
    const close = +(last.close + (Math.random() - 0.5) * 3 * spec.control.value).toFixed(2);
    l.s.update({ ...last, close, high: Math.max(last.high, close), low: Math.min(last.low, close) });
    const d = c.getDerivedInfo();
    if (d) setInfo(`${d.points.length} elements (${d.provisional} provisional, live candle) · ${d.methodology}`);
  };
  return (
    <Section id={spec.kind} title={spec.title} code={spec.code} limits={spec.limits}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-2">{spec.control.label}
          <input type="range" min={spec.control.min} max={spec.control.max} step={spec.control.step} value={v} onChange={(e) => { const x = Number(e.target.value); setV(x); if (charts.current[0]) apply(charts.current[0], x); }} />
          <span className={stat}>{v}</span>
        </label>
        <button className={btn} disabled={!ready} onClick={tick}>Live tick</button>
        {spec.runaway && <button className={btn} disabled={!ready} onClick={() => apply(charts.current[0], 0.0001)}>Try a runaway size (rejected atomically)</button>}
      </div>
      <ChartBox r={ref(0)} />
      <p className={stat}>{info}</p>
    </Section>
  );
}

// ---------- 6. Incremental indicators ----------
const INC_IDS = ["ema", "rsi", "macd", "supertrend", "psar", "adx", "kama", "tema", "stc", "zlema"];
function IncrementalSection() {
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState("");
  const live = useRef<{ s: SeriesApi<"candlestick">; data: CandlestickData[]; timer: number | null } | null>(null);
  const { ref, charts, ready } = useCharts(1, (_m, [c]) => {
    const data = synthetic(50_000, INTRADAY_START - 50_000 * MIN, MIN, 3);
    const s = c.addCandlestickSeries();
    s.setData(data);
    for (const id of INC_IDS) c.addIndicator(id);
    live.current = { s, data, timer: null };
    return () => { if (live.current?.timer) clearInterval(live.current.timer); };
  });
  const toggle = () => {
    const l = live.current, c = charts.current[0];
    if (!l || !c) return;
    if (l.timer) {
      clearInterval(l.timer);
      l.timer = null;
      setRunning(false);
      return;
    }
    const ms: number[] = [];
    let k = 0;
    l.timer = window.setInterval(() => {
      const last = l.data[l.data.length - 1];
      const t0 = performance.now();
      if (++k % 20 === 0) {
        const bar = { time: last.time + MIN, open: last.close, high: last.close, low: last.close, close: last.close, volume: 1000 };
        l.data.push(bar);
        l.s.update(bar);
      } else {
        const close = +(last.close + (Math.random() - 0.5) * 2).toFixed(2);
        const bar = { ...last, close, high: Math.max(last.high, close), low: Math.min(last.low, close) };
        l.data[l.data.length - 1] = bar;
        l.s.update(bar);
      }
      requestAnimationFrame(() => {
        ms.push(performance.now() - t0 - 0);
        const st = c.indicatorEngineStats();
        const sorted = [...ms.slice(-200)].sort((a, b) => a - b);
        setStats(`${l.data.length.toLocaleString()} candles · ${INC_IDS.length} indicators · ${st.nodes} graph nodes (${st.shared} shared) · last sync ${st.lastSyncMs.toFixed(2)} ms · draw ${(c.renderTimeMs() ?? 0).toFixed(1)} ms · tick→frame median ${sorted[sorted.length >> 1].toFixed(1)} ms (includes waiting for the frame)`);
      });
    }, 50);
    setRunning(true);
  };
  return (
    <Section id="incremental" title="Incremental indicators (50,000 candles, 10 indicators, 20 ticks/s)"
      code={`chart.addIndicator("rsi"); chart.addIndicator("macd"); … // all 122 built-ins stream\nseries.update(liveCandle);          // O(1)–O(window) per indicator, exact\nchart.indicatorEngineStats();       // { nodes, shared, committed, rebuilds, replays, lastSyncMs }`}
      limits="Evaluation runs on the main thread (the worker is for batch work). Adding an indicator does one full pass over the history; occasional append spikes come from array growth.">
      <button className={btn} disabled={!ready} onClick={toggle}>{running ? "Stop" : "Start"} live ticks</button>
      <ChartBox r={ref(0)} h={420} />
      <p className={stat}>{stats || "Press Start: every 20th tick appends a candle."}</p>
    </Section>
  );
}

// ---------- 7. Worker ----------
function WorkerSection() {
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const m = await import("@/lib/xchart-sdk");
    const data = synthetic(200_000, DAILY_START, MIN, 5);
    const cols = { time: data.map((d) => d.time), open: data.map((d) => d.open), high: data.map((d) => d.high), low: data.map((d) => d.low), close: data.map((d) => d.close), volume: data.map((d) => d.volume ?? 0) };
    const jobs = [{ id: "rsi", params: { length: 14 } }, { id: "macd", params: {} }, { id: "bb", params: {} }];
    const worker = new m.IndicatorWorkerClient();
    const sync = new m.IndicatorWorkerClient({ sync: true });
    try {
      const a = await worker.computeIndicators(cols, jobs, { datasetVersion: 1 });
      const b = await sync.computeIndicators(cols, jobs, { datasetVersion: 1 });
      let same = true;
      a.results.forEach((r, i) => {
        const q = b.results[i];
        if (!("outputs" in r) || !("outputs" in q)) return void (same = false);
        for (const k of Object.keys(r.outputs)) for (let j = 0; j < r.outputs[k].length; j++) if (!Object.is(r.outputs[k][j], q.outputs[k][j])) same = false;
      });
      // Coalescing + stale rejection: two requests on one channel, only the newest resolves.
      const first = worker.computeIndicators(cols, jobs, { datasetVersion: 2, channel: "demo" }).then(() => "resolved", (e) => (e as Error).name);
      const second = worker.computeIndicators(cols, jobs, { datasetVersion: 3, channel: "demo" }).then(() => "resolved", (e) => (e as Error).name);
      const [f, s] = await Promise.all([first, second]);
      setOut(`200,000 candles × 3 indicators · worker: ${a.worker ? "yes" : `no (${worker.fallbackReason})`} · compute ${a.ms.toFixed(0)} ms, transfer ${a.transferMs.toFixed(0)} ms · main-thread fallback ${b.ms.toFixed(0)} ms · results identical: ${same ? "yes (bitwise)" : "NO"} · older request: ${f}, newer: ${s}`);
    } catch (e) {
      setOut(`Error: ${(e as Error).message}`);
    } finally {
      worker.terminate();
      sync.terminate();
      setBusy(false);
    }
  };
  return (
    <Section id="worker" title="Indicator Web Worker"
      code={`const client = new IndicatorWorkerClient();\nconst r = await client.computeIndicators(columns, [{ id: "rsi", params: { length: 14 } }], { datasetVersion: 42, channel: "NIFTY", signal });\n// stale results reject with StaleResultError; cancelled jobs with CancelledError`}
      limits="Computes the 22 original built-ins and price-based types; the 100 catalog indicators and custom indicators run on the main thread only. The live chart does not use the worker.">
      <button className={btn} disabled={busy} onClick={run}>{busy ? "Computing…" : "Compute 200k candles in a worker"}</button>
      <p className={stat}>{out}</p>
    </Section>
  );
}

// ---------- 8. Catalog ----------
function CatalogSection() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [picked, setPicked] = useState<IndicatorDefinition | null>(null);
  const current = useRef<IndicatorApi | null>(null);
  const { ref, charts, ready } = useCharts(1, (_m, [c]) => {
    c.addCandlestickSeries().setData(synthetic(400, DAILY_START, DAY, 31));
  });
  const list = ready && charts.current[0] ? charts.current[0].searchIndicators({ text: q || undefined, category: cat || undefined }) : [];
  const add = (d: IndicatorDefinition) => {
    const c = charts.current[0];
    current.current?.remove();
    current.current = null;
    setPicked(d);
    const ok = c.indicatorCompatibility(d.id);
    if (!ok.ok) return;
    current.current = c.addIndicator(d.id);
  };
  const compat = picked && ready ? charts.current[0]?.indicatorCompatibility(picked.id) : null;
  return (
    <Section id="catalog" title="Indicator catalog (122 built-ins)"
      code={`chart.searchIndicators({ text: "kaufman" });\nchart.searchIndicators({ category: "Statistics" });\nchart.indicatorCompatibility("beta"); // needs chart.setBenchmarkSeries(series)\nchart.getIndicatorDefinition("kama").meta; // formula, conventions, repaint, limitations`}
      limits="Benchmark indicators (correlation, beta, alpha, covariance) need a benchmark series (not set here). Hurst is validated only by a directional check.">
      <div className="flex flex-wrap gap-2">
        <input className={sel} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search indicators" />
        <select className={sel} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {["Trend", "Momentum", "Volatility", "Volume", "Statistics", "Structure"].map((c) => <option key={c}>{c}</option>)}
        </select>
        <span className={stat}>{list.length} found</span>
      </div>
      <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
        {list.map((d) => <button key={d.id} className={`${btn} ${picked?.id === d.id ? "bg-white/10" : ""}`} onClick={() => add(d)}>{d.name}</button>)}
      </div>
      <ChartBox r={ref(0)} />
      {picked && (
        <div className="space-y-0.5 text-xs">
          <p><b>{picked.name}</b> <span className="text-muted">({picked.category})</span> — {picked.description}</p>
          {picked.meta && <p className={stat}>{picked.meta.formula}</p>}
          {picked.meta?.repaint && <p className="text-amber-300">Repaint: {picked.meta.repaint}</p>}
          {compat && !compat.ok && <p className="text-amber-300">Not added: {compat.reasons.join("; ")}</p>}
        </div>
      )}
    </Section>
  );
}

// ---------- 9. Independent scales ----------
function ScalesSection() {
  const [mainLog, setMainLog] = useState(false);
  const [invert, setInvert] = useState(true);
  const [leftMode, setLeftMode] = useState<"normal" | "percentage" | "indexed">("percentage");
  const { ref, charts, ready } = useCharts(1, (_m, [c]) => {
    const data = synthetic(400, DAILY_START, DAY, 41, 100);
    const other = synthetic(400, DAILY_START, DAY, 43, 5000);
    c.addCandlestickSeries().setData(data);
    c.addLineSeries({ priceScaleId: "left", color: "#38bdf8", title: "Second instrument (left)" }).setData(other.map((d) => ({ time: d.time, value: d.close })));
    c.addHistogramSeries({ pane: "main", priceScaleId: "vol", colorMode: "single", color: "rgba(100,116,139,0.6)" }).setData(data.map((d) => ({ time: d.time, value: d.volume ?? 0 })));
    c.priceScale("vol").applyOptions({ margins: { top: 0.75, bottom: 0 } });
  });
  useEffect(() => {
    const c = charts.current[0];
    if (!ready || !c) return;
    c.priceScale("right").applyOptions({ mode: mainLog ? "logarithmic" : "normal" });
    c.priceScale("left").applyOptions({ mode: leftMode, invert });
  }, [ready, mainLog, invert, leftMode, charts]);
  return (
    <Section id="scales" title="Independent price scales"
      code={`chart.addLineSeries({ priceScaleId: "left" });\nchart.priceScale("left").applyOptions({ mode: "percentage", invert: true });\nchart.priceScale("vol").applyOptions({ margins: { top: 0.75, bottom: 0 } });\nchart.priceScale("right", paneId).applyOptions({ range: [0, 100], autoScale: false });`}
      limits="Percentage / indexed are relative to the first visible value of the scale's first series (the base moves while panning). Log scales cannot show values ≤ 0 (they are skipped, and a scaleWarning event is emitted).">
      <div className="flex flex-wrap gap-2 text-xs">
        <label className="flex items-center gap-1"><input type="checkbox" checked={mainLog} onChange={(e) => setMainLog(e.target.checked)} /> Right scale logarithmic</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} /> Left scale inverted</label>
        <select className={sel} value={leftMode} onChange={(e) => setLeftMode(e.target.value as typeof leftMode)} aria-label="Left scale mode">
          <option value="normal">Left: normal</option><option value="percentage">Left: percentage</option><option value="indexed">Left: indexed to 100</option>
        </select>
      </div>
      <ChartBox r={ref(0)} />
    </Section>
  );
}

// ---------- 10. Multi-pane drawings ----------
function PaneDrawingsSection() {
  const [list, setList] = useState("");
  const pane = useRef("");
  const data = useRef<CandlestickData[]>([]);
  const { ref, charts, ready } = useCharts(1, (_m, [c]) => {
    data.current = synthetic(200, DAILY_START, DAY, 51);
    c.addCandlestickSeries().setData(data.current);
    const rsi = c.addIndicator("rsi");
    pane.current = "xind-" + rsi.id;
    const refresh = () => setList(c.getDrawings().map((d) => { const x = d.data(); return `${x.type} on ${x.paneId ?? "main"} at ${x.points.map((p) => p.price.toFixed(2)).join(", ")}`; }).join(" · "));
    return c.subscribeDrawingEvents(refresh);
  });
  const c = () => charts.current[0];
  return (
    <Section id="pane-drawings" title="Drawings on any pane"
      code={`const rsi = chart.addIndicator("rsi");\nchart.addDrawing({ type: "horizontal-line", paneId: "xind-" + rsi.id, points: [{ time, price: 70 }] });\nchart.setDrawingTool("trendline"); // draws on the pane under the pointer, in that pane's price units`}
      limits="A drawing belongs to one pane and scale; removing the pane hides (and layouts drop) its drawings. On price-based chart types drawings use logical (element) coordinates.">
      <div className="flex flex-wrap gap-2">
        <button className={btn} disabled={!ready} onClick={() => c().addDrawing({ type: "horizontal-line", paneId: pane.current, points: [{ time: data.current[100].time, price: 70 }], style: { color: "#f59e0b" } })}>RSI 70 line</button>
        <button className={btn} disabled={!ready} onClick={() => c().addDrawing({ type: "trendline", paneId: pane.current, points: [{ time: data.current[120].time, price: 30 }, { time: data.current[180].time, price: 60 }], style: { color: "#38bdf8" } })}>Trendline on RSI</button>
        <button className={btn} disabled={!ready} onClick={() => c().setDrawingTool("trendline")}>Draw (any pane)</button>
        <button className={btn} disabled={!ready} onClick={() => c().clearDrawings()}>Clear</button>
      </div>
      <ChartBox r={ref(0)} h={380} />
      <p className={stat}>{list || "No drawings."}</p>
    </Section>
  );
}

// ---------- 11. Calendar providers ----------
const DEMO_DATASET = {
  format: "xchart-calendar" as const, version: 1 as const, revision: "demo.1",
  provider: { id: "demo-provider", name: "Demo calendar (fictional)", source: { name: "Hand-written for this demo — not an exchange calendar" }, retrievedAt: "2026-01-01", validUntil: "2026-12-31" },
  calendars: {
    DEMO: {
      coverage: { from: "2026-03-01", to: "2026-03-31" },
      holidays: [{ date: "2026-03-04", name: "Demo holiday" }],
      earlyCloses: [{ date: "2026-03-05", close: "12:00", name: "Demo early close" }],
      specialSessions: [{ date: "2026-03-07", name: "Demo Saturday session", sessions: [{ kind: "regular" as const, start: "10:00", end: "11:00" }] }],
    },
  },
};
function CalendarSection() {
  const [rows, setRows] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const { ref, ready } = useCharts(1, (m, [c]) => {
    const reg = new m.CalendarRegistry();
    reg.register(DEMO_DATASET);
    const cal = new m.TradingCalendar({ id: "DEMO", name: "Demo exchange", timeZone: "Asia/Kolkata", week: { 1: [{ kind: "regular", start: "09:15", end: "15:30" }], 2: [{ kind: "regular", start: "09:15", end: "15:30" }], 3: [{ kind: "regular", start: "09:15", end: "15:30" }], 4: [{ kind: "regular", start: "09:15", end: "15:30" }], 5: [{ kind: "regular", start: "09:15", end: "15:30" }] } }, reg);
    setRows(["2026-03-02", "2026-03-04", "2026-03-05", "2026-03-07", "2026-03-08", "2026-04-06"].map((d) => {
      const s = cal.dayStatus(d);
      return `${d}: ${s.status} — ${s.reason}${s.source ? ` [${s.source}]` : ""}`;
    }));
    const st = reg.status("demo-provider");
    setStatus(`Provider ${st.id}: ${st.state}, revision ${st.revision}, source "${st.source}"`);
    // 15-minute bars every day of the week; shading shows closed and unknown periods.
    const data = synthetic(8 * 24 * 4, Date.UTC(2026, 2, 2) / 1000, 15 * MIN, 61);
    c.addCandlestickSeries().setData(data);
    c.applyOptions({ timeZone: "Asia/Kolkata" });
    c.setSessionHighlight({ calendar: cal, closedColor: "rgba(148,163,184,0.10)", unknownColor: "rgba(245,158,11,0.10)" });
  });
  return (
    <Section id="calendars" title="Calendar providers"
      code={`const reg = new CalendarRegistry();\nawait reg.load("nse-2026", () => fetch(url).then((r) => r.json()));   // validated xchart-calendar dataset\nconst cal = new TradingCalendar("NSE", reg);\ncal.dayStatus("2026-03-04"); // { status: "trading" | "non-trading" | "unknown", reason, source }`}
      limits="No exchange holidays are bundled or hard-coded: the dataset here is fictional (calendar id DEMO). Dates outside every provider's coverage are reported as unknown, never assumed to be trading days.">
      <ul className={`${stat} space-y-0.5`}>{rows.map((r) => <li key={r}>{r}</li>)}</ul>
      <p className={stat}>{ready ? status : "Loading…"}</p>
      <ChartBox r={ref(0)} h={260} />
    </Section>
  );
}

// ---------- 12. Synchronisation ----------
function SyncSection() {
  const { ref, ready } = useCharts(3, (m, cs) => {
    const a = synthetic(600, INTRADAY_START, 5 * MIN, 71);
    const b = synthetic(600, INTRADAY_START, 5 * MIN, 73, 400).filter((_, i) => i % 7 !== 3); // different bars
    cs[0].addCandlestickSeries().setData(a);
    cs[1].addCandlestickSeries().setData(b);
    cs[1].priceScale("right").applyOptions({ mode: "percentage" });
    cs[2].addCandlestickSeries().setData(a);
    cs[2].setChartType("renko", { size: 6 });
    const group = m.syncCharts([cs[0], cs[1]]);
    return () => group.destroy();
  });
  return (
    <Section id="sync" title="Synchronised charts (by time)"
      code={`const group = syncCharts([chartA, chartB], { timeRange: true, crosshair: true });\ngroup.destroy();`}
      limits="Charts are aligned by time, not by bar index (the second chart has missing bars). A price-based chart (third, Renko) has a logical axis and is not synced: its elements have no unique time.">
      <div className="grid gap-2 md:grid-cols-2">
        <ChartBox r={ref(0)} h={220} />
        <ChartBox r={ref(1)} h={220} />
      </div>
      <ChartBox r={ref(2)} h={180} />
      {!ready && <p className={stat}>Loading…</p>}
    </Section>
  );
}

// ---------- 13. Performance ----------
function PerformanceSection() {
  const [n, setN] = useState(100_000);
  const [k, setK] = useState(10);
  const [out, setOut] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const run = async () => {
    setOut("Running…");
    const m = await import("@/lib/xchart-sdk");
    const c = m.createChart(box.current!, { theme: "dark", followLatest: true });
    try {
      const data = synthetic(n, DAILY_START, MIN, 81);
      const s = c.addCandlestickSeries();
      let t = performance.now();
      s.setData(data);
      const ids = c.listIndicators().map((d) => d.id).filter((id) => id !== "volume").slice(0, k);
      for (const id of ids) c.addIndicator(id);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const setup = performance.now() - t;
      const last = data[data.length - 1];
      const ticks: number[] = [];
      for (let i = 0; i < 60; i++) {
        t = performance.now();
        s.update({ ...last, close: last.close + (i % 5) * 0.1 });
        const call = performance.now() - t;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        ticks.push(call + (c.renderTimeMs() ?? 0));
      }
      ticks.sort((a, b) => a - b);
      const st = c.renderStats();
      setOut(`${n.toLocaleString()} candles × ${k} indicators · setup ${setup.toFixed(0)} ms · live tick (update + draw) median ${ticks[30].toFixed(2)} ms, p95 ${ticks[57].toFixed(2)} ms, max ${ticks[59].toFixed(2)} ms · frames: ${st?.fullFrames} full, ${st?.overlayFrames} crosshair-only`);
    } finally {
      c.remove();
    }
  };
  return (
    <Section id="performance" title="Performance (measure in your browser)"
      code={`node --experimental-strip-types scripts/xchart-bench.ts --root ../xchart-v030 --root .   # v0.3.0 vs v0.3.1\nchart.renderStats(); // { fullFrames, overlayFrames, lastDrawMs, lastOverlayMs }`}
      limits="Figures depend on the device; docs/xchart/performance.md lists the measured comparison with v0.3.0 (including the regressions: slower first indicator pass, occasional append spikes).">
      <div className="flex flex-wrap items-center gap-2">
        <select className={sel} value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Candles">{[1000, 10_000, 50_000, 100_000].map((x) => <option key={x} value={x}>{x.toLocaleString()} candles</option>)}</select>
        <select className={sel} value={k} onChange={(e) => setK(Number(e.target.value))} aria-label="Indicators">{[1, 5, 10, 20].map((x) => <option key={x} value={x}>{x} indicators</option>)}</select>
        <button className={btn} onClick={run}>Run</button>
      </div>
      <div ref={box} className="h-[240px] w-full overflow-hidden rounded-xl border border-line" />
      <p className={stat}>{out}</p>
    </Section>
  );
}

// ---------- 14. Layouts ----------
function LayoutsSection() {
  const [json, setJson] = useState("");
  const [msg, setMsg] = useState("");
  const { ref, charts, ready } = useCharts(2, (_m, [a, b]) => {
    const data = synthetic(300, DAILY_START, DAY, 91);
    a.addCandlestickSeries().setData(data);
    b.addCandlestickSeries().setData(data);
    const rsi = a.addIndicator("rsi");
    a.addDrawing({ type: "horizontal-line", paneId: "xind-" + rsi.id, points: [{ time: data[150].time, price: 65 }], style: { color: "#f59e0b" } });
    a.priceScale("right").applyOptions({ mode: "logarithmic" });
    a.setChartType("kagi", { reversal: 10 });
  });
  return (
    <Section id="layouts" title="Layouts (v0.3.1 state)"
      code={`const json = JSON.stringify(chartA.saveLayout());   // chart type + settings, scales, panes, per-pane drawings\nconst report = chartB.loadLayout(json);             // validated; atomic: invalid → nothing changes`}
      limits="Market data is not included unless asked (includeData). Plugins are listed by id only and must be installed by the application. Drawings of a pane that does not exist on load are dropped (reported).">
      <div className="flex flex-wrap gap-2">
        <button className={btn} disabled={!ready} onClick={() => setJson(JSON.stringify(charts.current[0].saveLayout(), null, 1))}>Save left chart</button>
        <button className={btn} disabled={!ready || !json} onClick={() => { try { const r = charts.current[1].loadLayout(json); setMsg(`Loaded into the right chart: ${r.indicatorsAdded} indicator(s), ${r.drawings} drawing(s).`); } catch (e) { setMsg(`Rejected (nothing changed): ${(e as Error).message}`); } }}>Load into right chart</button>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <ChartBox r={ref(0)} h={300} />
        <ChartBox r={ref(1)} h={300} />
      </div>
      <textarea className="h-28 w-full rounded-lg border border-line bg-transparent p-2 font-mono text-[11px]" value={json} onChange={(e) => setJson(e.target.value)} aria-label="Layout JSON" placeholder="Saved layout JSON" />
      {msg && <p className="text-xs text-amber-300">{msg}</p>}
    </Section>
  );
}

// ---------- 15. Plugins ----------
const bandPlugin: XChartPlugin = {
  id: "demo/scale-band",
  version: "1.0.0",
  install(ctx) {
    ctx.addLayer({
      z: "below",
      draw(api) {
        // Shades the 990–1010 band using the main price scale (api.yOfPrice) — pane-aware geometry.
        const y1 = api.yOfPrice(1010), y2 = api.yOfPrice(990);
        api.ctx.fillStyle = "rgba(56,189,248,0.10)";
        api.ctx.fillRect(0, Math.min(y1, y2), api.pane.width, Math.abs(y2 - y1));
        api.axisLabel(y1, "1010", "#0369a1");
      },
    });
  },
};
const faultyPlugin: XChartPlugin = {
  id: "demo/faulty",
  install(ctx) {
    ctx.addLayer({ draw() { throw new Error("this plugin always fails while drawing"); } });
  },
};
function PluginsSection() {
  const [on, setOn] = useState({ band: false, faulty: false });
  const [errors, setErrors] = useState<string[]>([]);
  const { ref, charts, ready } = useCharts(1, (_m, [c]) => {
    c.addCandlestickSeries().setData(synthetic(250, DAILY_START, DAY, 101));
    return c.on("pluginError", (e) => setErrors((x) => [...x.slice(-2), `${e.pluginId}: ${e.error}`]));
  });
  const toggle = (key: "band" | "faulty", p: XChartPlugin) => {
    const c = charts.current[0];
    if (on[key]) c.removePlugin(p.id);
    else c.use(p);
    setOn({ ...on, [key]: !on[key] });
  };
  return (
    <Section id="plugins" title="Plugins (layers, error isolation)"
      code={`chart.use({ id: "my/band", install(ctx) { ctx.addLayer({ draw(api) { api.yOfPrice(1010); api.scaleY?.("left", 5); /* … */ } }); } });\nchart.on("pluginError", (e) => console.warn(e.pluginId, e.error));`}
      limits="Plugins are trusted application code: they are not sandboxed. A throwing layer is isolated (the chart keeps drawing, pluginError is emitted) but a plugin can still block the main thread.">
      <div className="flex flex-wrap gap-2">
        <button className={btn} disabled={!ready} onClick={() => toggle("band", bandPlugin)}>{on.band ? "Remove" : "Install"} band plugin</button>
        <button className={btn} disabled={!ready} onClick={() => toggle("faulty", faultyPlugin)}>{on.faulty ? "Remove" : "Install"} faulty plugin</button>
      </div>
      <ChartBox r={ref(0)} />
      {errors.length > 0 && <p className="text-xs text-amber-300">Isolated plugin errors: {errors.join(" · ")}</p>}
    </Section>
  );
}

export function XChartV031Demo() {
  return (
    <div className="space-y-4" data-testid="xchart-v031-demo">
      <nav className="flex flex-wrap gap-1 text-xs">
        {[...PRICE_TYPES.map((p) => [p.kind, p.title]), ["incremental", "Incremental"], ["worker", "Worker"], ["catalog", "Catalog"], ["scales", "Scales"], ["pane-drawings", "Pane drawings"], ["calendars", "Calendars"], ["sync", "Sync"], ["performance", "Performance"], ["layouts", "Layouts"], ["plugins", "Plugins"]].map(([id, t]) => (
          <a key={id} href={`#${id}`} className="rounded-md border border-line px-2 py-0.5 hover:bg-white/5">{t}</a>
        ))}
      </nav>
      {PRICE_TYPES.map((p) => <PriceTypeSection key={p.kind} spec={p} />)}
      <IncrementalSection />
      <WorkerSection />
      <CatalogSection />
      <ScalesSection />
      <PaneDrawingsSection />
      <CalendarSection />
      <SyncSection />
      <PerformanceSection />
      <LayoutsSection />
      <PluginsSection />
    </div>
  );
}
