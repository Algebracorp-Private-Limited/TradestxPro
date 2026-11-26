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
  CrosshairEvent, VisibleTimeRange, Unsubscribe, CloudData, CloudSeriesOptions,
} from "./types.ts";
// v0.3 — indicators, drawings, markers, price lines, events
export { BUILTIN_INDICATORS } from "./indicators/builtins.ts";
export { IndicatorRegistry } from "./indicators/registry.ts";
export { ALL_BUILTIN_INDICATORS, NATIVE_INDICATORS, builtinRegistry, defaultRegistry, registerIndicator, unregisterIndicator, listIndicators, getIndicatorDefinition } from "./indicators/index.ts";
export type { CatalogMeta, Category as IndicatorCategory, NativeDefinition } from "./indicators/native/index.ts";
export type { IndicatorApi, IndicatorDefinition, IndicatorInput, IndicatorOptions, IndicatorParams, IndicatorPoint, IndicatorResult, IndicatorSource, OutputDef, ParamSchema } from "./indicators/types.ts";
export { DRAWING_TYPES } from "./drawings/types.ts";
export type { DrawingApi, DrawingData, DrawingEvent, DrawingPoint, DrawingSpec, DrawingStyle, DrawingType } from "./drawings/types.ts";
export * as drawingGeometry from "./drawings/geometry.ts";
export type { MarkerPosition, MarkerShape, PriceLineApi, PriceLineOptions, PriceLineSource, SeriesMarker } from "./decorations.ts";
export { Emitter } from "./events/emitter.ts";
// v0.3 — scales, panes, synchronisation, calendars
export type { PaneApi, PriceScaleApi, PriceScaleSettings } from "./types.ts";
export type { SessionHighlightOptions } from "./create-chart.ts";
export { syncCharts, type SyncGroup, type SyncOptions } from "./sync.ts";
export { CALENDARS, TradingCalendar, holidayList, offsetSeconds, zonedTime, type CalendarDef, type CalendarId, type HolidayProvider, type SessionDef, type SessionKind, type SessionState } from "./calendar/index.ts";
export { isTimeZone } from "./validation.ts";
// v0.3 — chart types, layouts, plugins
export { PRICE_CHART_TYPES, TIME_CHART_TYPES, heikinAshi, kagi, lineBreak, pointAndFigure, rangeBars, renko, type Brick, type BreakLine, type ChartType, type ChartTypeStyle, type KagiLine, type PnfColumn, type PriceChartType, type RangeBar } from "./chart-types.ts";
export { LAYOUT_FORMAT, LAYOUT_VERSION, parseLayout, type ChartLayout, type LayoutLoadOptions, type LayoutLoadReport } from "./layout.ts";
export type { PluginContext, PluginInfo, PluginLayer, XChartPlugin } from "./plugins.ts";
export type { ToolEnv, ToolSpec } from "./drawings/tools.ts";
export type { LayerApi } from "../../components/chart/engine.ts";
// v0.3.1 — price-based chart types (derived data model)
export { DERIVED_KINDS, DerivedSeriesEngine, PATH_ASSUMPTION, computeDerived, resolveSettings as resolveDerivedSettings } from "./derived/index.ts";
export type { DerivedKind, DerivedPoint, DerivedSeries, DerivedSettings, DerivedStatus, KagiSettings, LineBreakSettings, PnfSettings, PriceSource, RangeBarSettings, RenkoSettings, SizeMethod, SourceCandle } from "./derived/types.ts";
export type { DrawingDomain } from "./drawings/types.ts";
// v0.3.1 — incremental indicator engine and workers
export * as kernels from "./indicators/incremental.ts";
export { StreamGraph, type GraphStats, type StreamInput } from "./indicators/dependencies.ts";
export { Checkpoints } from "./indicators/checkpoints.ts";
export { FrameScheduler } from "./indicators/scheduler.ts";
export type { StreamOutput, StreamSpec } from "./indicators/types.ts";
export { IndicatorWorkerClient, StaleResultError, CancelledError, type IndicatorResultSet, type WorkerClientOptions } from "./workers/worker-client.ts";
export { PROTOCOL_VERSION, validateRequest as validateWorkerRequest, validateResponse as validateWorkerResponse } from "./workers/protocol.ts";
export type { ChartEvents, ChartEventType, PointerPayload } from "./events/types.ts";
export { XChartError, isCssColor, validateBar, validateBars, validateChartOptions, validateRange, validateSeriesOptions, validateUpdate, validateZoom } from "./validation.ts";
export {
  MarketDataError, fromTradestxproBars, loadTradestxproCandles, validateTradestxproBars,
  type MarketDataOptions, type Rejection, type RejectionReason, type TradestxproBar, type ValidationMode, type ValidationReport,
} from "./market-data.ts";
export const XCHART_VERSION = "0.3.1";
