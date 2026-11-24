/**
 * Chart types. Time-based types are display transforms of the candlestick series: the original
 * OHLCV in the store is never modified (indicators, crosshair data and exports keep using it).
 *
 * Price-based types (Renko, Kagi, Point & Figure, Line Break, Range bars) build bricks/columns
 * whose count is independent of time: several can complete inside one bar. They cannot be drawn
 * on the shared, strictly increasing time axis without inventing timestamps, so rendering them is
 * reported as UNSUPPORTED_CHART_TYPE. Their calculations are exported and tested for use elsewhere.
 */
import type { AxisBar } from "./store.ts";
import { XChartError, isCssColor } from "./validation.ts";

export const TIME_CHART_TYPES = ["candles", "hollow-candles", "bars", "heikin-ashi", "line", "step-line", "line-markers", "area", "baseline", "high-low", "columns"] as const;
export const PRICE_CHART_TYPES = ["renko", "kagi", "point-and-figure", "line-break", "range-bars"] as const;
export type ChartType = (typeof TIME_CHART_TYPES)[number];
export type PriceChartType = (typeof PRICE_CHART_TYPES)[number];

export type ChartTypeStyle = {
  lineColor?: string;
  lineWidth?: number;
  areaTopColor?: string;
  areaBottomColor?: string;
  /** Baseline value (default: first visible close). */
  baseline?: number;
  upColor?: string;
  downColor?: string;
};

export function validateChartType(type: unknown, style?: unknown): asserts type is ChartType {
  if ((PRICE_CHART_TYPES as readonly string[]).includes(type as string)) {
    throw new XChartError(
      "UNSUPPORTED_CHART_TYPE",
      `"${String(type)}" is price-based: its bricks/columns are not tied to bar times, so it cannot be drawn on the time axis without inventing timestamps. Use the exported calculation (e.g. renko()) instead.`,
    );
  }
  if (!(TIME_CHART_TYPES as readonly string[]).includes(type as string)) throw new XChartError("INVALID_OPTION", `Unknown chart type "${String(type)}". Supported: ${TIME_CHART_TYPES.join(", ")}`);
  if (style === undefined) return;
  if (!style || typeof style !== "object") throw new XChartError("INVALID_OPTION", "Chart type style must be an object");
  const o = style as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!["lineColor", "lineWidth", "areaTopColor", "areaBottomColor", "baseline", "upColor", "downColor"].includes(k)) throw new XChartError("INVALID_OPTION", `Unknown chart type style "${k}"`);
  for (const k of ["lineColor", "areaTopColor", "areaBottomColor", "upColor", "downColor"]) if (o[k] !== undefined && !isCssColor(o[k])) throw new XChartError("INVALID_COLOR", `Invalid ${k}`);
  if (o.lineWidth !== undefined && (typeof o.lineWidth !== "number" || !(o.lineWidth >= 0.5 && o.lineWidth <= 10))) throw new XChartError("INVALID_OPTION", "lineWidth must be between 0.5 and 10");
  if (o.baseline !== undefined && (typeof o.baseline !== "number" || !Number.isFinite(o.baseline))) throw new XChartError("INVALID_NUMBER", "baseline must be a finite number");
}

/** Engine draw type of a time-based chart type. */
export function engineType(t: ChartType): "candles" | "bars" | "line" | "area" | "hollow" | "hilo" | "step" | "baseline" | "columns" {
  switch (t) {
    case "hollow-candles": return "hollow";
    case "high-low": return "hilo";
    case "step-line": return "step";
    case "line-markers": return "line";
    case "heikin-ashi": return "candles";
    default: return t;
  }
}

// ---------- Heikin Ashi (display transform; gaps stay gaps) ----------
const gapOf = (t: number): AxisBar => ({ t, o: NaN, h: NaN, l: NaN, c: NaN, v: 0 });

