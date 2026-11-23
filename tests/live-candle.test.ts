import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeLiveCandle } from "../lib/live-candle.ts";

const fri = Date.parse("2026-11-20T00:00:00Z") / 1000;
const bars = [{ t: fri, o: 25300, h: 25966, l: 25353, c: 25800, v: 0 }];
const mondayNoonIst = Date.parse("2026-11-23T06:30:00Z");
const q = { ltp: 25571, open: 25790, high: 25810, low: 25540, volume: null };

test("appends today's live candle to daily bars", () => {
  const out = mergeLiveCandle(bars, q, "1D", mondayNoonIst);
  assert.equal(out.length, 2);
  assert.deepEqual(out[1], { t: Date.parse("2026-11-23T00:00:00Z") / 1000, o: 25790, h: 25810, l: 25540, c: 25571, v: 0 });
});

test("updates today's candle when the broker already has it", () => {
  const today = [{ t: Date.parse("2026-11-23T00:00:00Z") / 1000, o: 25790, h: 25800, l: 25600, c: 25700, v: 10 }];
  const out = mergeLiveCandle(today, q, "1D", mondayNoonIst);
  assert.equal(out.length, 1);
  assert.equal(out[0].c, 25571);
  assert.equal(out[0].l, 25540);
  assert.equal(out[0].h, 25810);
});

test("weekly: new week starts a bar; same week extends it; weekends untouched", () => {
  const w = mergeLiveCandle([{ t: Date.parse("2026-11-16T00:00:00Z") / 1000, o: 1, h: 2, l: 1, c: 2, v: 0 }], q, "1W", mondayNoonIst);
  assert.equal(w.length, 2);
  assert.equal(w[1].t, Date.parse("2026-11-23T00:00:00Z") / 1000);
  const sat = Date.parse("2026-11-21T06:30:00Z");
  assert.equal(mergeLiveCandle(bars, q, "1D", sat).length, 1);
});
