/**
 * Public, framework-independent XChart SDK contracts (v0.2).
 *
 * Canonical time: every `time` is a UTC Unix timestamp in whole SECONDS.
 * Daily (or longer) bars use 00:00:00 UTC of the trading date, which is how TradestXPro's
 * end-of-day data is stored; intraday bars use the actual bar-open instant.
 */
export type ChartTime = number;
export type ChartTheme = "dark" | "light";
export type ChartSeriesType = "candlestick" | "line" | "area" | "histogram";
export type PriceScaleMode = "normal" | "logarithmic";

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
  /** Offset used for intraday time labels, in minutes east of UTC (default 330 = IST). */
  utcOffsetMinutes?: number;
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
export type SeriesData<T extends ChartSeriesType> = T extends "candlestick" ? CandlestickData : SingleValueData;

/** Where a series is drawn: the main price pane or its own pane below it. */
export type SeriesPane = "main" | "separate";

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
  precision?: number;
  title?: string;
}
export type SeriesOptionsMap = {
  candlestick: CandlestickSeriesOptions;
  line: LineSeriesOptions;
  area: AreaSeriesOptions;
  histogram: HistogramSeriesOptions;
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
}
