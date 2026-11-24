/** Public types of the XChart indicator subsystem. */

/** Price input a calculation reads. Derived sources follow the usual definitions. */
export type IndicatorSource = "open" | "high" | "low" | "close" | "volume" | "hl2" | "hlc3" | "ohlc4";
export const INDICATOR_SOURCES: IndicatorSource[] = ["open", "high", "low", "close", "volume", "hl2", "hlc3", "ohlc4"];

export type ParamType = "number" | "integer" | "boolean" | "select" | "source";
export type ParamSchema = {
  key: string;
  label: string;
  type: ParamType;
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** Other accepted names (e.g. "period" for "length"). */
  aliases?: string[];
};

export type OutputType = "line" | "histogram" | "area" | "dots";
export type OutputFillDef = {
  id: string;
  label: string;
  /** Another output's key, or a constant level. */
  with: string | number;
  up: string;
  down: string;
  opacity: number;
  only?: "up" | "down";
};
export type OutputDef = {
  key: string;
  label: string;
  type: OutputType;
  color: string;
  width?: number;
  /** Histogram colours: "trend" four-tone (MACD) or "candle" (by bar direction). */
  hist?: { mode: "trend" | "candle" | "sign"; colors: string[] };
  fills?: OutputFillDef[];
};

/** Columnar price input given to calculations (only bars that exist: gaps are removed). */
export type IndicatorInput = {
  time: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  /** True when the series has real intraday timestamps. */
  intraday: boolean;
};

export type IndicatorParams = Record<string, number | boolean | string>;
/** Output arrays keyed by OutputDef.key. Index i ↔ input bar i; extra entries past the end are a projection. */
export type IndicatorResult = Record<string, number[]>;

export interface IndicatorDefinition {
  id: string;
  name: string;
  description: string;
  category?: string;
  params: ParamSchema[];
  /** Price fields the calculation needs (checked before running). */
  inputs: Array<keyof Omit<IndicatorInput, "time" | "intraday">>;
  outputs: OutputDef[];
  pane: "overlay" | "separate";
  levels?: number[] | ((p: IndicatorParams) => number[]);
  range?: [number, number];
  /** Bars before the first valid value (NaN is returned for them). */
  warmup(p: IndicatorParams): number;
  /**
   * Finite memory: the value at bar i depends only on bars [i - lookback, i]. When set, live
   * updates recompute only the tail. Omit for recursive indicators (EMA, RSI, ...): those are
   * recalculated in full, once per frame at most.
   */
  lookback?(p: IndicatorParams): number;
  calculate(input: IndicatorInput, p: IndicatorParams): IndicatorResult;
  /** Optional exact incremental update from bar `from` onward (mutates and returns `prev`). */
  update?(input: IndicatorInput, p: IndicatorParams, prev: IndicatorResult, from: number): IndicatorResult;
  display?: { shortName?: string; precision?: number };
}

/** Per-instance display options (separate from calculation parameters). */
export type IndicatorOptions = {
  /** Primary output colour. */
  color?: string;
  /** Colours by output key. */
  colors?: Record<string, string>;
  lineWidth?: number;
  lineStyle?: "solid" | "dashed" | "dotted";
  /** "overlay", "separate" (own pane) or the id of an existing pane. */
  pane?: string;
  /** Price scale on its pane (default: the pane's right scale). */
  priceScaleId?: string;
  visible?: boolean;
  title?: string;
  /** Hide individual outputs by key. */
  hiddenOutputs?: string[];
  /** Fill opacity / visibility overrides by fill id. */
  fills?: Record<string, { visible?: boolean; opacity?: number; up?: string; down?: string }>;
};

export type IndicatorPoint = { time: number; projected: boolean; values: Record<string, number> };

export interface IndicatorApi {
  readonly id: string;
  readonly type: string;
  definition(): Readonly<IndicatorDefinition>;
  parameters(): Readonly<IndicatorParams>;
  options(): Readonly<IndicatorOptions>;
  applyOptions(o: Partial<IndicatorOptions>): void;
  setParameters(p: Partial<IndicatorParams>): void;
  setVisible(v: boolean): void;
  isVisible(): boolean;
  /** Calculated values with times (gaps and warm-up are omitted; projected points are flagged). */
  getValues(): IndicatorPoint[];
  /** Forces a full recalculation. */
  recalculate(): void;
  /** Last calculation error, or null. */
  error(): string | null;
  remove(): void;
}
