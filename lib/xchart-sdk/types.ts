/** Public, framework-independent XChart SDK contracts (v0.1). */
export type ChartTime = number; // Unix timestamp in seconds
export type ChartTheme = "dark" | "light";
export type ChartSeriesType = "candlestick" | "line" | "area" | "histogram";
export interface ChartOptions {
  theme?: ChartTheme;
  autoSize?: boolean;
  crosshair?: boolean;
}
export interface TimeValue { time: ChartTime }
export interface CandlestickData extends TimeValue {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}
export interface SingleValueData extends TimeValue { value: number }
export type SeriesData<T extends ChartSeriesType> = T extends "candlestick" ? CandlestickData : SingleValueData;
export interface SeriesOptions {
  color?: string;
  upColor?: string;
  downColor?: string;
  lineWidth?: number;
}
export interface VisibleTimeRange { from: ChartTime; to: ChartTime }
export interface CrosshairEvent {
  time: ChartTime | null;
  price: number | null;
}
export type Unsubscribe = () => void;
export interface SeriesApi<T extends ChartSeriesType> {
  readonly type: T;
  setData(data: ReadonlyArray<SeriesData<T>>): void;
  update(bar: SeriesData<T>): void;
  data(): ReadonlyArray<SeriesData<T>>;
  applyOptions(options: Partial<SeriesOptions>): void;
  remove(): void;
}
export interface ChartApi {
  addCandlestickSeries(options?: SeriesOptions): SeriesApi<"candlestick">;
  addLineSeries(options?: SeriesOptions): SeriesApi<"line">;
  addAreaSeries(options?: SeriesOptions): SeriesApi<"area">;
  addHistogramSeries(options?: SeriesOptions): SeriesApi<"histogram">;
  subscribeCrosshairMove(handler: (event: CrosshairEvent) => void): Unsubscribe;
  setVisibleRange(range: VisibleTimeRange): void;
  getVisibleRange(): VisibleTimeRange | null;
  remove(): void;
}
