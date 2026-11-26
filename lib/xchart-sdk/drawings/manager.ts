/**
 * Drawing manager: owns drawings (time/price anchors), selection, creation tool state and
 * undo/redo. Renders through an engine layer and takes input through the interaction delegate,
 * so drawings never touch series data. Pure logic + canvas calls; no global state.
 */
import type { EngineLayer, InteractionDelegate, LayerApi, PointerInfo } from "../../../components/chart/engine.ts";
import { XChartError, isCssColor } from "../validation.ts";
import { snapToOhlc, type P } from "./geometry.ts";
import { TOOLS, type ToolEnv, type ToolSpec } from "./tools.ts";

export type ToolTable = Readonly<Record<string, ToolSpec>>;
const minAnchors = (t: ToolSpec) => (t.anchors === "multi" ? 3 : t.anchors);
import { type DrawingDomain, type DrawingApi, type DrawingData, type DrawingEvent, type DrawingPoint, type DrawingSpec, type DrawingStyle, type DrawingType } from "./types.ts";

export type DrawingHost = {
  indexOfTime(t: number): number;
  timeAt(i: number): number;
  /** Coordinate domain of the chart right now ("logical" on price-based chart types). */
  domain(): DrawingDomain;
  bar(i: number): { o: number; h: number; l: number; c: number } | undefined;
  barCount(): number;
  /** Live geometry of a pane (and scale) for hit-testing outside a frame; null when absent. */
  geometry(paneId?: string, scaleId?: string): Geo | null;
  /** Values a drawing anchor may snap to at bar i in a pane (OHLC on the main pane, series/indicator values elsewhere). */
  snapValues?(paneId: string, i: number): number[];
  fmt(price: number): string;
  timeLabel(t: number): string;
  redraw(): void;
  emit(e: DrawingEvent): void;
};

export type Geo = {
  xOfIndex(i: number): number;
  yOfPrice(p: number): number;
  priceOfY(y: number): number;
  width: number;
  top: number;
  height: number;
};

const ANCHOR_HIT = 8;
const MAX_HISTORY = 100;
const MAX_POLY = 64;
const STYLE_KEYS = ["color", "lineWidth", "lineStyle", "fillColor", "fillOpacity", "textColor", "fontSize", "levels", "extendLeft", "extendRight", "showLabels"];

const clone = (d: DrawingData): DrawingData => ({ ...d, points: d.points.map((p) => ({ ...p })), style: { ...d.style, levels: d.style.levels ? [...d.style.levels] : undefined } });

export function validateStyle(s: unknown): asserts s is DrawingStyle {
  if (s === undefined) return;
  if (!s || typeof s !== "object") throw new XChartError("INVALID_DRAWING", "Drawing style must be an object");
  const o = s as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!STYLE_KEYS.includes(k)) throw new XChartError("INVALID_DRAWING", `Unknown drawing style "${k}"`);
  for (const k of ["color", "fillColor", "textColor"]) if (o[k] !== undefined && !isCssColor(o[k])) throw new XChartError("INVALID_COLOR", `Invalid drawing ${k}: ${String(o[k])}`);
  const num = (k: string, lo: number, hi: number) => {
    const v = o[k];
    if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi)) throw new XChartError("INVALID_DRAWING", `Drawing ${k} must be a number in [${lo}, ${hi}]`);
  };
  num("lineWidth", 0.5, 10);
  num("fillOpacity", 0, 1);
  num("fontSize", 6, 72);
  if (o.lineStyle !== undefined && !["solid", "dashed", "dotted"].includes(o.lineStyle as string)) throw new XChartError("INVALID_DRAWING", "Drawing lineStyle must be solid, dashed or dotted");
  for (const k of ["extendLeft", "extendRight", "showLabels"]) if (o[k] !== undefined && typeof o[k] !== "boolean") throw new XChartError("INVALID_DRAWING", `Drawing ${k} must be a boolean`);
  if (o.levels !== undefined && (!Array.isArray(o.levels) || o.levels.length > 32 || o.levels.some((v) => typeof v !== "number" || !Number.isFinite(v)))) throw new XChartError("INVALID_DRAWING", "Drawing levels must be up to 32 finite numbers");
}

