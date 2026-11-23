/**
 * XChart public API: createChart() → ChartApi → SeriesApi.
 * Data lives in SeriesStore; drawing is delegated to a RenderAdapter (the Canvas adapter in browsers).
 */
import { SeriesStore, type Change } from "./store.ts";
import { CanvasAdapter, type RenderAdapter, type RenderModel } from "./canvas-adapter.ts";
import { XChartError, validateRange, validateSeriesOptions } from "./validation.ts";
import type {
  AreaSeriesOptions,
  CandlestickSeriesOptions,
  ChartApi,
  ChartOptions,
  ChartSeriesType,
  CrosshairEvent,
  HistogramSeriesOptions,
  LineSeriesOptions,
  SeriesApi,
  SeriesData,
  SeriesOptionsMap,
  Unsubscribe,
  VisibleTimeRange,
} from "./types.ts";

const DEFAULTS: ChartOptions = { theme: "dark", autoSize: true, crosshair: true };

type AnySeries = SeriesImpl<ChartSeriesType>;

class SeriesImpl<T extends ChartSeriesType> implements SeriesApi<T> {
  readonly type: T;
  readonly id: number;
  private chart: ChartImpl;
  private opts: SeriesOptionsMap[T];
  constructor(type: T, id: number, chart: ChartImpl, options: SeriesOptionsMap[T]) {
    this.type = type;
    this.id = id;
    this.chart = chart;
    this.opts = { ...options };
  }
  setData(data: ReadonlyArray<SeriesData<T>>): void {
    this.chart.mutate((s) => s.setData(this.id, data));
  }
  update(bar: SeriesData<T>): void {
    this.chart.mutate((s) => s.update(this.id, bar));
  }
  data(): ReadonlyArray<SeriesData<T>> {
    return this.chart.pointsOf(this.id) as SeriesData<T>[];
  }
  applyOptions(options: Partial<SeriesOptionsMap[T]>): void {
    this.chart.checkOptions(this.type, options);
    this.opts = { ...this.opts, ...options };
    this.chart.redraw();
  }
  options(): Readonly<SeriesOptionsMap[T]> {
    return { ...this.opts };
  }
  remove(): void {
    this.chart.removeSeries(this);
  }
}

export class ChartImpl implements ChartApi {
  private store = new SeriesStore();
  private seriesById = new Map<number, AnySeries>();
  private subs = new Set<(e: CrosshairEvent) => void>();
  private opts: ChartOptions;
  private removed = false;
  // Start as "pointer outside" so no leave event fires before the pointer ever entered.
  private lastEvent = "none";

  private adapter: RenderAdapter;
  private onRemove?: () => void;

  constructor(adapter: RenderAdapter, options: ChartOptions = {}, onRemove?: () => void) {
    this.adapter = adapter;
    this.onRemove = onRemove;
    this.opts = { ...DEFAULTS, ...options, priceScale: { ...options.priceScale } };
    adapter.onCrosshair((index, time, price) => this.emitCrosshair(index, time, price));
  }

  // ---------- series ----------
  addCandlestickSeries(options: CandlestickSeriesOptions = {}): SeriesApi<"candlestick"> {
    return this.add("candlestick", options);
  }
  addLineSeries(options: LineSeriesOptions = {}): SeriesApi<"line"> {
    return this.add("line", options);
  }
  addAreaSeries(options: AreaSeriesOptions = {}): SeriesApi<"area"> {
    return this.add("area", options);
  }
  addHistogramSeries(options: HistogramSeriesOptions = {}): SeriesApi<"histogram"> {
    return this.add("histogram", options);
  }

  private add<T extends ChartSeriesType>(type: T, options: SeriesOptionsMap[T]): SeriesApi<T> {
    this.alive();
    this.checkOptions(type, options);
    const rec = this.store.add(type);
    const s = new SeriesImpl(type, rec.id, this, options);
    this.seriesById.set(rec.id, s as unknown as AnySeries);
    this.render({ kind: "full" });
    return s;
  }

  /** @internal */
  checkOptions<T extends ChartSeriesType>(type: T, o: Partial<SeriesOptionsMap[T]>) {
    validateSeriesOptions(type, o, { hasCandles: Boolean(this.store.candle()) || type === "candlestick" });
  }

  /** @internal */
  removeSeries(s: AnySeries) {
    if (this.removed || !this.seriesById.has(s.id)) return;
    this.seriesById.delete(s.id);
    this.render(this.store.remove(s.id));
  }

  /** @internal Applies a data change and redraws as cheaply as the change allows. */
  mutate(fn: (store: SeriesStore) => Change) {
    this.alive();
    this.render(fn(this.store));
  }

  /** @internal */
  pointsOf(id: number): SeriesData<ChartSeriesType>[] {
    const rec = this.store.series.get(id);
    if (!rec) throw new XChartError("SERIES_REMOVED", "This series was removed from the chart");
    return rec.points.map((p) => ({ ...p }));
  }

  /** @internal */
  redraw() {
    this.render({ kind: "full" });
  }

  private model(): RenderModel {
    const series: RenderModel["series"] = [];
    let candle: CandlestickSeriesOptions | null = null;
    for (const [id, s] of this.seriesById) {
      const rec = this.store.series.get(id)!;
      if (s.type === "candlestick") candle = s.options() as CandlestickSeriesOptions;
      else series.push({ id, type: s.type as Exclude<ChartSeriesType, "candlestick">, values: rec.values, options: s.options() as LineSeriesOptions });
    }
    return { times: this.store.times, bars: this.store.bars, intraday: this.store.intraday(), candle, series };
  }

  private render(change: Change) {
    if (this.removed) return;
    this.adapter.render(this.model(), change);
  }

