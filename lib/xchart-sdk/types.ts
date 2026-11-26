import type { IndicatorApi, IndicatorDefinition } from "./indicators/types.ts";
import type { DrawingApi, DrawingData, DrawingEvent, DrawingSpec, DrawingType } from "./drawings/types.ts";
import type { PriceLineApi, PriceLineOptions, SeriesMarker } from "./decorations.ts";
import type { ChartEvents } from "./events/types.ts";
/**
 * Public, framework-independent XChart SDK contracts (v0.2).
 *
 * Canonical time: every `time` is a UTC Unix timestamp in whole SECONDS.
 * Daily (or longer) bars use 00:00:00 UTC of the trading date, which is how TradestXPro's
 * end-of-day data is stored; intraday bars use the actual bar-open instant.
 */
export type ChartTime = number;
export type ChartTheme = "dark" | "light";
export type ChartSeriesType = "candlestick" | "line" | "area" | "histogram" | "cloud";
/** "percentage" / "indexed" are relative to the first visible bar (indexed: first visible = 100). Display transforms only: data is never changed. */
export type PriceScaleMode = "normal" | "logarithmic" | "percentage" | "indexed";

export interface PriceScaleOptions {
  /** "logarithmic" applies to the main price pane. */
  mode?: PriceScaleMode;
  /** Fit the price axis to the visible data (default true). */
  autoScale?: boolean;
  /** Fixed decimal places for price-axis labels; omit for automatic. */
  precision?: number;
}

export interface ChartOptions {
  theme?: ChartTheme;
  /** Follow the container's size (default true). When false, `width`/`height` are used. */
  autoSize?: boolean;
  width?: number;
  height?: number;
  /** Draw the crosshair (default true). Crosshair events fire either way. */
  crosshair?: boolean;
  priceScale?: PriceScaleOptions;
  /** Offset used for intraday time labels, in minutes east of UTC (default 330 = IST). Ignored when `timeZone` is set. */
  utcOffsetMinutes?: number;
  /** v0.3: IANA time zone for time labels (daylight saving handled), e.g. "America/New_York". */
  timeZone?: string;
  /** v0.3: BCP 47 locale for time labels (default "en-GB"). */
  locale?: string;
  /**
   * Keep the newest bar in view when live updates append bars (default false: the viewport stays
   * where the user left it). Only follows when the newest bar was already visible.
   */
  followLatest?: boolean;
}

export interface TimeValue {
  time: ChartTime;
}
export interface CandlestickData extends TimeValue {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}
export interface SingleValueData extends TimeValue {
  value: number;
}
/** Two boundaries at one time (cloud / band series). `upper` may fall below `lower` (a crossing). */
export interface CloudData extends TimeValue {
  upper: number;
  lower: number;
}
export type SeriesData<T extends ChartSeriesType> = T extends "candlestick" ? CandlestickData : T extends "cloud" ? CloudData : SingleValueData;

/** Where a series is drawn: the main price pane or its own pane below it. */
/** Where a series is drawn: the main pane, its own pane ("separate"), or a named pane shared with other series. */
export type SeriesPane = "main" | "separate" | (string & {});

