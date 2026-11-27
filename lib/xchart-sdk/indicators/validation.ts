import { XChartError } from "../validation.ts";
import { INDICATOR_SOURCES, type IndicatorDefinition, type IndicatorOptions, type IndicatorParams, type ParamSchema } from "./types.ts";
import { isCssColor } from "../validation.ts";

const ID = /^[a-z][a-z0-9_-]{0,63}$/;

/** Checks a definition before it is registered (trusted developer code, but must be well-formed). */
export function validateDefinition(d: IndicatorDefinition): void {
  if (!d || typeof d !== "object") throw new XChartError("INVALID_INDICATOR", "Indicator definition must be an object");
  if (!ID.test(d.id ?? "")) throw new XChartError("INVALID_INDICATOR", `Indicator id "${d.id}" must match ${ID}`);
  if (!d.name || typeof d.name !== "string") throw new XChartError("INVALID_INDICATOR", `Indicator "${d.id}" needs a name`);
  if (typeof d.description !== "string") throw new XChartError("INVALID_INDICATOR", `Indicator "${d.id}" needs a description`);
  if (d.pane !== "overlay" && d.pane !== "separate") throw new XChartError("INVALID_INDICATOR", `Indicator "${d.id}": pane must be "overlay" or "separate"`);
  if (typeof d.calculate !== "function") throw new XChartError("INVALID_INDICATOR", `Indicator "${d.id}" needs a calculate() function`);
  if (typeof d.warmup !== "function") throw new XChartError("INVALID_INDICATOR", `Indicator "${d.id}" needs a warmup() function`);
  if (d.update !== undefined && typeof d.update !== "function") throw new XChartError("INVALID_INDICATOR", `Indicator "${d.id}": update must be a function`);
  if (!Array.isArray(d.inputs) || !d.inputs.length) throw new XChartError("INVALID_INDICATOR", `Indicator "${d.id}" must list its inputs`);
  for (const i of d.inputs) {
    if (!["open", "high", "low", "close", "volume"].includes(i)) throw new XChartError("INVALID_INDICATOR", `Indicator "${d.id}": unknown input "${i}"`);
  }
  if (!Array.isArray(d.outputs) || !d.outputs.length) throw new XChartError("INVALID_INDICATOR", `Indicator "${d.id}" must define outputs`);
  const keys = new Set<string>();
  for (const o of d.outputs) {
    if (!o.key || keys.has(o.key)) throw new XChartError("INVALID_INDICATOR", `Indicator "${d.id}": output keys must be unique and non-empty`);
    keys.add(o.key);
    if (!["line", "histogram", "area", "dots"].includes(o.type)) throw new XChartError("INVALID_INDICATOR", `Indicator "${d.id}": output "${o.key}" has unknown type "${o.type}"`);
    if (!isCssColor(o.color)) throw new XChartError("INVALID_INDICATOR", `Indicator "${d.id}": output "${o.key}" colour is not a CSS colour`);
  }
  const pk = new Set<string>();
  for (const p of d.params ?? []) {
    if (!p.key || pk.has(p.key)) throw new XChartError("INVALID_INDICATOR", `Indicator "${d.id}": parameter keys must be unique`);
    pk.add(p.key);
    checkParam(d.id, p, p.default);
  }
}

function checkParam(id: string, p: ParamSchema, v: unknown): void {
  const bad = (why: string) => {
    throw new XChartError("INVALID_PARAMETER", `Indicator "${id}": parameter "${p.key}" ${why} (got ${JSON.stringify(v)})`);
  };
  switch (p.type) {
    case "number":
    case "integer":
      if (typeof v !== "number" || !Number.isFinite(v)) bad("must be a finite number");
      if (p.type === "integer" && !Number.isInteger(v)) bad("must be an integer");
      if (p.min !== undefined && (v as number) < p.min) bad(`must be ≥ ${p.min}`);
      if (p.max !== undefined && (v as number) > p.max) bad(`must be ≤ ${p.max}`);
      break;
    case "boolean":
      if (typeof v !== "boolean") bad("must be true or false");
      break;
    case "select":
      if (!p.options?.includes(v as string)) bad(`must be one of ${p.options?.join(", ")}`);
      break;
    case "source":
      if (!INDICATOR_SOURCES.includes(v as never)) bad(`must be one of ${INDICATOR_SOURCES.join(", ")}`);
      break;
  }
}

/** Resolves aliases, fills defaults and validates values. Unknown keys are rejected. */
export function resolveParams(d: IndicatorDefinition, given: Record<string, unknown> | undefined, base?: IndicatorParams): IndicatorParams {
  const out: IndicatorParams = { ...(base ?? Object.fromEntries(d.params.map((p) => [p.key, p.default]))) };
  for (const [k, v] of Object.entries(given ?? {})) {
    if (v === undefined) continue;
    const p = d.params.find((x) => x.key === k || x.aliases?.includes(k));
    if (!p) throw new XChartError("INVALID_PARAMETER", `Indicator "${d.id}" has no parameter "${k}" (available: ${d.params.map((x) => x.key).join(", ") || "none"})`);
    checkParam(d.id, p, v);
    out[p.key] = v as number | boolean | string;
  }
  return out;
}

export function validateIndicatorOptions(o: Partial<IndicatorOptions>, outputKeys: string[]): void {
  if (!o || typeof o !== "object") throw new XChartError("INVALID_OPTION", "Indicator options must be an object");
  if (o.color !== undefined && !isCssColor(o.color)) throw new XChartError("INVALID_COLOR", `color must be a CSS colour (got ${JSON.stringify(o.color)})`);
  for (const [k, c] of Object.entries(o.colors ?? {})) {
    if (!outputKeys.includes(k)) throw new XChartError("INVALID_OPTION", `colors: unknown output "${k}" (outputs: ${outputKeys.join(", ")})`);
    if (!isCssColor(c)) throw new XChartError("INVALID_COLOR", `colors.${k} must be a CSS colour`);
  }
  if (o.lineWidth !== undefined && !(typeof o.lineWidth === "number" && o.lineWidth > 0 && o.lineWidth <= 20)) throw new XChartError("INVALID_OPTION", "lineWidth must be between 0 and 20");
  if (o.lineStyle !== undefined && !["solid", "dashed", "dotted"].includes(o.lineStyle)) throw new XChartError("INVALID_OPTION", 'lineStyle must be "solid", "dashed" or "dotted"');
  if (o.pane !== undefined && (typeof o.pane !== "string" || !o.pane)) throw new XChartError("INVALID_OPTION", "pane must be a non-empty string");
  if (o.visible !== undefined && typeof o.visible !== "boolean") throw new XChartError("INVALID_OPTION", "visible must be a boolean");
  if (o.hiddenOutputs !== undefined && (!Array.isArray(o.hiddenOutputs) || o.hiddenOutputs.some((k) => !outputKeys.includes(k)))) {
    throw new XChartError("INVALID_OPTION", `hiddenOutputs must list output keys (${outputKeys.join(", ")})`);
  }
  for (const f of Object.values(o.fills ?? {})) {
    if (f.opacity !== undefined && !(f.opacity >= 0 && f.opacity <= 1)) throw new XChartError("INVALID_OPTION", "fill opacity must be between 0 and 1");
    for (const c of [f.up, f.down]) if (c !== undefined && !isCssColor(c)) throw new XChartError("INVALID_COLOR", "fill colours must be CSS colours");
  }
}
