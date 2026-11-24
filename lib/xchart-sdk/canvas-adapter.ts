/**
 * Canvas adapter: renders the SDK's data model with TradestXPro's existing ChartEngine
 * (components/chart/engine.ts). The SDK never draws itself; it only translates.
 *
 * Browser-only: construct it from client code (createChart guards against SSR).
 */
import { ChartEngine, type ChartData, type EngineTheme, type PaneSpec, type PlotSeries } from "../../components/chart/engine.ts";
import { withAlpha } from "../chart/geometry.ts";
import type { AxisBar, Change } from "./store.ts";
import type {
  AreaSeriesOptions,
  CandlestickSeriesOptions,
  ChartOptions,
  ChartSeriesType,
  HistogramSeriesOptions,
  LineSeriesOptions,
  SeriesOptionsMap,
} from "./types.ts";

/** Everything the renderer needs; arrays are shared with the store and mutated in place on ticks. */
export type RenderModel = {
  times: number[];
  bars: AxisBar[];
  intraday: boolean;
  candle: CandlestickSeriesOptions | null;
  series: { id: number; type: Exclude<ChartSeriesType, "candlestick">; values: number[]; options: SeriesOptionsMap[Exclude<ChartSeriesType, "candlestick">] }[];
};

/** Rendering backend used by the SDK core (the Canvas adapter in production, a fake in unit tests). */
export interface RenderAdapter {
  render(model: RenderModel, change: Change): void;
  setOptions(options: ChartOptions): void;
  onCrosshair(cb: (index: number | null, time: number | null, price: number | null) => void): void;
  /** Fractional bar indices of the viewport, or null without data. */
  getViewRange(): { from: number; to: number } | null;
  setViewRange(from: number, to: number): void;
  fit(): void;
  scrollToEnd(): void;
  scrollBy(bars: number): void;
  zoom(factor: number): void;
  resize(width: number, height: number): void;
  destroy(): void;
  /** Optional: duration of the last redraw in ms. */
  lastDrawMs?(): number;
}

export const THEMES: Record<"dark" | "light", Partial<EngineTheme>> = {
  dark: {
    bg: "#0b0f17", grid: "rgba(255,255,255,0.05)", axis: "rgba(255,255,255,0.12)", text: "#8b95a7", strong: "#e5e9f0",
    up: "#22c55e", down: "#ef4444", cross: "rgba(196,203,216,0.45)", tag: "#334155", tagText: "#ffffff", line: "#e5e9f0",
    draw: "#f5c451", select: "#38bdf8", level: "rgba(226,232,240,0.22)", zero: "rgba(226,232,240,0.35)", future: "rgba(255,255,255,0.018)",
  },
  light: {
    bg: "#ffffff", grid: "rgba(15,23,42,0.06)", axis: "rgba(15,23,42,0.14)", text: "#64748b", strong: "#0f172a",
    up: "#16a34a", down: "#dc2626", cross: "rgba(15,23,42,0.45)", tag: "#334155", tagText: "#ffffff", line: "#0f172a",
    draw: "#b45309", select: "#0284c7", level: "rgba(15,23,42,0.28)", zero: "rgba(15,23,42,0.4)", future: "rgba(15,23,42,0.025)",
  },
};

const DEFAULT_LINE = "#2962ff";

export class CanvasAdapter implements RenderAdapter {
  private wrapper: HTMLDivElement;
  private engine: ChartEngine;
  private data: ChartData | null = null;
  private crosshairCb: ((index: number | null, time: number | null, price: number | null) => void) | null = null;
  private theme: "dark" | "light" = "dark";
  private destroyed = false;

  constructor(container: HTMLElement, options: ChartOptions) {
    // One wrapper per chart: removing it removes the canvas and nothing else in the container.
    this.wrapper = container.ownerDocument.createElement("div");
    this.wrapper.dataset.xchart = "";
    Object.assign(this.wrapper.style, { position: "relative", overflow: "hidden" });
    this.applySize(options);
    container.appendChild(this.wrapper);
    this.engine = new ChartEngine(this.wrapper, {
      onCrosshair: (c) => this.crosshairCb?.(c ? c.index : null, c?.time ?? null, c?.price ?? null),
    });
    this.setOptions(options);
  }

  private applySize(o: ChartOptions) {
    if (o.autoSize === false && o.width && o.height) {
      Object.assign(this.wrapper.style, { width: `${o.width}px`, height: `${o.height}px` });
    } else {
      Object.assign(this.wrapper.style, { width: "100%", height: "100%" });
    }
  }

