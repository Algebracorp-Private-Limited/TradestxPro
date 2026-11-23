import type { CandlestickData, ChartSeriesType, SeriesData, VisibleTimeRange } from "./types";

function finite(value: number, field: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`Invalid ${field}: expected finite number`);
}
export function validateBar<T extends ChartSeriesType>(type: T, bar: SeriesData<T>): void {
  finite(bar.time, "time");
  if (!Number.isInteger(bar.time) || bar.time < 0) throw new RangeError("time must be a nonnegative Unix timestamp in seconds");
  if (type === "candlestick") {
    const c = bar as CandlestickData;
    for (const field of ["open", "high", "low", "close"] as const) finite(c[field], field);
    if (c.high < Math.max(c.open, c.close, c.low) || c.low > Math.min(c.open, c.close, c.high))
      throw new RangeError("OHLC high/low are inconsistent");
    if (c.volume !== undefined && (!Number.isFinite(c.volume) || c.volume < 0))
      throw new RangeError("volume must be nonnegative");
  } else {
    finite((bar as { value: number }).value, "value");
  }
}
export function validateBars<T extends ChartSeriesType>(type: T, bars: ReadonlyArray<SeriesData<T>>): void {
  let previous = -1;
  for (const bar of bars) {
    validateBar(type, bar);
    if (bar.time <= previous) throw new RangeError("Series data must have strictly increasing timestamps");
    previous = bar.time;
  }
}
export function validateRange(range: VisibleTimeRange): void {
  finite(range.from, "range.from");
  finite(range.to, "range.to");
  if (range.from >= range.to) throw new RangeError("Visible range must have from < to");
}
