import { test } from "node:test";
import assert from "node:assert/strict";
import { bsPrice } from "../lib/options/bs.ts";
import { STRATEGIES, summarise, type Leg } from "../lib/options/strategy.ts";
import { allStrategies, filterStrategies, getStrategy, registerStrategy, riskOf } from "../lib/intelligence/strategy/registry.ts";
import { buildLegs, evaluateStrategy, pnlAt, rankStrategies, viewFit } from "../lib/intelligence/strategy/evaluate.ts";
import { analyzeFutures, priceOiPattern } from "../lib/intelligence/futures/analyze.ts";
import { parseFoFutures } from "../lib/eod-parse.ts";
import { provenance } from "../lib/intelligence/core/freshness.ts";
import type { ChainInput, LegIn } from "../lib/intelligence/options/contract.ts";
import type { EodFutureRow } from "../lib/intelligence/market-data/data.ts";

// ---------------- Registry ----------------
test("registry: more than 241 strategies, unique ids, all valid", () => {
  const all = allStrategies();
  assert.ok(all.length > 241, `registry has ${all.length}`);
  assert.equal(new Set(all.map((d) => d.id)).size, all.length);
  for (const d of all) assert.ok(d.legs.length >= 1 && d.legs.length <= 6, d.id);
});

test("registry: the strategy builder's templates are canonical members with the same legs", () => {
  for (const t of STRATEGIES) {
    const d = getStrategy(t.id);
    assert.ok(d, `missing ${t.id}`);
    const fromBuilder = t.legs(0, 1, 2).map((l) => `${l.side}${l.right}${l.strike}`).sort();
    const fromRegistry = d!.legs.map((l) => `${l.side}${l.right}${l.offset}`).sort();
    assert.deepEqual(fromRegistry, fromBuilder, t.id);
  }
});

test("registry: BUY ONLY / SELL ONLY classification and filters", () => {
  const buy = filterStrategies({ mode: "BUY_ONLY" }), sell = filterStrategies({ mode: "SELL_ONLY" });
  assert.ok(buy.length > 0 && sell.length > 0);
  assert.ok(buy.every((d) => d.legs.every((l) => l.side === "BUY")));
  assert.ok(sell.every((d) => d.legs.every((l) => l.side === "SELL")));
  assert.ok(filterStrategies({ definedRiskOnly: true }).every((d) => d.risk === "defined"));
  assert.ok(filterStrategies({ singleLegOnly: true }).every((d) => d.legCount === 1));
  assert.ok(filterStrategies({ allowFutures: false }).every((d) => !d.usesFutures));
  assert.equal(getStrategy("short-straddle")!.classification, "SELL_ONLY");
  assert.equal(getStrategy("iron-condor")!.classification, "MIXED");
});

test("registry: risk derivation", () => {
  const r = (id: string) => getStrategy(id)!.risk;
  assert.equal(r("long-call"), "defined");
  assert.equal(r("bull-put-spread"), "defined");
  assert.equal(r("iron-condor"), "defined");
  assert.equal(r("short-strangle"), "undefined");
  assert.equal(r("short-put-atm"), "undefined");
  assert.equal(r("call-ratio-spread-w2"), "undefined");
  assert.equal(r("long-futures"), "undefined");
  assert.equal(r("protective-put-futures-w2"), "defined");
  assert.equal(riskOf([{ side: "SELL", right: "CE", offset: 0, ratio: 1, expiry: "near" }, { side: "BUY", right: "CE", offset: 0, ratio: 1, expiry: "next" }]), "defined");
});

