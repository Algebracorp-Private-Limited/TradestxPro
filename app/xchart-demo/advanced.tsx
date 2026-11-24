"use client";

/**
 * XChart SDK v0.3 demo sections. Everything here goes through the public SDK only and uses
 * SYNTHETIC data (a deterministic random walk) — never real market data.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CandlestickData, ChartApi, ChartType, DrawingType, IndicatorApi, SeriesApi, XChartPlugin } from "@/lib/xchart-sdk";

type SDK = typeof import("@/lib/xchart-sdk");

function synthetic(n: number, start: number, step: number, seed = 11, base = 1000): CandlestickData[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let price = base;
  return Array.from({ length: n }, (_, i) => {
    const open = price;
    const close = Math.max(1, open + (rnd() - 0.48) * base * 0.012);
    const high = Math.max(open, close) + rnd() * base * 0.005;
    const low = Math.min(open, close) - rnd() * base * 0.005;
    price = close;
    return { time: start + i * step, open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2), volume: Math.round(40_000 + rnd() * 160_000) };
  });
}
const DAY = 86400;
const DAILY_START = Date.UTC(2025, 0, 1) / 1000;

/** Creates a chart in a container for the lifetime of the component (browser only). */
function useChart(setup: (sdk: SDK, chart: ChartApi) => void | (() => void), options: Parameters<SDK["createChart"]>[1] = { theme: "dark" }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<ChartApi | null>(null);
  const sdk = useRef<SDK | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    let cleanup: void | (() => void);
    import("@/lib/xchart-sdk").then((m) => {
      if (disposed || !box.current) return;
      sdk.current = m;
      chart.current = m.createChart(box.current, options);
      cleanup = setup(m, chart.current);
      setReady(true);
    });
    return () => {
      disposed = true;
      cleanup?.();
      chart.current?.remove();
      chart.current = null;
    };
    // created once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { box, chart, sdk, ready };
}

const btn = "rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-white/5 disabled:opacity-40";
const sel = "rounded-lg border border-line bg-transparent px-2 py-1 text-xs";

function Section({ title, children, note }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-2xl border border-line p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {note && <p className="text-xs text-muted">{note}</p>}
      {children}
    </section>
  );
}

