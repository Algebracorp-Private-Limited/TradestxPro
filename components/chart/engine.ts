// TradestXPro chart engine: a dependency-free canvas renderer for OHLC charts with
// overlays, indicator panes, crosshair, zoom/pan (both axes), log/auto price scale and
// editable drawings. Colours follow the site theme (CSS variables).
import type { Bar } from "@/lib/ta/catalog";

export type PlotStyle = "line" | "histogram" | "dots" | "area";
export type PlotSeries = { label: string; values: number[]; color: string; style?: PlotStyle; width?: number; scaleLabel?: boolean };
export type PaneSpec = { id: string; title: string; series: PlotSeries[]; levels?: number[]; range?: [number, number] };
export type Marker = { index: number; text: string; color: string; position: "above" | "below" };
export type ChartType = "candles" | "bars" | "line" | "area";

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
};

export type CrosshairInfo = { index: number; bar: Bar | null } | null;
export type PaneBox = { id: string; top: number; height: number };
export type ScaleState = { auto: boolean; log: boolean };

type Theme = { bg: string; grid: string; axis: string; text: string; strong: string; up: string; down: string; cross: string; tag: string; tagText: string; line: string; draw: string; select: string };

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

const IST = 19800;
function fmtTime(t: number, intraday: boolean, long = false): string {
  const d = new Date((t + (intraday ? IST : 0)) * 1000);
  const mon = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  if (!intraday) return long ? `${day} ${mon} ${d.getUTCFullYear()}` : `${day} ${mon}`;
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return long ? `${day} ${mon} ${hm}` : hm;
}

/** Pane layout. For the main pane with a log scale, min/max are stored in log space. */
type PaneLayout = { top: number; height: number; min: number; max: number; log: boolean; spec?: PaneSpec };

