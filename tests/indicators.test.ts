import { test } from "node:test";
import assert from "node:assert/strict";
import * as ta from "../lib/ta/indicators.ts";

const close = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];
const near = (a: number, b: number, eps = 0.15) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test("SMA and EMA basics", () => {
  const s = ta.sma([1, 2, 3, 4, 5], 3);
  assert.ok(Number.isNaN(s[1]));
  assert.deepEqual(s.slice(2), [2, 3, 4]);
  const e = ta.ema([1, 2, 3, 4, 5], 3);
  assert.equal(e[2], 2); // seeded with SMA
  assert.equal(e[3], 3); // 0.5*4 + 0.5*2
  assert.equal(e[4], 4);
});

test("EMA of an indicator starts after that indicator warms up", () => {
  const r = ta.rsi(close, 14);
  const e = ta.ema(r, 3);
  assert.ok(Number.isNaN(e[15]));
  assert.ok(!Number.isNaN(e[16]));
});

test("RSI matches Wilder reference values", () => {
  const r = ta.rsi(close, 14);
  assert.ok(Number.isNaN(r[13]));
  near(r[14], 70.53);
  near(r[15], 66.32);
  near(r[16], 66.55);
  near(r[17], 69.41);
  near(r[18], 66.36);
  near(r[19], 57.97);
});

test("RSI edge cases: flat and only-up series", () => {
  assert.equal(ta.rsi(new Array(20).fill(10), 14)[19], 50);
  assert.equal(ta.rsi(Array.from({ length: 20 }, (_, i) => i), 14)[19], 100);
});

test("MACD hist = macd - signal", () => {
  const src = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10);
  const m = ta.macd(src);
  near(m.hist[59], m.macd[59] - m.signal[59], 1e-9);
  assert.ok(Number.isNaN(m.signal[32]) && !Number.isNaN(m.signal[33]));
});

test("Bollinger bands are symmetric around SMA", () => {
  const b = ta.bollinger(close, 5, 2);
  near(b.upper[10] - b.mid[10], b.mid[10] - b.lower[10], 1e-9);
});

test("highest / lowest / change / crossover", () => {
  assert.deepEqual(ta.highest([1, 3, 2, 5], 2).slice(1), [3, 3, 5]);
  assert.deepEqual(ta.lowest([1, 3, 2, 5], 2).slice(1), [1, 2, 2]);
  assert.deepEqual(ta.change([1, 3, 2]).slice(1), [2, -1]);
  assert.deepEqual(ta.crossover([1, 2, 3], [2, 2, 2]), [false, false, true]);
  assert.deepEqual(ta.crossunder([3, 2, 1], [2, 2, 2]), [false, false, true]);
});

test("ATR, ADX, Supertrend stay in sensible ranges on a trending series", () => {
  const n = 120;
  const c = Array.from({ length: n }, (_, i) => 100 + i + Math.sin(i) * 2);
  const h = c.map((x) => x + 1.5);
  const l = c.map((x) => x - 1.5);
  const a = ta.atr(h, l, c, 14);
  assert.ok(a[n - 1] > 0 && a[n - 1] < 10);
  const d = ta.adx(h, l, c, 14);
  assert.ok(d.adx[n - 1] > 20 && d.adx[n - 1] <= 100, `adx ${d.adx[n - 1]}`);
  assert.ok(d.plusDI[n - 1] > d.minusDI[n - 1]);
  const st = ta.supertrend(h, l, c, 10, 3);
  assert.equal(st.dir[n - 1], 1);
  assert.ok(st.line[n - 1] < c[n - 1]);
});

test("oscillators bounded", () => {
  const n = 80;
  const c = Array.from({ length: n }, (_, i) => 50 + Math.sin(i / 3) * 5);
  const h = c.map((x) => x + 1);
  const l = c.map((x) => x - 1);
  const v = c.map(() => 1000);
  const st = ta.stochastic(h, l, c);
  const w = ta.williamsR(h, l, c);
  const m = ta.mfi(h, l, c, v);
  for (let i = 30; i < n; i++) {
    assert.ok(st.k[i] >= 0 && st.k[i] <= 100);
    assert.ok(w[i] <= 0 && w[i] >= -100);
    assert.ok(m[i] >= 0 && m[i] <= 100);
  }
});

test("OBV and VWAP", () => {
  assert.deepEqual(ta.obv([1, 2, 1, 1], [10, 20, 5, 7]), [0, 20, 15, 15]);
  const t = [0, 60, 86400];
  const vw = ta.vwap([2, 4, 10], [2, 4, 10], [2, 4, 10], [1, 1, 1], t);
  assert.deepEqual(vw, [2, 3, 10]); // resets on new IST day
});

test("PSAR and Ichimoku produce values without look-ahead", () => {
  const n = 100;
  const c = Array.from({ length: n }, (_, i) => 100 + i * 0.5);
  const h = c.map((x) => x + 1);
  const l = c.map((x) => x - 1);
  const p = ta.psar(h, l);
  assert.ok(p[n - 1] < l[n - 1]);
  const ich = ta.ichimoku(h, l);
  assert.ok(Number.isNaN(ich.spanA[30]));
  assert.ok(!Number.isNaN(ich.spanA[60]));
});
