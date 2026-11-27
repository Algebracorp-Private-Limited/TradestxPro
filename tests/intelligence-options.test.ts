import { test } from "node:test";
import assert from "node:assert/strict";
import { bsPrice, bsGreeks } from "../lib/options/bs.ts";
import { black76Greeks, black76Price, greeks, iv, price } from "../lib/intelligence/options/pricing.ts";
import { analyzeContract, expectedMove, metrics, moneyness, quickView, type ChainInput, type LegIn } from "../lib/intelligence/options/contract.ts";
import { chainAnalytics, termStructure } from "../lib/intelligence/options/chain-analytics.ts";
import { brokerToChain, eodToChains } from "../lib/intelligence/options/inputs.ts";
import { deterministicContractExplanation } from "../lib/intelligence/options/explain.ts";
import { provenance } from "../lib/intelligence/core/freshness.ts";

const close = (a: number, b: number, tol: number, msg?: string) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b} (±${tol})`);

// ---------------- Pricing models ----------------
test("BSM reference values (Hull: S=42, K=40, r=10%, σ=20%, T=0.5)", () => {
  close(bsPrice({ S: 42, K: 40, T: 0.5, r: 0.1, sigma: 0.2, right: "CE" }), 4.76, 0.01, "call");
  close(bsPrice({ S: 42, K: 40, T: 0.5, r: 0.1, sigma: 0.2, right: "PE" }), 0.81, 0.01, "put");
});

test("Black-76 reference value and put-call parity", () => {
  // Hull Example: F=20, K=20, r=9%, σ=25%, T=4/12 → put ≈ 1.12
  close(black76Price(20, 20, 4 / 12, 0.09, 0.25, "PE"), 1.12, 0.01, "put");
  const F = 24100, K = 24000, T = 30 / 365, r = 0.065, s = 0.14;
  const c = black76Price(F, K, T, r, s, "CE"), p = black76Price(F, K, T, r, s, "PE");
  close(c - p, Math.exp(-r * T) * (F - K), 1e-6, "parity");
});

test("Black-76 Greeks match finite differences; conventions (θ/day, vega & rho per 1pp)", () => {
  const F = 24100, K = 24000, T = 30 / 365, r = 0.065, s = 0.14;
  const g = black76Greeks(F, K, T, r, s, "CE");
  const h = 1;
  close(g.delta, (black76Price(F + h, K, T, r, s, "CE") - black76Price(F - h, K, T, r, s, "CE")) / (2 * h), 1e-4, "delta");
  close(g.vega, black76Price(F, K, T, r, s + 0.01, "CE") - black76Price(F, K, T, r, s, "CE"), 0.05, "vega per pp");
  close(g.theta, black76Price(F, K, T - 1 / 365, r, s, "CE") - black76Price(F, K, T, r, s, "CE"), 0.2, "theta per day");
  assert.ok(g.gamma > 0);
});

test("model dispatch and implied-volatility round trip", () => {
  const base = { underlying: 24000, K: 24200, T: 20 / 365, r: 0.065, q: 0, right: "CE" as const };
  for (const model of ["bsm", "black76"] as const) {
    const p = price({ ...base, model, sigma: 0.17 });
    close(iv(p, { ...base, model }), 0.17, 1e-4, model);
  }
  const g = greeks({ ...base, model: "bsm", sigma: 0.17 });
  assert.deepEqual(g, bsGreeks({ S: 24000, K: 24200, T: 20 / 365, r: 0.065, sigma: 0.17, q: 0, right: "CE" }));
});

// ---------------- Synthetic chain ----------------
const NOW_LIVE = new Date("2026-11-18T05:30:00Z"); // Wednesday 11:00 IST, session open
const EXPIRY = "2026-12-16";
function leg(S: number, K: number, right: "CE" | "PE", T: number, withQuote: boolean): LegIn {
  const sigma = 0.14 + Math.abs(K - S) / S * 0.6 + (right === "PE" && K < S ? 0.01 : 0);
  const p = Math.max(0.05, bsPrice({ S, K, T, r: 0.065, sigma, right }));
  const half = Math.max(0.05, p * 0.004);
  return { ltp: Math.round(p * 20) / 20, bid: withQuote ? Math.round((p - half) * 20) / 20 : null, ask: withQuote ? Math.round((p + half) * 20) / 20 : null, oi: Math.round(1e6 / (1 + Math.abs(K - S) / 100)), oiChange: right === "CE" ? 5000 : -2000, volume: 20000, iv: null, delta: null, gamma: null, theta: null, vega: null, greeksSource: null };
}
function chain(opts: { live?: boolean; kind?: "index" | "stock"; quotes?: boolean } = {}): ChainInput {
  const S = 24000, now = NOW_LIVE, T = (Date.parse(`${EXPIRY}T10:00:00Z`) - now.getTime()) / (365 * 86400e3);
  const rows = [];
  for (let K = 23000; K <= 25000; K += 100) rows.push({ strike: K, ce: leg(S, K, "CE", T, opts.quotes ?? true), pe: leg(S, K, "PE", T, opts.quotes ?? true) });
  const prov = opts.live
    ? provenance({ source: "broker:test", kind: "broker-quote", exchangeTime: new Date(now.getTime() - 5000).toISOString(), entitlement: "user-broker-session", now })
    : provenance({ source: "nse-bhavcopy", kind: "eod-file", exchangeTime: "2026-11-17", entitlement: "public-eod", now });
  return { underlying: "NIFTY", kind: opts.kind ?? "index", spot: S, expiry: EXPIRY, lotSize: 75, rows, provenance: prov, now };
}
const bull = { direction: 0.8, regime: "Strong uptrend", atr: 220 };
const limits = { capital: 1_000_000, maxRiskPerTrade: 10_000, maxCapitalPerTrade: 300_000, minRewardRisk: 1.2 };

test("live provenance is real-time; EOD provenance is not", () => {
  assert.equal(chain({ live: true }).provenance.freshness, "real-time");
  assert.equal(chain().provenance.freshness, "eod");
});

test("moneyness buckets", () => {
  assert.equal(moneyness(24000, 24000, "CE", 100), "ATM");
  assert.equal(moneyness(24000, 22500, "CE", 100), "Deep ITM");
  assert.equal(moneyness(24000, 22500, "PE", 100), "Deep OTM");
  assert.equal(moneyness(24000, 23000, "CE", 100), "ITM");
  assert.equal(moneyness(24000, 24200, "CE", 100), "OTM");
});

test("metrics: model IV recovers the generating volatility; Greeks labelled model; spread computed", () => {
  const c = chain({ live: true });
  const m = metrics(c, 24000, "CE")!;
  assert.equal(m.ivSource, "model");
  assert.equal(m.greeksSource, "model");
  close(m.iv!, 0.14, 0.003, "ATM IV");
  assert.ok(m.delta! > 0.45 && m.delta! < 0.6);
  assert.ok(m.spread !== null && m.spreadPct! < 2);
  assert.equal(m.breakeven, 24000 + m.mid!);
  assert.equal(metrics(c, 99999, "CE"), null);
  const p = metrics(c, 24000, "PE")!;
  assert.ok(p.delta! < 0);
});

test("metrics: broker-supplied IV and Greeks are preserved", () => {
  const c = chain({ live: true });
  const row = c.rows.find((r) => r.strike === 24000)!;
  row.ce = { ...row.ce!, iv: 0.2, delta: 0.51, gamma: 0.0004, theta: -12, vega: 15, greeksSource: "broker" };
  const m = metrics(c, 24000, "CE")!;
  assert.equal(m.ivSource, "broker");
  assert.equal(m.greeksSource, "broker");
  assert.equal(m.delta, 0.51);
  assert.equal(m.theta, -12);
});

test("expected move ≈ spot·IV·√T and straddle present", () => {
  const c = chain({ live: true });
  const em = expectedMove(c);
  assert.equal(em.atmStrike, 24000);
  const T = (Date.parse(`${EXPIRY}T10:00:00Z`) - NOW_LIVE.getTime()) / (365 * 86400e3);
  close(em.ivMove!, 24000 * em.atmIv! * Math.sqrt(T), 2);
  assert.ok(em.straddle! > 0);
});

test("quickView: bullish context favours buying calls over buying puts; scores bounded; no-data case", () => {
  const c = chain({ live: true });
  const ce = quickView(c, 24000, "CE", bull), pe = quickView(c, 24000, "PE", bull);
  assert.ok(ce.buyScore! > pe.buyScore!);
  for (const v of [ce, pe]) for (const s of [v.buyScore!, v.sellScore!]) assert.ok(s >= 0 && s <= 100);
  const empty = chain({ live: true });
  empty.rows[10].ce = { ...empty.rows[10].ce!, ltp: null, bid: null, ask: null };
  assert.equal(quickView(empty, empty.rows[10].strike, "CE", bull).label, "No data");
});

test("analyzeContract invariants: buy levels ordered, sell never execution-validated, disclosures", () => {
  const a = analyzeContract(chain({ live: true }), 24000, "CE", bull, limits)!;
  assert.equal(a.buy.side, "BUY");
  assert.ok(a.buy.stopPremium! < a.buy.entryPremium!.low, "stop below entry");
  assert.ok(a.buy.targetPremium! > a.buy.entryPremium!.high, "target above entry");
  assert.ok(a.buy.additionalTargetPremium! >= a.buy.targetPremium!);
  assert.equal(a.buy.executionValidated, true);
  assert.equal(a.sell.executionValidated, false);
  assert.equal(a.sell.requiredMargin, null);
  assert.equal(a.sell.maxTheoreticalLoss, "Unlimited");
  assert.ok(a.sell.disclosures.some((d) => /unlimited/i.test(d)));
  assert.equal(a.ivRank, null);
  assert.match(a.ivRankNote, /history/);
  // Tick rounding of premium levels
  for (const v of [a.buy.stopPremium!, a.buy.targetPremium!]) { close(Math.round(v / 0.05) * 0.05, v, 1e-9); assert.equal(v, Math.round(v * 100) / 100, "no float noise"); }
  // Sizing respects the per-trade risk limit
  if (a.buy.sizing && a.buy.sizing.quantity > 0) assert.ok(a.buy.sizing.plannedRisk <= limits.maxRiskPerTrade);
});

test("analyzeContract: puts in a bull trend are not entered; EOD data never yields an entry", () => {
  const p = analyzeContract(chain({ live: true }), 24000, "PE", bull, limits)!;
  assert.ok(["AVOID", "NO TRADE", "WATCHLIST"].includes(p.buy.status));
  assert.ok(p.buy.reasons.some((r) => /does not favour/.test(r)));
  const e = analyzeContract(chain(), 24000, "CE", bull, limits)!;
  assert.ok(["WATCHLIST", "NO TRADE"].includes(e.buy.status));
  assert.equal(e.buy.executionValidated, false);
  assert.ok(e.buy.reasons.some((r) => /confirm the live quote/.test(r)));
});

test("analyzeContract: stock options disclose physical settlement; defined-risk-only blocks naked selling", () => {
  const s = analyzeContract(chain({ live: true, kind: "stock" }), 24000, "PE", bull, { ...limits, definedRiskOnly: true })!;
  assert.ok(s.sell.disclosures.some((d) => /physically settled/.test(d)));
  assert.equal(s.sell.status, "NO TRADE");
  assert.match(s.sell.maxTheoreticalLoss, /per lot/);
});

test("analyzeContract: alternatives exclude the chosen strike and are sorted by buy score", () => {
  const a = analyzeContract(chain({ live: true }), 24800, "CE", bull, limits)!;
  assert.ok(a.alternatives.every((x) => x.strike !== 24800));
  for (let i = 1; i < a.alternatives.length; i++) assert.ok(a.alternatives[i - 1].buyScore! >= a.alternatives[i].buyScore!);
  if (a.preferred) assert.ok(a.alternatives.some((x) => x.strike === a.preferred!.strike));
  const ex = deterministicContractExplanation(a);
  assert.match(ex.buyAssessment, new RegExp(a.buy.status));
});

test("chainAnalytics: totals, PCR, concentration, descriptive max pain, no positioning attribution", () => {
  const c = chain({ live: true });
  const a = chainAnalytics(c, bull);
  const ceOi = c.rows.reduce((s, r) => s + (r.ce?.oi ?? 0), 0), peOi = c.rows.reduce((s, r) => s + (r.pe?.oi ?? 0), 0);
  assert.equal(a.totals.ceOi, ceOi);
  close(a.totals.pcrOi!, peOi / ceOi, 0.01);
  assert.equal(a.concentration.calls[0].strike, 24000);
  assert.match(a.maxPain.note, /not a reliable price prediction/);
  assert.match(a.outlook.positioning, /no institutional or dealer positioning is inferred/);
  assert.ok(a.skew.skewPts !== null && a.skew.skewPts > 0, "put wing richer in the synthetic smile");
  assert.ok(a.ranking.length > 0 && a.ranking.length <= 10);
  assert.equal(a.rows.length, c.rows.length);
});

test("termStructure sorts expiries and reports ATM IV per expiry", () => {
  const a = chain({ live: true }), b = { ...chain({ live: true }), expiry: "2026-11-25" };
  const ts = termStructure([a, b]);
  assert.deepEqual(ts.map((t) => t.expiry), ["2026-11-25", EXPIRY]);
  assert.ok(ts.every((t) => t.atmIv !== null && t.totalOi > 0));
});

test("eodToChains groups by expiry, pairs CE/PE, volume = contracts × lot, no bid/ask", () => {
  const prov = provenance({ source: "nse-bhavcopy", kind: "eod-file", exchangeTime: "2026-11-17", entitlement: "public-eod", now: NOW_LIVE });
  const row = (expiry: string, strike: number, right: "CE" | "PE", close: number) => ({ underlying: "NIFTY", inst: "OPTIDX", expiry, strike, right, close, prevClose: null, underlyingPx: 24000, oi: 100, oiChange: 5, contracts: 10, lot: 75, d: "2026-11-17" });
  const cs = eodToChains([row(EXPIRY, 24000, "CE", 300), row(EXPIRY, 24000, "PE", 280), row("2026-11-25", 24000, "CE", 0)], prov, "index");
  assert.equal(cs.length, 2);
  const c = cs.find((x) => x.expiry === EXPIRY)!;
  assert.equal(c.rows.length, 1);
  assert.equal(c.rows[0].ce!.volume, 750);
  assert.equal(c.rows[0].ce!.bid, null);
  assert.equal(c.spot, 24000);
  assert.equal(cs.find((x) => x.expiry === "2026-11-25")!.rows[0].ce!.ltp, null, "zero close is no price");
});

test("brokerToChain requires an expiry and keeps broker Greeks", () => {
  const prov = chain({ live: true }).provenance;
  assert.equal(brokerToChain({ underlying: "NIFTY", kind: "index", spot: 1, expiry: null, lotSize: 75, rows: [] }, prov), null);
  const c = brokerToChain({ underlying: "NIFTY", kind: "index", spot: 24000, expiry: EXPIRY, lotSize: 75, rows: [{ strike: 24000, ce: { ltp: 300, delta: 0.5, greeksSource: "broker" }, pe: null }] }, prov)!;
  assert.equal(c.rows[0].ce!.delta, 0.5);
  assert.equal(c.rows[0].ce!.greeksSource, "broker");
  assert.equal(c.rows[0].ce!.bid, null);
});