/** Writes Heikin Ashi bars for source[from..] into out (out may be the previous result). */
export function heikinAshi(src: AxisBar[], out: AxisBar[] = [], from = 0): AxisBar[] {
  out.length = src.length;
  // Find the previous real HA bar before `from`.
  let p = from - 1;
  while (p >= 0 && !Number.isFinite(out[p]?.c)) p--;
  let prevO = p >= 0 ? out[p].o : NaN;
  let prevC = p >= 0 ? out[p].c : NaN;
  for (let i = from; i < src.length; i++) {
    const b = src[i];
    if (!Number.isFinite(b.c)) {
      out[i] = gapOf(b.t);
      continue;
    }
    const c = (b.o + b.h + b.l + b.c) / 4;
    const o = Number.isFinite(prevO) ? (prevO + prevC) / 2 : (b.o + b.c) / 2;
    out[i] = { t: b.t, o, h: Math.max(b.h, o, c), l: Math.min(b.l, o, c), c, v: b.v };
    prevO = o;
    prevC = c;
  }
  return out;
}

// ---------- price-based calculations (pure, exported) ----------
type Closes = ReadonlyArray<{ time: number; close: number }>;
const positive = (v: unknown, name: string) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw new XChartError("INVALID_NUMBER", `${name} must be a positive number`);
};

export type Brick = { open: number; close: number; up: boolean; /** Time of the bar that completed it. */ time: number };
/** Classic close-based Renko: a brick completes each `boxSize`; a reversal needs two boxes. */
export function renko(data: Closes, boxSize: number): Brick[] {
  positive(boxSize, "boxSize");
  const out: Brick[] = [];
  if (!data.length) return out;
  let base = data[0].close;
  let dir = 0;
  for (const { time, close } of data) {
    for (;;) {
      if (dir >= 0 && close >= base + boxSize) {
        out.push({ open: base, close: base + boxSize, up: true, time });
        base += boxSize;
        dir = 1;
      } else if (dir <= 0 && close <= base - boxSize) {
        out.push({ open: base, close: base - boxSize, up: false, time });
        base -= boxSize;
        dir = -1;
      } else if (dir > 0 && close <= base - 2 * boxSize) {
        base -= boxSize;
        out.push({ open: base, close: base - boxSize, up: false, time });
        base -= boxSize;
        dir = -1;
      } else if (dir < 0 && close >= base + 2 * boxSize) {
        base += boxSize;
        out.push({ open: base, close: base + boxSize, up: true, time });
        base += boxSize;
        dir = 1;
      } else break;
    }
  }
  return out;
}

export type KagiLine = { from: number; to: number; up: boolean; /** yang (thick) when above the previous shoulder, yin (thin) when below the previous waist. */ thick: boolean; time: number };
/** Kagi with a fixed reversal amount. */
export function kagi(data: Closes, reversal: number): KagiLine[] {
  positive(reversal, "reversal");
  const out: KagiLine[] = [];
  if (data.length < 2) return out;
  const start = data[0].close;
  let end = start;
  let up: boolean | null = null;
  let thick = true;
  let lastHigh = -Infinity, lastLow = Infinity;
  for (const { time, close } of data.slice(1)) {
    if (up === null) {
      if (Math.abs(close - start) >= reversal) {
        up = close > start;
        end = close;
        out.push({ from: start, to: end, up, thick, time });
      }
      continue;
    }
    const cur = out[out.length - 1];
    if ((up && close > end) || (!up && close < end)) {
      end = close;
      cur.to = end;
      if (up && end > lastHigh) cur.thick = thick = true;
      if (!up && end < lastLow) cur.thick = thick = false;
    } else if (Math.abs(close - end) >= reversal) {
      if (up) lastHigh = end;
      else lastLow = end;
      up = !up;
      out.push({ from: end, to: close, up, thick, time });
      end = close;
      const now = out[out.length - 1];
      if (up && end > lastHigh) now.thick = thick = true;
      if (!up && end < lastLow) now.thick = thick = false;
    }
  }
  return out;
}

