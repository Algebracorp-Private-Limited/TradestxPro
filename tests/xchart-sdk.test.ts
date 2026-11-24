import test from "node:test";
import assert from "node:assert/strict";
import { validateBar, validateBars, validateRange, validateUpdate, XChartError } from "../lib/xchart-sdk/validation.ts";
import { SeriesStore } from "../lib/xchart-sdk/store.ts";
import { createChart, createChartWithAdapter } from "../lib/xchart-sdk/index.ts";
import type { RenderAdapter, RenderModel } from "../lib/xchart-sdk/canvas-adapter.ts";
import type { Change } from "../lib/xchart-sdk/store.ts";
import type { CandlestickData } from "../lib/xchart-sdk/types.ts";

// ---------- validation (v0.1 behaviour kept) ----------
test("accepts valid OHLC candles", () => {
  assert.doesNotThrow(() => validateBar("candlestick", { time: 1700000000, open: 100, high: 110, low: 90, close: 105 }));
});
test("rejects invalid OHLC ranges", () => {
  assert.throws(() => validateBar("candlestick", { time: 1700000000, open: 100, high: 99, low: 90, close: 105 }), RangeError);
});
test("rejects duplicate and unsorted times", () => {
  assert.throws(() => validateBars("line", [{ time: 2, value: 1 }, { time: 2, value: 3 }]), /Duplicate timestamp 2/);
  assert.throws(() => validateBars("line", [{ time: 2, value: 1 }, { time: 1, value: 3 }]), /must increase/);
});
test("rejects NaN, invalid volume, millisecond and fractional times", () => {
  assert.throws(() => validateBar("line", { time: 2, value: NaN }), RangeError);
  assert.throws(() => validateBar("candlestick", { time: 2, open: 1, high: 2, low: 0, close: 1, volume: -1 }), /volume/);
  assert.throws(() => validateBar("line", { time: 1_700_000_000_000, value: 1 }), /milliseconds/);
  assert.throws(() => validateBar("line", { time: 1.5, value: 1 }), /whole seconds/);
});
test("requires valid visible range", () => {
  assert.doesNotThrow(() => validateRange({ from: 1, to: 2 }));
  assert.throws(() => validateRange({ from: 2, to: 2 }), RangeError);
  assert.throws(() => validateRange({ from: NaN, to: 2 }), RangeError);
});
test("update ordering", () => {
  const last = { time: 100, value: 1 };
  assert.doesNotThrow(() => validateUpdate("line", last, { time: 100, value: 2 }));
  assert.doesNotThrow(() => validateUpdate("line", last, { time: 160, value: 2 }));
  assert.throws(() => validateUpdate("line", last, { time: 40, value: 2 }), (e: unknown) => e instanceof XChartError && e.code === "OUT_OF_ORDER");
});

// ---------- fake renderer ----------
class FakeAdapter implements RenderAdapter {
  renders: { model: RenderModel; change: Change }[] = [];
  view: { from: number; to: number } | null = null;
  calls: string[] = [];
  destroyed = 0;
  cb: ((i: number | null, t: number | null, p: number | null) => void) | null = null;
  render(model: RenderModel, change: Change) {
    this.renders.push({ model, change });
    if (!this.view && model.times.length) this.view = { from: 0, to: model.times.length - 1 };
  }
  setOptions() { this.calls.push("options"); }
  onCrosshair(cb: (i: number | null, t: number | null, p: number | null) => void) { this.cb = cb; }
  getViewRange() { return this.view; }
  setViewRange(from: number, to: number) { this.view = { from, to }; }
  fit() { this.calls.push("fit"); }
  scrollToEnd() { this.calls.push("end"); }
  scrollBy(n: number) { this.calls.push(`by:${n}`); }
  zoom(f: number) { this.calls.push(`zoom:${f}`); }
  resize() { this.calls.push("resize"); }
  destroy() { this.destroyed++; }
  last() { return this.renders[this.renders.length - 1]; }
}

