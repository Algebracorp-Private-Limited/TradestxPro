import test from "node:test";
import assert from "node:assert/strict";
import { createChartWithAdapter } from "../lib/xchart-sdk/create-chart.ts";
import type { RenderAdapter, RenderModel } from "../lib/xchart-sdk/canvas-adapter.ts";
import type { InteractionDelegate, EngineLayer, PointerInfo } from "../components/chart/engine.ts";
import type { Change } from "../lib/xchart-sdk/store.ts";
import type { CandlestickData } from "../lib/xchart-sdk/types.ts";
import { XChartError } from "../lib/xchart-sdk/validation.ts";
import { DERIVED_KINDS, DerivedSeriesEngine, computeDerived, type DerivedKind, type SourceCandle } from "../lib/xchart-sdk/derived/index.ts";

const T0 = 1_767_225_600, DAY = 86400;
const C = (i: number, o: number, h: number, l: number, c: number): SourceCandle => ({ time: T0 + i * DAY, open: o, high: h, low: l, close: c });
const closes = (xs: number[]) => xs.map((c, i) => C(i, c, c, c, c));
function walk(n: number, seed = 3, base = 100): CandlestickData[] {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let p = base;
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    const c = Math.max(1, o + (r() - 0.5) * 4);
    p = c;
    return { time: T0 + i * DAY, open: o, high: Math.max(o, c) + r() * 2, low: Math.min(o, c) - r() * 2, close: c, volume: 1000 };
  });
}
const pick = (pts: { open: number; close: number; direction: number }[]) => pts.map((p) => [p.open, p.close, p.direction]);

test("Renko: fixed bricks, reversal rules, wicks, multiple bricks per candle", () => {
  const r = computeDerived("renko", closes([100, 101, 102.5, 104, 103.5, 101.5, 99, 98.9]), { size: 1 });
  assert.deepEqual(pick(r), [[100, 101, 1], [101, 102, 1], [102, 103, 1], [103, 104, 1], [103, 102, -1], [102, 101, -1], [101, 100, -1], [100, 99, -1]]);
  assert.equal(r.filter((p) => p.sourceIndex === 2).length, 1);
  assert.equal(r.filter((p) => p.sourceIndex === 6).length, 3, "three bricks from one candle");
  assert.deepEqual(r.filter((p) => p.sourceIndex === 6).map((p) => p.seq), [0, 1, 2]);
  assert.equal(new Set(r.map((p) => p.id)).size, r.length, "unique ids");
  // Reversal 1: a single brick of movement reverses.
  assert.deepEqual(pick(computeDerived("renko", closes([100, 102, 101]), { size: 1, reversal: 1 })), [[100, 101, 1], [101, 102, 1], [102, 101, -1]]);
  // Percentage: each brick is 10 % of the previous brick close.
  const pct = computeDerived("renko", closes([100, 111, 122.2]), { method: "percentage", size: 10 });
  assert.deepEqual(pct.map((p) => +p.close.toFixed(6)), [110, 121]);
  // Wicks: an up brick's low shows the dip since the previous brick.
  const w = computeDerived("renko", [C(0, 100, 100, 100, 100), C(1, 100, 101.2, 97.6, 101.1)], { size: 1, wicks: true, source: "high-low" });
  assert.ok(w.every((p) => p.reconstructed));
  assert.ok(w.some((p) => p.direction === 1 && p.low < p.open), "wick below the brick");
});

test("Renko ATR bricks are causal and never recalculated", () => {
  const data = walk(120, 9);
  const all = computeDerived("renko", data, { method: "atr", size: 1, atrPeriod: 14 });
  assert.ok(all.length > 5);
  assert.ok(all.every((p) => p.sourceIndex >= 14), "no brick before the ATR exists (14 candles)");
  // Prefix property: bricks confirmed by candle k do not change when later candles arrive.
  for (const k of [20, 50, 90]) {
    const pre = computeDerived("renko", data.slice(0, k + 1), { method: "atr", size: 1, atrPeriod: 14 }).filter((p) => p.status === "confirmed");
    assert.deepEqual(pre.map((p) => [p.open, p.close, p.size]), all.filter((p) => p.sourceIndex < k).map((p) => [p.open, p.close, p.size]));
  }
  const sizes = new Set(all.map((p) => p.size!.toFixed(8)));
  assert.ok(sizes.size > 1, "brick size follows the ATR known at each brick");
});

