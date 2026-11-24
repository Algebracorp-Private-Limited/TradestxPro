/**
 * Series markers and price lines. Both are view-only decorations drawn through engine layers:
 * they never modify series data.
 */
import type { EngineLayer, LayerApi } from "../../components/chart/engine.ts";
import { XChartError, isCssColor } from "./validation.ts";

export type MarkerShape = "arrowUp" | "arrowDown" | "circle" | "square";
export type MarkerPosition = "aboveBar" | "belowBar" | "inBar";
export type SeriesMarker = {
  id?: string;
  time: number;
  position: MarkerPosition;
  shape: MarkerShape;
  color?: string;
  text?: string;
  /** Size multiplier 0.5–4 (default 1). */
  size?: number;
};
export type PriceLineSource = "fixed" | "last" | "previousClose";
export type PriceLineOptions = {
  id?: string;
  /** Required for source "fixed". */
  price?: number;
  /** "last" follows the newest value; "previousClose" the close before the newest bar. */
  source?: PriceLineSource;
  color?: string;
  lineWidth?: number;
  lineStyle?: "solid" | "dashed" | "dotted";
  axisLabelVisible?: boolean;
  title?: string;
  visible?: boolean;
};
export interface PriceLineApi {
  readonly id: string;
  applyOptions(o: Partial<PriceLineOptions>): void;
  options(): Readonly<PriceLineOptions>;
  /** Resolved price (null when the source has no data). */
  price(): number | null;
  remove(): void;
}

const SHAPES: MarkerShape[] = ["arrowUp", "arrowDown", "circle", "square"];
const POSITIONS: MarkerPosition[] = ["aboveBar", "belowBar", "inBar"];

export function validateMarker(m: unknown, i?: number): asserts m is SeriesMarker {
  const at = i === undefined ? "" : ` (marker ${i})`;
  if (!m || typeof m !== "object") throw new XChartError("INVALID_MARKER", `Marker must be an object${at}`);
  const o = m as SeriesMarker;
  if (typeof o.time !== "number" || !Number.isFinite(o.time)) throw new XChartError("INVALID_MARKER", `Marker time must be a finite number${at}`);
  if (!POSITIONS.includes(o.position)) throw new XChartError("INVALID_MARKER", `Marker position must be one of ${POSITIONS.join(", ")}${at}`);
  if (!SHAPES.includes(o.shape)) throw new XChartError("INVALID_MARKER", `Marker shape must be one of ${SHAPES.join(", ")}${at}`);
  if (o.color !== undefined && !isCssColor(o.color)) throw new XChartError("INVALID_COLOR", `Invalid marker color${at}`);
  if (o.text !== undefined && (typeof o.text !== "string" || o.text.length > 100)) throw new XChartError("INVALID_MARKER", `Marker text must be a string of at most 100 characters${at}`);
  if (o.size !== undefined && (typeof o.size !== "number" || !(o.size >= 0.5 && o.size <= 4))) throw new XChartError("INVALID_MARKER", `Marker size must be between 0.5 and 4${at}`);
  if (o.id !== undefined && (typeof o.id !== "string" || !o.id || o.id.length > 64)) throw new XChartError("INVALID_MARKER", `Marker id must be a non-empty string${at}`);
}

