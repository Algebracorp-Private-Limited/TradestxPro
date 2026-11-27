/**
 * Indicator runtime: runs definitions against the chart's price data, aligns outputs to the
 * shared time axis and turns them into renderer plots. Pure data logic (no DOM).
 *
 * Calculation strategy
 * - Inputs contain only bars that exist (gap slots on the axis are skipped), so missing data
 *   never feeds NaN into recursive calculations; outputs are written back to their axis slots.
 * - Live tick (last bar replaced / one bar appended): indicators with a finite `lookback` recompute
 *   only a window ending at the last bar (exact, because older values cannot change); recursive
 *   ones and anything else are recalculated in full. Recalculation is deferred to `flush()`, which
 *   the chart calls once per frame, so a burst of ticks costs one calculation.
 */
import type { PaneSpec, PlotSeries } from "../../../components/chart/engine.ts";
import { withAlpha } from "../../chart/geometry.ts";
import { XChartError } from "../validation.ts";
import type { BuiltinDefinition } from "./builtins.ts";
import type { IndicatorApi, IndicatorDefinition, IndicatorInput, IndicatorOptions, IndicatorParams, IndicatorPoint, IndicatorResult, OutputDef } from "./types.ts";
import { resolveParams, validateIndicatorOptions } from "./validation.ts";
import type { StreamGraph } from "./dependencies.ts";
import type { StreamSpec } from "./types.ts";

/** What the runtime needs from the chart. */
export type IndicatorHost = {
  /** Price input (existing bars only) and, for each input bar, its axis slot. */
  input(): { input: IndicatorInput; axisIdx: number[]; axisLength: number } | null;
  /** Shared streaming graph, synced to the current input (null when unavailable). */
  graph?(): StreamGraph | null;
  /** Time of the k-th slot after the last input bar (projection labels). */
  futureTime(k: number): number;
  changed(kind: "full" | "plots"): void;
  emit(type: "indicatorChange" | "indicatorError", payload: { indicator: IndicatorApi; error?: string; action?: string }): void;
};

const describe = (d: IndicatorDefinition, p: IndicatorParams): OutputDef[] =>
  (d as Partial<BuiltinDefinition>).describeOutputs ? (d as BuiltinDefinition).describeOutputs(p) : d.outputs;

export class IndicatorInstance implements IndicatorApi {
  readonly id: string;
  readonly type: string;
  private def: IndicatorDefinition;
  private params: IndicatorParams;
  private opts: IndicatorOptions;
  private host: IndicatorHost | null;
  private onRemove: (i: IndicatorInstance) => void;
  private dirty: "full" | "tail" | null = "full";
  private raw: IndicatorResult = {};
  private outs: OutputDef[] = [];
  /** Output arrays aligned to the axis (+ projection slots). Mutated in place between frames. */
  aligned: Record<string, number[]> = {};
  private err: string | null = null;
  private lastN = 0;
  private lastAxisLen = 0;
  /** Number of projected slots past the last input bar (e.g. Ichimoku cloud). */
  projection = 0;
  // Streaming state (definitions with `stream`).
  private spec: StreamSpec | null = null;
  private specIntraday: boolean | null = null;
  private release: (() => void) | null = null;
  private streamGraph: StreamGraph | null = null;
  /** "stream" when the last flush used the incremental graph, "full" for the reference calculation. */
  mode: "stream" | "full" = "full";

  constructor(id: string, def: IndicatorDefinition, params: Record<string, unknown> | undefined, opts: IndicatorOptions, host: IndicatorHost, onRemove: (i: IndicatorInstance) => void) {
    this.id = id;
    this.type = def.id;
    this.def = def;
    this.params = resolveParams(def, params);
    this.outs = describe(def, this.params);
    validateIndicatorOptions(opts, this.outs.map((o) => o.key));
    this.opts = { visible: true, ...opts };
    this.host = host;
    this.onRemove = onRemove;
  }

  private alive(): IndicatorHost {
    if (!this.host) throw new XChartError("INDICATOR_REMOVED", "This indicator was removed from the chart");
    return this.host;
  }

  definition() {
    return this.def;
  }
  parameters() {
    return { ...this.params };
  }
  options() {
    return { ...this.opts };
  }
  outputs(): OutputDef[] {
    return this.outs;
  }
  isVisible() {
    return this.opts.visible !== false;
  }
  error() {
    return this.err;
  }

