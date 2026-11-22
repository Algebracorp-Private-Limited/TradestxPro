import { test } from "node:test";
import assert from "node:assert/strict";
import { atmStrike, bsGreeks, bsPrice, cdf, impliedVol, maxPain, pcr, yearsToExpiry } from "../lib/options/bs.ts";

const near = (a: number, b: number, eps: number) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test("normal CDF", () => {
  near(cdf(0), 0.5, 1e-7);
  near(cdf(1.96), 0.975, 1e-4);
  near(cdf(-1), 0.158655, 1e-5);
});

test("Black-Scholes matches the textbook example (Hull: S=42, K=40, r=10%, σ=20%, T=0.5)", () => {
  const base = { S: 42, K: 40, T: 0.5, r: 0.1, sigma: 0.2 };
  near(bsPrice({ ...base, right: "CE" }), 4.76, 0.01);
  near(bsPrice({ ...base, right: "PE" }), 0.81, 0.01);
});

test("put-call parity holds", () => {
  const b = { S: 25000, K: 25200, T: 7 / 365, r: 0.065, sigma: 0.14 };
  const c = bsPrice({ ...b, right: "CE" });
  const p = bsPrice({ ...b, right: "PE" });
  near(c - p, b.S - b.K * Math.exp(-b.r * b.T), 1e-6);
});

test("Greeks have the right signs and sizes", () => {
  const b = { S: 25000, K: 25000, T: 7 / 365, r: 0.065, sigma: 0.14 };
  const c = bsGreeks({ ...b, right: "CE" });
  const p = bsGreeks({ ...b, right: "PE" });
  assert.ok(c.delta > 0.5 && c.delta < 0.6, `call delta ${c.delta}`);
  near(c.delta - p.delta, 1, 1e-6);
  assert.ok(c.gamma > 0 && c.gamma === p.gamma);
  assert.ok(c.theta < 0 && p.theta < 0);
  assert.ok(c.vega > 0);
  // theta per day for an ATM weekly NIFTY option is a few tens of points
  assert.ok(c.theta < -5 && c.theta > -40, `theta ${c.theta}`);
});

test("implied vol round-trips", () => {
  const b = { S: 25000, K: 24800, T: 10 / 365, r: 0.065, right: "PE" as const };
  const price = bsPrice({ ...b, sigma: 0.173 });
  near(impliedVol(price, b), 0.173, 1e-4);
  assert.ok(Number.isNaN(impliedVol(0, b)));
  assert.ok(Number.isNaN(impliedVol(1, { ...b, right: "CE", K: 20000 }))); // below intrinsic
});

test("PCR, max pain, ATM and time to expiry", () => {
  const rows = [
    { strike: 100, ce: { oi: 10 }, pe: { oi: 50 } },
    { strike: 110, ce: { oi: 40 }, pe: { oi: 40 } },
    { strike: 120, ce: { oi: 60 }, pe: { oi: 5 } },
  ];
  near(pcr(rows)!, 95 / 110, 1e-9);
  assert.equal(maxPain(rows), 110);
  assert.equal(atmStrike([100, 110, 120], 113), 110);
  near(yearsToExpiry("2026-11-25", new Date("2026-11-18T10:00:00Z")) * 365, 7.0, 0.01);
});
