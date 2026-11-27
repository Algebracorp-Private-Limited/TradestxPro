/**
 * Option contract intelligence (deterministic). Works on one expiry's chain plus context about the
 * underlying (regime direction, ATR). Produces:
 *   quickView()       – the per-contract "AI View" cell (status + score + three reasons), cheap enough to
 *                       compute for every contract on every chain refresh (no language model involved);
 *   analyzeContract() – the detailed panel: buy/sell suitability, plan in premium terms, underlying
 *                       confirmation/invalidation, Greeks, breakeven, expected move, alternatives.
 * Underlying prices, option premiums and payoffs are labelled separately everywhere.
 */
import { usableForIntraday } from "../core/freshness.ts";
import type { Provenance, SetupStatus } from "../core/types.ts";
import { estimateCosts, type CostEstimate } from "../risk/costs.ts";
import { sizePosition, type RiskConstraints, type Sizing } from "../risk/sizing.ts";
import { greeks as modelGreeks, iv as modelIv, price as modelPrice, type Model, type Right } from "./pricing.ts";

export type LegIn = {
  ltp: number | null; bid: number | null; ask: number | null; oi: number | null; oiChange: number | null; volume: number | null;
  iv: number | null; delta: number | null; gamma: number | null; theta: number | null; vega: number | null; rho?: number | null; greeksSource: "broker" | "model" | null;
};
export type ChainInput = {
  underlying: string;
  kind: "index" | "stock";
  spot: number | null;
  expiry: string;
  lotSize: number | null;
  tickSize?: number | null;
  rows: { strike: number; ce: LegIn | null; pe: LegIn | null }[];
  provenance: Provenance;
  /** Valuation time; defaults to now. */
  now?: Date;
  r?: number;
  q?: number;
  /** Futures price of the same expiry (enables Black-76). */
  forward?: number | null;
};
export type UnderlyingContext = { direction: number | null; regime: string | null; atr: number | null; flags?: string[] };

const DAY = 86_400_000;
export const yearsTo = (expiry: string, now: Date) => Math.max(0, (Date.parse(`${expiry}T10:00:00Z`) - now.getTime()) / (365 * DAY));
const r2 = (v: number | null) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const r4 = (v: number | null) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 1e4) / 1e4);
const mid = (l: LegIn) => (l.bid !== null && l.ask !== null && l.bid > 0 && l.ask >= l.bid ? (l.bid + l.ask) / 2 : l.ltp);

export type Moneyness = "Deep ITM" | "ITM" | "ATM" | "OTM" | "Deep OTM";
export function moneyness(spot: number, strike: number, right: Right, step: number): Moneyness {
  const d = right === "CE" ? spot - strike : strike - spot; // > 0 in the money
  if (Math.abs(d) <= step * 0.5) return "ATM";
  if (d > 0) return d > Math.max(3 * step, spot * 0.05) ? "Deep ITM" : "ITM";
  return -d > Math.max(3 * step, spot * 0.05) ? "Deep OTM" : "OTM";
}

export type ContractMetrics = {
  strike: number; right: Right; expiry: string; premium: number | null; mid: number | null; bid: number | null; ask: number | null;
  spread: number | null; spreadPct: number | null; oi: number | null; oiChange: number | null; volume: number | null;
  iv: number | null; ivSource: "broker" | "model" | null; delta: number | null; gamma: number | null; theta: number | null; vega: number | null; rho: number | null; greeksSource: "broker" | "model" | null;
  intrinsic: number | null; extrinsic: number | null; daysToExpiry: number; moneyness: Moneyness | null; breakeven: number | null; thetaPctPerDay: number | null;
};

function step(rows: { strike: number }[]) {
  const s = rows.map((r) => r.strike).sort((a, b) => a - b);
  let m = Infinity;
  for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] > 0) m = Math.min(m, s[i] - s[i - 1]);
  return Number.isFinite(m) ? m : 1;
}