test("Kagi: reversals, yang/yin switching at shoulders and waists", () => {
  const k = computeDerived("kagi", closes([10, 12, 15, 13, 11, 14, 17, 12, 9]), { reversal: 2 });
  assert.deepEqual(k.map((p) => [p.open, p.close, p.direction]), [[10, 15, 1], [15, 11, -1], [11, 17, 1], [17, 9, -1]]);
  assert.equal(k[0].thickEnd, true, "first rising line is yang");
  assert.equal(k[2].thickEnd, true);
  // Line 4 falls below the previous waist (11): switches to yin at 11.
  assert.equal(k[3].thickStart, true);
  assert.equal(k[3].thickEnd, false);
  assert.equal(k[3].switchPrice, 11);
  assert.equal(k[3].status, "provisional", "the last line is still open");
  // A falling first line is yin; rising above the previous shoulder switches to yang.
  const k2 = computeDerived("kagi", closes([20, 17, 19, 15, 21]), { reversal: 2 });
  assert.deepEqual(k2.map((p) => [p.thickStart, p.thickEnd, p.switchPrice ?? null]), [[false, false, null], [false, false, null], [false, false, null], [false, true, 19]]);
  const pct = computeDerived("kagi", closes([100, 103, 100.5, 97]), { method: "percentage", reversal: 3 });
  assert.deepEqual(pct.map((p) => [p.open, p.close]), [[100, 103], [103, 97]]);
});

test("Point & Figure: close and high-low methods, percentage boxes, box counts", () => {
  const p = computeDerived("point-and-figure", closes([100, 101, 102, 103, 104, 101, 100, 99, 103]), { boxSize: 1, reversal: 3 });
  assert.deepEqual(p.map((c) => [c.direction > 0 ? "X" : "O", c.low, c.high, c.boxes]), [["X", 101, 104, 4], ["O", 99, 103, 5], ["X", 100, 103, 4]]);
  // High-low: in an X column the high is tested first; the low only if the column did not extend.
  const hl = computeDerived("point-and-figure", [C(0, 100, 100, 100, 100), C(1, 100, 103.5, 100, 103), C(2, 103, 103.2, 99.5, 100), C(3, 100, 104.9, 99.6, 104)], { boxSize: 1, reversal: 3, source: "high-low" });
  assert.deepEqual(hl.map((c) => [c.direction > 0 ? "X" : "O", c.low, c.high]), [["X", 101, 103], ["O", 100, 102], ["X", 101, 104]]);
  // Percentage boxes are logarithmic: levels grow by a constant ratio.
  const e = new DerivedSeriesEngine("point-and-figure", { method: "percentage", boxSize: 2, reversal: 1 });
  e.sync(closes([100, 103, 105, 110]), 1);
  const lvl = e.boxLevel()!;
  assert.ok(Math.abs(lvl(1) / lvl(0) - 1.02) < 1e-12 && Math.abs(lvl(5) / lvl(4) - 1.02) < 1e-12);
  assert.throws(() => computeDerived("point-and-figure", closes([1]), { reversal: 0 }), XChartError);
});

test("Line Break: continuation and reversal lines with N-line rule", () => {
  const lb = computeDerived("line-break", closes([10, 11, 12, 13, 12.5, 9.5, 9]), { lines: 3 });
  assert.deepEqual(lb.map((l) => [l.open, l.close, l.direction, l.reversal]), [[10, 11, 1, false], [11, 12, 1, false], [12, 13, 1, false], [12, 9.5, -1, true], [9.5, 9, -1, false]]);
  // Two-line break reverses earlier: 10.8 breaks the low of the last two lines (11) but not of three (10).
  const two = computeDerived("line-break", closes([10, 11, 12, 13, 10.8]), { lines: 2 });
  assert.equal(two.at(-1)!.reversal, true);
  assert.equal(computeDerived("line-break", closes([10, 11, 12, 13, 10.8]), { lines: 3 }).length, 3);
});

