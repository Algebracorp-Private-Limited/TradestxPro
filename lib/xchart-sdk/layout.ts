/**
 * Layout (de)serialisation helpers. A layout is plain JSON describing how a chart looks: options,
 * chart type, series options, indicators, drawings, price scales, panes and the session calendar.
 *
 * Safety rules:
 * - Built from an allow-list of fields only, so nothing else (tokens, credentials, account data,
 *   functions) can end up in an export.
 * - Market data is NOT included unless explicitly requested (includeData: true).
 * - Loading never executes code: plugins are listed by name only and are never installed by a load;
 *   indicator types must already be registered.
 * - Input is checked before anything changes (size, depth, prototype keys, types, every option).
 */
import { XChartError } from "./validation.ts";

export const LAYOUT_FORMAT = "xchart-layout";
export const LAYOUT_VERSION = 1;
export const MAX_LAYOUT_BYTES = 5 * 1024 * 1024;
const MAX_DEPTH = 16;
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type LayoutSeries = { type: string; options: Record<string, unknown>; data?: unknown[] };
export type LayoutIndicator = { type: string; params: Record<string, unknown>; options: Record<string, unknown> };
export type ChartLayout = {
  format: typeof LAYOUT_FORMAT;
  version: typeof LAYOUT_VERSION;
  sdkVersion?: string;
  chart: Record<string, unknown>;
  chartType: { type: string; style: Record<string, unknown> };
  series: LayoutSeries[];
  indicators: LayoutIndicator[];
  drawings: unknown[];
  priceScales: Record<string, { margins?: { top: number; bottom: number }; visible?: boolean }>;
  /** Pane refs: "main", "series:<n>" (n-th series), "indicator:<n>" or a named pane id. */
  panes: { sizes?: Record<string, number>; collapsed: string[]; order: string[] };
  session?: { calendar: string } | null;
  /** Informational: plugin ids installed when saved (never installed by a load). */
  plugins: string[];
};
export type LayoutLoadOptions = {
  /** Drop indicators whose type is not registered instead of failing (default false). */
  skipUnknownIndicators?: boolean;
  /** Apply series data contained in the layout (default true when present). */
  applyData?: boolean;
};
export type LayoutLoadReport = {
  seriesMatched: number;
  seriesCreated: number;
  seriesSkipped: number;
  indicatorsAdded: number;
  indicatorsSkipped: string[];
  drawings: number;
  pluginsNotInstalled: string[];
};

/** Chart options a layout may carry (everything else is ignored on save and rejected on load). */
export const LAYOUT_CHART_KEYS = ["theme", "crosshair", "followLatest", "priceScale", "utcOffsetMinutes", "timeZone", "locale"];

/** Rejects non-JSON values, prototype keys and excessive depth. */
export function assertPlainJson(v: unknown, depth = 0, path = "layout"): void {
  if (depth > MAX_DEPTH) throw new XChartError("INVALID_LAYOUT", `${path}: nested too deeply`);
  if (v === null || typeof v === "string" || typeof v === "boolean") return;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new XChartError("INVALID_LAYOUT", `${path}: numbers must be finite`);
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => assertPlainJson(x, depth + 1, `${path}[${i}]`));
    return;
  }
  if (typeof v === "object") {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new XChartError("INVALID_LAYOUT", `${path}: only plain objects are allowed`);
    for (const k of Object.keys(v as object)) {
      if (BAD_KEYS.has(k)) throw new XChartError("INVALID_LAYOUT", `${path}: key "${k}" is not allowed`);
      assertPlainJson((v as Record<string, unknown>)[k], depth + 1, `${path}.${k}`);
    }
    return;
  }
  throw new XChartError("INVALID_LAYOUT", `${path}: ${typeof v} values are not allowed`);
}

