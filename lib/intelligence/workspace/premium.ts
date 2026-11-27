/**
 * Option-premium analytics from REAL bar history (the user's broker supplies contract candles; nothing
 * is reconstructed). For each premium bar, the underlying bar with the same timestamp is used:
 *   intrinsic = max(0, ±(S − K)); extrinsic = premium − intrinsic;
 *   model IV = Black-Scholes implied volatility from the premium, S, K and time to expiry at that bar.
 * Bars without a matching underlying bar, or whose premium is below intrinsic (no IV solution), get
 * null values: gaps are shown as gaps.
 */
import { impliedVol } from "../../options/bs.ts";

export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
export type PremiumPoint = { t: number; premium: number; underlying: number | null; intrinsic: number | null; extrinsic: number | null; iv: number | null };

const EXPIRY_CLOSE_UTC = "T10:00:00Z"; // 15:30 IST

export function premiumAnalytics(premium: Bar[], underlying: Bar[], strike: number, right: "CE" | "PE", expiry: string, r = 0.065): { points: PremiumPoint[]; matched: number; ivSolved: number } {
  const byT = new Map(underlying.map((b) => [b.t, b.c]));
  const expMs = Date.parse(`${expiry}${EXPIRY_CLOSE_UTC}`);
  let matched = 0, ivSolved = 0;
  const points = premium.map((b) => {
    const S = byT.get(b.t) ?? null;
    if (S === null) return { t: b.t, premium: b.c, underlying: null, intrinsic: null, extrinsic: null, iv: null };
    matched++;
    const intrinsic = Math.max(0, right === "CE" ? S - strike : strike - S);
    const T = (expMs - b.t * 1000) / (365 * 86400e3);
    const iv = T > 0 ? impliedVol(b.c, { S, K: strike, T, r, right }) : NaN;
    if (Number.isFinite(iv)) ivSolved++;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return { t: b.t, premium: b.c, underlying: S, intrinsic: r2(intrinsic), extrinsic: r2(b.c - intrinsic), iv: Number.isFinite(iv) ? Math.round(iv * 10000) / 100 : null };
  });
  return { points, matched, ivSolved };
}
