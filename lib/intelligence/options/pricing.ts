/**
 * Option pricing models. NSE index and stock options are European-style, so closed-form models apply:
 *   - Black-Scholes-Merton on the spot with continuous dividend yield q (lib/options/bs.ts);
 *   - Black-76 on the futures/forward price of the same expiry (no dividend estimate needed).
 * All outputs are theoretical estimates, never executable quotes.
 * Greeks follow the existing convention: theta per calendar day, vega and rho per 1 percentage point.
 */
import { bsGreeks, bsPrice, cdf, impliedVol, pdf, type Greeks, type Right } from "../../options/bs.ts";

export type Model = "bsm" | "black76";
export type PriceInput = { model: Model; underlying: number; K: number; T: number; r: number; sigma: number; q?: number; right: Right };

export function black76Price(F: number, K: number, T: number, r: number, sigma: number, right: Right): number {
  const df = Math.exp(-r * T);
  if (T <= 0 || sigma <= 0) return df * Math.max(0, right === "CE" ? F - K : K - F);
  const st = sigma * Math.sqrt(T);
  const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * T) / st, d2 = d1 - st;
  return right === "CE" ? df * (F * cdf(d1) - K * cdf(d2)) : df * (K * cdf(-d2) - F * cdf(-d1));
}

export function black76Greeks(F: number, K: number, T: number, r: number, sigma: number, right: Right): Greeks {
  const df = Math.exp(-r * T);
  if (T <= 0 || sigma <= 0) {
    const itm = right === "CE" ? F > K : F < K;
    return { delta: itm ? (right === "CE" ? df : -df) : 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const sq = Math.sqrt(T), st = sigma * sq;
  const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * T) / st;
  const price = black76Price(F, K, T, r, sigma, right);
  const delta = right === "CE" ? df * cdf(d1) : -df * cdf(-d1);
  const gamma = (df * pdf(d1)) / (F * st);
  const vega = (F * df * pdf(d1) * sq) / 100;
  const thetaYear = -(F * df * pdf(d1) * sigma) / (2 * sq) + r * price;
  return { delta, gamma, theta: thetaYear / 365, vega, rho: (-T * price) / 100 };
}

export function price(i: PriceInput): number {
  return i.model === "black76" ? black76Price(i.underlying, i.K, i.T, i.r, i.sigma, i.right) : bsPrice({ S: i.underlying, K: i.K, T: i.T, r: i.r, sigma: i.sigma, q: i.q ?? 0, right: i.right });
}
export function greeks(i: PriceInput): Greeks {
  return i.model === "black76" ? black76Greeks(i.underlying, i.K, i.T, i.r, i.sigma, i.right) : bsGreeks({ S: i.underlying, K: i.K, T: i.T, r: i.r, sigma: i.sigma, q: i.q ?? 0, right: i.right });
}
/** Implied volatility (BSM on spot; Black-76 by bisection on the forward). NaN when outside arbitrage bounds. */
export function iv(premium: number, i: Omit<PriceInput, "sigma">): number {
  if (i.model === "bsm") return impliedVol(premium, { S: i.underlying, K: i.K, T: i.T, r: i.r, q: i.q ?? 0, right: i.right });
  if (!(premium > 0) || i.T <= 0) return NaN;
  let lo = 1e-4, hi = 5;
  if (black76Price(i.underlying, i.K, i.T, i.r, hi, i.right) < premium) return NaN;
  if (black76Price(i.underlying, i.K, i.T, i.r, lo, i.right) > premium) return NaN;
  for (let k = 0; k < 100 && hi - lo > 1e-7; k++) {
    const mid = (lo + hi) / 2;
    if (black76Price(i.underlying, i.K, i.T, i.r, mid, i.right) > premium) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export type { Greeks, Right };
