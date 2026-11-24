import type { CandlestickData, ChartSeriesType, SeriesData, SeriesOptionsMap, VisibleTimeRange } from "./types.ts";

/** Thrown for invalid data, options or calls. Extends RangeError for compatibility with v0.1. */
export class XChartError extends RangeError {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[XChart] ${message}`);
    this.name = "XChartError";
    this.code = code;
  }
}

const where = (index?: number) => (index === undefined ? "" : ` (item ${index})`);

function finite(value: unknown, field: string, index?: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new XChartError("INVALID_NUMBER", `Invalid ${field}${where(index)}: expected a finite number, got ${String(value)}`);
  }
}

/** Validates one data point for a series type. */
export function validateBar<T extends ChartSeriesType>(type: T, bar: SeriesData<T>, index?: number): void {
  if (!bar || typeof bar !== "object") throw new XChartError("INVALID_POINT", `Data point${where(index)} must be an object`);
  finite(bar.time, "time", index);
  if (!Number.isInteger(bar.time) || bar.time < 0) {
    throw new XChartError("INVALID_TIME", `time${where(index)} must be a nonnegative Unix timestamp in whole seconds, got ${bar.time}`);
  }
  if (bar.time > 1e11) throw new XChartError("INVALID_TIME", `time${where(index)} looks like milliseconds (${bar.time}); use seconds`);
  if (type === "candlestick") {
    const c = bar as CandlestickData;
    for (const field of ["open", "high", "low", "close"] as const) finite(c[field], field, index);
    if (c.high < Math.max(c.open, c.close, c.low) || c.low > Math.min(c.open, c.close, c.high)) {
      throw new XChartError("INVALID_OHLC", `OHLC${where(index)} is inconsistent: high must be ≥ open/close/low and low ≤ open/close/high`);
    }
    if (c.volume !== undefined && (typeof c.volume !== "number" || !Number.isFinite(c.volume) || c.volume < 0)) {
      throw new XChartError("INVALID_VOLUME", `volume${where(index)} must be a nonnegative finite number`);
    }
  } else {
    finite((bar as { value: number }).value, "value", index);
  }
}

/** Validates a full data set: every point plus strictly increasing time. */
export function validateBars<T extends ChartSeriesType>(type: T, bars: ReadonlyArray<SeriesData<T>>): void {
  if (!Array.isArray(bars)) throw new XChartError("INVALID_DATA", "setData expects an array");
  let previous = -1;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    validateBar(type, bar, i);
    if (bar.time === previous) throw new XChartError("DUPLICATE_TIME", `Duplicate timestamp ${bar.time} at item ${i}`);
    if (bar.time < previous) throw new XChartError("UNSORTED_TIME", `Timestamps must increase: item ${i} (${bar.time}) is earlier than item ${i - 1} (${previous})`);
    previous = bar.time;
  }
}

/** A real-time update must be at or after the series' last point. */
export function validateUpdate<T extends ChartSeriesType>(type: T, last: SeriesData<T> | undefined, bar: SeriesData<T>): void {
  validateBar(type, bar);
  if (last && bar.time < last.time) {
    throw new XChartError("OUT_OF_ORDER", `Update at ${bar.time} is older than the series' last point (${last.time}); updates may only replace the last point or append`);
  }
}

export function validateRange(range: VisibleTimeRange): void {
  if (!range || typeof range !== "object") throw new XChartError("INVALID_RANGE", "Visible range must be { from, to }");
  finite(range.from, "range.from");
  finite(range.to, "range.to");
  if (range.from >= range.to) throw new XChartError("INVALID_RANGE", `Visible range must have from < to (got ${range.from} → ${range.to})`);
}

const isColor = (v: unknown) => typeof v === "string" && v.trim().length > 0;

/** Checks option values and combinations that the renderer cannot honour. */
export function validateSeriesOptions<T extends ChartSeriesType>(type: T, o: Partial<SeriesOptionsMap[T]>, ctx: { hasCandles: boolean }): void {
  const any = o as Record<string, unknown>;
  for (const k of ["color", "upColor", "downColor", "wickUpColor", "wickDownColor", "topColor", "bottomColor"]) {
    if (any[k] !== undefined && !isColor(any[k])) throw new XChartError("INVALID_OPTION", `${k} must be a CSS colour string`);
  }
  if (any.lineWidth !== undefined && !(typeof any.lineWidth === "number" && any.lineWidth > 0 && any.lineWidth <= 20)) {
    throw new XChartError("INVALID_OPTION", "lineWidth must be a number between 0 and 20");
  }
  if (any.opacity !== undefined && !(typeof any.opacity === "number" && any.opacity >= 0 && any.opacity <= 1)) {
    throw new XChartError("INVALID_OPTION", "opacity must be between 0 and 1");
  }
  if (any.precision !== undefined && !(Number.isInteger(any.precision) && (any.precision as number) >= 0 && (any.precision as number) <= 10)) {
    throw new XChartError("INVALID_OPTION", "precision must be an integer from 0 to 10");
  }
  if (any.pane !== undefined && any.pane !== "main" && any.pane !== "separate") throw new XChartError("INVALID_OPTION", 'pane must be "main" or "separate"');
  if (any.baseline !== undefined) finite(any.baseline, "baseline");
  if (type === "histogram" && any.colorMode === "candle" && !ctx.hasCandles) {
    throw new XChartError("INCOMPATIBLE_SERIES", 'colorMode "candle" colours bars by candle direction and needs a candlestick series on the chart');
  }
}
