// Option strategy templates and payoff maths. Pure, unit tested.
import { bsPrice } from "./bs.ts";

export type Side = "BUY" | "SELL";
export type Leg = { side: Side; right: "CE" | "PE"; strike: number; premium: number; lots: number; iv?: number | null };

export type StrategyTemplate = {
  id: string;
  name: string;
  view: "Bullish" | "Bearish" | "Neutral" | "Volatile";
  summary: string;
  /** Builds legs from the chain: `atm` strike, `step` strike interval, `w` width in strikes, `price(right, strike)` premium. */
  legs: (atm: number, step: number, w: number) => Omit<Leg, "premium" | "lots" | "iv">[];
};

export const STRATEGIES: StrategyTemplate[] = [
  { id: "long-call", name: "Long Call", view: "Bullish", summary: "Buy an ATM call. Limited loss (premium), unlimited upside.", legs: (a) => [{ side: "BUY", right: "CE", strike: a }] },
  { id: "bull-call-spread", name: "Bull Call Spread", view: "Bullish", summary: "Buy ATM call, sell a higher call. Cheaper than a long call; profit capped.", legs: (a, s, w) => [{ side: "BUY", right: "CE", strike: a }, { side: "SELL", right: "CE", strike: a + s * w }] },
  { id: "bull-put-spread", name: "Bull Put Spread", view: "Bullish", summary: "Sell ATM put, buy a lower put. Collect premium; profit if price stays above the short strike.", legs: (a, s, w) => [{ side: "SELL", right: "PE", strike: a }, { side: "BUY", right: "PE", strike: a - s * w }] },
  { id: "long-put", name: "Long Put", view: "Bearish", summary: "Buy an ATM put. Limited loss (premium), large downside profit.", legs: (a) => [{ side: "BUY", right: "PE", strike: a }] },
  { id: "bear-put-spread", name: "Bear Put Spread", view: "Bearish", summary: "Buy ATM put, sell a lower put. Cheaper than a long put; profit capped.", legs: (a, s, w) => [{ side: "BUY", right: "PE", strike: a }, { side: "SELL", right: "PE", strike: a - s * w }] },
  { id: "bear-call-spread", name: "Bear Call Spread", view: "Bearish", summary: "Sell ATM call, buy a higher call. Collect premium; profit if price stays below the short strike.", legs: (a, s, w) => [{ side: "SELL", right: "CE", strike: a }, { side: "BUY", right: "CE", strike: a + s * w }] },
  { id: "short-straddle", name: "Short Straddle", view: "Neutral", summary: "Sell ATM call and put. Profit if price stays near the strike; losses unlimited on big moves.", legs: (a) => [{ side: "SELL", right: "CE", strike: a }, { side: "SELL", right: "PE", strike: a }] },
  { id: "short-strangle", name: "Short Strangle", view: "Neutral", summary: "Sell OTM call and put. Wider profit zone than a straddle; losses unlimited.", legs: (a, s, w) => [{ side: "SELL", right: "CE", strike: a + s * w }, { side: "SELL", right: "PE", strike: a - s * w }] },
  { id: "iron-condor", name: "Iron Condor", view: "Neutral", summary: "Short strangle with protective wings. Range-bound profit, limited risk.", legs: (a, s, w) => [{ side: "SELL", right: "CE", strike: a + s * w }, { side: "BUY", right: "CE", strike: a + 2 * s * w }, { side: "SELL", right: "PE", strike: a - s * w }, { side: "BUY", right: "PE", strike: a - 2 * s * w }] },
  { id: "iron-butterfly", name: "Iron Butterfly", view: "Neutral", summary: "Short straddle with protective wings. Max profit at the strike, limited risk.", legs: (a, s, w) => [{ side: "SELL", right: "CE", strike: a }, { side: "SELL", right: "PE", strike: a }, { side: "BUY", right: "CE", strike: a + s * w }, { side: "BUY", right: "PE", strike: a - s * w }] },
  { id: "long-straddle", name: "Long Straddle", view: "Volatile", summary: "Buy ATM call and put. Profit from a big move either way; loses if price stays still.", legs: (a) => [{ side: "BUY", right: "CE", strike: a }, { side: "BUY", right: "PE", strike: a }] },
  { id: "long-strangle", name: "Long Strangle", view: "Volatile", summary: "Buy OTM call and put. Cheaper than a straddle; needs a bigger move.", legs: (a, s, w) => [{ side: "BUY", right: "CE", strike: a + s * w }, { side: "BUY", right: "PE", strike: a - s * w }] },
];

const sign = (s: Side) => (s === "BUY" ? 1 : -1);

