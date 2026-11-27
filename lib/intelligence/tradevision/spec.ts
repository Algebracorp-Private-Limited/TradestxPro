/**
 * TradeVision chart specification: a declarative, JSON-only description of what to draw on the
 * proprietary XChart canvas (levels, zones, markers, indicators). Specs are DATA, never code:
 *   - every element type, field and enum is whitelisted; unknown fields are rejected;
 *   - prices must be finite and inside a sane band around the instrument's data range;
 *   - times must fall inside the chart's data window (zones may extend at most 30 days ahead);
 *   - text is plain, short, and rejected if it looks like markup or script;
 *   - indicator ids must be in the SDK's registry list supplied by the caller.
 * AI-proposed elements go through the same validator as engine elements (and numeric grounding in the
 * API layer). Nothing from a spec is ever evaluated as JavaScript.
 */

export const SPEC_VERSION = 1;
export const LEVEL_ROLES = ["support", "resistance", "entry", "stop", "target", "invalidation", "breakeven", "expected-move", "max-pain", "last-close"] as const;
export const ZONE_ROLES = ["demand", "supply", "entry", "target", "expected-move", "stop-area"] as const;
export type LevelRole = (typeof LEVEL_ROLES)[number];
export type ZoneRole = (typeof ZONE_ROLES)[number];
export type ElementSource = "engine" | "ai";

type Base = { id: string; source: ElementSource; label: string; evidence: string };
export type LevelEl = Base & { kind: "level"; role: LevelRole; price: number };
export type ZoneEl = Base & { kind: "zone"; role: ZoneRole; from: number; to: number | null; low: number; high: number };
export type MarkerEl = Base & { kind: "marker"; time: number; position: "aboveBar" | "belowBar" | "inBar"; shape: "arrowUp" | "arrowDown" | "circle" | "square" };
export type IndicatorEl = Base & { kind: "indicator"; indicator: string; params: Record<string, number> };
export type Element = LevelEl | ZoneEl | MarkerEl | IndicatorEl;

export type ChartSpec = {
  version: typeof SPEC_VERSION;
  instrument: string;
  timeframe: "1D";
  /** Data window the spec was built for (epoch seconds) and the price range of that window. */
  window: { from: number; to: number; low: number; high: number };
  elements: Element[];
  notes: string[];
};

export type SpecContext = { window: ChartSpec["window"]; indicatorIds: readonly string[] };
export type SpecIssue = { path: string; message: string };