  // ---------- events ----------
  subscribeCrosshairMove(handler: (event: CrosshairEvent) => void): Unsubscribe {
    this.alive();
    if (typeof handler !== "function") throw new XChartError("INVALID_HANDLER", "subscribeCrosshairMove expects a function");
    this.subs.add(handler);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.subs.delete(handler);
    };
  }

  /** Number of active crosshair subscribers (for diagnostics and tests). */
  crosshairSubscriberCount(): number {
    return this.subs.size;
  }

  private emitCrosshair(index: number | null, time: number | null, price: number | null) {
    if (!this.subs.size) return;
    // The renderer reports on every frame; only notify when something changed.
    const key = index === null ? "none" : `${index}|${time}|${price}`;
    if (key === this.lastEvent) return;
    this.lastEvent = key;
    const seriesData = new Map<SeriesApi<ChartSeriesType>, SeriesData<ChartSeriesType>>();
    let t: number | null = null;
    if (index !== null) {
      t = index < this.store.times.length ? this.store.times[index] : time ?? this.store.timeAt(index);
      for (const [id, d] of this.store.pointsAt(index)) {
        const s = this.seriesById.get(id);
        if (s) seriesData.set(s, d);
      }
    }
    const e: CrosshairEvent = { time: t, price: index === null ? null : price, seriesData };
    for (const h of [...this.subs]) {
      try {
        h(e);
      } catch (err) {
        console.error("[XChart] crosshair handler failed", err);
      }
    }
  }

  // ---------- time scale ----------
  setVisibleRange(range: VisibleTimeRange): void {
    this.alive();
    validateRange(range);
    if (!this.store.times.length) throw new XChartError("NO_DATA", "setVisibleRange needs data on the chart");
    this.adapter.setViewRange(this.store.indexOfTime(range.from), this.store.indexOfTime(range.to));
  }

  getVisibleRange(): VisibleTimeRange | null {
    this.alive();
    const r = this.adapter.getViewRange();
    if (!r || !this.store.times.length) return null;
    return { from: this.store.timeAt(r.from), to: this.store.timeAt(r.to) };
  }

  fitContent(): void {
    this.alive();
    this.adapter.fit();
  }
  scrollToRealTime(): void {
    this.alive();
    this.adapter.scrollToEnd();
  }
  scrollBy(bars: number): void {
    this.alive();
    if (!Number.isFinite(bars)) throw new XChartError("INVALID_NUMBER", "scrollBy expects a finite number of bars");
    this.adapter.scrollBy(bars);
  }
  zoom(factor: number): void {
    this.alive();
    if (!(factor > 0) || !Number.isFinite(factor)) throw new XChartError("INVALID_NUMBER", "zoom factor must be a positive number");
    this.adapter.zoom(factor);
  }

  // ---------- options & lifecycle ----------
  applyOptions(options: Partial<ChartOptions>): void {
    this.alive();
    if (options.theme && options.theme !== "dark" && options.theme !== "light") throw new XChartError("INVALID_OPTION", 'theme must be "dark" or "light"');
    const p = options.priceScale?.precision;
    if (p !== undefined && !(Number.isInteger(p) && p >= 0 && p <= 10)) throw new XChartError("INVALID_OPTION", "priceScale.precision must be an integer from 0 to 10");
    this.opts = { ...this.opts, ...options, priceScale: { ...this.opts.priceScale, ...options.priceScale } };
    this.adapter.setOptions(this.opts);
    this.render({ kind: "full" });
  }

  options(): Readonly<ChartOptions> {
    return { ...this.opts, priceScale: { ...this.opts.priceScale } };
  }

  resize(width: number, height: number): void {
    this.alive();
    if (!(width > 0 && height > 0)) throw new XChartError("INVALID_NUMBER", "resize expects positive width and height");
    this.adapter.resize(width, height);
  }

  remove(): void {
    if (this.removed) return;
    this.removed = true;
    this.subs.clear();
    this.seriesById.clear();
    this.adapter.destroy();
    this.onRemove?.();
  }

  /** Duration of the renderer's last redraw in ms (diagnostics), or null if not reported. */
  renderTimeMs(): number | null {
    return this.adapter.lastDrawMs?.() ?? null;
  }

  isRemoved(): boolean {
    return this.removed;
  }

  private alive() {
    if (this.removed) throw new XChartError("CHART_REMOVED", "This chart was removed; create a new one");
  }
}

// Containers that currently host a chart (prevents two canvases in one container).
const hosts = new WeakSet<object>();

/**
 * Creates a chart inside `container` (browser only). Call `chart.remove()` to release it.
 * Rendering is done by TradestXPro's ChartEngine through the Canvas adapter.
 */
export function createChart(container: HTMLElement, options: ChartOptions = {}): ChartApi {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new XChartError("NO_DOM", "createChart must run in the browser (e.g. inside useEffect), not during server rendering");
  }
  if (!container || typeof (container as HTMLElement).appendChild !== "function") {
    throw new XChartError("INVALID_CONTAINER", "createChart needs an HTML element to render into");
  }
  if (hosts.has(container)) throw new XChartError("CONTAINER_IN_USE", "This container already hosts a chart; call remove() on it first");
  // Importing the SDK on the server is safe: no DOM or Canvas API is touched until this point.
  hosts.add(container);
  try {
    return new ChartImpl(new CanvasAdapter(container, { ...DEFAULTS, ...options }), options, () => hosts.delete(container));
  } catch (e) {
    hosts.delete(container);
    throw e;
  }
}

/** Creates a chart with a custom renderer (used by tests and future backends). */
export function createChartWithAdapter(adapter: RenderAdapter, options: ChartOptions = {}): ChartImpl {
  return new ChartImpl(adapter, options);
}
