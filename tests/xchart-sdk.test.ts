import test from "node:test";
import assert from "node:assert/strict";
import { validateBar, validateBars, validateRange } from "../lib/xchart-sdk/validation.ts";

test("accepts valid OHLC candles", () => {
  assert.doesNotThrow(() => validateBar("candlestick", { time: 1700000000, open: 100, high: 110, low: 90, close: 105 }));
});
test("rejects invalid OHLC ranges", () => {
  assert.throws(() => validateBar("candlestick", { time: 1700000000, open: 100, high: 99, low: 90, close: 105 }), RangeError);
});
test("rejects duplicate and unsorted times", () => {
  assert.throws(() => validateBars("line", [{ time: 2, value: 1 }, { time: 2, value: 3 }]), RangeError);
  assert.throws(() => validateBars("line", [{ time: 2, value: 1 }, { time: 1, value: 3 }]), RangeError);
});
test("rejects NaN and invalid volume", () => {
  assert.throws(() => validateBar("line", { time: 2, value: NaN }), RangeError);
  assert.throws(() => validateBar("candlestick", { time: 2, open: 1, high: 2, low: 0, close: 1, volume: -1 }), RangeError);
});
test("requires valid visible range", () => {
  assert.doesNotThrow(() => validateRange({ from: 1, to: 2 }));
  assert.throws(() => validateRange({ from: 2, to: 2 }), RangeError);
});