export function validatePriceLine(o: unknown, merged = false): asserts o is PriceLineOptions {
  if (!o || typeof o !== "object") throw new XChartError("INVALID_OPTION", "Price line options must be an object");
  const p = o as PriceLineOptions;
  const allowed = ["id", "price", "source", "color", "lineWidth", "lineStyle", "axisLabelVisible", "title", "visible"];
  for (const k of Object.keys(p)) if (!allowed.includes(k)) throw new XChartError("INVALID_OPTION", `Unknown price line option "${k}"`);
  if (p.source !== undefined && !["fixed", "last", "previousClose"].includes(p.source)) throw new XChartError("INVALID_OPTION", "Price line source must be fixed, last or previousClose");
  if (p.price !== undefined && (typeof p.price !== "number" || !Number.isFinite(p.price))) throw new XChartError("INVALID_NUMBER", "Price line price must be a finite number");
  if (merged && (p.source ?? "fixed") === "fixed" && p.price === undefined) throw new XChartError("INVALID_OPTION", "A fixed price line needs a price");
  if (p.color !== undefined && !isCssColor(p.color)) throw new XChartError("INVALID_COLOR", `Invalid price line color: ${String(p.color)}`);
  if (p.lineWidth !== undefined && (typeof p.lineWidth !== "number" || !(p.lineWidth >= 0.5 && p.lineWidth <= 10))) throw new XChartError("INVALID_OPTION", "Price line lineWidth must be between 0.5 and 10");
  if (p.lineStyle !== undefined && !["solid", "dashed", "dotted"].includes(p.lineStyle)) throw new XChartError("INVALID_OPTION", "Price line lineStyle must be solid, dashed or dotted");
  for (const k of ["axisLabelVisible", "visible"] as const) if (p[k] !== undefined && typeof p[k] !== "boolean") throw new XChartError("INVALID_OPTION", `Price line ${k} must be a boolean`);
  if (p.title !== undefined && (typeof p.title !== "string" || p.title.length > 60)) throw new XChartError("INVALID_OPTION", "Price line title must be a string of at most 60 characters");
}

/** What a decoration needs from the chart for one series. */
export type DecorHost = {
  indexOfTime(t: number): number;
  /** Value(s) at an axis index: candles give OHLC, value series give the value in o/h/l/c. */
  valueAt(i: number): { o: number; h: number; l: number; c: number } | null;
  /** Newest and previous finite close/value. */
  last(): { last: number | null; prev: number | null };
  fmt(p: number): string;
  color(): string;
  redraw(): void;
};

class PriceLineHandle implements PriceLineApi {
  readonly id: string;
  private d: Decorations;
  constructor(d: Decorations, id: string) {
    this.d = d;
    this.id = id;
  }
  applyOptions(o: Partial<PriceLineOptions>) {
    this.d.updateLine(this.id, o);
  }
  options() {
    return this.d.lineOptions(this.id);
  }
  price() {
    return this.d.linePrice(this.id);
  }
  remove() {
    this.d.removeLine(this.id);
  }
}

export class Decorations {
  private markers: SeriesMarker[] = [];
  private lines = new Map<string, PriceLineOptions>();
  private seq = 0;
  private host: DecorHost;
  constructor(host: DecorHost) {
    this.host = host;
  }

  setMarkers(list: ReadonlyArray<SeriesMarker>) {
    if (!Array.isArray(list)) throw new XChartError("INVALID_MARKER", "setMarkers expects an array");
    list.forEach((m, i) => validateMarker(m, i));
    this.markers = list.map((m) => ({ ...m })).sort((a, b) => a.time - b.time);
    this.host.redraw();
  }
  addMarker(m: SeriesMarker): string {
    validateMarker(m);
    const id = m.id ?? `m-${++this.seq}`;
    if (this.markers.some((x) => x.id === id)) throw new XChartError("INVALID_MARKER", `A marker with id "${id}" already exists`);
    const next = [...this.markers, { ...m, id }].sort((a, b) => a.time - b.time);
    this.markers = next;
    this.host.redraw();
    return id;
  }
  removeMarker(id: string): boolean {
    const n = this.markers.length;
    this.markers = this.markers.filter((m) => m.id !== id);
    if (this.markers.length !== n) this.host.redraw();
    return this.markers.length !== n;
  }
  getMarkers(): SeriesMarker[] {
    return this.markers.map((m) => ({ ...m }));
  }
  clearMarkers() {
    if (!this.markers.length) return;
    this.markers = [];
    this.host.redraw();
  }