test("Range bars: OHLC path approximation, gaps, completion flags", () => {
  const rb = computeDerived("range-bars", [C(0, 100, 101, 99.5, 100.8), C(1, 100.8, 103.4, 100.5, 103)], { range: 1 });
  assert.ok(rb.every((b) => b.reconstructed), "built from a reconstructed OHLC path");
  const done = rb.filter((b) => b.complete);
  assert.ok(done.every((b) => Math.abs(b.high - b.low - 1) < 1e-9), "every completed bar spans exactly the range");
  assert.equal(rb.at(-1)!.complete, false, "the last bar is still forming");
  assert.equal(rb.at(-1)!.status, "provisional");
  // A gap closes the current bar at its last price: no bars invented inside the gap.
  const g = computeDerived("range-bars", [C(0, 100, 100.4, 99.8, 100.2), C(1, 110, 110.3, 109.9, 110.1)], { range: 1 });
  assert.equal(g[0].close, 100.2);
  assert.ok(g[0].high - g[0].low < 1, "the pre-gap bar is short (closed by the gap)");
  assert.ok(g.every((b) => b.low >= 99.8 && (b.low >= 109.9 || b.high <= 100.4)), "nothing between 100.4 and 109.9");
  const ticks = computeDerived("range-bars", [C(0, 100, 100, 100, 100), C(1, 100, 100.3, 100, 100.3)], { method: "ticks", range: 4, tickSize: 0.05 });
  assert.ok(Math.abs(ticks[0].high - ticks[0].low - 0.2) < 1e-9);
});

test("all types: no look-ahead, live replacement ≡ final candle, append commits", () => {
  const data = walk(300, 17);
  const settings: Record<DerivedKind, object> = { renko: { size: 1 }, kagi: { reversal: 2 }, "point-and-figure": { boxSize: 1, source: "high-low" }, "line-break": { lines: 3 }, "range-bars": { range: 1.5 } };
  for (const kind of DERIVED_KINDS) {
    const full = computeDerived(kind, data, settings[kind]);
    const key = (p: { open: number; close: number; high: number; low: number; sourceIndex: number }) => `${p.sourceIndex}|${p.open}|${p.close}|${p.high}|${p.low}`;
    for (const k of [40, 150, 260]) {
      const pre = computeDerived(kind, data.slice(0, k + 1), settings[kind]).filter((p) => p.status === "confirmed");
      assert.deepEqual(pre.map(key), full.slice(0, pre.length).map(key), `${kind}: prefix ${k} confirmed points unchanged`);
    }
    // Ten updates of the same live candle end exactly like one update with its final values.
    const live = new DerivedSeriesEngine(kind, settings[kind] as never);
    const src = data.slice(0, 200).map((c) => ({ ...c }));
    live.sync(src, 1);
    const last = { ...src[199] };
    for (let i = 0; i < 10; i++) {
      src[199] = { ...last, close: last.close + (i - 5) * 0.7, high: Math.max(last.high, last.close + (i - 5) * 0.7), low: Math.min(last.low, last.close + (i - 5) * 0.7) };
      live.sync(src, 2 + i);
    }
    src[199] = last;
    live.sync(src, 20);
    const once = computeDerived(kind, data.slice(0, 200), settings[kind]);
    assert.deepEqual(live.points.map(key), once.map(key), `${kind}: repeated replacement`);
    // Appending commits the previous candle; the result equals a full calculation.
    for (let i = 200; i < 300; i++) {
      src.push({ ...data[i] });
      live.sync(src, 100 + i);
    }
    assert.deepEqual(live.points.map(key), full.map(key), `${kind}: sequential append`);
    assert.deepEqual(live.points.map((p) => p.logical), full.map((_, i) => i));
  }
});

