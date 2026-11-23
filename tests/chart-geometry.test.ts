import { test } from "node:test";
import assert from "node:assert/strict";
import { contrastText, fillPolys, futureTime, histTone, withAlpha } from "../lib/chart/geometry.ts";
import * as ta from "../lib/ta/indicators.ts";

test("fill switches colour exactly at a crossing", () => {
  // a goes 2 → 0 while b stays 1: crossing at i = 0.5
  const polys = fillPolys([2, 0], [1, 1], 0, 1);
  assert.equal(polys.length, 2);
  assert.equal(polys[0].up, true);
  assert.equal(polys[1].up, false);
  assert.deepEqual(polys[0].pts[1], [0.5, 1]);
  assert.deepEqual(polys[1].pts[0], [0.5, 1]);
});

test("fill without crossing is one polygon per segment, coloured by side", () => {
  const up = fillPolys([3, 4, 5], [1, 1, 1], 0, 2);
  assert.equal(up.length, 2);
  assert.ok(up.every((p) => p.up));
  const down = fillPolys([0, 0], [1, 2], 0, 1);
  assert.equal(down[0].up, false);
});

test("fill against a constant level, keeping only excursions above it", () => {
  const rsi = [60, 75, 80, 65];
  const polys = fillPolys(rsi, 70, 0, 3, "up");
  assert.ok(polys.length > 0 && polys.every((p) => p.up));
  // the excursion starts between bars 0 and 1 and ends between bars 2 and 3
  const xs = polys.flatMap((p) => p.pts.map(([x]) => x));
  assert.ok(Math.min(...xs) > 0 && Math.max(...xs) < 3);
});

test("fill skips gaps (NaN) and runs past the last bar when the series is longer", () => {
  assert.equal(fillPolys([NaN, 1, 2], [0, 0, 0], 0, 2).length, 1);
  assert.equal(fillPolys([1, 2, 3, 4], [0, 0, 0, 0], 0, 10).length, 3);
});

test("MACD histogram tones", () => {
  assert.equal(histTone(2, 1), 0); // positive, rising
  assert.equal(histTone(1, 2), 1); // positive, falling
  assert.equal(histTone(-2, -1), 2); // negative, falling
  assert.equal(histTone(-1, -2), 3); // negative, rising
  assert.equal(histTone(1, NaN), 0);
});

test("future time skips weekends for daily bars", () => {
  const fri = Date.UTC(2026, 10, 20) / 1000; // Friday 20 Nov 2026
  const thu = fri - 86400;
  assert.equal(futureTime([thu, fri], 1, false), Date.UTC(2026, 10, 23) / 1000); // Monday
  assert.equal(futureTime([thu, fri], 5, false), Date.UTC(2026, 10, 27) / 1000); // next Friday
  assert.equal(futureTime([0, 300, 600], 2, true), 1200);
});

test("colour helpers", () => {
  assert.equal(withAlpha("#22c55e", 0.2), "rgba(34,197,94,0.2)");
  assert.equal(withAlpha("#fff", 1), "rgba(255,255,255,1)");
  assert.equal(withAlpha("rgba(1,2,3,0.5)", 0.1), "rgba(1,2,3,0.1)");
  assert.equal(contrastText("#ffffff"), "#0b1220");
  assert.equal(contrastText("#0f172a"), "#ffffff");
});

test("Ichimoku: spans projected displacement-1 bars ahead, chikou displacement-1 back", () => {
  const n = 120;
  const c = Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.2);
  const h = c.map((x) => x + 1);
  const l = c.map((x) => x - 1);
  const r = ta.ichimoku(h, l, 9, 26, 52, 26, c);
  assert.equal(r.offset, 25);
  const tenkan = ta.highest(h, 9).map((x, i) => (x + ta.lowest(l, 9)[i]) / 2);
  const kijun = ta.highest(h, 26).map((x, i) => (x + ta.lowest(l, 26)[i]) / 2);
  const rawA = tenkan.map((t, i) => (t + kijun[i]) / 2);
  // value plotted at bar 100 was computed at bar 75
  assert.equal(r.spanA[100], rawA[75]);
  // the forward cloud covers exactly 25 future bars and continues the series
  assert.equal(r.futureA.length, 25);
  assert.equal(r.futureA[0], rawA[n - 25]);
  assert.equal(r.futureA[24], rawA[n - 1]);
  assert.equal(r.futureB.length, 25);
  // chikou at bar 10 is the close 25 bars later; the last 25 bars have none
  assert.equal(r.chikou[10], c[35]);
  assert.ok(Number.isNaN(r.chikou[n - 1]));
  assert.ok(Number.isNaN(r.spanA[20]));
});
