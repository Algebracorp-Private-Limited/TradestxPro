/**
 * Market regime engine (deterministic). Combines price structure, moving-average alignment, ADX/DI,
 * ATR, realised volatility, Bollinger bandwidth, momentum, volume and liquidity, plus optional
 * context (breadth, implied volatility percentile, relative strength, events). No single indicator
 * decides: each regime needs several agreeing conditions, and conflicting evidence yields
 * "Uncertain market".
 *
 * Uses the production indicator library (lib/ta) so numbers match the charts and screeners.
 */
import * as ta from "../../ta/indicators.ts";
import { insufficient, type Evidence, type InsufficientData } from "../core/types.ts";

export type PrimaryRegime =
  | "Strong bullish trend" | "Moderate bullish trend" | "Strong bearish trend" | "Moderate bearish trend"
  | "Sideways market" | "Breakout" | "Breakdown" | "Mean-reversion regime" | "Uncertain market";
export type RegimeFlag =
  | "Volatility expansion" | "Volatility contraction" | "High-volatility market" | "Low-volatility market"
  | "Event-driven market" | "Illiquid market";

export type RegimeInput = {
  high: number[]; low: number[]; close: number[]; volume?: number[];
  /** Trading days per year for annualisation (default 252). */
  periodsPerYear?: number;
  context?: {
    /** % of a universe's members that advanced in the latest session (0–100). */
    advancePct?: number | null;
    /** Implied-volatility percentile of the instrument or index (0–100), when history supports it. */
    ivPercentile?: number | null;
    /** 60-day return relative to the benchmark (percentage points). */
    relativeStrength60?: number | null;
    /** A scheduled event (results, policy, expiry) inside the horizon. */
    event?: string | null;
    /** Minimum median daily traded value (₹) to count as liquid (default 5 crore). */
    minTradedValue?: number;
  };
};

export type Regime = {
  primary: PrimaryRegime;
  flags: RegimeFlag[];
  confidence: "high" | "medium" | "low";
  /** Bullish (+) / bearish (−) structure score, −1…1. */
  direction: number;
  evidence: Evidence[];
  indicators: string[];
  metrics: Record<string, number | null>;
};