// ---------- chart integration ----------
class Fake implements RenderAdapter {
  last: RenderModel | null = null;
  lastChange: Change | null = null;
  layers: EngineLayer[] = [];
  delegate: InteractionDelegate | null = null;
  crossCb: ((i: number | null, t: number | null, p: number | null) => void) | null = null;
  view: { from: number; to: number } | null = null;
  fits = 0;
  render(m: RenderModel, c: Change) { this.last = m; this.lastChange = c; }
  setOptions() {}
  onCrosshair(cb: (i: number | null, t: number | null, p: number | null) => void) { this.crossCb = cb; }
  getViewRange() { return this.view ?? (this.last && this.last.bars.length ? { from: 0, to: this.last.bars.length - 1 } : null); }
  setViewRange(from: number, to: number) { this.view = { from, to }; }
  fit() { this.fits++; this.view = null; }
  scrollToEnd() {}
  scrollBy() {}
  zoom() {}
  resize() {}
  destroy() {}
  setLayers(l: EngineLayer[]) { this.layers = l; }
  setInteraction(d: InteractionDelegate | null) { this.delegate = d; }
  requestRedraw() {}
  xOfIndex(i: number) { return i * 10 + 5; }
  indexOfX(x: number) { return (x - 5) / 10; }
  priceToY(p: number) { return 400 - 2 * p; }
  yToPrice(y: number) { return (400 - y) / 2; }
  getPanes() { return [{ id: "main", top: 0, height: 400 }]; }
  getPlotWidth() { return 800; }
  toDataURL() { return "data:image/png;base64,AAAA"; }
}

test("chart: Renko renders on a logical axis, original data untouched, crosshair gives the source candle", () => {
  const f = new Fake();
  const chart = createChartWithAdapter(f);
  const s = chart.addCandlestickSeries();
  const data = walk(200, 5);
  s.setData(data);
  const sma = chart.addIndicator("sma", { length: 5 });
  const vwap = chart.addIndicator("vwap");
  s.setMarkers([{ time: data[10].time, position: "aboveBar", shape: "circle" }]);
  chart.addDrawing({ id: "t1", type: "horizontal-line", points: [{ time: data[5].time, price: 100 }] });
  const line = chart.addLineSeries();
  line.setData(data.map((d) => ({ time: d.time, value: d.close })));
  chart.setChartType("renko", { size: 1, wicks: true });
  const m = f.last!;
  assert.equal(m.derived!.kind, "renko");
  const info = chart.getDerivedInfo()!;
  assert.equal(m.bars.length, info.points.length);
  assert.ok(m.bars.length > 20);
  assert.ok(m.bars.every((b, i) => i === 0 || b.t >= m.bars[i - 1].t), "source times are non-decreasing (several points may share one)");
  assert.deepEqual(s.data(), data, "candles are never modified");
  assert.equal(m.series.length, 0, "time-based series are hidden on the logical axis");
  assert.deepEqual(info.hidden.series, [(line as unknown as { id: number }).id]);
  assert.deepEqual(info.hidden.indicators, [vwap.id], "VWAP needs volume/session time: hidden and reported");
  assert.equal(info.hidden.markers, true);
  assert.equal(info.hidden.drawings, 1);
  assert.match(info.methodology, /Renko/);
  assert.equal(m.lastPrice!.price, data[199].close, "axis label shows the real market close");
  // Indicators run on derived closes (one value per brick).
  assert.equal(sma.getValues().length, info.points.length - 4);
  // Crosshair: derived point + original source candle.
  let ev: { time: number | null; seriesData: Map<unknown, unknown>; derived?: { logical: number; sourceTime: number; close: number } } | null = null;
  chart.subscribeCrosshairMove((e) => (ev = e as never));
  f.crossCb!(7, null, 100);
  const pt = info.points[7];
  assert.equal(ev!.derived!.logical, 7);
  assert.equal(ev!.time, pt.sourceTime);
  assert.deepEqual([...ev!.seriesData.values()][0], data[pt.sourceIndex], "the observed candle, not the brick");
  // Time ↔ coordinate on the logical axis: by source candle time, never interpolated.
  const first = info.points.findIndex((q) => q.sourceTime >= pt.sourceTime);
  assert.equal(chart.timeScale().timeToCoordinate(pt.sourceTime), first * 10 + 5, "first element formed at that time");
  assert.equal(chart.timeScale().coordinateToTime(7 * 10 + 5), pt.sourceTime);
  assert.equal(chart.timeScale().coordinateToTime(99_999), null, "no time past the last element");
  assert.equal(chart.timeScale().timeToCoordinate(data[199].time + 10 * DAY), null, "no element after the last candle");
  // Live update: only the tail is rebuilt; the same array is extended in place.
  const bars = m.bars;
  s.update({ ...data[199], close: data[199].close + 8, high: data[199].high + 8 });
  assert.equal(f.last!.bars, bars, "in-place update");
  assert.equal(f.lastChange!.kind, "tick");
  assert.ok(chart.getDerivedInfo()!.points.length > info.points.length);
  // Logical range API and screenshot.
  chart.setVisibleLogicalRange({ from: 3, to: 30 });
  assert.deepEqual(chart.getVisibleLogicalRange(), { from: 3, to: 30 });
  assert.throws(() => chart.setVisibleLogicalRange({ from: 5, to: 1 }), XChartError);
  assert.match(chart.takeScreenshot(2), /^data:image\/png/);
  // Back to candles: everything time-based returns.
  chart.setChartType("candles");
  assert.equal(f.last!.derived, undefined);
  assert.equal(f.last!.series.length, 1);
  assert.equal(chart.getDerivedInfo(), null);
});

