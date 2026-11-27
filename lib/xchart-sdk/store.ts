/**
 * Series data store: keeps every series aligned on one shared time axis (the sorted union of
 * all series' timestamps). Renderer-facing arrays are mutated in place on live updates, so a
 * tick costs O(1) (replace) or O(series) (append) instead of rebuilding history.
 * Pure TypeScript: no DOM access.
 */
import type { CandlestickData, ChartSeriesType, CloudData, SeriesData, SingleValueData } from "./types.ts";
import { XChartError, validateBars, validateSeriesType, validateUpdate } from "./validation.ts";

/** Same shape as the engine's Bar. NaN prices mark a gap (no candle at this time). */
export type AxisBar = { t: number; o: number; h: number; l: number; c: number; v: number };

export type StoreSeries = {
  id: number;
  type: ChartSeriesType;
  points: SeriesData<ChartSeriesType>[];
  /** Values aligned to the axis (NaN where the series has no point); unused for candlesticks. */
  values: number[];
  /** Second aligned array: the lower boundary of cloud series. */
  values2: number[];
};

/** What changed, so the renderer can redraw cheaply. */
export type Change = { kind: "full" } | { kind: "tick"; appended: number };

const gap = (t: number): AxisBar => ({ t, o: NaN, h: NaN, l: NaN, c: NaN, v: 0 });
const toBar = (p: CandlestickData): AxisBar => ({ t: p.time, o: p.open, h: p.high, l: p.low, c: p.close, v: p.volume ?? 0 });

/** Index of `t` in sorted `arr`, or -(insertion point) - 1 when absent. */
export function search(arr: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = arr[mid];
    if (v === t) return mid;
    if (v < t) lo = mid + 1;
    else hi = mid - 1;
  }
  return -lo - 1;
}