export function validatePoints(type: string, pts: unknown, tools: ToolTable = TOOLS) {
  if (!Array.isArray(pts)) throw new XChartError("INVALID_DRAWING", "Drawing points must be an array");
  const need = tools[type].anchors;
  if (need === "multi" ? pts.length < 3 || pts.length > MAX_POLY : pts.length !== need) {
    throw new XChartError("INVALID_DRAWING", `"${type}" needs ${need === "multi" ? `3–${MAX_POLY}` : need} point(s), got ${pts.length}`);
  }
  pts.forEach((p, i) => {
    if (!p || typeof p !== "object" || typeof p.time !== "number" || !Number.isFinite(p.time) || typeof p.price !== "number" || !Number.isFinite(p.price)) {
      throw new XChartError("INVALID_DRAWING", `Drawing point ${i} needs finite time and price`);
    }
  });
}

export function validateSpec(spec: unknown, tools: ToolTable = TOOLS): asserts spec is DrawingSpec {
  if (!spec || typeof spec !== "object") throw new XChartError("INVALID_DRAWING", "Drawing must be an object");
  const s = spec as DrawingSpec;
  if (typeof s.type !== "string" || !Object.prototype.hasOwnProperty.call(tools, s.type)) throw new XChartError("UNKNOWN_DRAWING", `Unknown drawing type "${String(s.type)}"`);
  validatePoints(s.type, s.points, tools);
  validateStyle(s.style);
  if (s.id !== undefined && (typeof s.id !== "string" || !/^[A-Za-z0-9_.:-]{1,64}$/.test(s.id))) throw new XChartError("INVALID_DRAWING", "Drawing id must be 1–64 characters of letters, digits, _ . : -");
  if (s.text !== undefined && (typeof s.text !== "string" || s.text.length > 500)) throw new XChartError("INVALID_DRAWING", "Drawing text must be a string of at most 500 characters");
  for (const k of ["locked", "visible"] as const) if (s[k] !== undefined && typeof s[k] !== "boolean") throw new XChartError("INVALID_DRAWING", `Drawing ${k} must be a boolean`);
  if (s.domain !== undefined && s.domain !== "time" && s.domain !== "logical") throw new XChartError("INVALID_DRAWING", 'Drawing domain must be "time" or "logical"');
  if (s.domain === "logical") validateLogical(s.points);
  if (s.paneId !== undefined && (typeof s.paneId !== "string" || !/^[A-Za-z0-9_:-]{1,48}$/.test(s.paneId))) throw new XChartError("INVALID_DRAWING", "Drawing paneId must be a pane id");
  if (s.scaleId !== undefined && (typeof s.scaleId !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(s.scaleId))) throw new XChartError("INVALID_DRAWING", "Drawing scaleId must be a price-scale id");
}

function validateLogical(pts: unknown[]) {
  pts.forEach((p, i) => {
    const l = (p as { logical?: unknown }).logical;
    if (typeof l !== "number" || !Number.isFinite(l) || Math.abs(l) > 1e9) throw new XChartError("INVALID_DRAWING", `Logical-domain drawing point ${i} needs a finite "logical" index`);
  });
}

type Drag = { id: string; anchor: number; startIdx: number; startPrice: number; orig: DrawingData; moved: boolean };
type Creating = { type: DrawingType; points: DrawingPoint[]; preview: DrawingPoint | null; dragging: boolean; paneId: string | null };

class DrawingHandle implements DrawingApi {
  readonly id: string;
  readonly type: DrawingType | (string & {});
  private m: DrawingManager;
  constructor(m: DrawingManager, id: string, type: DrawingType | (string & {})) {
    this.m = m;
    this.id = id;
    this.type = type;
  }
  data() {
    return this.m.dataOf(this.id);
  }
  update(patch: { points?: DrawingPoint[]; text?: string }) {
    this.m.patch(this.id, patch);
  }
  applyOptions(style: Partial<DrawingStyle>) {
    this.m.patch(this.id, { style });
  }
  setVisible(v: boolean) {
    this.m.patch(this.id, { visible: v });
  }
  setLocked(v: boolean) {
    this.m.patch(this.id, { locked: v });
  }
  remove() {
    this.m.remove(this.id);
  }
}

