import test from "node:test";
import assert from "node:assert/strict";
import { createChartWithAdapter } from "../lib/xchart-sdk/create-chart.ts";
import { BUILTIN_INDICATORS, IndicatorRegistry, builtinRegistry, listIndicators, registerIndicator, unregisterIndicator, getIndicatorDefinition } from "../lib/xchart-sdk/indicators/index.ts";
import type { IndicatorDefinition, IndicatorInput } from "../lib/xchart-sdk/indicators/types.ts";
import type { RenderAdapter, RenderModel } from "../lib/xchart-sdk/canvas-adapter.ts";
import type { Change } from "../lib/xchart-sdk/store.ts";
import type { CandlestickData } from "../lib/xchart-sdk/types.ts";
import { XChartError } from "../lib/xchart-sdk/validation.ts";

class Fake implements RenderAdapter {
  last: RenderModel | null = null;
  render(m: RenderModel, _c: Change) { this.last = m; }
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

const DAY = 86400;
function candles(n: number, seed = 1): CandlestickData[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let p = 100;
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    const c = Math.max(1, o + (rnd() - 0.5) * 4);
    const h = Math.max(o, c) + rnd() * 2;
    const l = Math.min(o, c) - rnd() * 2;
    p = c;
    return { time: 1_700_000_000 + i * DAY, open: o, high: h, low: l, close: c, volume: Math.round(1000 + rnd() * 5000) };
  });
}
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