export interface CandlestickSeriesOptions {
  upColor?: string;
  downColor?: string;
  wickUpColor?: string;
  wickDownColor?: string;
}
export interface LineSeriesOptions {
  color?: string;
  lineWidth?: number;
  lineStyle?: "solid" | "dashed" | "dotted";
  pane?: SeriesPane;
  /** v0.3 (main pane): "right" (default, the main scale), "left", or an overlay scale id with its own range. */
  priceScaleId?: string;
  /** Decimal places for this series' price label; omit for automatic. */
  precision?: number;
  /** Show the latest value on the price axis (default true). */
  lastValueVisible?: boolean;
  title?: string;
}
export interface AreaSeriesOptions extends LineSeriesOptions {
  topColor?: string;
  bottomColor?: string;
  /** Value the area fills down to; omit to fill to the bottom of the pane. */
  baseline?: number;
}
export interface HistogramSeriesOptions {
  /** Colour when `colorMode` is "single". */
  color?: string;
  /** Colours for values ≥ 0 / < 0 ("sign") or rising / falling candles ("candle"). */
  upColor?: string;
  downColor?: string;
  /** "sign" (default): by value sign. "candle": by the candlestick series' direction (volume). "single": one colour. */
  colorMode?: "sign" | "candle" | "single";
  /** 0–1, default 0.8. */
  opacity?: number;
  /** Default "separate" (own pane with a zero baseline). */
  pane?: SeriesPane;
  priceScaleId?: string;
  precision?: number;
  title?: string;
}
export interface CloudSeriesOptions {
  /** Fill where upper ≥ lower (default translucent green). */
  upColor?: string;
  /** Fill where upper < lower (default translucent red). */
  downColor?: string;
  /** Multiplies the fill colours' alpha (0–1, default 1). */
  opacity?: number;
  upperColor?: string;
  lowerColor?: string;
  /** Draw the boundary lines (default true). */
  lineVisible?: boolean;
  lineWidth?: number;
  lineStyle?: "solid" | "dashed" | "dotted";
  /** Shift the drawing by whole bars: positive = forward (projection space), negative = back. */
  displacement?: number;
  pane?: SeriesPane;
  priceScaleId?: string;
  precision?: number;
  lastValueVisible?: boolean;
  title?: string;
}
export type SeriesOptionsMap = {
  candlestick: CandlestickSeriesOptions;
  line: LineSeriesOptions;
  area: AreaSeriesOptions;
  histogram: HistogramSeriesOptions;
  cloud: CloudSeriesOptions;
};
/** @deprecated v0.1 name; use the per-type option interfaces. */
export type SeriesOptions = CandlestickSeriesOptions & LineSeriesOptions;

export interface VisibleTimeRange {
  from: ChartTime;
  to: ChartTime;
}

export interface CrosshairEvent {
  /** Time under the pointer (may be past the last bar), or null when the pointer left the chart. */
  time: ChartTime | null;
  /** Main-pane price under the pointer; null outside the main pane or when the pointer left. */
  price: number | null;
  /** Data of each series at `time` (series without a point there are absent). */
  seriesData: ReadonlyMap<SeriesApi<ChartSeriesType>, SeriesData<ChartSeriesType>>;
  /** v0.3: indicator output values at `time` (absent during warm-up or gaps). */
  indicators?: ReadonlyMap<IndicatorApi, Readonly<Record<string, number>>>;
  /** v0.3: true when `time` lies after the last real candle (projected indicator space, not market data). */
  projected?: boolean;
  /** v0.3: the drawn (transformed) candle when the chart type is a display transform such as Heikin Ashi; `seriesData` keeps the real OHLC. */
  display?: { open: number; high: number; low: number; close: number };
  /** v0.3.1: on price-based chart types, the derived point under the pointer. `seriesData` then holds the ORIGINAL source candle (the observed market price); derived values are chart constructs, never executable prices. */
  derived?: import("./derived/types.ts").DerivedPoint;
}

export type PriceScaleSettings = {
  /** Independent per scale (right, left, overlay and pane scales). Percentage / indexed are relative to the first visible value of the scale's first series. */
  mode?: "normal" | "logarithmic" | "percentage" | "indexed";
  /** false needs a manual `range` (except the main right scale, which keeps its dragged range). */
  autoScale?: boolean;
  /** Manual range [min, max] in price units. */
  range?: [number, number];
  /** Fractions of the pane kept free above and below the data on this scale. */
  margins?: { top: number; bottom: number };
  /** "left" scale: show its axis labels (default true). */
  visible?: boolean;
  /** Higher values drawn lower. */
  invert?: boolean;
  /** Axis label decimals. */
  precision?: number;
  /** Labels rounded to multiples of this tick size. */
  minMove?: number;
  /** Custom axis label (receives the displayed value: % / indexed value in those modes). Not saved in layouts. */
  formatter?: (value: number) => string;
};
export interface PriceScaleApi {
  readonly id: string;
  readonly paneId: string;
  priceToCoordinate(price: number): number | null;
  coordinateToPrice(y: number): number | null;
  applyOptions(o: Partial<PriceScaleSettings>): void;
  options(): PriceScaleSettings;
  /** Series currently on this scale (main pane). */
  seriesCount(): number;
}
export interface PaneApi {
  readonly id: string;
  /** Current height in px (null before the first layout without explicit sizes). */
  height(): number | null;
  setHeight(px: number): void;
  collapse(): void;
  expand(): void;
  isCollapsed(): boolean;
  /** Position among the panes below the main pane (1 = directly below). */
  moveTo(index: number): void;
}


