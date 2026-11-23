import { test } from "node:test";
import assert from "node:assert/strict";
import { STRATEGIES, netPremium, payoffAtExpiry, priceLevels, strikeStep, summarise } from "../lib/options/strategy.ts";

const lot = 65;

test("long call: debit, unlimited profit, loss limited to premium, breakeven = K + premium", () => {
  const legs = [{ side: "BUY" as const, right: "CE" as const, strike: 25000, premium: 120, lots: 1 }];
  assert.equal(netPremium(legs, lot), 120 * lot);
  assert.equal(payoffAtExpiry(legs, lot, 24000), -120 * lot);
  assert.equal(payoffAtExpiry(legs, lot, 25300), 180 * lot);
  const s = summarise(legs, lot, 25000);
  assert.equal(s.maxProfit, null);
  assert.equal(s.maxLoss, -120 * lot);
  assert.deepEqual(s.breakevens, [25120]);
});

test("bull call spread: capped both ways", () => {
  const legs = [
    { side: "BUY" as const, right: "CE" as const, strike: 25000, premium: 150, lots: 1 },
    { side: "SELL" as const, right: "CE" as const, strike: 25200, premium: 60, lots: 1 },
  ];
  const s = summarise(legs, lot, 25000);
  assert.equal(s.maxLoss, -90 * lot);
  assert.equal(s.maxProfit, 110 * lot);
  assert.deepEqual(s.breakevens, [25090]);
});

test("short straddle: credit, unlimited loss, two breakevens", () => {
  const legs = [
    { side: "SELL" as const, right: "CE" as const, strike: 25000, premium: 150, lots: 1 },
    { side: "SELL" as const, right: "PE" as const, strike: 25000, premium: 140, lots: 1 },
  ];
  const s = summarise(legs, lot, 25000);
  assert.equal(s.netPremium, -290 * lot);
  assert.equal(s.maxProfit, 290 * lot);
  assert.equal(s.maxLoss, null);
  assert.deepEqual(s.breakevens, [24710, 25290]);
});

test("iron condor: limited both sides", () => {
  const legs = STRATEGIES.find((x) => x.id === "iron-condor")!.legs(25000, 50, 2).map((l, i) => ({ ...l, lots: 1, premium: [60, 25, 55, 20][i] }));
  const s = summarise(legs, lot, 25000);
  assert.equal(s.maxProfit, 70 * lot);
  assert.equal(s.maxLoss, -30 * lot);
  assert.deepEqual(s.breakevens, [24830, 25170]);
});

test("price levels and strike step", () => {
  assert.deepEqual(priceLevels(100, 10, 2), [80, 90, 100, 110, 120]);
  assert.equal(strikeStep([24900, 24950, 25000, 25100]), 50);
});

test("every template builds legs", () => {
  for (const t of STRATEGIES) assert.ok(t.legs(25000, 50, 2).length > 0, t.id);
});