type Interaction =
  | { kind: "pan"; x: number; y: number; end: number; min: number; max: number; vertical: boolean }
  | { kind: "axis"; y: number; min: number; max: number }
  | { kind: "drawing"; index: number; part: "all" | "a" | "b"; start: Pt; orig: Drawing };

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
  };
  private lastLayoutKey = "";

  constructor(private container: HTMLElement, cb: ChartEngine["cb"] = {}) {
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

  destroy() {
    cancelAnimationFrame(this.frame);
    this.ro.disconnect();
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("txp-theme", this.onTheme);
    this.canvas.remove();
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

  setScale(s: Partial<ScaleState>) {
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

  fit = () => {
    const n = this.data.bars.length;
    const visible = Math.min(n, Math.max(30, Math.floor(this.plotW() / 8)));
    this.spacing = Math.max(2, Math.min(40, this.plotW() / Math.max(visible, 1)));
    this.endIndex = n - 1 + 3;
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
    return L.log ? Math.log(Math.max(p, 1e-9)) : p;
  }
  private yOf(p: number, L: PaneLayout) {
    return L.top + (1 - (this.tf(p, L) - L.min) / (L.max - L.min || 1)) * L.height;
  }
  private priceAt(y: number, L: PaneLayout) {
    const v = L.min + (1 - (y - L.top) / L.height) * (L.max - L.min);
    return L.log ? Math.exp(v) : v;
  }
  private paneAt(y: number) {
    return this.layouts.findIndex((l) => y >= l.top && y <= l.top + l.height);
  }

  // ---------- events ----------
  private onTheme = () => {
    this.theme = readTheme();
    this.invalidate();
  };

  private resize() {
    const r = this.container.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(50, Math.floor(r.width));
    this.h = Math.max(80, Math.floor(r.height));
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
      this.canvas.style.cursor = p.x >= this.plotW() ? "ns-resize" : hit ? (hit.part === "all" ? "move" : "pointer") : "crosshair";
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

  private onUp = () => {
    if (this.act?.kind === "drawing") this.cb.onDrawingsChange?.(this.drawings);
    this.act = null;
    this.canvas.style.cursor = "crosshair";
  };

  private onLeave = () => {
    if (!this.act) this.mouse = null;
    this.invalidate();
  };

  private onDbl = (e: MouseEvent) => {
    const p = this.local(e);
    if (p.x >= this.plotW()) {
      this.scale.auto = true;
      this.emitScale();
      this.invalidate();
    } else if (!this.hitDrawing(p.x, p.y)) this.fit();
  };

  private onKey = (e: KeyboardEvent) => {
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

  private clampView() {
    const n = this.data.bars.length;
    const visible = this.plotW() / this.spacing;
    this.endIndex = Math.min(n - 1 + visible * 0.6, Math.max(Math.min(visible * 0.3, n - 1), this.endIndex));
  }

  private invalidate() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  // ---------- drawing ----------
  private computeLayouts(): PaneLayout[] {
    const panes = this.data.panes;
    const avail = this.h - TIME_H;
    const paneH = panes.length ? Math.min(avail * 0.22, (avail * 0.5) / panes.length) : 0;
    const mainH = avail - paneH * panes.length;
    const [from, to] = this.visibleRange();
    const out: PaneLayout[] = [];
    const log = this.scale.log;
    const T = (v: number) => (log ? Math.log(Math.max(v, 1e-9)) : v);

    if (this.scale.auto) {
      let min = Infinity;
      let max = -Infinity;
      const bars = this.data.bars;
      const lineOnly = this.data.type === "line" || this.data.type === "area";
      for (let i = from; i <= to; i++) {
        const b = bars[i];
        if (!b) continue;
        min = Math.min(min, T(lineOnly ? b.c : b.l));
        max = Math.max(max, T(lineOnly ? b.c : b.h));
        for (const s of this.data.overlays) {
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
      this.scale.min = min - pad;
      this.scale.max = max + pad;
    }
    out.push({ top: 0, height: mainH, min: this.scale.min, max: this.scale.max, log });

    let top = mainH;
    for (const spec of panes) {
      let pmin = Infinity;
      let pmax = -Infinity;
      if (spec.range) [pmin, pmax] = spec.range;
      else {
        for (let i = from; i <= to; i++) {
          for (const s of spec.series) {
            const v = s.values[i];
            if (Number.isFinite(v)) {
              pmin = Math.min(pmin, v, s.style === "histogram" ? 0 : v);
              pmax = Math.max(pmax, v, s.style === "histogram" ? 0 : v);
            }
          }
        }
        for (const l of spec.levels ?? []) {
          pmin = Math.min(pmin, l);
          pmax = Math.max(pmax, l);
        }
        if (!Number.isFinite(pmin)) {
          pmin = 0;
          pmax = 1;
        }
        const pp = (pmax - pmin || 1) * 0.1;
        pmin -= pp;
        pmax += pp;
      }
      out.push({ top: top + PANE_GAP, height: paneH - PANE_GAP, min: pmin, max: pmax, log: false, spec });
      top += paneH;
    }
    return out;
  }

  private draw() {
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
    const labelEvery = Math.max(1, Math.ceil(90 / this.spacing));
    ctx.fillStyle = th.text;
    ctx.textAlign = "center";
    for (let i = Math.ceil(from / labelEvery) * labelEvery; i <= to; i += labelEvery) {
      const x = this.xOf(i);
      ctx.strokeStyle = th.grid;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, timeY);
      ctx.stroke();
      if (bars[i]) ctx.fillText(fmtTime(bars[i].t, !!this.data.intraday), x, timeY + TIME_H / 2);
    }

    const tags: { y: number; text: string; color: string }[] = [];
    this.layouts.forEach((L, k) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, L.top, pw, L.height);
      ctx.clip();
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
      if (k === 0) {
        this.drawMain(L, from, to);
        for (const s of series) this.drawSeries(s, L, from, to);
        this.drawMarkers(L, from, to);
        this.drawDrawings(L);
      } else if (L.spec) {
        for (const lv of L.spec.levels ?? []) {
          const y = Math.round(this.yOf(lv, L)) + 0.5;
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = th.axis;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(pw, y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        for (const s of series) this.drawSeries(s, L, from, to);
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
      // Last-value labels on the price scale for series that ask for it.
      for (const s of series) {
        if (!s.scaleLabel || s.style === "histogram") continue;
        let j = Math.min(to, s.values.length - 1);
        while (j >= 0 && !Number.isFinite(s.values[j])) j--;
        if (j < 0) continue;
        const y = this.yOf(s.values[j], L);
        if (y >= L.top && y <= L.top + L.height) tags.push({ y, text: fmtPrice(s.values[j]), color: s.color });
      }
    });

    const last = bars[bars.length - 1];
    const main = this.layouts[0];
    if (last && main) {
      const y = this.yOf(last.c, main);
      if (y >= main.top && y <= main.top + main.height) {
        const prev = bars[bars.length - 2];
        const col = !prev || last.c >= prev.c ? th.up : th.down;
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(pw, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        tags.push({ y, text: fmtPrice(last.c), color: col });
      }
    }
    for (const t of tags) this.axisTag(t.y, t.text, t.color, "#fff");

    // Scale mode badge.
    if (main) {
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillStyle = th.text;
      const badge = `${this.scale.log ? "LOG" : ""}${this.scale.log && !this.scale.auto ? " · " : ""}${this.scale.auto ? "" : "MANUAL"}`;
      if (badge) ctx.fillText(badge, this.w - 6, main.top + main.height - 8);
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    }

    this.drawCrosshair();
  }

  private ticks(L: PaneLayout): { v: number; step: number }[] {
    const target = Math.max(2, Math.floor(L.height / 45));
    if (!L.log) {
      const step = niceStep(L.max - L.min, target);
      const out: { v: number; step: number }[] = [];
      for (let v = Math.ceil(L.min / step) * step; v <= L.max; v += step) out.push({ v, step });
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
      ctx.fillText(fmtPrice(t.v, t.step), this.plotW() + 6, y);
    }
  }

  private drawMain(L: PaneLayout, from: number, to: number) {
    const { ctx } = this;
    const th = this.theme;
    const bars = this.data.bars;
    const type = this.data.type;
    if (type === "line" || type === "area") {
      const path = () => {
        ctx.beginPath();
        for (let i = from; i <= to; i++) {
          const x = this.xOf(i);
          const y = this.yOf(bars[i].c, L);
          if (i === from) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      };
      if (type === "area" && to >= from) {
        path();
        ctx.lineTo(this.xOf(to), L.top + L.height);
        ctx.lineTo(this.xOf(from), L.top + L.height);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, L.top, 0, L.top + L.height);
        g.addColorStop(0, "rgba(56,189,248,0.28)");
        g.addColorStop(1, "rgba(56,189,248,0)");
        ctx.fillStyle = g;
        ctx.fill();
      }
      path();
      ctx.strokeStyle = type === "area" ? "#38bdf8" : th.line;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.lineWidth = 1;
      return;
    }
    const bodyW = Math.max(1, Math.floor(this.spacing * 0.7));
    for (let i = from; i <= to; i++) {
      const b = bars[i];
      const x = Math.round(this.xOf(i));
      const col = b.c >= b.o ? th.up : th.down;
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      const yh = this.yOf(b.h, L);
      const yl = this.yOf(b.l, L);
      const yo = this.yOf(b.o, L);
      const yc = this.yOf(b.c, L);
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
        ctx.fillStyle =
          s.label === "Volume" && this.data.bars[i]
            ? this.data.bars[i].c >= this.data.bars[i].o ? "rgba(34,197,94,0.55)" : "rgba(244,63,94,0.55)"
            : v >= 0
              ? Number.isFinite(prev) && v < prev ? "rgba(34,197,94,0.45)" : "rgba(34,197,94,0.85)"
              : Number.isFinite(prev) && v > prev ? "rgba(244,63,94,0.45)" : "rgba(244,63,94,0.85)";
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
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width ?? 1.4;
    ctx.beginPath();
    let pen = false;
    for (let i = Math.max(0, from - 1); i <= Math.min(to + 1, s.values.length - 1); i++) {
      const v = s.values[i];
      if (!Number.isFinite(v) || (L.log && v <= 0)) {
        pen = false;
        continue;
      }
      const x = this.xOf(i);
      const y = this.yOf(v, L);
      if (!pen) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      pen = true;
    }
    ctx.stroke();
    ctx.lineWidth = 1;
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

  private axisTag(y: number, text: string, bg: string, fg: string) {
    const { ctx } = this;
    ctx.fillStyle = bg;
    ctx.fillRect(this.plotW() + 1, y - 9, AXIS_W - 2, 18);
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    ctx.fillText(text, this.plotW() + 6, y);
  }

  private drawCrosshair() {
    const m = this.mouse;
    const bars = this.data.bars;
    if (!m || !bars.length || m.x > this.plotW() || m.y > this.h - TIME_H || this.act?.kind === "axis") {
      this.cb.onCrosshair?.(null);
      return;
    }
    const { ctx } = this;
    const i = Math.max(0, Math.min(bars.length - 1, Math.round(this.indexAt(m.x))));
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
      this.axisTag(m.y, fmtPrice(this.priceAt(m.y, L), span / 50), this.theme.tag, this.theme.tagText);
    }
    const label = fmtTime(bars[i].t, !!this.data.intraday, true);
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = this.theme.tag;
    ctx.fillRect(x - tw / 2, this.h - TIME_H + 2, tw, TIME_H - 4);
    ctx.fillStyle = this.theme.tagText;
    ctx.textAlign = "center";
    ctx.fillText(label, x, this.h - TIME_H / 2);
    this.cb.onCrosshair?.({ index: i, bar: bars[i] });
  }
}
