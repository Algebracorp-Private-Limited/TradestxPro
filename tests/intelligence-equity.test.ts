import test from "node:test";
import assert from "node:assert/strict";
import { estimateCosts, scheduleFor, SCHEDULES } from "../lib/intelligence/risk/costs.ts";
import { sizePosition } from "../lib/intelligence/risk/sizing.ts";
import { score } from "../lib/intelligence/scoring.ts";
import { analyzeEquity, type EquityInput } from "../lib/intelligence/equity/setup.ts";
import { provenance } from "../lib/intelligence/core/freshness.ts";
import { checkExplanation, ungroundedNumbers } from "../lib/intelligence/validation/grounding.ts";
import { present } from "../lib/intelligence/present.ts";
import { parseFundamentals, periodsKnownAt, FundamentalsError } from "../lib/intelligence/fundamentals/dataset.ts";
import { analyzeInvestment, dcfValue, quality, reverseDcf } from "../lib/intelligence/fundamentals/analysis.ts";
import { sanitizeScanConfig } from "../lib/intelligence/market-scan/config.ts";
import { AIClient } from "../lib/intelligence/ai-providers/client.ts";
import { MockProvider } from "../lib/intelligence/ai-providers/providers.ts";
import { explainEquity } from "../lib/intelligence/equity/explain.ts";

// ---------- costs (hand-computed reference) ----------
test("transaction costs: delivery round trip matches a hand calculation; schedules are dated and reviewable", () => {
  const c = estimateCosts([{ segment: "equity-delivery", side: "BUY", price: 1000, quantity: 100 }, { segment: "equity-delivery", side: "SELL", price: 1100, quantity: 100 }], { tradeDate: "2026-11-26", today: "2026-11-27" });
  // turnover 210000; brokerage 2×20; STT 0.1% both sides = 210; exchange 210000×0.00297% = 6.237; SEBI 0.21;
  // stamp 0.015% of buy = 15; GST 18% × (40 + 6.237 + 0.21) = 8.360; slippage 5 bps × 210000 = 105.
  assert.deepEqual([c.turnover, c.brokerage, c.stt, c.exchange, c.sebi, c.stamp, c.gst, c.statutoryTotal, c.slippage, c.total], [210000, 40, 210, 6.24, 0.21, 15, 8.36, 239.81, 105, 384.81]);
  assert.equal(c.scheduleId, "IN-2024-10");
  assert.equal(c.scheduleReviewDue, true, "a schedule not reviewed for >180 days is flagged, not trusted silently");
  assert.ok(c.assumptions.some((a) => a.includes("brokerage")));
  const o = estimateCosts([{ segment: "options", side: "SELL", price: 100, quantity: 75 }], { tradeDate: "2026-11-26", brokeragePerOrder: 0, slippage: 0, today: "2024-12-01" });
  // options sell: STT 0.1% of premium 7500 = 7.5; exchange 0.03503% = 2.627; stamp none (sell); SEBI 0.0075; GST 18% × 2.635 = 0.474.
  assert.deepEqual([o.stt, o.exchange, o.stamp, o.gst], [7.5, 2.63, 0, 0.47]);
  assert.equal(o.scheduleReviewDue, false);
  assert.throws(() => scheduleFor("2020-01-01"), /no cost schedule/);
  assert.ok(SCHEDULES.every((s) => s.sources.length > 0));
});

test("position sizing: risk limit, capital limit, whole lots", () => {
  assert.deepEqual(sizePosition(100, 95, { capital: 1e6, maxRiskPerTrade: 1000, maxCapitalPerTrade: 1e6 }).quantity, 200);
  const cap = sizePosition(100, 99, { capital: 1e6, maxRiskPerTrade: 1000, maxCapitalPerTrade: 5000 });
  assert.equal(cap.quantity, 50);
  assert.equal(cap.limitedBy, "capital");
  const lots = sizePosition(100, 95, { capital: 1e6, maxRiskPerTrade: 1000 }, 75);
  assert.deepEqual([lots.quantity, lots.lots], [150, 2]);
  const none = sizePosition(100, 80, { capital: 1e6, maxRiskPerTrade: 1000 }, 75);
  assert.equal(none.quantity, 0);
  assert.match(none.reasons[0], /one lot/);
});