const last = (s: number[]) => {
  for (let i = s.length - 1; i >= 0; i--) if (Number.isFinite(s[i])) return s[i];
  return NaN;
};
const at = (s: number[], k: number) => (k >= 0 && k < s.length && Number.isFinite(s[k]) ? s[k] : NaN);
function percentileRank(series: number[], value: number, lookback: number): number | null {
  const w = series.slice(-lookback).filter(Number.isFinite);
  if (w.length < 30 || !Number.isFinite(value)) return null;
  return (w.filter((v) => v <= value).length / w.length) * 100;
}
const round = (v: number, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

export const MIN_BARS = 60;

export function detectRegime(input: RegimeInput): Regime | InsufficientData {
  const { high: h, low: l, close: c } = input;
  const n = c.length;
  if (n < MIN_BARS || h.length !== n || l.length !== n) return insufficient(["daily bars"], `regime needs at least ${MIN_BARS} aligned bars (got ${n})`);
  if (c.slice(-MIN_BARS).some((v) => !Number.isFinite(v) || v <= 0)) return insufficient(["valid closes"], "recent closes contain missing or non-positive values");
  const ppy = input.periodsPerYear ?? 252;
  const ctx = input.context ?? {};
  const ev: Evidence[] = [];
  const close = c[n - 1];

  const ema20 = ta.ema(c, 20), ema50 = ta.ema(c, 50), ema200 = n >= 200 ? ta.ema(c, 200) : null;
  const e20 = last(ema20), e50 = last(ema50), e200 = ema200 ? last(ema200) : NaN;
  const slope50 = (last(ema50) / at(ema50, n - 11) - 1) * 100;
  const { adx, plusDI, minusDI } = ta.adx(h, l, c, 14);
  const adxV = last(adx), pdi = last(plusDI), mdi = last(minusDI);
  const atr14 = ta.atr(h, l, c, 14), atr50 = ta.atr(h, l, c, 50);
  const atrPct = (last(atr14) / close) * 100;
  const atrRatio = last(atr14) / last(atr50);
  const rets = c.map((v, i) => (i ? Math.log(v / c[i - 1]) : NaN));
  const rv20 = ta.stdev(rets, 20).map((s) => s * Math.sqrt(ppy) * 100);
  const rvNow = last(rv20), rvPct = percentileRank(rv20, rvNow, 252);
  const bb = ta.bollinger(c, 20, 2);
  const bw = bb.mid.map((m, i) => ((bb.upper[i] - bb.lower[i]) / m) * 100);
  const bwNow = last(bw), bwPct = percentileRank(bw, bwNow, 252);
  const rsi = last(ta.rsi(c, 14));
  const roc20 = (close / c[n - 21] - 1) * 100;
  const prevHigh20 = Math.max(...h.slice(n - 21, n - 1)), prevLow20 = Math.min(...l.slice(n - 21, n - 1));
  const v = input.volume && input.volume.length === n ? input.volume : null;
  const relVol = v ? v[n - 1] / (v.slice(n - 21, n - 1).reduce((a, b) => a + b, 0) / 20) : NaN;
  const tradedValue = v ? [...c.slice(-20).map((x, i) => x * v[n - 20 + i])].sort((a, b) => a - b)[10] : NaN;
  let crosses = 0;
  for (let i = n - 40; i < n; i++) if (i > 0 && Math.sign(c[i] - at(ema20, i)) !== Math.sign(c[i - 1] - at(ema20, i - 1))) crosses++;

  // Structure score: MA alignment, slope, DI balance, momentum, optional breadth/relative strength.
  let score = 0, parts = 0;
  const add = (cond: number, w: number) => {
    score += cond * w;
    parts += w;
  };
  add(close > e20 ? 1 : -1, 1);
  add(e20 > e50 ? 1 : -1, 1);
  if (Number.isFinite(e200)) add(e50 > e200 ? 1 : -1, 1.5);
  add(Math.sign(slope50) || 0, 1);
  if (Number.isFinite(pdi) && Number.isFinite(mdi)) add(pdi > mdi ? 1 : -1, 1);
  add(roc20 > 0 ? 1 : -1, 1);
  if (typeof ctx.advancePct === "number") add(ctx.advancePct >= 60 ? 1 : ctx.advancePct <= 40 ? -1 : 0, 0.5);
  if (typeof ctx.relativeStrength60 === "number") add(Math.sign(ctx.relativeStrength60), 0.5);
  const direction = parts ? score / parts : 0;

  ev.push({ id: "ma-alignment", label: "Moving averages", value: round(direction), detail: `Close ${round(close)} vs EMA20 ${round(e20)}, EMA50 ${round(e50)}${Number.isFinite(e200) ? `, EMA200 ${round(e200)}` : " (EMA200 needs 200 bars)"}; EMA50 slope ${round(slope50)}% over 10 bars.` });
  ev.push({ id: "adx", label: "ADX(14)", value: round(adxV, 1), detail: `ADX ${round(adxV, 1)} (+DI ${round(pdi, 1)}, −DI ${round(mdi, 1)}): ${adxV >= 25 ? "trending" : adxV < 20 ? "no trend" : "weak trend"}.` });
  ev.push({ id: "momentum", label: "Momentum", value: round(roc20), detail: `20-bar rate of change ${round(roc20)}%, RSI(14) ${round(rsi, 1)}.` });
  ev.push({ id: "volatility", label: "Volatility", value: round(rvNow, 1), detail: `Realised volatility (20) ${round(rvNow, 1)}% annualised${rvPct !== null ? ` (${round(rvPct, 0)}th percentile of 1 year)` : ""}; ATR(14) ${round(atrPct)}% of price; ATR14/ATR50 ${round(atrRatio)}.` });
  ev.push({ id: "bandwidth", label: "Bollinger bandwidth", value: round(bwNow), detail: `Bandwidth ${round(bwNow)}%${bwPct !== null ? ` (${round(bwPct, 0)}th percentile of 1 year)` : ""}.` });
  if (v) ev.push({ id: "volume", label: "Relative volume", value: round(relVol), detail: `Latest volume ${round(relVol)}× its 20-bar average; median daily traded value ₹${Number.isFinite(tradedValue) ? (tradedValue / 1e7).toFixed(2) : "—"} crore.` });

  // Primary regime.
  const breakout = close > prevHigh20 && (!v || relVol >= 1.5) && roc20 > 0;
  const breakdown = close < prevLow20 && (!v || relVol >= 1.5) && roc20 < 0;
  let primary: PrimaryRegime;
  const conflict = (direction > 0.3 && Number.isFinite(pdi) && mdi > pdi + 5) || (direction < -0.3 && Number.isFinite(pdi) && pdi > mdi + 5);
  if (breakout) primary = "Breakout";
  else if (breakdown) primary = "Breakdown";
  else if (conflict) primary = "Uncertain market";
  else if (direction >= 0.7 && adxV >= 25) primary = "Strong bullish trend";
  else if (direction <= -0.7 && adxV >= 25) primary = "Strong bearish trend";
  else if (direction >= 0.4) primary = "Moderate bullish trend";
  else if (direction <= -0.4) primary = "Moderate bearish trend";
  else if (adxV < 20 && crosses >= 6) primary = "Mean-reversion regime";
  else if (adxV < 22) primary = "Sideways market";
  else primary = "Uncertain market";
  if (breakout || breakdown) ev.push({ id: "range-break", label: breakout ? "Breakout" : "Breakdown", value: round(close), detail: `Close ${breakout ? "above the prior 20-bar high" : "below the prior 20-bar low"} (${round(breakout ? prevHigh20 : prevLow20)})${v ? ` on ${round(relVol)}× volume` : " (no volume data to confirm)"}.` });
  if (primary === "Mean-reversion regime") ev.push({ id: "crosses", label: "EMA20 crossings", value: crosses, detail: `${crosses} crossings of the 20 EMA in 40 bars with ADX below 20: price oscillates around its mean.` });

  // Flags.
  const flags: RegimeFlag[] = [];
  if (atrRatio >= 1.25 || (bwPct !== null && bwPct >= 80 && atrRatio > 1.05)) flags.push("Volatility expansion");
  if (atrRatio <= 0.8 || (bwPct !== null && bwPct <= 20)) flags.push("Volatility contraction");
  const volPct = typeof ctx.ivPercentile === "number" ? ctx.ivPercentile : rvPct;
  if (volPct !== null && volPct >= 80) flags.push("High-volatility market");
  if (volPct !== null && volPct <= 20) flags.push("Low-volatility market");
  if (ctx.event) {
    flags.push("Event-driven market");
    ev.push({ id: "event", label: "Event", value: ctx.event, detail: `Scheduled event in the horizon: ${ctx.event}.` });
  }
  const minTv = ctx.minTradedValue ?? 5e7;
  if (v && Number.isFinite(tradedValue) && tradedValue < minTv) flags.push("Illiquid market");
  if (typeof ctx.ivPercentile === "number") ev.push({ id: "iv", label: "IV percentile", value: round(ctx.ivPercentile, 0), detail: `Implied volatility at the ${round(ctx.ivPercentile, 0)}th percentile of its history.` });
  if (typeof ctx.advancePct === "number") ev.push({ id: "breadth", label: "Breadth", value: round(ctx.advancePct, 0), detail: `${round(ctx.advancePct, 0)}% of the universe advanced.` });

  const agreeing = Math.abs(direction);
  const confidence: Regime["confidence"] = primary === "Uncertain market" ? "low" : agreeing >= 0.7 && (adxV >= 25 || breakout || breakdown) ? "high" : agreeing >= 0.4 || primary === "Sideways market" ? "medium" : "low";

  return {
    primary, flags, confidence, direction: round(direction) ?? 0, evidence: ev,
    indicators: ["EMA 20/50/200", "ADX/DI 14", "ATR 14/50", "Realised volatility 20", "Bollinger bandwidth 20", "RSI 14", "ROC 20", ...(v ? ["Relative volume", "Traded value"] : [])],
    metrics: { close: round(close), ema20: round(e20), ema50: round(e50), ema200: round(e200), adx: round(adxV, 1), plusDI: round(pdi, 1), minusDI: round(mdi, 1), atrPct: round(atrPct), atrRatio: round(atrRatio), realisedVol: round(rvNow, 1), realisedVolPct: rvPct === null ? null : round(rvPct, 0), bandwidthPct: bwPct === null ? null : round(bwPct, 0), rsi: round(rsi, 1), roc20: round(roc20), relVol: round(relVol), tradedValue: Number.isFinite(tradedValue) ? Math.round(tradedValue) : null },
  };
}
