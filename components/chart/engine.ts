// TradestXPro chart engine: a dependency-free canvas renderer for OHLC charts with
// overlays, indicator panes, crosshair, zoom/pan and drawing tools.
import type { Bar } from "@/lib/ta/catalog";

export type PlotStyle = "line" | "histogram" | "dots" | "area";
export type PlotSeries = { label: string; values: number[]; color: string; style?: PlotStyle };
export type PaneSpec = { id: string; title: string; series: PlotSeries[]; levels?: number[]; range?: [number, number] };
export type Marker = { index: number; text: string; color: string; position: "above" | "below" };
export type ChartType = "candles" | "bars" | "line" | "area";

export type DrawingTool = "none" | "trend" | "hline" | "fib" | "rect";
export type Drawing =
  | { kind: "trend" | "fib" | "rect"; a: { t: number; p: number }; b: { t: number; p: number }; color: string }
  | { kind: "hline"; p: number; color: string };

export type ChartData = {
  bars: Bar[];
  type: ChartType;
  overlays: PlotSeries[];
  panes: PaneSpec[];
  markers?: Marker[];
  intraday?: boolean;
};

export type CrosshairInfo = { index: number; bar: Bar | null; values: { label: string; color: string; value: number }[] } | null;

const THEME = {
  bg: "#05070b",
  grid: "rgba(255,255,255,0.05)",
  axis: "rgba(255,255,255,0.10)",
  text: "#8b95a7",
  textStrong: "#e5e9f0",
  up: "#22c55e",
  down: "#f43f5e",
  cross: "rgba(196,203,216,0.45)",
  label: "#1f2937",
  line: "#e5e9f0",
  draw: "#f5c451",
};

const AXIS_W = 68;
const TIME_H = 26;
const PANE_GAP = 1;
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

function niceStep(range: number, targetTicks: number): number {
  const raw = range / Math.max(1, targetTicks);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * pow;
}