test("scoring: weighted, re-normalised without inapplicable parts, not a probability", () => {
  const s = score({ trend: { value: 1, reason: "a" }, rewardRisk: { value: 0.5, reason: "b" } });
  assert.equal(s.total, Math.round(((1 * 15 + 0.5 * 15) / 30) * 100));
  assert.ok(s.notApplicable.includes("positioning"));
  assert.match(s.disclaimer, /not a probability/);
});

// ---------- equity setups ----------
const NOW = "2026-11-26";
function bars(n: number, f: (i: number) => number, vol = (i: number) => 2e6 + (i % 7) * 1e5) {
  const start = Date.parse("2025-06-02T00:00:00Z") / 1000;
  return Array.from({ length: n }, (_, i) => {
    const c = f(i), o = f(Math.max(0, i - 1));
    return { t: start + i * 86400, o, h: Math.max(o, c) * 1.006, l: Math.min(o, c) * 0.994, c, v: vol(i) };
  });
}
const prov = (date = NOW) => provenance({ source: "test", kind: "eod-file", exchangeTime: date, entitlement: "synthetic", now: new Date(`${NOW}T14:00:00Z`) });
const base = (b: EquityInput["bars"], extra: Partial<EquityInput> = {}): EquityInput => ({
  symbol: "TEST", name: "Test Ltd", sector: "Test", bars: b, provenance: prov(), horizon: "swing", constraints: { capital: 1e6, maxRiskPerTrade: 10_000, maxCapitalPerTrade: 300_000, minRewardRisk: 1.5, minLiquidity: 1e7 }, today: NOW, ...extra,
});

test("equity: breakout plan levels are ordered; quantity respects limits; costs included", () => {
  const b = bars(260, (i) => (i < 259 ? 500 + 6 * Math.sin(i / 4) : 525), (i) => (i === 259 ? 9e6 : 2e6));
  const s = analyzeEquity(base(b));
  assert.equal(s.setup, "Breakout");
  assert.ok(["ENTER IF CONFIRMED", "WAIT FOR CONFIRMATION", "WATCHLIST", "AVOID"].includes(s.status), s.status);
  assert.ok(s.stop! < s.entry!.low && s.entry!.low <= s.entry!.high && s.entry!.high < s.targets[0].price && s.targets[0].price < s.targets[1].price, JSON.stringify([s.stop, s.entry, s.targets]));
  assert.ok(s.sizing!.plannedRisk <= 10_000 && s.sizing!.capitalUsed <= 300_000);
  assert.ok(s.costs && s.costs.total > 0);
  assert.ok(s.confirmation && s.invalidation && s.timeExit && s.trailing);
  assert.ok(s.reasonsToAvoid.some((r) => r.includes("end-of-day data")));
});

test("equity: refusal paths — intraday without real-time data, stale data, bearish cash shorts, insufficient history, sideways", () => {
  const b = bars(260, (i) => 100 + i * 0.3);
  assert.equal(analyzeEquity(base(b, { horizon: "intraday" })).status, "INSUFFICIENT DATA");
  const stale = analyzeEquity(base(b, { provenance: prov("2026-11-10") }));
  assert.equal(stale.status, "INSUFFICIENT DATA");
  const bear = analyzeEquity(base(bars(260, (i) => 300 - i * 0.6)));
  assert.equal(bear.status, "NO TRADE");
  assert.match(bear.reasonsToAvoid[0], /short/);
  assert.equal(analyzeEquity(base(bars(30, (i) => 100 + i))).status, "INSUFFICIENT DATA");
  const flat = analyzeEquity(base(bars(260, (i) => 100 + 2 * Math.sin(i / 2.3))));
  assert.ok(["NO TRADE", "WATCHLIST", "ENTER IF CONFIRMED", "WAIT FOR CONFIRMATION", "AVOID"].includes(flat.status));
  const illiquid = analyzeEquity(base(bars(260, (i) => (i < 259 ? 500 + 6 * Math.sin(i / 4) : 525), () => 100)));
  if (illiquid.entry) assert.equal(illiquid.status, "AVOID", "below minimum liquidity");
});

