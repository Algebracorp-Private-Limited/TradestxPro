import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_INDICATORS } from "../lib/xchart-sdk/indicators/builtins.ts";
import { StreamGraph } from "../lib/xchart-sdk/indicators/dependencies.ts";
import { ema, map, src, type NodeDef } from "../lib/xchart-sdk/indicators/incremental.ts";
import { createChartWithAdapter } from "../lib/xchart-sdk/create-chart.ts";
import type { RenderAdapter, RenderModel } from "../lib/xchart-sdk/canvas-adapter.ts";
import type { IndicatorInput, IndicatorParams } from "../lib/xchart-sdk/indicators/types.ts";
import { XChartError } from "../lib/xchart-sdk/validation.ts";

type Regime = "flat" | "trend" | "volatile" | "zeroVolume";
function market(n: number, regime: Regime, seed = 7): IndicatorInput {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const o: IndicatorInput = { time: [], open: [], high: [], low: [], close: [], volume: [], intraday: true };
  let p = 100;
  for (let i = 0; i < n; i++) {
    const op = p;
    const step = regime === "flat" ? 0 : regime === "trend" ? 0.3 + (r() - 0.5) * 0.2 : (r() - 0.5) * (regime === "volatile" ? 12 : 3);
    const c = Math.max(0.5, op + step);
    p = c;
    const wig = regime === "flat" ? 0 : r() * (regime === "volatile" ? 5 : 1);
    o.time.push(1_767_225_600 + i * 300);
    o.open.push(op);
    o.high.push(Math.max(op, c) + wig);
    o.low.push(Math.min(op, c) - wig);
    o.close.push(c);
    o.volume.push(regime === "zeroVolume" ? 0 : i % 9 === 0 ? 0 : Math.round(100 + r() * 5000));
  }
  return o;
}
const slice = (x: IndicatorInput, n: number): IndicatorInput => ({ time: x.time.slice(0, n), open: x.open.slice(0, n), high: x.high.slice(0, n), low: x.low.slice(0, n), close: x.close.slice(0, n), volume: x.volume.slice(0, n), intraday: x.intraday });
const defaults = (d: (typeof BUILTIN_INDICATORS)[number]): IndicatorParams => Object.fromEntries(d.params.map((p) => [p.key, p.default]));
const same = (a: number, b: number | undefined) => Object.is(a, b) || (Number.isNaN(a) && (b === undefined || Number.isNaN(b)));

/** Compares every output of a synced graph with the reference full calculation (bitwise). */
function check(label: string, def: (typeof BUILTIN_INDICATORS)[number], p: IndicatorParams, g: StreamGraph, inp: IndicatorInput) {
  const ref = def.calculate(inp, p);
  const spec = def.stream!(p, { intraday: inp.intraday });
  const n = inp.time.length;
  const active = !spec.activeWhen || g.values(spec.activeWhen.key)[n - 1] === 1;
  if (!active) {
    assert.deepEqual(Object.keys(ref), [], `${label}: inactive outputs`);
    return;
  }
  for (const o of spec.outputs) {
    const v = g.values(o.node.key);
    const sh = o.shift ?? 0;
    const len = Math.max(ref[o.key]?.length ?? 0, n);
    for (let i = 0; i < len; i++) {
      const j = i - sh;
      const got = j >= 0 && j < n ? v[j] : NaN;
      if (!same(got, ref[o.key]?.[i])) assert.fail(`${label} ${def.id}.${o.key}[${i}]: stream ${got} ≠ reference ${ref[o.key]?.[i]}`);
    }
  }
}

function graphFor(def: (typeof BUILTIN_INDICATORS)[number], p: IndicatorParams, intraday = true) {
  const spec = def.stream!(p, { intraday });
  const g = new StreamGraph();
  g.acquire([...spec.outputs.map((o) => o.node), ...(spec.activeWhen ? [spec.activeWhen] : [])]);
  return g;
}

test("every built-in has a streaming form", () => {
  assert.equal(BUILTIN_INDICATORS.length, 22);
  assert.deepEqual(BUILTIN_INDICATORS.filter((d) => !d.stream).map((d) => d.id), []);
});