const DAY = 86400;
const T0 = Date.UTC(2026, 0, 5) / 1000; // Monday
const candles = (n: number, start = T0, step = DAY): CandlestickData[] =>
  Array.from({ length: n }, (_, i) => {
    const c = 100 + i;
    return { time: start + i * step, open: c - 1, high: c + 2, low: c - 2, close: c, volume: 1000 + i };
  });

// ---------- lifecycle ----------
test("chart lifecycle: create, add series, remove releases the renderer and blocks further use", () => {
  const a = new FakeAdapter();
  const chart = createChartWithAdapter(a, { theme: "light" });
  const s = chart.addCandlestickSeries();
  s.setData(candles(5));
  assert.equal(a.last().model.times.length, 5);
  chart.remove();
  chart.remove(); // idempotent
  assert.equal(a.destroyed, 1);
  assert.throws(() => chart.addLineSeries(), /removed/);
  assert.throws(() => s.update(candles(6)[5]), /removed/);
});

test("createChart refuses to run without a DOM (server rendering)", () => {
  assert.throws(() => createChart({} as HTMLElement), (e: unknown) => e instanceof XChartError && e.code === "NO_DOM");
});

// ---------- series creation / removal ----------
test("series creation, options and removal", () => {
  const a = new FakeAdapter();
  const chart = createChartWithAdapter(a);
  const c = chart.addCandlestickSeries({ upColor: "#00ff00" });
  const l = chart.addLineSeries({ color: "#ff0000", lineWidth: 3 });
  const ar = chart.addAreaSeries();
  const h = chart.addHistogramSeries({ colorMode: "candle" });
  assert.equal(c.type, "candlestick");
  assert.deepEqual(a.last().model.series.map((s) => s.type), ["line", "area", "histogram"]);
  assert.equal(a.last().model.candle?.upColor, "#00ff00");
  l.applyOptions({ lineWidth: 1 });
  assert.equal(l.options().lineWidth, 1);
  assert.throws(() => chart.addCandlestickSeries(), /Only one candlestick/);
  assert.throws(() => l.applyOptions({ lineWidth: -1 }), /lineWidth/);
  ar.remove();
  h.remove();
  assert.deepEqual(a.last().model.series.map((s) => s.type), ["line"]);
  assert.throws(() => ar.data(), /removed/);
});

test("histogram coloured by candles needs a candlestick series", () => {
  const chart = createChartWithAdapter(new FakeAdapter());
  assert.throws(() => chart.addHistogramSeries({ colorMode: "candle" }), (e: unknown) => e instanceof XChartError && e.code === "INCOMPATIBLE_SERIES");
});

// ---------- historical data ----------
test("historical candles load with gaps (weekends) preserved as real timestamps", () => {
  const a = new FakeAdapter();
  const chart = createChartWithAdapter(a);
  const s = chart.addCandlestickSeries();
  const data = [0, 1, 2, 3, 4, 7, 8].map((d, i) => ({ time: T0 + d * DAY, open: 10 + i, high: 12 + i, low: 9 + i, close: 11 + i })); // Mon–Fri, then Mon–Tue
  s.setData(data);
  const m = a.last().model;
  assert.deepEqual(m.times, data.map((d) => d.time));
  assert.equal(m.bars[5].c, 16);
  assert.equal(m.intraday, false);
  assert.deepEqual(s.data(), data);
  assert.notEqual(s.data()[0], data[0]); // copies, not references
  assert.throws(() => s.setData([data[1], data[0]]), /must increase/);
});

// ---------- real-time updates ----------
test("real-time: replace current candle (O(1) tick) and append a new one", () => {
  const a = new FakeAdapter();
  const chart = createChartWithAdapter(a);
  const s = chart.addCandlestickSeries();
  s.setData(candles(3));
  const barsRef = a.last().model.bars;
  s.update({ time: T0 + 2 * DAY, open: 101, high: 110, low: 99, close: 108 });
  assert.deepEqual(a.last().change, { kind: "tick", appended: 0 });
  assert.equal(a.last().model.bars, barsRef); // mutated in place, no rebuild
  assert.equal(barsRef[2].c, 108);
  s.update({ time: T0 + 3 * DAY, open: 108, high: 109, low: 107, close: 107.5 });
  assert.deepEqual(a.last().change, { kind: "tick", appended: 1 });
  assert.equal(barsRef.length, 4);
  assert.equal(s.data().length, 4);
});

