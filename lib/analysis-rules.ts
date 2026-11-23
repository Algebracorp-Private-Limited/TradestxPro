// Pure, unit-tested rules that turn indicator readings into a plain-language technical read.
import * as ta from "./ta/indicators.ts";

export type TechFacts = {
  name: string;
  date: string | null;
  close: number;
  changePct: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  macdHist: number | null;
  macdHistPrev: number | null;
  adx14: number | null;
  supertrendDir: number | null;
  high52: number | null;
  low52: number | null;
  ret5: number | null;
  ret20: number | null;
  ret60: number | null;
  relVol?: number | null;
  beta?: number | null;
  extra?: string[];
};

export type Read = { bias: "Bullish" | "Bearish" | "Neutral"; score: number; headline: string; points: string[]; levels: { support: number | null; resistance: number | null } };

const fin = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const fmt = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** Indicator readings from daily bars (closes needed; highs/lows optional). */
export function factsFromBars(name: string, date: string | null, h: number[], l: number[], c: number[]): TechFacts | null {
  const n = c.length;
  if (n < 30) return null;
  const last = n - 1;
  const at = (s: number[], i = last) => (Number.isFinite(s[i]) ? s[i] : null);
  const m = ta.macd(c);
  const yr = Math.min(n, 250);
  const ret = (k: number) => (n > k ? (c[last] / c[last - k] - 1) * 100 : null);
  return {
    name, date, close: c[last], changePct: ret(1),
    ema20: at(ta.ema(c, 20)), ema50: at(ta.ema(c, 50)), ema200: n >= 200 ? at(ta.ema(c, 200)) : null,
    rsi14: at(ta.rsi(c, 14)), macdHist: at(m.hist), macdHistPrev: at(m.hist, last - 1),
    adx14: at(ta.adx(h, l, c, 14).adx), supertrendDir: at(ta.supertrend(h, l, c, 10, 3).dir),
    high52: Math.max(...h.slice(n - yr)), low52: Math.min(...l.slice(n - yr)),
    ret5: ret(5), ret20: ret(20), ret60: ret(60),
  };
}

export function technicalRead(f: TechFacts): Read {
  let score = 0;
  const pts: string[] = [];
  const above = (ma: number | null, label: string, w: number) => {
    if (!fin(ma)) return;
    if (f.close > ma) score += w;
    else score -= w;
    pts.push(`Price is ${f.close > ma ? "above" : "below"} the ${label} (${fmt(ma)}).`);
  };
  above(f.ema20, "20-day EMA", 1);
  above(f.ema50, "50-day EMA", 1);
  above(f.ema200, "200-day EMA (long-term trend)", 2);
  if (fin(f.ema50) && fin(f.ema200)) pts.push(f.ema50 > f.ema200 ? "50-day EMA is above the 200-day: long-term uptrend structure." : "50-day EMA is below the 200-day: long-term downtrend structure.");
  if (fin(f.rsi14)) {
    if (f.rsi14 >= 70) { pts.push(`RSI ${f.rsi14.toFixed(0)} is overbought: strong momentum but stretched; pullbacks are common from here.`); score += 0.5; }
    else if (f.rsi14 <= 30) { pts.push(`RSI ${f.rsi14.toFixed(0)} is oversold: selling may be exhausted, watch for a bounce.`); score -= 0.5; }
    else if (f.rsi14 >= 55) { pts.push(`RSI ${f.rsi14.toFixed(0)} shows positive momentum.`); score += 1; }
    else if (f.rsi14 <= 45) { pts.push(`RSI ${f.rsi14.toFixed(0)} shows weak momentum.`); score -= 1; }
    else pts.push(`RSI ${f.rsi14.toFixed(0)} is neutral.`);
  }
  if (fin(f.macdHist)) {
    const rising = fin(f.macdHistPrev) ? f.macdHist > f.macdHistPrev : null;
    if (f.macdHist > 0) { score += 1; pts.push(`MACD is above its signal line${rising === false ? " but momentum is fading" : rising ? " and strengthening" : ""}.`); }
    else { score -= 1; pts.push(`MACD is below its signal line${rising ? " but the decline is slowing" : rising === false ? " and weakening further" : ""}.`); }
    if (fin(f.macdHistPrev) && Math.sign(f.macdHist) !== Math.sign(f.macdHistPrev)) pts.push(`Fresh MACD ${f.macdHist > 0 ? "bullish" : "bearish"} crossover in the last session.`);
  }
  if (fin(f.supertrendDir)) { score += f.supertrendDir > 0 ? 1 : -1; pts.push(`Supertrend (10, 3) is ${f.supertrendDir > 0 ? "in buy mode" : "in sell mode"}.`); }
  if (fin(f.adx14)) pts.push(f.adx14 >= 25 ? `ADX ${f.adx14.toFixed(0)}: the trend is strong.` : f.adx14 < 20 ? `ADX ${f.adx14.toFixed(0)}: no strong trend; range-bound behaviour is likely.` : `ADX ${f.adx14.toFixed(0)}: trend strength is moderate.`);
  if (fin(f.high52) && fin(f.low52) && f.high52 > f.low52) {
    const pos = ((f.close - f.low52) / (f.high52 - f.low52)) * 100;
    pts.push(`Trading ${((1 - f.close / f.high52) * 100).toFixed(1)}% below its 52-week high (${fmt(f.high52)}), at ${pos.toFixed(0)}% of its 52-week range.`);
  }
  const rets = [["1 week", f.ret5], ["1 month", f.ret20], ["3 months", f.ret60]].filter((r): r is [string, number] => fin(r[1] as number));
  if (rets.length) pts.push(`Returns: ${rets.map(([k, v]) => `${k} ${pct(v)}`).join(", ")}.`);
  if (fin(f.relVol)) pts.push(f.relVol >= 1.5 ? `Volume was ${f.relVol.toFixed(1)}× its 20-day average: strong participation.` : f.relVol < 0.7 ? `Volume was light (${f.relVol.toFixed(1)}× average).` : `Volume was near average (${f.relVol.toFixed(1)}×).`);
  if (fin(f.beta)) pts.push(`Beta ${f.beta.toFixed(2)} vs NIFTY 50: ${f.beta > 1.2 ? "moves more than the market" : f.beta < 0.8 ? "moves less than the market" : "moves roughly with the market"}.`);
  for (const e of f.extra ?? []) pts.push(e);

  const bias: Read["bias"] = score >= 2.5 ? "Bullish" : score <= -2.5 ? "Bearish" : "Neutral";
  const supports = [f.ema20, f.ema50, f.ema200, f.low52].filter((v): v is number => fin(v) && v < f.close);
  const resist = [f.ema20, f.ema50, f.ema200, f.high52].filter((v): v is number => fin(v) && v > f.close);
  const headline = `${f.name} looks ${bias.toLowerCase()} on the daily chart${bias === "Neutral" ? ": signals are mixed" : bias === "Bullish" ? ": trend and momentum mostly agree upward" : ": trend and momentum mostly point down"}.`;
  return { bias, score, headline, points: pts, levels: { support: supports.length ? Math.max(...supports) : null, resistance: resist.length ? Math.min(...resist) : null } };
}
