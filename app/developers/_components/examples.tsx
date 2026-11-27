"use client";

import { useEffect, useRef, useState } from "react";
import type { ChartApi, IndicatorDefinition, XChartPlugin } from "@/lib/xchart-sdk";
import { synthetic, type Candle } from "./data";

type SDK = typeof import("@/lib/xchart-sdk");
type Example = { id: string; title: string; what: string; code: string; charts?: number; run: (sdk: SDK, charts: ChartApi[], log: (s: string) => void) => void | (() => void) };

const midIndicator: IndicatorDefinition = {
  id: "demo-midline",
  name: "Midline",
  description: "Average of the highest high and lowest low over a window",
  params: [{ key: "length", label: "Length", type: "integer", default: 20, min: 2, max: 500 }],
  inputs: ["high", "low"],
  outputs: [{ key: "mid", label: "Midline", type: "line", color: "#f59e0b", width: 2 }],
  pane: "overlay",
  warmup: (p) => Number(p.length) - 1,
  lookback: (p) => Number(p.length) - 1,
  calculate: (i, p) => {
    const n = Number(p.length);
    return {
      mid: i.high.map((_, k) => {
        if (k < n - 1) return NaN;
        let hi = -Infinity, lo = Infinity;
        for (let j = k - n + 1; j <= k; j++) {
          hi = Math.max(hi, i.high[j]);
          lo = Math.min(lo, i.low[j]);
        }
        return (hi + lo) / 2;
      }),
    };
  },
};

const rangePlugin: XChartPlugin = {
  id: "demo/session-range",
  version: "1.0.0",
  install(ctx) {
    ctx.addLayer({
      z: "below",
      draw(api) {
        // Shade the high–low range of the visible bars, using the chart's own price mapping.
        let hi = -Infinity, lo = Infinity;
        for (let i = api.from; i <= api.to; i++) {
          const b = api.bar(i);
          if (b) { hi = Math.max(hi, b.h); lo = Math.min(lo, b.l); }
        }
        if (!Number.isFinite(hi)) return;
        api.ctx.fillStyle = "rgba(56,189,248,0.07)";
        api.ctx.fillRect(0, api.yOfPrice(hi), api.pane.width, api.yOfPrice(lo) - api.yOfPrice(hi));
        api.axisLabel(api.yOfPrice(hi), "range hi", "#0369a1");
      },
    });
  },
};