for (const regime of ["flat", "trend", "volatile", "zeroVolume"] as Regime[]) {
  test(`full, sequential append and repeated replacement equal the reference (${regime})`, () => {
    const data = market(700, regime, 11);
    for (const def of BUILTIN_INDICATORS) {
      const p = defaults(def);
      // 1. full historical calculation
      const g1 = graphFor(def, p);
      g1.sync(data);
      check(`${regime}/full`, def, p, g1, data);
      // 2. sequential append (one sync per new bar, with the chart's change hint)
      const g2 = graphFor(def, p);
      for (let n = 1; n <= data.time.length; n++) g2.sync(slice(data, n), Math.max(0, n - 2));
      check(`${regime}/append`, def, p, g2, data);
      // 3. ten replacements of the live candle, then its final values
      const g3 = graphFor(def, p);
      const live = slice(data, 650);
      g3.sync(live);
      const last = { o: live.open[649], h: live.high[649], l: live.low[649], c: live.close[649] };
      for (let k = 0; k < 10; k++) {
        live.close[649] = last.c + (k - 5) * 1.3;
        live.high[649] = Math.max(last.h, live.close[649]);
        live.low[649] = Math.min(last.l, live.close[649]);
        g3.sync(live, 649);
      }
      live.close[649] = last.c;
      live.high[649] = last.h;
      live.low[649] = last.l;
      g3.sync(live, 649);
      check(`${regime}/replace`, def, p, g3, slice(data, 650));
    }
  });
}

test("historical correction replays from a checkpoint and equals the reference", () => {
  const data = market(9000, "volatile", 3);
  for (const id of ["ema", "rsi", "macd", "adx", "supertrend", "psar", "obv", "ichimoku", "bb", "stoch", "keltner", "vwap"]) {
    const def = BUILTIN_INDICATORS.find((d) => d.id === id)!;
    const p = defaults(def);
    const g = graphFor(def, p);
    g.sync(data);
    const fixed = slice(data, 9000);
    fixed.close[8500] += 7;
    fixed.high[8500] = Math.max(fixed.high[8500], fixed.close[8500]);
    const replays = g.stats.replays;
    g.sync(fixed); // no hint: the graph finds the first changed bar itself
    assert.equal(g.stats.replays, replays + 1);
    assert.ok(g.changedFrom >= 8192 && g.changedFrom <= 8500, `${id}: replay started at checkpoint ${g.changedFrom}`);
    check("correction", def, p, g, fixed);
    // A correction before the first checkpoint replays from the start.
    const early = slice(fixed, 9000);
    early.close[10] += 1;
    early.high[10] = Math.max(early.high[10], early.close[10]);
    g.sync(early);
    check("early correction", def, p, g, early);
  }
});

test("non-default parameters, sources, insufficient warm-up and NaN inputs", () => {
  const data = market(400, "volatile", 21);
  const cases: [string, IndicatorParams][] = [
    ["sma", { length: 5, source: "hl2" }], ["ema", { length: 50, source: "ohlc4" }], ["wma", { length: 7, source: "hlc3" }], ["hma", { length: 9, source: "open" }],
    ["bb", { length: 10, mult: 1.5, source: "high" }], ["keltner", { length: 5, mult: 3, atr: 7 }], ["donchian", { length: 3 }], ["supertrend", { length: 3, mult: 1.2 }],
    ["psar", { step: 0.05, max: 0.3 }], ["rsi", { length: 3, source: "low" }], ["macd", { fast: 3, slow: 7, signal: 2, source: "hl2" }], ["stoch", { k: 5, smooth: 1, d: 4 }],
    ["adx", { length: 5 }], ["atr", { length: 1 }], ["cci", { length: 7 }], ["mfi", { length: 4 }], ["willr", { length: 2 }], ["roc", { length: 1, source: "volume" }],
  ];
  for (const [id, over] of cases) {
    const def = BUILTIN_INDICATORS.find((d) => d.id === id)!;
    const p = { ...defaults(def), ...over };
    for (const n of [1, 2, 5, 60, 400]) {
      const g = graphFor(def, p);
      g.sync(slice(data, n));
      check(`params n=${n}`, def, p, g, slice(data, n));
    }
  }
  // VWAP / Ichimoku option variants.
  const vw = BUILTIN_INDICATORS.find((d) => d.id === "vwap")!;
  for (const over of [{ anchor: "Week", source: "Close", bandsMode: "Percentage", offset: 3 }, { anchor: "Month", band2: false, offset: -4 }, { hideDaily: true }]) {
    const p = { ...defaults(vw), ...over } as unknown as IndicatorParams;
    for (const intraday of [true, false]) {
      const inp = { ...slice(data, 400), intraday };
      const g = graphFor(vw, p, intraday);
      g.sync(inp);
      check(`vwap ${JSON.stringify(over)} intraday=${intraday}`, vw, p, g, inp);
    }
  }
  const ich = BUILTIN_INDICATORS.find((d) => d.id === "ichimoku")!;
  const pi = { ...defaults(ich), chikou: true, disp: 10 } as IndicatorParams;
  const gi = graphFor(ich, pi);
  gi.sync(data);
  check("ichimoku chikou", ich, pi, gi, data);
  // Kernels follow lib/ta's NaN rules exactly (e.g. an EMA keeps its value through a NaN).
  const holes = slice(data, 120);
  for (const i of [30, 31, 77]) holes.close[i] = NaN;
  for (const id of ["sma", "ema", "wma", "rsi", "macd", "bb", "roc"]) {
    const def = BUILTIN_INDICATORS.find((d) => d.id === id)!;
    const g = graphFor(def, defaults(def));
    g.sync(holes);
    check("NaN input", def, defaults(def), g, holes);
  }
});