/** Metrics of one contract; Greeks/IV from the broker when supplied, otherwise computed and labelled "model". */
export function metrics(c: ChainInput, strike: number, right: Right): ContractMetrics | null {
  const row = c.rows.find((x) => x.strike === strike);
  const l = row ? (right === "CE" ? row.ce : row.pe) : null;
  if (!l) return null;
  const now = c.now ?? new Date();
  const T = yearsTo(c.expiry, now);
  const spot = c.spot;
  const p = mid(l);
  const model: Model = c.forward ? "black76" : "bsm";
  const und = c.forward ?? spot;
  let iv = l.iv, ivSource: ContractMetrics["ivSource"] = l.iv !== null ? "broker" : null;
  if (iv === null && p !== null && p > 0 && und && T > 0) {
    const v = modelIv(p, { model, underlying: und, K: strike, T, r: c.r ?? 0.065, q: c.q ?? 0, right });
    if (Number.isFinite(v)) {
      iv = v;
      ivSource = "model";
    }
  }
  let g = { delta: l.delta, gamma: l.gamma, theta: l.theta, vega: l.vega, rho: l.rho ?? null };
  let gs = l.greeksSource;
  if ((g.delta === null || gs !== "broker") && iv !== null && und && T > 0) {
    const m = modelGreeks({ model, underlying: und, K: strike, T, r: c.r ?? 0.065, sigma: iv, q: c.q ?? 0, right });
    g = { delta: m.delta, gamma: m.gamma, theta: m.theta, vega: m.vega, rho: m.rho };
    gs = "model";
  }
  const intrinsic = spot ? Math.max(0, right === "CE" ? spot - strike : strike - spot) : null;
  const spread = l.bid !== null && l.ask !== null && l.ask >= l.bid && l.bid > 0 ? l.ask - l.bid : null;
  return {
    strike, right, expiry: c.expiry, premium: l.ltp, mid: r2(p), bid: l.bid, ask: l.ask, spread: r2(spread), spreadPct: spread !== null && p ? r2((spread / p) * 100) : null,
    oi: l.oi, oiChange: l.oiChange, volume: l.volume, iv: r4(iv), ivSource, delta: r4(g.delta), gamma: g.gamma === null ? null : Math.round(g.gamma * 1e6) / 1e6, theta: r2(g.theta), vega: r2(g.vega), rho: r2(g.rho), greeksSource: gs,
    intrinsic: r2(intrinsic), extrinsic: p !== null && intrinsic !== null ? r2(Math.max(0, p - intrinsic)) : null, daysToExpiry: Math.round(T * 365 * 10) / 10,
    moneyness: spot ? moneyness(spot, strike, right, step(c.rows)) : null, breakeven: p !== null ? r2(right === "CE" ? strike + p : strike - p) : null,
    thetaPctPerDay: g.theta !== null && p ? r2((Math.abs(g.theta) / p) * 100) : null,
  };
}

/** ATM implied volatility and expected move (±1σ to expiry) from the ATM straddle and from IV. */
export function expectedMove(c: ChainInput): { atmStrike: number | null; atmIv: number | null; straddle: number | null; ivMove: number | null; assumption: string } {
  const assumption = "±1 standard deviation to expiry: spot × ATM IV × √(time); straddle = ATM call + put mid (market-implied, not a forecast)";
  if (!c.spot || !c.rows.length) return { atmStrike: null, atmIv: null, straddle: null, ivMove: null, assumption };
  const atm = c.rows.reduce((a, b) => (Math.abs(b.strike - c.spot!) < Math.abs(a.strike - c.spot!) ? b : a)).strike;
  const ce = metrics(c, atm, "CE"), pe = metrics(c, atm, "PE");
  const ivs = [ce?.iv, pe?.iv].filter((x): x is number => x !== null && x !== undefined);
  const atmIv = ivs.length ? ivs.reduce((a, b) => a + b) / ivs.length : null;
  const T = yearsTo(c.expiry, c.now ?? new Date());
  return { atmStrike: atm, atmIv: r4(atmIv), straddle: ce?.mid !== null && pe?.mid !== null && ce && pe ? r2(ce.mid! + pe.mid!) : null, ivMove: atmIv !== null ? r2(c.spot * atmIv * Math.sqrt(T)) : null, assumption };
}