export class DrawingManager {
  private items = new Map<string, DrawingData>();
  private handles = new Map<string, DrawingHandle>();
  private undoStack: DrawingData[][] = [];
  private redoStack: DrawingData[][] = [];
  private seq = 0;
  private host: DrawingHost;
  selected: string | null = null;
  private hovered: string | null = null;
  private creating: Creating | null = null;
  private drag: Drag | null = null;
  /** Snap anchors to the nearest open/high/low/close (default on; hold Ctrl to bypass while drawing). */
  snap = true;
  /** Built-in tools plus tools registered on this chart (plugins). */
  private tools: Record<string, ToolSpec> = { ...TOOLS };

  /** Registers a custom drawing tool for this chart. Its render/hit run in a try/catch (a failure only skips that drawing). */
  registerTool(type: string, spec: ToolSpec) {
    if (typeof type !== "string" || !/^[a-z][a-z0-9-]{1,40}$/.test(type)) throw new XChartError("INVALID_DRAWING", "Tool id must be 2–41 lowercase letters, digits or -, starting with a letter");
    if (Object.prototype.hasOwnProperty.call(this.tools, type)) throw new XChartError("DUPLICATE_DRAWING", `Drawing tool "${type}" already exists`);
    const a = spec?.anchors;
    if (!spec || typeof spec.render !== "function" || typeof spec.hit !== "function" || !(a === "multi" || (Number.isInteger(a) && (a as number) >= 1 && (a as number) <= 16))) {
      throw new XChartError("INVALID_DRAWING", "A drawing tool needs anchors (1–16 or \"multi\"), render(env, points, drawing) and hit(env, points, p, drawing)");
    }
    this.tools[type] = { anchors: a, render: spec.render, hit: spec.hit };
  }
  unregisterTool(type: string): boolean {
    if (Object.prototype.hasOwnProperty.call(TOOLS, type)) throw new XChartError("BUILTIN_DRAWING", `"${type}" is a built-in tool`);
    if (!Object.prototype.hasOwnProperty.call(this.tools, type)) return false;
    if ([...this.items.values()].some((d) => d.type === type)) throw new XChartError("DRAWING_IN_USE", `Remove the "${type}" drawings first`);
    delete this.tools[type];
    return true;
  }
  toolTypes(): string[] {
    return Object.keys(this.tools);
  }

  constructor(host: DrawingHost) {
    this.host = host;
  }

  // ---------- public API ----------
  add(spec: DrawingSpec, record = true): DrawingApi {
    validateSpec(spec, this.tools);
    const domain = spec.domain ?? this.host.domain();
    if (domain === "logical" && spec.domain === undefined) validateLogical(spec.points);
    const id = spec.id ?? this.nextId(spec.type);
    if (this.items.has(id)) throw new XChartError("DUPLICATE_DRAWING", `A drawing with id "${id}" already exists`);
    if (record) this.checkpoint();
    const d: DrawingData = {
      id,
      type: spec.type,
      points: spec.points.map((p) => ({ time: p.time, price: p.price, ...(domain === "logical" ? { logical: p.logical! } : {}) })),
      ...(domain === "logical" ? { domain } : {}),
      ...(spec.paneId && spec.paneId !== "main" ? { paneId: spec.paneId } : {}),
      ...(spec.scaleId && spec.scaleId !== "right" ? { scaleId: spec.scaleId } : {}),
      style: { ...spec.style },
      locked: spec.locked ?? false,
      visible: spec.visible ?? true,
      ...(spec.text !== undefined ? { text: spec.text } : {}),
    };
    this.items.set(id, d);
    this.host.emit({ type: "create", drawing: clone(d) });
    this.host.redraw();
    return this.handle(id);
  }

  get(id: string): DrawingApi | undefined {
    return this.items.has(id) ? this.handle(id) : undefined;
  }
  list(): DrawingApi[] {
    return [...this.items.keys()].map((id) => this.handle(id));
  }
  dataOf(id: string): DrawingData {
    const d = this.items.get(id);
    if (!d) throw new XChartError("DRAWING_REMOVED", `Drawing "${id}" was removed`);
    return clone(d);
  }

