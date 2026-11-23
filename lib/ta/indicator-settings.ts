// Per-indicator user settings: inputs, style overrides, placement, timeframe visibility and precision.
// Everything here is optional so layouts saved by earlier versions load unchanged.
import { INDICATOR_BY_ID, defaultParams, levelsOf, withDefaults, type Bar, type ComputeContext, type IndicatorDef } from "./catalog.ts";
import { withAlpha } from "../chart/geometry.ts";

export type LineDash = "solid" | "dashed" | "dotted";
export type OutputStyle = { color?: string; width?: number; visible?: boolean; opacity?: number; dash?: LineDash; colors?: string[] };
/** Fill or background-zone override. `color` is the "up" (or only) colour. */
export type FillStyle = { visible?: boolean; color?: string; down?: string; opacity?: number };
export type TfVisibility = { minutes: boolean; hours: boolean; days: boolean; weeks: boolean; months: boolean };

export type ActiveIndicator = {
  uid: string;
  id: string;
  params: Record<string, number>;
  styles?: Record<string, OutputStyle>;
  /** Keyed by fill id ("cloud", "bands", ...) or band id ("band", "obZone", ...). */
  fills?: Record<string, FillStyle>;
  /** Decimal places for values in the legend and price scale; undefined = automatic. */
  precision?: number;
  placement?: "overlay" | "separate";
  visibility?: TfVisibility;
  hidden?: boolean;
  scaleLabels?: boolean;
  statusValues?: boolean;
  statusInputs?: boolean;
};

export const ALL_VISIBLE: TfVisibility = { minutes: true, hours: true, days: true, weeks: true, months: true };

export function tfBucket(tf: string): keyof TfVisibility {
  if (/^\d+m$/.test(tf)) return "minutes";
  if (/^\d+h$/.test(tf)) return "hours";
  if (tf === "1W") return "weeks";
  if (tf === "1M") return "months";
  return "days";
}

type SavedDefault = Omit<ActiveIndicator, "uid" | "id">;
const KEY = "txp.indicatorDefaults";

function readDefaults(): Record<string, SavedDefault> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Factory settings merged with anything the user saved via "Save as default". */
export function newIndicator(def: IndicatorDef): ActiveIndicator {
  const saved = readDefaults()[def.id];
  return {
    uid: `${def.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    id: def.id,
    params: { ...defaultParams(def), ...(saved?.params ?? {}) },
    styles: saved?.styles ?? {},
    fills: saved?.fills ?? {},
    precision: saved?.precision,
    placement: saved?.placement,
    visibility: saved?.visibility ?? ALL_VISIBLE,
    scaleLabels: saved?.scaleLabels ?? true,
    statusValues: saved?.statusValues ?? true,
    statusInputs: saved?.statusInputs ?? true,
  };
}

export function saveAsDefault(ind: ActiveIndicator) {
  const all = readDefaults();
  const { uid: _uid, id, hidden: _hidden, ...rest } = ind;
  void _uid;
  void _hidden;
  all[id] = rest;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}

export function factoryReset(ind: ActiveIndicator): ActiveIndicator {
  const def = INDICATOR_BY_ID[ind.id];
  return { uid: ind.uid, id: ind.id, params: defaultParams(def), styles: {}, fills: {}, precision: undefined, visibility: ALL_VISIBLE, scaleLabels: true, statusValues: true, statusInputs: true };
}

export function inputSummary(ind: ActiveIndicator): string {
  const def = INDICATOR_BY_ID[ind.id];
  if (!def) return "";
  const params = withDefaults(def, ind.params);
  return def.params
    .filter((p) => p.kind !== "bool")
    .map((p) => (p.kind === "select" ? p.options?.[params[p.key]] ?? "" : String(params[p.key])))
    .filter(Boolean)
    .join(", ");
}

// ---------- resolving an indicator into drawable series ----------

export type ResolvedFill = { id: string; other: number[] | number; up: string; down: string; only?: "up" | "down" };
export type ResolvedSeries = {
  key: string;
  label: string;
  values: number[];
  color: string;
  style?: "line" | "histogram" | "dots" | "area";
  width?: number;
  opacity?: number;
  dash?: LineDash;
  scaleLabel?: boolean;
  precision?: number;
  fills?: ResolvedFill[];
  hist?: { mode: "trend" | "candle"; colors: string[] };
};
export type ResolvedBand = { from: number; to: number; color: string };
export type Resolved = { series: ResolvedSeries[]; levels?: number[]; bands: ResolvedBand[]; range?: [number, number] };

/** Computes an indicator and applies the user's style, fill and precision settings. */
export function resolveIndicator(ind: ActiveIndicator, bars: Bar[], ctx: ComputeContext): Resolved | null {
  const def = INDICATOR_BY_ID[ind.id];
  if (!def) return null;
  const params = withDefaults(def, ind.params);
  const outs = def.compute(bars, params, ctx);
  const series: ResolvedSeries[] = [];
  for (const o of outs) {
    const st = ind.styles?.[o.key] ?? {};
    if (st.visible === false) continue;
    const opacity = st.opacity ?? o.opacity ?? 1;
    const fills: ResolvedFill[] = [];
    for (const f of o.fills ?? []) {
      const fs = ind.fills?.[f.id] ?? {};
      if ((fs.visible ?? f.visible ?? true) === false) continue;
      const a = fs.opacity ?? f.opacity;
      fills.push({ id: f.id, other: f.other, up: withAlpha(fs.color ?? f.up, a), down: withAlpha(fs.down ?? f.down, a), only: f.only });
    }
    series.push({
      key: o.key,
      label: o.label,
      values: o.values,
      color: st.color ?? o.color,
      style: o.style,
      width: st.width ?? o.width,
      opacity: o.style === "histogram" ? 1 : opacity,
      dash: st.dash,
      scaleLabel: ind.scaleLabels !== false,
      precision: ind.precision,
      fills: fills.length ? fills : undefined,
      hist: o.hist ? { mode: o.hist.mode, colors: o.hist.colors.map((c, k) => withAlpha(st.colors?.[k] ?? c, opacity)) } : undefined,
    });
  }
  const bands: ResolvedBand[] = [];
  for (const b of def.bands?.(params) ?? []) {
    const fs = ind.fills?.[b.id] ?? {};
    if ((fs.visible ?? b.visible ?? true) === false) continue;
    bands.push({ from: b.from, to: b.to, color: withAlpha(fs.color ?? b.color, fs.opacity ?? b.opacity) });
  }
  return { series, levels: levelsOf(def, params), bands, range: def.range };
}
