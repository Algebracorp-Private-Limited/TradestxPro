// Stock screener: filter definitions, presets and validation. The SQL lives in the API route.

export type Filters = {
  universe?: "all" | "fno";
  priceMin?: number;
  priceMax?: number;
  changeMin?: number;
  changeMax?: number;
  volumeMin?: number;
  relVolMin?: number;
  rsiMin?: number;
  rsiMax?: number;
  adxMin?: number;
  ret20Min?: number;
  ret20Max?: number;
  aboveEma20?: boolean;
  aboveEma50?: boolean;
  aboveEma200?: boolean;
  belowEma50?: boolean;
  belowEma200?: boolean;
  emaStack?: boolean; // close > ema20 > ema50 > ema200
  near52High?: number; // within x % of 52-week high
  near52Low?: number; // within x % of 52-week low
  macdBullCross?: boolean;
  macdBearCross?: boolean;
  supertrend?: "up" | "down";
};

export type SortKey = "symbol" | "close" | "change_pct" | "volume" | "rel_vol" | "rsi14" | "adx14" | "ret20" | "ret60" | "atr_pct" | "dist52h";

export const SORT_KEYS: SortKey[] = ["symbol", "close", "change_pct", "volume", "rel_vol", "rsi14", "adx14", "ret20", "ret60", "atr_pct", "dist52h"];

export const PRESETS: { id: string; name: string; description: string; filters: Filters; sort: SortKey; dir: "asc" | "desc" }[] = [
  { id: "breakout", name: "52-week breakout", description: "Within 2% of the 52-week high on 1.5× average volume.", filters: { near52High: 2, relVolMin: 1.5, priceMin: 20 }, sort: "rel_vol", dir: "desc" },
  { id: "oversold", name: "Oversold reversal", description: "RSI below 35 with a fresh bullish MACD histogram cross.", filters: { rsiMax: 35, macdBullCross: true, priceMin: 20 }, sort: "rsi14", dir: "asc" },
  { id: "momentum", name: "Momentum leaders", description: "Price > EMA20 > EMA50 > EMA200, ADX above 25, up 5%+ in 20 sessions.", filters: { emaStack: true, adxMin: 25, ret20Min: 5, priceMin: 20 }, sort: "ret20", dir: "desc" },
  { id: "volume", name: "Unusual volume", description: "Volume at least 2.5× the 20-day average.", filters: { relVolMin: 2.5, volumeMin: 100000 }, sort: "rel_vol", dir: "desc" },
  { id: "breakdown", name: "Bearish breakdown", description: "Below EMA200, Supertrend down, within 3% of the 52-week low.", filters: { belowEma200: true, supertrend: "down", near52Low: 3, priceMin: 20 }, sort: "change_pct", dir: "asc" },
  { id: "pullback", name: "Uptrend pullback", description: "Above EMA200 but RSI cooled to 40–50.", filters: { aboveEma200: true, rsiMin: 40, rsiMax: 50, priceMin: 20 }, sort: "ret60", dir: "desc" },
  { id: "fno-gainers", name: "F&O top gainers", description: "F&O stocks up 2% or more on the day.", filters: { universe: "fno", changeMin: 2 }, sort: "change_pct", dir: "desc" },
];

const NUM_KEYS = ["priceMin", "priceMax", "changeMin", "changeMax", "volumeMin", "relVolMin", "rsiMin", "rsiMax", "adxMin", "ret20Min", "ret20Max", "near52High", "near52Low"] as const;
const BOOL_KEYS = ["aboveEma20", "aboveEma50", "aboveEma200", "belowEma50", "belowEma200", "emaStack", "macdBullCross", "macdBearCross"] as const;

/** Keeps only known keys with sane values. */
export function sanitizeFilters(input: unknown): Filters {
  const b = (input ?? {}) as Record<string, unknown>;
  const f: Filters = {};
  for (const k of NUM_KEYS) {
    const v = b[k];
    if (v === "" || v === null || v === undefined) continue;
    const n = Number(v);
    if (Number.isFinite(n) && Math.abs(n) < 1e12) f[k] = n;
  }
  for (const k of BOOL_KEYS) if (b[k] === true) f[k] = true;
  if (b.universe === "fno") f.universe = "fno";
  if (b.supertrend === "up" || b.supertrend === "down") f.supertrend = b.supertrend;
  return f;
}