test("duplicate timestamps and out-of-order updates are rejected", () => {
  const chart = createChartWithAdapter(new FakeAdapter());
  const s = chart.addLineSeries();
  assert.throws(() => s.setData([{ time: 10, value: 1 }, { time: 10, value: 2 }]), /Duplicate/);
  s.setData([{ time: 10, value: 1 }, { time: 20, value: 2 }]);
  assert.throws(() => s.update({ time: 15, value: 3 }), (e: unknown) => e instanceof XChartError && e.code === "OUT_OF_ORDER");
  assert.equal(s.data().length, 2); // unchanged after a rejected update
});

// ---------- multiple series alignment ----------
test("multiple series with different timestamps align on one time axis", () => {
  const a = new FakeAdapter();
  const chart = createChartWithAdapter(a);
  const c = chart.addCandlestickSeries();
  const l = chart.addLineSeries();
  c.setData(candles(3, 100, 60)); // 100, 160, 220
  l.setData([{ time: 130, value: 5 }, { time: 220, value: 6 }, { time: 280, value: 7 }]);
  const m = a.last().model;
  assert.deepEqual(m.times, [100, 130, 160, 220, 280]);
  assert.ok(Number.isNaN(m.bars[1].c)); // no candle at 130
  assert.ok(Number.isNaN(m.bars[4].c)); // nor at 280
  const lv = m.series[0].values;
  assert.ok(Number.isNaN(lv[0]));
  assert.deepEqual([lv[1], lv[3], lv[4]], [5, 6, 7]);
  // a lagging series fills an existing slot; a new time between slots is inserted
  c.update({ time: 280, open: 1, high: 2, low: 0.5, close: 1.5 });
  assert.equal(a.last().model.bars[4].c, 1.5);
  l.update({ time: 340, value: 8 });
  c.update({ time: 340, open: 1, high: 2, low: 1, close: 2 });
  assert.equal(a.last().model.times.length, 6);
  assert.equal(a.last().model.series[0].values[5], 8);
});

test("store inserts a mid-axis time for a lagging series", () => {
  const st = new SeriesStore();
  const x = st.add("line");
  const y = st.add("line");
  st.setData(x.id, [{ time: 10, value: 1 }, { time: 30, value: 3 }]);
  st.setData(y.id, [{ time: 5, value: 0 }]);
  const ch = st.update(y.id, { time: 20, value: 2 });
  assert.equal(ch.kind, "full");
  assert.deepEqual(st.times, [5, 10, 20, 30]);
  assert.equal(st.series.get(y.id)!.values[2], 2);
  assert.ok(Number.isNaN(st.series.get(x.id)!.values[2]));
});

// ---------- visible range ----------
test("visible range maps times to viewport indices and back", () => {
  const a = new FakeAdapter();
  const chart = createChartWithAdapter(a);
  assert.throws(() => chart.setVisibleRange({ from: 1, to: 2 }), /needs data/);
  const s = chart.addLineSeries();
  s.setData(Array.from({ length: 100 }, (_, i) => ({ time: 1000 + i * 60, value: i })));
  chart.setVisibleRange({ from: 1000 + 20 * 60, to: 1000 + 50 * 60 });
  assert.deepEqual(a.view, { from: 20, to: 50 });
  assert.deepEqual(chart.getVisibleRange(), { from: 1000 + 20 * 60, to: 1000 + 50 * 60 });
  assert.throws(() => chart.setVisibleRange({ from: 5000, to: 4000 }), /from < to/);
  chart.fitContent();
  chart.scrollToRealTime();
  chart.scrollBy(-10);
  chart.zoom(2);
  assert.deepEqual(a.calls.slice(-4), ["fit", "end", "by:-10", "zoom:2"]);
});

