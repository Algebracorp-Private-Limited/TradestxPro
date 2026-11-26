/**
 * Derived (price-based) chart data model.
 *
 * Layers, kept strictly apart:
 *   1. Observed market data  — the candlestick series in SeriesStore (never modified).
 *   2. Derived representation — DerivedPoint[] on a LOGICAL index (one point per brick, line,
 *      column or range bar; several points may come from one source candle).
 *   3. Display coordinates    — the renderer maps logical index → x and derived price → y.
 *   4. Executable prices      — always the source candles' prices (`sourceClose`); a derived
 *      value (e.g. a Renko brick boundary) is a chart construct, never a traded price.
 *
 * No timestamps are invented: each point carries the time of the source candle that produced it,
 * and several points may share one source time.
 */
export type DerivedKind = "renko" | "kagi" | "point-and-figure" | "line-break" | "range-bars";

/** "confirmed": cannot change any more. "provisional": depends on the latest source candle (which a live
 * update may still replace) or is the open, still-extendable last line/column. */
export type DerivedStatus = "confirmed" | "provisional";

export type DerivedPoint = {
  /** Stable id: `${kind}:${sourceIndex}:${seq}` (unchanged while the same source candle produces it). */
  id: string;
  logical: number;
  sourceTime: number;
  /** Index of the producing candle in the candlestick series' data. */
  sourceIndex: number;
  /** n-th point produced by that source candle. */
  seq: number;
  open: number;
  high: number;
  low: number;
  close: number;
  direction: 1 | -1;
  status: DerivedStatus;
  /** Close of the source candle (the observed market price at that time). */
  sourceClose: number;
  /** True when the point was built from a reconstructed intrabar path (OHLC path assumption). */
  reconstructed: boolean;
  /** Brick / box / range size in price units used for this point (renko, P&F, range bars). */
  size?: number;
  /** Kagi: line thickness at the start/end ("yang" thick, "yin" thin) and the price where it switched. */
  thickStart?: boolean;
  thickEnd?: boolean;
  switchPrice?: number;
  /** Point & Figure: box indexes covered by the column (inclusive) and the box count. */
  lowBox?: number;
  highBox?: number;
  boxes?: number;
  /** Line Break: whether the line reversed the previous direction. */
  reversal?: boolean;
  /** Range bars: false for the still-forming last bar. */
  complete?: boolean;
};

export type SizeMethod = "fixed" | "percentage" | "atr";
export type PriceSource = "close" | "hl2" | "hlc3" | "ohlc4" | "high-low";

export type RenkoSettings = { method?: SizeMethod; size?: number; atrPeriod?: number; reversal?: number; source?: PriceSource; wicks?: boolean; showProvisional?: boolean; upColor?: string; downColor?: string };
export type KagiSettings = { method?: SizeMethod; reversal?: number; atrPeriod?: number; source?: Exclude<PriceSource, "high-low">; yangWidth?: number; yinWidth?: number; upColor?: string; downColor?: string; showProvisional?: boolean };
export type PnfSettings = { method?: SizeMethod; boxSize?: number; atrPeriod?: number; reversal?: number; source?: "close" | "high-low"; columnSpacing?: number; xColor?: string; oColor?: string; showProvisional?: boolean };
export type LineBreakSettings = { lines?: number; source?: Exclude<PriceSource, "high-low">; upColor?: string; downColor?: string; showProvisional?: boolean };
export type RangeBarSettings = { method?: SizeMethod | "ticks"; range?: number; tickSize?: number; atrPeriod?: number; wicks?: boolean; upColor?: string; downColor?: string; showProvisional?: boolean };
export type DerivedSettingsMap = { renko: RenkoSettings; kagi: KagiSettings; "point-and-figure": PnfSettings; "line-break": LineBreakSettings; "range-bars": RangeBarSettings };
export type DerivedSettings = DerivedSettingsMap[DerivedKind];

/** Source observation fed to the builders (a candle of the candlestick series). */
export type SourceCandle = { time: number; open: number; high: number; low: number; close: number };

export type DerivedSeries = {
  kind: DerivedKind;
  /** Settings with defaults applied. */
  settings: Required<Omit<DerivedSettingsMap[DerivedKind], never>> & Record<string, unknown>;
  points: DerivedPoint[];
  /** Increments on every change of the derived series. */
  revision: number;
  /** SeriesStore version the series was built from. */
  sourceRevision: number;
  /** Plain-language description of the calculation and its assumptions. */
  methodology: string;
  /** Point & Figure: price of box index k. */
  boxLevel?: (k: number) => number;
};
