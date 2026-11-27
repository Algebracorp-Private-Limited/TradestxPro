/**
 * Chart synchronisation: keeps the visible time range and/or the crosshair of several charts
 * aligned by TIME (charts may have different bars). No global state: each group owns its
 * subscriptions and is released with destroy(); a removed chart leaves its group automatically.
 */
import type { ChartApi, Unsubscribe, VisibleTimeRange } from "./types.ts";
import { XChartError } from "./validation.ts";

export type SyncOptions = {
  /** Sync the visible time range (default true). */
  timeRange?: boolean;
  /** Sync the crosshair (default true). */
  crosshair?: boolean;
  /** Also show the source's price on the other charts' crosshairs (default false: prices differ between symbols). */
  crosshairPrice?: boolean;
};

export interface SyncGroup {
  add(chart: ChartApi): void;
  remove(chart: ChartApi): void;
  charts(): ChartApi[];
  destroy(): void;
}

export function syncCharts(charts: ChartApi[] = [], options: SyncOptions = {}): SyncGroup {
  if (!Array.isArray(charts)) throw new XChartError("INVALID_OPTION", "syncCharts expects an array of charts");
  if (!options || typeof options !== "object") throw new XChartError("INVALID_OPTION", "syncCharts options must be an object");
  for (const k of ["timeRange", "crosshair", "crosshairPrice"] as const) {
    if (options[k] !== undefined && typeof options[k] !== "boolean") throw new XChartError("INVALID_OPTION", `${k} must be a boolean`);
  }
  const opts = { timeRange: options.timeRange !== false, crosshair: options.crosshair !== false, crosshairPrice: options.crosshairPrice === true };
  const members = new Map<ChartApi, Unsubscribe[]>();
  // Re-entrancy guard: a range we pushed into a chart must not be pushed back out of it.
  let applying = false;
  let destroyed = false;

  const close = (a: VisibleTimeRange, b: VisibleTimeRange, chart: ChartApi) => {
    const r = chart.getVisibleRange();
    const span = r ? Math.max(1, r.to - r.from) : 1;
    return Math.abs(a.from - b.from) <= span * 1e-4 && Math.abs(a.to - b.to) <= span * 1e-4;
  };

  const add = (chart: ChartApi) => {
    if (destroyed) throw new XChartError("SYNC_DESTROYED", "This sync group was destroyed");
    if (!chart || typeof chart.on !== "function") throw new XChartError("INVALID_OPTION", "syncCharts needs chart instances");
    if (members.has(chart)) return;
    const offs: Unsubscribe[] = [];
    if (opts.timeRange) {
      offs.push(chart.on("visibleRangeChange", ({ range }) => {
        if (applying) return;
        applying = true;
        try {
          for (const other of members.keys()) {
            if (other === chart) continue;
            const cur = other.getVisibleRange();
            if (cur && close(cur, range, other)) continue;
            try {
              other.setVisibleRange(range);
            } catch {
              /* a chart without data cannot follow yet */
            }
          }
        } finally {
          applying = false;
        }
      }));
    }
    if (opts.crosshair) {
      offs.push(chart.on("crosshairMove", (e) => {
        for (const other of members.keys()) {
          if (other === chart) continue;
          try {
            if (e.time === null) other.clearCrosshairPosition();
            else other.setCrosshairPosition(e.time, opts.crosshairPrice ? e.price : null);
          } catch {
            /* removed meanwhile */
          }
        }
      }));
    }
    offs.push(chart.on("destroy", () => remove(chart)));
    members.set(chart, offs);
  };

  const remove = (chart: ChartApi) => {
    const offs = members.get(chart);
    if (!offs) return;
    members.delete(chart);
    for (const off of offs) off();
  };

  for (const c of charts) add(c);
  return {
    add,
    remove,
    charts: () => [...members.keys()],
    destroy() {
      destroyed = true;
      for (const c of [...members.keys()]) remove(c);
    },
  };
}