const MAX_ELEMENTS = 80;
const AHEAD_S = 30 * 86400;
const BAD_TEXT = /[<>{}`]|javascript:|=>|function\s*\(|\beval\b|\bimport\s*\(|on\w+\s*=/i;
const KEYS: Record<Element["kind"], string[]> = {
  level: ["id", "kind", "source", "label", "evidence", "role", "price"],
  zone: ["id", "kind", "source", "label", "evidence", "role", "from", "to", "low", "high"],
  marker: ["id", "kind", "source", "label", "evidence", "time", "position", "shape"],
  indicator: ["id", "kind", "source", "label", "evidence", "indicator", "params"],
};

function text(v: unknown, max: number, path: string, issues: SpecIssue[]): string | null {
  if (typeof v !== "string") return (issues.push({ path, message: "must be a string" }), null);
  const s = v.replace(/\s+/g, " ").trim();
  if (s.length > max) return (issues.push({ path, message: `longer than ${max} characters` }), null);
  if (BAD_TEXT.test(s)) return (issues.push({ path, message: "contains markup or code-like text" }), null);
  return s;
}

/**
 * Validates an untrusted spec (engine- or AI-produced). Returns the cleaned spec (only valid elements)
 * plus every issue found; callers decide whether any issue is fatal (the AI path drops the element).
 */
export function validateChartSpec(input: unknown, ctx: SpecContext): { spec: ChartSpec; issues: SpecIssue[] } {
  const issues: SpecIssue[] = [];
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const w = ctx.window;
  const lo = w.low * 0.5, hi = w.high * 1.5;
  const priceOk = (v: unknown, path: string) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return (issues.push({ path, message: "must be a finite number" }), false);
    if (v <= 0 || v < lo || v > hi) return (issues.push({ path, message: `price ${v} outside the plausible range ${lo.toFixed(2)}–${hi.toFixed(2)}` }), false);
    return true;
  };
  const timeOk = (v: unknown, path: string, ahead = 0) => {
    if (typeof v !== "number" || !Number.isInteger(v)) return (issues.push({ path, message: "must be an integer epoch-seconds time" }), false);
    if (v < w.from || v > w.to + ahead) return (issues.push({ path, message: "time outside the chart's data window" }), false);
    return true;
  };
  const elements: Element[] = [];
  const raw = Array.isArray(o.elements) ? o.elements : (issues.push({ path: "elements", message: "must be an array" }), []);
  if (raw.length > MAX_ELEMENTS) issues.push({ path: "elements", message: `more than ${MAX_ELEMENTS} elements; extra elements dropped` });
  const ids = new Set<string>();
  raw.slice(0, MAX_ELEMENTS).forEach((e: unknown, i: number) => {
    const p = `elements[${i}]`;
    if (!e || typeof e !== "object") return issues.push({ path: p, message: "must be an object" });
    const x = e as Record<string, unknown>;
    const kind = x.kind as Element["kind"];
    if (!KEYS[kind]) return issues.push({ path: `${p}.kind`, message: `unknown element kind ${String(x.kind)}` });
    const extra = Object.keys(x).filter((k) => !KEYS[kind].includes(k));
    if (extra.length) return issues.push({ path: p, message: `unknown fields: ${extra.join(", ")}` });
    const n0 = issues.length;
    const id = typeof x.id === "string" && /^[a-z0-9][a-z0-9_.-]{0,40}$/i.test(x.id) && !ids.has(x.id) ? x.id : (issues.push({ path: `${p}.id`, message: "invalid or duplicate id" }), "");
    const source = x.source === "engine" || x.source === "ai" ? x.source : (issues.push({ path: `${p}.source`, message: "must be engine or ai" }), "engine");
    const label = text(x.label, 80, `${p}.label`, issues);
    const evidence = text(x.evidence, 240, `${p}.evidence`, issues);
    let el: Element | null = null;
    if (kind === "level") {
      if (!LEVEL_ROLES.includes(x.role as LevelRole)) issues.push({ path: `${p}.role`, message: "unknown level role" });
      if (priceOk(x.price, `${p}.price`)) el = { id, kind, source, label: label ?? "", evidence: evidence ?? "", role: x.role as LevelRole, price: x.price as number };
    } else if (kind === "zone") {
      if (!ZONE_ROLES.includes(x.role as ZoneRole)) issues.push({ path: `${p}.role`, message: "unknown zone role" });
      const okT = timeOk(x.from, `${p}.from`) && (x.to === null || timeOk(x.to, `${p}.to`, AHEAD_S));
      const okP = priceOk(x.low, `${p}.low`) && priceOk(x.high, `${p}.high`);
      if (okP && (x.low as number) >= (x.high as number)) issues.push({ path: p, message: "low must be below high" });
      if (okT && x.to !== null && (x.to as number) <= (x.from as number)) issues.push({ path: p, message: "to must be after from" });
      el = { id, kind, source, label: label ?? "", evidence: evidence ?? "", role: x.role as ZoneRole, from: x.from as number, to: x.to as number | null, low: x.low as number, high: x.high as number };
    } else if (kind === "marker") {
      if (!["aboveBar", "belowBar", "inBar"].includes(x.position as string)) issues.push({ path: `${p}.position`, message: "invalid position" });
      if (!["arrowUp", "arrowDown", "circle", "square"].includes(x.shape as string)) issues.push({ path: `${p}.shape`, message: "invalid shape" });
      timeOk(x.time, `${p}.time`);
      el = { id, kind, source, label: label ?? "", evidence: evidence ?? "", time: x.time as number, position: x.position as MarkerEl["position"], shape: x.shape as MarkerEl["shape"] };
    } else {
      if (typeof x.indicator !== "string" || !ctx.indicatorIds.includes(x.indicator)) issues.push({ path: `${p}.indicator`, message: "indicator not in the registry" });
      const params = (x.params && typeof x.params === "object" ? x.params : {}) as Record<string, unknown>;
      const clean: Record<string, number> = {};
      for (const [k, v] of Object.entries(params)) {
        if (!/^[a-zA-Z][a-zA-Z0-9]{0,20}$/.test(k) || typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1000) issues.push({ path: `${p}.params.${k}`, message: "parameter must be a finite number within ±1000" });
        else clean[k] = v;
      }
      el = { id, kind, source, label: label ?? "", evidence: evidence ?? "", indicator: x.indicator as string, params: clean };
    }
    if (issues.length === n0 && el) {
      ids.add(id);
      elements.push(el);
    }
  });
  const notes = Array.isArray(o.notes) ? o.notes.slice(0, 10).map((n, i) => text(n, 300, `notes[${i}]`, issues)).filter((n): n is string => n !== null) : [];
  return { spec: { version: SPEC_VERSION, instrument: typeof o.instrument === "string" ? o.instrument.slice(0, 40) : "", timeframe: "1D", window: w, elements, notes }, issues };
}
