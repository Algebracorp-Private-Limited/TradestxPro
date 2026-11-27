import { test } from "node:test";
import assert from "node:assert/strict";
import { bsPrice } from "../lib/options/bs.ts";
import { provenance } from "../lib/intelligence/core/freshness.ts";
import { analyzeContract, type ChainInput, type LegIn } from "../lib/intelligence/options/contract.ts";
import { evaluateStrategy } from "../lib/intelligence/strategy/evaluate.ts";
import { allStrategies, getStrategy } from "../lib/intelligence/strategy/registry.ts";
import { validateContractAnalysis, validateEquityPlan, validateFreshness, validateStrategyEvaluation } from "../lib/intelligence/validation/plans.ts";

const NOW = new Date("2026-11-18T05:30:00Z");
const NEAR = "2026-12-16", NEXT = "2027-01-20";
const live = provenance({ source: "broker:test", kind: "broker-quote", exchangeTime: new Date(NOW.getTime() - 5000).toISOString(), entitlement: "user-broker-session", now: NOW });
const eod = provenance({ source: "nse-fo-bhavcopy", kind: "eod-file", exchangeTime: "2026-11-17", entitlement: "public-eod", now: NOW });
const stale = provenance({ source: "nse-fo-bhavcopy", kind: "eod-file", exchangeTime: "2026-10-01", entitlement: "public-eod", now: NOW });

function chain(expiry: string, prov = live): ChainInput {
  const S = 24000, T = (Date.parse(`${expiry}T10:00:00Z`) - NOW.getTime()) / (365 * 86400e3);
  const leg = (K: number, right: "CE" | "PE"): LegIn => {
    const p = Math.max(0.05, bsPrice({ S, K, T, r: 0.065, sigma: 0.15, right }));
    return { ltp: p, bid: p * 0.997, ask: p * 1.003, oi: 50000, oiChange: 0, volume: 1000, iv: null, delta: null, gamma: null, theta: null, vega: null, greeksSource: null };
  };
  const rows = [];
  for (let K = 22000; K <= 26000; K += 100) rows.push({ strike: K, ce: leg(K, "CE"), pe: leg(K, "PE") });
  return { underlying: "NIFTY", kind: "index", spot: S, expiry, lotSize: 75, rows, provenance: prov, now: NOW };
}
const ctx = { direction: 0.8, regime: "Strong uptrend", atr: 220 };
const limits = { capital: 1e6, maxRiskPerTrade: 20_000, maxCapitalPerTrade: 3e5, minRewardRisk: 1.2 };

test("every registry strategy evaluated at real strikes passes independent validation", () => {
  const inp = { near: chain(NEAR), next: chain(NEXT), futures: { price: 24150, expiry: NEAR } };
  const failures: string[] = [];
  let ok = 0;
  for (const d of allStrategies()) {
    const e = evaluateStrategy(d, inp, ctx, limits, inp.near.provenance);
    if (e.status !== "OK") continue;
    ok++;
    const v = validateStrategyEvaluation(e, inp);
    if (!v.ok) failures.push(`${d.id}: ${v.issues.join("; ")}`);
  }
  assert.ok(ok > 200, `evaluated ${ok}`);
  assert.deepEqual(failures, []);
});

test("corrupted strategy outputs are rejected", () => {
  const inp = { near: chain(NEAR) };
  const e = evaluateStrategy(getStrategy("bull-call-spread")!, inp, ctx, limits, inp.near.provenance);
  assert.ok(validateStrategyEvaluation(e, inp).ok);
  const bad = (patch: Partial<typeof e>) => validateStrategyEvaluation({ ...e, ...patch } as typeof e, inp);
  assert.match(bad({ maxLoss: e.maxLoss! / 2 }).issues.join(), /does not match the recomputed/);
  assert.match(bad({ legs: e.legs.map((l, i) => (i === 0 ? { ...l, strike: 24050 } : l)) }).issues.join(), /not on the strike ladder/);
  assert.match(bad({ legs: e.legs.map((l, i) => (i === 0 ? { ...l, expiry: "2026-12-23" } : l)) }).issues.join(), /has no chain/);
  assert.match(bad({ lotSize: 50 }).issues.join(), /lot size/);
  assert.match(bad({ executionValidated: true as never }).issues.join(), /execution validation/);
  const ss = evaluateStrategy(getStrategy("short-strangle")!, inp, ctx, limits, inp.near.provenance);
  assert.match(validateStrategyEvaluation({ ...ss, unlimitedLoss: false }, inp).issues.join(), /not reported as unlimited/);
  assert.match(validateStrategyEvaluation(ss, inp, { definedRiskOnly: true }).issues.join(), /defined-risk/);
});