function fmtPrice(v: number, step = 0): string {
  if (step > 0 && Math.abs(v) < step / 1e6) v = 0;
  const abs = Math.abs(v);
  if (abs >= 1e7) return (v / 1e7).toFixed(2) + "Cr";
  if (abs >= 1e5 && step >= 1000) return (v / 1e5).toFixed(2) + "L";
  const dp = step > 0 ? Math.max(0, Math.min(6, -Math.floor(Math.log10(step)) + 1)) : abs >= 1000 ? 2 : abs >= 1 ? 2 : 4;
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

type PaneLayout = { top: number; height: number; min: number; max: number; spec?: PaneSpec };

export class ChartEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ro: ResizeObserver;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private data: ChartData = { bars: [], type: "candles", overlays: [], panes: [] };
  private spacing = 8;
  private endIndex = 0; // index (float) of the bar at the right edge of the plot area
  private mouse: { x: number; y: number } | null = null;
  private drag: { x: number; end: number } | null = null;
  private frame = 0;
  private layouts: PaneLayout[] = [];
  private tool: DrawingTool = "none";
  private drawings: Drawing[] = [];
  private pending: { t: number; p: number } | null = null;
  private onCross?: (c: CrosshairInfo) => void;
  private onDrawingsChange?: (d: Drawing[]) => void;
  private onToolDone?: () => void;

  constructor(
    private container: HTMLElement,
    opts: { onCrosshair?: (c: CrosshairInfo) => void; onDrawingsChange?: (d: Drawing[]) => void; onToolDone?: () => void } = {},
  ) {
    this.onCross = opts.onCrosshair;
    this.onDrawingsChange = opts.onDrawingsChange;
    this.onToolDone = opts.onToolDone;
    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "block";
    this.canvas.style.touchAction = "none";
    this.canvas.style.cursor = "crosshair";
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
    this.canvas.addEventListener("dblclick", this.fit);
    this.resize();
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.ro.disconnect();
    window.removeEventListener("pointerup", this.onUp);
    this.canvas.remove();
  }

  setData(d: ChartData, keepView = false) {
    const prevLen = this.data.bars.length;
    this.data = d;
    const n = d.bars.length;
    this.canvas.setAttribute("aria-label", `Price chart with ${n} bars`);
    if (!keepView || prevLen === 0) this.fit();
    else this.endIndex += n - prevLen;
    this.invalidate();
  }

  setTool(t: DrawingTool) {
    this.tool = t;
    this.pending = null;
    this.invalidate();
  }

  setDrawings(d: Drawing[]) {
    this.drawings = d;
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
    this.invalidate();
  };

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
    const from = Math.max(0, Math.floor(this.indexAt(0)));
    const to = Math.min(n - 1, Math.ceil(this.endIndex));
    return [from, to];
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
  private yOf(p: number, L: PaneLayout) {
    return L.top + (1 - (p - L.min) / (L.max - L.min || 1)) * L.height;
  }
  private priceAt(y: number, L: PaneLayout) {
    return L.min + (1 - (y - L.top) / L.height) * (L.max - L.min);
  }

  // ---------- events ----------
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

  private onMove = (e: PointerEvent) => {
    const p = this.local(e);
    this.mouse = p;
    if (this.drag) {
      this.endIndex = this.drag.end + (this.drag.x - p.x) / this.spacing;
      this.clampView();
    }
    this.invalidate();
  };

  private onDown = (e: PointerEvent) => {
    const p = this.local(e);
    const main = this.layouts[0];
    if (this.tool !== "none" && main && p.x < this.plotW() && p.y >= main.top && p.y <= main.top + main.height) {
      const pt = { t: this.timeOfIndex(this.indexAt(p.x)), p: this.priceAt(p.y, main) };
      if (this.tool === "hline") {
        this.drawings = [...this.drawings, { kind: "hline", p: pt.p, color: THEME.draw }];
        this.finishTool();
      } else if (!this.pending) {
        this.pending = pt;
      } else {
        this.drawings = [...this.drawings, { kind: this.tool, a: this.pending, b: pt, color: THEME.draw }];
        this.pending = null;
        this.finishTool();
      }
      this.invalidate();
      return;
    }
    this.canvas.setPointerCapture?.(e.pointerId);
    this.drag = { x: p.x, end: this.endIndex };
    this.canvas.style.cursor = "grabbing";
  };

  private finishTool() {
    this.onDrawingsChange?.(this.drawings);
    this.tool = "none";
    this.onToolDone?.();
  }

  private onUp = () => {
    this.drag = null;
    this.canvas.style.cursor = "crosshair";
  };

  private onLeave = () => {
    if (!this.drag) this.mouse = null;
    this.invalidate();
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
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

    let min = Infinity;
    let max = -Infinity;
    const bars = this.data.bars;
    for (let i = from; i <= to; i++) {
      const b = bars[i];
      if (!b) continue;
      if (this.data.type === "line" || this.data.type === "area") {
        min = Math.min(min, b.c);
        max = Math.max(max, b.c);
      } else {
        min = Math.min(min, b.l);
        max = Math.max(max, b.h);
      }
      for (const s of this.data.overlays) {
        const v = s.values[i];
        if (Number.isFinite(v)) {
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
      }
    }
    if (!Number.isFinite(min)) {
      min = 0;
      max = 1;
    }
    const pad = (max - min || Math.abs(max) * 0.01 || 1) * 0.08;
    out.push({ top: 0, height: mainH, min: min - pad, max: max + pad });

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
      out.push({ top: top + PANE_GAP, height: paneH - PANE_GAP, min: pmin, max: pmax, spec });
      top += paneH;
    }
    return out;
  }

  private draw() {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    const bars = this.data.bars;
    this.layouts = this.computeLayouts();
    const [from, to] = this.visibleRange();
    const pw = this.plotW();
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "middle";

    // time grid + axis
    const timeY = this.h - TIME_H;
    ctx.strokeStyle = THEME.axis;
    ctx.beginPath();
    ctx.moveTo(0, timeY + 0.5);
    ctx.lineTo(this.w, timeY + 0.5);
    ctx.moveTo(pw + 0.5, 0);
    ctx.lineTo(pw + 0.5, this.h);
    ctx.stroke();
    const labelEvery = Math.max(1, Math.ceil(90 / this.spacing));
    ctx.fillStyle = THEME.text;
    ctx.textAlign = "center";
    for (let i = Math.ceil(from / labelEvery) * labelEvery; i <= to; i += labelEvery) {
      const x = this.xOf(i);
      ctx.strokeStyle = THEME.grid;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, timeY);
      ctx.stroke();
      if (bars[i]) ctx.fillText(fmtTime(bars[i].t, !!this.data.intraday), x, timeY + TIME_H / 2);
    }

    // panes
    this.layouts.forEach((L, k) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, L.top, pw, L.height);
      ctx.clip();
      this.drawPriceGrid(L);
      if (k === 0) {
        this.drawMain(L, from, to);
        for (const s of this.data.overlays) this.drawSeries(s, L, from, to);
        this.drawMarkers(L, from, to);
        this.drawDrawings(L);
      } else if (L.spec) {
        for (const lv of L.spec.levels ?? []) {
          const y = Math.round(this.yOf(lv, L)) + 0.5;
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = "rgba(255,255,255,0.18)";
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(pw, y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        for (const s of L.spec.series) this.drawSeries(s, L, from, to);
      }
      ctx.restore();
      if (k > 0) {
        ctx.strokeStyle = THEME.axis;
        ctx.beginPath();
        ctx.moveTo(0, L.top - 0.5);
        ctx.lineTo(this.w, L.top - 0.5);
        ctx.stroke();
      }
      this.drawPriceAxis(L);
    });

    // last price tag
    const last = bars[bars.length - 1];
    const main = this.layouts[0];
    if (last && main) {
      const y = this.yOf(last.c, main);
      if (y >= main.top && y <= main.top + main.height) {
        const prev = bars[bars.length - 2];
        const col = !prev || last.c >= prev.c ? THEME.up : THEME.down;
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(pw, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        this.axisTag(y, fmtPrice(last.c), col, "#fff");
      }
    }

    this.drawCrosshair();
  }

  private drawPriceGrid(L: PaneLayout) {
    const { ctx } = this;
    const step = niceStep(L.max - L.min, Math.max(2, Math.floor(L.height / 45)));
    ctx.strokeStyle = THEME.grid;
    for (let v = Math.ceil(L.min / step) * step; v <= L.max; v += step) {
      const y = Math.round(this.yOf(v, L)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.plotW(), y);
      ctx.stroke();
    }
  }

  private drawPriceAxis(L: PaneLayout) {
    const { ctx } = this;
    const step = niceStep(L.max - L.min, Math.max(2, Math.floor(L.height / 45)));
    ctx.fillStyle = THEME.text;
    ctx.textAlign = "left";
    const levels = L.spec?.levels ?? [];
    const taken: number[] = [];
    for (const lv of levels) {
      const y = this.yOf(lv, L);
      if (y < L.top + 6 || y > L.top + L.height - 6) continue;
      ctx.fillText(fmtPrice(lv, step), this.plotW() + 6, y);
      taken.push(y);
    }
    for (let v = Math.ceil(L.min / step) * step; v <= L.max; v += step) {
      const y = this.yOf(v, L);
      if (y < L.top + 6 || y > L.top + L.height - 6 || taken.some((t) => Math.abs(t - y) < 12)) continue;
      ctx.fillText(fmtPrice(v, step), this.plotW() + 6, y);
    }
  }

  private drawMain(L: PaneLayout, from: number, to: number) {
    const { ctx } = this;
    const bars = this.data.bars;
    const type = this.data.type;
    if (type === "line" || type === "area") {
      ctx.beginPath();
      let started = false;
      for (let i = from; i <= to; i++) {
        const x = this.xOf(i);
        const y = this.yOf(bars[i].c, L);
        if (!started) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        started = true;
      }
      if (type === "area" && started) {
        const g = ctx.createLinearGradient(0, L.top, 0, L.top + L.height);
        g.addColorStop(0, "rgba(229,233,240,0.20)");
        g.addColorStop(1, "rgba(229,233,240,0)");
        ctx.save();
        ctx.lineTo(this.xOf(to), L.top + L.height);
        ctx.lineTo(this.xOf(from), L.top + L.height);
        ctx.closePath();
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();
        ctx.beginPath();
        for (let i = from; i <= to; i++) {
          const x = this.xOf(i);
          const y = this.yOf(bars[i].c, L);
          if (i === from) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = THEME.line;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.lineWidth = 1;
      return;
    }
    const bodyW = Math.max(1, Math.floor(this.spacing * 0.7));
    for (let i = from; i <= to; i++) {
      const b = bars[i];
      const x = Math.round(this.xOf(i));
      const col = b.c >= b.o ? THEME.up : THEME.down;
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
      const top = Math.min(yo, yc);
      const hgt = Math.max(1, Math.abs(yc - yo));
      ctx.fillRect(x - Math.floor(bodyW / 2), top, bodyW, hgt);
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
        ctx.arc(this.xOf(i), this.yOf(v, L), Math.max(1.2, Math.min(2.5, this.spacing / 4)), 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let pen = false;
    for (let i = Math.max(0, from - 1); i <= Math.min(to + 1, s.values.length - 1); i++) {
      const v = s.values[i];
      if (!Number.isFinite(v)) {
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
    const all = [...this.drawings];
    if (this.pending && this.mouse && this.tool !== "none" && this.tool !== "hline") {
      all.push({ kind: this.tool, a: this.pending, b: { t: this.timeOfIndex(this.indexAt(this.mouse.x)), p: this.priceAt(this.mouse.y, L) }, color: THEME.draw });
    }
    ctx.lineWidth = 1.4;
    ctx.textAlign = "left";
    for (const d of all) {
      ctx.strokeStyle = d.color;
      ctx.fillStyle = d.color;
      if (d.kind === "hline") {
        const y = this.yOf(d.p, L);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(pw, y);
        ctx.stroke();
        ctx.fillText(fmtPrice(d.p), 6, y - 8);
        continue;
      }
      const x1 = this.xOf(this.indexOfTime(d.a.t));
      const x2 = this.xOf(this.indexOfTime(d.b.t));
      const y1 = this.yOf(d.a.p, L);
      const y2 = this.yOf(d.b.p, L);
      if (d.kind === "trend") {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        for (const [x, y] of [[x1, y1], [x2, y2]]) {
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (d.kind === "rect") {
        ctx.globalAlpha = 0.12;
        ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        ctx.globalAlpha = 1;
        ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      } else if (d.kind === "fib") {
        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2, pw);
        for (const f of FIB) {
          const p = d.b.p + (d.a.p - d.b.p) * f;
          const y = this.yOf(p, L);
          ctx.globalAlpha = f === 0 || f === 1 ? 0.9 : 0.6;
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
          ctx.fillText(`${(f * 100).toFixed(1)}%  ${fmtPrice(p)}`, left + 4, y - 7);
        }
        ctx.globalAlpha = 1;
      }
    }
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
    if (!m || !bars.length || m.x > this.plotW() || m.y > this.h - TIME_H) {
      this.onCross?.(null);
      return;
    }
    const { ctx } = this;
    const idx = Math.round(this.indexAt(m.x));
    const i = Math.max(0, Math.min(bars.length - 1, idx));
    const x = Math.round(this.xOf(i)) + 0.5;
    const y = Math.round(m.y) + 0.5;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = THEME.cross;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, this.h - TIME_H);
    ctx.moveTo(0, y);
    ctx.lineTo(this.plotW(), y);
    ctx.stroke();
    ctx.setLineDash([]);

    const L = this.layouts.find((l) => m.y >= l.top && m.y <= l.top + l.height);
    if (L) this.axisTag(m.y, fmtPrice(this.priceAt(m.y, L), (L.max - L.min) / 50), "#334155", "#fff");
    const label = fmtTime(bars[i].t, !!this.data.intraday, true);
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = "#334155";
    ctx.fillRect(x - tw / 2, this.h - TIME_H + 2, tw, TIME_H - 4);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(label, x, this.h - TIME_H / 2);

    const values: { label: string; color: string; value: number }[] = [];
    for (const s of this.data.overlays) values.push({ label: s.label, color: s.color, value: s.values[i] });
    for (const p of this.data.panes) for (const s of p.series) values.push({ label: s.label, color: s.color, value: s.values[i] });
    this.onCross?.({ index: i, bar: bars[i], values });
  }
}