export type Unsubscribe = () => void;

export interface SeriesApi<T extends ChartSeriesType> {
  readonly type: T;
  /** Replaces all data. Must be sorted by strictly increasing time. */
  setData(data: ReadonlyArray<SeriesData<T>>): void;
  /** Real-time update: same time as the last point replaces it, a later time appends. Earlier times throw. */
  update(bar: SeriesData<T>): void;
  /** A copy of the series data. */
  data(): ReadonlyArray<SeriesData<T>>;
  applyOptions(options: Partial<SeriesOptionsMap[T]>): void;
  options(): Readonly<SeriesOptionsMap[T]>;
  remove(): void;
  // v0.3 — markers and price lines are view-only and never modify the series data.
  setMarkers(markers: ReadonlyArray<SeriesMarker>): void;
  addMarker(marker: SeriesMarker): string;
  removeMarker(id: string): boolean;
  getMarkers(): SeriesMarker[];
  clearMarkers(): void;
  createPriceLine(options: PriceLineOptions): PriceLineApi;
  priceLines(): PriceLineApi[];
  removePriceLine(line: PriceLineApi): void;
}

export interface ChartApi {
  addCandlestickSeries(options?: CandlestickSeriesOptions): SeriesApi<"candlestick">;
  addLineSeries(options?: LineSeriesOptions): SeriesApi<"line">;
  addAreaSeries(options?: AreaSeriesOptions): SeriesApi<"area">;
  addHistogramSeries(options?: HistogramSeriesOptions): SeriesApi<"histogram">;
  subscribeCrosshairMove(handler: (event: CrosshairEvent) => void): Unsubscribe;
  /** Moves the viewport so [from, to] spans the plot width. */
  setVisibleRange(range: VisibleTimeRange): void;
  /** Time range currently spanned by the viewport, or null when the chart has no data. */
  getVisibleRange(): VisibleTimeRange | null;
  /** Fits all data into view and re-enables price auto-scale. */
  fitContent(): void;
  /** Keeps the zoom level and scrolls so the newest bar is at the right edge. */
  scrollToRealTime(): void;
  /** Scrolls by a number of bars (positive = towards newer data). */
  scrollBy(bars: number): void;
  /** Zooms around the right edge (factor > 1 zooms in). */
  zoom(factor: number): void;
  applyOptions(options: Partial<ChartOptions>): void;
  options(): Readonly<ChartOptions>;
  /** Re-measures the container (only needed with autoSize: false after manual resizes). */
  resize(width: number, height: number): void;
  remove(): void;