  patch(id: string, p: { points?: DrawingPoint[]; text?: string; style?: Partial<DrawingStyle>; visible?: boolean; locked?: boolean }, record = true) {
    const d = this.items.get(id);
    if (!d) throw new XChartError("DRAWING_REMOVED", `Drawing "${id}" was removed`);
    if (p.points !== undefined) {
      validatePoints(d.type, p.points, this.tools);
      if (d.domain === "logical") validateLogical(p.points);
    }
    if (p.style !== undefined) validateStyle(p.style);
    if (p.text !== undefined && (typeof p.text !== "string" || p.text.length > 500)) throw new XChartError("INVALID_DRAWING", "Drawing text must be a string of at most 500 characters");
    for (const k of ["visible", "locked"] as const) if (p[k] !== undefined && typeof p[k] !== "boolean") throw new XChartError("INVALID_DRAWING", `Drawing ${k} must be a boolean`);
    if (record) this.checkpoint();
    if (p.points) d.points = p.points.map((q) => ({ time: q.time, price: q.price, ...(d.domain === "logical" ? { logical: q.logical! } : {}) }));
    if (p.text !== undefined) d.text = p.text;
    if (p.style) d.style = { ...d.style, ...p.style };
    if (p.visible !== undefined) d.visible = p.visible;
    if (p.locked !== undefined) d.locked = p.locked;
    this.host.emit({ type: "update", drawing: clone(d) });
    this.host.redraw();
  }

  remove(id: string, record = true): boolean {
    if (!this.items.has(id)) return false;
    if (record) this.checkpoint();
    this.items.delete(id);
    this.handles.delete(id);
    if (this.selected === id) this.select(null);
    this.host.emit({ type: "remove", id });
    this.host.redraw();
    return true;
  }

  clear() {
    if (!this.items.size) return;
    this.checkpoint();
    for (const id of [...this.items.keys()]) this.remove(id, false);
  }

  duplicate(id: string): DrawingApi | undefined {
    const d = this.items.get(id);
    if (!d) return undefined;
    const shift = Math.max(1, Math.round(this.host.barCount() * 0.01)) * 2;
    const points = d.points.map((p) => this.shifted(d, p, shift, 0));
    const copy = this.add({ type: d.type, points, style: { ...d.style }, text: d.text, locked: false, visible: d.visible, domain: d.domain ?? "time", ...(d.paneId ? { paneId: d.paneId } : {}), ...(d.scaleId ? { scaleId: d.scaleId } : {}) });
    this.select(copy.id);
    return copy;
  }

  /** Bar index of an anchor in its drawing's domain. */
  private idx(d: { domain?: DrawingDomain }, p: DrawingPoint): number {
    return d.domain === "logical" ? p.logical ?? NaN : this.host.indexOfTime(p.time);
  }
  /** Anchor moved by `bars` whole bars and `dp` in price, in the drawing's domain. */
  private shifted(d: { domain?: DrawingDomain }, p: DrawingPoint, bars: number, dp: number): DrawingPoint {
    const i = Math.round(this.idx(d, p)) + bars;
    return d.domain === "logical" ? { time: this.host.timeAt(i), price: p.price + dp, logical: i } : { time: this.host.timeAt(i), price: p.price + dp };
  }
  /** Drawings shown in the chart's current domain (others are kept, hidden and not hit-tested). */
  private active(d: DrawingData) {
    return d.visible && (d.domain ?? "time") === this.host.domain();
  }

  select(id: string | null) {
    if (id !== null && !this.items.has(id)) return;
    if (this.selected === id) return;
    this.selected = id;
    this.host.emit({ type: "select", id });
    this.host.redraw();
  }