test("contract analyses pass; corrupted contract plans and Greeks are rejected", () => {
  const c = chain(NEAR);
  const a = analyzeContract(c, 24000, "CE", ctx, limits)!;
  const v = validateContractAnalysis(a, c);
  assert.deepEqual([v.contract.issues, v.buy.issues, v.sell.issues], [[], [], []]);
  const badStop = validateContractAnalysis({ ...a, buy: { ...a.buy, stopPremium: a.buy.entryPremium!.high + 5 } }, c);
  assert.match(badStop.buy.issues.join(), /stop is not below/);
  const badTgt = validateContractAnalysis({ ...a, buy: { ...a.buy, targetPremium: 1 } }, c);
  assert.match(badTgt.buy.issues.join(), /target is not above/);
  const fakeGreeks = validateContractAnalysis({ ...a, metrics: { ...a.metrics, delta: 0.9 } }, c);
  assert.match(fakeGreeks.contract.issues.join(), /does not recompute/);
  const noSource = validateContractAnalysis({ ...a, metrics: { ...a.metrics, greeksSource: null } }, c);
  assert.match(noSource.contract.issues.join(), /without a declared source/);
  const ghost = validateContractAnalysis({ ...a, strike: 24050 }, c);
  assert.match(ghost.contract.issues.join(), /not on the strike ladder/);
  const past = validateContractAnalysis({ ...a, expiry: "2026-11-01" }, c);
  assert.match(past.contract.issues.join(), /has passed|not the chain's expiry/);
  const lot = validateContractAnalysis({ ...a, lotSize: 50 }, c);
  assert.match(lot.contract.issues.join(), /lot size/);
  const margin = validateContractAnalysis({ ...a, sell: { ...a.sell, requiredMargin: 100000 } }, c);
  assert.match(margin.sell.issues.join(), /margin/);
  const shortWhenDefined = validateContractAnalysis({ ...a, sell: { ...a.sell, status: "WAIT FOR CONFIRMATION" } }, c, { definedRiskOnly: true });
  assert.match(shortWhenDefined.sell.issues.join(), /defined-risk/);
});

test("freshness: entries require real-time data; stale data cannot carry an entry status", () => {
  assert.deepEqual(validateFreshness("ENTER IF CONFIRMED", live), []);
  assert.match(validateFreshness("ENTER IF CONFIRMED", eod).join(), /requires real-time/);
  assert.match(validateFreshness("WAIT FOR CONFIRMATION", stale).join(), /stale/);
  assert.deepEqual(validateFreshness("WATCHLIST", stale), []);
  assert.deepEqual(validateFreshness("ENTER IF CONFIRMED", eod, { requireRealtime: false }), [], "daily-horizon equity plans may use the latest session");
  assert.ok(validateEquityPlan({ status: "ENTER IF CONFIRMED", direction: "long", entry: { low: 100, high: 102 }, stop: 96, targets: [{ price: 110 }], price: 101 }, eod).ok);
  assert.match(validateEquityPlan({ status: "ENTER IF CONFIRMED", direction: "long", entry: { low: 100, high: 102 }, stop: 96, targets: [{ price: 110 }], price: 101 }, stale).issues.join(), /stale/);
});

test("equity plans: side relationships, ordering and distance from price", () => {
  const good = { status: "WAIT FOR CONFIRMATION", direction: "long" as const, entry: { low: 100, high: 102 }, stop: 96, targets: [{ price: 110 }, { price: 116 }], price: 101 };
  assert.ok(validateEquityPlan(good, eod).ok);
  assert.match(validateEquityPlan({ ...good, stop: 103 }, eod).issues.join(), /stop-loss is on the wrong side/);
  assert.match(validateEquityPlan({ ...good, targets: [{ price: 99 }] }, eod).issues.join(), /wrong side/);
  assert.match(validateEquityPlan({ ...good, targets: [{ price: 116 }, { price: 110 }] }, eod).issues.join(), /not ordered/);
  assert.match(validateEquityPlan({ ...good, price: 400 }, eod).issues.join(), /far from the last price/);
  assert.match(validateEquityPlan({ ...good, stop: null }, eod).issues.join(), /incomplete/);
  assert.ok(validateEquityPlan({ ...good, entry: null, stop: null, targets: [], status: "NO TRADE" }, eod).ok);
});