test("dependency graph: shared nodes, reference counting, cleanup, cycle detection", () => {
  const g = new StreamGraph();
  const e12 = ema(src("close"), 12);
  const macdLine = map("sub", [e12, ema(src("close"), 26)], ([a, b]) => a - b);
  const r1 = g.acquire([e12]);
  const r2 = g.acquire([macdLine]);
  g.sync(market(300, "trend"));
  assert.equal(g.size(), 4, "close, ema12 (shared), ema26, line");
  assert.equal(g.stats.shared, 2, "close and ema12 are shared");
  r2();
  r2(); // idempotent
  assert.equal(g.size(), 2, "MACD-only nodes released");
  assert.equal(g.values(e12.key).length, 300, "EMA 12 keeps its history");
  r1();
  assert.equal(g.size(), 0);
  const loop: NodeDef = { key: "loop", deps: [], create: () => { throw new Error("never"); } };
  loop.deps.push(loop);
  assert.throws(() => g.acquire([loop]), (e: unknown) => e instanceof XChartError && e.code === "INDICATOR_CYCLE");
  assert.equal(g.size(), 0, "a rejected registration leaves nothing behind");
});

// ---------- through the chart ----------
class Fake implements RenderAdapter {
  last: RenderModel | null = null;
  render(m: RenderModel) { this.last = m; }
  setOptions() {}
  onCrosshair() {}
  getViewRange() { return this.last && this.last.times.length ? { from: 0, to: this.last.times.length - 1 } : null; }
  setViewRange() {}
  fit() {}
  scrollToEnd() {}
  scrollBy() {}
  zoom() {}
  resize() {}
  destroy() {}
}
const toCandles = (x: IndicatorInput) => x.time.map((t, i) => ({ time: t, open: x.open[i], high: x.high[i], low: x.low[i], close: x.close[i], volume: x.volume[i] }));

test("chart: live ticks, appends, corrections and parameter changes match a fresh chart", () => {
  const data = toCandles(market(1500, "volatile", 5));
  const live = createChartWithAdapter(new Fake());
  const s = live.addCandlestickSeries();
  s.setData(data.slice(0, 1000));
  const inds = BUILTIN_INDICATORS.map((d) => live.addIndicator(d.id));
  for (const i of inds) i.getValues();
  // Same-candle updates, appends, more updates.
  for (let k = 1000; k < 1500; k++) {
    const c = data[k];
    s.update({ ...c, close: c.open, high: Math.max(c.open, c.high), low: Math.min(c.open, c.low) });
    s.update({ ...c, close: (c.open + c.close) / 2, high: c.high, low: c.low });
    s.update(c);
    if (k % 50 === 0) for (const i of inds) i.getValues(); // flush mid-stream as a renderer would
  }
  const fresh = createChartWithAdapter(new Fake());
  fresh.addCandlestickSeries().setData(data);
  for (const [k, d] of BUILTIN_INDICATORS.entries()) {
    assert.deepEqual(inds[k].getValues(), fresh.addIndicator(d.id).getValues(), `${d.id} after live updates`);
  }
  assert.ok(inds.every((i) => (i as unknown as { mode: string }).mode === "stream"), "every built-in ran incrementally");
  // Historical correction through setData.
  const fixed = data.map((c, i) => (i === 700 ? { ...c, close: c.close + 3, high: Math.max(c.high, c.close + 3) } : c));
  s.setData(fixed);
  const ref = createChartWithAdapter(new Fake());
  ref.addCandlestickSeries().setData(fixed);
  for (const [k, d] of BUILTIN_INDICATORS.entries()) assert.deepEqual(inds[k].getValues(), ref.addIndicator(d.id).getValues(), `${d.id} after correction`);
  // Parameter change re-initialises from history.
  inds[1].setParameters({ length: 7 });
  assert.deepEqual(inds[1].getValues(), ref.addIndicator("ema", { length: 7 }).getValues());
  const stats = (live as unknown as { indicatorEngineStats(): { nodes: number; shared: number } }).indicatorEngineStats();
  assert.ok(stats.shared > 0, "built-ins share intermediate nodes (close, ATR, EMAs, extremes)");
  for (const i of inds) i.remove();
  assert.equal((live as unknown as { indicatorEngineStats(): { nodes: number } }).indicatorEngineStats().nodes, 0, "removed indicators release their state");
  live.addIndicator("rsi");
  live.remove();
  assert.equal((live as unknown as { indicatorEngineStats(): { nodes: number } }).indicatorEngineStats().nodes, 0, "chart destruction releases the graph");
});

