import test from "node:test";
import assert from "node:assert/strict";
import { createChartWithAdapter } from "../lib/xchart-sdk/create-chart.ts";
import type { RenderAdapter, RenderModel } from "../lib/xchart-sdk/canvas-adapter.ts";
import type { EngineLayer, LayerApi } from "../components/chart/engine.ts";
import type { Change } from "../lib/xchart-sdk/store.ts";
import type { CandlestickData } from "../lib/xchart-sdk/types.ts";
import { XChartError } from "../lib/xchart-sdk/validation.ts";
import { PRICE_CHART_TYPES, TIME_CHART_TYPES, heikinAshi, kagi, lineBreak, pointAndFigure, rangeBars, renko } from "../lib/xchart-sdk/chart-types.ts";
import { parseLayout } from "../lib/xchart-sdk/layout.ts";
import type { XChartPlugin } from "../lib/xchart-sdk/plugins.ts";
import type { IndicatorDefinition } from "../lib/xchart-sdk/indicators/types.ts";

class Fake implements RenderAdapter {
  last: RenderModel | null = null;
  layers: EngineLayer[] = [];
  crossCb: ((i: number | null, t: number | null, p: number | null) => void) | null = null;
  render(m: RenderModel, _c: Change) { this.last = m; }
  setOptions() {}
  onCrosshair(cb: (i: number | null, t: number | null, p: number | null) => void) { this.crossCb = cb; }
  getViewRange() { return this.last && this.last.times.length ? { from: 0, to: this.last.times.length - 1 } : null; }
  setViewRange() {}
  fit() {}
  scrollToEnd() {}
  scrollBy() {}
  zoom() {}
  resize() {}
  destroy() {}
  setLayers(l: EngineLayer[]) { this.layers = l; }
  requestRedraw() {}
}
const DAY = 86400;
const T0 = 1_767_225_600;
function candles(n: number): CandlestickData[] {
  let p = 100;
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    const c = o + Math.sin(i * 1.7) * 3;
    p = c;
    return { time: T0 + i * DAY, open: o, high: Math.max(o, c) + 1, low: Math.min(o, c) - 1, close: c, volume: 100 + i };
  });
}
const code = (c: string) => (e: unknown) => e instanceof XChartError && e.code === c;
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≉ ${b}`);

test("chart types: time-based types map to the renderer; price-based types are reported unsupported", () => {
  const f = new Fake();
  const chart = createChartWithAdapter(f);
  const s = chart.addCandlestickSeries();
  const data = candles(30);
  s.setData(data);
  const expect: Record<string, string> = { candles: "candles", "hollow-candles": "hollow", bars: "bars", "heikin-ashi": "candles", line: "line", "step-line": "step", "line-markers": "line", area: "area", baseline: "baseline", "high-low": "hilo", columns: "columns" };
  for (const t of TIME_CHART_TYPES) {
    chart.setChartType(t);
    assert.equal(f.last!.chartType, expect[t], t);
  }
  assert.equal(f.last!.mainStyle!.markers, false);
  chart.setChartType("line-markers", { lineColor: "#ff0000", lineWidth: 2 });
  assert.equal(f.last!.mainStyle!.markers, true);
  assert.equal(f.last!.mainStyle!.line, "#ff0000");
  for (const t of PRICE_CHART_TYPES) assert.throws(() => chart.setChartType(t as never), code("UNSUPPORTED_CHART_TYPE"));
  assert.throws(() => chart.setChartType("baseline", { baseline: NaN }), XChartError);
  assert.throws(() => chart.setChartType("line", { lineColor: "nope" }), XChartError);
  assert.throws(() => chart.setChartType("spiral" as never), XChartError);
  assert.deepEqual(chart.getChartType(), { type: "line-markers", style: { lineColor: "#ff0000", lineWidth: 2 } }, "rejected calls change nothing");
  assert.deepEqual(s.data(), data, "chart types never modify series data");
});

test("Heikin Ashi: correct values, original data kept, in-place live updates, real last price", () => {
  const f = new Fake();
  const chart = createChartWithAdapter(f);
  const s = chart.addCandlestickSeries();
  const data = candles(40);
  s.setData(data);
  chart.setChartType("heikin-ashi");
  const ha = f.last!.bars;
  // Reference: textbook Heikin Ashi.
  let po = (data[0].open + data[0].close) / 2, pc = (data[0].open + data[0].high + data[0].low + data[0].close) / 4;
  near(ha[0].o, po);
  near(ha[0].c, pc);
  for (let i = 1; i < data.length; i++) {
    const d = data[i];
    const c = (d.open + d.high + d.low + d.close) / 4;
    const o = (po + pc) / 2;
    near(ha[i].o, o);
    near(ha[i].c, c);
    near(ha[i].h, Math.max(d.high, o, c));
    near(ha[i].l, Math.min(d.low, o, c));
    po = o;
    pc = c;
  }
  assert.deepEqual(s.data(), data, "store keeps the original OHLC");
  // Live tick: the same display array is updated in place (cheap tick path).
  const last = data[39];
  s.update({ ...last, close: last.close + 5, high: last.high + 5 });
  assert.equal(f.last!.bars, ha, "same array instance");
  near(ha[39].c, (last.open + last.high + 5 + last.low + last.close + 5) / 4);
  s.update({ time: last.time + DAY, open: 100, high: 104, low: 99, close: 103 });
  assert.equal(ha.length, 41);
  assert.equal(f.last!.lastPrice!.price, 103, "the axis label shows the real close, not the HA close");
  // Crosshair: seriesData is the real candle; display is the drawn HA candle.
  let ev: { seriesData: Map<unknown, unknown>; display?: unknown } | null = null;
  chart.subscribeCrosshairMove((e) => (ev = e as never));
  f.crossCb!(40, null, 100);
  const real = [...ev!.seriesData.values()][0] as CandlestickData;
  assert.equal(real.close, 103);
  assert.ok(ev!.display && (ev!.display as { close: number }).close !== 103);
  // Gaps stay gaps.
  const out = heikinAshi([{ t: 1, o: 1, h: 2, l: 0, c: 1.5, v: 0 }, { t: 2, o: NaN, h: NaN, l: NaN, c: NaN, v: 0 }, { t: 3, o: 2, h: 3, l: 1, c: 2.5, v: 0 }]);
  assert.ok(Number.isNaN(out[1].c));
  near(out[2].o, (out[0].o + out[0].c) / 2);
  chart.setChartType("candles");
  assert.notEqual(f.last!.bars, ha);
  assert.equal(f.last!.lastPrice, undefined);
});

test("price-based calculations (exported, not rendered)", () => {
  const cl = (xs: number[]) => xs.map((close, i) => ({ time: i, close }));
  const r = renko(cl([100, 101, 102.5, 104, 103.5, 101.5, 99, 98.9]), 1);
  assert.deepEqual(r.map((b) => [b.open, b.close, b.up]), [[100, 101, true], [101, 102, true], [102, 103, true], [103, 104, true], [103, 102, false], [102, 101, false], [101, 100, false], [100, 99, false]]);
  assert.equal(renko(cl([100, 100.5, 99.5]), 1).length, 0, "no brick inside one box");
  assert.equal(renko(cl([100, 101, 100.2]), 1).length, 1, "a reversal needs two boxes");
  assert.throws(() => renko(cl([1]), 0), XChartError);
  const k = kagi(cl([10, 12, 15, 13, 11, 14, 17]), 2);
  assert.deepEqual(k.map((l) => [l.from, l.to, l.up]), [[10, 15, true], [15, 11, false], [11, 17, true]]);
  assert.equal(k[2].thick, true, "breaking the previous shoulder is yang");
  const p = pointAndFigure(cl([100, 101, 102, 103, 104, 101, 100, 99, 103]), 1, 3);
  assert.deepEqual(p.map((c) => [c.kind, c.low, c.high]), [["X", 101, 104], ["O", 99, 103], ["X", 100, 103]]);
  assert.throws(() => pointAndFigure(cl([1]), 1, 0), XChartError);
  const lb = lineBreak(cl([10, 11, 12, 13, 12.5, 9.5, 9]), 3);
  assert.deepEqual(lb.map((l) => [l.open, l.close, l.up]), [[10, 11, true], [11, 12, true], [12, 13, true], [12, 9.5, false], [9.5, 9, false]]);
  const rb = rangeBars(cl([100, 101, 102.5, 101]), 2);
  assert.ok(rb.every((b) => Math.abs(b.high - b.low - 2) < 1e-9));
  assert.equal(rb[0].close, 102);
});

function richChart(f = new Fake()) {
  const chart = createChartWithAdapter(f, { theme: "light", timeZone: "Asia/Kolkata" });
  const c = chart.addCandlestickSeries({ upColor: "#00ff00" });
  c.setData(candles(60));
  const vol = chart.addHistogramSeries({ pane: "main", priceScaleId: "vol", color: "#888888" });
  vol.setData(candles(60).map((x) => ({ time: x.time, value: x.volume! })));
  const sig = chart.addLineSeries({ pane: "separate", color: "#123456" });
  sig.setData(candles(60).map((x) => ({ time: x.time, value: x.close / 2 })));
  chart.addIndicator("sma", { period: 7, color: "#ff8800" });
  chart.addIndicator("rsi", { period: 10 });
  chart.addDrawing({ id: "tl", type: "trendline", points: [{ time: T0, price: 100 }, { time: T0 + 10 * DAY, price: 110 }], style: { color: "#ff0000" } });
  chart.priceScale("vol").applyOptions({ margins: { top: 0.75, bottom: 0 } });
  chart.setChartType("hollow-candles");
  chart.pane(`xs-3`)!.setHeight(120);
  chart.pane("xind-rsi-2")!.collapse();
  chart.setSessionHighlight({ calendar: "NSE" });
  return { chart, f };
}

test("layouts: save is JSON-safe, allow-listed and excludes market data by default", () => {
  const { chart } = richChart();
  const L = chart.saveLayout();
  const json = JSON.stringify(L);
  assert.equal(L.format, "xchart-layout");
  assert.equal(L.version, 1);
  assert.ok(L.series.every((s) => s.data === undefined), "no market data by default");
  assert.ok(!/token|secret|password|apiKey|credential/i.test(json));
  assert.deepEqual(L.chart, { theme: "light", crosshair: true, followLatest: false, timeZone: "Asia/Kolkata" });
  assert.deepEqual(L.chartType, { type: "hollow-candles", style: {} });
  assert.deepEqual(L.indicators.map((i) => [i.type, i.params.length ?? i.params.period]), [["sma", 7], ["rsi", 10]]);
  assert.deepEqual(L.priceScales, { vol: { margins: { top: 0.75, bottom: 0 } } });
  assert.deepEqual(L.panes.collapsed, ["indicator:1"], "pane ids are saved as portable references");
  assert.equal(L.panes.sizes!["series:2"], 120);
  assert.deepEqual(L.session, { calendar: "NSE" });
  assert.equal(L.drawings.length, 1);
  const withData = chart.saveLayout({ includeData: true });
  assert.equal(withData.series[0].data!.length, 60);
  assert.deepEqual(parseLayout(json), parseLayout(L), "round-trips through a string");
});

test("layouts: load recreates the look on a fresh chart and on a chart with its own data", () => {
  const { chart } = richChart();
  const L = chart.saveLayout({ includeData: true });
  // Fresh chart: series are created from the layout data.
  const f2 = new Fake();
  const fresh = createChartWithAdapter(f2);
  const rep = fresh.loadLayout(JSON.stringify(L));
  assert.deepEqual([rep.seriesCreated, rep.seriesMatched, rep.indicatorsAdded], [3, 0, 2]);
  const again = fresh.saveLayout({ includeData: true });
  assert.deepEqual(again, { ...L }, "save → load → save is stable");
  // Chart with its own data: series matched by type and order; no layout data applied when absent.
  const f3 = new Fake();
  const other = createChartWithAdapter(f3);
  const own = candles(20).map((c) => ({ ...c, open: c.open + 1000, high: c.high + 1000, low: c.low + 1000, close: c.close + 1000 }));
  const oc = other.addCandlestickSeries();
  oc.setData(own);
  const rep3 = other.loadLayout(chart.saveLayout());
  assert.deepEqual([rep3.seriesMatched, rep3.seriesCreated, rep3.seriesSkipped], [1, 0, 2]);
  assert.deepEqual(oc.data(), own, "the target chart's market data is untouched");
  assert.equal(oc.options().upColor, "#00ff00");
  assert.deepEqual(other.getIndicators().map((i) => i.type), ["sma", "rsi"]);
  assert.equal(other.getChartType().type, "hollow-candles");
  assert.equal(other.getDrawing("tl")!.data().style.color, "#ff0000");
});

test("layouts: validation is strict and atomic; nothing executes", () => {
  const { chart } = richChart();
  const good = chart.saveLayout();
  const target = richChart().chart;
  const before = JSON.stringify(target.saveLayout());
  const bad: unknown[] = [
    "{not json",
    '{"format":"xchart-layout","version":1,"__proto__":{"polluted":true}}',
    { ...good, version: 2 },
    { ...good, format: "other" },
    { ...good, extra: 1 },
    { ...good, chart: { ...good.chart, apiKey: "x" } },
    { ...good, chart: { ...good.chart, theme: "neon" } },
    { ...good, chartType: { type: "renko", style: {} } },
    { ...good, indicators: [{ type: "sma", params: { period: -3 }, options: {} }] },
    { ...good, indicators: [{ type: "sma", params: {}, options: { onDraw: "alert(1)" } }] },
    { ...good, indicators: [{ type: "evil", params: {}, options: {} }] },
    { ...good, drawings: [{ type: "trendline", points: [] }] },
    { ...good, priceScales: { vol: { margins: { top: 2, bottom: 0 } } } },
    { ...good, series: [{ type: "line", options: { color: "javascript:alert(1)" } }] },
    { ...good, series: [{ type: "line", options: {}, data: [{ time: 2, value: 1 }, { time: 1, value: 1 }] }] },
    { ...good, session: { calendar: "MOON" } },
    { ...good, panes: { sizes: { main: 1e9 }, collapsed: [], order: [] } },
    JSON.parse(JSON.stringify(good, (_k, v) => v)) && { ...good, drawings: [{ type: "trendline", points: [{ time: 1, price: 1 }, { time: 2, price: 2 }], style: { onClick: "x" } }] },
  ];
  let deep: Record<string, unknown> = {};
  const root = deep;
  for (let i = 0; i < 40; i++) deep = deep.x = {} as Record<string, unknown>;
  bad.push({ ...good, chart: root });
  for (const [i, b] of bad.entries()) assert.throws(() => target.loadLayout(b), XChartError, `bad layout ${i} rejected`);
  assert.equal(JSON.stringify(target.saveLayout()), before, "rejected loads change nothing");
  assert.equal(({} as Record<string, unknown>).polluted, undefined, "no prototype pollution");
  // Unknown indicators can be skipped explicitly; plugin ids are only reported.
  const rep = target.loadLayout({ ...good, indicators: [...good.indicators, { type: "evil", params: {}, options: {} }], plugins: ["my-plugin"] }, { skipUnknownIndicators: true });
  assert.deepEqual(rep.indicatorsSkipped, ["evil"]);
  assert.deepEqual(rep.pluginsNotInstalled, ["my-plugin"]);
  assert.deepEqual(target.plugins(), []);
});

test("plugins: controlled context, tracked registrations, rollback, isolation, cleanup", () => {
  const f = new Fake();
  const chart = createChartWithAdapter(f);
  chart.addCandlestickSeries().setData(candles(30));
  const baseLayers = f.layers.length;
  const errors: string[] = [];
  chart.on("pluginError", (e) => errors.push(`${e.pluginId}: ${e.error}`));
  const doubled: IndicatorDefinition = {
    id: "double-close", name: "Double close", description: "Close × 2 (test plugin)", params: [], inputs: ["close"], pane: "overlay",
    outputs: [{ key: "v", name: "2×close", type: "line", color: "#ff00ff" }],
    warmup: () => 0,
    calculate: (input: { close: number[] }) => ({ v: input.close.map((c) => c * 2) }),
    display: {},
  } as unknown as IndicatorDefinition;
  let destroyed = 0;
  const seen: string[] = [];
  const plugin: XChartPlugin = {
    id: "acme/overlay",
    version: "1.0.0",
    install(ctx) {
      ctx.addLayer({ z: "below", draw: (api) => void api.ctx });
      ctx.registerIndicator(doubled);
      ctx.registerDrawingTool("box-note", { anchors: 2, render: () => {}, hit: () => false });
      ctx.on("seriesUpdate", () => seen.push("update"));
      return { destroy: () => void destroyed++ };
    },
  };
  chart.use(plugin);
  assert.equal(f.layers.length, baseLayers + 1);
  assert.deepEqual(chart.plugins(), [{ id: "acme/overlay", version: "1.0.0", layers: 1, indicators: ["double-close"], tools: ["box-note"] }]);
  const ind = chart.addIndicator("double-close");
  assert.equal(ind.getValues().at(-1)!.values.v, candles(30)[29].close * 2);
  chart.addDrawing({ type: "box-note", points: [{ time: T0, price: 1 }, { time: T0 + DAY, price: 2 }] });
  assert.ok(chart.drawingTools().includes("box-note"));
  assert.throws(() => chart.use(plugin), code("PLUGIN_FAILED"), "duplicate id");
  assert.throws(() => chart.use({ id: "bad id!", install() {} }), code("PLUGIN_FAILED"));
  // A failing install is rolled back completely.
  assert.throws(() => chart.use({ id: "broken", install(ctx) {
    ctx.addLayer({ draw() {} });
    ctx.registerIndicator({ ...doubled, id: "half-close" } as IndicatorDefinition);
    throw new Error("boom");
  } }), code("PLUGIN_FAILED"));
  assert.equal(chart.getIndicatorDefinition("half-close"), undefined);
  assert.equal(f.layers.length, baseLayers + 1);
  // A throwing layer is isolated and reported once.
  chart.use({ id: "throws", install(ctx) {
    ctx.addLayer({ draw() { throw new Error("draw failed"); } });
    ctx.on("seriesUpdate", () => { throw new Error("handler failed"); });
  } });
  const api = {} as LayerApi;
  const pluginLayers = f.layers.slice(0, -1); // the last layer is the chart's own drawing layer
  for (const l of pluginLayers) assert.doesNotThrow(() => l.draw(api));
  for (const l of pluginLayers) l.draw(api);
  chart.addLineSeries().setData([{ time: T0, value: 1 }]);
  assert.deepEqual(errors, ["throws: draw failed", "throws: handler failed"]);
  assert.deepEqual(seen, ["update"]);
  // Removing a plugin removes everything it registered (and instances using it).
  assert.equal(chart.removePlugin("acme/overlay"), true);
  assert.equal(destroyed, 1);
  assert.equal(chart.getIndicatorDefinition("double-close"), undefined);
  assert.equal(chart.getIndicators().length, 0);
  assert.ok(!chart.drawingTools().includes("box-note"));
  assert.equal(chart.getDrawings().length, 0);
  assert.equal(chart.removePlugin("acme/overlay"), false);
  chart.use({ ...plugin, id: "again" });
  chart.remove();
  assert.equal(destroyed, 2, "chart.remove() destroys installed plugins");
});

test("events: once() fires a single time", () => {
  const f = new Fake();
  const chart = createChartWithAdapter(f);
  const s = chart.addLineSeries();
  let n = 0;
  chart.once("seriesUpdate", () => n++);
  s.setData([{ time: T0, value: 1 }]);
  s.update({ time: T0 + DAY, value: 2 });
  assert.equal(n, 1);
  const off = chart.once("seriesUpdate", () => n++);
  off();
  s.update({ time: T0 + 2 * DAY, value: 3 });
  assert.equal(n, 1);
});
