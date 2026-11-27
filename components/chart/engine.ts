// TradestXPro chart engine: a dependency-free canvas renderer for OHLC charts with
// overlays, indicator panes, crosshair, zoom/pan (both axes), log/auto price scale and
// editable drawings. Colours follow the site theme (CSS variables).
import type { Bar } from "../../lib/ta/catalog.ts";
import { contrastText, fillPolys, futureTime, histTone, withAlpha } from "../../lib/chart/geometry.ts";

export type PlotStyle = "line" | "histogram" | "dots" | "area";
/** Shading between a series and `other` (series or constant); colours are final CSS colours. */
export type PlotFill = { other: number[] | number; up: string; down: string; only?: "up" | "down" };
export type PlotSeries = {
  label: string;
  values: number[];
  color: string;
  style?: PlotStyle;
  width?: number;
  opacity?: number;
  dash?: "solid" | "dashed" | "dotted";
  scaleLabel?: boolean;
  precision?: number;
  fills?: PlotFill[];
  /** Histogram colours: "trend" = [pos↑, pos↓, neg↓, neg↑]; "candle" = [up bar, down bar]; "sign" = [≥ 0, < 0]. */
  hist?: { mode: "trend" | "candle" | "sign"; colors: string[] };
  /** Line series drawn as an area: gradient from the line down to `baseline` (or the pane bottom). */
  area?: { top: string; bottom: string; baseline?: number };
  /** Draw as a step line (horizontal then vertical). */
  step?: boolean;
  /** Dots at every data point (line with markers). */
  pointMarkers?: boolean;
  /** Main pane only: price scale id. Omitted / "right" = the main scale; any other id gets its own auto-fitted overlay scale ("left" also shows an axis on the left edge). */
  scale?: string;
};
export type PaneSpec = { id: string; title: string; series: PlotSeries[]; levels?: number[]; bands?: { from: number; to: number; color: string }[]; range?: [number, number]; collapsed?: boolean };
/** Overlay / main price-scale settings. `margins` are fractions of the pane kept free above and below the data. */
export type ScaleSpec = {
  id: string;
  /** Pane the scale belongs to (default "main"). "right" is each pane's own scale. */
  pane?: string;
  margins?: { top: number; bottom: number };
  visible?: boolean;
  /** Transform of this scale (independent of other scales). Non-positive values are not drawn on a log scale. */
  mode?: "normal" | "log" | "percentage" | "indexed";
  /** Higher values lower on the pane. */
  invert?: boolean;
  /** Manual range in price units (disables autoscale). */
  range?: [number, number];
  /** Axis label formatter (precision / minimum move / custom). */
  format?: (v: number) => string;
};
export type Marker = { index: number; text: string; color: string; position: "above" | "below" };
export type ChartType = "candles" | "bars" | "line" | "area" | "hollow" | "hilo" | "step" | "baseline" | "columns";
/** Per-point data the renderer needs for derived chart types (structural subset of DerivedPoint). */
export type DerivedRenderPoint = { status: string; direction: number; thickStart?: boolean; thickEnd?: boolean; switchPrice?: number; lowBox?: number; highBox?: number; complete?: boolean };
export type DerivedRender = {
  kind: "renko" | "kagi" | "point-and-figure" | "line-break" | "range-bars";
  points: ArrayLike<DerivedRenderPoint>;
  up: string;
  down: string;
  wicks?: boolean;
  yangWidth?: number;
  yinWidth?: number;
  /** Point & Figure: price of box index k, and column spacing (1 = one column per bar slot). */
  boxLevel?: (k: number) => number;
};
/** Styling of line-like main types (line, step, area, baseline, columns). */
export type MainStyle = { line?: string; lineWidth?: number; areaTop?: string; areaBottom?: string; baseline?: number; up?: string; down?: string; markers?: boolean };

export type DrawingTool = "none" | "trend" | "hline" | "fib" | "rect" | "ray";
type Pt = { t: number; p: number };
export type Drawing =
  | { kind: "trend" | "fib" | "rect" | "ray"; a: Pt; b: Pt; color: string }
  | { kind: "hline"; p: number; color: string };

export type ChartData = {
  bars: Bar[];
  type: ChartType;
  overlays: PlotSeries[];
  panes: PaneSpec[];
  markers?: Marker[];
  intraday?: boolean;
  /** Bars of space past the last candle that series extend into (e.g. the projected Ichimoku cloud). */
  future?: number;
  /** Candle colours (default: theme up/down). */
  candle?: { up?: string; down?: string; wickUp?: string; wickDown?: string };
  /** Price-scale settings by id ("right" = the main scale). */
  scales?: ScaleSpec[];
  mainStyle?: MainStyle;
  /** Price-based (derived) rendering: `bars` are derived points on a logical axis (see lib/xchart-sdk/derived). */
  derived?: DerivedRender;
  /** Real last / previous close when `bars` are a display transform (e.g. Heikin Ashi). */
  lastPrice?: { price: number; prev: number | null };
  /** Relative pane heights by pane id ("main" included). Omitted panes use the default split. */
  paneSizes?: Record<string, number>;
};

/** Optional renderer settings (used by the XChart SDK; defaults match the terminal chart). */
export type EngineOptions = {
  crosshair?: boolean;
  pricePrecision?: number;
  theme?: Partial<EngineTheme> | null;
  utcOffsetSeconds?: number;
  /** Main-scale transform (ignored while the log scale is on): % change or indexed to 100 from the first visible bar. */
  scaleMode?: "normal" | "percentage" | "indexed";
  /** Custom time labels (e.g. an IANA time zone); return null to use the built-in format. */
  timeFormatter?: ((t: number, intraday: boolean, long: boolean) => string | null) | null;
};

/** `price` is the main-pane price under the pointer (null over indicator panes). */
/** Geometry and drawing helpers handed to custom layers (SDK drawings, markers, price lines, plugins). */
export type LayerApi = {
  ctx: CanvasRenderingContext2D;
  theme: EngineTheme;
  pane: { id: string; top: number; height: number; width: number };
  /** Visible bar index range (inclusive) and bar spacing in px. */
  from: number;
  to: number;
  spacing: number;
  barCount: number;
  xOfIndex(i: number): number;
  indexOfX(x: number): number;
  /** Price ↔ y in this pane (main-pane price scale for "main"). */
  yOfPrice(p: number): number;
  priceOfY(y: number): number;
  bar(i: number): Bar | undefined;
  /** Queues a label on the price axis (drawn above series labels). */
  axisLabel(y: number, text: string, bg: string): void;
  /** Price ↔ y on another scale of this pane (e.g. an overlay or the left scale); null when the scale is not present. */
  scaleY?(scaleId: string, p: number): number | null;
  scalePrice?(scaleId: string, y: number): number | null;
};
export type EngineLayer = { pane?: string; z?: "below" | "above"; draw(api: LayerApi): void };

/** Pointer position in chart terms, given to the interaction delegate and click callbacks. */
export type PointerInfo = { x: number; y: number; index: number; price: number | null; paneId: string | null; shift: boolean; ctrl: boolean; pointerType: string };
/** Lets the SDK claim pointer/keyboard input (e.g. drawings) before the engine pans or zooms. */
export type InteractionDelegate = {
  hover?(p: PointerInfo): string | null;
  down?(p: PointerInfo): boolean;
  move?(p: PointerInfo): void;
  up?(p: PointerInfo): void;
  dbl?(p: PointerInfo): boolean;
  key?(e: KeyboardEvent): boolean;
};

export type CrosshairInfo = { index: number; bar: Bar | null; price?: number | null; time?: number } | null;
export type PaneBox = { id: string; top: number; height: number };
export type ScaleState = { auto: boolean; log: boolean };

export type EngineTheme = Theme;
type Theme = { bg: string; grid: string; axis: string; text: string; strong: string; up: string; down: string; cross: string; tag: string; tagText: string; line: string; draw: string; select: string; level: string; zero: string; future: string };

function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  const light = document.documentElement.dataset.theme === "light";
  return {
    bg: v("--color-ink", "#05070b"),
    grid: light ? "rgba(15,23,42,0.06)" : "rgba(255,255,255,0.05)",
    axis: v("--color-line", "rgba(255,255,255,0.1)"),
    text: v("--color-muted", "#8b95a7"),
    strong: v("--color-white", "#e5e9f0"),
    up: v("--color-up", "#22c55e"),
    down: v("--color-down", "#f43f5e"),
    cross: light ? "rgba(15,23,42,0.45)" : "rgba(196,203,216,0.45)",
    tag: light ? "#334155" : "#334155",
    tagText: "#ffffff",
    line: light ? "#0f172a" : "#e5e9f0",
    draw: light ? "#b45309" : "#f5c451",
    select: v("--color-accent", "#38bdf8"),
    level: light ? "rgba(15,23,42,0.28)" : "rgba(226,232,240,0.22)",
    zero: light ? "rgba(15,23,42,0.4)" : "rgba(226,232,240,0.35)",
    future: light ? "rgba(15,23,42,0.025)" : "rgba(255,255,255,0.018)",
  };
}

const AXIS_W = 70;
const TIME_H = 26;
const PANE_GAP = 1;
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

function niceStep(range: number, targetTicks: number): number {
  const raw = range / Math.max(1, targetTicks);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * pow;
}

export function fmtPrice(v: number, step = 0): string {
  if (step > 0 && Math.abs(v) < step / 1e6) v = 0;
  const abs = Math.abs(v);
  if (abs >= 1e7) return (v / 1e7).toFixed(2) + "Cr";
  if (abs >= 1e5 && step >= 1000) return (v / 1e5).toFixed(2) + "L";
  const dp = step > 0 ? Math.max(0, Math.min(6, -Math.floor(Math.log10(step)) + 1)) : abs >= 1 ? 2 : 4;
  return v.toLocaleString("en-IN", { minimumFractionDigits: Math.min(dp, 2), maximumFractionDigits: dp });
}