/** Binary search over points by time (no allocation). */
function searchPoints(points: ReadonlyArray<{ time: number }>, t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = points[mid].time;
    if (v === t) return mid;
    if (v < t) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

export class SeriesStore {
  /** Shared, strictly increasing time axis. */
  times: number[] = [];
  /** Candles aligned to the axis (gap bars where there is no candle, or no candlestick series). */
  bars: AxisBar[] = [];
  readonly series = new Map<number, StoreSeries>();
  /** Increments on every data change (lets observers tell "same position, new data" apart). */
  version = 0;
  private nextId = 1;

  add(type: ChartSeriesType): StoreSeries {
    validateSeriesType(type);
    if (type === "candlestick" && this.candle()) {
      throw new XChartError("UNSUPPORTED_SERIES", "Only one candlestick series per chart is supported in this version");
    }
    const s: StoreSeries = { id: this.nextId++, type, points: [], values: new Array(this.times.length).fill(NaN), values2: type === "cloud" ? new Array(this.times.length).fill(NaN) : [] };
    this.series.set(s.id, s);
    return s;
  }

  candle(): StoreSeries | undefined {
    for (const s of this.series.values()) if (s.type === "candlestick") return s;
    return undefined;
  }

  remove(id: number): Change {
    if (!this.series.delete(id)) return { kind: "tick", appended: 0 };
    this.rebuild();
    this.version++;
    return { kind: "full" };
  }

  /** Drops every series and array (chart destruction). */
  clear() {
    this.series.clear();
    this.times = [];
    this.bars = [];
    this.version++;
  }

  setData(id: number, data: ReadonlyArray<SeriesData<ChartSeriesType>>): Change {
    const s = this.get(id);
    validateBars(s.type, data);
    s.points = data.map((p) => ({ ...p }));
    this.rebuild();
    this.version++;
    return { kind: "full" };
  }

  /** Replace the last point (same time) or append (later time). */
  update(id: number, point: SeriesData<ChartSeriesType>): Change {
    const s = this.get(id);
    const last = s.points[s.points.length - 1];
    validateUpdate(s.type, last, point);
    const p = { ...point };
    this.version++;
    if (last && p.time === last.time) {
      s.points[s.points.length - 1] = p;
      this.writeAt(s, search(this.times, p.time), p);
      return { kind: "tick", appended: 0 };
    }
    s.points.push(p);
    const n = this.times.length;
    if (n === 0 || p.time > this.times[n - 1]) {
      // New newest time: extend every aligned array by one slot.
      this.times.push(p.time);
      this.bars.push(gap(p.time));
      for (const o of this.series.values()) {
        if (o.type === "candlestick") continue;
        o.values.push(NaN);
        if (o.type === "cloud") o.values2.push(NaN);
      }
      this.writeAt(s, n, p);
      return { kind: "tick", appended: 1 };
    }
    const idx = search(this.times, p.time);
    if (idx >= 0) {
      // Another series already has this time (this one was lagging): fill the slot.
      this.writeAt(s, idx, p);
      return { kind: "tick", appended: 0 };
    }
    // Between existing axis times: insert a slot (rare; O(n)).
    const at = -idx - 1;
    this.times.splice(at, 0, p.time);
    this.bars.splice(at, 0, gap(p.time));
    for (const o of this.series.values()) {
      if (o.type === "candlestick") continue;
      o.values.splice(at, 0, NaN);
      if (o.type === "cloud") o.values2.splice(at, 0, NaN);
    }
    this.writeAt(s, at, p);
    return { kind: "full" };
  }

  /** Data of each series exactly at axis index `i`. */
  pointsAt(i: number): Map<number, SeriesData<ChartSeriesType>> {
    const out = new Map<number, SeriesData<ChartSeriesType>>();
    if (i < 0 || i >= this.times.length || !Number.isInteger(i)) return out;
    const t = this.times[i];
    for (const s of this.series.values()) {
      if (s.type === "candlestick") {
        const b = this.bars[i];
        if (Number.isFinite(b.c)) {
          const d: CandlestickData = { time: t, open: b.o, high: b.h, low: b.l, close: b.c };
          const src = s.points[searchPoints(s.points, t)] as CandlestickData | undefined;
          if (src?.volume !== undefined) d.volume = src.volume;
          out.set(s.id, d);
        }
      } else if (s.type === "cloud") {
        if (Number.isFinite(s.values[i])) out.set(s.id, { time: t, upper: s.values[i], lower: s.values2[i] } as CloudData);
      } else if (Number.isFinite(s.values[i])) {
        out.set(s.id, { time: t, value: s.values[i] } as SingleValueData);
      }
    }
    return out;
  }

  /** Fractional axis index of a time; extrapolates beyond the ends with the typical bar spacing. */
  indexOfTime(t: number): number {
    const T = this.times;
    const n = T.length;
    if (!n) return 0;
    const step = this.step();
    if (t <= T[0]) return (t - T[0]) / step;
    if (t >= T[n - 1]) return n - 1 + (t - T[n - 1]) / step;
    const idx = search(T, t);
    if (idx >= 0) return idx;
    const hi = -idx - 1;
    const lo = hi - 1;
    return lo + (t - T[lo]) / (T[hi] - T[lo]);
  }

  /** Time at a fractional axis index (inverse of indexOfTime). */
  timeAt(i: number): number {
    const T = this.times;
    const n = T.length;
    if (!n) return 0;
    const step = this.step();
    if (i <= 0) return Math.round(T[0] + i * step);
    if (i >= n - 1) return Math.round(T[n - 1] + (i - (n - 1)) * step);
    const lo = Math.floor(i);
    return Math.round(T[lo] + (i - lo) * (T[lo + 1] - T[lo]));
  }

  /** Median spacing of the most recent bars (robust to weekends and session gaps). */
  step(): number {
    const T = this.times;
    if (T.length < 2) return 86400;
    const d: number[] = [];
    for (let i = Math.max(1, T.length - 64); i < T.length; i++) d.push(T[i] - T[i - 1]);
    d.sort((a, b) => a - b);
    return d[d.length >> 1] || 86400;
  }

  /** Whether the axis is intraday (bars closer than a day). */
  intraday(): boolean {
    return this.times.length > 1 && this.step() < 86400;
  }

  private get(id: number): StoreSeries {
    const s = this.series.get(id);
    if (!s) throw new XChartError("SERIES_REMOVED", "This series was removed from the chart");
    return s;
  }

  private writeAt(s: StoreSeries, i: number, p: SeriesData<ChartSeriesType>) {
    if (s.type === "candlestick") this.bars[i] = toBar(p as CandlestickData);
    else if (s.type === "cloud") {
      s.values[i] = (p as CloudData).upper;
      s.values2[i] = (p as CloudData).lower;
    } else s.values[i] = (p as SingleValueData).value;
  }

  /** Rebuilds the axis and every aligned array (setData / remove / mid-axis insert). O(total points). */
  private rebuild() {
    const all: number[] = [];
    for (const s of this.series.values()) for (const p of s.points) all.push(p.time);
    all.sort((a, b) => a - b);
    const times: number[] = [];
    for (const t of all) if (times[times.length - 1] !== t) times.push(t);
    this.times = times;
    this.bars = times.map(gap);
    for (const s of this.series.values()) {
      if (s.type === "candlestick") {
        let j = 0;
        for (const p of s.points as CandlestickData[]) {
          while (times[j] !== p.time) j++;
          this.bars[j] = toBar(p);
        }
      } else if (s.type === "cloud") {
        const u = new Array<number>(times.length).fill(NaN);
        const l = new Array<number>(times.length).fill(NaN);
        let j = 0;
        for (const p of s.points as CloudData[]) {
          while (times[j] !== p.time) j++;
          u[j] = p.upper;
          l[j] = p.lower;
        }
        s.values = u;
        s.values2 = l;
      } else {
        const v = new Array<number>(times.length).fill(NaN);
        let j = 0;
        for (const p of s.points as SingleValueData[]) {
          while (times[j] !== p.time) j++;
          v[j] = p.value;
        }
        s.values = v;
      }
    }
  }
}