// ---------- 1. Indicators, chart types, scale modes ----------
function IndicatorsSection() {
  const [active, setActive] = useState<IndicatorApi[]>([]);
  const [defs, setDefs] = useState<{ id: string; name: string }[]>([]);
  const [pick, setPick] = useState("ema");
  const [period, setPeriod] = useState(20);
  const [msg, setMsg] = useState("");
  const [values, setValues] = useState("Hover the chart to read indicator values.");
  const { box, chart, ready } = useChart((_sdk, c) => {
    c.addCandlestickSeries().setData(synthetic(400, DAILY_START, DAY));
    c.addIndicator("ichimoku");
    setDefs(c.listIndicators().map((d) => ({ id: d.id, name: d.name })));
    setActive(c.getIndicators());
    const off = c.on("crosshairMove", (e) => {
      if (e.time === null) return;
      const parts = [...(e.indicators ?? new Map())].map(([ind, v]) => `${ind.id}: ${Object.entries(v).map(([k, x]) => `${k} ${(x as number).toFixed(2)}`).join(" ")}`);
      setValues(`${e.projected ? "PROJECTED (no candle) · " : ""}${parts.join(" | ") || "no indicator value (warm-up)"}`);
    });
    const offErr = c.on("indicatorError", (e) => setMsg(`indicatorError: ${e.error}`));
    return () => {
      off();
      offErr();
    };
  });
  const refresh = () => setActive(chart.current?.getIndicators() ?? []);
  const add = () => {
    try {
      const def = chart.current!.getIndicatorDefinition(pick);
      const hasLength = def?.params.some((p) => p.key === "length");
      chart.current!.addIndicator(pick, hasLength ? { length: period } : {});
      setMsg("");
    } catch (e) {
      setMsg((e as Error).message);
    }
    refresh();
  };
  return (
    <Section title="Indicators, chart types and scale modes" note="22 built-in indicators share the chart's data. Ichimoku projects its cloud into empty future space — no candles are invented; the crosshair says PROJECTED there.">
      <div className="flex flex-wrap items-center gap-2">
        <select className={sel} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Indicator">
          {defs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <label className="text-xs text-muted">length <input className={`${sel} w-16`} type="number" min={1} max={500} value={period} onChange={(e) => setPeriod(+e.target.value)} /></label>
        <button className={btn} disabled={!ready} onClick={add}>Add indicator</button>
        <span className="mx-1 w-px self-stretch bg-line" />
        <label className="text-xs text-muted">Chart type{" "}
          <select className={sel} defaultValue="candles" onChange={(e) => chart.current?.setChartType(e.target.value as ChartType)}>
            {["candles", "hollow-candles", "bars", "heikin-ashi", "line", "step-line", "line-markers", "area", "baseline", "high-low", "columns"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted">Scale{" "}
          <select className={sel} defaultValue="normal" onChange={(e) => chart.current?.priceScale().applyOptions({ mode: e.target.value as "normal" })}>
            {["normal", "logarithmic", "percentage", "indexed"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <button className={btn} disabled={!ready} onClick={() => { try { chart.current!.setChartType("renko" as ChartType); } catch (e) { setMsg((e as Error).message); } }}>Try Renko</button>
      </div>
      <div ref={box} className="h-[420px] w-full overflow-hidden rounded-xl border border-line" />
      <ul className="flex flex-wrap gap-2 text-xs">
        {active.map((i) => (
          <li key={i.id} className="flex items-center gap-1 rounded-md border border-line px-2 py-0.5">
            <span className="font-mono">{i.id}</span>
            <button className="text-muted hover:text-white" onClick={() => { i.setVisible(!i.isVisible()); refresh(); }}>{i.isVisible() ? "hide" : "show"}</button>
            <button className="text-rose-300" onClick={() => { i.remove(); refresh(); }}>remove</button>
          </li>
        ))}
      </ul>
      <p className="font-mono text-[11px] text-soft" aria-live="polite">{values}</p>
      {msg && <p className="text-xs text-amber-300">{msg}</p>}
    </Section>
  );
}

// ---------- 2. Drawings, markers, price lines ----------
const TOOL_GROUPS: [string, DrawingType[]][] = [
  ["Lines", ["trendline", "ray", "extended-line", "horizontal-line", "horizontal-ray", "vertical-line", "arrow"]],
  ["Channels", ["parallel-channel", "regression-channel", "pitchfork"]],
  ["Fibonacci", ["fib-retracement", "fib-extension", "fib-timezones", "fib-fan", "fib-channel"]],
  ["Shapes", ["rectangle", "ellipse", "triangle", "polygon", "text", "price-label", "callout"]],
  ["Measure", ["price-range", "date-range", "date-price-range", "long-position", "short-position"]],
];
function DrawingsSection() {
  const [tool, setTool] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [json, setJson] = useState("");
  const series = useRef<SeriesApi<"candlestick"> | null>(null);
  const { box, chart, ready } = useChart((_sdk, c) => {
    const data = synthetic(160, DAILY_START, DAY, 5);
    series.current = c.addCandlestickSeries();
    series.current.setData(data);
    c.addDrawing({ type: "fib-retracement", points: [{ time: data[20].time, price: data[20].low }, { time: data[70].time, price: data[70].high }] });
    const offs = [
      c.subscribeDrawingEvents((e) => {
        if (e.type === "tool") setTool(e.tool);
        setCount(c.getDrawings().length);
      }),
    ];
    setCount(c.getDrawings().length);
    return () => offs.forEach((o) => o());
  });
  const c = () => chart.current!;
  return (
    <Section title="Drawing tools, markers and price lines" note="27 tools. Click to place anchors (or press-drag-release); double-click finishes a polygon. Select to drag; Delete removes, Ctrl+Z / Ctrl+Y undo/redo, Ctrl+D duplicates, Shift+L locks, Esc cancels. Hold Ctrl to place without OHLC snapping.">
      <div className="space-y-1">
        {TOOL_GROUPS.map(([g, tools]) => (
          <div key={g} className="flex flex-wrap items-center gap-1">
            <span className="w-20 text-[11px] text-muted">{g}</span>
            {tools.map((t) => <button key={t} className={`${btn} ${tool === t ? "border-accent text-accent" : ""}`} disabled={!ready} onClick={() => c().setDrawingTool(tool === t ? null : t)}>{t}</button>)}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={btn} disabled={!ready} onClick={() => c().undoDrawing()}>Undo</button>
        <button className={btn} disabled={!ready} onClick={() => c().redoDrawing()}>Redo</button>
        <button className={btn} disabled={!ready} onClick={() => c().clearDrawings()}>Clear</button>
        <button className={btn} disabled={!ready} onClick={() => setJson(JSON.stringify(c().serializeDrawings(), null, 1))}>Serialize</button>
        <button className={btn} disabled={!ready || !json} onClick={() => { try { c().loadDrawings(JSON.parse(json)); } catch (e) { setJson(String((e as Error).message)); } }}>Load JSON</button>
        <span className="mx-1 w-px self-stretch bg-line" />
        <button className={btn} disabled={!ready} onClick={() => {
          const d = series.current!.data();
          series.current!.setMarkers(d.filter((_, i) => i % 23 === 7).map((b, i) => ({ time: b.time, position: i % 2 ? "aboveBar" : "belowBar", shape: i % 2 ? "arrowDown" : "arrowUp", text: i % 2 ? "S" : "B" })));
        }}>Add markers</button>
        <button className={btn} disabled={!ready} onClick={() => series.current!.createPriceLine({ source: "previousClose", title: "Prev close", color: "#94a3b8" })}>Previous-close line</button>
        <button className={btn} disabled={!ready} onClick={() => { const d = series.current!.data(); series.current!.createPriceLine({ price: d[d.length - 1].close * 1.05, title: "Target +5%", color: "#22c55e", lineStyle: "solid" }); }}>Target line</button>
        <span className="text-xs text-muted">{count} drawing(s)</span>
      </div>
      <div ref={box} className="h-[420px] w-full overflow-hidden rounded-xl border border-line" />
      {json && <textarea className="h-28 w-full rounded-lg border border-line bg-transparent p-2 font-mono text-[11px]" value={json} onChange={(e) => setJson(e.target.value)} aria-label="Drawings JSON" />}
    </Section>
  );
}

// ---------- 3. Panes, scales, sync ----------
function PanesSyncSection() {
  const [collapsed, setCollapsed] = useState(false);
  const bRef = useRef<ChartApi | null>(null);
  const bBox = useRef<HTMLDivElement>(null);
  const { box, chart, ready } = useChart((sdk, c) => {
    const data = synthetic(300, DAILY_START, DAY, 21);
    c.addCandlestickSeries().setData(data);
    const vol = c.addHistogramSeries({ pane: "main", priceScaleId: "vol", colorMode: "candle", opacity: 0.5, title: "Volume" });
    vol.setData(data.map((d) => ({ time: d.time, value: d.volume ?? 0 })));
    c.priceScale("vol").applyOptions({ margins: { top: 0.8, bottom: 0 } });
    const rel = c.addLineSeries({ priceScaleId: "left", color: "#a78bfa", title: "Second instrument (left scale)" });
    rel.setData(synthetic(300, DAILY_START, DAY, 33, 50).map((d) => ({ time: d.time, value: d.close })));
    c.addIndicator("rsi");
    c.addIndicator("macd");
    // Second chart (different history length), synchronised by time.
    if (bBox.current) {
      const b = sdk.createChart(bBox.current, { theme: "dark" });
      b.addCandlestickSeries({ upColor: "#38bdf8", downColor: "#f472b6" }).setData(synthetic(200, DAILY_START + 100 * DAY, DAY, 44, 400));
      bRef.current = b;
      const group = sdk.syncCharts([c, b]);
      return () => {
        group.destroy();
        b.remove();
      };
    }
  });
  return (
    <Section title="Panes, price scales and synchronised charts" note="Volume sits on an overlay scale in the bottom 20 % of the main pane; a second instrument uses the left scale. Drag the line between panes to resize. The two charts share their time range and crosshair (aligned by time, not by bar number).">
      <div className="flex flex-wrap gap-2">
        <button className={btn} disabled={!ready} onClick={() => { const p = chart.current!.panes()[1]; if (!p) return; if (collapsed) p.expand(); else p.collapse(); setCollapsed(!collapsed); }}>{collapsed ? "Expand" : "Collapse"} RSI pane</button>
        <button className={btn} disabled={!ready} onClick={() => { const ps = chart.current!.panes(); ps[ps.length - 1]?.moveTo(1); }}>Move last pane up</button>
        <button className={btn} disabled={!ready} onClick={() => chart.current!.panes()[1]?.setHeight(160)}>RSI pane 160 px</button>
      </div>
      <div className="grid gap-2 lg:grid-cols-[2fr_1fr]">
        <div ref={box} className="h-[460px] w-full overflow-hidden rounded-xl border border-line" />
        <div ref={bBox} className="h-[460px] w-full overflow-hidden rounded-xl border border-line" />
      </div>
    </Section>
  );
}

// ---------- 4. Sessions and time zones ----------
function SessionsSection() {
  const [tz, setTz] = useState("Asia/Kolkata");
  const [info, setInfo] = useState("");
  const { box, chart, ready } = useChart((sdk, c) => {
    // Two synthetic NSE days of 5-minute bars, 09:00–16:00 IST (pre-open, regular, closing session).
    const day = (d: number) => synthetic(84, Date.UTC(2026, 2, d, 3, 30) / 1000, 300, d);
    const bars = [...day(2), ...day(3)];
    let p = bars[0].open;
    const chained = bars.map((b) => {
      const shift = p - b.open;
      p = b.close + shift;
      return { ...b, open: +(b.open + shift).toFixed(2), high: +(b.high + shift).toFixed(2), low: +(b.low + shift).toFixed(2), close: +(b.close + shift).toFixed(2) };
    });
    c.addCandlestickSeries().setData(chained);
    c.setSessionHighlight({ calendar: "NSE" });
    const nse = new sdk.TradingCalendar("NSE");
    const nyse = new sdk.TradingCalendar("NYSE");
    const now = Math.floor(Date.now() / 1000);
    setInfo(`Now: NSE ${nse.sessionAt(now)}, NYSE ${nyse.sessionAt(now)} (sessions only; holidays come from your own provider — none are bundled).`);
  }, { theme: "dark", timeZone: "Asia/Kolkata" });
  return (
    <Section title="Trading sessions and time zones" note="Pre-open (09:00–09:15) and the closing session (15:40–16:00) are shaded; dotted lines mark day breaks. Time labels follow the selected IANA zone, including daylight saving.">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted">Time zone{" "}
          <select className={sel} value={tz} onChange={(e) => { setTz(e.target.value); chart.current?.applyOptions({ timeZone: e.target.value }); }} disabled={!ready}>
            {["Asia/Kolkata", "America/New_York", "Europe/London", "UTC"].map((z) => <option key={z}>{z}</option>)}
          </select>
        </label>
        <span className="text-xs text-muted">{info}</span>
      </div>
      <div ref={box} className="h-[360px] w-full overflow-hidden rounded-xl border border-line" />
    </Section>
  );
}

// ---------- 5. Layouts and plugins ----------
const watermark: XChartPlugin = {
  id: "demo/watermark",
  version: "1.0.0",
  install(ctx) {
    ctx.addLayer({
      z: "below",
      draw(api) {
        api.ctx.font = "600 28px ui-sans-serif, system-ui, sans-serif";
        api.ctx.fillStyle = "rgba(148,163,184,0.12)";
        api.ctx.textAlign = "center";
        api.ctx.fillText("SYNTHETIC DATA", api.pane.width / 2, api.pane.top + api.pane.height / 2);
      },
    });
  },
};
function LayoutsSection() {
  const [layout, setLayout] = useState("");
  const [msg, setMsg] = useState("");
  const [plugin, setPlugin] = useState(false);
  const { box, chart, ready } = useChart((_sdk, c) => {
    const data = synthetic(250, DAILY_START, DAY, 9);
    c.addCandlestickSeries().setData(data);
    c.addIndicator("bb");
    c.addDrawing({ type: "rectangle", points: [{ time: data[40].time, price: data[40].high }, { time: data[90].time, price: data[90].low }], style: { color: "#38bdf8" } });
  });
  return (
    <Section title="Layouts and plugins" note="A layout is plain JSON: options, chart type, indicators, drawings, scales and panes. It never contains credentials or code, and market data only when asked. Plugins are trusted code installed by the application (not sandboxed); a layout only lists their ids.">
      <div className="flex flex-wrap gap-2">
        <button className={btn} disabled={!ready} onClick={() => setLayout(JSON.stringify(chart.current!.saveLayout(), null, 1))}>Save layout</button>
        <button className={btn} disabled={!ready || !layout} onClick={() => {
          try {
            const r = chart.current!.loadLayout(layout);
            setMsg(`Loaded: ${r.indicatorsAdded} indicator(s), ${r.drawings} drawing(s)${r.pluginsNotInstalled.length ? `; not installed: ${r.pluginsNotInstalled.join(", ")}` : ""}.`);
          } catch (e) {
            setMsg(`Rejected (nothing changed): ${(e as Error).message}`);
          }
        }}>Load layout</button>
        <button className={btn} disabled={!ready} onClick={() => { chart.current!.clearDrawings(); chart.current!.getIndicators().forEach((i) => i.remove()); setMsg("Cleared; load the saved layout to restore."); }}>Clear chart</button>
        <span className="mx-1 w-px self-stretch bg-line" />
        <button className={btn} disabled={!ready} onClick={() => { if (plugin) chart.current!.removePlugin(watermark.id); else chart.current!.use(watermark); setPlugin(!plugin); }}>{plugin ? "Remove" : "Install"} watermark plugin</button>
      </div>
      <div ref={box} className="h-[380px] w-full overflow-hidden rounded-xl border border-line" />
      <textarea className="h-32 w-full rounded-lg border border-line bg-transparent p-2 font-mono text-[11px]" value={layout} onChange={(e) => setLayout(e.target.value)} placeholder="Saved layout JSON appears here; edit it and press Load to see validation." aria-label="Layout JSON" />
      {msg && <p className="text-xs text-amber-300">{msg}</p>}
    </Section>
  );
}

export function XChartAdvancedDemo() {
  return (
    <div className="space-y-4" data-testid="xchart-advanced-demo">
      <IndicatorsSection />
      <DrawingsSection />
      <PanesSyncSection />
      <SessionsSection />
      <LayoutsSection />
    </div>
  );
}