test("registry: registerStrategy validates and rejects duplicates", () => {
  assert.throws(() => registerStrategy({ id: "long-call", name: "dup", family: "x", view: "Bullish", summary: "", legs: [{ side: "BUY", right: "CE", offset: 0, ratio: 1, expiry: "near" }] }), /duplicate/);
  assert.throws(() => registerStrategy({ id: "bad-ratio", name: "x", family: "x", view: "Bullish", summary: "", legs: [{ side: "BUY", right: "CE", offset: 0, ratio: 9, expiry: "near" }] }), /ratio/);
  const n = allStrategies().length;
  registerStrategy({ id: "test-custom-spread", name: "Custom", family: "Custom", view: "Bullish", summary: "", legs: [{ side: "BUY", right: "CE", offset: 1, ratio: 1, expiry: "near" }, { side: "SELL", right: "CE", offset: 4, ratio: 1, expiry: "near" }] });
  assert.equal(allStrategies().length, n + 1);
});

// ---------------- Evaluation ----------------
const NOW = new Date("2026-11-18T05:30:00Z");
const NEAR = "2026-12-16", NEXT = "2027-01-20";
function chain(expiry: string, live = true): ChainInput {
  const S = 24000, T = (Date.parse(`${expiry}T10:00:00Z`) - NOW.getTime()) / (365 * 86400e3);
  const leg = (K: number, right: "CE" | "PE"): LegIn => {
    const p = Math.max(0.05, bsPrice({ S, K, T, r: 0.065, sigma: 0.15, right }));
    return { ltp: p, bid: p * 0.997, ask: p * 1.003, oi: 50000, oiChange: 0, volume: 1000, iv: null, delta: null, gamma: null, theta: null, vega: null, greeksSource: null };
  };
  const rows = [];
  for (let K = 22000; K <= 26000; K += 100) rows.push({ strike: K, ce: leg(K, "CE"), pe: leg(K, "PE") });
  const prov = live ? provenance({ source: "broker:test", kind: "broker-quote", exchangeTime: new Date(NOW.getTime() - 5000).toISOString(), entitlement: "user-broker-session", now: NOW })
    : provenance({ source: "nse-fo-bhavcopy", kind: "eod-file", exchangeTime: "2026-11-17", entitlement: "public-eod", now: NOW });
  return { underlying: "NIFTY", kind: "index", spot: S, expiry, lotSize: 75, rows, provenance: prov, now: NOW };
}
const inputs = { near: chain(NEAR), next: chain(NEXT), futures: { price: 24150, expiry: NEAR } };
const bull = { direction: 0.8, regime: "Strong uptrend", atr: 220 };
const limits = { maxRiskPerTrade: 20_000, capital: 1_000_000 };

test("evaluation matches the existing payoff engine for single-expiry option strategies", () => {
  for (const id of ["bull-call-spread", "iron-condor", "long-straddle", "bear-put-spread"]) {
    const e = evaluateStrategy(getStrategy(id)!, inputs, bull, limits, inputs.near.provenance);
    assert.equal(e.status, "OK", id);
    const legs: Leg[] = e.legs.map((l) => ({ side: l.side, right: l.right as "CE" | "PE", strike: l.strike!, premium: l.premium, lots: l.ratio }));
    const ref = summarise(legs, 75, 24000);
    assert.ok(Math.abs(e.netPremium! - ref.netPremium) < 0.5, `${id} premium`);
    if (ref.maxLoss !== null) assert.ok(Math.abs(e.maxLoss! - ref.maxLoss) < 1, `${id} max loss ${e.maxLoss} vs ${ref.maxLoss}`);
    if (ref.maxProfit !== null) assert.ok(Math.abs(e.maxProfit! - ref.maxProfit) < 1, `${id} max profit`);
    else assert.equal(e.unlimitedProfit, true);
    assert.equal(e.breakevens.length, ref.breakevens.length, `${id} breakevens`);
    for (let i = 0; i < ref.breakevens.length; i++) assert.ok(Math.abs(e.breakevens[i] - ref.breakevens[i]) < 5, `${id} breakeven ${i}`);
  }
});