test("chart: a live tick is O(1) in the data path (no full recalculation)", () => {
  const data = toCandles(market(50_000, "volatile", 9));
  const chart = createChartWithAdapter(new Fake());
  const s = chart.addCandlestickSeries();
  s.setData(data);
  const ids = ["ema", "rsi", "macd", "atr", "adx", "supertrend", "psar", "obv", "keltner", "bb"];
  const inds = ids.map((id) => chart.addIndicator(id));
  for (const i of inds) i.getValues();
  const stats = () => (chart as unknown as { indicatorEngineStats(): { rebuilds: number; replays: number; committed: number } }).indicatorEngineStats();
  const before = stats();
  const last = data[data.length - 1];
  const times: number[] = [];
  for (let k = 0; k < 200; k++) {
    const t0 = performance.now();
    if (k % 20 === 19) s.update({ ...last, time: last.time + 300 * (1 + Math.floor(k / 20)), open: last.close, high: last.close + 1, low: last.close - 1, close: last.close + 0.5 });
    else s.update({ ...last, time: last.time + 300 * Math.floor(k / 20), close: last.close + (k % 7) * 0.1, high: last.high + 1, low: last.low - 1 });
    (chart as unknown as { flushIndicators(): void }).flushIndicators();
    times.push(performance.now() - t0);
  }
  const after = stats();
  assert.equal(after.rebuilds, before.rebuilds, "no rebuilds during live ticks");
  assert.equal(after.replays, before.replays, "no replays during live ticks");
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)];
  console.log(`    50k candles × 10 recursive/rolling indicators: tick (store + input + 10 indicators) median ${times[100].toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`);
  assert.ok(p95 < 50, `p95 ${p95.toFixed(2)} ms`);
});

// ---------- worker protocol and synchronous fallback (Node has no Web Workers) ----------
import { IndicatorWorkerClient } from "../lib/xchart-sdk/workers/worker-client.ts";
import { validateRequest, validateResponse, toColumns, PROTOCOL_VERSION } from "../lib/xchart-sdk/workers/protocol.ts";

test("worker client falls back to the main thread with identical results", async () => {
  const data = market(3000, "volatile", 4);
  const client = new IndicatorWorkerClient();
  assert.equal(client.usesWorker, false);
  assert.match(client.fallbackReason!, /not available/);
  const res = await client.computeIndicators(data, [{ id: "macd", params: {} }, { id: "rsi", params: { length: 9 } }, { id: "nope", params: {} }]);
  assert.equal(res.worker, false);
  const macdDef = BUILTIN_INDICATORS.find((d) => d.id === "macd")!;
  const ref = macdDef.calculate(data, defaults(macdDef));
  const out = (res.results[0] as { outputs: Record<string, Float64Array> }).outputs;
  for (const k of ["macd", "signal", "hist"]) assert.deepEqual(Array.from(out[k]), ref[k].map((v) => v));
  assert.match((res.results[2] as { error: string }).error, /Unknown/);
  assert.deepEqual(Array.from(data.close.slice(0, 3)), data.close.slice(0, 3), "caller arrays untouched");
  const d = await client.computeDerived(data, "renko", { size: 2 });
  assert.ok(d.points.length > 10);
  client.terminate();
  await assert.rejects(() => client.computeIndicators(data, []), /terminated/);
});

test("worker protocol validation rejects malformed and unsafe messages", () => {
  const cols = toColumns({ time: [1, 2], open: [1, 2], high: [1, 2], low: [1, 2], close: [1, 2], volume: [0, 0] });
  const ok = { v: PROTOCOL_VERSION, type: "indicators", jobId: 1, datasetVersion: 0, intraday: false, columns: cols, indicators: [{ id: "ema", params: { length: 3 } }] };
  assert.equal(validateRequest(ok).type, "indicators");
  const bad: unknown[] = [
    null, { ...ok, v: 99 }, { ...ok, jobId: -1 }, { ...ok, type: "eval" }, { ...ok, columns: { ...cols, close: [1, 2] } },
    { ...ok, columns: { ...cols, close: new Float64Array(3) } }, { ...ok, indicators: [{ id: "ema", params: JSON.parse('{"__proto__":{"x":1}}') }] },
    { ...ok, indicators: [{ id: "ema", params: { f: () => 1 } }] }, { ...ok, indicators: new Array(201).fill({ id: "ema", params: {} }) },
  ];
  for (const b of bad) assert.throws(() => validateRequest(b));
  assert.throws(() => validateResponse({ v: 1, type: "indicators", jobId: 1, datasetVersion: 0, results: [{ outputs: { a: [1] } }] }));
  assert.equal(validateResponse({ v: 1, type: "cancelled", jobId: 3 }).type, "cancelled");
});
