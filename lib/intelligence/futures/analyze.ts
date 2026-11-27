/**
 * Futures AI (deterministic). For one underlying's near (and next) futures:
 *   - basis and annualised carry against the underlying price of the same session;
 *   - roll spread (next − near) and a roll warning near expiry;
 *   - the session's price/OI pattern, described without attribution (OI does not show who holds positions);
 *   - a conditional long/short plan on futures price levels derived from the underlying's ATR and regime.
 * Margin is not available: plans are never execution-validated and required margin is never shown.
 * End-of-day or delayed prices never produce an entry plan.
 */
import { usableForIntraday } from "../core/freshness.ts";
import type { Provenance, SetupStatus } from "../core/types.ts";
import type { EodFutureRow } from "../market-data/data.ts";
import type { UnderlyingContext } from "../options/contract.ts";
import { estimateCosts, type CostEstimate } from "../risk/costs.ts";
import { sizePosition, type RiskConstraints, type Sizing } from "../risk/sizing.ts";

const r2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const DAY = 86400e3;

export type FuturesAnalysis = {
  underlying: string; status: SetupStatus; missing: string[];
  near: { expiry: string; price: number; lot: number; daysToExpiry: number; oi: number; oiChange: number; priceChangePct: number | null } | null;
  next: { expiry: string; price: number } | null;
  spot: number | null;
  basis: number | null; basisPct: number | null; annualisedCarryPct: number | null; rollSpread: number | null; rollNote: string | null;
  pattern: { label: string; note: string } | null;
  plan: {
    side: "LONG" | "SHORT" | null; entryTrigger: number | null; stop: number | null; target: number | null; target2: number | null;
    rewardRisk: number | null; sizing: Sizing | null; costs: CostEstimate | null; maxTheoreticalLoss: string; timeExit: string;
  };
  score: number | null; scoreNote: string; reasons: string[]; disclosures: string[];
  executionValidated: false; requiredMargin: null; provenance: Provenance;
};

/** Price/OI change pattern for the session, described neutrally. */
export function priceOiPattern(priceChangePct: number | null, oiChange: number): { label: string; note: string } | null {
  if (priceChangePct === null) return null;
  const up = priceChangePct > 0, oiUp = oiChange > 0;
  const label = `Price ${up ? "up" : "down"}, OI ${oiUp ? "up" : oiChange < 0 ? "down" : "unchanged"}`;
  const conventional = oiChange === 0 ? null : up ? (oiUp ? "long build-up" : "short covering") : oiUp ? "short build-up" : "long unwinding";
  return { label, note: `${conventional ? `Commonly called "${conventional}". ` : ""}Describes price and open-interest changes only; it does not identify who opened or closed positions.` };
}

