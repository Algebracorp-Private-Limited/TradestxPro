/**
 * Equity trading intelligence: conditional setups for NSE cash equities from verified daily data.
 * Deterministic: entries, stops, targets, quantity, costs and score are computed here; AI only
 * explains them (equity/explain.ts). Every plan is conditional on its confirmation and can be
 * NO TRADE, AVOID, INVALIDATED or INSUFFICIENT DATA.
 */
import * as ta from "../../ta/indicators.ts";
import { usableForEndOfDay, usableForIntraday } from "../core/freshness.ts";
import { isInsufficient, type Evidence, type Provenance, type SetupStatus } from "../core/types.ts";
import { estimateCosts, type CostAssumptions, type CostEstimate } from "../risk/costs.ts";
import { sizePosition, type RiskConstraints, type Sizing } from "../risk/sizing.ts";
import { score, type Score } from "../scoring.ts";
import { detectRegime, type Regime } from "../technical/regime.ts";

export type Horizon = "intraday" | "scalping" | "btst" | "stbt" | "swing" | "positional" | "short-term-investment";
export const INTRADAY_HORIZONS: Horizon[] = ["intraday", "scalping", "btst", "stbt"];
export const TIME_EXIT_SESSIONS: Record<Horizon, number> = { intraday: 0, scalping: 0, btst: 1, stbt: 1, swing: 10, positional: 30, "short-term-investment": 60 };

export type EquityInput = {
  symbol: string;
  name: string;
  sector: string | null;
  bars: { t: number; o: number; h: number; l: number; c: number; v: number }[];
  provenance: Provenance;
  horizon: Horizon;
  direction?: "bullish" | "bearish" | "any";
  constraints: RiskConstraints;
  costs?: CostAssumptions;
  /** Scheduled events in the horizon (results etc.), when known. */
  event?: string | null;
  today?: string;
};

