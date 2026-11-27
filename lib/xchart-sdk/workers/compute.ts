/**
 * Computation shared by the worker and the synchronous fallback (pure; no DOM, no worker APIs).
 * Uses the same streaming kernels as the chart, so results are identical to main-thread results.
 */
import { BUILTIN_INDICATORS } from "../indicators/builtins.ts";
import { StreamGraph } from "../indicators/dependencies.ts";
import { resolveParams } from "../indicators/validation.ts";
import { computeDerived, DERIVED_KINDS } from "../derived/index.ts";
import type { DerivedKind } from "../derived/types.ts";
import type { Columns, IndicatorJob } from "./protocol.ts";

export function computeIndicators(cols: Columns, jobs: IndicatorJob[], intraday: boolean, cancelled: () => boolean = () => false) {
  const n = cols.time.length;
  const g = new StreamGraph(); // one graph per job: indicators in one request share intermediate nodes
  const specs = jobs.map((j) => {
    const def = BUILTIN_INDICATORS.find((d) => d.id === j.id);
    if (!def?.stream) return { error: `Unknown or non-streaming built-in indicator "${j.id}"` };
    try {
      const spec = def.stream(resolveParams(def, j.params), { intraday });
      g.acquire([...spec.outputs.map((o) => o.node), ...(spec.activeWhen ? [spec.activeWhen] : [])]);
      return { spec };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });
  if (cancelled()) return null;
  g.sync(cols);
  return specs.map((s) => {
    if (!("spec" in s) || !s.spec) return { error: s.error! };
    const spec = s.spec;
    const active = !spec.activeWhen || g.values(spec.activeWhen.key)[n - 1] === 1;
    const outputs: Record<string, Float64Array> = {};
    if (active) {
      for (const o of spec.outputs) {
        const v = g.values(o.node.key);
        const sh = o.shift ?? 0;
        const len = n + (o.projection && sh > 0 ? sh : 0);
        const a = new Float64Array(len);
        for (let i = 0; i < len; i++) {
          const j = i - sh;
          a[i] = j >= 0 && j < n ? v[j] : NaN;
        }
        outputs[o.key] = a;
      }
    }
    return { outputs };
  });
}

export function computeDerivedPoints(cols: Columns, kind: string, settings: Record<string, unknown>) {
  if (!DERIVED_KINDS.includes(kind as DerivedKind)) throw new Error(`Unknown derived chart type "${kind}"`);
  const candles = Array.from(cols.time, (t, i) => ({ time: t, open: cols.open[i], high: cols.high[i], low: cols.low[i], close: cols.close[i] }));
  return computeDerived(kind as DerivedKind, candles, settings as never);
}