  setOptions(o: ChartOptions) {
    if (o.theme) this.theme = o.theme;
    if (o.autoSize !== undefined || o.width || o.height) this.applySize(o);
    this.engine.setOptions({
      theme: THEMES[this.theme],
      crosshair: o.crosshair ?? true,
      pricePrecision: o.priceScale?.precision,
      utcOffsetSeconds: o.utcOffsetMinutes !== undefined ? o.utcOffsetMinutes * 60 : undefined,
    });
    if (o.priceScale?.mode) this.engine.setScale({ log: o.priceScale.mode === "logarithmic" });
    if (o.priceScale?.autoScale !== undefined) this.engine.setScale({ auto: o.priceScale.autoScale });
  }

  render(model: RenderModel, change: Change) {
    if (this.destroyed) return;
    if (change.kind === "tick" && this.data && this.data.bars === model.bars) {
      // Arrays were mutated in place: just redraw (scheduled on the next animation frame).
      this.engine.refresh(change.appended);
      return;
    }
    const first = !this.data || this.data.bars.length === 0;
    this.data = this.toChartData(model);
    this.engine.setData(this.data, !first);
  }

  private toChartData(m: RenderModel): ChartData {
    const overlays: PlotSeries[] = [];
    const panes: PaneSpec[] = [];
    const th = THEMES[this.theme];
    for (const s of m.series) {
      const ps = this.plot(s.type, s.values, s.options, th);
      const pane = (s.options as LineSeriesOptions | HistogramSeriesOptions).pane ?? (s.type === "histogram" ? "separate" : "main");
      if (pane === "main") overlays.push(ps);
      else panes.push({ id: `xs-${s.id}`, title: ps.label, series: [ps], levels: s.type === "histogram" ? [0] : undefined });
    }
    const c = m.candle;
    return {
      bars: m.bars,
      type: "candles",
      overlays,
      panes,
      intraday: m.intraday,
      future: 0,
      candle: c ? { up: c.upColor, down: c.downColor, wickUp: c.wickUpColor ?? c.upColor, wickDown: c.wickDownColor ?? c.downColor } : undefined,
    };
  }

  private plot(type: Exclude<ChartSeriesType, "candlestick">, values: number[], o: SeriesOptionsMap[typeof type], th: Partial<EngineTheme>): PlotSeries {
    if (type === "histogram") {
      const h = o as HistogramSeriesOptions;
      const op = h.opacity ?? 0.8;
      const up = h.upColor ?? th.up ?? "#22c55e";
      const down = h.downColor ?? th.down ?? "#ef4444";
      const mode = h.colorMode ?? "sign";
      return {
        label: h.title ?? "Histogram",
        values,
        color: withAlpha(h.color ?? up, op),
        style: "histogram",
        precision: h.precision,
        scaleLabel: false,
        hist: mode === "single" ? undefined : { mode, colors: [withAlpha(up, op), withAlpha(down, op)] },
      };
    }
    const l = o as AreaSeriesOptions;
    const color = l.color ?? DEFAULT_LINE;
    return {
      label: l.title ?? (type === "area" ? "Area" : "Line"),
      values,
      color,
      width: l.lineWidth ?? 2,
      dash: l.lineStyle,
      precision: l.precision,
      scaleLabel: l.lastValueVisible !== false,
      area: type === "area" ? { top: l.topColor ?? withAlpha(color, 0.35), bottom: l.bottomColor ?? withAlpha(color, 0), baseline: l.baseline } : undefined,
    };
  }

  onCrosshair(cb: (index: number | null, time: number | null, price: number | null) => void) {
    this.crosshairCb = cb;
  }

  getViewRange() {
    if (!this.data || !this.data.bars.length) return null;
    return this.engine.getViewRange();
  }
  setViewRange(from: number, to: number) {
    this.engine.setViewRange(from, to);
  }
  fit() {
    this.engine.fit();
  }
  scrollToEnd() {
    this.engine.scrollToEnd();
  }
  scrollBy(bars: number) {
    this.engine.scrollBy(bars);
  }
  zoom(factor: number) {
    this.engine.zoom(factor);
  }
  resize(width: number, height: number) {
    Object.assign(this.wrapper.style, { width: `${width}px`, height: `${height}px` });
  }

  /** Last redraw time in ms (benchmarks). */
  lastDrawMs(): number {
    return this.engine.lastDrawMs;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.crosshairCb = null;
    this.engine.destroy();
    this.wrapper.remove();
    this.data = null;
  }
}
