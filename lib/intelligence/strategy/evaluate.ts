/**
 * Strategy evaluation against real chain data. A registry definition is instantiated at the actual
 * strikes of the near (and, for calendars, next) expiry; premiums are the contracts' mid prices (bid/ask
 * mid when quoted, else last/close). Missing strikes, expiries, premiums or futures prices produce
 * INSUFFICIENT DATA with the missing items listed: nothing is estimated in their place.
 *
 * Payoff is evaluated at the near expiry: near legs at intrinsic value; next-expiry legs repriced with
 * the pricing model (their IV, remaining time) — a model estimate, labelled as such.
 * Scores rank strategies; they are not probabilities of profit.
 */
import { bsPrice } from "../../options/bs.ts";
import { usableForIntraday } from "../core/freshness.ts";
import type { Provenance } from "../core/types.ts";
import { expectedMove, metrics, yearsTo, type ChainInput, type UnderlyingContext } from "../options/contract.ts";
import { estimateCosts } from "../risk/costs.ts";
import type { LegSpec, StrategyDef, View } from "./registry.ts";

export type BuiltLeg = { side: "BUY" | "SELL"; right: "CE" | "PE" | "FUT"; strike: number | null; expiry: string; ratio: number; premium: number; iv: number | null; spreadPct: number | null; oi: number | null; delta: number | null; gamma: number | null; theta: number | null; vega: number | null };
export type StrategyInputs = { near: ChainInput; next?: ChainInput | null; futures?: { price: number; expiry: string } | null };
export type Evaluation = {
  id: string; name: string; family: string; view: View; classification: StrategyDef["classification"]; risk: StrategyDef["risk"];
  status: "OK" | "INSUFFICIENT DATA"; missing: string[];
  legs: BuiltLeg[]; lotSize: number | null;
  /** Per one lot of the base ratio (₹). Positive = debit paid. */
  netPremium: number | null;
  maxProfit: number | null; maxLoss: number | null; unlimitedProfit: boolean; unlimitedLoss: boolean;
  breakevens: number[]; rewardRisk: number | null;
  netGreeks: { delta: number; gamma: number; theta: number; vega: number } | null;
  breakevenVsExpectedMove: number | null;
  worstSpreadPct: number | null; minOi: number | null;
  payoff: { s: number; pnl: number }[];
  model: "intrinsic" | "intrinsic + model (next expiry)";
  score: number | null; scoreNote: string; reasons: string[];
  sizing: { lots: number; maxLossTotal: number | null } | null;
  costs: { total: number } | null;
  executionValidated: boolean; requiredMargin: null; disclosures: string[];
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const sgn = (s: "BUY" | "SELL") => (s === "BUY" ? 1 : -1);

function stepOf(c: ChainInput) {
  const s = c.rows.map((r) => r.strike).sort((a, b) => a - b);
  let m = Infinity;
  for (let i = 1; i < s.length; i++) if (s[i] > s[i - 1]) m = Math.min(m, s[i] - s[i - 1]);
  return Number.isFinite(m) ? m : null;
}
function atmOf(c: ChainInput) {
  if (!c.spot || !c.rows.length) return null;
  return c.rows.reduce((a, r) => (Math.abs(r.strike - c.spot!) < Math.abs(a - c.spot!) ? r.strike : a), c.rows[0].strike);
}

/** Instantiates a definition at real strikes; returns missing items when any leg cannot be priced. */
export function buildLegs(def: StrategyDef, inp: StrategyInputs): { legs: BuiltLeg[]; missing: string[] } {
  const missing: string[] = [];
  const legs: BuiltLeg[] = [];
  const near = inp.near, atm = atmOf(near), step = stepOf(near);
  if (atm === null || step === null) return { legs, missing: ["underlying price or strike ladder"] };
  for (const l of def.legs) {
    if (l.right === "FUT") {
      if (!inp.futures) missing.push("near-month futures price");
      else legs.push({ side: l.side, right: "FUT", strike: null, expiry: inp.futures.expiry, ratio: l.ratio, premium: inp.futures.price, iv: null, spreadPct: null, oi: null, delta: 1, gamma: 0, theta: 0, vega: 0 });
      continue;
    }
    const c = l.expiry === "next" ? inp.next : near;
    if (!c) { missing.push("next expiry chain"); continue; }
    const strike = atm + l.offset * step;
    const m = metrics(c, strike, l.right);
    if (!m || m.mid === null || !(m.mid > 0)) { missing.push(`${c.expiry} ${strike} ${l.right} premium`); continue; }
    legs.push({ side: l.side, right: l.right, strike, expiry: c.expiry, ratio: l.ratio, premium: m.mid, iv: m.iv, spreadPct: m.spreadPct, oi: m.oi, delta: m.delta, gamma: m.gamma, theta: m.theta, vega: m.vega });
  }
  return { legs, missing };
}

/** P&L per unit at the near expiry for underlying price S. */
export function pnlAt(legs: BuiltLeg[], S: number, nearExpiry: string, now: Date, r = 0.065): number {
  let p = 0;
  for (const l of legs) {
    let v: number;
    if (l.right === "FUT") v = S;
    else if (l.expiry === nearExpiry) v = Math.max(0, l.right === "CE" ? S - l.strike! : l.strike! - S);
    else {
      const T = Math.max(0, yearsTo(l.expiry, now) - yearsTo(nearExpiry, now));
      v = bsPrice({ S, K: l.strike!, T, r, sigma: l.iv && l.iv > 0 ? l.iv : 0.2, right: l.right });
    }
    p += sgn(l.side) * l.ratio * (v - l.premium);
  }
  return p;
}

export function evaluateStrategy(def: StrategyDef, inp: StrategyInputs, ctx: UnderlyingContext, limits: { maxRiskPerTrade: number; capital: number }, prov: Provenance): Evaluation {
  const near = inp.near, lot = near.lotSize;
  const { legs, missing } = buildLegs(def, inp);
  const base: Evaluation = {
    id: def.id, name: def.name, family: def.family, view: def.view, classification: def.classification, risk: def.risk, status: "INSUFFICIENT DATA", missing,
    legs, lotSize: lot, netPremium: null, maxProfit: null, maxLoss: null, unlimitedProfit: false, unlimitedLoss: false, breakevens: [], rewardRisk: null,
    netGreeks: null, breakevenVsExpectedMove: null, worstSpreadPct: null, minOi: null, payoff: [], model: def.multiExpiry ? "intrinsic + model (next expiry)" : "intrinsic",
    score: null, scoreNote: "Rank score 0–100, not a probability of profit.", reasons: [], sizing: null, costs: null, executionValidated: false, requiredMargin: null, disclosures: disclosuresFor(def, near),
  };
  if (!lot) missing.push("lot size");
  if (missing.length || !near.spot) return { ...base, missing: near.spot ? missing : [...missing, "underlying price"] };
  const spot = near.spot, now = near.now ?? new Date();
  const f = (S: number) => pnlAt(legs, S, near.expiry, now, near.r);
  // Grid over ±40% of spot plus all strikes (payoff is piecewise linear for single-expiry strategies).
  const strikes = legs.flatMap((l) => (l.strike ? [l.strike] : []));
  const lo = spot * 0.6, hi = spot * 1.4, N = 240;
  const xs = [...new Set([...Array.from({ length: N + 1 }, (_, i) => lo + ((hi - lo) * i) / N), ...strikes, spot])].sort((a, b) => a - b);
  const ys = xs.map(f);
  // Beyond the grid the payoff is linear: a rising right tail is unlimited profit, a falling one unlimited loss.
  // The left tail ends at S = 0, so it is bounded (but can be large: strike × quantity for short puts).
  const slopeHi = f(hi * 1.5) - f(hi);
  const unlimitedProfit = slopeHi > 1e-9 * spot, unlimitedLoss = slopeHi < -1e-9 * spot;
  const leftEnd = f(0);
  const maxP = unlimitedProfit ? null : Math.max(...ys, leftEnd);
  const minP = Math.min(...ys, leftEnd);
  const be: number[] = [];
  for (let i = 1; i < xs.length; i++) if ((ys[i - 1] < 0 && ys[i] >= 0) || (ys[i - 1] > 0 && ys[i] <= 0)) be.push(r2(xs[i - 1] + ((xs[i] - xs[i - 1]) * -ys[i - 1]) / (ys[i] - ys[i - 1])));
  const per = lot!;
  const reasons0: string[] = [];
  const netPremium = r2(legs.reduce((a, l) => a + (l.right === "FUT" ? 0 : sgn(l.side) * l.ratio * l.premium), 0) * per);
  const maxProfit = maxP === null ? null : r2(maxP * per), maxLoss = unlimitedLoss ? null : r2(Math.min(0, minP) * per);
  const rr = maxProfit !== null && maxLoss !== null && maxLoss < 0 ? r2(maxProfit / -maxLoss) : null;
  if (maxLoss !== null && maxLoss < 0 && def.risk === "undefined") reasons0.push(`maximum loss at expiry ₹${-maxLoss} per lot (underlying to zero)`);
  const ng = legs.reduce((a, l) => ({ delta: a.delta + sgn(l.side) * l.ratio * (l.delta ?? 0), gamma: a.gamma + sgn(l.side) * l.ratio * (l.gamma ?? 0), theta: a.theta + sgn(l.side) * l.ratio * (l.theta ?? 0), vega: a.vega + sgn(l.side) * l.ratio * (l.vega ?? 0) }), { delta: 0, gamma: 0, theta: 0, vega: 0 });
  const netGreeks = { delta: r2(ng.delta * per), gamma: Math.round(ng.gamma * per * 1e4) / 1e4, theta: r2(ng.theta * per), vega: r2(ng.vega * per) };
  const em = expectedMove(near);
  const nearestBe = be.length ? Math.min(...be.map((b) => Math.abs(b - spot))) : null;
  const beVsEm = nearestBe !== null && em.ivMove ? r2(nearestBe / em.ivMove) : null;
  const spreads = legs.map((l) => l.spreadPct).filter((x): x is number => x !== null);
  const ois = legs.filter((l) => l.right !== "FUT").map((l) => l.oi ?? 0);
  const worstSpreadPct = spreads.length ? Math.max(...spreads) : null, minOi = ois.length ? Math.min(...ois) : null;

  // Score: view fit 35, reward:risk / risk definition 25, liquidity 20, breakeven reach 10, theta/vega fit 10.
  const reasons: string[] = [...reasons0];
  const fit = viewFit(def.view, ctx);
  reasons.push(fit.note);
  const rrPart = def.risk === "undefined" || maxLoss === null ? 0.2 : rr === null ? 0.5 : Math.min(1, rr / 2);
  if (maxLoss === null) reasons.push("maximum loss is unlimited or very large");
  const liq = worstSpreadPct !== null ? (worstSpreadPct <= 1 ? 1 : worstSpreadPct <= 3 ? 0.6 : 0.1) : minOi && minOi > 0 ? 0.5 : 0;
  if (worstSpreadPct === null) reasons.push("no bid/ask: leg spreads unknown");
  else if (worstSpreadPct > 3) reasons.push(`wide spread on a leg (${worstSpreadPct}%)`);
  if (minOi === 0) reasons.push("a leg has no open interest");
  const reach = beVsEm === null ? 0.5 : def.view === "Volatile" ? (beVsEm <= 1 ? 1 : 0.3) : beVsEm >= 1 ? 1 : 0.5;
  const volFit = ctx.flags?.includes("Volatility expansion") ? (ng.vega > 0 ? 1 : 0.2) : ctx.flags?.includes("Volatility contraction") ? (ng.vega < 0 ? 1 : 0.4) : 0.6;
  const score = Math.round(100 * (0.35 * fit.v + 0.25 * rrPart + 0.2 * liq + 0.1 * reach + 0.1 * volFit));
  const sizing = maxLoss !== null && maxLoss < 0 ? { lots: Math.floor(limits.maxRiskPerTrade / -maxLoss), maxLossTotal: null as number | null } : null;
  if (sizing) {
    sizing.maxLossTotal = r2(sizing.lots * maxLoss!);
    if (sizing.lots === 0) reasons.push(`one lot risks ₹${-maxLoss!}: above your per-trade limit`);
  }
  const tradeDate = (prov.exchangeTime ?? now.toISOString()).slice(0, 10);
  const costs = estimateCosts(legs.map((l) => ({ segment: l.right === "FUT" ? "futures" as const : "options" as const, side: l.side, price: l.premium, quantity: l.ratio * per })), { tradeDate });
  if (!usableForIntraday(prov).ok) reasons.push(`prices are ${prov.freshness}: re-price with live quotes before acting`);
  return {
    ...base, status: "OK", missing: [], netPremium, maxProfit, maxLoss, unlimitedProfit, unlimitedLoss, breakevens: be, rewardRisk: rr,
    netGreeks, breakevenVsExpectedMove: beVsEm, worstSpreadPct, minOi, payoff: xs.filter((_, i) => i % 6 === 0).map((s) => ({ s: r2(s), pnl: r2(f(s) * per) })),
    score, reasons, sizing, costs: { total: costs.total },
    // Never execution-validated: no margin data; EOD/delayed prices are not executable.
    executionValidated: false,
  };
}

export function viewFit(view: View, ctx: UnderlyingContext): { v: number; note: string } {
  const d = ctx.direction;
  if (d === null) return { v: 0.4, note: "underlying direction unknown" };
  const volExp = ctx.flags?.includes("Volatility expansion") ?? false;
  const want: Record<View, number> = { Bullish: 1, "Mildly bullish": 0.5, Neutral: 0, "Mildly bearish": -0.5, Bearish: -1, Volatile: 0 };
  if (view === "Volatile") return volExp ? { v: 0.9, note: "volatility is expanding: long-volatility structures fit" } : { v: 0.4, note: "no volatility expansion detected" };
  if (view === "Neutral") return Math.abs(d) < 0.3 ? { v: 0.9, note: "underlying is range-bound: neutral structures fit" } : { v: 0.2, note: `underlying is trending (${ctx.regime})` };
  const gap = Math.abs(want[view] - Math.max(-1, Math.min(1, d)));
  return { v: Math.max(0, 1 - gap), note: `${view.toLowerCase()} structure vs ${ctx.regime ?? "underlying"} (direction ${Math.round(d * 100) / 100})` };
}

function disclosuresFor(def: StrategyDef, c: ChainInput): string[] {
  const out = ["Margin data is unavailable: required margin is not shown and is not the maximum possible loss."];
  if (def.risk === "undefined") out.push("This structure has unlimited or very large potential loss; stop-loss execution is not guaranteed and prices can gap.");
  if (def.legs.some((l: LegSpec) => l.side === "SELL")) out.push("Short legs can require additional margin after entry.");
  if (def.multiExpiry) out.push("The next-expiry leg is valued with a pricing model at the near expiry: an estimate, not a quote.");
  if (c.kind === "stock") out.push("Stock options are physically settled: in-the-money positions at expiry create delivery obligations.");
  return out;
}

/** Ranks every applicable registry strategy for one underlying. */
export function rankStrategies(defs: StrategyDef[], inp: StrategyInputs, ctx: UnderlyingContext, limits: { maxRiskPerTrade: number; capital: number }, opts: { top?: number } = {}) {
  const prov = inp.near.provenance;
  const evals = defs.map((d) => evaluateStrategy(d, inp, ctx, limits, prov));
  const ok = evals.filter((e) => e.status === "OK").sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const insufficient = evals.filter((e) => e.status !== "OK");
  return { evaluated: evals.length, ranked: ok.slice(0, opts.top ?? 20), insufficient: insufficient.length, missingSample: [...new Set(insufficient.flatMap((e) => e.missing))].slice(0, 8), provenance: prov };
}