// ---------- grounding & presentation ----------
test("grounding: invented numbers and certainty claims are rejected", () => {
  const facts = { stop: 480.5, targets: [{ price: 540 }], rr: 1.85, value: 25_000_000 };
  assert.deepEqual(ungroundedNumbers("Stop at 480.50, target 540 (R:R 1.85), traded value ₹2.5 crore, RSI 14", facts), []);
  assert.deepEqual(ungroundedNumbers("Target 575 is likely", facts), ["575"]);
  assert.ok(checkExplanation({ s: "This is a guaranteed winner" }, facts).some((p) => p.includes("forbidden")));
  assert.ok(checkExplanation({ s: "There is a 78% probability of profit" }, facts).length >= 1);
});

test("presentation gate removes trade-plan levels and personal sizing unless approved", () => {
  const x = { status: "ENTER IF CONFIRMED", entry: { low: 1, high: 2 }, stop: 0.5, targets: [{ price: 3 }], sizing: { quantity: 10 }, costs: { total: 1 }, explanation: { summary: "Enter at 1" }, evidence: [1] };
  const off = present(x, { actionable: false, personalized: false, research: true });
  assert.equal("entry" in off, false);
  assert.equal("stop" in off, false);
  assert.equal("sizing" in off, false);
  assert.equal("explanation" in off, false);
  assert.deepEqual(off.evidence, [1]);
  assert.equal(off.notices!.length, 2);
  const on = present(x, { actionable: true, personalized: true, research: true });
  assert.deepEqual(on.entry, x.entry);
  assert.equal(on.restricted, undefined);
});

// ---------- fundamentals (hand-checked) ----------
const DATASET = {
  format: "txp-fundamentals", version: 1, revision: "test.1",
  provider: { id: "test", name: "Test fundamentals (synthetic)", source: { name: "hand-written test data" }, retrievedAt: "2026-06-01" },
  companies: {
    ACME: {
      name: "Acme Ltd", industry: "Widgets",
      periods: [2022, 2023, 2024, 2025].map((y, k) => ({
        period: `FY${y}`, periodEnd: `${y}-03-31`, reportedAt: `${y}-05-15`, type: "annual", consolidated: true,
        revenue: 1000 * 1.1 ** k, ebitda: 200 * 1.1 ** k, operatingProfit: 150 * 1.1 ** k, netProfit: 100 * 1.1 ** k, eps: 10 * 1.1 ** k,
        operatingCashFlow: 120 * 1.1 ** k, capex: 40, totalDebt: 200, cash: 50, equity: 800 + 100 * k, interestExpense: 20, sharesOutstanding: 10, dividendsPerShare: 2,
      })),
    },
  },
};

test("fundamentals: dataset validation, point-in-time periods, ratios", () => {
  const d = parseFundamentals(JSON.stringify(DATASET));
  assert.throws(() => parseFundamentals({ ...DATASET, companies: { ACME: { ...DATASET.companies.ACME, periods: [{ ...DATASET.companies.ACME.periods[0], revenue: "lots" }] } } }), FundamentalsError);
  assert.throws(() => parseFundamentals({ ...DATASET, provider: { ...DATASET.provider, retrievedAt: "June" } }), FundamentalsError);
  assert.throws(() => parseFundamentals(JSON.parse(`{"format":"txp-fundamentals","version":1,"revision":"x","provider":{"id":"t","name":"t","source":{"name":"t"},"retrievedAt":"2026-01-01"},"companies":{"__proto__":{}}}`)), FundamentalsError);
  const c = d.companies.ACME;
  assert.equal(periodsKnownAt(c, "2025-05-14").length, 3, "FY2025 not yet published on 14 May 2025");
  const q = quality(c.periods);
  assert.ok(!("status" in q));
  if ("status" in q) return;
  assert.equal(q.growth.revenueYoY, 0.1);
  assert.equal(q.growth.revenueCagr3y, 0.1);
  assert.equal(q.margins.net, 0.1);
  assert.equal(q.cash.freeCashFlow, Math.round((120 * 1.331 - 40) * 100) / 100);
  assert.equal(q.balance.interestCoverage, Math.round((150 * 1.331) / 20 * 100) / 100);
  assert.equal(q.returns.roce, Math.round(((150 * 1.331) / (1100 + 200)) * 1e4) / 1e4);
});