// ---- independent reference implementations (written from the textbook definitions) ----
function refSma(x: number[], n: number) {
  return x.map((_, i) => (i < n - 1 ? NaN : x.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));
}
function refEma(x: number[], n: number) {
  const out = new Array(x.length).fill(NaN);
  const a = 2 / (n + 1);
  let prev = x.slice(0, n).reduce((s, v) => s + v, 0) / n; // seeded with the SMA of the first n values
  out[n - 1] = prev;
  for (let i = n; i < x.length; i++) out[i] = prev = a * x[i] + (1 - a) * prev;
  return out;
}
function refRsi(x: number[], n: number) {
  const out = new Array(x.length).fill(NaN);
  let ag = 0, al = 0;
  for (let i = 1; i <= n; i++) {
    const d = x[i] - x[i - 1];
    ag += Math.max(d, 0);
    al += Math.max(-d, 0);
  }
  ag /= n;
  al /= n;
  out[n] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = n + 1; i < x.length; i++) {
    const d = x[i] - x[i - 1];
    ag = (ag * (n - 1) + Math.max(d, 0)) / n; // Wilder smoothing
    al = (al * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

function chartWith(data: CandlestickData[]) {
  const a = new Fake();
  const chart = createChartWithAdapter(a);
  const s = chart.addCandlestickSeries();
  s.setData(data);
  return { a, chart, s };
}

test("indicator inventory: every catalogue indicator is exposed once, with unique ids", () => {
  const ids = BUILTIN_INDICATORS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ["sma", "ema", "wma", "hma", "bb", "keltner", "donchian", "supertrend", "psar", "vwap", "ichimoku", "rsi", "macd", "stoch", "adx", "atr", "cci", "mfi", "willr", "roc", "obv", "volume"]);
  for (const d of BUILTIN_INDICATORS) assert.ok(d.outputs.length > 0 && d.description && d.name, d.id);
});

test("SMA, EMA and RSI match independent reference calculations (incl. warm-up NaNs)", () => {
  const data = candles(300);
  const close = data.map((d) => d.close);
  const { chart } = chartWith(data);
  const sma = chart.addIndicator("sma", { period: 20, color: "#2962ff" });
  const ema = chart.addIndicator("ema", { length: 21 });
  const rsi = chart.addIndicator("rsi", { period: 14 });
  const vals = (i: ReturnType<typeof chart.addIndicator>, k: string) => {
    const m = new Map(i.getValues().map((p) => [p.time, p.values[k]]));
    return data.map((d) => m.get(d.time) ?? NaN);
  };
  const rs = refSma(close, 20), re = refEma(close, 21), rr = refRsi(close, 14);
  const s = vals(sma, "sma"), e = vals(ema, "ema"), r = vals(rsi, "rsi");
  for (let i = 0; i < data.length; i++) {
    if (Number.isNaN(rs[i])) assert.ok(Number.isNaN(s[i]), `sma warm-up ${i}`); else near(s[i], rs[i]);
    if (Number.isNaN(re[i])) assert.ok(Number.isNaN(e[i]), `ema warm-up ${i}`); else near(e[i], re[i]);
    if (Number.isNaN(rr[i])) assert.ok(Number.isNaN(r[i]), `rsi warm-up ${i}`); else near(r[i], rr[i], 1e-9);
  }
  assert.equal(sma.definition().warmup(sma.parameters()), 19);
  assert.equal(rsi.definition().warmup(rsi.parameters()), 14);
});

test("MACD: macd = EMA(fast) − EMA(slow); signal = EMA(macd); hist = macd − signal", () => {
  const data = candles(200);
  const close = data.map((d) => d.close);
  const { chart } = chartWith(data);
  const m = chart.addIndicator("macd", { fast: 12, slow: 26, signal: 9 });
  const pts = new Map(m.getValues().map((p) => [p.time, p.values]));
  const f = refEma(close, 12), sl = refEma(close, 26);
  const line = close.map((_, i) => f[i] - sl[i]);
  const firstMacd = line.findIndex(Number.isFinite);
  const sig = new Array(line.length).fill(NaN);
  const sub = refEma(line.slice(firstMacd), 9);
  sub.forEach((v, k) => (sig[firstMacd + k] = v));
  for (let i = 0; i < data.length; i++) {
    const v = pts.get(data[i].time);
    if (Number.isFinite(line[i])) near(v!.macd, line[i]);
    if (Number.isFinite(sig[i])) {
      near(v!.signal, sig[i]);
      near(v!.hist, line[i] - sig[i]);
    }
  }
});

test("no look-ahead: every built-in gives identical values on a prefix of the data", () => {
  const data = candles(260);
  for (const def of BUILTIN_INDICATORS) {
    const full = chartWith(data).chart.addIndicator(def.id).getValues();
    const part = chartWith(data.slice(0, 180)).chart.addIndicator(def.id).getValues();
    const fullBy = new Map(full.map((p) => [p.time, p]));
    for (const p of part) {
      if (p.projected) continue;
      const q = fullBy.get(p.time);
      assert.ok(q, `${def.id}: missing ${p.time}`);
      for (const [k, v] of Object.entries(p.values)) {
        if (def.id === "ichimoku" && k === "chikou") continue; // the lagging span is plotted back by design
        near(v, q!.values[k], 1e-9);
      }
    }
  }
});

test("live updates: tail recompute (finite window) and full recompute (recursive) equal a fresh calculation", () => {
  const data = candles(400);
  const { chart, s } = chartWith(data.slice(0, 399));
  const inds = ["sma", "bb", "stoch", "donchian", "ema", "rsi", "macd", "atr", "supertrend"].map((t) => chart.addIndicator(t));
  inds.forEach((i) => i.getValues()); // initial calculation
  const last = data[398];
  s.update({ ...last, close: last.close + 3, high: Math.max(last.high, last.close + 3) }); // replace
  s.update(data[399]); // append
  const fresh = chartWith([...data.slice(0, 398), { ...last, close: last.close + 3, high: Math.max(last.high, last.close + 3) }, data[399]]).chart;
  for (const i of inds) {
    const got = i.getValues();
    const want = fresh.addIndicator(i.type).getValues();
    assert.equal(got.length, want.length, i.type);
    for (let k = Math.max(0, want.length - 30); k < want.length; k++) {
      for (const [key, v] of Object.entries(want[k].values)) near(got[k].values[key], v, 1e-9);
    }
  }
});

test("missing data: gap slots are skipped (no NaN poisoning) and values align to their times", () => {
  const data = candles(120);
  const { chart, a } = chartWith(data);
  const ema = chart.addIndicator("ema", { period: 10 });
  const before = ema.getValues().at(-1)!.values.ema;
  chart.addLineSeries().setData([{ time: data[60].time + 3600, value: 1 }]); // inserts a slot with no candle
  const after = ema.getValues();
  assert.ok(Number.isFinite(after.at(-1)!.values.ema));
  near(after.at(-1)!.values.ema, before);
  const plot = a.last!.extraOverlays![0].values;
  assert.equal(plot.length, a.last!.times.length);
  assert.ok(Number.isNaN(plot[61])); // the inserted slot has no value
});

test("parameters and options are validated; failures change nothing", () => {
  const { chart } = chartWith(candles(50));
  assert.throws(() => chart.addIndicator("nope"), (e: unknown) => e instanceof XChartError && e.code === "UNKNOWN_INDICATOR");
  assert.throws(() => chart.addIndicator("sma", { period: 0 }), /length" must be ≥ 1/);
  assert.throws(() => chart.addIndicator("sma", { period: 2.5 }), /integer/);
  assert.throws(() => chart.addIndicator("sma", { bogus: 1 }), /no parameter "bogus"/);
  assert.throws(() => chart.addIndicator("sma", { color: "notacolour" }), /colour/);
  assert.throws(() => chart.addIndicator("sma", { source: "vwap" }), /source/);
  const i = chart.addIndicator("rsi", { period: 14, pane: "separate" });
  assert.throws(() => i.setParameters({ length: -1 }), /≥/);
  assert.equal(i.parameters().length, 14);
  i.setParameters({ period: 7 });
  assert.equal(i.parameters().length, 7);
  assert.equal(chart.getIndicators().length, 1);
});

test("sources, visibility, panes, removal and indicator API lifecycle", () => {
  const data = candles(100);
  const { chart, a } = chartWith(data);
  const hl = chart.addIndicator("sma", { period: 5, source: "hl2" });
  const v = hl.getValues().at(-1)!.values.sma;
  const ref = data.slice(-5).reduce((s, d) => s + (d.high + d.low) / 2, 0) / 5;
  near(v, ref);
  const rsi = chart.addIndicator("rsi", { period: 14 });
  assert.equal(a.last!.extraPanes!.length, 1);
  assert.deepEqual(a.last!.extraPanes![0].levels, [70, 50, 30]);
  rsi.setVisible(false);
  assert.equal(a.last!.extraPanes!.length, 0);
  rsi.setVisible(true);
  rsi.applyOptions({ pane: "overlay" });
  assert.equal(a.last!.extraPanes!.length, 0);
  assert.ok(chart.removeIndicator(rsi));
  assert.throws(() => rsi.setVisible(true), /removed/);
  rsi.remove(); // idempotent
  assert.equal(chart.getIndicators().length, 1);
  chart.remove();
  assert.throws(() => hl.getValues(), /removed/);
});

test("Ichimoku: projected cloud is flagged and creates no candles", () => {
  const data = candles(120);
  const { chart, a, s } = chartWith(data);
  const ich = chart.addIndicator("ichimoku");
  const pts = ich.getValues();
  const proj = pts.filter((p) => p.projected);
  assert.equal(proj.length, 25);
  assert.ok(proj.every((p) => p.time > data.at(-1)!.time));
  assert.equal(s.data().length, 120); // no fabricated candles
  assert.equal(a.last!.future, 25);
});

const customDef = (over: Partial<IndicatorDefinition> = {}): IndicatorDefinition => ({
  id: "range-pct",
  name: "Range %",
  description: "(high − low) / close × 100",
  params: [{ key: "scale", label: "Scale", type: "number", default: 100, min: 1 }],
  inputs: ["high", "low", "close"],
  outputs: [{ key: "range", label: "Range %", type: "histogram", color: "#64748b" }],
  pane: "separate",
  warmup: () => 0,
  lookback: () => 0,
  calculate: (i: IndicatorInput, p) => ({ range: i.close.map((c, k) => (c === 0 ? NaN : ((i.high[k] - i.low[k]) / c) * Number(p.scale))) }),
  ...over,
});

test("custom indicators: chart-scoped and shared registration, duplicates, built-ins protected", () => {
  const { chart } = chartWith(candles(30));
  chart.registerIndicator(customDef());
  assert.throws(() => chart.registerIndicator(customDef()), (e: unknown) => e instanceof XChartError && e.code === "DUPLICATE_INDICATOR");
  const r = chart.addIndicator("range-pct", { scale: 1 });
  assert.equal(r.getValues().length, 30);
  assert.throws(() => chart.unregisterIndicator("range-pct"), /used on this chart/);
  assert.throws(() => unregisterIndicator("sma"), /Built-in/);
  assert.throws(() => registerIndicator({ ...customDef({ id: "BAD ID" }) }), /must match/);
  registerIndicator(customDef({ id: "shared-range" }));
  assert.ok(getIndicatorDefinition("shared-range"));
  assert.ok(listIndicators().some((d) => d.id === "shared-range"));
  assert.ok(chartWith(candles(5)).chart.listIndicators().some((d) => d.id === "shared-range")); // visible to other charts
  assert.ok(!chartWith(candles(5)).chart.listIndicators().some((d) => d.id === "range-pct")); // chart-scoped stays private
  assert.ok(unregisterIndicator("shared-range"));
  assert.ok(new IndicatorRegistry(builtinRegistry).isBuiltin("macd"));
});

test("custom indicator errors are isolated: the chart and other indicators keep working", () => {
  const { chart, a } = chartWith(candles(40));
  chart.registerIndicator(customDef({ id: "broken", calculate: () => { throw new Error("division exploded"); } }));
  chart.registerIndicator(customDef({ id: "short", calculate: () => ({ range: [1, 2] }) })); // wrong length
  const errors: string[] = [];
  chart.events.on("indicatorError", (e) => errors.push(e.error!));
  const ok = chart.addIndicator("sma", { period: 5 });
  const b = chart.addIndicator("broken");
  const sh = chart.addIndicator("short");
  assert.equal(b.error(), "division exploded");
  assert.match(sh.error()!, /has 2 values for 40 bars/);
  assert.ok(errors.length >= 2);
  assert.equal(ok.getValues().length, 36);
  assert.equal(a.last!.extraPanes!.length, 0); // failed indicators draw nothing
});
