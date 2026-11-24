import type { CandlestickData, ChartOptions, ChartSeriesType, SeriesData, SeriesOptionsMap, VisibleTimeRange } from "./types.ts";

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
  } else if (type === "cloud") {
    const c = bar as unknown as { upper: unknown; lower: unknown };
    finite(c.upper, "upper", index);
    finite(c.lower, "lower", index);
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

const NAMED_COLORS = new Set([
  "transparent", "black", "white", "red", "green", "blue", "yellow", "orange", "purple", "pink", "gray", "grey", "silver",
  "maroon", "navy", "teal", "olive", "lime", "aqua", "cyan", "magenta", "fuchsia", "brown", "gold", "indigo", "violet",
  "crimson", "coral", "tomato", "salmon", "khaki", "turquoise", "orchid", "plum", "tan", "beige", "ivory", "lavender",
  "darkgreen", "darkred", "darkblue", "lightgreen", "lightblue", "lightgray", "lightgrey", "darkgray", "darkgrey",
  "dodgerblue", "deepskyblue", "skyblue", "steelblue", "royalblue", "seagreen", "limegreen", "forestgreen", "firebrick",
  "orangered", "goldenrod", "darkorange", "slategray", "slategrey", "whitesmoke", "gainsboro", "mediumpurple", "hotpink",
]);
const COLOR_FN = /^(rgba?|hsla?)\(\s*[-+0-9.%\s,/]+\)$/i;
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** True for a valid CSS colour. Uses the browser's CSS parser when available. */
export function isCssColor(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const c = v.trim();
  if (!c) return false;
  const css = (globalThis as { CSS?: { supports?: (p: string, v: string) => boolean } }).CSS;
  if (css?.supports) return css.supports("color", c);
  return HEX.test(c) || COLOR_FN.test(c) || NAMED_COLORS.has(c.toLowerCase());
}

const SERIES_TYPES = ["candlestick", "line", "area", "histogram", "cloud"] as const;
export function validateSeriesType(type: unknown): asserts type is ChartSeriesType {
  if (!SERIES_TYPES.includes(type as ChartSeriesType)) throw new XChartError("INVALID_SERIES_TYPE", `Unknown series type ${String(type)}; expected one of ${SERIES_TYPES.join(", ")}`);
}

/** Pane and price-scale ids. "xs-" and "xind-" prefixes are reserved for generated panes. */
export const PANE_ID = /^(?!xs-|xind-)[A-Za-z0-9_-]{1,32}$/;

/** True when `tz` is an IANA time zone this runtime knows. */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const ALLOWED_OPTIONS: Record<ChartSeriesType, string[]> = {
  candlestick: ["upColor", "downColor", "wickUpColor", "wickDownColor"],
  line: ["color", "lineWidth", "lineStyle", "pane", "priceScaleId", "precision", "lastValueVisible", "title"],
  area: ["color", "lineWidth", "lineStyle", "pane", "priceScaleId", "precision", "lastValueVisible", "title", "topColor", "bottomColor", "baseline"],
  histogram: ["color", "upColor", "downColor", "colorMode", "opacity", "pane", "priceScaleId", "precision", "title"],
  cloud: ["upColor", "downColor", "opacity", "upperColor", "lowerColor", "lineVisible", "lineWidth", "lineStyle", "displacement", "pane", "priceScaleId", "precision", "lastValueVisible", "title"],
};

/** Checks option values and combinations that the renderer cannot honour. */
export function validateSeriesOptions<T extends ChartSeriesType>(type: T, o: Partial<SeriesOptionsMap[T]>, ctx: { hasCandles: boolean }): void {
  validateSeriesType(type);
  if (!o || typeof o !== "object") throw new XChartError("INVALID_OPTION", "Series options must be an object");
  const any = o as Record<string, unknown>;
  for (const k of Object.keys(any)) {
    if (any[k] === undefined) continue;
    if (!ALLOWED_OPTIONS[type].includes(k)) throw new XChartError("INVALID_OPTION", `"${k}" is not an option of ${type} series`);
  }
  for (const k of ["color", "upColor", "downColor", "wickUpColor", "wickDownColor", "topColor", "bottomColor", "upperColor", "lowerColor"]) {
    if (any[k] !== undefined && !isCssColor(any[k])) throw new XChartError("INVALID_COLOR", `${k} must be a valid CSS colour (got ${JSON.stringify(any[k])})`);
  }
  if (any.lineWidth !== undefined && !(typeof any.lineWidth === "number" && Number.isFinite(any.lineWidth) && any.lineWidth > 0 && any.lineWidth <= 20)) {
    throw new XChartError("INVALID_OPTION", "lineWidth must be a number greater than 0 and at most 20");
  }
  if (any.lineStyle !== undefined && !["solid", "dashed", "dotted"].includes(any.lineStyle as string)) {
    throw new XChartError("INVALID_OPTION", 'lineStyle must be "solid", "dashed" or "dotted"');
  }
  if (any.opacity !== undefined && !(typeof any.opacity === "number" && any.opacity >= 0 && any.opacity <= 1)) {
    throw new XChartError("INVALID_OPTION", "opacity must be a number from 0 to 1");
  }
  if (any.precision !== undefined && !(Number.isInteger(any.precision) && (any.precision as number) >= 0 && (any.precision as number) <= 10)) {
    throw new XChartError("INVALID_OPTION", "precision must be an integer from 0 to 10");
  }
  if (any.pane !== undefined && !(typeof any.pane === "string" && (any.pane === "main" || any.pane === "separate" || PANE_ID.test(any.pane)))) {
    throw new XChartError("INVALID_OPTION", 'pane must be "main", "separate" or a pane id (1–32 letters, digits, _ or -) shared by several series');
  }
  if (any.priceScaleId !== undefined && !(typeof any.priceScaleId === "string" && PANE_ID.test(any.priceScaleId))) {
    throw new XChartError("INVALID_OPTION", 'priceScaleId must be "right", "left" or an overlay scale id (1–32 letters, digits, _ or -)');
  }
  if (any.lastValueVisible !== undefined && typeof any.lastValueVisible !== "boolean") throw new XChartError("INVALID_OPTION", "lastValueVisible must be a boolean");
  if (any.title !== undefined && (typeof any.title !== "string" || any.title.length > 200)) throw new XChartError("INVALID_OPTION", "title must be a string of at most 200 characters");
  if (any.baseline !== undefined) finite(any.baseline, "baseline");
  if (any.lineVisible !== undefined && typeof any.lineVisible !== "boolean") throw new XChartError("INVALID_OPTION", "lineVisible must be a boolean");
  if (any.displacement !== undefined && !(Number.isInteger(any.displacement) && Math.abs(any.displacement as number) <= 1000)) {
    throw new XChartError("INVALID_OPTION", "displacement must be an integer number of bars between -1000 and 1000");
  }
  if (any.colorMode !== undefined && !["sign", "candle", "single"].includes(any.colorMode as string)) {
    throw new XChartError("INVALID_OPTION", 'colorMode must be "sign", "candle" or "single"');
  }
  if (type === "histogram" && any.colorMode === "candle" && !ctx.hasCandles) {
    throw new XChartError("INCOMPATIBLE_SERIES", 'colorMode "candle" colours bars by candle direction and needs a candlestick series on the chart');
  }
}

const MAX_DIM = 16384;
function dimension(v: unknown, name: string) {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > MAX_DIM) {
    throw new XChartError("INVALID_DIMENSION", `${name} must be a finite number of pixels between 1 and ${MAX_DIM} (got ${String(v)})`);
  }
}

