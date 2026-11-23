/** XChart SDK public contracts and data-validation utilities.
 * Phase 1 of the SDK: framework-neutral contracts. The Canvas adapter will be
 * implemented after Claude's independent chart-renderer changes are integrated.
 */
export type {
  ChartApi, ChartOptions, ChartSeriesType, ChartTheme, ChartTime,
  CandlestickData, SingleValueData, SeriesData, SeriesApi, SeriesOptions,
  CrosshairEvent, VisibleTimeRange, Unsubscribe,
} from "./types";
export { validateBar, validateBars, validateRange } from "./validation";