export type PnfColumn = { kind: "X" | "O"; low: number; high: number; /** Boxes in the column. */ boxes: number; time: number };
/** Close-based Point & Figure with `boxSize` and an N-box reversal (default 3). */
export function pointAndFigure(data: Closes, boxSize: number, reversal = 3): PnfColumn[] {
  positive(boxSize, "boxSize");
  if (!Number.isInteger(reversal) || reversal < 1) throw new XChartError("INVALID_NUMBER", "reversal must be a positive integer");
  const out: PnfColumn[] = [];
  if (!data.length) return out;
  const q = (v: number) => Math.floor(v / boxSize) * boxSize;
  const ref = q(data[0].close);
  for (const { time, close } of data) {
    const col = out[out.length - 1];
    if (!col) {
      if (close >= ref + boxSize) out.push({ kind: "X", low: ref + boxSize, high: q(close), boxes: 0, time });
      else if (close <= ref - boxSize) out.push({ kind: "O", low: q(close) + boxSize, high: ref, boxes: 0, time });
    } else if (col.kind === "X") {
      if (q(close) > col.high) col.high = q(close);
      else if (close <= col.high - (reversal + 0) * boxSize) out.push({ kind: "O", high: col.high - boxSize, low: Math.ceil(close / boxSize) * boxSize, boxes: 0, time });
    } else {
      if (Math.ceil(close / boxSize) * boxSize < col.low) col.low = Math.ceil(close / boxSize) * boxSize;
      else if (close >= col.low + reversal * boxSize) out.push({ kind: "X", low: col.low + boxSize, high: q(close), boxes: 0, time });
    }
  }
  for (const c of out) c.boxes = Math.round((c.high - c.low) / boxSize) + 1;
  return out;
}

export type BreakLine = { open: number; close: number; up: boolean; time: number };
/** N-line break (default 3): a reversal must exceed the extreme of the last N lines. */
export function lineBreak(data: Closes, lines = 3): BreakLine[] {
  if (!Number.isInteger(lines) || lines < 1) throw new XChartError("INVALID_NUMBER", "lines must be a positive integer");
  const out: BreakLine[] = [];
  if (!data.length) return out;
  let last = data[0].close;
  for (const { time, close } of data.slice(1)) {
    if (!out.length) {
      if (close !== last) out.push({ open: last, close, up: close > last, time });
      continue;
    }
    const cur = out[out.length - 1];
    const recent = out.slice(-lines);
    const hi = Math.max(...recent.map((l) => Math.max(l.open, l.close)));
    const lo = Math.min(...recent.map((l) => Math.min(l.open, l.close)));
    if (cur.up && close > cur.close) out.push({ open: cur.close, close, up: true, time });
    else if (!cur.up && close < cur.close) out.push({ open: cur.close, close, up: false, time });
    else if (cur.up && close < lo) out.push({ open: cur.open, close, up: false, time });
    else if (!cur.up && close > hi) out.push({ open: cur.open, close, up: true, time });
    last = close;
  }
  return out;
}

export type RangeBar = { open: number; high: number; low: number; close: number; time: number };
/**
 * Range bars of a fixed high–low range from CLOSES. True range bars need tick data (the
 * intrabar path is unknown from OHLC); this close-based version is an approximation.
 */
export function rangeBars(data: Closes, range: number): RangeBar[] {
  positive(range, "range");
  const out: RangeBar[] = [];
  if (!data.length) return out;
  let cur: RangeBar = { open: data[0].close, high: data[0].close, low: data[0].close, close: data[0].close, time: data[0].time };
  for (const { time, close } of data.slice(1)) {
    let price = close;
    for (;;) {
      if (price > cur.low + range) {
        const top = cur.low + range;
        out.push({ ...cur, high: top, close: top, time });
        cur = { open: top, high: top, low: top, close: top, time };
      } else if (price < cur.high - range) {
        const bot = cur.high - range;
        out.push({ ...cur, low: bot, close: bot, time });
        cur = { open: bot, high: bot, low: bot, close: bot, time };
      } else break;
    }
    cur.high = Math.max(cur.high, price);
    cur.low = Math.min(cur.low, price);
    cur.close = price;
    cur.time = time;
    price = NaN;
  }
  return out;
}