/** Validates a complete (merged) chart options object. */
export function validateChartOptions(o: ChartOptions): void {
  if (!o || typeof o !== "object") throw new XChartError("INVALID_OPTION", "Chart options must be an object");
  if (o.theme !== undefined && o.theme !== "dark" && o.theme !== "light") throw new XChartError("INVALID_OPTION", 'theme must be "dark" or "light"');
  for (const k of ["autoSize", "crosshair", "followLatest"] as const) {
    if (o[k] !== undefined && typeof o[k] !== "boolean") throw new XChartError("INVALID_OPTION", `${k} must be a boolean`);
  }
  if (o.width !== undefined) dimension(o.width, "width");
  if (o.height !== undefined) dimension(o.height, "height");
  if (o.autoSize === false && (o.width === undefined || o.height === undefined)) {
    throw new XChartError("INVALID_OPTION", "autoSize: false needs both width and height");
  }
  if (o.utcOffsetMinutes !== undefined && !(Number.isInteger(o.utcOffsetMinutes) && o.utcOffsetMinutes >= -720 && o.utcOffsetMinutes <= 840)) {
    throw new XChartError("INVALID_OPTION", "utcOffsetMinutes must be an integer from -720 to 840");
  }
  if (o.timeZone !== undefined && !isTimeZone(o.timeZone)) throw new XChartError("INVALID_OPTION", `timeZone must be an IANA time zone (e.g. "Asia/Kolkata"), got ${String(o.timeZone)}`);
  if (o.locale !== undefined) {
    try {
      if (typeof o.locale !== "string") throw new Error();
      new Intl.DateTimeFormat(o.locale);
    } catch {
      throw new XChartError("INVALID_OPTION", `locale must be a BCP 47 language tag, got ${String(o.locale)}`);
    }
  }
  const ps = o.priceScale;
  if (ps !== undefined) {
    if (!ps || typeof ps !== "object") throw new XChartError("INVALID_OPTION", "priceScale must be an object");
    if (ps.mode !== undefined && !["normal", "logarithmic", "percentage", "indexed"].includes(ps.mode)) throw new XChartError("INVALID_OPTION", 'priceScale.mode must be "normal", "logarithmic", "percentage" or "indexed"');
    if (ps.autoScale !== undefined && typeof ps.autoScale !== "boolean") throw new XChartError("INVALID_OPTION", "priceScale.autoScale must be a boolean");
    if (ps.precision !== undefined && !(Number.isInteger(ps.precision) && ps.precision >= 0 && ps.precision <= 10)) {
      throw new XChartError("INVALID_OPTION", "priceScale.precision must be an integer from 0 to 10");
    }
  }
}

export function validateZoom(factor: unknown): void {
  if (typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0 || factor > 100) {
    throw new XChartError("INVALID_NUMBER", "zoom factor must be a positive finite number (at most 100)");
  }
}
