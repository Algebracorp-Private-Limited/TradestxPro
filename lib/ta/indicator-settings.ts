// Per-indicator user settings: inputs, style overrides, placement and timeframe visibility.
import { INDICATOR_BY_ID, defaultParams, type IndicatorDef } from "./catalog";

export type OutputStyle = { color?: string; width?: number; visible?: boolean };
export type TfVisibility = { minutes: boolean; hours: boolean; days: boolean; weeks: boolean; months: boolean };

export type ActiveIndicator = {
  uid: string;
  id: string;
  params: Record<string, number>;
  styles?: Record<string, OutputStyle>;
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
  return { uid: ind.uid, id: ind.id, params: defaultParams(def), styles: {}, visibility: ALL_VISIBLE, scaleLabels: true, statusValues: true, statusInputs: true };
}

export function inputSummary(ind: ActiveIndicator): string {
  const def = INDICATOR_BY_ID[ind.id];
  if (!def) return "";
  return def.params
    .filter((p) => p.kind !== "bool")
    .map((p) => (p.kind === "select" ? p.options?.[ind.params[p.key]] ?? "" : String(ind.params[p.key])))
    .filter(Boolean)
    .join(", ");
}