export type Level = { price: number; label: string };
export type EquitySetup = {
  symbol: string; name: string; sector: string | null; horizon: Horizon;
  status: SetupStatus;
  direction: "long" | "short" | null;
  setup: string;
  price: number | null;
  asOf: string | null;
  freshness: Provenance["freshness"];
  entry: { low: number; high: number } | null;
  confirmation: string | null;
  stop: number | null;
  targets: Level[];
  trailing: string | null;
  invalidation: string | null;
  timeExit: string | null;
  riskPerShare: number | null;
  rewardPerShare: number | null;
  rewardRisk: number | null;
  sizing: Sizing | null;
  costs: CostEstimate | null;
  liquidity: { medianTradedValue: number | null; ok: boolean };
  volatility: { atrPct: number | null; realisedVol: number | null };
  regime: Regime | null;
  score: Score | null;
  evidenceQuality: "high" | "medium" | "low";
  evidence: Evidence[];
  reasonsToAvoid: string[];
  missing: string[];
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const roundTick = (v: number, tick = 0.05) => Math.round(v / tick) * tick;

function empty(i: EquityInput, status: SetupStatus, reasons: string[], missing: string[] = [], regime: Regime | null = null): EquitySetup {
  const last = i.bars[i.bars.length - 1];
  return {
    symbol: i.symbol, name: i.name, sector: i.sector, horizon: i.horizon, status, direction: null, setup: status === "NO TRADE" ? "No qualifying setup" : "—",
    price: last ? last.c : null, asOf: i.provenance.exchangeTime, freshness: i.provenance.freshness, entry: null, confirmation: null, stop: null, targets: [], trailing: null,
    invalidation: null, timeExit: null, riskPerShare: null, rewardPerShare: null, rewardRisk: null, sizing: null, costs: null,
    liquidity: { medianTradedValue: null, ok: false }, volatility: { atrPct: regime?.metrics.atrPct ?? null, realisedVol: regime?.metrics.realisedVol ?? null },
    regime, score: null, evidenceQuality: "low", evidence: regime?.evidence ?? [], reasonsToAvoid: reasons, missing,
  };
}

export function analyzeEquity(i: EquityInput): EquitySetup {
  // Data gates.
  if (INTRADAY_HORIZONS.includes(i.horizon)) {
    const g = usableForIntraday(i.provenance);
    if (!g.ok) return empty(i, "INSUFFICIENT DATA", [`${i.horizon} setups need real-time prices: ${g.reason}`], ["real-time quotes", "intraday bars"]);
    // Intraday bars are not stored on the platform (capability register): no intraday plan from daily bars.
    return empty(i, "INSUFFICIENT DATA", ["intraday bar history is not available on the platform; intraday setups are not generated from daily bars"], ["intraday bars"]);
  }
  const g = usableForEndOfDay(i.provenance);
  if (!g.ok) return empty(i, "INSUFFICIENT DATA", [g.reason!], ["current end-of-day data"]);

  const h = i.bars.map((b) => b.h), l = i.bars.map((b) => b.l), c = i.bars.map((b) => b.c), v = i.bars.map((b) => b.v);
  const reg = detectRegime({ high: h, low: l, close: c, volume: v, context: { event: i.event ?? null, minTradedValue: i.constraints.minLiquidity } });
  if (isInsufficient(reg)) return empty(i, "INSUFFICIENT DATA", reg.reasons, reg.missing);
  const n = c.length, close = c[n - 1];
  const atr = ta.atr(h, l, c, 14)[n - 1];
  const ema20 = ta.ema(c, 20)[n - 1], ema50 = ta.ema(c, 50)[n - 1];
  const bb = ta.bollinger(c, 20, 2);
  const rsi = ta.rsi(c, 14)[n - 1];
  const hi20 = Math.max(...h.slice(n - 21, n - 1)), lo10 = Math.min(...l.slice(n - 10));
  const hi52 = Math.max(...h.slice(Math.max(0, n - 250)));
  const tv = reg.metrics.tradedValue;
  const liquidityOk = tv === null ? false : tv >= (i.constraints.minLiquidity ?? 5e7);
  const want = i.direction ?? "any";
  const reasons: string[] = [];

  // Setup selection (long only for cash equity beyond intraday: overnight retail short selling is not permitted).
  type Plan = { setup: string; entryLow: number; entryHigh: number; confirmation: string; stop: number; invalidation: string; mean?: number };
  let plan: Plan | null = null;
  const bearishRegime = reg.direction < -0.3 || reg.primary === "Breakdown";
  if (want === "bearish" || (want === "any" && bearishRegime && reg.primary !== "Mean-reversion regime")) {
    return { ...empty(i, "NO TRADE", ["bearish view: overnight short positions in cash equities are not available to retail traders in India (no carry-forward short selling); consider futures or put options in the derivatives scanners"], [], reg), setup: "Bearish structure (cash short not supported)" };
  }
  if (reg.primary === "Breakout") {
    plan = { setup: "Breakout", entryLow: hi20, entryHigh: hi20 + 0.3 * atr, confirmation: `Daily close above ${r2(hi20)} (prior 20-session high) on volume at least 1.5× the 20-session average; enter on a hold or retest of the breakout level`, stop: hi20 - 1.2 * atr, invalidation: `Daily close back below ${r2(hi20 - 0.5 * atr)} (failed breakout)` };
  } else if ((reg.primary === "Strong bullish trend" || reg.primary === "Moderate bullish trend") && close <= ema20 + 1.0 * atr && close >= ema50) {
    const swingStop = Math.min(lo10, ema50) - 0.25 * atr;
    plan = { setup: "Trend pullback", entryLow: Math.max(ema20 - 0.25 * atr, swingStop + 0.5 * atr), entryHigh: ema20 + 0.5 * atr, confirmation: `Daily close above the previous session's high while holding above the 20 EMA (${r2(ema20)})`, stop: swingStop, invalidation: `Daily close below the 50 EMA (${r2(ema50)})` };
  } else if ((reg.primary === "Strong bullish trend" || reg.primary === "Moderate bullish trend") && close > ema20 + 1.0 * atr) {
    return { ...empty(i, "WAIT FOR CONFIRMATION", [`price is extended ${r2((close - ema20) / atr)} ATR above the 20 EMA; wait for a pullback toward ${r2(ema20)}`], [], reg), setup: "Extended uptrend (wait for pullback)", direction: "long" };
  } else if (reg.primary === "Mean-reversion regime" && i.horizon === "swing" && rsi < 38 && close <= bb.lower[n - 1] + 0.3 * atr) {
    plan = { setup: "Mean reversion to the 20-day mean", entryLow: bb.lower[n - 1] - 0.2 * atr, entryHigh: bb.lower[n - 1] + 0.3 * atr, confirmation: "Daily close back inside the lower Bollinger Band with RSI turning up", stop: Math.min(...l.slice(n - 5)) - 0.5 * atr, invalidation: "Two consecutive closes below the lower band", mean: bb.mid[n - 1] };
  }
  if (!plan) {
    const why = reg.primary === "Sideways market" ? "range-bound market without a qualifying entry" : reg.primary === "Uncertain market" ? "evidence conflicts (uncertain regime)" : `no long setup for a ${reg.primary.toLowerCase()} at the current price`;
    return { ...empty(i, reg.primary === "Uncertain market" ? "WATCHLIST" : "NO TRADE", [why], [], reg), setup: "No qualifying setup" };
  }

  const entry = (plan.entryLow + plan.entryHigh) / 2;
  const stop = roundTick(plan.stop);
  const risk = entry - stop;
  if (!(risk > 0)) return { ...empty(i, "NO TRADE", ["computed stop is not below the entry"], [], reg), setup: plan.setup };
  const targets: Level[] = plan.mean
    ? [{ price: r2(plan.mean), label: "Target 1 (20-day mean)" }, { price: r2(bb.upper[n - 1] - 0.25 * atr), label: "Target 2 (upper band zone)" }]
    : [
        { price: r2(Math.min(entry + 1.5 * risk, hi52 > entry + risk ? hi52 : Infinity)), label: hi52 > entry + risk && hi52 < entry + 1.5 * risk ? "Target 1 (52-week high)" : "Target 1 (1.5R)" },
        { price: r2(entry + 2.5 * risk), label: "Target 2 (2.5R)" },
        ...(reg.primary === "Strong bullish trend" || reg.primary === "Breakout" ? [{ price: r2(entry + 3.5 * risk), label: "Target 3 (3.5R, trend extension)" }] : []),
      ];
  const t1 = targets[0].price;
  const reward = t1 - entry;
  const rr = reward / risk;
  const sizing = sizePosition(entry, stop, i.constraints);
  const tradeDate = (i.provenance.exchangeTime ?? i.today ?? new Date().toISOString()).slice(0, 10);
  const costs = sizing.quantity > 0 ? estimateCosts([{ segment: "equity-delivery", side: "BUY", price: entry, quantity: sizing.quantity }, { segment: "equity-delivery", side: "SELL", price: t1, quantity: sizing.quantity }], { ...(i.costs ?? {}), tradeDate, today: i.today }) : null;

  if (!liquidityOk) reasons.push(`median daily traded value ${tv === null ? "unknown" : `₹${(tv / 1e7).toFixed(2)} crore`} is below your minimum`);
  if (rr < (i.constraints.minRewardRisk ?? 1.5)) reasons.push(`reward-to-risk to Target 1 is ${r2(rr)}, below your minimum of ${i.constraints.minRewardRisk ?? 1.5}`);
  if (reg.flags.includes("High-volatility market")) reasons.push("volatility is in the top fifth of its one-year range: gaps can exceed the planned stop");
  if (reg.flags.includes("Event-driven market")) reasons.push(`scheduled event in the horizon (${i.event}): results can gap through stops`);
  if (sizing.quantity === 0) reasons.push(...sizing.reasons);
  if (costs && costs.total > 0.2 * reward * sizing.quantity) reasons.push(`estimated costs (₹${costs.total}) exceed 20% of the planned reward`);
  if (costs?.scheduleReviewDue) reasons.push("transaction-cost rates need review (see costs)");
  reasons.push("end-of-day data: confirm the price with your broker before acting; stops are not guaranteed fills");

  const sc = score({
    trend: { value: Math.max(0, reg.direction), reason: `direction score ${reg.direction} (${reg.primary})` },
    structure: { value: plan.setup === "Breakout" ? 0.8 : plan.setup === "Trend pullback" ? 0.75 : 0.55, reason: plan.setup },
    momentum: { value: rsi >= 50 && rsi <= 70 ? 0.9 : rsi > 70 ? 0.5 : plan.mean ? 0.6 : 0.35, reason: `RSI(14) ${r2(rsi)}` },
    volatility: { value: reg.flags.includes("High-volatility market") ? 0.3 : reg.metrics.atrPct !== null && reg.metrics.atrPct <= 4 ? 0.85 : 0.6, reason: `ATR ${reg.metrics.atrPct}% of price` },
    liquidity: { value: liquidityOk ? 1 : 0.2, reason: tv === null ? "traded value unknown" : `median traded value ₹${(tv / 1e7).toFixed(2)} crore` },
    rewardRisk: { value: Math.min(1, Math.max(0, (rr - 1) / 2)), reason: `R:R ${r2(rr)} to Target 1` },
    costs: { value: costs ? Math.max(0, 1 - costs.total / Math.max(1, reward * sizing.quantity) / 0.2) : 0.5, reason: costs ? `₹${costs.total} round trip` : "no position at your limits" },
    dataQuality: { value: i.provenance.freshness === "eod" ? 0.75 : 0.5, reason: `${i.provenance.freshness} data from ${i.provenance.source}` },
  });

  const inZone = close >= plan.entryLow && close <= plan.entryHigh;
  const hardAvoid = !liquidityOk || rr < (i.constraints.minRewardRisk ?? 1.5) || sizing.quantity === 0;
  const status: SetupStatus = hardAvoid ? "AVOID" : sc.total < 50 ? "WATCHLIST" : inZone ? "ENTER IF CONFIRMED" : "WAIT FOR CONFIRMATION";
  const ev: Evidence[] = [
    ...reg.evidence,
    { id: "plan", label: "Plan", value: plan.setup, detail: `Entry ${r2(plan.entryLow)}–${r2(plan.entryHigh)}, stop ${r2(stop)} (risk ${r2(risk)} per share = ${r2(risk / atr)} ATR), Target 1 ${t1} (R:R ${r2(rr)}).` },
  ];
  return {
    symbol: i.symbol, name: i.name, sector: i.sector, horizon: i.horizon, status, direction: "long", setup: plan.setup, price: close, asOf: i.provenance.exchangeTime, freshness: i.provenance.freshness,
    entry: { low: r2(plan.entryLow), high: r2(plan.entryHigh) }, confirmation: plan.confirmation, stop, targets,
    trailing: plan.mean ? "No trailing: exit at the mean" : `After Target 1, trail the stop to the higher of breakeven and the 20 EMA (daily close basis); alternatively 2.5× ATR(14) below the highest close`,
    invalidation: plan.invalidation, timeExit: `Exit if Target 1 is not reached within ${TIME_EXIT_SESSIONS[i.horizon]} sessions`,
    riskPerShare: r2(risk), rewardPerShare: r2(reward), rewardRisk: r2(rr), sizing, costs,
    liquidity: { medianTradedValue: tv, ok: liquidityOk }, volatility: { atrPct: reg.metrics.atrPct, realisedVol: reg.metrics.realisedVol },
    regime: reg, score: sc, evidenceQuality: reg.confidence === "high" && i.provenance.freshness === "eod" ? "medium" : reg.confidence === "low" ? "low" : "medium",
    evidence: ev, reasonsToAvoid: reasons, missing: ["corporate-action adjustments", "event calendar"],
  };
}