  createLine(o: PriceLineOptions): PriceLineApi {
    validatePriceLine(o, true);
    const id = o.id ?? `pl-${++this.seq}`;
    if (this.lines.has(id)) throw new XChartError("INVALID_OPTION", `A price line with id "${id}" already exists`);
    this.lines.set(id, { source: "fixed", lineStyle: "dashed", lineWidth: 1, axisLabelVisible: true, visible: true, ...o, id });
    this.host.redraw();
    return new PriceLineHandle(this, id);
  }
  updateLine(id: string, o: Partial<PriceLineOptions>) {
    const cur = this.lines.get(id);
    if (!cur) throw new XChartError("PRICE_LINE_REMOVED", "This price line was removed");
    validatePriceLine(o);
    if (o.id !== undefined && o.id !== id) throw new XChartError("INVALID_OPTION", "A price line's id cannot change");
    const next = { ...cur, ...o };
    validatePriceLine(next, true);
    this.lines.set(id, next);
    this.host.redraw();
  }
  lineOptions(id: string): PriceLineOptions {
    const cur = this.lines.get(id);
    if (!cur) throw new XChartError("PRICE_LINE_REMOVED", "This price line was removed");
    return { ...cur };
  }
  linePrice(id: string): number | null {
    const o = this.lines.get(id);
    if (!o) return null;
    if ((o.source ?? "fixed") === "fixed") return o.price ?? null;
    const l = this.host.last();
    return o.source === "last" ? l.last : l.prev;
  }
  removeLine(id: string) {
    if (this.lines.delete(id)) this.host.redraw();
  }
  priceLines(): PriceLineApi[] {
    return [...this.lines.keys()].map((id) => new PriceLineHandle(this, id));
  }
  isEmpty() {
    return !this.markers.length && !this.lines.size;
  }
  clear() {
    this.markers = [];
    this.lines.clear();
  }

  draw(api: LayerApi) {
    const { ctx } = api;
    const w = api.pane.width;
    // Price lines
    for (const o of this.lines.values()) {
      if (o.visible === false) continue;
      const p = this.linePrice(o.id!);
      if (p === null || !Number.isFinite(p)) continue;
      const y = Math.round(api.yOfPrice(p)) + 0.5;
      if (y < api.pane.top || y > api.pane.top + api.pane.height) continue;
      const color = o.color ?? this.host.color();
      ctx.strokeStyle = color;
      ctx.lineWidth = o.lineWidth ?? 1;
      ctx.setLineDash(o.lineStyle === "dotted" ? [1.5, 3] : o.lineStyle === "solid" ? [] : [6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (o.title) {
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = color;
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillText(o.title, w - 6, y - 2);
      }
      if (o.axisLabelVisible !== false) api.axisLabel(y, this.host.fmt(p), color);
    }
    // Markers (only those in view), stacked per bar and side.
    if (!this.markers.length) return;
    const stack = new Map<string, number>();
    for (const m of this.markers) {
      const i = Math.round(this.host.indexOfTime(m.time));
      if (i < api.from - 1 || i > api.to + 1) continue;
      const v = this.host.valueAt(i);
      if (!v) continue;
      const s = 7 * (m.size ?? 1) * Math.max(0.7, Math.min(1.4, api.spacing / 8));
      const key = `${i}|${m.position}`;
      const k = stack.get(key) ?? 0;
      stack.set(key, k + 1);
      const x = api.xOfIndex(i);
      const gap = 4 + k * (s * 2 + 4);
      const y = m.position === "aboveBar" ? api.yOfPrice(v.h) - gap - s : m.position === "belowBar" ? api.yOfPrice(v.l) + gap + s : api.yOfPrice(v.c);
      const color = m.color ?? (m.shape === "arrowDown" ? "#ef4444" : m.shape === "arrowUp" ? "#22c55e" : this.host.color());
      ctx.fillStyle = color;
      ctx.beginPath();
      if (m.shape === "arrowUp") {
        ctx.moveTo(x, y - s);
        ctx.lineTo(x + s, y + s * 0.6);
        ctx.lineTo(x - s, y + s * 0.6);
      } else if (m.shape === "arrowDown") {
        ctx.moveTo(x, y + s);
        ctx.lineTo(x + s, y - s * 0.6);
        ctx.lineTo(x - s, y - s * 0.6);
      } else if (m.shape === "circle") ctx.arc(x, y, s * 0.8, 0, Math.PI * 2);
      else ctx.rect(x - s * 0.75, y - s * 0.75, s * 1.5, s * 1.5);
      ctx.closePath();
      ctx.fill();
      if (m.text) {
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = m.position === "belowBar" ? "top" : "bottom";
        ctx.fillText(m.text, x, m.position === "belowBar" ? y + s + 2 : y - s - 2);
      }
    }
  }

  layer(pane: string): EngineLayer {
    return { pane, z: "above", draw: (api) => this.draw(api) };
  }
}
