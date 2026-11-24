/**
 * Canvas adapter: renders the SDK's data model with TradestXPro's existing ChartEngine
 * (components/chart/engine.ts). The SDK never draws itself; it only translates.
 *
 * Browser-only: construct it from client code (createChart guards against SSR).
 */
import { ChartEngine, type ChartData, type ChartType as EngineChartType, type MainStyle, type ScaleSpec, type EngineLayer, type EngineTheme, type InteractionDelegate, type PaneBox, type PaneSpec, type PlotSeries, type PointerInfo } from "../../components/chart/engine.ts";
import { withAlpha } from "../chart/geometry.ts";
import type { AxisBar, Change } from "./store.ts";
import type {
  AreaSeriesOptions,
  CandlestickSeriesOptions,
  CloudSeriesOptions,
  ChartOptions,
  ChartSeriesType,
  HistogramSeriesOptions,
  SeriesOptionsMap,
} from "./types.ts";

/** Everything the renderer needs; arrays are shared with the store and mutated in place on ticks. */
export type RenderModel = {
  times: number[];
  bars: AxisBar[];
  intraday: boolean;
  candle: CandlestickSeriesOptions | null;
  /** Follow appended bars when the newest bar is in view (ChartOptions.followLatest). */
  followLatest?: boolean;
  series: { id: number; type: Exclude<ChartSeriesType, "candlestick">; values: number[]; values2?: number[]; options: SeriesOptionsMap[Exclude<ChartSeriesType, "candlestick">] }[];
  /** Plots computed by sub-systems (indicators): overlays on the main pane and extra panes. */
  extraOverlays?: PlotSeries[];
  extraPanes?: PaneSpec[];
  /** Slots past the last bar that projected values extend into. */
  future?: number;
  /** v0.3: price-scale settings, pane slot heights (px), collapsed panes and pane order. */
  scales?: ScaleSpec[];
  paneSizes?: Record<string, number>;
  collapsed?: string[];
  paneOrder?: string[];
  /** v0.3: main draw type, its style, and the real last/previous close when `bars` is a display transform. */
  chartType?: EngineChartType;
  mainStyle?: MainStyle;
  lastPrice?: { price: number; prev: number | null };
};

/** Engine pane id of a series: "main", its own "xs-<id>" pane, or a shared named pane. */
export function seriesPaneId(id: number, type: ChartSeriesType, o: { pane?: string }): string {
  if (type === "candlestick") return "main";
  const pane = o.pane ?? (type === "histogram" ? "separate" : "main");
  return pane === "main" ? "main" : pane === "separate" ? `xs-${id}` : pane;
}

export type AdapterEvents = {
  click?(p: PointerInfo): void;
  dblClick?(p: PointerInfo): void;
  view?(v: { from: number; to: number; spacing: number }): void;
  beforeDraw?(): void;
  paneResize?(sizes: Record<string, number>): void;
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
  // ---- v0.3 extension points (optional so v0.2.1 custom adapters keep compiling) ----
  setLayers?(layers: EngineLayer[]): void;
  setInteraction?(d: InteractionDelegate | null): void;
  setEvents?(e: AdapterEvents): void;
  setCrosshair?(c: { index: number; price: number | null } | null): void;
  requestRedraw?(): void;
  xOfIndex?(i: number): number;
  indexOfX?(x: number): number;
  priceToY?(p: number, paneId?: string): number | null;
  yToPrice?(y: number, paneId?: string): number | null;
  getPanes?(): PaneBox[];
  getSpacing?(): number;
  setSpacing?(px: number): void;
  getPlotWidth?(): number;
  toDataURL?(scale?: number): string;
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

/** Alpha channel of an rgba()/hex colour (1 when opaque or unknown). */
function alphaOf(c: string): number {
  const m = c.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)/);
  if (m) return Number(m[1]);
  const h = c.match(/^#[0-9a-f]{6}([0-9a-f]{2})$/i);
  return h ? parseInt(h[1], 16) / 255 : 1;
}