// ---------- crosshair ----------
test("crosshair events carry time, price and series data; unsubscribe and leave work", () => {
  const a = new FakeAdapter();
  const chart = createChartWithAdapter(a);
  const c = chart.addCandlestickSeries();
  const l = chart.addLineSeries();
  c.setData(candles(3, 100, 60));
  l.setData([{ time: 160, value: 42 }]);
  const seen: unknown[] = [];
  const unsub = chart.subscribeCrosshairMove((e) => seen.push({ time: e.time, price: e.price, n: e.seriesData.size, line: (e.seriesData.get(l) as { value: number } | undefined)?.value }));
  a.cb!(1, 160, 101.5);
  a.cb!(1, 160, 101.5); // same position on the next frame: not re-emitted
  a.cb!(null, null, null); // pointer left
  assert.deepEqual(seen, [{ time: 160, price: 101.5, n: 2, line: 42 }, { time: null, price: null, n: 0, line: undefined }]);
  assert.equal(chart.crosshairSubscriberCount(), 1);
  unsub();
  unsub();
  assert.equal(chart.crosshairSubscriberCount(), 0);
  a.cb!(2, 220, 100);
  assert.equal(seen.length, 2);
  chart.subscribeCrosshairMove(() => {});
  chart.remove();
  assert.equal(chart.crosshairSubscriberCount(), 0);
});

test("a throwing crosshair handler does not break other subscribers", () => {
  const a = new FakeAdapter();
  const chart = createChartWithAdapter(a);
  chart.addLineSeries().setData([{ time: 1, value: 1 }]);
  let got = 0;
  const orig = console.error;
  console.error = () => {};
  chart.subscribeCrosshairMove(() => { throw new Error("boom"); });
  chart.subscribeCrosshairMove(() => { got++; });
  a.cb!(0, 1, 1);
  console.error = orig;
  assert.equal(got, 1);
});

// ---------- performance of the data path (no rendering) ----------
test("live ticks on 50,000 candles stay O(1)", () => {
  const a = new FakeAdapter();
  const chart = createChartWithAdapter(a);
  const s = chart.addCandlestickSeries();
  const data = candles(50_000, 1_000_000, 60);
  let t = performance.now();
  s.setData(data);
  const setMs = performance.now() - t;
  const last = data[data.length - 1];
  t = performance.now();
  for (let i = 0; i < 1000; i++) s.update({ ...last, close: last.close + (i % 3) - 1, high: last.high + 2, low: last.low - 2 });
  const tickUs = ((performance.now() - t) / 1000) * 1000;
  t = performance.now();
  for (let i = 1; i <= 1000; i++) s.update({ time: last.time + i * 60, open: 1, high: 2, low: 0.5, close: 1.5 });
  const appendUs = ((performance.now() - t) / 1000) * 1000;
  console.log(`    data path: setData(50k) ${setMs.toFixed(1)} ms · replace tick ${tickUs.toFixed(1)} µs · append tick ${appendUs.toFixed(1)} µs`);
  assert.ok(tickUs < 1000 && appendUs < 1000, "ticks should take well under 1 ms");
});

test("TradestXPro bars convert to canonical SDK candles", async () => {
  const { fromTradestxproBars } = await import("../lib/xchart-sdk/market-data.ts");
  const out = fromTradestxproBars([
    { t: 100, o: 10, h: 12, l: 9, c: 11, v: 500 },
    { t: 100, o: 10, h: 12, l: 9, c: 11, v: 500 }, // duplicate dropped
    { t: 160, o: 11, h: 11.5, l: 10, c: 10.5, v: 0 }, // zero volume → omitted
    { t: 220, o: NaN, h: 1, l: 1, c: 1 }, // malformed dropped
  ]);
  assert.deepEqual(out, [
    { time: 100, open: 10, high: 12, low: 9, close: 11, volume: 500 },
    { time: 160, open: 11, high: 11.5, low: 10, close: 10.5, volume: undefined },
  ]);
});