/** P&L at expiry (₹) for an underlying price S. */
export function payoffAtExpiry(legs: Leg[], lotSize: number, S: number): number {
  let pnl = 0;
  for (const l of legs) {
    const intrinsic = Math.max(0, l.right === "CE" ? S - l.strike : l.strike - S);
    pnl += sign(l.side) * (intrinsic - l.premium) * l.lots * lotSize;
  }
  return pnl;
}

/** Mark-to-model P&L today (Black-Scholes with each leg's IV). */
export function payoffNow(legs: Leg[], lotSize: number, S: number, T: number, r: number): number {
  let pnl = 0;
  for (const l of legs) {
    const sigma = l.iv && l.iv > 0 ? l.iv : 0.2;
    const v = bsPrice({ S, K: l.strike, T, r, sigma, right: l.right });
    pnl += sign(l.side) * (v - l.premium) * l.lots * lotSize;
  }
  return pnl;
}

/** Net premium: positive = you pay (debit), negative = you receive (credit). */
export function netPremium(legs: Leg[], lotSize: number): number {
  return legs.reduce((s, l) => s + sign(l.side) * l.premium * l.lots * lotSize, 0);
}

export type Summary = {
  netPremium: number;
  maxProfit: number | null; // null = unlimited
  maxLoss: number | null; // null = unlimited (as a negative number otherwise)
  breakevens: number[];
};

/** Max profit/loss and breakevens, scanning a wide price range (payoff is piecewise linear at expiry). */
export function summarise(legs: Leg[], lotSize: number, spot: number): Summary {
  const strikes = [...new Set(legs.map((l) => l.strike))].sort((a, b) => a - b);
  const lo = Math.max(0, Math.min(spot, strikes[0] ?? spot) * 0.5);
  const hi = Math.max(spot, strikes[strikes.length - 1] ?? spot) * 1.5;
  // Evaluate at kink points plus range ends.
  const pts = [lo, ...strikes, hi].sort((a, b) => a - b);
  const vals = pts.map((p) => payoffAtExpiry(legs, lotSize, p));
  // Slopes beyond the ends decide unlimited profit/loss.
  const slopeHi = payoffAtExpiry(legs, lotSize, hi + 1) - payoffAtExpiry(legs, lotSize, hi);
  const slopeLo = payoffAtExpiry(legs, lotSize, Math.max(0, lo - 1)) - payoffAtExpiry(legs, lotSize, lo);
  let maxProfit: number | null = Math.max(...vals, payoffAtExpiry(legs, lotSize, 0));
  let maxLoss: number | null = Math.min(...vals, payoffAtExpiry(legs, lotSize, 0));
  if (slopeHi > 1e-9) maxProfit = null;
  if (slopeHi < -1e-9) maxLoss = null;
  if (slopeLo > 1e-9 && lo > 1) maxProfit = maxProfit === null ? null : Math.max(maxProfit, payoffAtExpiry(legs, lotSize, 0));
  // Breakevens: sign changes between consecutive kink points (linear in between).
  const be: number[] = [];
  const all = [0, ...pts];
  for (let i = 0; i < all.length - 1; i++) {
    const a = all[i];
    const b = all[i + 1];
    const fa = payoffAtExpiry(legs, lotSize, a);
    const fb = payoffAtExpiry(legs, lotSize, b);
    if (fa === 0 && i > 0) be.push(a);
    else if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) be.push(a + ((b - a) * -fa) / (fb - fa));
  }
  if (slopeHi !== 0) {
    const fh = payoffAtExpiry(legs, lotSize, hi);
    if ((fh < 0 && slopeHi > 0) || (fh > 0 && slopeHi < 0)) be.push(hi + -fh / slopeHi);
  }
  return { netPremium: netPremium(legs, lotSize), maxProfit, maxLoss, breakevens: [...new Set(be.map((x) => Math.round(x * 100) / 100))].sort((a, b) => a - b) };
}

/** Price levels: `n` steps of `step` below and above the spot (inclusive of spot). */
export function priceLevels(spot: number, step: number, n = 5): number[] {
  return Array.from({ length: 2 * n + 1 }, (_, i) => Math.round((spot + (i - n) * step) * 100) / 100);
}

/** Typical strike interval from a sorted list of strikes. */
export function strikeStep(strikes: number[]): number {
  const diffs = strikes.slice(1).map((s, i) => s - strikes[i]).filter((d) => d > 0);
  if (!diffs.length) return 1;
  const count = new Map<number, number>();
  for (const d of diffs) count.set(d, (count.get(d) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}
