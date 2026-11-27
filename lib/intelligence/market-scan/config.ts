/** Scanner configuration: every field validated and clamped; unknown fields dropped. */
import type { Horizon } from "../equity/setup.ts";

export const INSTRUMENTS = ["equity", "stock-futures", "index-futures", "stock-options", "index-options"] as const;
export type InstrumentFilter = (typeof INSTRUMENTS)[number];
export const HORIZONS: Horizon[] = ["intraday", "scalping", "btst", "stbt", "swing", "positional", "short-term-investment"];
export const DIRECTIONS = ["any", "bullish", "bearish", "neutral", "volatility-expansion", "volatility-contraction"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Universes the scanner understands (index keys must have constituent data; see resolveUniverse). */
export const UNIVERSE_PRESETS = [
  "ALL_NSE_EQUITY", "ALL_FO_UNDERLYINGS", "NIFTY 50", "NIFTY NEXT 50", "NIFTY 100", "NIFTY 200", "NIFTY 500",
  "NIFTY MIDCAP 50", "NIFTY MIDCAP 100", "NIFTY MIDCAP 150", "NIFTY SMALLCAP 50", "NIFTY SMALLCAP 100", "NIFTY SMALLCAP 250",
  "NIFTY BANK", "NIFTY FINANCIAL SERVICES", "NIFTY IT", "NIFTY AUTO", "NIFTY PHARMA", "NIFTY HEALTHCARE INDEX", "NIFTY FMCG",
  "NIFTY METAL", "NIFTY REALTY", "NIFTY ENERGY", "NIFTY PSU BANK", "NIFTY PRIVATE BANK", "NIFTY OIL & GAS", "NIFTY MEDIA", "NIFTY CONSUMER DURABLES",
];

export type ScanConfig = {
  universes: string[];
  watchlistIds: number[];
  instruments: InstrumentFilter[];
  horizon: Horizon;
  direction: Direction;
  capital: number;
  maxRiskPerTrade: number;
  maxCapitalPerTrade: number;
  maxMargin: number | null;
  minRewardRisk: number;
  minLiquidity: number;
  maxSpreadPct: number;
  maxPositions: number;
  definedRiskOnly: boolean;
  singleLegOnly: boolean;
  optionBuyingOnly: boolean;
  optionSellingOnly: boolean;
  multiLeg: boolean;
};

export const DEFAULT_CONFIG: ScanConfig = {
  universes: ["NIFTY 50"], watchlistIds: [], instruments: ["equity"], horizon: "swing", direction: "any", capital: 500_000, maxRiskPerTrade: 5_000,
  maxCapitalPerTrade: 100_000, maxMargin: null, minRewardRisk: 1.5, minLiquidity: 5e7, maxSpreadPct: 2, maxPositions: 10, definedRiskOnly: true,
  singleLegOnly: false, optionBuyingOnly: false, optionSellingOnly: false, multiLeg: true,
};

const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

export function sanitizeScanConfig(input: unknown): ScanConfig {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_CONFIG;
  const universes = Array.isArray(o.universes) ? [...new Set(o.universes.filter((u): u is string => typeof u === "string" && /^[A-Z0-9 &_.-]{2,40}$/.test(u)))].slice(0, 20) : d.universes;
  const instruments = Array.isArray(o.instruments) ? INSTRUMENTS.filter((x) => (o.instruments as unknown[]).includes(x) || (o.instruments as unknown[]).includes("all")) : d.instruments;
  const capital = num(o.capital, d.capital, 1_000, 1e10);
  const cfg: ScanConfig = {
    universes,
    watchlistIds: Array.isArray(o.watchlistIds) ? o.watchlistIds.filter((x): x is number => Number.isSafeInteger(x) && (x as number) > 0).slice(0, 10) : [],
    instruments: instruments.length ? instruments : d.instruments,
    horizon: HORIZONS.includes(o.horizon as Horizon) ? (o.horizon as Horizon) : d.horizon,
    direction: DIRECTIONS.includes(o.direction as Direction) ? (o.direction as Direction) : d.direction,
    capital,
    maxRiskPerTrade: num(o.maxRiskPerTrade, Math.min(d.maxRiskPerTrade, capital), 1, capital),
    maxCapitalPerTrade: num(o.maxCapitalPerTrade, Math.min(d.maxCapitalPerTrade, capital), 100, capital),
    maxMargin: o.maxMargin === null || o.maxMargin === undefined ? null : num(o.maxMargin, capital, 0, capital),
    minRewardRisk: num(o.minRewardRisk, d.minRewardRisk, 0.5, 10),
    minLiquidity: num(o.minLiquidity, d.minLiquidity, 0, 1e11),
    maxSpreadPct: num(o.maxSpreadPct, d.maxSpreadPct, 0.05, 50),
    maxPositions: Math.round(num(o.maxPositions, d.maxPositions, 1, 100)),
    definedRiskOnly: bool(o.definedRiskOnly, d.definedRiskOnly),
    singleLegOnly: bool(o.singleLegOnly, d.singleLegOnly),
    optionBuyingOnly: bool(o.optionBuyingOnly, d.optionBuyingOnly),
    optionSellingOnly: bool(o.optionSellingOnly, d.optionSellingOnly),
    multiLeg: bool(o.multiLeg, d.multiLeg),
  };
  if (cfg.optionBuyingOnly && cfg.optionSellingOnly) cfg.optionSellingOnly = false;
  if (!cfg.universes.length && !cfg.watchlistIds.length) cfg.universes = d.universes;
  return cfg;
}