export const EXAMPLES: Example[] = [
  {
    id: "basics",
    title: "Candles, indicators and live updates",
    what: "Candlestick series, an EMA overlay and an RSI pane; a new tick every 400 ms updates the last candle in place (indicators update incrementally).",
    code: `
const chart = createChart(el, { theme: "dark" });
const candles = chart.addCandlestickSeries();
candles.setData(data);                          // [{ time, open, high, low, close, volume }]
chart.addIndicator("ema", { length: 20, color: "#38bdf8" });
chart.addIndicator("rsi", { length: 14 });

setInterval(() => {
  const last = data[data.length - 1];
  const close = last.close * (1 + (Math.random() - 0.5) * 0.002);
  candles.update({ ...last, close, high: Math.max(last.high, close), low: Math.min(last.low, close) });
}, 400);`,
    run: (_sdk, [chart]) => {
      const data = synthetic(300);
      const candles = chart.addCandlestickSeries();
      candles.setData(data);
      chart.addIndicator("ema", { length: 20, color: "#38bdf8" });
      chart.addIndicator("rsi", { length: 14 });
      const t = window.setInterval(() => {
        const last = data[data.length - 1];
        const close = last.close * (1 + (Math.random() - 0.5) * 0.002);
        data[data.length - 1] = { ...last, close, high: Math.max(last.high, close), low: Math.min(last.low, close) };
        candles.update(data[data.length - 1]);
      }, 400);
      return () => window.clearInterval(t);
    },
  },
  {
    id: "custom-indicator",
    title: "Custom indicator",
    what: "A user-defined indicator registered on the chart: parameters are validated against its schema, and a finite `lookback` lets live updates recompute only the tail.",
    code: `
chart.registerIndicator({
  id: "demo-midline", name: "Midline", description: "Average of the highest high and lowest low",
  params: [{ key: "length", label: "Length", type: "integer", default: 20, min: 2, max: 500 }],
  inputs: ["high", "low"],
  outputs: [{ key: "mid", label: "Midline", type: "line", color: "#f59e0b", width: 2 }],
  pane: "overlay",
  warmup: (p) => p.length - 1,
  lookback: (p) => p.length - 1,     // finite memory: live ticks recompute the tail only
  calculate: (i, p) => ({ mid: i.high.map((_, k) => /* highest high + lowest low over p.length bars */ …) }),
});
chart.addIndicator("demo-midline", { length: 30 });`,
    run: (_sdk, [chart], log) => {
      chart.addCandlestickSeries().setData(synthetic(250, { seed: 11 }));
      chart.registerIndicator(midIndicator);
      const ind = chart.addIndicator("demo-midline", { length: 30 });
      try {
        ind.setParameters({ length: 1 });
      } catch (e) {
        log(`Rejected as expected: ${(e as Error).message}`);
      }
    },
  },
  {
    id: "custom-series",
    title: "Custom series: cloud, markers and price lines",
    what: "A two-line cloud series (filled between upper and lower), markers on chosen bars and price lines, all drawn from your own values.",
    code: `
const cloud = chart.addCloudSeries({ upColor: "rgba(34,197,94,0.25)", downColor: "rgba(239,68,68,0.25)" });
cloud.setData(data.map((d) => ({ time: d.time, upper: d.close * 1.02, lower: d.close * 0.98 })));
candles.setMarkers([{ time: data[120].time, position: "belowBar", shape: "arrowUp", color: "#22c55e", text: "Signal" }]);
candles.createPriceLine({ price: 1000, color: "#f59e0b", lineStyle: "dashed", title: "Level" });`,
    run: (_sdk, [chart]) => {
      const data = synthetic(220, { seed: 5 });
      const candles = chart.addCandlestickSeries();
      candles.setData(data);
      const cloud = chart.addCloudSeries({ upColor: "rgba(34,197,94,0.25)", downColor: "rgba(239,68,68,0.25)" });
      cloud.setData(data.map((d) => ({ time: d.time, upper: d.close * 1.02, lower: d.close * 0.98 })));
      candles.setMarkers([{ time: data[120].time, position: "belowBar", shape: "arrowUp", color: "#22c55e", text: "Signal" }]);
      candles.createPriceLine({ price: Math.round(data[150].close), color: "#f59e0b", lineStyle: "dashed", title: "Level" });
    },
  },
  {
    id: "drawings",
    title: "Drawing API",
    what: "Drawings created from code, serialised to JSON and restored. Choose a tool to draw with the pointer; Delete removes the selection, Ctrl/⌘+Z undoes.",
    code: `
chart.addDrawing({ type: "trendline", points: [{ time: t1, price: p1 }, { time: t2, price: p2 }], style: { color: "#38bdf8" } });
chart.addDrawing({ type: "fib-retracement", points: [{ time: t3, price: low }, { time: t4, price: high }] });
const saved = chart.serializeDrawings();   // plain JSON, validated on load
chart.clearDrawings();
chart.loadDrawings(saved);
chart.setDrawingTool("rectangle");         // interactive: click–drag on the chart`,
    run: (_sdk, [chart], log) => {
      const d = synthetic(200, { seed: 3 });
      chart.addCandlestickSeries().setData(d);
      chart.addDrawing({ type: "trendline", points: [{ time: d[40].time, price: d[40].low }, { time: d[150].time, price: d[150].low }], style: { color: "#38bdf8", lineWidth: 2 } });
      chart.addDrawing({ type: "fib-retracement", points: [{ time: d[60].time, price: Math.min(...d.slice(60, 140).map((x) => x.low)) }, { time: d[140].time, price: Math.max(...d.slice(60, 140).map((x) => x.high)) }] });
      const saved = chart.serializeDrawings();
      chart.clearDrawings();
      chart.loadDrawings(saved);
      log(`Serialised ${saved.length} drawings (${JSON.stringify(saved).length} bytes) and restored them. Tools: ${chart.drawingTools().length}.`);
      chart.setDrawingTool("rectangle");
    },
  },
  {
    id: "plugin",
    title: "Plugin layer",
    what: "A plugin adds a canvas layer drawn with the chart's own coordinate mapping (here: the visible high–low range). Plugins are trusted application code; errors are isolated and reported.",
    code: `
chart.use({
  id: "demo/session-range",
  install(ctx) {
    ctx.addLayer({
      z: "below",
      draw(api) {
        // api.from / api.to: visible bars; api.bar(i): OHLC; api.yOfPrice(p): price → y
        api.ctx.fillRect(0, api.yOfPrice(hi), api.pane.width, api.yOfPrice(lo) - api.yOfPrice(hi));
        api.axisLabel(api.yOfPrice(hi), "range hi", "#0369a1");
      },
    });
  },
});
chart.on("pluginError", (e) => console.warn(e.pluginId, e.error));`,
    run: (_sdk, [chart]) => {
      chart.addCandlestickSeries().setData(synthetic(260, { seed: 21 }));
      chart.use(rangePlugin);
    },
  },
  {
    id: "adapter",
    title: "Market-data adapter with validation",
    what: "Your feed's format converted to XChart bars. Invalid records are rejected with a typed error before anything is drawn: nothing is repaired or invented.",
    code: `
// Example feed format: { ts: "2026-01-05T09:15:00+05:30", o, h, l, c, vol }
const toBars = (rows) => rows.map((r) => ({ time: Date.parse(r.ts) / 1000, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.vol }));
try {
  candles.setData(toBars(feed));             // throws XChartError on high < low, NaN, unsorted or duplicate times…
} catch (e) {
  if (e instanceof XChartError) console.warn(e.code, e.message);
}`,
    run: (sdk, [chart], log) => {
      const feed = synthetic(120, { seed: 9, step: 300, start: Date.UTC(2026, 0, 5, 3, 45) / 1000 }).map((b) => ({ ts: new Date(b.time * 1000).toISOString(), o: b.open, h: b.high, l: b.low, c: b.close, vol: b.volume }));
      const toBars = (rows: typeof feed) => rows.map((r) => ({ time: Date.parse(r.ts) / 1000, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.vol }));
      const candles = chart.addCandlestickSeries();
      const broken = feed.map((r, i) => (i === 50 ? { ...r, h: r.l - 1 } : r));
      try {
        candles.setData(toBars(broken));
      } catch (e) {
        if (e instanceof sdk.XChartError) log(`Rejected bad feed: ${e.code} — ${e.message}`);
      }
      candles.setData(toBars(feed));
      log(`Loaded ${feed.length} valid 5-minute bars.`);
    },
  },
  {
    id: "price-based",
    title: "Price-based chart types",
    what: "The same candles as Renko, Kagi, Point & Figure, Line Break or Range bars, on a logical axis. Confirmed elements never change; the live candle's elements are provisional.",
    code: `
chart.setChartType("renko", { method: "atr", size: 1, atrPeriod: 14 });
chart.setChartType("point-and-figure", { boxSize: 10, reversal: 3, source: "high-low" });
chart.getDerivedInfo();   // { points, provisional, methodology, hidden }`,
    run: (_sdk, [chart], log) => {
      chart.addCandlestickSeries().setData(synthetic(400, { seed: 31 }));
      chart.setChartType("renko", { method: "atr", size: 1, atrPeriod: 14 });
      const info = chart.getDerivedInfo();
      log(`${info?.points.length} bricks · ${info?.methodology}`);
    },
  },
  {
    id: "sync",
    title: "Multi-pane layout and synchronisation",
    charts: 2,
    what: "Two charts synchronised by time (pan, zoom and crosshair), each with its own panes and independent scales.",
    code: `
const group = syncCharts([chartA, chartB], { timeRange: true, crosshair: true });
chartB.priceScale("right").applyOptions({ mode: "percentage" });
chartA.addIndicator("macd");          // own pane
// later: group.destroy();`,
    run: (sdk, [a, b]) => {
      a.addCandlestickSeries().setData(synthetic(300, { seed: 41 }));
      b.addCandlestickSeries().setData(synthetic(300, { seed: 43, base: 450 }));
      a.addIndicator("macd");
      b.priceScale("right").applyOptions({ mode: "percentage" });
      const g = sdk.syncCharts([a, b], { timeRange: true, crosshair: true });
      return () => g.destroy();
    },
  },
];