/** Parses (if needed) and checks the envelope of a layout. Returns a deep copy. */
export function parseLayout(input: unknown): ChartLayout {
  let v: unknown = input;
  if (typeof input === "string") {
    if (input.length > MAX_LAYOUT_BYTES) throw new XChartError("INVALID_LAYOUT", `Layout is larger than ${MAX_LAYOUT_BYTES} bytes`);
    try {
      v = JSON.parse(input);
    } catch {
      throw new XChartError("INVALID_LAYOUT", "Layout is not valid JSON");
    }
  }
  assertPlainJson(v);
  const copy = JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
  if (JSON.stringify(copy).length > MAX_LAYOUT_BYTES) throw new XChartError("INVALID_LAYOUT", `Layout is larger than ${MAX_LAYOUT_BYTES} bytes`);
  if (!copy || typeof copy !== "object" || Array.isArray(copy)) throw new XChartError("INVALID_LAYOUT", "Layout must be an object");
  if (copy.format !== LAYOUT_FORMAT) throw new XChartError("INVALID_LAYOUT", `Not an XChart layout (format must be "${LAYOUT_FORMAT}")`);
  if (copy.version !== LAYOUT_VERSION) throw new XChartError("UNSUPPORTED_LAYOUT", `Layout version ${String(copy.version)} is not supported (expected ${LAYOUT_VERSION})`);
  const allowed = ["format", "version", "sdkVersion", "chart", "chartType", "series", "indicators", "drawings", "priceScales", "panes", "session", "plugins"];
  for (const k of Object.keys(copy)) if (!allowed.includes(k)) throw new XChartError("INVALID_LAYOUT", `Unknown layout field "${k}"`);
  const obj = (k: string) => {
    const x = copy[k];
    if (x === undefined) return {};
    if (!x || typeof x !== "object" || Array.isArray(x)) throw new XChartError("INVALID_LAYOUT", `layout.${k} must be an object`);
    return x as Record<string, unknown>;
  };
  const arr = (k: string, max: number) => {
    const x = copy[k];
    if (x === undefined) return [];
    if (!Array.isArray(x)) throw new XChartError("INVALID_LAYOUT", `layout.${k} must be an array`);
    if (x.length > max) throw new XChartError("INVALID_LAYOUT", `layout.${k} has more than ${max} entries`);
    return x;
  };
  const chart = obj("chart");
  for (const k of Object.keys(chart)) if (!LAYOUT_CHART_KEYS.includes(k)) throw new XChartError("INVALID_LAYOUT", `layout.chart.${k} is not a layout option`);
  const ct = obj("chartType");
  const series = arr("series", 64) as LayoutSeries[];
  series.forEach((s, i) => {
    if (!s || typeof s !== "object" || typeof s.type !== "string") throw new XChartError("INVALID_LAYOUT", `layout.series[${i}] needs a type`);
    for (const k of Object.keys(s)) if (!["type", "options", "data"].includes(k)) throw new XChartError("INVALID_LAYOUT", `layout.series[${i}].${k} is not allowed`);
    if (s.options !== undefined && (typeof s.options !== "object" || Array.isArray(s.options) || !s.options)) throw new XChartError("INVALID_LAYOUT", `layout.series[${i}].options must be an object`);
    if (s.data !== undefined && !Array.isArray(s.data)) throw new XChartError("INVALID_LAYOUT", `layout.series[${i}].data must be an array`);
  });
  const indicators = arr("indicators", 64) as LayoutIndicator[];
  indicators.forEach((d, i) => {
    if (!d || typeof d !== "object" || typeof d.type !== "string") throw new XChartError("INVALID_LAYOUT", `layout.indicators[${i}] needs a type`);
    for (const k of Object.keys(d)) if (!["type", "params", "options"].includes(k)) throw new XChartError("INVALID_LAYOUT", `layout.indicators[${i}].${k} is not allowed`);
  });
  const panes = obj("panes");
  const sizes = panes.sizes as Record<string, unknown> | undefined;
  if (sizes !== undefined) {
    if (!sizes || typeof sizes !== "object" || Array.isArray(sizes)) throw new XChartError("INVALID_LAYOUT", "layout.panes.sizes must be an object");
    for (const [k, v] of Object.entries(sizes)) if (typeof v !== "number" || v < 10 || v > 5000 || k.length > 64) throw new XChartError("INVALID_LAYOUT", `layout.panes.sizes.${k} must be 10–5000 px`);
  }
  for (const k of ["collapsed", "order"]) {
    const x = panes[k];
    if (x !== undefined && (!Array.isArray(x) || x.length > 64 || x.some((p) => typeof p !== "string" || p.length > 64))) throw new XChartError("INVALID_LAYOUT", `layout.panes.${k} must be a list of pane refs`);
  }
  const session = copy.session as { calendar?: unknown } | null | undefined;
  if (session !== undefined && session !== null && (typeof session !== "object" || typeof session.calendar !== "string")) throw new XChartError("INVALID_LAYOUT", "layout.session must be { calendar } or null");
  const plugins = arr("plugins", 64);
  if (plugins.some((p) => typeof p !== "string")) throw new XChartError("INVALID_LAYOUT", "layout.plugins must be plugin ids");
  return {
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    sdkVersion: typeof copy.sdkVersion === "string" ? copy.sdkVersion : undefined,
    chart,
    chartType: { type: typeof ct.type === "string" ? ct.type : "candles", style: (ct.style as Record<string, unknown>) ?? {} },
    series: series.map((s) => ({ type: s.type, options: s.options ?? {}, data: s.data })),
    indicators: indicators.map((d) => ({ type: d.type, params: (d.params as Record<string, unknown>) ?? {}, options: (d.options as Record<string, unknown>) ?? {} })),
    drawings: arr("drawings", 2000),
    priceScales: obj("priceScales") as ChartLayout["priceScales"],
    panes: { sizes: sizes as Record<string, number> | undefined, collapsed: (panes.collapsed as string[]) ?? [], order: (panes.order as string[]) ?? [] },
    session: (session as { calendar: string } | null | undefined) ?? null,
    plugins: plugins as string[],
  };
}