/** Value text honouring an indicator's precision setting (decimal places). */
export function fmtValue(v: number, precision?: number): string {
  if (precision === undefined || precision === null || !Number.isFinite(v)) return fmtPrice(v);
  return v.toLocaleString("en-IN", { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

const withOpacity = (c: string) => (c.startsWith("#") && c.length === 7 ? c + "99" : c);

const IST = 19800;
function fmtTime(t: number, intraday: boolean, long = false, offset = IST): string {
  const d = new Date((t + (intraday ? offset : 0)) * 1000);
  const mon = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  if (!intraday) return long ? `${day} ${mon} ${d.getUTCFullYear()}` : `${day} ${mon}`;
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return long ? `${day} ${mon} ${hm}` : hm;
}

/** Pane layout. For the main pane with a log scale, min/max are stored in log space. */
type PaneLayout = {
  top: number; height: number; min: number; max: number; log: boolean; spec?: PaneSpec;
  /** Percentage / indexed transform of the main scale relative to `base`. */
  mode?: "pct" | "idx"; base?: number;
  /** Overlay scales of the pane (same rectangle, own range). */
  scales?: Map<string, PaneLayout>;
  invert?: boolean;
  fmt?: (v: number) => string;
  collapsed?: boolean;
};
const COLLAPSED_H = 20;
const MIN_PANE_H = 30;

type Interaction =
  | { kind: "pan"; x: number; y: number; end: number; min: number; max: number; vertical: boolean }
  | { kind: "axis"; y: number; min: number; max: number }
  | { kind: "drawing"; index: number; part: "all" | "a" | "b"; start: Pt; orig: Drawing }
  | { kind: "delegate" }
  | { kind: "sep"; k: number; y: number; h: number[] };

export class ChartEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ro: ResizeObserver;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private data: ChartData = { bars: [], type: "candles", overlays: [], panes: [] };
  private spacing = 8;
  private endIndex = 0;
  private mouse: { x: number; y: number } | null = null;
  private act: Interaction | null = null;
  private frame = 0;
  /** Last full frame without the crosshair: pointer moves only blit it and redraw the crosshair. */
  private base: HTMLCanvasElement | null = null;
  private baseValid = false;
  private pendingFull = true;
  /** Set while crosshair-only frames are being requested: only then is the frame cached (the copy forces a synchronous raster flush). */
  private overlayActive = false;
  /** Duration of the last crosshair-only redraw (ms). */
  lastOverlayMs = 0;
  /** Frame counters (diagnostics): full renders vs crosshair-only blits. */
  readonly frames = { full: 0, overlay: 0 };
  private layouts: PaneLayout[] = [];
  private tool: DrawingTool = "none";
  private drawings: Drawing[] = [];
  private pending: Pt | null = null;
  private selected = -1;
  private scale = { auto: true, log: false, min: 0, max: 1 };
  private theme: Theme;
  private cb: {
    onCrosshair?: (c: CrosshairInfo) => void;
    onDrawingsChange?: (d: Drawing[]) => void;
    onToolDone?: () => void;
    onLayout?: (panes: PaneBox[]) => void;
    onScale?: (s: ScaleState) => void;
    /** Viewport changed (fractional bar indices, bar spacing). Fired after a redraw. */
    onView?: (v: { from: number; to: number; spacing: number }) => void;
    onClick?: (p: PointerInfo) => void;
    onDblClick?: (p: PointerInfo) => void;
    /** Runs at the start of every redraw (coalesced work such as indicator recalculation). */
    onBeforeDraw?: () => void;
    /** A pane separator drag finished: slot heights (px) by pane id. */
    onPaneResize?: (sizes: Record<string, number>) => void;
  };
  private layers: EngineLayer[] = [];
  private delegate: InteractionDelegate | null = null;
  private extCross: { index: number; price: number | null } | null = null;
  private lastView = "";
  private downAt: { x: number; y: number; t: number } | null = null;
  private lastLayoutKey = "";

  private container: HTMLElement;
  private opts: { crosshair: boolean; pricePrecision?: number; theme: Partial<Theme> | null; utcOffsetSeconds?: number; scaleMode?: EngineOptions["scaleMode"]; timeFormatter?: EngineOptions["timeFormatter"] } = { crosshair: true, theme: null };

  constructor(container: HTMLElement, cb: ChartEngine["cb"] = {}) {
    this.container = container;
    this.cb = cb;
    this.theme = readTheme();
    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "block";
    this.canvas.style.touchAction = "none";
    this.canvas.style.cursor = "crosshair";
    this.canvas.tabIndex = 0;
    this.canvas.style.outline = "none";
    this.canvas.setAttribute("role", "img");
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.canvas.addEventListener("pointermove", this.onMove);
    this.canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointerleave", this.onLeave);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("dblclick", this.onDbl);
    this.canvas.addEventListener("keydown", this.onKey);
    window.addEventListener("txp-theme", this.onTheme);
    this.resize();
  }

  private destroyed = false;

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    if (this.base) {
      this.base.width = this.base.height = 0; // release the cached frame's pixels
      this.base = null;
    }
    this.ro.disconnect();
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("txp-theme", this.onTheme);
    this.canvas.remove();
    // Drop references to chart data and callbacks so a destroyed engine holds nothing alive.
    this.data = { bars: [], type: "candles", overlays: [], panes: [] };
    this.drawings = [];
    this.layouts = [];
    this.cb = {};
  }

  setCallbacks(cb: ChartEngine["cb"]) {
    this.cb = cb;
  }

  setData(d: ChartData, keepView = false) {
    const prevLen = this.data.bars.length;
    this.data = d;
    this.canvas.setAttribute("aria-label", `Price chart with ${d.bars.length} bars`);
    if (!keepView || prevLen === 0) this.fit();
    else this.endIndex += d.bars.length - prevLen;
    this.invalidate();
  }

  setTool(t: DrawingTool) {
    this.tool = t;
    this.pending = null;
    if (t !== "none") this.selected = -1;
    this.invalidate();
  }

  setDrawings(d: Drawing[]) {
    this.drawings = d;
    if (this.selected >= d.length) this.selected = -1;
    this.invalidate();
  }

  deleteSelected() {
    if (this.selected < 0) return;
    this.drawings = this.drawings.filter((_, i) => i !== this.selected);
    this.selected = -1;
    this.cb.onDrawingsChange?.(this.drawings);
    this.invalidate();
  }

  setScale(s: Partial<ScaleState> & { range?: [number, number] }) {
    if (s.range) {
      const T = (v: number) => (this.scale.log ? Math.log(Math.max(v, 1e-9)) : v);
      this.scale.min = T(s.range[0]);
      this.scale.max = T(s.range[1]);
    }
    if (s.log !== undefined && s.log !== this.scale.log) {
      const conv = s.log ? (x: number) => Math.log(Math.max(x, 1e-9)) : Math.exp;
      this.scale.min = conv(this.scale.min);
      this.scale.max = conv(this.scale.max);
      this.scale.log = s.log;
    }
    if (s.auto !== undefined) this.scale.auto = s.auto;
    this.emitScale();
    this.invalidate();
  }

  zoom(factor: number) {
    this.zoomAt(factor, this.plotW() - 1);
  }

  /** Renderer options (crosshair on/off, fixed price precision, theme colours). */
  setOptions(o: EngineOptions) {
    if (o.crosshair !== undefined) this.opts.crosshair = o.crosshair;
    if ("pricePrecision" in o) this.opts.pricePrecision = o.pricePrecision;
    if (o.utcOffsetSeconds !== undefined) this.opts.utcOffsetSeconds = o.utcOffsetSeconds;
    if (o.scaleMode !== undefined && o.scaleMode !== this.opts.scaleMode) {
      this.opts.scaleMode = o.scaleMode;
      // Manual ranges are stored in transformed space: re-fit after a mode change.
      this.scale.auto = true;
      this.emitScale();
    }
    if ("timeFormatter" in o) this.opts.timeFormatter = o.timeFormatter ?? null;
    if ("theme" in o) {
      this.opts.theme = o.theme ?? null;
      this.theme = { ...readTheme(), ...(this.opts.theme ?? {}) };
    }
    this.invalidate();
  }

  /** Visible window in fractional bar indices (from = left edge, to = right edge). */
  getViewRange(): { from: number; to: number } {
    // Bar-centre indices: inverse of setViewRange.
    return { from: this.indexAt(0) + 0.5, to: this.endIndex };
  }

  /** Duration of the most recent canvas redraw, in milliseconds (diagnostics / benchmarks). */
  lastDrawMs = 0;

  /** Shows bar indices [from, to] across the plot width (to may lie past the last bar). */
  setViewRange(from: number, to: number) {
    if (!(to > from)) return;
    this.spacing = Math.max(0.5, Math.min(60, this.plotW() / (to - from + 1)));
    this.endIndex = to;
    this.invalidate();
  }

  /** Scrolls by a number of bars (positive = towards newer bars). */
  scrollBy(bars: number) {
    this.endIndex += bars;
    this.clampView();
    this.invalidate();
  }

  /** Scrolls so the newest bar is at the right edge, keeping the zoom level. */
  scrollToEnd() {
    this.endIndex = this.data.bars.length - 1 + 3;
    this.invalidate();
  }

  /**
   * Redraw after the current ChartData was mutated in place. When `appended` bars were added and
   * the newest bar was in view, the view follows the new bars (like a live chart).
   */
  refresh(appended = 0) {
    if (appended > 0) {
      const lastBefore = this.data.bars.length - 1 - appended;
      if (this.endIndex >= lastBefore) this.endIndex += appended;
    }
    this.invalidate();
  }

  /** Custom render layers (replaces the previous set). */
  setLayers(layers: EngineLayer[]) {
    this.layers = layers;
    this.invalidate();
  }
  setInteraction(d: InteractionDelegate | null) {
    this.delegate = d;
  }
  /** Shows a crosshair at a bar index when the pointer is not over this chart (chart synchronisation). */
  setCrosshair(c: { index: number; price: number | null } | null) {
    this.extCross = c;
    this.invalidateOverlay();
  }
  requestRedraw() {
    this.invalidate();
  }
  /** Public geometry (CSS px relative to the canvas). */
  xOfIndex(i: number) {
    return this.xOf(i);
  }
  indexOfX(x: number) {
    return this.indexAt(x);
  }
  getPlotWidth() {
    return this.plotW();
  }
  getSpacing() {
    return this.spacing;
  }
  setSpacing(px: number) {
    if (!(px > 0)) return;
    this.spacing = px;
    this.clampView();
    this.invalidate();
  }
  /** Pane rectangles from the last layout ("main" first). */
  getPanes(): PaneBox[] {
    return this.layouts.map((l, i) => ({ id: i === 0 ? "main" : l.spec!.id, top: l.top, height: l.height }));
  }
  priceToY(p: number, paneId = "main", scaleId = "right"): number | null {
    const L = this.layoutOf(paneId, scaleId);
    if (!L || !Number.isFinite(p) || (L.log && p <= 0)) return null;
    return this.yOf(p, L);
  }
  yToPrice(y: number, paneId = "main", scaleId = "right"): number | null {
    const L = this.layoutOf(paneId, scaleId);
    return L ? this.priceAt(y, L) : null;
  }
  private layoutOf(id: string, scaleId = "right") {
    const L = id === "main" ? this.layouts[0] : this.layouts.find((l) => l.spec?.id === id);
    if (!L || scaleId === "right") return L;
    return L.scales?.get(scaleId);
  }
  /** PNG data URL of the current chart, re-rendered at `scale` × CSS pixels. */
  toDataURL(scale = this.dpr): string {
    const prev = this.dpr;
    const s = Math.max(0.5, Math.min(8, scale));
    this.dpr = s;
    this.canvas.width = Math.round(this.w * s);
    this.canvas.height = Math.round(this.h * s);
    this.drawFrame();
    this.baseValid = false;
    const url = this.canvas.toDataURL("image/png");
    this.dpr = prev;
    this.canvas.width = this.w * prev;
    this.canvas.height = this.h * prev;
    this.drawFrame();
    return url;
  }

  private pointer(e: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; pointerType?: string }, x: number, y: number): PointerInfo {
    const k = this.paneAt(y);
    const L = k >= 0 ? this.layouts[k] : undefined;
    return {
      x, y, index: this.indexAt(x), price: L ? this.priceAt(y, L) : null,
      paneId: k < 0 ? null : k === 0 ? "main" : L!.spec!.id,
      shift: !!e.shiftKey, ctrl: !!(e.ctrlKey || e.metaKey), pointerType: e.pointerType ?? "mouse",
    };
  }

  fit = () => {
    const n = this.data.bars.length;
    const visible = Math.min(n, Math.max(30, Math.floor(this.plotW() / 8)));
    this.spacing = Math.max(2, Math.min(40, this.plotW() / Math.max(visible, 1)));
    this.endIndex = n - 1 + 3 + Math.min(this.future(), visible * 0.35);
    this.scale.auto = true;
    this.emitScale();
    this.invalidate();
  };

  private emitScale() {
    this.cb.onScale?.({ auto: this.scale.auto, log: this.scale.log });
  }

  // ---------- geometry ----------
  private plotW() {
    return Math.max(10, this.w - AXIS_W);
  }
  private xOf(i: number) {
    return this.plotW() - (this.endIndex - i) * this.spacing - this.spacing / 2;
  }
  private indexAt(x: number) {
    return this.endIndex - (this.plotW() - x - this.spacing / 2) / this.spacing;
  }
  private visibleRange(): [number, number] {
    const n = this.data.bars.length;
    return [Math.max(0, Math.floor(this.indexAt(0))), Math.min(n - 1, Math.ceil(this.endIndex))];
  }
  private timeOfIndex(i: number): number {
    const b = this.data.bars;
    if (!b.length) return 0;
    const step = b.length > 1 ? b[b.length - 1].t - b[b.length - 2].t : 86400;
    if (i <= 0) return b[0].t + i * step;
    if (i >= b.length - 1) return b[b.length - 1].t + (i - (b.length - 1)) * step;
    const lo = Math.floor(i);
    return b[lo].t + (i - lo) * (b[lo + 1].t - b[lo].t);
  }
  private indexOfTime(t: number): number {
    const b = this.data.bars;
    if (!b.length) return 0;
    const step = b.length > 1 ? b[b.length - 1].t - b[b.length - 2].t : 86400;
    if (t <= b[0].t) return (t - b[0].t) / step;
    if (t >= b[b.length - 1].t) return b.length - 1 + (t - b[b.length - 1].t) / step;
    let lo = 0;
    let hi = b.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (b[mid].t <= t) lo = mid;
      else hi = mid;
    }
    return lo + (t - b[lo].t) / (b[hi].t - b[lo].t || 1);
  }
  private tf(p: number, L: PaneLayout) {
    if (L.log) return Math.log(Math.max(p, 1e-9));
    if (L.mode === "pct") return (p / L.base! - 1) * 100;
    if (L.mode === "idx") return (p / L.base!) * 100;
    return p;
  }
  private yOf(p: number, L: PaneLayout) {
    const f = (this.tf(p, L) - L.min) / (L.max - L.min || 1);
    return L.top + (L.invert ? f : 1 - f) * L.height;
  }
  private priceAt(y: number, L: PaneLayout) {
    const f = (y - L.top) / L.height;
    const v = L.min + (L.invert ? f : 1 - f) * (L.max - L.min);
    if (L.log) return Math.exp(v);
    if (L.mode === "pct") return (v / 100 + 1) * L.base!;
    if (L.mode === "idx") return (v / 100) * L.base!;
    return v;
  }
  /** Axis text of a main-pane price: the transformed value in percentage / indexed mode. */
  private axisValue(p: number, L: PaneLayout) {
    if (!L.mode) return this.fmtAxis(p);
    const v = this.tf(p, L);
    return L.mode === "pct" ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : v.toFixed(2);
  }
  private layoutFor(s: PlotSeries, L: PaneLayout) {
    return s.scale && s.scale !== "right" ? L.scales?.get(s.scale) ?? L : L;
  }
  /** Index k (≥ 1) of the pane whose top separator is within 4 px of y, or -1. */
  private separatorAt(y: number) {
    // Opt-in: only hosts that persist sizes (onPaneResize) get draggable separators.
    if (!this.cb.onPaneResize) return -1;
    for (let k = 1; k < this.layouts.length; k++) if (Math.abs(y - this.layouts[k].top) <= 4) return k;
    return -1;
  }
  private paneAt(y: number) {
    return this.layouts.findIndex((l) => y >= l.top && y <= l.top + l.height);
  }

  // ---------- events ----------
  private onTheme = () => {
    this.theme = { ...readTheme(), ...(this.opts.theme ?? {}) };
    this.invalidate();
  };

  private resize() {
    const r = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(50, Math.floor(r.width));
    const h = Math.max(80, Math.floor(r.height));
    // Re-assigning canvas.width clears it: skip when nothing changed (ResizeObserver fires on attach).
    if (w === this.w && h === this.h && dpr === this.dpr && this.canvas.width === w * dpr) return;
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.canvas.style.width = this.w + "px";
    this.canvas.style.height = this.h + "px";
    this.invalidate();
  }

  private local(e: PointerEvent | WheelEvent | MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private ptAt(x: number, y: number, L: PaneLayout): Pt {
    return { t: this.timeOfIndex(this.indexAt(x)), p: this.priceAt(y, L) };
  }

  /** Returns the drawing (and part) under the pointer, if any. */
  private hitDrawing(x: number, y: number): { index: number; part: "all" | "a" | "b" } | null {
    const L = this.layouts[0];
    if (!L) return null;
    const near = (ax: number, ay: number) => Math.hypot(ax - x, ay - y) < 7;
    const segDist = (x1: number, y1: number, x2: number, y2: number) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
      return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
    };
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      if (d.kind === "hline") {
        if (Math.abs(this.yOf(d.p, L) - y) < 6) return { index: i, part: "all" };
        continue;
      }
      const x1 = this.xOf(this.indexOfTime(d.a.t));
      const y1 = this.yOf(d.a.p, L);
      const x2 = this.xOf(this.indexOfTime(d.b.t));
      const y2 = this.yOf(d.b.p, L);
      if (near(x1, y1)) return { index: i, part: "a" };
      if (near(x2, y2)) return { index: i, part: "b" };
      if (d.kind === "trend" && segDist(x1, y1, x2, y2) < 6) return { index: i, part: "all" };
      if (d.kind === "ray") {
        const far = x2 + (x2 - x1) * 50;
        if (segDist(x1, y1, far, y2 + (y2 - y1) * 50) < 6) return { index: i, part: "all" };
      }
      if (d.kind === "rect" && x >= Math.min(x1, x2) - 4 && x <= Math.max(x1, x2) + 4 && y >= Math.min(y1, y2) - 4 && y <= Math.max(y1, y2) + 4) {
        return { index: i, part: "all" };
      }
      if (d.kind === "fib" && x >= Math.min(x1, x2) - 4) {
        for (const f of FIB) if (Math.abs(this.yOf(d.b.p + (d.a.p - d.b.p) * f, L) - y) < 5) return { index: i, part: "all" };
      }
    }
    return null;
  }

  private onMove = (e: PointerEvent) => {
    const p = this.local(e);
    this.mouse = p;
    const a = this.act;
    if (a?.kind === "delegate") {
      this.delegate?.move?.(this.pointer(e, p.x, p.y));
      this.invalidate();
      return;
    }
    if (a?.kind === "sep") {
      const h = [...a.h];
      const dy = p.y - a.y;
      const k = a.k;
      // Resize the separator's two neighbours; collapsed panes are skipped (their strip is fixed).
      let up = k - 1;
      while (up > 0 && this.layouts[up].collapsed) up--;
      const total = a.h[up] + a.h[k];
      h[up] = Math.max(MIN_PANE_H, Math.min(total - MIN_PANE_H, a.h[up] + dy));
      h[k] = total - h[up];
      const sizes: Record<string, number> = {};
      this.layouts.forEach((L, i) => (sizes[i === 0 ? "main" : L.spec!.id] = h[i]));
      this.data = { ...this.data, paneSizes: sizes };
      this.invalidate();
      return;
    }
    if (a?.kind === "pan") {
      this.endIndex = a.end + (a.x - p.x) / this.spacing;
      this.clampView();
      const dy = p.y - a.y;
      if (!a.vertical && Math.abs(dy) > 12) {
        a.vertical = true;
        if (this.scale.auto) {
          this.scale.auto = false;
          this.emitScale();
        }
      }
      if (a.vertical && this.layouts[0]) {
        const L = this.layouts[0];
        const per = (a.max - a.min) / L.height;
        this.scale.min = a.min + dy * per;
        this.scale.max = a.max + dy * per;
      }
    } else if (a?.kind === "axis") {
      const factor = Math.exp((p.y - a.y) / 150);
      const mid = (a.min + a.max) / 2;
      const half = ((a.max - a.min) / 2) * factor;
      this.scale.min = mid - half;
      this.scale.max = mid + half;
    } else if (a?.kind === "drawing" && this.layouts[0]) {
      const L = this.layouts[0];
      const cur = this.ptAt(p.x, p.y, L);
      const dt = cur.t - a.start.t;
      const o = a.orig;
      let next: Drawing;
      if (o.kind === "hline") next = { ...o, p: o.p + (cur.p - a.start.p) };
      else if (a.part === "a") next = { ...o, a: cur };
      else if (a.part === "b") next = { ...o, b: cur };
      else {
        const dp = cur.p - a.start.p;
        next = { ...o, a: { t: o.a.t + dt, p: o.a.p + dp }, b: { t: o.b.t + dt, p: o.b.p + dp } };
      }
      this.drawings = this.drawings.map((d, i) => (i === a.index ? next : d));
    } else if (!a && this.tool === "none") {
      const hit = p.x < this.plotW() ? this.hitDrawing(p.x, p.y) : null;
      const custom = p.x < this.plotW() && this.delegate?.hover ? this.delegate.hover(this.pointer(e, p.x, p.y)) : null;
      const sep = p.x < this.plotW() && this.separatorAt(p.y) > 0 && !this.layouts[this.separatorAt(p.y)].collapsed;
      this.canvas.style.cursor = sep ? "row-resize" : p.x >= this.plotW() ? "ns-resize" : custom ?? (hit ? (hit.part === "all" ? "move" : "pointer") : "crosshair");
      // Plain pointer movement only moves the crosshair.
      this.invalidateOverlay();
      return;
    }
    this.invalidate();
  };

  private onDown = (e: PointerEvent) => {
    const p = this.local(e);
    const main = this.layouts[0];
    this.canvas.focus({ preventScroll: true });
    if (!main) return;

    // Price axis: drag to stretch/compress the main scale.
    if (p.x >= this.plotW() && this.paneAt(p.y) === 0) {
      if (this.scale.auto) {
        this.scale.auto = false;
        this.emitScale();
      }
      this.act = { kind: "axis", y: p.y, min: this.scale.min, max: this.scale.max };
      this.canvas.setPointerCapture?.(e.pointerId);
      return;
    }

    // Pane separator: drag to resize the neighbouring panes.
    const sep = p.x < this.plotW() ? this.separatorAt(p.y) : -1;
    if (sep > 0 && !this.layouts[sep].collapsed) {
      this.act = { kind: "sep", k: sep, y: p.y, h: this.layouts.map((L, i) => (i === 0 ? L.height : L.height + PANE_GAP)) };
      this.canvas.setPointerCapture?.(e.pointerId);
      return;
    }

    this.downAt = { x: p.x, y: p.y, t: performance.now() };
    if (p.x < this.plotW() && this.delegate?.down?.(this.pointer(e, p.x, p.y))) {
      this.act = { kind: "delegate" };
      this.canvas.setPointerCapture?.(e.pointerId);
      this.invalidate();
      return;
    }

    const inMain = p.x < this.plotW() && p.y >= main.top && p.y <= main.top + main.height;
    if (this.tool !== "none" && inMain) {
      const pt = this.ptAt(p.x, p.y, main);
      if (this.tool === "hline") {
        this.drawings = [...this.drawings, { kind: "hline", p: pt.p, color: this.theme.draw }];
        this.finishTool();
      } else if (!this.pending) {
        this.pending = pt;
      } else {
        this.drawings = [...this.drawings, { kind: this.tool, a: this.pending, b: pt, color: this.theme.draw }];
        this.pending = null;
        this.finishTool();
      }
      this.invalidate();
      return;
    }

    if (inMain) {
      const hit = this.hitDrawing(p.x, p.y);
      if (hit) {
        this.selected = hit.index;
        this.act = { kind: "drawing", index: hit.index, part: hit.part, start: this.ptAt(p.x, p.y, main), orig: this.drawings[hit.index] };
        this.canvas.setPointerCapture?.(e.pointerId);
        this.invalidate();
        return;
      }
    }
    if (this.selected !== -1) {
      this.selected = -1;
      this.invalidate();
    }
    this.canvas.setPointerCapture?.(e.pointerId);
    this.act = { kind: "pan", x: p.x, y: p.y, end: this.endIndex, min: this.scale.min, max: this.scale.max, vertical: false };
    this.canvas.style.cursor = "grabbing";
  };

  private finishTool() {
    this.selected = this.drawings.length - 1;
    this.cb.onDrawingsChange?.(this.drawings);
    this.tool = "none";
    this.cb.onToolDone?.();
  }

  private onUp = (e?: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    const up = e ? { x: e.clientX - r.left, y: e.clientY - r.top } : null;
    if (this.act?.kind === "delegate" && up && e) this.delegate?.up?.(this.pointer(e, up.x, up.y));
    // A press released without moving is a click (not a pan).
    else if (this.act?.kind === "pan" && up && e && this.downAt && Math.hypot(up.x - this.downAt.x, up.y - this.downAt.y) < 4 && performance.now() - this.downAt.t < 600) {
      this.cb.onClick?.(this.pointer(e, up.x, up.y));
    }
    this.downAt = null;
    if (this.act?.kind === "drawing") this.cb.onDrawingsChange?.(this.drawings);
    if (this.act?.kind === "sep" && this.data.paneSizes) this.cb.onPaneResize?.({ ...this.data.paneSizes });
    this.act = null;
    this.canvas.style.cursor = "crosshair";
  };

  private onLeave = () => {
    if (!this.act) this.mouse = null;
    this.invalidateOverlay();
  };

  private onDbl = (e: MouseEvent) => {
    const p = this.local(e);
    if (p.x < this.plotW()) {
      const info = this.pointer(e, p.x, p.y);
      if (this.delegate?.dbl?.(info)) {
        this.invalidate();
        return;
      }
      this.cb.onDblClick?.(info);
    }
    if (p.x >= this.plotW()) {
      this.scale.auto = true;
      this.emitScale();
      this.invalidate();
    } else if (!this.hitDrawing(p.x, p.y)) this.fit();
  };

  private onKey = (e: KeyboardEvent) => {
    if (this.delegate?.key?.(e)) {
      e.preventDefault();
      this.invalidate();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && this.selected >= 0) {
      e.preventDefault();
      this.deleteSelected();
    } else if (e.key === "Escape") {
      this.selected = -1;
      this.pending = null;
      this.invalidate();
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
    if (p.x >= this.plotW() && this.paneAt(p.y) === 0) {
      if (this.scale.auto) {
        this.scale.auto = false;
        this.emitScale();
      }
      const f = e.deltaY > 0 ? 1.1 : 1 / 1.1;
      const mid = (this.scale.min + this.scale.max) / 2;
      const half = ((this.scale.max - this.scale.min) / 2) * f;
      this.scale.min = mid - half;
      this.scale.max = mid + half;
      this.invalidate();
      return;
    }
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      this.endIndex += e.deltaX / this.spacing;
      this.clampView();
      this.invalidate();
      return;
    }
    this.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x);
  };

  private zoomAt(factor: number, x: number) {
    const anchor = this.indexAt(x);
    this.spacing = Math.max(1.5, Math.min(60, this.spacing * factor));
    this.endIndex = anchor + (this.plotW() - x - this.spacing / 2) / this.spacing;
    this.clampView();
    this.invalidate();
  }

  private future() {
    return Math.max(0, this.data.future ?? 0);
  }

  private clampView() {
    const n = this.data.bars.length;
    const visible = this.plotW() / this.spacing;
    this.endIndex = Math.min(n - 1 + Math.max(visible * 0.6, this.future() + 3), Math.max(Math.min(visible * 0.3, n - 1), this.endIndex));
  }

  /** Time label for any index, including empty space past the last bar. */
  private timeLabelAt(i: number, long = false): string | null {
    const b = this.data.bars;
    if (i < 0 || !b.length) return null;
    const off = this.opts.utcOffsetSeconds ?? IST;
    const intra = !!this.data.intraday;
    // Price-based (logical) axis: elements have no time spacing, so empty slots past the last
    // element get no label (a projected date would be invented).
    if (this.data.derived && i >= b.length) return null;
    const t = i < b.length ? b[i].t : futureTime(b.slice(-60).map((x) => x.t), i - (b.length - 1), intra);
    const custom = this.opts.timeFormatter?.(t, intra, long);
    return custom ?? fmtTime(t, intra, long, off);
  }

  private invalidate() {
    if (this.destroyed) return;
    this.pendingFull = true;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  // ---------- drawing ----------
  private scaleSpec(pane: string, id: string): ScaleSpec | undefined {
    return this.data.scales?.find((x) => x.id === id && (x.pane ?? "main") === pane);
  }

  /** Layout of one independent scale: its own mode, autoscale or manual range, margins and inversion. */
  private fitLayout(series: PlotSeries[], top: number, height: number, from: number, to: number, spec: ScaleSpec | undefined, opts: { pad: number; levels?: number[]; range?: [number, number] }): PaneLayout {
    const L: PaneLayout = { top, height, min: 0, max: 1, log: spec?.mode === "log", invert: spec?.invert, fmt: spec?.format };
    if (spec?.mode === "percentage" || spec?.mode === "indexed") {
      let base = NaN;
      for (let i = from; i <= to && !Number.isFinite(base); i++) for (const s of series) if (Number.isFinite(s.values[i]) && s.values[i] !== 0) { base = s.values[i]; break; }
      if (Number.isFinite(base)) {
        L.mode = spec.mode === "percentage" ? "pct" : "idx";
        L.base = base;
      }
    }
    const T = (v: number) => this.tf(v, L);
    const manual = spec?.range ?? opts.range;
    if (manual) {
      L.min = T(manual[0]);
      L.max = T(manual[1]);
      return L;
    }
    let min = Infinity, max = -Infinity;
    const add = (v: number) => {
      if (!Number.isFinite(v) || (L.log && v <= 0)) return;
      const t = T(v);
      if (t < min) min = t;
      if (t > max) max = t;
    };
    const hi = Math.max(to, Math.ceil(this.endIndex));
    for (const s of series) {
      for (let i = from; i <= hi; i++) {
        const v = s.values[i];
        if (!Number.isFinite(v)) continue;
        add(v);
        if (s.style === "histogram" && !L.log) add(0);
      }
    }
    for (const l of opts.levels ?? []) add(l);
    if (!Number.isFinite(min)) {
      min = L.log ? 0 : 0;
      max = 1;
    }
    const pad = (max - min || Math.abs(max) * 0.01 || 1) * opts.pad;
    min -= pad;
    max += pad;
    const m = spec?.margins;
    if (m) {
      const free = Math.max(0.05, 1 - m.top - m.bottom);
      const r = max - min;
      [min, max] = [min - (r * m.bottom) / free, max + (r * m.top) / free];
    }
    L.min = min;
    L.max = max;
    return L;
  }

  /** Overlay scales of a pane (series whose `scale` is not the pane's right scale). */
  private overlayScales(paneId: string, series: PlotSeries[], top: number, height: number, from: number, to: number): Map<string, PaneLayout> | undefined {
    const groups = new Map<string, PlotSeries[]>();
    for (const s of series) if (s.scale && s.scale !== "right") groups.set(s.scale, [...(groups.get(s.scale) ?? []), s]);
    if (!groups.size) return undefined;
    const out = new Map<string, PaneLayout>();
    for (const [id, list] of groups) out.set(id, this.fitLayout(list, top, height, from, to, this.scaleSpec(paneId, id), { pad: 0.08 }));
    return out;
  }

  private computeLayouts(): PaneLayout[] {
    const panes = this.data.panes;
    const avail = this.h - TIME_H;
    const [from, to] = this.visibleRange();
    const out: PaneLayout[] = [];
    const log = this.scale.log;
    const bars = this.data.bars;
    const lineOnly = ["line", "area", "step", "baseline", "columns"].includes(this.data.type);
    const onMain = (s: PlotSeries) => !s.scale || s.scale === "right";

    // Percentage / indexed: base = first visible close (or the first visible main-scale value).
    let mode: PaneLayout["mode"];
    let base = NaN;
    const want = this.opts.scaleMode;
    if (!log && (want === "percentage" || want === "indexed")) {
      for (let i = from; i <= to && !Number.isFinite(base); i++) {
        if (bars[i] && Number.isFinite(bars[i].c)) base = bars[i].c;
        else for (const s of this.data.overlays) if (onMain(s) && Number.isFinite(s.values[i])) {
          base = s.values[i];
          break;
        }
      }
      if (Number.isFinite(base) && base !== 0) mode = want === "percentage" ? "pct" : "idx";
    }
    const T = (v: number) => (log ? Math.log(Math.max(v, 1e-9)) : mode === "pct" ? (v / base - 1) * 100 : mode === "idx" ? (v / base) * 100 : v);
    const margins = (id: string, min: number, max: number): [number, number] => {
      const m = this.scaleSpec("main", id)?.margins;
      if (!m) return [min, max];
      const free = Math.max(0.05, 1 - m.top - m.bottom);
      const r = max - min;
      return [min - (r * m.bottom) / free, max + (r * m.top) / free];
    };

    if (this.scale.auto) {
      let min = Infinity;
      let max = -Infinity;
      for (let i = from; i <= to; i++) {
        const b = bars[i];
        if (!b) continue;
        // Gap bars (NaN prices: no candle at this time) only carry a timestamp.
        if (Number.isFinite(b.c)) {
          min = Math.min(min, T(lineOnly ? b.c : b.l));
          max = Math.max(max, T(lineOnly ? b.c : b.h));
        }
        for (const s of this.data.overlays) {
          if (!onMain(s)) continue;
          const v = s.values[i];
          if (Number.isFinite(v) && (!log || v > 0)) {
            min = Math.min(min, T(v));
            max = Math.max(max, T(v));
          }
        }
      }
      // Overlays that continue past the last bar (projected cloud) stay in view too.
      for (let i = Math.max(to + 1, bars.length); i <= Math.ceil(this.endIndex); i++) {
        for (const s of this.data.overlays) {
          if (!onMain(s)) continue;
          const v = s.values[i];
          if (Number.isFinite(v) && (!log || v > 0)) {
            min = Math.min(min, T(v));
            max = Math.max(max, T(v));
          }
        }
      }
      if (!Number.isFinite(min)) {
        min = 0;
        max = 1;
      }
      const pad = (max - min || Math.abs(max) * 0.01 || 1) * 0.08;
      [this.scale.min, this.scale.max] = margins("right", min - pad, max + pad);
    }

    // Slot heights: explicit sizes (SDK / separator drag) or the default split; collapsed panes keep a title strip.
    const sizes = this.data.paneSizes;
    const ids = ["main", ...panes.map((p) => p.id)];
    const slots: number[] = new Array(ids.length).fill(0);
    const collapsedTotal = panes.filter((p) => p.collapsed).length * COLLAPSED_H;
    if (sizes && ids.some((id) => sizes[id] !== undefined)) {
      const defW = sizes.main !== undefined ? Math.max(...Object.values(sizes)) / 3 : 1;
      const w = ids.map((id, k) => (k > 0 && panes[k - 1].collapsed ? 0 : Math.max(0.0001, sizes[id] ?? (k === 0 ? defW * 3 : defW))));
      const sum = w.reduce((a, b) => a + b, 0);
      const free = Math.max(0, avail - collapsedTotal);
      ids.forEach((_, k) => (slots[k] = k > 0 && panes[k - 1].collapsed ? COLLAPSED_H : (free * w[k]) / sum));
    } else {
      const open = panes.filter((p) => !p.collapsed).length;
      const paneH = open ? Math.min(avail * 0.22, (avail * 0.5) / open) : 0;
      panes.forEach((p, k) => (slots[k + 1] = p.collapsed ? COLLAPSED_H : paneH));
      slots[0] = avail - slots.slice(1).reduce((a, b) => a + b, 0);
    }
    const mainH = Math.max(MIN_PANE_H, slots[0]);

    const main: PaneLayout = { top: 0, height: mainH, min: this.scale.min, max: this.scale.max, log, mode, base: mode ? base : undefined };
    // Overlay price scales: each with its own mode, range, margins and inversion.
    main.scales = this.overlayScales("main", this.data.overlays, 0, mainH, from, to);
    const rs = this.scaleSpec("main", "right");
    if (rs?.invert) main.invert = true;
    if (rs?.format) main.fmt = rs.format;
    out.push(main);

    let top = mainH;
    panes.forEach((spec, k) => {
      const slot = slots[k + 1];
      const ptop = top + PANE_GAP, ph = Math.max(1, slot - PANE_GAP);
      const own = spec.series.filter((s) => !s.scale || s.scale === "right");
      const L = this.fitLayout(own, ptop, ph, from, to, this.scaleSpec(spec.id, "right"), { pad: 0.1, levels: spec.levels, range: spec.range });
      L.spec = spec;
      L.collapsed = spec.collapsed;
      L.scales = this.overlayScales(spec.id, spec.series, ptop, ph, from, to);
      out.push(L);
      top += slot;
    });
    return out;
  }

  private draw() {
    const t0 = performance.now();
    const full = this.pendingFull || !this.baseValid || !this.base || this.base.width !== this.canvas.width || this.base.height !== this.canvas.height;
    this.pendingFull = false;
    if (!full) {
      // Crosshair-only frame: restore the cached frame, draw the crosshair on top.
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.drawImage(this.base!, 0, 0);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.drawCrosshair();
      this.lastOverlayMs = performance.now() - t0;
      this.frames.overlay++;
      return;
    }
    this.drawFrame();
    // Cache the frame only while the crosshair is moving: copying the canvas forces a synchronous
    // raster flush, which data/pan frames without pointer activity should not pay.
    if (this.overlayActive) this.snapshot();
    else this.baseValid = false;
    this.overlayActive = false;
    this.drawCrosshair();
    this.lastDrawMs = performance.now() - t0;
    this.frames.full++;
  }

  private snapshot() {
    try {
      if (!this.base) this.base = this.canvas.ownerDocument.createElement("canvas");
      if (this.base.width !== this.canvas.width || this.base.height !== this.canvas.height) {
        this.base.width = this.canvas.width;
        this.base.height = this.canvas.height;
      }
      const b = this.base.getContext("2d");
      if (!b) return void (this.baseValid = false);
      b.clearRect(0, 0, this.base.width, this.base.height);
      b.drawImage(this.canvas, 0, 0);
      this.baseValid = true;
    } catch {
      this.baseValid = false;
    }
  }

  /** Schedules a crosshair-only redraw (falls back to a full frame when one is already pending). */
  private invalidateOverlay() {
    if (this.destroyed) return;
    this.overlayActive = true;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  private drawFrame() {
    this.cb.onBeforeDraw?.();
    const { ctx } = this;
    const th = this.theme;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    const bars = this.data.bars;
    this.layouts = this.computeLayouts();
    const [from, to] = this.visibleRange();
    const pw = this.plotW();
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "middle";

    const key = this.layouts.map((l, i) => `${i}:${Math.round(l.top)}:${Math.round(l.height)}`).join("|");
    if (key !== this.lastLayoutKey) {
      this.lastLayoutKey = key;
      this.cb.onLayout?.(this.layouts.map((l, i) => ({ id: i === 0 ? "main" : l.spec!.id, top: l.top, height: l.height })));
    }

    const timeY = this.h - TIME_H;
    ctx.strokeStyle = th.axis;
    ctx.beginPath();
    ctx.moveTo(0, timeY + 0.5);
    ctx.lineTo(this.w, timeY + 0.5);
    ctx.moveTo(pw + 0.5, 0);
    ctx.lineTo(pw + 0.5, this.h);
    ctx.stroke();
    // Empty space to the right of the last candle (where projections are drawn) is tinted slightly.
    if (bars.length) {
      const xLast = this.xOf(bars.length - 1) + this.spacing / 2;
      if (xLast < pw) {
        ctx.fillStyle = th.future;
        ctx.fillRect(Math.max(0, xLast), 0, pw - Math.max(0, xLast), timeY);
      }
    }
    const labelEvery = Math.max(1, Math.ceil(90 / this.spacing));
    ctx.fillStyle = th.text;
    ctx.textAlign = "center";
    const lastIdx = Math.floor(this.endIndex);
    for (let i = Math.ceil(from / labelEvery) * labelEvery; i <= lastIdx; i += labelEvery) {
      const x = this.xOf(i);
      if (x > pw - 20) break;
      ctx.strokeStyle = th.grid;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, timeY);
      ctx.stroke();
      const label = this.timeLabelAt(i);
      if (label) {
        ctx.fillStyle = i >= bars.length ? withOpacity(th.text) : th.text;
        ctx.fillText(label, x, timeY + TIME_H / 2);
      }
    }

    const tags: { y: number; text: string; color: string }[] = [];
    this.layouts.forEach((L, k) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, L.top, pw, L.height);
      ctx.clip();
      if (L.collapsed) {
        ctx.restore();
        ctx.strokeStyle = th.axis;
        ctx.beginPath();
        ctx.moveTo(0, L.top - 0.5);
        ctx.lineTo(this.w, L.top - 0.5);
        ctx.stroke();
        ctx.fillStyle = th.text;
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`▸ ${L.spec?.title ?? ""}`, 6, L.top + L.height / 2);
        ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
        return;
      }
      const ticks = this.ticks(L);
      ctx.strokeStyle = th.grid;
      for (const t of ticks) {
        const y = Math.round(this.yOf(t.v, L)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(pw, y);
        ctx.stroke();
      }
      const series = k === 0 ? this.data.overlays : (L.spec?.series ?? []);
      const paneId = k === 0 ? "main" : L.spec!.id;
      if (k === 0) {
        this.drawLayers(L, paneId, "below", from, to, tags);
        for (const s of series) for (const f of s.fills ?? []) this.drawFill(s, f, this.layoutFor(s, L), from);
        this.drawMain(L, from, to);
        for (const s of series) this.drawSeries(s, this.layoutFor(s, L), from, to);
        this.drawMarkers(L, from, to);
        this.drawDrawings(L);
        this.drawLayers(L, paneId, "above", from, to, tags);
      } else if (L.spec) {
        this.drawLayers(L, paneId, "below", from, to, tags);
        for (const b of L.spec.bands ?? []) {
          const y1 = this.yOf(Math.max(b.from, b.to), L);
          const y2 = this.yOf(Math.min(b.from, b.to), L);
          ctx.fillStyle = b.color;
          ctx.fillRect(0, y1, pw, y2 - y1);
        }
        for (const lv of L.spec.levels ?? []) {
          const y = Math.round(this.yOf(lv, L)) + 0.5;
          // Zero line solid; other levels dashed.
          ctx.setLineDash(lv === 0 ? [] : [4, 4]);
          ctx.strokeStyle = lv === 0 ? th.zero : th.level;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(pw, y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        for (const s of series) for (const f of s.fills ?? []) this.drawFill(s, f, this.layoutFor(s, L), from);
        for (const s of series) this.drawSeries(s, this.layoutFor(s, L), from, to);
        this.drawLayers(L, paneId, "above", from, to, tags);
      }
      ctx.restore();
      if (k > 0) {
        ctx.strokeStyle = th.axis;
        ctx.beginPath();
        ctx.moveTo(0, L.top - 0.5);
        ctx.lineTo(this.w, L.top - 0.5);
        ctx.stroke();
      }
      this.drawPriceAxis(L, ticks);
      const left = L.scales?.get("left");
      if (left && this.scaleSpec(paneId, "left")?.visible !== false) this.drawLeftAxis(left);
      // Last-value labels on the price scale for series that ask for it.
      for (const s of series) {
        if (!s.scaleLabel || s.style === "histogram") continue;
        let j = Math.min(to, s.values.length - 1);
        while (j >= 0 && !Number.isFinite(s.values[j])) j--;
        if (j < 0) continue;
        const SL = this.layoutFor(s, L);
        // Overlay scales other than the main one have no right-axis labels (their values are on another range).
        if (SL !== L) continue;
        const y = this.yOf(s.values[j], L);
        if (y >= L.top && y <= L.top + L.height) tags.push({ y, text: k === 0 && L.mode ? this.axisValue(s.values[j], L) : fmtValue(s.values[j], s.precision), color: s.color });
      }
    });

    let li = bars.length - 1;
    while (li >= 0 && !Number.isFinite(bars[li].c)) li--;
    const real = this.data.lastPrice;
    const last = li >= 0 ? (real ? { ...bars[li], c: real.price } : bars[li]) : undefined;
    const main = this.layouts[0];
    if (last && main) {
      const y = this.yOf(last.c, main);
      if (y >= main.top && y <= main.top + main.height) {
        const prev = real ? (real.prev === null ? undefined : { c: real.prev }) : li > 0 ? bars[li - 1] : undefined;
        const col = !prev || last.c >= prev.c ? th.up : th.down;
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(pw, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        tags.push({ y, text: this.axisValue(last.c, main), color: col });
      }
    }
    // Keep overlapping tags readable: later (more important) tags win; the last price is drawn last.
    for (const t of tags) this.axisTag(t.y, t.text, t.color, contrastText(t.color));

    // Scale mode badge.
    if (main) {
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillStyle = th.text;
      const kind = this.scale.log ? "LOG" : main.mode === "pct" ? "%" : main.mode === "idx" ? "IDX 100" : "";
      const badge = [kind, this.scale.auto ? "" : "MANUAL"].filter(Boolean).join(" · ");
      if (badge) ctx.fillText(badge, this.w - 6, main.top + main.height - 8);
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    }

    const view = { from: this.indexAt(0) + 0.5, to: this.endIndex, spacing: this.spacing };
    const vk = `${view.from.toFixed(4)}|${view.to.toFixed(4)}|${view.spacing.toFixed(4)}|${bars.length}`;
    if (vk !== this.lastView) {
      this.lastView = vk;
      this.cb.onView?.(view);
    }
  }

  private drawLayers(L: PaneLayout, paneId: string, z: "below" | "above", from: number, to: number, tags: { y: number; text: string; color: string }[]) {
    if (!this.layers.length) return;
    const api: LayerApi = {
      ctx: this.ctx,
      theme: this.theme,
      pane: { id: paneId, top: L.top, height: L.height, width: this.plotW() },
      from, to, spacing: this.spacing, barCount: this.data.bars.length,
      xOfIndex: (i) => this.xOf(i),
      indexOfX: (x) => this.indexAt(x),
      yOfPrice: (p) => this.yOf(p, L),
      priceOfY: (y) => this.priceAt(y, L),
      bar: (i) => this.data.bars[i],
      axisLabel: (y, text, bg) => {
        if (y >= L.top && y <= L.top + L.height) tags.push({ y, text, color: bg });
      },
      scaleY: (id, p) => {
        const S = id === "right" ? L : L.scales?.get(id);
        return S && Number.isFinite(p) && !(S.log && p <= 0) ? this.yOf(p, S) : null;
      },
      scalePrice: (id, y) => {
        const S = id === "right" ? L : L.scales?.get(id);
        return S ? this.priceAt(y, S) : null;
      },
    };
    for (const layer of this.layers) {
      if ((layer.pane ?? "main") !== paneId || (layer.z ?? "above") !== z) continue;
      this.ctx.save();
      try {
        layer.draw(api);
      } catch (e) {
        // A failing custom layer must not break the chart.
        console.error("[chart] layer failed", e);
      }
      this.ctx.restore();
    }
  }

  private ticks(L: PaneLayout): { v: number; step: number }[] {
    const target = Math.max(2, Math.floor(L.height / 45));
    if (!L.log) {
      const step = niceStep(L.max - L.min, target);
      const out: { v: number; step: number }[] = [];
      // Ticks are nice numbers in (transformed) axis space; `v` is returned as a price.
      const inv = (u: number) => (L.mode === "pct" ? (u / 100 + 1) * L.base! : L.mode === "idx" ? (u / 100) * L.base! : u);
      for (let u = Math.ceil(L.min / step) * step; u <= L.max; u += step) out.push({ v: inv(u), step });
      return out;
    }
    const lo = Math.exp(L.min);
    const hi = Math.exp(L.max);
    const step = niceStep(hi - lo, target * 2);
    const out: { v: number; step: number }[] = [];
    let lastY = Infinity;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = this.yOf(v, L);
      if (lastY - y >= 22) {
        out.push({ v, step });
        lastY = y;
      }
    }
    return out;
  }

  /** Labels of the "left" overlay scale, drawn inside the plot's left edge. */
  private drawLeftAxis(L: PaneLayout) {
    const { ctx } = this;
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    for (const t of this.ticks(L)) {
      const y = this.yOf(t.v, L);
      if (y < L.top + 6 || y > L.top + L.height - 6) continue;
      const text = L.fmt ? L.fmt(L.mode ? this.tf(t.v, L) : t.v) : L.mode ? (L.mode === "pct" ? `${fmtPrice(this.tf(t.v, L), t.step)}%` : fmtPrice(this.tf(t.v, L), t.step)) : fmtPrice(t.v, t.step);
      const w = ctx.measureText(text).width + 6;
      ctx.fillStyle = withAlpha(this.theme.bg, 0.75);
      ctx.fillRect(0, y - 7, w, 14);
      ctx.fillStyle = this.theme.text;
      ctx.fillText(text, 3, y);
    }
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  }

  private drawPriceAxis(L: PaneLayout, ticks: { v: number; step: number }[]) {
    const { ctx } = this;
    ctx.fillStyle = this.theme.text;
    ctx.textAlign = "left";
    const taken: number[] = [];
    for (const lv of L.spec?.levels ?? []) {
      const y = this.yOf(lv, L);
      if (y < L.top + 6 || y > L.top + L.height - 6) continue;
      ctx.fillText(fmtPrice(lv, 1), this.plotW() + 6, y);
      taken.push(y);
    }
    for (const t of ticks) {
      const y = this.yOf(t.v, L);
      if (y < L.top + 6 || y > L.top + L.height - 6 || taken.some((u) => Math.abs(u - y) < 12)) continue;
      const text = L.fmt ? L.fmt(L.mode ? this.tf(t.v, L) : t.v) : L.mode ? (L.mode === "pct" ? `${fmtPrice(this.tf(t.v, L), t.step)}%` : fmtPrice(this.tf(t.v, L), t.step)) : L === this.layouts[0] && this.opts.pricePrecision !== undefined ? this.fmtAxis(t.v) : fmtPrice(t.v, t.step);
      ctx.fillText(text, this.plotW() + 6, y);
    }
  }

  /** Derived chart types on the logical axis. Provisional points are drawn translucent. */
  private drawDerived(L: PaneLayout, from: number, to: number) {
    const D = this.data.derived!;
    const { ctx } = this;
    const bars = this.data.bars;
    const sp = this.spacing;
    const alpha = (p: DerivedRenderPoint) => (p.status === "provisional" ? 0.45 : 1);
    if (D.kind === "kagi") {
      const yang = D.yangWidth ?? 3, yin = D.yinWidth ?? 1;
      const seg = (x1: number, y1: number, x2: number, y2: number, thick: boolean, a: number) => {
        ctx.globalAlpha = a;
        ctx.strokeStyle = thick ? D.up : D.down;
        ctx.lineWidth = thick ? yang : yin;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      };
      ctx.lineCap = "square";
      for (let i = Math.max(0, from - 1); i <= Math.min(to, bars.length - 1); i++) {
        const p = D.points[i];
        const b = bars[i];
        const x = Math.round(this.xOf(i)) + 0.5;
        const a = alpha(p);
        const ys = this.yOf(b.o, L), ye = this.yOf(b.c, L);
        if (p.switchPrice !== undefined && p.thickStart !== p.thickEnd) {
          const yw = this.yOf(p.switchPrice, L);
          seg(x, ys, x, yw, !!p.thickStart, a);
          seg(x, yw, x, ye, !!p.thickEnd, a);
        } else seg(x, ys, x, ye, !!p.thickEnd, a);
        if (i + 1 < bars.length) seg(x, ye, Math.round(this.xOf(i + 1)) + 0.5, ye, !!p.thickEnd, alpha(D.points[i + 1]));
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      ctx.lineCap = "butt";
      return;
    }
    if (D.kind === "point-and-figure" && D.boxLevel) {
      const lvl = D.boxLevel;
      const w = Math.max(3, sp * 0.8);
      ctx.lineWidth = Math.max(1, Math.min(2, sp / 8));
      for (let i = from; i <= Math.min(to, bars.length - 1); i++) {
        const p = D.points[i];
        if (p.lowBox === undefined || p.highBox === undefined) continue;
        const x = this.xOf(i);
        ctx.globalAlpha = alpha(p);
        const isX = p.direction > 0;
        ctx.strokeStyle = isX ? D.up : D.down;
        // Skip boxes outside the pane quickly.
        for (let k = p.lowBox; k <= p.highBox; k++) {
          const yc = this.yOf(lvl(k), L);
          const h = Math.max(2, Math.abs(this.yOf(lvl(k + 1), L) - this.yOf(lvl(k - 1), L)) / 2 * 0.85);
          if (yc < L.top - h || yc > L.top + L.height + h) continue;
          const hw = Math.min(w, h) / 2;
          ctx.beginPath();
          if (isX) {
            ctx.moveTo(x - hw, yc - h / 2);
            ctx.lineTo(x + hw, yc + h / 2);
            ctx.moveTo(x + hw, yc - h / 2);
            ctx.lineTo(x - hw, yc + h / 2);
          } else ctx.ellipse(x, yc, hw, h / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      return;
    }
    const brick = D.kind === "renko" || D.kind === "line-break";
    const bodyW = brick ? Math.max(1, sp - Math.max(1, Math.floor(sp * 0.1))) : Math.max(1, Math.floor(sp * 0.7));
    for (let i = from; i <= Math.min(to, bars.length - 1); i++) {
      const b = bars[i];
      const p = D.points[i];
      const col = p.direction > 0 ? D.up : D.down;
      const x = Math.round(this.xOf(i));
      const yo = this.yOf(b.o, L), yc = this.yOf(b.c, L);
      ctx.globalAlpha = alpha(p);
      if (D.wicks || D.kind === "range-bars") {
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, this.yOf(b.h, L));
        ctx.lineTo(x + 0.5, this.yOf(b.l, L));
        ctx.stroke();
      }
      ctx.fillStyle = col;
      const top = Math.min(yo, yc), hgt = Math.max(1, Math.abs(yc - yo));
      ctx.fillRect(x - Math.floor(bodyW / 2), top, bodyW, hgt);
      if (brick && bodyW > 4) {
        ctx.strokeStyle = this.theme.bg;
        ctx.strokeRect(x - Math.floor(bodyW / 2) + 0.5, top + 0.5, bodyW - 1, Math.max(0, hgt - 1));
      }
      if (p.complete === false) {
        // Forming range bar: dashed outline.
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = col;
        ctx.strokeRect(x - Math.floor(bodyW / 2) - 1.5, top - 1.5, bodyW + 3, hgt + 3);
        ctx.setLineDash([]);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawMain(L: PaneLayout, from: number, to: number) {
    if (this.data.derived) return this.drawDerived(L, from, to);
    const { ctx } = this;
    const th = this.theme;
    const bars = this.data.bars;
    const type = this.data.type;
    const ms = this.data.mainStyle ?? {};
    if (type === "columns") {
      const w = Math.max(1, Math.floor(this.spacing * 0.6));
      const bottom = L.top + L.height;
      for (let i = from; i <= to; i++) {
        const b = bars[i];
        if (!Number.isFinite(b.c)) continue;
        const prev = bars[i - 1];
        ctx.fillStyle = prev && Number.isFinite(prev.c) && b.c < prev.c ? ms.down ?? th.down : ms.up ?? th.up;
        const y = this.yOf(b.c, L);
        ctx.fillRect(Math.round(this.xOf(i)) - Math.floor(w / 2), y, w, Math.max(1, bottom - y));
      }
      return;
    }
    if (type === "line" || type === "area" || type === "step" || type === "baseline") {
      // Last-known close carries across gaps for the step type only.
      const pts: [number, number][] = [];
      for (let i = from; i <= to; i++) if (Number.isFinite(bars[i].c)) pts.push([this.xOf(i), this.yOf(bars[i].c, L)]);
      const path = () => {
        ctx.beginPath();
        pts.forEach(([x, y], k) => {
          if (!k) ctx.moveTo(x, y);
          else {
            if (type === "step") ctx.lineTo(x, pts[k - 1][1]);
            ctx.lineTo(x, y);
          }
        });
      };
      if (!pts.length) return;
      const lw = ms.lineWidth ?? 1.6;
      if (type === "baseline") {
        let base = ms.baseline;
        if (base === undefined) for (let i = from; i <= to && base === undefined; i++) if (Number.isFinite(bars[i].c)) base = bars[i].c;
        const yb = Math.max(L.top, Math.min(L.top + L.height, this.yOf(base ?? 0, L)));
        const up = ms.up ?? th.up, down = ms.down ?? th.down;
        for (const [color, y0, y1] of [[up, L.top, yb], [down, yb, L.top + L.height]] as const) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, y0, this.plotW(), y1 - y0);
          ctx.clip();
          path();
          ctx.lineTo(pts[pts.length - 1][0], yb);
          ctx.lineTo(pts[0][0], yb);
          ctx.closePath();
          ctx.globalAlpha = 0.18;
          ctx.fillStyle = color;
          ctx.fill();
          ctx.globalAlpha = 1;
          path();
          ctx.strokeStyle = color;
          ctx.lineWidth = lw;
          ctx.stroke();
          ctx.restore();
        }
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = th.level;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(yb) + 0.5);
        ctx.lineTo(this.plotW(), Math.round(yb) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        return;
      }
      const lineColor = ms.line ?? (type === "area" ? "#38bdf8" : th.line);
      if (type === "area") {
        path();
        ctx.lineTo(pts[pts.length - 1][0], L.top + L.height);
        ctx.lineTo(pts[0][0], L.top + L.height);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, L.top, 0, L.top + L.height);
        g.addColorStop(0, ms.areaTop ?? "rgba(56,189,248,0.28)");
        g.addColorStop(1, ms.areaBottom ?? "rgba(56,189,248,0)");
        ctx.fillStyle = g;
        ctx.fill();
      }
      path();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.lineWidth = 1;
      if (ms.markers) {
        ctx.fillStyle = lineColor;
        const r = Math.max(1.5, Math.min(3.5, this.spacing / 4));
        for (const [x, y] of pts) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }
    const bodyW = Math.max(1, Math.floor(this.spacing * 0.7));
    const cc = this.data.candle;
    for (let i = from; i <= to; i++) {
      const b = bars[i];
      if (!Number.isFinite(b.c)) continue; // gap: no candle at this time
      const x = Math.round(this.xOf(i));
      const upBar = b.c >= b.o;
      const col = upBar ? cc?.up ?? th.up : cc?.down ?? th.down;
      ctx.strokeStyle = (upBar ? cc?.wickUp : cc?.wickDown) ?? col;
      ctx.fillStyle = col;
      const yh = this.yOf(b.h, L);
      const yl = this.yOf(b.l, L);
      const yo = this.yOf(b.o, L);
      const yc = this.yOf(b.c, L);
      if (type === "hilo") {
        // High-low range bar (no open/close).
        ctx.fillStyle = col;
        ctx.fillRect(x - Math.floor(bodyW / 2), yh, bodyW, Math.max(1, yl - yh));
        continue;
      }
      if (type === "hollow" && upBar) {
        // Hollow candle: rising bars are outlined, falling bars filled.
        ctx.beginPath();
        ctx.moveTo(x + 0.5, yh);
        ctx.lineTo(x + 0.5, Math.min(yo, yc));
        ctx.moveTo(x + 0.5, Math.max(yo, yc));
        ctx.lineTo(x + 0.5, yl);
        ctx.stroke();
        ctx.strokeStyle = col;
        ctx.strokeRect(x - Math.floor(bodyW / 2) + 0.5, Math.min(yo, yc) + 0.5, Math.max(1, bodyW - 1), Math.max(1, Math.abs(yc - yo)));
        continue;
      }
      if (type === "bars") {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, yh);
        ctx.lineTo(x + 0.5, yl);
        ctx.moveTo(x - bodyW / 2, yo);
        ctx.lineTo(x + 0.5, yo);
        ctx.moveTo(x + 0.5, yc);
        ctx.lineTo(x + bodyW / 2 + 0.5, yc);
        ctx.stroke();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(x + 0.5, yh);
      ctx.lineTo(x + 0.5, yl);
      ctx.stroke();
      ctx.fillRect(x - Math.floor(bodyW / 2), Math.min(yo, yc), bodyW, Math.max(1, Math.abs(yc - yo)));
    }
  }

  /** Shades between a series and its partner (series or level), switching colour exactly where they cross. */
  private drawFill(s: PlotSeries, f: PlotFill, L: PaneLayout, from: number) {
    const { ctx } = this;
    // Series may run past the last bar (e.g. the projected Ichimoku cloud).
    const end = Math.max(this.visibleRange()[1] + 1, Math.ceil(this.endIndex) + 1);
    const polys = fillPolys(s.values, f.other, Math.max(0, from - 1), end, f.only);
    const ok = (v: number) => !(L.log && v <= 0);
    // One path per colour: neighbouring segments merge into a single seamless shape.
    for (const up of [true, false]) {
      ctx.beginPath();
      let any = false;
      for (const poly of polys) {
        if (poly.up !== up || !poly.pts.every(([, v]) => ok(v))) continue;
        poly.pts.forEach(([i, v], k) => (k ? ctx.lineTo(this.xOf(i), this.yOf(v, L)) : ctx.moveTo(this.xOf(i), this.yOf(v, L))));
        ctx.closePath();
        any = true;
      }
      if (!any) continue;
      ctx.fillStyle = up ? f.up : f.down;
      ctx.fill("nonzero");
    }
  }

  /** Gradient fill under a line series, down to its baseline value or the pane bottom; breaks at gaps. */
  private drawArea(s: PlotSeries, L: PaneLayout, from: number) {
    const { ctx } = this;
    const a = s.area!;
    const end = Math.min(Math.max(this.visibleRange()[1] + 1, Math.ceil(this.endIndex) + 1), s.values.length - 1);
    const base = a.baseline !== undefined ? Math.max(L.top, Math.min(L.top + L.height, this.yOf(a.baseline, L))) : L.top + L.height;
    const g = ctx.createLinearGradient(0, L.top, 0, base);
    g.addColorStop(0, a.top);
    g.addColorStop(1, a.bottom);
    ctx.fillStyle = g;
    let run: [number, number][] = [];
    const flush = () => {
      if (run.length > 1) {
        ctx.beginPath();
        ctx.moveTo(run[0][0], base);
        for (const [x, y] of run) ctx.lineTo(x, y);
        ctx.lineTo(run[run.length - 1][0], base);
        ctx.closePath();
        ctx.fill();
      }
      run = [];
    };
    for (let i = Math.max(0, from - 1); i <= end; i++) {
      const v = s.values[i];
      if (!Number.isFinite(v) || (L.log && v <= 0)) {
        flush();
        continue;
      }
      run.push([this.xOf(i), this.yOf(v, L)]);
    }
    flush();
  }

  private drawSeries(s: PlotSeries, L: PaneLayout, from: number, to: number) {
    const { ctx } = this;
    const style = s.style ?? "line";
    if (style === "histogram") {
      const w = Math.max(1, Math.floor(this.spacing * 0.6));
      const zero = this.yOf(Math.max(L.min, Math.min(L.max, 0)), L);
      for (let i = from; i <= to; i++) {
        const v = s.values[i];
        if (!Number.isFinite(v)) continue;
        const y = this.yOf(v, L);
        const prev = s.values[i - 1];
        const h = s.hist;
        const bar = this.data.bars[i];
        ctx.fillStyle =
          h?.mode === "candle" && bar ? (bar.c >= bar.o ? h.colors[0] : h.colors[1])
          : h?.mode === "trend" ? h.colors[histTone(v, prev)]
          : h?.mode === "sign" ? (v >= 0 ? h.colors[0] : h.colors[1])
          : s.color;
        ctx.fillRect(Math.round(this.xOf(i)) - Math.floor(w / 2), Math.min(y, zero), w, Math.max(1, Math.abs(zero - y)));
      }
      return;
    }
    if (style === "dots") {
      ctx.fillStyle = s.color;
      for (let i = from; i <= to; i++) {
        const v = s.values[i];
        if (!Number.isFinite(v)) continue;
        ctx.beginPath();
        ctx.arc(this.xOf(i), this.yOf(v, L), Math.max(1.2, Math.min(2.5, this.spacing / 4)) * ((s.width ?? 1.4) / 1.4), 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    if (s.area) this.drawArea(s, L, from);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width ?? 1.4;
    ctx.globalAlpha = s.opacity ?? 1;
    ctx.lineJoin = "round";
    ctx.setLineDash(s.dash === "dashed" ? [6, 4] : s.dash === "dotted" ? [1.5, 3] : []);
    ctx.beginPath();
    let pen = false;
    let prevY = 0;
    for (let i = Math.max(0, from - 1); i <= Math.min(Math.max(to + 1, Math.ceil(this.endIndex) + 1), s.values.length - 1); i++) {
      const v = s.values[i];
      if (!Number.isFinite(v) || (L.log && v <= 0)) {
        pen = false;
        continue;
      }
      const x = this.xOf(i);
      const y = this.yOf(v, L);
      if (!pen) ctx.moveTo(x, y);
      else {
        if (s.step) ctx.lineTo(x, prevY);
        ctx.lineTo(x, y);
      }
      prevY = y;
      pen = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (s.pointMarkers) {
      ctx.fillStyle = s.color;
      const r = Math.max(1.5, Math.min(3.5, this.spacing / 4));
      for (let i = Math.max(0, from); i <= Math.min(to, s.values.length - 1); i++) {
        const v = s.values[i];
        if (!Number.isFinite(v) || (L.log && v <= 0)) continue;
        ctx.beginPath();
        ctx.arc(this.xOf(i), this.yOf(v, L), r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
  }

  private drawMarkers(L: PaneLayout, from: number, to: number) {
    const { ctx } = this;
    ctx.textAlign = "center";
    ctx.font = "bold 10px ui-sans-serif, system-ui, sans-serif";
    for (const m of this.data.markers ?? []) {
      if (m.index < from || m.index > to) continue;
      const b = this.data.bars[m.index];
      const x = this.xOf(m.index);
      const above = m.position === "above";
      const y = this.yOf(above ? b.h : b.l, L) + (above ? -10 : 10);
      ctx.fillStyle = m.color;
      ctx.beginPath();
      if (above) {
        ctx.moveTo(x, y + 6);
        ctx.lineTo(x - 4, y);
        ctx.lineTo(x + 4, y);
      } else {
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x - 4, y);
        ctx.lineTo(x + 4, y);
      }
      ctx.fill();
      if (m.text) ctx.fillText(m.text, x, y + (above ? -7 : 8));
    }
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  }

  private drawDrawings(L: PaneLayout) {
    const { ctx } = this;
    const pw = this.plotW();
    const all: Drawing[] = [...this.drawings];
    if (this.pending && this.mouse && this.tool !== "none" && this.tool !== "hline") {
      all.push({ kind: this.tool, a: this.pending, b: this.ptAt(this.mouse.x, this.mouse.y, L), color: this.theme.draw });
    }
    ctx.textAlign = "left";
    all.forEach((d, idx) => {
      const sel = idx === this.selected;
      ctx.lineWidth = sel ? 2.2 : 1.4;
      ctx.strokeStyle = d.color;
      ctx.fillStyle = d.color;
      const handles: [number, number][] = [];
      if (d.kind === "hline") {
        const y = this.yOf(d.p, L);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(pw, y);
        ctx.stroke();
        ctx.fillText(fmtPrice(d.p), 6, y - 8);
        if (sel) handles.push([pw / 2, y]);
      } else {
        const x1 = this.xOf(this.indexOfTime(d.a.t));
        const x2 = this.xOf(this.indexOfTime(d.b.t));
        const y1 = this.yOf(d.a.p, L);
        const y2 = this.yOf(d.b.p, L);
        handles.push([x1, y1], [x2, y2]);
        if (d.kind === "trend" || d.kind === "ray") {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          if (d.kind === "ray" && x2 !== x1) {
            const k = (pw - x1) / (x2 - x1);
            ctx.lineTo(x2 > x1 ? pw : 0, x2 > x1 ? y1 + (y2 - y1) * k : y1 + (y2 - y1) * (-x1 / (x2 - x1)));
          } else ctx.lineTo(x2, y2);
          ctx.stroke();
        } else if (d.kind === "rect") {
          ctx.globalAlpha = 0.12;
          ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
          ctx.globalAlpha = 1;
          ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        } else if (d.kind === "fib") {
          const left = Math.min(x1, x2);
          for (const f of FIB) {
            const p = d.b.p + (d.a.p - d.b.p) * f;
            const y = this.yOf(p, L);
            ctx.globalAlpha = f === 0 || f === 1 ? 0.9 : 0.6;
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(pw, y);
            ctx.stroke();
            ctx.fillText(`${(f * 100).toFixed(1)}%  ${fmtPrice(p)}`, left + 4, y - 7);
          }
          ctx.globalAlpha = 1;
        }
      }
      for (const [x, y] of handles) {
        if (!sel && d.kind !== "trend" && d.kind !== "ray") continue;
        ctx.beginPath();
        ctx.arc(x, y, sel ? 4.5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = sel ? this.theme.bg : d.color;
        ctx.fill();
        ctx.strokeStyle = sel ? this.theme.select : d.color;
        ctx.stroke();
      }
    });
    ctx.lineWidth = 1;
  }

  private fmtAxis(v: number) {
    return this.opts.pricePrecision !== undefined ? fmtValue(v, this.opts.pricePrecision) : fmtPrice(v);
  }

  private axisTag(y: number, text: string, bg: string, fg: string) {
    const { ctx } = this;
    const x = this.plotW() + 2;
    const w = AXIS_W - 4;
    const top = Math.max(1, Math.min(this.h - TIME_H - 19, y - 9));
    ctx.fillStyle = bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, top, w, 18, 3);
    else ctx.rect(x, top, w, 18);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    ctx.fillText(text, x + 4, top + 9);
  }

  private drawCrosshair() {
    const m = this.mouse;
    const bars = this.data.bars;
    if (!m && this.extCross && bars.length) {
      // Synchronised crosshair from another chart: draw only, no pointer event.
      const { ctx } = this;
      const x = Math.round(this.xOf(this.extCross.index)) + 0.5;
      if (x >= 0 && x <= this.plotW()) {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = this.theme.cross;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this.h - TIME_H);
        const L = this.layouts[0];
        if (L && this.extCross.price !== null) {
          const y = Math.round(this.yOf(this.extCross.price, L)) + 0.5;
          ctx.moveTo(0, y);
          ctx.lineTo(this.plotW(), y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (!m || !bars.length || m.x > this.plotW() || m.y > this.h - TIME_H || this.act?.kind === "axis") {
      this.cb.onCrosshair?.(null);
      return;
    }
    const iHover = Math.max(0, Math.min(bars.length - 1 + this.future(), Math.round(this.indexAt(m.x))));
    const mainL = this.layouts[0];
    const overMain = mainL && m.y >= mainL.top && m.y <= mainL.top + mainL.height;
    const info = { index: iHover, bar: bars[iHover] ?? null, price: overMain ? this.priceAt(m.y, mainL) : null, time: this.timeOfIndex(iHover) };
    if (!this.opts.crosshair) {
      this.cb.onCrosshair?.(info);
      return;
    }
    const { ctx } = this;
    const i = iHover;
    const x = Math.round(this.xOf(i)) + 0.5;
    const y = Math.round(m.y) + 0.5;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = this.theme.cross;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, this.h - TIME_H);
    ctx.moveTo(0, y);
    ctx.lineTo(this.plotW(), y);
    ctx.stroke();
    ctx.setLineDash([]);
    const L = this.layouts[this.paneAt(m.y)];
    if (L) {
      const span = L.log ? Math.exp(L.max) - Math.exp(L.min) : L.max - L.min;
      const p = this.priceAt(m.y, L);
      this.axisTag(m.y, L === this.layouts[0] ? (L.mode ? this.axisValue(p, L) : this.opts.pricePrecision !== undefined ? this.fmtAxis(p) : fmtPrice(p, span / 50)) : fmtPrice(p, span / 50), this.theme.tag, this.theme.tagText);
    }
    const label = this.timeLabelAt(i, true) ?? "";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = this.theme.tag;
    ctx.fillRect(x - tw / 2, this.h - TIME_H + 2, tw, TIME_H - 4);
    ctx.fillStyle = this.theme.tagText;
    ctx.textAlign = "center";
    ctx.fillText(label, x, this.h - TIME_H / 2);
    this.cb.onCrosshair?.(info);
  }
}
