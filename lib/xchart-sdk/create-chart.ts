/**
 * XChart public API: createChart() → ChartApi → SeriesApi.
 * Data lives in SeriesStore; drawing is delegated to a RenderAdapter (the Canvas adapter in browsers).
 *
 * Error policy (v0.2.1): every failure is an XChartError with a code, raised BEFORE any state
 * changes, so a rejected call leaves the chart and its series exactly as they were.
 */
import { SeriesStore, type Change } from "./store.ts";
import { CanvasAdapter, type RenderAdapter, type RenderModel } from "./canvas-adapter.ts";
import { XChartError, validateChartOptions, validateRange, validateSeriesOptions, validateZoom } from "./validation.ts";
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

const DEFAULTS: ChartOptions = { theme: "dark", autoSize: true, crosshair: true, followLatest: false };

type AnySeries = SeriesImpl<ChartSeriesType>;
type Handler = (e: CrosshairEvent) => void;

/** Renderer used after remove(): ignores everything, holds no references. */
const DETACHED: RenderAdapter = {
  render() {}, setOptions() {}, onCrosshair() {}, getViewRange: () => null, setViewRange() {}, fit() {},
  scrollToEnd() {}, scrollBy() {}, zoom() {}, resize() {}, destroy() {},
};

function mergeOptions(base: ChartOptions, patch: Partial<ChartOptions>): ChartOptions {
  return { ...base, ...patch, priceScale: { ...base.priceScale, ...patch.priceScale } };
}

class SeriesImpl<T extends ChartSeriesType> implements SeriesApi<T> {
  readonly type: T;
  readonly id: number;
  private chart: ChartImpl | null;
  private opts: SeriesOptionsMap[T];
  constructor(type: T, id: number, chart: ChartImpl, options: SeriesOptionsMap[T]) {
    this.type = type;
    this.id = id;
    this.chart = chart;
    this.opts = { ...options };
  }
  /** The owning chart, or a CHART_REMOVED / SERIES_REMOVED error. */
  private owner(): ChartImpl {
    if (!this.chart) throw new XChartError("SERIES_REMOVED", "This series was removed from the chart");
    this.chart.assertAlive();
    return this.chart;
  }
  setData(data: ReadonlyArray<SeriesData<T>>): void {
    this.owner().mutate((s) => s.setData(this.id, data));
  }
  update(bar: SeriesData<T>): void {
    this.owner().mutate((s) => s.update(this.id, bar));
  }
  data(): ReadonlyArray<SeriesData<T>> {
    return this.owner().pointsOf(this.id) as SeriesData<T>[];
  }
  applyOptions(options: Partial<SeriesOptionsMap[T]>): void {
    const chart = this.owner();
    // Validate the merged result so combinations (e.g. candle colouring without candles) are checked too.
    const next = { ...this.opts, ...options } as SeriesOptionsMap[T];
    chart.checkOptions(this.type, options);
    chart.checkOptions(this.type, next);
    this.opts = next;
    chart.redraw();
  }
  options(): Readonly<SeriesOptionsMap[T]> {
    return { ...this.opts };
  }
  remove(): void {
    const chart = this.chart;
    if (!chart) return; // already removed: no-op
    this.chart = null;
    chart.detachSeries(this);
  }
  /** @internal Called when the chart is destroyed. */
  detach() {
    this.chart = null;
  }
}

export class ChartImpl implements ChartApi {
  private store = new SeriesStore();
  private seriesById = new Map<number, AnySeries>();
  private subs = new Set<Handler>();
  private opts: ChartOptions;
  private removed = false;
  private adapter: RenderAdapter;
  private onRemove?: () => void;
  // Last pointer position reported by the renderer (null = outside the chart).
  private pointer: { index: number; time: number | null; price: number | null } | null = null;
  // Key of the last delivered event. Starts as "outside" so no leave event fires before entering.
  private lastKey = "none";

  constructor(adapter: RenderAdapter, options: ChartOptions = {}, onRemove?: () => void) {
    const opts = mergeOptions(DEFAULTS, options);
    validateChartOptions(opts);
    this.adapter = adapter;
    this.onRemove = onRemove;
    this.opts = opts;
    adapter.onCrosshair((index, time, price) => this.onPointer(index, time, price));
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
    this.assertAlive();
    this.checkOptions(type, options);
    const rec = this.store.add(type); // throws (no state change) for a second candlestick series
    const s = new SeriesImpl(type, rec.id, this, options);
    this.seriesById.set(rec.id, s as unknown as AnySeries);
    try {
      this.render({ kind: "full" });
    } catch (e) {
      // Roll back a series the renderer could not take.
      this.seriesById.delete(rec.id);
      this.store.remove(rec.id);
      s.detach();
      throw e;
    }
    return s;
  }

