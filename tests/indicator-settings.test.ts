import { test } from "node:test";
import assert from "node:assert/strict";
import { INDICATOR_BY_ID, type Bar } from "../lib/ta/catalog.ts";
import { resolveIndicator, type ActiveIndicator } from "../lib/ta/indicator-settings.ts";
import * as ta from "../lib/ta/indicators.ts";

const bars: Bar[] = Array.from({ length: 200 }, (_, i) => {
  const c = 100 + Math.sin(i / 7) * 8 + i * 0.1;
  return { t: 1_700_000_000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + i };
});
const ctx = { intraday: false };

test("a layout saved before new inputs existed still resolves (defaults fill the gaps)", () => {
  const old: ActiveIndicator = { uid: "d4", id: "rsi", params: { length: 14 } };
  const r = resolveIndicator(old, bars, ctx)!;
  assert.deepEqual(r.levels, [70, 50, 30]);
  assert.equal(r.series[0].values[150], ta.rsi(bars.map((b) => b.c), 14)[150]); // calculation unchanged
  assert.equal(r.series[0].fills?.length, 2); // OB/OS shading on by default
  assert.equal(r.bands.length, 1); // middle band on, background zones off
});

test("old style overrides (colour/width/visible) are honoured", () => {
  const ind: ActiveIndicator = { uid: "x", id: "macd", params: { fast: 12, slow: 26, signal: 9 }, styles: { signal: { visible: false }, macd: { color: "#123456", width: 3 } } };
  const r = resolveIndicator(ind, bars, ctx)!;
  assert.deepEqual(r.series.map((s) => s.key), ["hist", "macd"]);
  assert.equal(r.series[1].color, "#123456");
  assert.equal(r.series[1].width, 3);
  assert.equal(r.series[0].hist?.colors.length, 4);
  assert.deepEqual(r.levels, [0]);
});

test("Ichimoku cloud fill is configurable and extends 25 bars past the last candle", () => {
  const ind: ActiveIndicator = { uid: "i", id: "ichimoku", params: {}, fills: { cloud: { opacity: 0.5, color: "#00ff00" } } };
  const r = resolveIndicator(ind, bars, ctx)!;
  const a = r.series.find((s) => s.key === "spanA")!;
  assert.equal(a.values.length, bars.length + 25);
  assert.equal(a.fills![0].up, "rgba(0,255,0,0.5)");
  assert.equal(a.fills![0].down, "rgba(239,68,68,0.5)");
  assert.ok(!r.series.some((s) => s.key === "chikou")); // optional, off by default
  const withChikou = resolveIndicator({ ...ind, params: { chikou: 1 } }, bars, ctx)!;
  assert.ok(withChikou.series.some((s) => s.key === "chikou"));
  const hidden = resolveIndicator({ ...ind, fills: { cloud: { visible: false } } }, bars, ctx)!;
  assert.equal(hidden.series.find((s) => s.key === "spanA")!.fills, undefined);
});

test("volume histogram uses up/down candle colours at the chosen opacity", () => {
  const r = resolveIndicator({ uid: "v", id: "volume", params: { length: 20 }, styles: { vol: { opacity: 0.3 } } }, bars, ctx)!;
  const vol = r.series.find((s) => s.key === "vol")!;
  assert.equal(vol.hist?.mode, "candle");
  assert.equal(vol.hist?.colors[0], "rgba(34,197,94,0.3)");
});

test("every catalogue indicator resolves with default params", () => {
  for (const id of Object.keys(INDICATOR_BY_ID)) {
    const r = resolveIndicator({ uid: id, id, params: {} }, bars, ctx);
    assert.ok(r, id);
  }
});

test("legend input summary fills in defaults for inputs added later", async () => {
  const { inputSummary } = await import("../lib/ta/indicator-settings.ts");
  assert.equal(inputSummary({ uid: "r", id: "rsi", params: { length: 14 } }), "14, 70, 30");
});