test("chart: drawings created on a derived chart use the logical domain; layouts keep settings", () => {
  const f = new Fake();
  const chart = createChartWithAdapter(f);
  const s = chart.addCandlestickSeries();
  s.setData(walk(120, 8));
  chart.setChartType("point-and-figure", { boxSize: 2, reversal: 3, source: "high-low" });
  const ptr = (i: number, price: number): PointerInfo => ({ x: i * 10 + 5, y: 400 - 2 * price, index: i, price, paneId: "main", shift: false, ctrl: true, pointerType: "mouse" });
  chart.setDrawingTool("trendline");
  f.delegate!.down!(ptr(2, 100));
  f.delegate!.up!(ptr(2, 100));
  f.delegate!.down!(ptr(6, 104));
  f.delegate!.up!(ptr(6, 104));
  const [d] = chart.getDrawings();
  assert.equal(d.data().domain, "logical");
  assert.deepEqual(d.data().points.map((p) => p.logical), [2, 6]);
  assert.throws(() => chart.addDrawing({ type: "trendline", domain: "logical", points: [{ time: 1, price: 1 }, { time: 2, price: 2 }] }), XChartError, "logical drawings need logical anchors");
  const layout = chart.saveLayout();
  assert.deepEqual(layout.chartType, { type: "point-and-figure", style: { boxSize: 2, reversal: 3, source: "high-low" } });
  const g = new Fake();
  const other = createChartWithAdapter(g);
  other.addCandlestickSeries().setData(walk(120, 8));
  other.loadLayout(JSON.stringify(layout));
  assert.equal(g.last!.derived!.kind, "point-and-figure");
  assert.equal(other.getDrawings()[0].data().domain, "logical");
  assert.deepEqual(other.getDerivedInfo()!.points.map((p) => p.id), chart.getDerivedInfo()!.points.map((p) => p.id));
  // Validation is atomic.
  assert.throws(() => chart.setChartType("renko", { method: "atr", atrPeriod: 0 }), XChartError);
  assert.equal(chart.getChartType().type, "point-and-figure");
  const empty = createChartWithAdapter(new Fake());
  assert.throws(() => empty.setChartType("kagi"), (e: unknown) => (e as XChartError).code === "UNSUPPORTED_CHART_TYPE", "needs a candlestick series");
});

test("resource limits: runaway derived settings are rejected atomically", () => {
  const f = new Fake();
  const chart = createChartWithAdapter(f);
  chart.addCandlestickSeries().setData(walk(50, 2));
  chart.setChartType("kagi", { reversal: 2 });
  assert.throws(() => chart.setChartType("renko", { size: 1e-6 }), (e: unknown) => e instanceof XChartError && e.code === "DERIVED_LIMIT");
  assert.equal(chart.getChartType().type, "kagi", "the previous chart type stays");
  assert.equal(chart.getDerivedInfo()!.type, "kagi");
});