  /** @internal */
  checkOptions<T extends ChartSeriesType>(type: T, o: Partial<SeriesOptionsMap[T]>) {
    validateSeriesOptions(type, o, { hasCandles: Boolean(this.store.candle()) || type === "candlestick" });
  }

  /** @internal Removes a series (its unique timestamps leave the shared axis). */
  detachSeries(s: AnySeries) {
    if (this.removed || !this.seriesById.has(s.id)) return;
    const keep = this.captureView();
    this.seriesById.delete(s.id);
    this.render(this.store.remove(s.id), keep);
  }

  /** @internal Applies a data change (validated by the store before mutating) and redraws. */
  mutate(fn: (store: SeriesStore) => Change) {
    this.assertAlive();
    // The viewport must be captured BEFORE the data changes (cheap: two index→time lookups).
    const keep = this.captureView();
    this.render(fn(this.store), keep);
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
    return { times: this.store.times, bars: this.store.bars, intraday: this.store.intraday(), candle, series, followLatest: this.opts.followLatest === true };
  }

  private render(change: Change, before?: ReturnType<ChartImpl["captureView"]>) {
    if (this.removed) return;
    // Full re-renders keep the viewport on the same TIMES (bars may shift index when the axis changes).
    const keep = change.kind === "full" ? (before === undefined ? this.captureView() : before) : null;
    this.adapter.render(this.model(), change);
    if (keep) this.restoreView(keep);
    // Data under a stationary pointer may have changed: let the next frame re-emit.
    if (this.pointer && this.subs.size) this.lastKey = "";
  }

  private captureView(): { range: VisibleTimeRange; intraday: boolean } | null {
    const r = this.adapter.getViewRange();
    if (!r || !this.store.times.length) return null;
    return { range: { from: this.store.timeAt(r.from), to: this.store.timeAt(r.to) }, intraday: this.store.intraday() };
  }

  private restoreView(prev: { range: VisibleTimeRange; intraday: boolean }) {
    const T = this.store.times;
    if (!T.length) return;
    const overlaps = prev.range.to >= T[0] && prev.range.from <= T[T.length - 1];
    if (prev.intraday !== this.store.intraday() || !overlaps) {
      // Frequency changed (daily ↔ intraday) or the old window no longer has data: show the new data.
      this.adapter.fit();
      return;
    }
    const from = this.store.indexOfTime(prev.range.from);
    const to = this.store.indexOfTime(prev.range.to);
    if (to > from) this.adapter.setViewRange(from, to);
  }

  // ---------- events ----------
  subscribeCrosshairMove(handler: Handler): Unsubscribe {
    this.assertAlive();
    if (typeof handler !== "function") throw new XChartError("INVALID_HANDLER", "subscribeCrosshairMove expects a function");
    this.subs.add(handler);
    // A subscriber added while the pointer is over the chart gets the current state right away.
    if (this.pointer) {
      queueMicrotask(() => {
        if (!this.removed && this.subs.has(handler) && this.pointer) this.deliver([handler], this.buildEvent(this.pointer));
      });
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.subs.delete(handler);
    };
  }

  /** Number of active crosshair subscribers (diagnostics and tests). */
  crosshairSubscriberCount(): number {
    return this.subs.size;
  }

