/**
 * XChart SDK — public entry point (future package: `@tradestxpro/xchart`).
 *
 * Application → XChart SDK (this module) → Canvas adapter → TradestXPro ChartEngine.
 * Framework-independent: no React or Next.js imports. Safe to import during SSR;
 * `createChart` itself must run in the browser.
 */
export { createChart, createChartWithAdapter } from "./create-chart.ts";
export type { RenderAdapter, RenderModel } from "./canvas-adapter.ts";
export type {
  ChartApi, ChartOptions, ChartSeriesType, ChartTheme, ChartTime, PriceScaleMode, PriceScaleOptions,
  CandlestickData, SingleValueData, SeriesData, SeriesApi, SeriesOptions, SeriesOptionsMap, SeriesPane,
  CandlestickSeriesOptions, LineSeriesOptions, AreaSeriesOptions, HistogramSeriesOptions,
  CrosshairEvent, VisibleTimeRange, Unsubscribe,
} from "./types.ts";
export { XChartError, validateBar, validateBars, validateRange, validateUpdate, validateSeriesOptions } from "./validation.ts";
export { fromTradestxproBars, loadTradestxproCandles, type TradestxproBar } from "./market-data.ts";
export const XCHART_VERSION = "0.2.0";