  // ---------- v0.3 ----------
  addCloudSeries(options?: CloudSeriesOptions): SeriesApi<"cloud">;
  /** Typed events; returns an unsubscribe function. */
  on<K extends keyof ChartEvents>(type: K, handler: (payload: ChartEvents[K]) => void): Unsubscribe;
  once<K extends keyof ChartEvents>(type: K, handler: (payload: ChartEvents[K]) => void): Unsubscribe;
  off<K extends keyof ChartEvents>(type: K, handler: (payload: ChartEvents[K]) => void): boolean;
  subscribeClick(handler: (p: ChartEvents["click"]) => void): Unsubscribe;
  exportLayout(options?: { includeData?: boolean }): import("./layout.ts").ChartLayout;
  importLayout(layout: unknown, options?: import("./layout.ts").LayoutLoadOptions): import("./layout.ts").LayoutLoadReport;
  timeScale(): ReturnType<import("./create-chart.ts").ChartImpl["timeScale"]>;
  addIndicator(type: string, config?: Record<string, unknown>): IndicatorApi;
  setBenchmarkSeries(series: SeriesApi<ChartSeriesType> | null): void;
  searchIndicators(q?: { text?: string; category?: string; requires?: string; incremental?: boolean; param?: string }): IndicatorDefinition[];
  indicatorCompatibility(id: string): { ok: boolean; reasons: string[] };
  /** Incremental indicator engine diagnostics (shared nodes, committed bars, rebuilds, replays, last sync time). */
  indicatorEngineStats(): ReturnType<import("./create-chart.ts").ChartImpl["indicatorEngineStats"]>;
  /** Renderer diagnostics: full vs crosshair-only frames and their last durations (null if the renderer does not report them). */
  renderStats(): { fullFrames: number; overlayFrames: number; lastDrawMs: number; lastOverlayMs: number } | null;
  /** Duration of the renderer's last full redraw in ms (diagnostics), or null if not reported. */
  renderTimeMs(): number | null;
  getIndicators(): IndicatorApi[];
  removeIndicator(indicator: IndicatorApi | string): boolean;
  registerIndicator(definition: IndicatorDefinition): void;
  unregisterIndicator(id: string): boolean;
  listIndicators(): IndicatorDefinition[];
  getIndicatorDefinition(id: string): IndicatorDefinition | undefined;
  /** Canvas x (CSS px) of a time; null without data or renderer geometry. */
  timeToCoordinate(time: ChartTime): number | null;
  coordinateToTime(x: number): ChartTime | null;
  /** Canvas y (CSS px) of a price in a pane ("main" by default). */
  priceToCoordinate(price: number, paneId?: string, scaleId?: string): number | null;
  coordinateToPrice(y: number, paneId?: string, scaleId?: string): number | null;
  priceScale(id?: string, paneId?: string): PriceScaleApi;
  panes(): PaneApi[];
  pane(id: string): PaneApi | undefined;
  saveLayout(options?: { includeData?: boolean }): import("./layout.ts").ChartLayout;
  loadLayout(layout: unknown, options?: import("./layout.ts").LayoutLoadOptions): import("./layout.ts").LayoutLoadReport;
  use(plugin: import("./plugins.ts").XChartPlugin): void;
  removePlugin(id: string): boolean;
  plugins(): import("./plugins.ts").PluginInfo[];
  drawingTools(): string[];
  setChartType(type: import("./chart-types.ts").ChartType, style?: import("./chart-types.ts").ChartTypeStyle): void;
  getChartType(): { type: import("./chart-types.ts").ChartType; style: import("./chart-types.ts").ChartTypeStyle };
  getDerivedInfo(): ReturnType<import("./create-chart.ts").ChartImpl["getDerivedInfo"]>;
  getVisibleLogicalRange(): { from: number; to: number } | null;
  setVisibleLogicalRange(range: { from: number; to: number }): void;
  takeScreenshot(scale?: number): string;
  setSessionHighlight(options: import("./create-chart.ts").SessionHighlightOptions | null): void;
  setCrosshairPosition(time: ChartTime, price?: number | null): void;
  clearCrosshairPosition(): void;
  addDrawing(spec: DrawingSpec): DrawingApi;
  getDrawing(id: string): DrawingApi | undefined;
  getDrawings(): DrawingApi[];
  removeDrawing(drawing: DrawingApi | string): boolean;
  clearDrawings(): void;
  duplicateDrawing(id: string): DrawingApi | undefined;
  selectDrawing(id: string | null): void;
  selectedDrawing(): string | null;
  setDrawingTool(tool: DrawingType | (string & {}) | null): void;
  getDrawingTool(): DrawingType | null;
  setDrawingSnap(on: boolean): void;
  undoDrawing(): boolean;
  redoDrawing(): boolean;
  serializeDrawings(): DrawingData[];
  loadDrawings(data: unknown): void;
  subscribeDrawingEvents(handler: (e: DrawingEvent) => void): Unsubscribe;
}