export type QuickView = { label: "Buy setup" | "Sell setup" | "Neutral" | "Avoid" | "No data"; buyScore: number | null; sellScore: number | null; reasons: string[] };

function liquidityScore(m: ContractMetrics): { v: number; note: string } {
  if (m.spreadPct !== null) return m.spreadPct <= 1 ? { v: 1, note: `spread ${m.spreadPct}%` } : m.spreadPct <= 3 ? { v: 0.6, note: `spread ${m.spreadPct}%` } : { v: 0.1, note: `wide spread ${m.spreadPct}%` };
  const oi = m.oi ?? 0, vol = m.volume ?? 0;
  return oi > 0 && vol > 0 ? { v: 0.5, note: "no bid/ask (EOD): spread unknown" } : { v: 0, note: "no OI or volume" };
}

/** Per-contract AI View (deterministic): direction fit, delta band, decay, IV richness and liquidity. */
export function quickView(c: ChainInput, strike: number, right: Right, ctx: UnderlyingContext): QuickView {
  const m = metrics(c, strike, right);
  if (!m || m.mid === null || !c.spot) return { label: "No data", buyScore: null, sellScore: null, reasons: ["no premium for this contract"] };
  const liq = liquidityScore(m);
  if (liq.v === 0) return { label: "Avoid", buyScore: 0, sellScore: 0, reasons: [liq.note] };
  const em = expectedMove(c);
  const dir = ctx.direction ?? 0;
  const fit = right === "CE" ? dir : -dir; // > 0 when the view favours this side for buying
  const ad = Math.abs(m.delta ?? 0);
  const deltaBuy = ad >= 0.35 && ad <= 0.65 ? 1 : ad >= 0.25 && ad <= 0.8 ? 0.6 : 0.2;
  const decay = m.thetaPctPerDay === null ? 0.5 : m.thetaPctPerDay <= 2 ? 1 : m.thetaPctPerDay <= 5 ? 0.5 : 0.1;
  const rich = em.atmIv !== null && m.iv !== null ? m.iv / em.atmIv : 1; // > 1: richer than ATM
  const dte = m.daysToExpiry;
  const buy = Math.round(100 * (0.35 * Math.max(0, fit) + 0.2 * deltaBuy + 0.2 * decay + 0.1 * (rich <= 1.05 ? 1 : 0.4) + 0.15 * liq.v) * (dte < 2 ? 0.5 : 1));
  const deltaSell = ad >= 0.15 && ad <= 0.35 ? 1 : ad < 0.15 ? 0.5 : 0.2;
  const sell = Math.round(100 * (0.35 * Math.max(0, -fit) + 0.2 * deltaSell + 0.15 * (m.thetaPctPerDay !== null && m.thetaPctPerDay >= 2 ? 1 : 0.5) + 0.15 * (rich >= 1 ? 1 : 0.5) + 0.15 * liq.v));
  const reasons = [
    ctx.direction === null ? "underlying direction unknown" : `buying this ${right === "CE" ? "call" : "put"} is ${fit > 0.3 ? "aligned with" : fit < -0.3 ? "against" : "neutral to"} the ${ctx.regime ?? "underlying"} view${fit < -0.3 ? " (selling it is aligned)" : ""}`,
    `Δ ${m.delta ?? "—"}${m.greeksSource === "model" ? " (model)" : ""}, θ ${m.thetaPctPerDay ?? "—"}% of premium per day`,
    liq.note,
  ];
  const label: QuickView["label"] = buy >= 60 && buy >= sell ? "Buy setup" : sell >= 60 ? "Sell setup" : buy < 30 && sell < 30 ? "Avoid" : "Neutral";
  return { label, buyScore: buy, sellScore: sell, reasons };
}