  applyOptions(o: Partial<IndicatorOptions>): void {
    const host = this.alive();
    validateIndicatorOptions(o, this.outs.map((x) => x.key));
    this.opts = { ...this.opts, ...o };
    host.changed("full");
    host.emit("indicatorChange", { indicator: this, action: "options" });
  }

  setParameters(p: Partial<IndicatorParams>): void {
    const host = this.alive();
    const next = resolveParams(this.def, p as Record<string, unknown>, this.params); // throws before any change
    const outs = describe(this.def, next);
    this.params = next;
    this.outs = outs;
    this.dirty = "full";
    this.detachStream(); // parameter change: re-register the nodes (re-initialised from history)
    host.changed("full");
    host.emit("indicatorChange", { indicator: this, action: "parameters" });
  }

  setVisible(v: boolean): void {
    if (typeof v !== "boolean") throw new XChartError("INVALID_OPTION", "setVisible expects a boolean");
    this.applyOptions({ visible: v });
  }

  recalculate(): void {
    this.alive();
    this.dirty = "full";
    this.flush();
    this.host!.changed("plots");
  }

  private detachStream() {
    this.release?.();
    this.release = null;
    this.spec = null;
    this.streamGraph = null;
  }

  remove(): void {
    if (!this.host) return;
    this.detachStream(); // releases cached calculation state (shared nodes are reference counted)
    this.host = null;
    this.aligned = {};
    this.raw = {};
    this.onRemove(this);
  }

  /** Marks data as changed. "tail" = only the last bar changed or one bar was appended. */
  invalidate(kind: "full" | "tail") {
    if (this.dirty === "full") return;
    this.dirty = kind;
  }

  /** Recalculates if needed. Returns true when output arrays changed. */
  flush(): boolean {
    const host = this.host;
    if (!host || !this.dirty) return false;
    const src = host.input();
    const kind = this.dirty;
    this.dirty = null;
    if (!src || !src.input.time.length) {
      this.raw = {};
      this.writeAligned(src?.axisIdx ?? [], src?.axisLength ?? 0, 0);
      return true;
    }
    const { input, axisIdx, axisLength } = src;
    const n = input.time.length;
    const graph = this.def.stream ? host.graph?.() ?? null : null;
    if (graph) {
      try {
        return this.flushStream(graph, kind, input, axisIdx, axisLength);
      } catch (e) {
        // Fall back to the reference calculation; report the problem.
        this.detachStream();
        this.err = e instanceof Error ? e.message : String(e);
        host.emit("indicatorError", { indicator: this, error: this.err });
        return true;
      }
    }
    this.mode = "full";
    try {
      const lb = this.def.lookback?.(this.params);
      const canTail = kind === "tail" && this.def.update === undefined && lb !== undefined && n >= this.lastN && n - this.lastN <= 1 && this.lastN > 0 && Object.keys(this.raw).length > 0;
      if (kind === "tail" && this.def.update && this.lastN > 0 && n - this.lastN <= 1) {
        this.raw = this.def.update(input, this.params, this.raw, Math.max(0, this.lastN - 1));
      } else if (canTail) {
        // Finite memory: values before the last bar cannot change. Recompute a window ending at it.
        const start = Math.max(0, n - 1 - (lb! + 2) * 2);
        const slice = sliceInput(input, start);
        const part = this.def.calculate(slice, this.params);
        for (const [k, arr] of Object.entries(part)) {
          const full = (this.raw[k] ??= []);
          full.length = Math.max(full.length, n);
          for (let i = Math.max(0, this.lastN - 1); i < n; i++) full[i] = arr[i - start] ?? NaN;
        }
      } else {
        this.raw = this.def.calculate(input, this.params);
      }
      checkResult(this.def.id, this.raw, n);
      this.err = null;
    } catch (e) {
      this.raw = {};
      this.err = e instanceof Error ? e.message : String(e);
      host.emit("indicatorError", { indicator: this, error: this.err });
    }
    this.lastN = n;
    this.writeAligned(axisIdx, axisLength, n);
    return true;
  }

