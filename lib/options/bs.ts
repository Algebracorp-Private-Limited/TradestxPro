// Black-Scholes (European, continuous dividend yield q) pricing, Greeks and implied volatility.
// Pure functions, unit tested. Time T in years, rates and vol as decimals (0.065 = 6.5%).

export type Right = "CE" | "PE";

const SQRT2PI = Math.sqrt(2 * Math.PI);
export const pdf = (x: number) => Math.exp(-0.5 * x * x) / SQRT2PI;

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf, |error| < 1.5e-7). */
export function cdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export type BsInput = { S: number; K: number; T: number; r: number; sigma: number; q?: number; right: Right };

function d1d2({ S, K, T, r, sigma, q = 0 }: BsInput) {
  const st = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (sigma * sigma) / 2) * T) / st;
  return { d1, d2: d1 - st };
}

export function bsPrice(i: BsInput): number {
  const { S, K, T, r, q = 0, right } = i;
  if (T <= 0 || i.sigma <= 0) return Math.max(0, right === "CE" ? S - K : K - S);
  const { d1, d2 } = d1d2(i);
  return right === "CE"
    ? S * Math.exp(-q * T) * cdf(d1) - K * Math.exp(-r * T) * cdf(d2)
    : K * Math.exp(-r * T) * cdf(-d2) - S * Math.exp(-q * T) * cdf(-d1);
}

export type Greeks = { delta: number; gamma: number; theta: number; vega: number; rho: number };

/** Greeks per market convention: theta per calendar day, vega and rho per 1 percentage point. */
export function bsGreeks(i: BsInput): Greeks {
  const { S, K, T, r, sigma, q = 0, right } = i;
  if (T <= 0 || sigma <= 0) {
    const itm = right === "CE" ? S > K : S < K;
    return { delta: itm ? (right === "CE" ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const { d1, d2 } = d1d2(i);
  const sqT = Math.sqrt(T);
  const eq = Math.exp(-q * T);
  const er = Math.exp(-r * T);
  const gamma = (eq * pdf(d1)) / (S * sigma * sqT);
  const vega = (S * eq * pdf(d1) * sqT) / 100;
  if (right === "CE") {
    const theta = (-(S * eq * pdf(d1) * sigma) / (2 * sqT) - r * K * er * cdf(d2) + q * S * eq * cdf(d1)) / 365;
    return { delta: eq * cdf(d1), gamma, theta, vega, rho: (K * T * er * cdf(d2)) / 100 };
  }
  const theta = (-(S * eq * pdf(d1) * sigma) / (2 * sqT) + r * K * er * cdf(-d2) - q * S * eq * cdf(-d1)) / 365;
  return { delta: -eq * cdf(-d1), gamma, theta, vega, rho: (-K * T * er * cdf(-d2)) / 100 };
}

/** Implied volatility by bisection (robust for deep ITM/OTM). Returns NaN when the price is outside no-arbitrage bounds. */
export function impliedVol(price: number, i: Omit<BsInput, "sigma">): number {
  if (!(price > 0) || i.T <= 0) return NaN;
  const intrinsic = Math.max(0, i.right === "CE" ? i.S * Math.exp(-(i.q ?? 0) * i.T) - i.K * Math.exp(-i.r * i.T) : i.K * Math.exp(-i.r * i.T) - i.S * Math.exp(-(i.q ?? 0) * i.T));
  if (price < intrinsic - 1e-9) return NaN;
  let lo = 1e-4;
  let hi = 5;
  if (bsPrice({ ...i, sigma: hi }) < price) return NaN;
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (bsPrice({ ...i, sigma: mid }) > price) hi = mid;
    else lo = mid;
    if (hi - lo < 1e-6) break;
  }
  return (lo + hi) / 2;
}

/** Years to expiry, assuming expiry at 15:30 IST on the expiry date. */
export function yearsToExpiry(expiryIso: string, now = new Date()): number {
  const exp = Date.parse(`${expiryIso}T15:30:00+05:30`);
  return Math.max(0, (exp - now.getTime()) / (365 * 86400_000));
}

export type ChainRow = { strike: number; ce?: { oi?: number | null; ltp?: number | null } | null; pe?: { oi?: number | null; ltp?: number | null } | null };

/** Put-call ratio by open interest. */
export function pcr(rows: ChainRow[]): number | null {
  let c = 0;
  let p = 0;
  for (const r of rows) {
    c += r.ce?.oi ?? 0;
    p += r.pe?.oi ?? 0;
  }
  return c > 0 ? p / c : null;
}

/** Max pain: the expiry price at which total intrinsic value paid to option holders is smallest. */
export function maxPain(rows: ChainRow[]): number | null {
  const strikes = rows.map((r) => r.strike);
  if (!strikes.length || !rows.some((r) => (r.ce?.oi ?? 0) + (r.pe?.oi ?? 0) > 0)) return null;
  let best = strikes[0];
  let bestPain = Infinity;
  for (const s of strikes) {
    let pain = 0;
    for (const r of rows) {
      pain += Math.max(0, s - r.strike) * (r.ce?.oi ?? 0);
      pain += Math.max(0, r.strike - s) * (r.pe?.oi ?? 0);
    }
    if (pain < bestPain) {
      bestPain = pain;
      best = s;
    }
  }
  return best;
}

/** Strike closest to spot. */
export function atmStrike(strikes: number[], spot: number): number | null {
  if (!strikes.length || !Number.isFinite(spot)) return null;
  return strikes.reduce((a, b) => (Math.abs(b - spot) < Math.abs(a - spot) ? b : a));
}