export type ContractPlan = {
  side: "BUY" | "SELL";
  status: SetupStatus;
  entryPremium: { low: number; high: number } | null;
  underlyingConfirmation: string | null;
  underlyingInvalidation: number | null;
  stopPremium: number | null;
  targetPremium: number | null;
  additionalTargetPremium: number | null;
  timeExit: string;
  plannedRiskPerLot: number | null;
  plannedRewardPerLot: number | null;
  maxTheoreticalLoss: string;
  requiredMargin: number | null;
  executionValidated: boolean;
  sizing: Sizing | null;
  costs: CostEstimate | null;
  disclosures: string[];
  reasons: string[];
};

export type ContractAnalysis = {
  underlying: string; expiry: string; strike: number; right: Right; lotSize: number | null; tickSize: number | null; spot: number | null;
  metrics: ContractMetrics;
  ivRank: null; ivRankNote: string;
  expectedMove: ReturnType<typeof expectedMove>;
  view: QuickView;
  buy: ContractPlan;
  sell: ContractPlan;
  alternatives: { strike: number; right: Right; expiry: string; moneyness: Moneyness | null; mid: number | null; delta: number | null; thetaPctPerDay: number | null; spreadPct: number | null; breakevenDistancePct: number | null; buyScore: number | null; why: string }[];
  preferred: { strike: number; reason: string } | null;
  provenance: Provenance;
  labels: { underlying: string; premium: string; payoff: string };
};

/** Option value after `days` with the underlying at `S` (same IV): theoretical estimate. */
function reprice(c: ChainInput, strike: number, right: Right, S: number, iv: number, days: number) {
  const now = c.now ?? new Date();
  const T = Math.max(0, yearsTo(c.expiry, now) - days / 365);
  return modelPrice({ model: "bsm", underlying: S, K: strike, T, r: c.r ?? 0.065, sigma: iv, q: c.q ?? 0, right });
}