export function analyzeFutures(
  underlying: string, rows: EodFutureRow[], ctx: UnderlyingContext, spotIn: number | null, constraints: RiskConstraints, provenance: Provenance, now = new Date(),
): FuturesAnalysis {
  const live = usableForIntraday(provenance).ok;
  const today = now.toISOString().slice(0, 10);
  const sorted = rows.filter((r) => r.underlying === underlying && r.expiry >= today).sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
  const n = sorted[0], nx = sorted[1] ?? null;
  const disclosures = [
    "Futures losses are not limited to the margin deposited; a stop-loss is not a guaranteed fill and prices can gap.",
    "Margin data is unavailable: required margin is not shown and is not the maximum possible loss.",
    ...(n?.inst === "STF" ? ["Stock futures held to expiry are physically settled (delivery obligation)."] : []),
  ];
  const base: FuturesAnalysis = {
    underlying, status: "INSUFFICIENT DATA", missing: [], near: null, next: null, spot: spotIn, basis: null, basisPct: null, annualisedCarryPct: null, rollSpread: null, rollNote: null, pattern: null,
    plan: { side: null, entryTrigger: null, stop: null, target: null, target2: null, rewardRisk: null, sizing: null, costs: null, maxTheoreticalLoss: "Unlimited without a stop (short) / down to zero (long)", timeExit: "Exit or roll at least 2 sessions before expiry" },
    score: null, scoreNote: "Rank score 0–100, not a probability of profit.", reasons: [], disclosures, executionValidated: false, requiredMargin: null, provenance,
  };
  if (!n) return { ...base, missing: [...provenance.missing.filter((m) => m.includes("not configured")), "near-month futures price"] };
  const spot = spotIn ?? n.underlyingPx;
  const dte = Math.max(0, Math.round((Date.parse(`${n.expiry}T10:00:00Z`) - now.getTime()) / DAY));
  const chg = n.prevClose ? r2(((n.close - n.prevClose) / n.prevClose) * 100) : null;
  const near = { expiry: n.expiry, price: n.close, lot: n.lot, daysToExpiry: dte, oi: n.oi, oiChange: n.oiChange, priceChangePct: chg };
  const basis = spot ? r2(n.close - spot) : null, basisPct = spot ? r2(((n.close - spot) / spot) * 100) : null;
  const carry = basisPct !== null && dte > 0 ? r2((basisPct * 365) / dte) : null;
  const roll = nx ? r2(nx.close - n.close) : null;
  const rollNote = dte <= 3 ? `Near month expires in ${dte} day(s): new positions belong in the next month${nx ? ` (${nx.expiry})` : ""}.` : null;
  const out: FuturesAnalysis = { ...base, near, next: nx ? { expiry: nx.expiry, price: nx.close } : null, spot, basis, basisPct, annualisedCarryPct: carry, rollSpread: roll, rollNote, pattern: priceOiPattern(chg, n.oiChange) };
  const missing: string[] = [];
  if (!spot) missing.push("underlying price");
  if (ctx.atr === null || ctx.direction === null) missing.push("underlying daily bars (ATR, regime)");
  if (!(n.lot > 0)) missing.push("lot size");
  if (missing.length) return { ...out, missing };

  const reasons: string[] = [];
  const d = ctx.direction!;
  const side = d >= 0.3 ? "LONG" : d <= -0.3 ? "SHORT" : null;
  const atrF = ctx.atr! * (n.close / spot!); // ATR scaled to the futures price
  const sg = side === "SHORT" ? -1 : 1;
  const entry = n.close + sg * 0.25 * atrF, stop = entry - sg * 1.0 * atrF, t1 = entry + sg * 1.5 * atrF, t2 = entry + sg * 2.5 * atrF;
  const rr = Math.abs(t1 - entry) / Math.abs(entry - stop);
  const sizing = side ? sizePosition(entry, stop, constraints, n.lot) : null;
  const costs = side && sizing && sizing.quantity > 0
    ? estimateCosts([{ segment: "futures", side: side === "LONG" ? "BUY" : "SELL", price: entry, quantity: sizing.quantity }, { segment: "futures", side: side === "LONG" ? "SELL" : "BUY", price: t1, quantity: sizing.quantity }], { tradeDate: n.d })
    : null;
  if (!side) reasons.push(`underlying direction ${r2(d)} (${ctx.regime ?? "unknown"}): no directional futures plan`);
  else reasons.push(`${ctx.regime ?? "trend"} favours a ${side.toLowerCase()} position`);
  if (rollNote) reasons.push(rollNote);
  if (sizing && sizing.quantity === 0) reasons.push(...sizing.reasons);
  if (!live) reasons.push(`prices are ${provenance.freshness}: confirm the live futures quote before acting (no entry from this data)`);
  if (carry !== null && Math.abs(carry) > 20) reasons.push(`unusual annualised basis ${carry}%: check for corporate actions or data issues`);
  const liq = n.oi > 0 && n.contracts > 0 ? 1 : n.oi > 0 ? 0.5 : 0;
  const fit = side ? Math.min(1, Math.abs(d)) : 0;
  const score = Math.round(100 * (0.45 * fit + 0.2 * Math.min(1, rr / 2) + 0.2 * liq + 0.15 * (dte > 3 ? 1 : 0.3)));
  const status: SetupStatus = !side ? "NO TRADE" : !live ? (score >= 50 ? "WATCHLIST" : "NO TRADE") : (sizing?.quantity ?? 0) === 0 || rr < (constraints.minRewardRisk ?? 1.5) ? "AVOID" : score >= 60 ? "ENTER IF CONFIRMED" : "WAIT FOR CONFIRMATION";
  return {
    ...out, status, score, reasons,
    plan: { ...base.plan, side, entryTrigger: side ? r2(entry) : null, stop: side ? r2(stop) : null, target: side ? r2(t1) : null, target2: side ? r2(t2) : null, rewardRisk: side ? r2(rr) : null, sizing, costs },
  };
}
