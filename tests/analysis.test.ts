import { test } from "node:test";
import assert from "node:assert/strict";
import { factsFromBars, technicalRead } from "../lib/analysis-rules.ts";

const series = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));

test("steady uptrend reads bullish with support below price", () => {
  const c = series(260, (i) => 100 + i * 0.5 + Math.sin(i) * 0.3);
  const f = factsFromBars("TEST", "2026-11-20", c.map((x) => x + 1), c.map((x) => x - 1), c)!;
  const r = technicalRead(f);
  assert.equal(r.bias, "Bullish");
  assert.ok(r.levels.support! < f.close);
  assert.ok(r.points.some((p) => p.includes("200-day")));
});

test("steady downtrend reads bearish", () => {
  const c = series(260, (i) => 300 - i * 0.5 + Math.sin(i) * 0.3);
  const f = factsFromBars("TEST", null, c.map((x) => x + 1), c.map((x) => x - 1), c)!;
  assert.equal(technicalRead(f).bias, "Bearish");
});

test("too few bars gives no facts", () => {
  assert.equal(factsFromBars("X", null, [1], [1], [1]), null);
});