test("DCF: two-stage value matches a hand calculation; reverse DCF inverts it", () => {
  // f1 = 110 → 98.2143; f2 = 121 → 96.4605; TV = 121×1.05/0.07 = 1815 → 1446.9069; Σ = 1641.5817; −50 net debt; ÷10 shares
  const v = dcfValue({ fcf0: 100, growth: 0.1, years: 2, terminalGrowth: 0.05, discountRate: 0.12, netDebt: 50, shares: 10 })!;
  assert.ok(Math.abs(v - 159.15817) < 1e-4, String(v));
  const g = reverseDcf(v, { fcf0: 100, years: 2, terminalGrowth: 0.05, discountRate: 0.12, netDebt: 50, shares: 10 })!;
  assert.ok(Math.abs(g - 0.1) < 1e-6);
  assert.equal(dcfValue({ fcf0: 100, growth: 0.1, years: 2, terminalGrowth: 0.12, discountRate: 0.12, netDebt: 0, shares: 1 }), null, "r must exceed terminal growth");
});

test("investment analysis: INSUFFICIENT DATA without statements; full analysis with them", () => {
  const none = analyzeInvestment({ symbol: "XYZ", company: null, price: 100, priceDate: NOW, asOf: NOW });
  assert.equal(none.status, "INSUFFICIENT DATA");
  assert.ok(none.missing.some((m) => m.includes("financial statements")));
  const d = parseFundamentals(DATASET);
  const a = analyzeInvestment({ symbol: "ACME", company: d.companies.ACME, price: 150, priceDate: NOW, asOf: NOW });
  assert.equal(a.status, "ANALYSED");
  assert.equal(a.multiples!.pe, Math.round((150 / (10 * 1.331)) * 100) / 100);
  assert.ok(a.dcf!.scenarios.bear! < a.dcf!.scenarios.base! && a.dcf!.scenarios.base! < a.dcf!.scenarios.bull!);
  assert.ok(a.missing.some((m) => m.includes("peer")), "missing peers reported");
  assert.ok(a.missing.some((m) => m.includes("shareholding")));
});

test("scan configuration is sanitised and clamped", () => {
  const c = sanitizeScanConfig({ universes: ["NIFTY 50", "NIFTY 50", "<script>"], capital: -5, maxRiskPerTrade: 1e12, horizon: "forever", instruments: ["all"], optionBuyingOnly: true, optionSellingOnly: true, extra: 1 });
  assert.deepEqual(c.universes, ["NIFTY 50"]);
  assert.equal(c.capital, 1000);
  assert.equal(c.maxRiskPerTrade, 1000);
  assert.equal(c.horizon, "swing");
  assert.equal(c.instruments.length, 5);
  assert.equal(c.optionSellingOnly, false, "buy-only and sell-only cannot both be set");
  assert.equal("extra" in c, false);
});

test("equity explanation: grounded AI output accepted; invented level rejected → deterministic fallback", async () => {
  const s = analyzeEquity(base(bars(260, (i) => (i < 259 ? 500 + 6 * Math.sin(i / 4) : 525), (i) => (i === 259 ? 9e6 : 2e6))));
  const good = { summary: `Breakout above ${s.entry!.low.toFixed(2)}; stop ${s.stop}.`, reasoning: ["Volume confirmed."], risks: [], avoidIf: [] };
  const bad = { summary: `Target 999 is likely.`, reasoning: [], risks: [], avoidIf: [] };
  const ok = await explainEquity(new AIClient({ providers: [new MockProvider([{ text: JSON.stringify(good), model: "m", inputTokens: 1, outputTokens: 1 }])], sleep: async () => {} }), s, 1);
  assert.equal(ok.source, "ai");
  const rej = await explainEquity(new AIClient({ providers: [new MockProvider([1, 2, 3].map(() => ({ text: JSON.stringify(bad), model: "m", inputTokens: 1, outputTokens: 1 })))], sleep: async () => {} }), s, 1);
  assert.equal(rej.source, "fallback");
  assert.match(rej.attempts[0].error, /999/);
});