  /** Incremental path: shared graph, outputs updated from the first changed bar only. */
  private flushStream(graph: StreamGraph, kind: "full" | "tail", input: IndicatorInput, axisIdx: number[], axisLength: number): boolean {
    const n = input.time.length;
    let full = kind === "full";
    if (!this.spec || this.streamGraph !== graph || this.specIntraday !== input.intraday) {
      this.detachStream();
      const spec = this.def.stream!(this.params, { intraday: input.intraday });
      this.release = graph.acquire([...spec.outputs.map((o) => o.node), ...(spec.activeWhen ? [spec.activeWhen] : [])]);
      this.spec = spec;
      this.specIntraday = input.intraday;
      this.streamGraph = graph;
      full = true;
    }
    this.host!.graph!(); // sync once per input revision (no-op when already synced)
    const spec = this.spec;
    const active = !spec.activeWhen || graph.values(spec.activeWhen.key)[n - 1] === 1;
    const from = full || !active || this.lastN === 0 ? 0 : Math.min(graph.changedFrom, this.lastN, n);
    // Raw (input-indexed, shifted) arrays.
    const keys = new Set(spec.outputs.map((o) => o.key));
    for (const k of Object.keys(this.raw)) if (!keys.has(k) || !active) delete this.raw[k];
    let minRaw = Infinity;
    let proj = 0;
    if (active) {
      for (const o of spec.outputs) {
        const v = graph.values(o.node.key);
        const sh = o.shift ?? 0;
        const len = n + (o.projection && sh > 0 ? sh : 0);
        if (o.projection && sh > 0) proj = Math.max(proj, sh);
        const arr = (this.raw[o.key] ??= []);
        const lo = from === 0 ? 0 : Math.max(0, from + sh);
        if (from === 0) arr.length = 0;
        arr.length = len;
        for (let i = lo; i < len; i++) {
          const j = i - sh;
          arr[i] = j >= 0 && j < n ? v[j] : NaN;
        }
        minRaw = Math.min(minRaw, lo);
      }
    }
    this.err = null;
    this.mode = "stream";
    const prevN = this.lastN;
    this.lastN = n;
    if (from === 0 || full || Object.keys(this.aligned).length === 0 || axisLength < this.lastAxisLen || n < prevN) {
      this.writeAligned(axisIdx, axisLength, n);
    } else this.writeAlignedFrom(axisIdx, axisLength, n, Math.min(minRaw, n), proj);
    return true;
  }

  /** Rewrites aligned outputs from input index `k0` (axis positions before it are unchanged). */
  private writeAlignedFrom(axisIdx: number[], axisLength: number, n: number, k0: number, proj: number) {
    this.projection = proj;
    const last = n ? axisIdx[n - 1] : -1;
    const len = Math.max(axisLength, last + 1 + proj);
    const start = k0 < n ? axisIdx[k0] : last + (k0 - n + 1);
    for (const [key, arr] of Object.entries(this.raw)) {
      const out = (this.aligned[key] ??= []);
      const oldLen = out.length;
      out.length = len;
      for (let i = Math.min(start, oldLen); i < len; i++) out[i] = NaN;
      for (let k = k0; k < Math.min(n, arr.length); k++) out[axisIdx[k]] = arr[k];
      for (let k = Math.max(n, k0); k < arr.length; k++) out[last + (k - n + 1)] = arr[k];
    }
    this.lastAxisLen = axisLength;
  }

  private writeAligned(axisIdx: number[], axisLength: number, n: number) {
    let extra = 0;
    for (const arr of Object.values(this.raw)) extra = Math.max(extra, arr.length - n);
    this.projection = Math.max(0, extra);
    const last = n ? axisIdx[n - 1] : -1;
    const len = Math.max(axisLength, last + 1 + this.projection);
    for (const key of Object.keys(this.aligned)) if (!(key in this.raw)) delete this.aligned[key];
    for (const [key, arr] of Object.entries(this.raw)) {
      const out = (this.aligned[key] ??= []);
      out.length = len;
      out.fill(NaN);
      for (let k = 0; k < Math.min(n, arr.length); k++) out[axisIdx[k]] = arr[k];
      for (let k = n; k < arr.length; k++) out[last + (k - n + 1)] = arr[k];
    }
    this.lastAxisLen = axisLength;
  }

  /** Values with their times; warm-up and gaps omitted; projected points flagged. */
  getValues(): IndicatorPoint[] {
    const host = this.alive();
    this.flush();
    const src = host.input();
    if (!src) return [];
    const { input } = src;
    const n = input.time.length;
    const keys = Object.keys(this.raw);
    let len = n;
    for (const k of keys) len = Math.max(len, this.raw[k].length);
    const out: IndicatorPoint[] = [];
    for (let k = 0; k < len; k++) {
      const values: Record<string, number> = {};
      let any = false;
      for (const key of keys) {
        const v = this.raw[key][k];
        if (Number.isFinite(v)) {
          values[key] = v;
          any = true;
        }
      }
      if (!any) continue;
      out.push({ time: k < n ? input.time[k] : host.futureTime(k - n + 1), projected: k >= n, values });
    }
    return out;
  }