export class CanvasAdapter implements RenderAdapter {
  private wrapper: HTMLDivElement;
  private engine: ChartEngine;
  private colorCtx: CanvasRenderingContext2D | null = null;
  private events: AdapterEvents = {};
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
    try {
      this.engine = new ChartEngine(this.wrapper, {
        onCrosshair: (c) => this.crosshairCb?.(c ? c.index : null, c?.time ?? null, c?.price ?? null),
        onClick: (p) => this.events.click?.(p),
        onDblClick: (p) => this.events.dblClick?.(p),
        onView: (v) => this.events.view?.(v),
        onBeforeDraw: () => this.events.beforeDraw?.(),
        onPaneResize: (sz) => this.events.paneResize?.(sz),
      });
      this.setOptions(options);
    } catch (e) {
      // Partial initialisation: release whatever was created before rethrowing.
      try {
        (this as unknown as { engine?: ChartEngine }).engine?.destroy();
      } catch {}
      this.wrapper.remove();
      this.destroyed = true;
      throw e;
    }
  }

  /**
   * Any CSS colour → "#rrggbb" / "rgba(...)" (the browser's own parser), so opacity can be applied
   * to named and hsl() colours too.
   */
  private css(color: string): string {
    if (color.startsWith("#") || color.startsWith("rgb")) return color;
    try {
      this.colorCtx ??= this.wrapper.ownerDocument.createElement("canvas").getContext("2d");
      if (!this.colorCtx) return color;
      this.colorCtx.fillStyle = "#000000";
      this.colorCtx.fillStyle = color;
      return String(this.colorCtx.fillStyle);
    } catch {
      return color;
    }
  }
  private alpha(color: string, a: number) {
    return withAlpha(this.css(color), a);
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
      scaleMode: o.priceScale?.mode === "percentage" || o.priceScale?.mode === "indexed" ? o.priceScale.mode : "normal",
      timeFormatter: o.timeZone || o.locale ? timeFormatter(o.timeZone, o.locale, (o.utcOffsetMinutes ?? 330) * 60) : null,
    });
    if (o.priceScale?.mode) this.engine.setScale({ log: o.priceScale.mode === "logarithmic" });
    if (o.priceScale?.autoScale !== undefined) this.engine.setScale({ auto: o.priceScale.autoScale });
  }

  render(model: RenderModel, change: Change) {
    if (this.destroyed) return;
    const shifted = model.series.some((x) => x.type === "cloud" && (x.options as CloudSeriesOptions).displacement);
    if (change.kind === "tick" && this.data && this.data.bars === model.bars && !shifted) {
      // Arrays were mutated in place: refresh derived metadata, then redraw on the next frame.
      this.data.intraday = model.intraday;
      this.data.lastPrice = model.lastPrice;
      this.engine.refresh(model.followLatest ? change.appended : 0);
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
    let future = m.future ?? 0;
    for (const s of m.series) {
      const ps = s.type === "cloud" ? this.cloud(s.values, s.values2 ?? [], s.options as CloudSeriesOptions) : [this.plot(s.type, s.values, s.options, th, m.candle !== null)];
      if (s.type === "cloud") for (const p of ps) future = Math.max(future, p.values.length - m.bars.length);
      const paneId = seriesPaneId(s.id, s.type, s.options as { pane?: string });
      if (paneId === "main") {
        const scale = (s.options as { priceScaleId?: string }).priceScaleId;
        overlays.push(...(scale && scale !== "right" ? ps.map((p) => ({ ...p, scale })) : ps));
      } else {
        const shared = panes.find((p) => p.id === paneId);
        if (shared) {
          shared.series.push(...ps);
          shared.title = `${shared.title} · ${ps[0].label}`;
          if (s.type === "histogram" && !shared.levels) shared.levels = [0];
        } else panes.push({ id: paneId, title: ps[0].label, series: ps, levels: s.type === "histogram" ? [0] : undefined });
      }
    }
    overlays.push(...(m.extraOverlays ?? []));
    panes.push(...(m.extraPanes ?? []));
    if (m.collapsed?.length) for (const p of panes) if (m.collapsed.includes(p.id)) p.collapsed = true;
    if (m.paneOrder?.length) {
      const rank = (id: string) => {
        const k = m.paneOrder!.indexOf(id);
        return k < 0 ? Number.MAX_SAFE_INTEGER : k;
      };
      panes.sort((a, b) => rank(a.id) - rank(b.id));
    }
    const c = m.candle;
    return {
      bars: m.bars,
      type: m.chartType ?? "candles",
      mainStyle: m.mainStyle,
      lastPrice: m.lastPrice,
      overlays,
      panes,
      intraday: m.intraday,
      future,
      scales: m.scales,
      paneSizes: m.paneSizes,
      candle: c ? { up: c.upColor, down: c.downColor, wickUp: c.wickUpColor ?? c.upColor, wickDown: c.wickDownColor ?? c.downColor } : undefined,
    };
  }

  /**
   * Cloud: upper and lower boundary lines plus a fill that switches colour exactly where they
   * cross (Phase 1 fill renderer). `displacement` shifts the drawing by whole bars; values shifted
   * past the last bar occupy projection space and never create candles.
   */
  private cloud(upper: number[], lower: number[], o: CloudSeriesOptions): PlotSeries[] {
    const d = o.displacement ?? 0;
    const shift = (a: number[]) => {
      if (!d) return a;
      const out = new Array<number>(Math.max(0, a.length + d)).fill(NaN);
      for (let i = 0; i < a.length; i++) if (i + d >= 0) out[i + d] = a[i];
      return out;
    };
    const u = shift(upper);
    const l = shift(lower);
    const op = o.opacity ?? 1;
    const up = this.alpha(o.upColor ?? "rgba(34,197,94,0.22)", op * alphaOf(this.css(o.upColor ?? "rgba(34,197,94,0.22)")));
    const down = this.alpha(o.downColor ?? "rgba(239,68,68,0.22)", op * alphaOf(this.css(o.downColor ?? "rgba(239,68,68,0.22)")));
    const lines = o.lineVisible !== false;
    const base = { width: o.lineWidth ?? 1, dash: o.lineStyle, precision: o.precision, opacity: lines ? 1 : 0, scaleLabel: lines && o.lastValueVisible !== false };
    return [
      { ...base, label: `${o.title ?? "Cloud"} upper`, values: u, color: this.css(o.upperColor ?? "#22c55e"), fills: [{ other: l, up, down }] },
      { ...base, label: `${o.title ?? "Cloud"} lower`, values: l, color: this.css(o.lowerColor ?? "#ef4444") },
    ];
  }

  private plot(type: Exclude<ChartSeriesType, "candlestick">, values: number[], o: SeriesOptionsMap[typeof type], th: Partial<EngineTheme>, hasCandles: boolean): PlotSeries {
    if (type === "histogram") {
      const h = o as HistogramSeriesOptions;
      const op = h.opacity ?? 0.8;
      const up = h.upColor ?? th.up ?? "#22c55e";
      const down = h.downColor ?? th.down ?? "#ef4444";
      // "candle" colouring needs candles; if the candlestick series was removed, colour by sign instead.
      const mode = h.colorMode === "candle" && !hasCandles ? "sign" : h.colorMode ?? "sign";
      return {
        label: h.title ?? "Histogram",
        values,
        color: this.alpha(h.color ?? up, op),
        style: "histogram",
        precision: h.precision,
        scaleLabel: false,
        hist: mode === "single" ? undefined : { mode, colors: [this.alpha(up, op), this.alpha(down, op)] },
      };
    }
    const l = o as AreaSeriesOptions;
    const color = this.css(l.color ?? DEFAULT_LINE);
    return {
      label: l.title ?? (type === "area" ? "Area" : "Line"),
      values,
      color,
      width: l.lineWidth ?? 2,
      dash: l.lineStyle,
      precision: l.precision,
      scaleLabel: l.lastValueVisible !== false,
      area: type === "area" ? { top: l.topColor ? this.css(l.topColor) : withAlpha(color, 0.35), bottom: l.bottomColor ? this.css(l.bottomColor) : withAlpha(color, 0), baseline: l.baseline } : undefined,
    };
  }

  // ---- v0.3 extension points ----
  setLayers(layers: EngineLayer[]) {
    if (!this.destroyed) this.engine.setLayers(layers);
  }
  setInteraction(d: InteractionDelegate | null) {
    if (!this.destroyed) this.engine.setInteraction(d);
  }
  setEvents(e: AdapterEvents) {
    this.events = e;
  }
  setCrosshair(c: { index: number; price: number | null } | null) {
    if (!this.destroyed) this.engine.setCrosshair(c);
  }
  requestRedraw() {
    if (!this.destroyed) this.engine.requestRedraw();
  }
  xOfIndex(i: number) {
    return this.engine.xOfIndex(i);
  }
  indexOfX(x: number) {
    return this.engine.indexOfX(x);
  }
  priceToY(p: number, paneId = "main") {
    return this.engine.priceToY(p, paneId);
  }
  yToPrice(y: number, paneId = "main") {
    return this.engine.yToPrice(y, paneId);
  }
  getPanes() {
    return this.engine.getPanes();
  }
  getSpacing() {
    return this.engine.getSpacing();
  }
  setSpacing(px: number) {
    this.engine.setSpacing(px);
  }
  getPlotWidth() {
    return this.engine.getPlotWidth();
  }
  toDataURL(scale?: number) {
    return this.engine.toDataURL(scale);
  }

  onCrosshair(cb: (index: number | null, time: number | null, price: number | null) => void) {
    this.crosshairCb = cb;
  }

  getViewRange() {
    if (this.destroyed || !this.data || !this.data.bars.length) return null;
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
    try {
      this.engine.destroy();
    } finally {
      this.wrapper.remove();
      this.data = null;
      this.colorCtx = null;
      this.events = {};
    }
  }
}

/** Time labels in an IANA time zone / locale. Daily bars are calendar dates (00:00 UTC), so they are formatted in UTC. */
export function timeFormatter(timeZone?: string, locale = "en-GB", fixedOffsetSeconds = 19800) {
  // Without a zone, intraday labels use the fixed offset (formatted as UTC after shifting).
  const tz = timeZone ?? "UTC";
  const shift = timeZone ? 0 : fixedOffsetSeconds;
  const f = {
    hm: new Intl.DateTimeFormat(locale, { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    dhm: new Intl.DateTimeFormat(locale, { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    d: new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short" }),
    dy: new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }),
  };
  return (t: number, intraday: boolean, long: boolean): string => {
    const d = new Date(t * 1000);
    if (!intraday) return (long ? f.dy : f.d).format(d);
    return (long ? f.dhm : f.hm).format(new Date((t + shift) * 1000));
  };
}