export function ExampleView({ example }: { example: Example }) {
  const boxes = useRef<(HTMLDivElement | null)[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const n = example.charts ?? 1;
  useEffect(() => {
    let disposed = false;
    let charts: ChartApi[] = [];
    let cleanup: void | (() => void);
    import("@/lib/xchart-sdk").then((sdk) => {
      if (disposed) return;
      charts = boxes.current.slice(0, n).map((el) => sdk.createChart(el!, { theme: "dark" }));
      cleanup = example.run(sdk, charts, (s) => setLog((l) => [...l, s]));
    });
    return () => {
      disposed = true;
      cleanup?.();
      for (const c of charts) c.remove();
    };
  }, [example, n]);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-2" data-testid={`example-${example.id}`}>
      <div className="space-y-2">
        {Array.from({ length: n }, (_, i) => (
          <div key={i} ref={(el) => { boxes.current[i] = el; }} className="w-full overflow-hidden rounded-xl border border-line" style={{ height: n > 1 ? 220 : 360 }} />
        ))}
        {log.length > 0 && <ul className="space-y-0.5 font-mono text-[11px] text-muted">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      </div>
      <pre className="max-h-[440px] overflow-auto rounded-xl border border-line bg-panel p-3 font-mono text-[12px] leading-relaxed text-soft"><code>{example.code.trim()}</code></pre>
    </div>
  );
}

export function ExampleTabs() {
  const [id, setId] = useState(EXAMPLES[0].id);
  const ex = EXAMPLES.find((e) => e.id === id)!;
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Examples" className="flex flex-wrap gap-1">
        {EXAMPLES.map((e) => (
          <button key={e.id} role="tab" aria-selected={e.id === id} onClick={() => setId(e.id)} className={`rounded-lg border px-2.5 py-1 text-xs ${e.id === id ? "border-accent/50 bg-accent/10 text-white" : "border-line text-soft hover:bg-white/5"}`}>
            {e.title}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted">{ex.what}</p>
      <ExampleView key={ex.id} example={ex} />
    </div>
  );
}

export type { Candle };