test("evaluation: unlimited loss flagged; never execution-validated; margin never shown; scores bounded", () => {
  const e = evaluateStrategy(getStrategy("short-strangle")!, inputs, bull, limits, inputs.near.provenance);
  assert.equal(e.unlimitedLoss, true);
  assert.equal(e.maxLoss, null);
  assert.equal(e.executionValidated, false);
  assert.equal(e.requiredMargin, null);
  assert.ok(e.disclosures.some((d) => /unlimited/.test(d)));
  for (const d of allStrategies().slice(0, 80)) {
    const x = evaluateStrategy(d, inputs, bull, limits, inputs.near.provenance);
    if (x.score !== null) assert.ok(x.score >= 0 && x.score <= 100, d.id);
  }
});

test("evaluation: missing data yields INSUFFICIENT DATA with the missing items", () => {
  const noFut = evaluateStrategy(getStrategy("long-futures")!, { near: inputs.near }, bull, limits, inputs.near.provenance);
  assert.equal(noFut.status, "INSUFFICIENT DATA");
  assert.ok(noFut.missing.includes("near-month futures price"));
  const noNext = evaluateStrategy(getStrategy("long-call-calendar-aatm")!, { near: inputs.near }, bull, limits, inputs.near.provenance);
  assert.ok(noNext.missing.includes("next expiry chain"));
  const far = evaluateStrategy(getStrategy("long-call-p4")!, { near: { ...inputs.near, rows: inputs.near.rows.filter((r) => r.strike <= 24200) } }, bull, limits, inputs.near.provenance);
  assert.equal(far.status, "INSUFFICIENT DATA");
  assert.match(far.missing[0], /24400 CE premium/);
});

test("calendar payoff uses the model for the next-expiry leg and is labelled", () => {
  const def = getStrategy("long-call-calendar-aatm")!;
  const e = evaluateStrategy(def, inputs, bull, limits, inputs.near.provenance);
  assert.equal(e.status, "OK");
  assert.equal(e.model, "intrinsic + model (next expiry)");
  const { legs } = buildLegs(def, inputs);
  // At the near expiry, the calendar is worth most near the strike.
  assert.ok(pnlAt(legs, 24000, NEAR, NOW) > pnlAt(legs, 22500, NEAR, NOW));
  assert.ok(pnlAt(legs, 24000, NEAR, NOW) > pnlAt(legs, 25500, NEAR, NOW));
});

test("viewFit and ranking: bullish context ranks bullish structures above bearish ones; EOD noted", () => {
  assert.ok(viewFit("Bullish", bull).v > viewFit("Bearish", bull).v);
  const r = rankStrategies(filterStrategies({ allowMultiExpiry: false, allowFutures: false }), { near: chain(NEAR, false) }, bull, limits, { top: 15 });
  assert.ok(r.ranked.length > 0);
  for (let i = 1; i < r.ranked.length; i++) assert.ok(r.ranked[i - 1].score! >= r.ranked[i].score!);
  const top = r.ranked.slice(0, 5);
  assert.ok(top.every((e) => !["Bearish", "Mildly bearish"].includes(e.view)), JSON.stringify(top.map((t) => t.id)));
  assert.ok(r.ranked[0].reasons.some((x) => /eod: re-price/.test(x)));
});

test("sizing: lots limited by the per-trade risk budget", () => {
  const e = evaluateStrategy(getStrategy("bull-call-spread")!, inputs, bull, { maxRiskPerTrade: 20_000, capital: 1e6 }, inputs.near.provenance);
  assert.ok(e.sizing && e.sizing.lots >= 0);
  assert.ok(-e.sizing!.maxLossTotal! <= 20_000);
});

// ---------------- Futures ----------------
const futRow = (expiry: string, close: number, extra: Partial<EodFutureRow> = {}): EodFutureRow => ({ underlying: "NIFTY", inst: "IDF", expiry, close, prevClose: close / 1.01, settle: close, underlyingPx: 24000, oi: 1e6, oiChange: 5e4, contracts: 2e4, lot: 75, d: "2026-11-17", ...extra });
const eodProv = provenance({ source: "nse-fo-bhavcopy", kind: "eod-file", exchangeTime: "2026-11-17", entitlement: "public-eod", now: NOW });
const fLimits = { capital: 2_000_000, maxRiskPerTrade: 20_000, maxCapitalPerTrade: 2_000_000, minRewardRisk: 1.2 };