export function analyzeContract(c: ChainInput, strike: number, right: Right, ctx: UnderlyingContext, constraints: RiskConstraints & { maxSpreadPct?: number; holdingDays?: number; definedRiskOnly?: boolean }): ContractAnalysis | null {
  const m = metrics(c, strike, right);
  if (!m) return null;
  const view = quickView(c, strike, right, ctx);
  const em = expectedMove(c);
  const spot = c.spot;
  const lot = c.lotSize;
  const hold = constraints.holdingDays ?? 3;
  const atr = ctx.atr ?? (spot && em.atmIv ? spot * em.atmIv * Math.sqrt(1 / 252) * 1.25 : null);
  const live = usableForIntraday(c.provenance).ok;
  const tick = c.tickSize ?? 0.05;
  const rt = (v: number) => r2(Math.max(tick, Math.round(v / tick) * tick))!;
  const tradeDate = (c.provenance.exchangeTime ?? new Date().toISOString()).slice(0, 10);
  const baseReasons: string[] = [];
  if (!live) baseReasons.push(`prices are ${c.provenance.freshness}: confirm the live quote before acting (no intraday plan from this data)`);
  if (m.spreadPct !== null && m.spreadPct > (constraints.maxSpreadPct ?? 2)) baseReasons.push(`bid-ask spread ${m.spreadPct}% exceeds your maximum`);
  if (m.daysToExpiry < hold + 1) baseReasons.push(`only ${m.daysToExpiry} days to expiry: gamma and time decay dominate`);

  // BUY plan: premium levels from repricing the option at the underlying's target / invalidation.
  const buyReasons = [...baseReasons];
  let buy: ContractPlan = { side: "BUY", status: "INSUFFICIENT DATA", entryPremium: null, underlyingConfirmation: null, underlyingInvalidation: null, stopPremium: null, targetPremium: null, additionalTargetPremium: null, timeExit: `Exit after ${hold} sessions without confirmation, or 3 days before expiry`, plannedRiskPerLot: null, plannedRewardPerLot: null, maxTheoreticalLoss: "Premium paid", requiredMargin: null, executionValidated: false, sizing: null, costs: null, disclosures: ["Option premiums can fall to zero; a premium stop is not a guaranteed fill."], reasons: buyReasons };
  if (spot && atr && m.mid && m.iv) {
    const sgn = right === "CE" ? 1 : -1;
    const trigger = spot + sgn * 0.25 * atr, invalid = spot - sgn * 1.0 * atr, tgt = spot + sgn * 1.5 * atr, tgt2 = spot + sgn * 2.5 * atr;
    const entryHigh = m.ask ?? m.mid * 1.01, entryLow = m.bid ?? m.mid * 0.97;
    const stopP = rt(reprice(c, strike, right, invalid, m.iv, 1));
    const tP = rt(reprice(c, strike, right, tgt, m.iv, Math.min(hold, 2)));
    const t2P = rt(reprice(c, strike, right, tgt2, m.iv, hold));
    const entry = (entryLow + entryHigh) / 2;
    const fit = right === "CE" ? (ctx.direction ?? 0) : -(ctx.direction ?? 0);
    const sizing = lot ? sizePosition(entry, stopP, constraints, lot) : null;
    const rr = (tP - entry) / Math.max(1e-9, entry - stopP);
    if (fit < 0.3) buyReasons.push(`the underlying view does not favour a long ${right === "CE" ? "call" : "put"} (${ctx.regime ?? "direction unknown"})`);
    if (rr < (constraints.minRewardRisk ?? 1.5)) buyReasons.push(`premium reward:risk ${r2(rr)} is below your minimum`);
    if (m.thetaPctPerDay !== null && m.thetaPctPerDay > 5) buyReasons.push(`time decay ${m.thetaPctPerDay}% of premium per day`);
    if (sizing && sizing.quantity === 0) buyReasons.push(...sizing.reasons);
    const status: SetupStatus = !live ? (fit >= 0.3 && rr >= (constraints.minRewardRisk ?? 1.5) ? "WATCHLIST" : "NO TRADE") : fit < 0.3 || (sizing?.quantity ?? 0) === 0 || rr < (constraints.minRewardRisk ?? 1.5) ? "AVOID" : view.buyScore !== null && view.buyScore >= 60 ? "ENTER IF CONFIRMED" : "WAIT FOR CONFIRMATION";
    buy = {
      ...buy, status, entryPremium: { low: r2(entryLow)!, high: r2(entryHigh)! },
      underlyingConfirmation: `Underlying ${right === "CE" ? "above" : "below"} ${r2(trigger)} (spot ${right === "CE" ? "+" : "−"} 0.25 ATR) on a closing basis`,
      underlyingInvalidation: r2(invalid), stopPremium: stopP, targetPremium: tP, additionalTargetPremium: t2P,
      plannedRiskPerLot: lot ? r2((entry - stopP) * lot) : null, plannedRewardPerLot: lot ? r2((tP - entry) * lot) : null,
      maxTheoreticalLoss: lot ? `Premium paid: ₹${r2(entry * lot)} per lot` : "Premium paid", sizing,
      costs: sizing && sizing.quantity > 0 ? estimateCosts([{ segment: "options", side: "BUY", price: entry, quantity: sizing.quantity }, { segment: "options", side: "SELL", price: tP, quantity: sizing.quantity }], { tradeDate, slippage: m.spreadPct !== null ? m.spreadPct / 200 : undefined }) : null,
      executionValidated: live,
    };
  } else buyReasons.push(...(!spot ? ["underlying price unavailable"] : []), ...(!m.iv ? ["implied volatility unavailable"] : []), ...(!atr ? ["underlying volatility (ATR) unavailable"] : []));

  // SELL plan: never execution-validated without margin data; risk disclosures always attached.
  const sellReasons = [...baseReasons];
  const disclosures = right === "CE"
    ? ["Short-call losses are theoretically unlimited.", "Stop-loss execution is not guaranteed; prices can gap through stops.", "Margin requirements can increase after entry."]
    : ["Short-put losses can be substantial (down to the strike times the quantity).", "Stop-loss execution is not guaranteed; prices can gap through stops.", "Margin requirements can increase after entry."];
  if (c.kind === "stock") disclosures.push("Stock options are physically settled: in-the-money short positions at expiry create delivery obligations.");
  sellReasons.push("margin data unavailable: not execution-validated; margin is not the maximum possible loss");
  if (constraints.definedRiskOnly) sellReasons.push("your settings allow defined-risk strategies only: an uncovered short is not permitted (see spreads in Strategy AI)");
  const sellFit = right === "CE" ? -(ctx.direction ?? 0) : ctx.direction ?? 0;
  if (sellFit < 0.2) sellReasons.push("the underlying view does not favour selling this side");
  if (ctx.flags?.includes("Volatility expansion")) sellReasons.push("volatility is expanding: short options face IV-expansion risk");
  const sell: ContractPlan = {
    side: "SELL", status: constraints.definedRiskOnly ? "NO TRADE" : !live ? "WATCHLIST" : sellFit >= 0.2 && (view.sellScore ?? 0) >= 60 ? "WAIT FOR CONFIRMATION" : "AVOID",
    entryPremium: m.bid !== null ? { low: r2(m.bid)!, high: r2(m.mid ?? m.bid)! } : m.mid ? { low: r2(m.mid * 0.99)!, high: r2(m.mid)! } : null,
    underlyingConfirmation: spot && atr ? `Underlying holds ${right === "CE" ? "below" : "above"} ${r2(spot + (right === "CE" ? 0.5 : -0.5) * atr)}` : null,
    underlyingInvalidation: spot && atr ? r2(spot + (right === "CE" ? 1 : -1) * atr) : null,
    stopPremium: m.mid ? rt(m.mid * 2) : null, targetPremium: m.mid ? rt(m.mid * 0.4) : null, additionalTargetPremium: m.mid ? rt(m.mid * 0.2) : null,
    timeExit: "Close or roll at least 2 days before expiry", plannedRiskPerLot: m.mid && lot ? r2(m.mid * lot) : null, plannedRewardPerLot: m.mid && lot ? r2(m.mid * 0.6 * lot) : null,
    maxTheoreticalLoss: right === "CE" ? "Unlimited" : lot ? `Up to ₹${r2((strike - (m.mid ?? 0)) * lot)} per lot (underlying to zero)` : "Substantial", requiredMargin: null, executionValidated: false,
    sizing: null, costs: null, disclosures, reasons: sellReasons,
  };

  // Alternatives: other strikes of this expiry, ranked by buy score; why each differs.
  const alts = c.rows.filter((x) => x.strike !== strike && (right === "CE" ? x.ce : x.pe)).map((x) => {
    const mm = metrics(c, x.strike, right)!;
    const qv = quickView(c, x.strike, right, ctx);
    const bePct = spot && mm.breakeven ? r2(((mm.breakeven - spot) / spot) * 100) : null;
    return { strike: x.strike, right, expiry: c.expiry, moneyness: mm.moneyness, mid: mm.mid, delta: mm.delta, thetaPctPerDay: mm.thetaPctPerDay, spreadPct: mm.spreadPct, breakevenDistancePct: bePct, buyScore: qv.buyScore, why: qv.reasons.join("; ") };
  }).filter((a) => a.buyScore !== null).sort((a, b) => (b.buyScore ?? 0) - (a.buyScore ?? 0)).slice(0, 6);
  const best = alts[0];
  const preferred = best && (best.buyScore ?? 0) > (view.buyScore ?? 0) + 5
    ? { strike: best.strike, reason: `Higher buy score (${best.buyScore} vs ${view.buyScore}): Δ ${best.delta}, decay ${best.thetaPctPerDay}%/day, spread ${best.spreadPct ?? "unknown"}%` }
    : null;

  return {
    underlying: c.underlying, expiry: c.expiry, strike, right, lotSize: lot, tickSize: c.tickSize ?? null, spot, metrics: m,
    ivRank: null, ivRankNote: "IV rank and percentile need an implied-volatility history, which the platform does not store yet.",
    expectedMove: em, view, buy, sell, alternatives: alts, preferred, provenance: c.provenance,
    labels: { underlying: "Underlying price levels (spot)", premium: "Option premium levels (per unit)", payoff: "Contractual expiry payoff = intrinsic value − premium" },
  };
}
