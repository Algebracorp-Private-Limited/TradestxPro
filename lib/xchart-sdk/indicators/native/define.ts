/**
 * Native indicator definitions: one streaming graph per indicator is both the full calculation and
 * the incremental implementation (so live updates are exact by construction). Every definition
 * carries the metadata required by the catalogue (formula, conventions, missing-data policy,
 * limitations) and is validated against independent reference implementations in tests.
 */
import { StreamGraph } from "../dependencies.ts";
import * as K from "../incremental.ts";
import type { IndicatorDefinition, IndicatorInput, IndicatorParams, IndicatorResult, OutputDef, ParamSchema, StreamOutput } from "../types.ts";

export type Category = "Trend" | "Momentum" | "Volatility" | "Volume" | "Statistics" | "Structure";
export type CatalogMeta = {
  formula: string;
  /** "exact": incremental updates equal the full calculation (all native indicators). */
  incremental: "exact";
  missing: string;
  conventions?: string;
  limitations?: string;
  /** Whether values can change after the fact (repainting) and how that is shown. */
  repaint?: string;
};
export type NativeDefinition = IndicatorDefinition & { category: Category; meta: CatalogMeta; native: true };

type Spec = {
  id: string;
  name: string;
  category: Category;
  description: string;
  pane: "overlay" | "separate";
  params?: ParamSchema[];
  /** Adds a `source` parameter (default close). */
  source?: boolean;
  outputs: OutputDef[];
  levels?: number[] | ((p: IndicatorParams) => number[]);
  range?: [number, number];
  requires?: string[];
  meta: Omit<CatalogMeta, "incremental" | "missing"> & { missing?: string };
  build(p: Record<string, number | string | boolean>, x: K.NodeDef): StreamOutput[];
};

const DEFAULT_MISSING = "Bars that do not exist (gaps on the chart's time axis) are skipped before calculation; a NaN inside a rolling window restarts the window.";

export const len = (key = "length", def = 14, label = "Length", min = 1, max = 500): ParamSchema => ({ key, label, type: "integer", default: def, min, max, aliases: key === "length" ? ["period"] : undefined });
export const num = (key: string, def: number, label: string, min: number, max: number, step = 0.1): ParamSchema => ({ key, label, type: "number", default: def, min, max, step });
export const sel = (key: string, def: string, label: string, options: string[]): ParamSchema => ({ key, label, type: "select", default: def, options });
export const line = (key: string, label: string, color: string, extra: Partial<OutputDef> = {}): OutputDef => ({ key, label, type: "line", color, ...extra });
export const histo = (key: string, label: string, color: string): OutputDef => ({ key, label, type: "histogram", color, hist: { mode: "sign", colors: ["#22c55e", "#ef4444"] } });
export const out = (key: string, node: K.NodeDef, extra: Partial<StreamOutput> = {}): StreamOutput => ({ key, node, ...extra });

/** Synthetic sample used only to measure warm-up (never shown as market data). */
function sample(n: number): IndicatorInput {
  const o: IndicatorInput = { time: [], open: [], high: [], low: [], close: [], volume: [], intraday: false, benchmark: [] };
  let p = 100, b = 50, s = 11;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const op = p;
    p = Math.max(1, p + (r() - 0.5) * 3);
    b = Math.max(1, b + (r() - 0.5) * 1.5);
    o.time.push(1_700_000_000 + i * 86400);
    o.open.push(op);
    o.high.push(Math.max(op, p) + r());
    o.low.push(Math.min(op, p) - r());
    o.close.push(p);
    o.volume.push(1000 + Math.round(r() * 9000));
    o.benchmark!.push(b);
  }
  return o;
}

export function runGraph(outs: StreamOutput[], input: IndicatorInput): IndicatorResult {
  const g = new StreamGraph();
  g.acquire(outs.map((o) => o.node));
  g.sync(input);
  const n = input.time.length;
  const res: IndicatorResult = {};
  for (const o of outs) {
    const v = g.values(o.node.key);
    const sh = o.shift ?? 0;
    const len = n + (o.projection && sh > 0 ? sh : 0);
    const a = new Array<number>(len);
    for (let i = 0; i < len; i++) {
      const j = i - sh;
      a[i] = j >= 0 && j < n ? v[j] : NaN;
    }
    res[o.key] = a;
  }
  g.destroy();
  return res;
}

export function defineNative(d: Spec): NativeDefinition {
  const params: ParamSchema[] = [...(d.params ?? []), ...(d.source ? [{ key: "source", label: "Source", type: "source" as const, default: "close" }] : [])];
  const build = (p: IndicatorParams) => d.build(p, K.src(((p.source as K.SourceName) ?? "close") as K.SourceName));
  const warmCache = new Map<string, number>();
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    category: d.category,
    native: true,
    params,
    inputs: ["open", "high", "low", "close", "volume"],
    outputs: d.outputs,
    pane: d.pane,
    levels: d.levels,
    range: d.range,
    requires: d.requires ?? [],
    meta: { incremental: "exact", missing: d.meta.missing ?? DEFAULT_MISSING, ...d.meta },
    warmup(p) {
      const k = JSON.stringify(p);
      let w = warmCache.get(k);
      if (w === undefined) {
        const lens = params.filter((x) => x.type === "integer").map((x) => Number(p[x.key]) || 0);
        const n = Math.min(6000, Math.max(400, ...lens.map((l) => l * 4 + 60)));
        const r = runGraph(build(p), sample(n));
        const first = r[d.outputs[0].key] ?? [];
        w = first.findIndex((v) => Number.isFinite(v));
        if (w < 0) w = n;
        warmCache.set(k, w);
      }
      return w;
    },
    calculate: (input, p) => runGraph(build(p), input),
    stream: (p) => ({ outputs: build(p) }),
    display: { shortName: d.id.toUpperCase() },
  };
}
export { K };
