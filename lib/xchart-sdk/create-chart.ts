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
import { Emitter } from "./events/emitter.ts";
import { IndicatorRegistry } from "./indicators/registry.ts";
import { defaultRegistry } from "./indicators/index.ts";
import { IndicatorInstance, indicatorPlots, type IndicatorHost } from "./indicators/runtime.ts";
import type { IndicatorApi, IndicatorDefinition, IndicatorInput, IndicatorOptions } from "./indicators/types.ts";
import type { ChartEvents } from "./events/types.ts";
import { DrawingManager, type DrawingHost } from "./drawings/manager.ts";
import type { DrawingApi, DrawingData, DrawingEvent, DrawingSpec, DrawingType } from "./drawings/types.ts";
import { Decorations, type PriceLineApi, type PriceLineOptions, type SeriesMarker } from "./decorations.ts";
import type { EngineLayer } from "../../components/chart/engine.ts";
import type {
  AreaSeriesOptions,
  CandlestickSeriesOptions,
  ChartApi,
  CloudSeriesOptions,
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
    this.owner().mutate((s) => s.setData(this.id, data), this.id);
  }
  update(bar: SeriesData<T>): void {
    this.owner().mutate((s) => s.update(this.id, bar), this.id);
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
  // ---------- markers & price lines (v0.3; view-only, never modify data) ----------
  setMarkers(markers: ReadonlyArray<SeriesMarker>): void {
    this.owner().decor(this.id).setMarkers(markers);
  }
  addMarker(marker: SeriesMarker): string {
    return this.owner().decor(this.id).addMarker(marker);
  }
  removeMarker(id: string): boolean {
    return this.owner().decor(this.id).removeMarker(id);
  }
  getMarkers(): SeriesMarker[] {
    return this.owner().decor(this.id).getMarkers();
  }
  clearMarkers(): void {
    this.owner().decor(this.id).clearMarkers();
  }
  createPriceLine(options: PriceLineOptions): PriceLineApi {
    return this.owner().decor(this.id).createLine(options);
  }
  priceLines(): PriceLineApi[] {
    return this.owner().decor(this.id).priceLines();
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
  /** Typed events (v0.3). */
  readonly events = new Emitter<ChartEvents>();
  private indicators = new Map<string, IndicatorInstance>();
  private registry = new IndicatorRegistry(defaultRegistry);
  private indSeq = 0;
  private inputCache: { version: number; value: ReturnType<IndicatorHost["input"]> } | null = null;
  private decorations = new Map<number, Decorations>();
  private drawingSubs = new Set<(e: DrawingEvent) => void>();
  private drawings: DrawingManager;
  private extraLayers: EngineLayer[] = [];
  private layerKey = "";

  constructor(adapter: RenderAdapter, options: ChartOptions = {}, onRemove?: () => void) {
    const opts = mergeOptions(DEFAULTS, options);
    validateChartOptions(opts);
    this.adapter = adapter;
    this.onRemove = onRemove;
    this.opts = opts;
    adapter.onCrosshair((index, time, price) => this.onPointer(index, time, price));
    adapter.setEvents?.({
      beforeDraw: () => this.flushIndicators(),
      click: (p) => this.events.emit("click", this.pointerPayload(p)),
      dblClick: (p) => this.events.emit("dblClick", this.pointerPayload(p)),
      view: () => this.emitVisibleRange(),
    });
    this.drawings = new DrawingManager(this.drawingHost());
    adapter.setInteraction?.(this.drawings.delegate());
    this.syncLayers(true);
  }

  // ---------- layers: decorations, drawings, plugin layers ----------
  private paneOf(id: number): string {
    const s = this.seriesById.get(id);
    if (!s || s.type === "candlestick") return "main";
    const o = s.options() as { pane?: string };
    const pane = o.pane ?? (s.type === "histogram" ? "separate" : "main");
    return pane === "separate" ? `xs-${id}` : "main";
  }

  /** @internal Pushes the current layer list to the renderer when it changed. */
  syncLayers(force = false) {
    if (this.removed) return;
    const decor = [...this.decorations].filter(([id, d]) => !d.isEmpty() && this.seriesById.has(id));
    const key = decor.map(([id]) => `${id}:${this.paneOf(id)}`).join(",") + `|${this.extraLayers.length}`;
    if (!force && key === this.layerKey) return;
    this.layerKey = key;
    const layers: EngineLayer[] = [...this.extraLayers.filter((l) => (l.z ?? "above") === "below")];
    for (const [id, d] of decor) layers.push(d.layer(this.paneOf(id)));
    layers.push(...this.extraLayers.filter((l) => (l.z ?? "above") === "above"));
    layers.push(this.drawings.layer());
    this.adapter.setLayers?.(layers);
  }

  /** @internal Layers added by plugins (rendered between series decorations and drawings). */
  setExtraLayers(layers: EngineLayer[]) {
    this.extraLayers = layers;
    this.syncLayers(true);
  }

  private requestRedraw() {
    if (this.removed) return;
    this.syncLayers();
    this.adapter.requestRedraw?.();
  }

  /** @internal Markers & price lines of one series (created on first use). */
  decor(id: number): Decorations {
    let d = this.decorations.get(id);
    if (!d) {
      const st = this.store;
      d = new Decorations({
        indexOfTime: (t) => st.indexOfTime(t),
        valueAt: (i) => {
          const rec = st.series.get(id);
          if (!rec || i < 0 || i >= st.times.length) return null;
          if (rec.type === "candlestick") {
            const b = st.bars[i];
            return Number.isFinite(b.c) ? b : null;
          }
          const v = rec.values[i];
          if (!Number.isFinite(v)) return null;
          if (rec.type === "cloud") {
            const w = rec.values2[i];
            return { o: v, h: Math.max(v, w), l: Math.min(v, w), c: v };
          }
          return rec.type === "histogram" ? { o: v, h: Math.max(v, 0), l: Math.min(v, 0), c: v } : { o: v, h: v, l: v, c: v };
        },
        last: () => {
          const rec = st.series.get(id);
          const out: number[] = [];
          if (rec) {
            const n = st.times.length;
            for (let i = n - 1; i >= 0 && out.length < 2; i--) {
              const v = rec.type === "candlestick" ? st.bars[i].c : rec.values[i];
              if (Number.isFinite(v)) out.push(v);
            }
          }
          return { last: out[0] ?? null, prev: out[1] ?? null };
        },
        fmt: (p) => this.fmtPrice(p),
        color: () => (this.opts.theme === "light" ? "#2563eb" : "#60a5fa"),
        redraw: () => this.requestRedraw(),
      });
      this.decorations.set(id, d);
    }
    return d;
  }

  private fmtPrice(p: number): string {
    const fixed = this.opts.priceScale?.precision;
    if (fixed !== undefined) return p.toFixed(fixed);
    const a = Math.abs(p);
    return p.toFixed(a >= 1 || a === 0 ? 2 : a >= 0.01 ? 4 : 6);
  }

  private fmtTime(t: number): string {
    const off = (this.opts.utcOffsetMinutes ?? 330) * 60;
    const iso = new Date((this.store.intraday() ? t + off : t) * 1000).toISOString();
    return this.store.intraday() ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
  }

  private drawingHost(): DrawingHost {
    const st = this.store;
    return {
      indexOfTime: (t) => st.indexOfTime(t),
      timeAt: (i) => (Number.isInteger(i) && i >= 0 && i < st.times.length ? st.times[i] : st.timeAt(i)),
      bar: (i) => st.bars[i],
      barCount: () => st.times.length,
      geometry: () => {
        const a = this.adapter;
        const main = a.getPanes?.().find((p) => p.id === "main");
        if (!main || !a.xOfIndex || !a.priceToY || !a.yToPrice || !a.getPlotWidth) return null;
        return {
          xOfIndex: (i) => a.xOfIndex!(i),
          yOfPrice: (p) => a.priceToY!(p, "main") ?? NaN,
          priceOfY: (y) => a.yToPrice!(y, "main") ?? NaN,
          width: a.getPlotWidth(),
          top: main.top,
          height: main.height,
        };
      },
      fmt: (p) => this.fmtPrice(p),
      timeLabel: (t) => this.fmtTime(t),
      redraw: () => this.requestRedraw(),
      emit: (e) => {
        if (e.type === "create") this.events.emit("drawingCreate", { drawing: e.drawing });
        else if (e.type === "update") this.events.emit("drawingUpdate", { drawing: e.drawing });
        else if (e.type === "remove") this.events.emit("drawingRemove", { id: e.id });
        else if (e.type === "select") this.events.emit("drawingSelect", { id: e.id });
        else this.events.emit("drawingTool", { tool: e.tool });
        for (const h of [...this.drawingSubs]) {
          if (!this.drawingSubs.has(h)) continue;
          try {
            h(e);
          } catch (err) {
            console.error("[XChart] drawing handler failed", err);
          }
        }
      },
    };
  }

  // ---------- coordinates (CSS px relative to the chart canvas) ----------
  timeToCoordinate(time: number): number | null {
    this.assertAlive();
    if (!this.store.times.length || !this.adapter.xOfIndex || typeof time !== "number" || !Number.isFinite(time)) return null;
    return this.adapter.xOfIndex(this.store.indexOfTime(time));
  }
  coordinateToTime(x: number): number | null {
    this.assertAlive();
    if (!this.store.times.length || !this.adapter.indexOfX || !Number.isFinite(x)) return null;
    const i = Math.round(this.adapter.indexOfX(x));
    return i >= 0 && i < this.store.times.length ? this.store.times[i] : this.store.timeAt(i);
  }
  priceToCoordinate(price: number, paneId = "main"): number | null {
    this.assertAlive();
    if (typeof price !== "number" || !Number.isFinite(price)) return null;
    return this.adapter.priceToY?.(price, paneId) ?? null;
  }
  coordinateToPrice(y: number, paneId = "main"): number | null {
    this.assertAlive();
    if (!Number.isFinite(y)) return null;
    return this.adapter.yToPrice?.(y, paneId) ?? null;
  }

  // ---------- drawings ----------
  addDrawing(spec: DrawingSpec): DrawingApi {
    this.assertAlive();
    return this.drawings.add(spec);
  }
  getDrawing(id: string): DrawingApi | undefined {
    this.assertAlive();
    return this.drawings.get(id);
  }
  getDrawings(): DrawingApi[] {
    this.assertAlive();
    return this.drawings.list();
  }
  removeDrawing(drawing: DrawingApi | string): boolean {
    this.assertAlive();
    return this.drawings.remove(typeof drawing === "string" ? drawing : drawing.id);
  }
  clearDrawings(): void {
    this.assertAlive();
    this.drawings.clear();
  }
  duplicateDrawing(id: string): DrawingApi | undefined {
    this.assertAlive();
    return this.drawings.duplicate(id);
  }
  selectDrawing(id: string | null): void {
    this.assertAlive();
    this.drawings.select(id);
  }
  selectedDrawing(): string | null {
    return this.drawings.selected;
  }
  /** Starts interactive creation with a tool; null returns to normal pan/zoom. */
  setDrawingTool(tool: DrawingType | null): void {
    this.assertAlive();
    this.drawings.setTool(tool);
  }
  getDrawingTool(): DrawingType | null {
    return this.drawings.tool();
  }
  setDrawingSnap(on: boolean): void {
    if (typeof on !== "boolean") throw new XChartError("INVALID_OPTION", "setDrawingSnap expects a boolean");
    this.drawings.snap = on;
  }
  undoDrawing(): boolean {
    this.assertAlive();
    return this.drawings.undo();
  }
  redoDrawing(): boolean {
    this.assertAlive();
    return this.drawings.redo();
  }
  serializeDrawings(): DrawingData[] {
    this.assertAlive();
    return this.drawings.serialize();
  }
  loadDrawings(data: unknown): void {
    this.assertAlive();
    this.drawings.load(data);
  }
  subscribeDrawingEvents(handler: (e: DrawingEvent) => void): Unsubscribe {
    this.assertAlive();
    if (typeof handler !== "function") throw new XChartError("INVALID_HANDLER", "subscribeDrawingEvents expects a function");
    this.drawingSubs.add(handler);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.drawingSubs.delete(handler);
    };
  }

  /** Subscribes to a typed chart event; returns an unsubscribe function. */
  on<K extends keyof ChartEvents>(type: K, handler: (payload: ChartEvents[K]) => void): Unsubscribe {
    this.assertAlive();
    if (typeof handler !== "function") throw new XChartError("INVALID_HANDLER", `on("${String(type)}") expects a function`);
    return this.events.on(type, handler);
  }

  private lastRangeKey = "";
  private emitVisibleRange() {
    if (!this.events.has("visibleRangeChange") || !this.store.times.length) return;
    const r = this.adapter.getViewRange();
    if (!r) return;
    const range = { from: this.store.timeAt(r.from), to: this.store.timeAt(r.to) };
    const key = `${range.from}|${range.to}|${r.from.toFixed(3)}|${r.to.toFixed(3)}`;
    if (key === this.lastRangeKey) return;
    this.lastRangeKey = key;
    this.events.emit("visibleRangeChange", { range, logical: { from: r.from, to: r.to } });
  }

  private pointerPayload(p: { x: number; y: number; index: number; price: number | null; paneId: string | null }) {
    const i = Math.round(p.index);
    return { time: this.store.times.length ? (i >= 0 && i < this.store.times.length ? this.store.times[i] : this.store.timeAt(i)) : null, price: p.price, paneId: p.paneId, point: { x: p.x, y: p.y }, logical: p.index };
  }

  // ---------- indicators ----------
  private indicatorHost: IndicatorHost = {
    input: () => this.indicatorInput(),
    futureTime: (k) => {
      const T = this.store.times;
      const lastCandle = this.lastCandleTime();
      return lastCandle === null ? 0 : this.store.timeAt(this.store.indexOfTime(lastCandle) + k) || T[T.length - 1];
    },
    changed: () => this.render({ kind: "full" }),
    emit: (type, payload) => this.events.emit(type, payload),
  };

  private lastCandleTime(): number | null {
    const b = this.store.bars;
    for (let i = b.length - 1; i >= 0; i--) if (Number.isFinite(b[i].c)) return b[i].t;
    return null;
  }

  /** Existing bars of the candlestick series (or, without one, the first line/area series). Cached per data version. */
  private indicatorInput(): ReturnType<IndicatorHost["input"]> {
    if (this.inputCache && this.inputCache.version === this.store.version) return this.inputCache.value;
    const st = this.store;
    const time: number[] = [], open: number[] = [], high: number[] = [], low: number[] = [], close: number[] = [], volume: number[] = [], axisIdx: number[] = [];
    if (st.candle()) {
      for (let i = 0; i < st.bars.length; i++) {
        const b = st.bars[i];
        if (!Number.isFinite(b.c)) continue;
        time.push(b.t); open.push(b.o); high.push(b.h); low.push(b.l); close.push(b.c); volume.push(b.v); axisIdx.push(i);
      }
    } else {
      const src = [...st.series.values()].find((x) => x.type === "line" || x.type === "area");
      if (src) {
        for (let i = 0; i < src.values.length; i++) {
          const v = src.values[i];
          if (!Number.isFinite(v)) continue;
          time.push(st.times[i]); open.push(v); high.push(v); low.push(v); close.push(v); volume.push(0); axisIdx.push(i);
        }
      }
    }
    const input: IndicatorInput = { time, open, high, low, close, volume, intraday: st.intraday() };
    const value = time.length ? { input, axisIdx, axisLength: st.times.length } : null;
    this.inputCache = { version: st.version, value };
    return value;
  }

  private flushIndicators(): boolean {
    let any = false;
    for (const i of this.indicators.values()) any = i.flush() || any;
    return any;
  }

  /** Adds an indicator. `config` mixes calculation parameters (e.g. period) and display options (color, pane...). */
  addIndicator(type: string, config: Record<string, unknown> = {}): IndicatorApi {
    this.assertAlive();
    const def = this.registry.get(type);
    if (!def) throw new XChartError("UNKNOWN_INDICATOR", `Unknown indicator "${type}". Registered: ${this.registry.list().map((d) => d.id).join(", ")}`);
    if (!config || typeof config !== "object") throw new XChartError("INVALID_OPTION", "addIndicator config must be an object");
    const OPTION_KEYS = ["color", "colors", "lineWidth", "lineStyle", "pane", "priceScaleId", "visible", "title", "hiddenOutputs", "fills"];
    const opts: Record<string, unknown> = {};
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(config)) (OPTION_KEYS.includes(k) ? opts : params)[k] = v;
    const id = `${type}-${++this.indSeq}`;
    const inst = new IndicatorInstance(id, def, params, opts as IndicatorOptions, this.indicatorHost, (x) => {
      this.indicators.delete(x.id);
      this.render({ kind: "full" });
      this.events.emit("indicatorChange", { indicator: x, action: "removed" });
    });
    this.indicators.set(id, inst);
    this.render({ kind: "full" });
    this.events.emit("indicatorChange", { indicator: inst, action: "added" });
    return inst;
  }

  getIndicators(): IndicatorApi[] {
    return [...this.indicators.values()];
  }

  removeIndicator(indicator: IndicatorApi | string): boolean {
    this.assertAlive();
    const inst = typeof indicator === "string" ? this.indicators.get(indicator) : this.indicators.get(indicator.id);
    if (!inst) return false;
    inst.remove();
    return true;
  }

  /** Registers an indicator definition for this chart only. */
  registerIndicator(def: IndicatorDefinition): void {
    this.assertAlive();
    this.registry.register(def);
  }
  unregisterIndicator(id: string): boolean {
    if ([...this.indicators.values()].some((i) => i.type === id)) throw new XChartError("INDICATOR_IN_USE", `Indicator "${id}" is used on this chart; remove those instances first`);
    return this.registry.unregister(id);
  }
  listIndicators(): IndicatorDefinition[] {
    return this.registry.list();
  }
  getIndicatorDefinition(id: string): IndicatorDefinition | undefined {
    return this.registry.get(id);
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
  /** Two-boundary band with colour switching at crossings (clouds, channels, forecast ranges). */
  addCloudSeries(options: CloudSeriesOptions = {}): SeriesApi<"cloud"> {
    return this.add("cloud", options);
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
    this.decorations.get(s.id)?.clear();
    this.decorations.delete(s.id);
    for (const i of this.indicators.values()) i.invalidate("full");
    this.render(this.store.remove(s.id), keep);
  }

  /** @internal Applies a data change (validated by the store before mutating) and redraws. */
  mutate(fn: (store: SeriesStore) => Change, seriesId?: number) {
    this.assertAlive();
    // The viewport must be captured BEFORE the data changes (cheap: two index→time lookups).
    const keep = this.captureView();
    const change = fn(this.store);
    if (this.indicators.size) {
      const isInput = seriesId !== undefined && this.store.series.get(seriesId)?.type === "candlestick";
      const kind = change.kind === "full" ? "full" : isInput ? "tail" : change.appended ? "full" : null;
      if (kind) for (const i of this.indicators.values()) i.invalidate(kind);
    }
    this.render(change, keep);
    if (seriesId !== undefined) this.events.emit("seriesUpdate", { seriesId, kind: change.kind });
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
      else series.push({ id, type: s.type as Exclude<ChartSeriesType, "candlestick">, values: rec.values, values2: rec.values2, options: s.options() as LineSeriesOptions });
    }
    let extraOverlays: RenderModel["extraOverlays"];
    let extraPanes: RenderModel["extraPanes"];
    let future = 0;
    if (this.indicators.size) {
      this.flushIndicators();
      const p = indicatorPlots([...this.indicators.values()]);
      extraOverlays = p.overlays;
      extraPanes = p.panes;
      future = p.future;
    }
    return { times: this.store.times, bars: this.store.bars, intraday: this.store.intraday(), candle, series, followLatest: this.opts.followLatest === true, extraOverlays, extraPanes, future };
  }

  private render(change: Change, before?: ReturnType<ChartImpl["captureView"]>) {
    if (this.removed) return;
    // Full re-renders keep the viewport on the same TIMES (bars may shift index when the axis changes).
    const keep = change.kind === "full" ? (before === undefined ? this.captureView() : before) : null;
    this.adapter.render(this.model(), change);
    if (change.kind === "full") this.syncLayers();
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
    if (!this.subs.size && !this.events.has("crosshairMove")) return;
    // The renderer reports on every frame. Emit when the position OR the data changed.
    const key = index === null ? "none" : `${index}|${time}|${price}|${this.store.version}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const ev = this.buildEvent(this.pointer);
    this.deliver([...this.subs], ev);
    this.events.emit("crosshairMove", ev);
  }

  private buildEvent(p: { index: number; time: number | null; price: number | null } | null): CrosshairEvent {
    const seriesData = new Map<SeriesApi<ChartSeriesType>, SeriesData<ChartSeriesType>>();
    if (!p) return { time: null, price: null, seriesData, indicators: new Map(), projected: false };
    const T = this.store.times;
    const time = p.index < T.length ? T[p.index] : p.time ?? this.store.timeAt(p.index);
    for (const [id, d] of this.store.pointsAt(p.index)) {
      const s = this.seriesById.get(id);
      if (s) seriesData.set(s, d);
    }
    const indicators = new Map<IndicatorApi, Record<string, number>>();
    for (const ind of this.indicators.values()) {
      const vals: Record<string, number> = {};
      let any = false;
      for (const [k, arr] of Object.entries(ind.aligned)) {
        const v = arr[p.index];
        if (Number.isFinite(v)) {
          vals[k] = v;
          any = true;
        }
      }
      if (any) indicators.set(ind, vals);
    }
    const lastBar = this.lastCandleTime();
    const projected = lastBar !== null && p.index > this.store.indexOfTime(lastBar);
    return { time, price: p.price, seriesData, indicators, projected };
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
    this.events.emit("destroy", {});
    this.events.clear();
    for (const i of [...this.indicators.values()]) i.remove();
    this.indicators.clear();
    this.inputCache = null;
    this.drawings.destroy();
    this.drawingSubs.clear();
    for (const d of this.decorations.values()) d.clear();
    this.decorations.clear();
    this.extraLayers = [];
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
