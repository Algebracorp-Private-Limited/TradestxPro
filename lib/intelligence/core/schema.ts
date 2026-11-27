/**
 * Minimal JSON-schema validator for AI outputs and chart specifications (the subset we emit:
 * type, properties, required, additionalProperties: false, items, enum, const, minimum/maximum,
 * minLength/maxLength, minItems/maxItems, anyOf, nullable via type arrays).
 *
 * Also produces the "wire" form sent to providers whose structured-output mode does not support
 * numeric/length constraints: those constraints are stripped there and enforced here.
 */
export type JsonSchema = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null" | ("object" | "array" | "string" | "number" | "integer" | "boolean" | "null")[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: JsonSchema;
  enum?: (string | number | boolean | null)[];
  const?: string | number | boolean | null;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  anyOf?: JsonSchema[];
  description?: string;
};

const typeOf = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);

/** Returns a list of problems ("path: message"); empty when valid. Stops after 50 problems. */
export function validate(schema: JsonSchema, value: unknown, path = "$", out: string[] = []): string[] {
  if (out.length >= 50) return out;
  if (schema.anyOf) {
    if (!schema.anyOf.some((s) => validate(s, value, path, []).length === 0)) out.push(`${path}: matches none of the allowed shapes`);
    return out;
  }
  if (schema.type) {
    const t = typeOf(value);
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = allowed.some((a) => a === t || (a === "number" && (t === "integer" || t === "number")));
    if (!ok) {
      out.push(`${path}: expected ${allowed.join(" | ")}, got ${t}`);
      return out;
    }
  }
  if (typeof value === "number" && !Number.isFinite(value)) out.push(`${path}: must be finite`);
  if (schema.const !== undefined && value !== schema.const) out.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value as never)) out.push(`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) out.push(`${path}: must be ≥ ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) out.push(`${path}: must be ≤ ${schema.maximum}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) out.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) out.push(`${path}: longer than ${schema.maxLength}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) out.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) out.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => validate(schema.items!, v, `${path}[${i}]`, out));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") out.push(`${path}.${k}: key not allowed`);
    }
    for (const r of schema.required ?? []) if (!(r in obj)) out.push(`${path}.${r}: required`);
    for (const [k, v] of Object.entries(obj)) {
      const s = schema.properties?.[k];
      if (s) validate(s, v, `${path}.${k}`, out);
      else if (schema.additionalProperties === false) out.push(`${path}.${k}: unexpected property`);
    }
  }
  return out;
}

/** Schema for providers' structured-output modes: numeric/length/array-size constraints removed (enforced by `validate`). */
export function wireSchema(schema: JsonSchema): JsonSchema {
  const { minimum: _a, maximum: _b, minLength: _c, maxLength: _d, minItems: _e, maxItems: _f, ...rest } = schema;
  void [_a, _b, _c, _d, _e, _f];
  const out: JsonSchema = { ...rest };
  if (schema.properties) out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, wireSchema(v)]));
  if (schema.items) out.items = wireSchema(schema.items);
  if (schema.anyOf) out.anyOf = schema.anyOf.map(wireSchema);
  if (out.type === "object" || (Array.isArray(out.type) && out.type.includes("object"))) out.additionalProperties = false;
  return out;
}

/** Parses the first top-level JSON object in a model response (tolerates surrounding prose/fences). */
export function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    // fall through
  }
  const start = t.indexOf("{");
  if (start < 0) throw new Error("no JSON object in response");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error("unterminated JSON object in response");
}