  private onPointer(index: number | null, time: number | null, price: number | null) {
    this.pointer = index === null ? null : { index, time, price };
    if (!this.subs.size) return;
    // The renderer reports on every frame. Emit when the position OR the data changed.
    const key = index === null ? "none" : `${index}|${time}|${price}|${this.store.version}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.deliver([...this.subs], this.buildEvent(this.pointer));
  }

  private buildEvent(p: { index: number; time: number | null; price: number | null } | null): CrosshairEvent {
    const seriesData = new Map<SeriesApi<ChartSeriesType>, SeriesData<ChartSeriesType>>();
    if (!p) return { time: null, price: null, seriesData };
    const T = this.store.times;
    const time = p.index < T.length ? T[p.index] : p.time ?? this.store.timeAt(p.index);
    for (const [id, d] of this.store.pointsAt(p.index)) {
      const s = this.seriesById.get(id);
      if (s) seriesData.set(s, d);
    }
    return { time, price: p.price, seriesData };
  }

  private deliver(handlers: Handler[], e: CrosshairEvent) {
    for (const h of handlers) {
      // Skip handlers unsubscribed earlier in this same delivery.
      if (!this.subs.has(h)) continue;
      try {
        h(e);
      } catch (err) {
        console.error("[XChart] crosshair handler failed", err);
      }
    }
  }

  // ---------- time scale ----------
  setVisibleRange(range: VisibleTimeRange): void {
    this.assertAlive();
    validateRange(range);
    if (!this.store.times.length) throw new XChartError("NO_DATA", "setVisibleRange needs data on the chart");
    this.adapter.setViewRange(this.store.indexOfTime(range.from), this.store.indexOfTime(range.to));
  }

  getVisibleRange(): VisibleTimeRange | null {
    this.assertAlive();
    const r = this.adapter.getViewRange();
    if (!r || !this.store.times.length) return null;
    return { from: this.store.timeAt(r.from), to: this.store.timeAt(r.to) };
  }

  fitContent(): void {
    this.assertAlive();
    this.adapter.fit();
  }
  scrollToRealTime(): void {
    this.assertAlive();
    this.adapter.scrollToEnd();
  }
  scrollBy(bars: number): void {
    this.assertAlive();
    if (typeof bars !== "number" || !Number.isFinite(bars)) throw new XChartError("INVALID_NUMBER", "scrollBy expects a finite number of bars");
    this.adapter.scrollBy(bars);
  }
  zoom(factor: number): void {
    this.assertAlive();
    validateZoom(factor);
    this.adapter.zoom(factor);
  }

  // ---------- options & lifecycle ----------
  applyOptions(options: Partial<ChartOptions>): void {
    this.assertAlive();
    if (!options || typeof options !== "object") throw new XChartError("INVALID_OPTION", "applyOptions expects an object");
    const next = mergeOptions(this.opts, options);
    validateChartOptions(next); // nothing changes if this throws
    this.opts = next;
    this.adapter.setOptions(this.opts);
    this.render({ kind: "full" });
  }

  options(): Readonly<ChartOptions> {
    return { ...this.opts, priceScale: { ...this.opts.priceScale } };
  }

  resize(width: number, height: number): void {
    this.assertAlive();
    validateChartOptions({ ...this.opts, autoSize: false, width, height });
    this.opts = { ...this.opts, autoSize: false, width, height };
    this.adapter.resize(width, height);
  }

  /** Destroys the chart: renderer, canvas, wrapper, observers, listeners, subscribers and data. Idempotent. */
  remove(): void {
    if (this.removed) return;
    this.removed = true;
    this.subs.clear();
    this.pointer = null;
    for (const s of this.seriesById.values()) s.detach();
    this.seriesById.clear();
    this.store.clear();
    const adapter = this.adapter;
    this.adapter = DETACHED;
    try {
      adapter.destroy();
    } finally {
      const cb = this.onRemove;
      this.onRemove = undefined;
      cb?.();
    }
  }

  /** Duration of the renderer's last redraw in ms (diagnostics), or null if not reported. */
  renderTimeMs(): number | null {
    return this.adapter.lastDrawMs?.() ?? null;
  }

  isRemoved(): boolean {
    return this.removed;
  }

  /** @internal */
  assertAlive() {
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
  const opts = mergeOptions(DEFAULTS, options);
  validateChartOptions(opts); // before touching the DOM
  if (hosts.has(container)) throw new XChartError("CONTAINER_IN_USE", "This container already hosts a chart; call remove() on it first");
  hosts.add(container);
  let adapter: CanvasAdapter | null = null;
  try {
    adapter = new CanvasAdapter(container, opts); // cleans up its own DOM if it fails
    return new ChartImpl(adapter, options, () => hosts.delete(container));
  } catch (e) {
    adapter?.destroy();
    hosts.delete(container);
    if (e instanceof XChartError) throw e;
    throw new XChartError("INIT_FAILED", `Chart could not be created: ${(e as Error)?.message ?? String(e)}`);
  }
}

/** Creates a chart with a custom renderer (used by tests and future backends). */
export function createChartWithAdapter(adapter: RenderAdapter, options: ChartOptions = {}): ChartImpl {
  return new ChartImpl(adapter, options);
}