  /** Starts interactive creation of `tool` (null cancels). */
  setTool(tool: DrawingType | (string & {}) | null) {
    if (tool !== null && !Object.prototype.hasOwnProperty.call(this.tools, tool)) throw new XChartError("UNKNOWN_DRAWING", `Unknown drawing type "${String(tool)}"`);
    this.creating = tool ? { type: tool as DrawingType, points: [], preview: null, dragging: false, paneId: null } : null;
    this.host.emit({ type: "tool", tool: tool as DrawingType | null });
    this.host.redraw();
  }
  tool(): DrawingType | null {
    return this.creating?.type ?? null;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }
  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
    return true;
  }
  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.snapshot());
    this.restore(next);
    return true;
  }

  /** JSON-safe copies of every drawing. */
  serialize(): DrawingData[] {
    return this.snapshot();
  }
  /** Replaces all drawings with validated copies of `data` (atomic: nothing changes if one is invalid). */
  /** Validates drawings for load() without changing anything. */
  check(data: unknown) {
    if (!Array.isArray(data)) throw new XChartError("INVALID_DRAWING", "Drawings must be an array");
    const ids = new Set<string>();
    for (const d of data) {
      validateSpec(d, this.tools);
      if (d.id !== undefined) {
        if (ids.has(d.id)) throw new XChartError("DUPLICATE_DRAWING", `Duplicate drawing id "${d.id}"`);
        ids.add(d.id);
      }
    }
  }

  load(data: unknown, record = true) {
    if (!Array.isArray(data)) throw new XChartError("INVALID_DRAWING", "Drawings must be an array");
    const ids = new Set<string>();
    for (const d of data) {
      validateSpec(d, this.tools);
      if (d.id !== undefined) {
        if (ids.has(d.id)) throw new XChartError("DUPLICATE_DRAWING", `Duplicate drawing id "${d.id}"`);
        ids.add(d.id);
      }
    }
    if (record) this.checkpoint();
    for (const id of [...this.items.keys()]) this.remove(id, false);
    for (const d of data as DrawingSpec[]) this.add(d, false);
  }

  destroy() {
    this.items.clear();
    this.handles.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.creating = null;
    this.drag = null;
    this.selected = null;
  }

  // ---------- rendering ----------
  /** Engine layer drawing this manager's drawings on one pane. */
  layer(paneId = "main"): EngineLayer {
    return { pane: paneId, z: "above", draw: (api) => this.draw(api) };
  }

  /** Panes that currently hold drawings (plus the main pane). */
  paneIds(): string[] {
    const s = new Set(["main"]);
    for (const d of this.items.values()) s.add(d.paneId ?? "main");
    if (this.creating?.paneId) s.add(this.creating.paneId);
    return [...s];
  }

  private draw(api: LayerApi) {
    if (!this.items.size && !this.creating) return;
    const pane = api.pane.id;
    const base: Geo = { xOfIndex: api.xOfIndex, yOfPrice: api.yOfPrice, priceOfY: api.priceOfY, width: api.pane.width, top: api.pane.top, height: api.pane.height };
    const envFor = (scaleId?: string) => {
      const geo = scaleId && scaleId !== "right" && api.scaleY ? { ...base, yOfPrice: (p: number) => api.scaleY!(scaleId, p) ?? NaN, priceOfY: (y: number) => api.scalePrice!(scaleId, y) ?? NaN } : base;
      return this.env(api.ctx, geo, api.theme.draw, api.theme.text, api.theme.bg);
    };
    const env = envFor();
    const { ctx } = api;
    ctx.beginPath();
    ctx.rect(0, api.pane.top, api.pane.width, api.pane.height);
    ctx.clip();
    for (const d of this.items.values()) {
      if (!this.active(d) || (d.paneId ?? "main") !== pane) continue;
      this.renderOne(d.scaleId ? envFor(d.scaleId) : env, d, api.theme.select);
    }
    const c = this.creating;
    if (c && c.points.length && (c.paneId ?? "main") === pane) {
      const pts = c.preview ? [...c.points, c.preview] : c.points;
      const need = minAnchors(this.tools[c.type]);
      const temp: DrawingData = { id: "__preview", type: c.type, points: pts, style: {}, locked: false, visible: true, ...(this.host.domain() === "logical" ? { domain: "logical" as const } : {}) };
      const tool = this.tools[c.type];
      if (tool.anchors === "multi" || pts.length >= need) this.renderOne(env, temp, api.theme.select, true);
      else {
        // Not enough anchors yet: show the anchors and a guide segment.
        const s = pts.map((p) => env.px(p));
        ctx.strokeStyle = api.theme.draw;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        s.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.stroke();
        ctx.setLineDash([]);
        for (const q of s) this.handleDot(ctx, q, api.theme.draw, api.theme.bg);
      }
    }
  }

  private renderOne(env: ToolEnv, d: DrawingData, select: string, preview = false) {
    const pts = d.points.map((p) => env.px(p));
    const { ctx } = env;
    ctx.save();
    try {
      if (d.id === this.hovered && d.id !== this.selected) {
        ctx.shadowColor = select;
        ctx.shadowBlur = 6;
      }
      this.tools[d.type].render(env, pts, d);
    } catch (e) {
      console.error(`[XChart] drawing "${d.id}" failed to render`, e);
    }
    ctx.restore();
    if (d.id === this.selected || preview) {
      for (const q of pts) this.handleDot(ctx, q, d.locked ? "#94a3b8" : d.style.color ?? env.color, env.bg);
    }
  }

  private handleDot(ctx: CanvasRenderingContext2D, q: P, color: string, bg: string) {
    ctx.fillStyle = bg;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  private env(ctx: CanvasRenderingContext2D, g: Geo, color: string, text: string, bg: string): ToolEnv {
    const h = this.host;
    const dom = { domain: h.domain() };
    return {
      ctx, width: g.width, top: g.top, height: g.height, color, text, bg,
      px: (p) => ({ x: g.xOfIndex(this.idx(dom, p)), y: g.yOfPrice(p.price) }),
      fmt: (p) => h.fmt(p),
      timeLabel: (t) => h.timeLabel(t),
      bars: (p1, p2) => this.idx(dom, p2) - this.idx(dom, p1),
      xAfter: (p, n) => g.xOfIndex(this.idx(dom, p) + n),
      closes: (p1, p2) => {
        const x: number[] = [], price: number[] = [];
        const i1 = this.idx(dom, p1), i2 = this.idx(dom, p2);
        const a = Math.max(0, Math.ceil(Math.min(i1, i2))), b = Math.min(h.barCount() - 1, Math.floor(Math.max(i1, i2)));
        for (let i = a; i <= b; i++) {
          const bar = h.bar(i);
          if (bar && Number.isFinite(bar.c)) {
            x.push(g.xOfIndex(i));
            price.push(bar.c);
          }
        }
        return { x, price };
      },
      yOf: (p) => g.yOfPrice(p),
    };
  }

  // ---------- hit testing ----------
  private scratch: CanvasRenderingContext2D | null = null;
  private measureCtx(): CanvasRenderingContext2D {
    if (!this.scratch && typeof document !== "undefined") this.scratch = document.createElement("canvas").getContext("2d");
    return this.scratch ?? ({ measureText: (s: string) => ({ width: s.length * 7 }), set font(_v: string) {} } as unknown as CanvasRenderingContext2D);
  }

  /** Topmost drawing of `paneId` under (x, y) and which anchor (or -1 for the body). Other panes are never hit. */
  hitTest(x: number, y: number, paneId = "main"): { id: string; anchor: number } | null {
    const g0 = this.host.geometry(paneId);
    if (!g0) return null;
    const envs = new Map<string, ToolEnv>();
    const envOf = (sid = "right") => {
      let e = envs.get(sid);
      if (!e) {
        const g = sid === "right" ? g0 : this.host.geometry(paneId, sid);
        if (!g) return null;
        envs.set(sid, (e = this.env(this.measureCtx(), g, "", "", "")));
      }
      return e;
    };
    const p = { x, y };
    const list = [...this.items.values()].filter((d) => this.active(d) && (d.paneId ?? "main") === paneId).reverse();
    // The selected drawing's anchors take priority.
    const order = this.selected ? [...list.filter((d) => d.id === this.selected), ...list.filter((d) => d.id !== this.selected)] : list;
    for (const d of order) {
      const env = envOf(d.scaleId);
      if (!env) continue;
      const pts = d.points.map((q) => env.px(q));
      const a = pts.findIndex((q) => Math.hypot(q.x - x, q.y - y) <= ANCHOR_HIT);
      if (a >= 0) return { id: d.id, anchor: a };
      try {
        if (this.tools[d.type].hit(env, pts, p, d)) return { id: d.id, anchor: -1 };
      } catch {
        /* a broken hit-test is treated as a miss */
      }
    }
    return null;
  }

  // ---------- interaction ----------
  /** Anchor at the pointer, in `paneId`'s own value units (the pointer may be over another pane while dragging). */
  private pointAt(p: PointerInfo, snap: boolean, paneId: string | null = p.paneId, scaleId?: string): DrawingPoint | null {
    if (!paneId) return null;
    const h = this.host;
    const g = h.geometry(paneId, scaleId);
    if (!g) return null;
    const n = h.barCount();
    const i = Math.round(p.index);
    let price = g.priceOfY(p.y);
    if (!Number.isFinite(price)) return null;
    if (snap && this.snap && !p.ctrl && i >= 0 && i < n) {
      const vals = paneId === "main" ? (() => { const b = h.bar(i); return b ? [b.o, b.h, b.l, b.c] : []; })() : h.snapValues?.(paneId, i) ?? [];
      if (vals.length) price = snapToOhlc(price, p.y, vals, g.yOfPrice);
    }
    return h.domain() === "logical" ? { time: h.timeAt(i), price, logical: i } : { time: h.timeAt(i), price };
  }

  delegate(): InteractionDelegate {
    return {
      hover: (p) => {
        const c = this.creating;
        if (c) {
          c.preview = this.pointAt(p, true, c.paneId ?? p.paneId);
          this.host.redraw();
          return "crosshair";
        }
        const hit = p.paneId ? this.hitTest(p.x, p.y, p.paneId) : null;
        const id = hit?.id ?? null;
        if (id !== this.hovered) {
          this.hovered = id;
          this.host.redraw();
        }
        if (!hit) return null;
        const locked = this.items.get(hit.id)?.locked;
        return locked ? "pointer" : hit.anchor >= 0 ? "grab" : "move";
      },
      down: (p) => {
        const c = this.creating;
        if (c) {
          // The first anchor fixes the pane; later anchors use that pane's scale.
          if (!c.points.length) c.paneId = p.paneId;
          const pt = this.pointAt(p, true, c.paneId);
          if (!pt) return true; // swallow presses outside any pane while a tool is active
          c.points.push(pt);
          c.preview = pt;
          c.dragging = true;
          if (this.tools[c.type].anchors !== "multi" && c.points.length >= minAnchors(this.tools[c.type])) this.finishCreate();
          this.host.redraw();
          return true;
        }
        const hit = p.paneId ? this.hitTest(p.x, p.y, p.paneId) : null;
        if (!hit) {
          if (this.selected) this.select(null);
          return false; // let the engine pan
        }
        this.select(hit.id);
        const d = this.items.get(hit.id)!;
        const g = this.host.geometry(d.paneId ?? "main", d.scaleId);
        if (!d.locked && g) this.drag = { id: hit.id, anchor: hit.anchor, startIdx: p.index, startPrice: g.priceOfY(p.y), orig: clone(d), moved: false };
        return true;
      },
      move: (p) => {
        const c = this.creating;
        if (c) {
          // Press-drag-release creation for two-anchor tools (and touch).
          c.preview = this.pointAt(p, true, c.paneId) ?? c.preview;
          this.host.redraw();
          return;
        }
        const dr = this.drag;
        if (!dr) return;
        const d = this.items.get(dr.id);
        if (!d) return;
        const dg = this.host.geometry(d.paneId ?? "main", d.scaleId);
        if (!dg) return;
        if (!dr.moved) {
          this.checkpointFrom(dr.orig);
          dr.moved = true;
        }
        if (dr.anchor >= 0) {
          const pt = this.pointAt(p, true, d.paneId ?? "main", d.scaleId);
          if (pt) d.points = d.points.map((q, i) => (i === dr.anchor ? pt : q));
        } else {
          const di = Math.round(p.index - dr.startIdx);
          const dp = dg.priceOfY(p.y) - dr.startPrice;
          d.points = dr.orig.points.map((q) => this.shifted(dr.orig, q, di, dp));
        }
        this.host.redraw();
      },
      up: (p) => {
        const c = this.creating;
        if (c) {
          c.dragging = false;
          // A drag that ends away from the first anchor completes a two-anchor tool.
          const need = this.tools[c.type].anchors;
          if (need === 2 && c.points.length === 1) {
            const pt = this.pointAt(p, true, c.paneId);
            const first = c.points[0];
            const g = this.host.geometry(c.paneId ?? "main");
            if (pt && g) {
              const a = { x: g.xOfIndex(this.idx({ domain: this.host.domain() }, first)), y: g.yOfPrice(first.price) };
              if (Math.hypot(a.x - p.x, a.y - p.y) > 6) {
                c.points.push(pt);
                this.finishCreate();
              }
            }
          }
          return;
        }
        const dr = this.drag;
        this.drag = null;
        if (dr?.moved) {
          const d = this.items.get(dr.id);
          if (d) this.host.emit({ type: "update", drawing: clone(d) });
        }
      },
      dbl: (p) => {
        const c = this.creating;
        if (c && this.tools[c.type].anchors === "multi") {
          // The double click's own presses added duplicate anchors; drop the extra one.
          const pts = c.points.filter((q, i) => i === 0 || q.time !== c.points[i - 1].time || q.price !== c.points[i - 1].price);
          c.points = pts;
          if (pts.length >= 3) this.finishCreate();
          return true;
        }
        if (c) return true;
        return Boolean(p.paneId && this.hitTest(p.x, p.y, p.paneId));
      },
      key: (e) => this.onKey(e),
    };
  }

  private onKey(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (k === "escape") {
      if (this.creating) {
        this.setTool(null);
        return true;
      }
      if (this.selected) {
        this.select(null);
        return true;
      }
      return false;
    }
    if (mod && k === "z" && !e.shiftKey) return this.undo();
    if (mod && (k === "y" || (k === "z" && e.shiftKey))) return this.redo();
    const sel = this.selected ? this.items.get(this.selected) : undefined;
    if (!sel) return false;
    if (k === "delete" || k === "backspace") {
      if (sel.locked) return true;
      this.remove(sel.id);
      return true;
    }
    if (mod && k === "d") {
      this.duplicate(sel.id);
      return true;
    }
    if (k === "l" && e.shiftKey) {
      this.patch(sel.id, { locked: !sel.locked });
      return true;
    }
    return false;
  }

  private finishCreate() {
    const c = this.creating;
    if (!c) return;
    this.creating = null;
    try {
      const api = this.add({ type: c.type, points: c.points, ...(c.paneId && c.paneId !== "main" ? { paneId: c.paneId } : {}) });
      this.select(api.id);
    } catch (e) {
      console.error("[XChart] drawing could not be created", e);
    }
    this.host.emit({ type: "tool", tool: null });
  }

  // ---------- history ----------
  private snapshot(): DrawingData[] {
    return [...this.items.values()].map(clone);
  }
  private checkpoint() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }
  /** Checkpoint as if `orig` were still in place (drag starts mutate in place). */
  private checkpointFrom(orig: DrawingData) {
    const snap = this.snapshot().map((d) => (d.id === orig.id ? clone(orig) : d));
    this.undoStack.push(snap);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }
  private restore(state: DrawingData[]) {
    const next = new Map(state.map((d) => [d.id, clone(d)]));
    for (const id of [...this.items.keys()]) {
      if (!next.has(id)) {
        this.items.delete(id);
        this.handles.delete(id);
        if (this.selected === id) this.selected = null;
        this.host.emit({ type: "remove", id });
      }
    }
    for (const [id, d] of next) {
      const cur = this.items.get(id);
      if (!cur) {
        this.items.set(id, d);
        this.host.emit({ type: "create", drawing: clone(d) });
      } else if (JSON.stringify(cur) !== JSON.stringify(d)) {
        this.items.set(id, d);
        this.host.emit({ type: "update", drawing: clone(d) });
      }
    }
    // Keep insertion (z) order identical to the snapshot.
    const ordered = new Map<string, DrawingData>();
    for (const d of state) ordered.set(d.id, this.items.get(d.id)!);
    this.items = ordered;
    this.host.redraw();
  }

  private handle(id: string): DrawingHandle {
    let h = this.handles.get(id);
    if (!h) {
      h = new DrawingHandle(this, id, this.items.get(id)!.type);
      this.handles.set(id, h);
    }
    return h;
  }
  private nextId(type: string): string {
    let id: string;
    do id = `${type}-${++this.seq}`;
    while (this.items.has(id));
    return id;
  }
}