  /** Renderer plots for the current options (empty when hidden or failed). */
  plots(): { pane: string; series: PlotSeries[]; levels?: number[]; range?: [number, number] } {
    const def = this.def;
    const pane = this.opts.pane ?? (def.pane === "overlay" ? "overlay" : "separate");
    if (!this.isVisible() || this.err) return { pane, series: [] };
    const hidden = new Set(this.opts.hiddenOutputs ?? []);
    const series: PlotSeries[] = [];
    this.outs.forEach((o, idx) => {
      const values = this.aligned[o.key];
      if (!values || hidden.has(o.key)) return;
      const color = this.opts.colors?.[o.key] ?? (idx === 0 && this.opts.color ? this.opts.color : o.color);
      const fills = (o.fills ?? [])
        .map((f) => {
          const fo = this.opts.fills?.[f.id] ?? {};
          if (fo.visible === false) return null;
          const other = typeof f.with === "number" ? f.with : this.aligned[f.with] ?? null;
          if (other === null) return null;
          const op = fo.opacity ?? f.opacity;
          return { other, up: withAlpha(fo.up ?? f.up, op), down: withAlpha(fo.down ?? f.down, op), only: f.only };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      series.push({
        label: o.label,
        values,
        color,
        style: o.type === "area" ? "line" : o.type,
        width: this.opts.lineWidth ?? o.width,
        dash: this.opts.lineStyle,
        scaleLabel: o.type !== "histogram",
        precision: def.display?.precision,
        fills: fills.length ? fills : undefined,
        hist: o.hist,
        area: o.type === "area" ? { top: withAlpha(color, 0.3), bottom: withAlpha(color, 0) } : undefined,
      });
    });
    const lv = typeof def.levels === "function" ? def.levels(this.params) : def.levels;
    return { pane, series, levels: lv, range: def.range };
  }

  /** Short legend title, e.g. "RSI 14". */
  title(): string {
    if (this.opts.title) return this.opts.title;
    const nums = this.def.params.filter((p) => p.type === "integer" || p.type === "number").map((p) => this.params[p.key]);
    return `${this.def.display?.shortName ?? this.def.name}${nums.length ? " " + nums.join(",") : ""}`;
  }

  /** @internal Bound host for the chart's input lookup (null once removed). */
  attached(): boolean {
    return this.host !== null;
  }
  /** @internal Axis length at the last write (diagnostics). */
  axisLength(): number {
    return this.lastAxisLen;
  }
}

function sliceInput(i: IndicatorInput, start: number): IndicatorInput {
  return {
    time: i.time.slice(start), open: i.open.slice(start), high: i.high.slice(start), low: i.low.slice(start),
    close: i.close.slice(start), volume: i.volume.slice(start), intraday: i.intraday,
  };
}

function checkResult(id: string, r: IndicatorResult, n: number) {
  if (!r || typeof r !== "object") throw new Error(`Indicator "${id}" returned no result`);
  for (const [k, arr] of Object.entries(r)) {
    if (!Array.isArray(arr)) throw new Error(`Indicator "${id}": output "${k}" is not an array`);
    if (arr.length < n) throw new Error(`Indicator "${id}": output "${k}" has ${arr.length} values for ${n} bars`);
  }
}

/** Builds pane specs and overlays from all instances. */
export function indicatorPlots(list: IndicatorInstance[]): { overlays: PlotSeries[]; panes: PaneSpec[]; future: number } {
  const overlays: PlotSeries[] = [];
  const panes = new Map<string, PaneSpec>();
  let future = 0;
  for (const ind of list) {
    const p = ind.plots();
    if (!p.series.length) continue;
    future = Math.max(future, ind.projection);
    if (p.pane === "overlay" || p.pane === "main") overlays.push(...p.series);
    else {
      const id = p.pane === "separate" ? `xind-${ind.id}` : p.pane;
      const spec = panes.get(id) ?? { id, title: ind.title(), series: [], levels: p.levels, range: p.range };
      spec.series.push(...p.series);
      panes.set(id, spec);
    }
  }
  return { overlays, panes: [...panes.values()], future };
}
