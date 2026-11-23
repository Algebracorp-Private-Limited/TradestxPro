import { test } from "node:test";
import assert from "node:assert/strict";
import { betaCorr } from "../lib/stats.ts";

test("beta of a 2x levered series is 2 with correlation 1", () => {
  const idx = new Map<string, number>();
  const stock: { d: string; c: number }[] = [];
  let i = 100, s = 100;
  for (let k = 0; k < 60; k++) {
    const d = `2026-01-${String(k).padStart(3, "0")}`;
    const r = Math.sin(k) / 100;
    i *= 1 + r; s *= 1 + 2 * r;
    idx.set(d, i); stock.push({ d, c: s });
  }
  const { beta, corr } = betaCorr(stock, idx);
  assert.ok(Math.abs(beta! - 2) < 1e-9);
  assert.ok(Math.abs(corr! - 1) < 1e-9);
});

test("too little history gives nulls", () => {
  assert.deepEqual(betaCorr([{ d: "a", c: 1 }, { d: "b", c: 2 }], new Map([["a", 1], ["b", 1]])), { beta: null, corr: null });
});