test("futures: basis, carry, roll spread, neutral price/OI pattern; EOD never enters", () => {
  const a = analyzeFutures("NIFTY", [futRow(NEAR, 24150), futRow(NEXT, 24300)], bull, 24000, fLimits, eodProv, NOW);
  assert.equal(a.basis, 150);
  assert.ok(Math.abs(a.basisPct! - 0.63) < 0.01);
  assert.ok(a.annualisedCarryPct! > 0);
  assert.equal(a.rollSpread, 150);
  assert.equal(a.pattern!.label, "Price up, OI up");
  assert.match(a.pattern!.note, /does not identify who/);
  assert.equal(a.plan.side, "LONG");
  assert.ok(a.plan.stop! < a.plan.entryTrigger! && a.plan.target! > a.plan.entryTrigger!);
  assert.ok(["WATCHLIST", "NO TRADE"].includes(a.status));
  assert.equal(a.executionValidated, false);
  assert.equal(a.requiredMargin, null);
});

test("futures: short in a downtrend, no plan when range-bound, roll warning, missing data", () => {
  const bear = analyzeFutures("NIFTY", [futRow(NEAR, 24150)], { direction: -0.7, regime: "Downtrend", atr: 200 }, 24000, fLimits, eodProv, NOW);
  assert.equal(bear.plan.side, "SHORT");
  assert.ok(bear.plan.stop! > bear.plan.entryTrigger!);
  const flat = analyzeFutures("NIFTY", [futRow(NEAR, 24150)], { direction: 0.1, regime: "Range", atr: 200 }, 24000, fLimits, eodProv, NOW);
  assert.equal(flat.status, "NO TRADE");
  const soon = analyzeFutures("NIFTY", [futRow("2026-11-20", 24050), futRow(NEAR, 24150)], bull, 24000, fLimits, eodProv, NOW);
  assert.match(soon.rollNote!, /next month/);
  const none = analyzeFutures("NIFTY", [], bull, 24000, fLimits, eodProv, NOW);
  assert.equal(none.status, "INSUFFICIENT DATA");
  assert.ok(none.missing.includes("near-month futures price"));
  const noBars = analyzeFutures("NIFTY", [futRow(NEAR, 24150)], { direction: null, regime: null, atr: null }, 24000, fLimits, eodProv, NOW);
  assert.equal(noBars.status, "INSUFFICIENT DATA");
});

test("priceOiPattern covers the four cases and unchanged OI", () => {
  assert.equal(priceOiPattern(1, -5)!.label, "Price up, OI down");
  assert.match(priceOiPattern(-1, 5)!.note, /short build-up/);
  assert.match(priceOiPattern(-1, -5)!.note, /long unwinding/);
  assert.equal(priceOiPattern(1, 0)!.label, "Price up, OI unchanged");
  assert.equal(priceOiPattern(null, 5), null);
});

test("parseFoFutures keeps index and stock futures that traded or carry OI", () => {
  const csv = `TradDt,FinInstrmTp,TckrSymb,XpryDt,StrkPric,OptnTp,ClsPric,LastPric,PrvsClsgPric,SttlmPric,UndrlygPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,NewBrdLotQty
2026-11-20,IDF,NIFTY,2026-11-25,,,26010,26012,25900,26008,25950,1500000,-25000,90000,75
2026-11-20,STF,TCS,2026-12-30,,,0,0,0,0,2398,0,0,0,175
2026-11-20,IDO,NIFTY,2026-11-25,26000,CE,120.5,121,100,,25950,65000,13000,500,65`;
  const rows = parseFoFutures(csv);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { underlying: "NIFTY", inst: "IDF", expiry: "2026-11-25", close: 26010, prev_close: 25900, settle: 26008, underlying_px: 25950, oi_qty: 1500000, oi_chg_qty: -25000, contracts: 90000, lot: 75 });
});
