/**
 * Message protocol between the main thread and the indicator worker. Only DATA crosses the
 * boundary: built-in indicator ids with parameters, derived-chart settings and numeric columns.
 * No code is sent or evaluated. Every incoming message is validated.
 */
import type { DerivedKind } from "../derived/types.ts";

export const PROTOCOL_VERSION = 1;
export type Columns = { time: Float64Array; open: Float64Array; high: Float64Array; low: Float64Array; close: Float64Array; volume: Float64Array };
export type IndicatorJob = { id: string; params: Record<string, unknown> };

export type Request =
  | { v: 1; type: "indicators"; jobId: number; datasetVersion: number; intraday: boolean; columns: Columns; indicators: IndicatorJob[] }
  | { v: 1; type: "derived"; jobId: number; datasetVersion: number; kind: DerivedKind; settings: Record<string, unknown>; columns: Columns }
  | { v: 1; type: "cancel"; jobId: number };

export type Response =
  | { v: 1; type: "indicators"; jobId: number; datasetVersion: number; results: ({ outputs: Record<string, Float64Array>; error?: undefined } | { outputs?: undefined; error: string })[]; ms: number }
  | { v: 1; type: "derived"; jobId: number; datasetVersion: number; points: unknown[]; ms: number }
  | { v: 1; type: "error"; jobId: number; error: string }
  | { v: 1; type: "cancelled"; jobId: number };

const COLS = ["time", "open", "high", "low", "close", "volume"] as const;
export const MAX_ROWS = 2_000_000;
export const MAX_INDICATORS = 200;

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const okId = (x: unknown) => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;

function checkColumns(c: unknown): asserts c is Columns {
  if (!isObj(c)) throw new Error("columns must be an object");
  let n = -1;
  for (const k of COLS) {
    const a = c[k];
    if (!(a instanceof Float64Array)) throw new Error(`columns.${k} must be a Float64Array`);
    if (n < 0) n = a.length;
    if (a.length !== n) throw new Error("columns must have equal lengths");
  }
  if (n > MAX_ROWS) throw new Error(`too many rows (max ${MAX_ROWS})`);
}

function plainParams(p: unknown): asserts p is Record<string, unknown> {
  if (!isObj(p)) throw new Error("params must be an object");
  for (const [k, v] of Object.entries(p)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") throw new Error(`param "${k}" is not allowed`);
    if (!["number", "string", "boolean"].includes(typeof v)) throw new Error(`param "${k}" must be a number, string or boolean`);
  }
}

/** Validates a request received by the worker (throws on anything unexpected). */
export function validateRequest(m: unknown): Request {
  if (!isObj(m) || m.v !== PROTOCOL_VERSION || typeof m.type !== "string" || !okId(m.jobId)) throw new Error("malformed message");
  if (m.type === "cancel") return m as Request;
  if (!okId(m.datasetVersion)) throw new Error("datasetVersion must be a non-negative integer");
  checkColumns(m.columns);
  if (m.type === "indicators") {
    if (typeof m.intraday !== "boolean") throw new Error("intraday must be a boolean");
    if (!Array.isArray(m.indicators) || m.indicators.length > MAX_INDICATORS) throw new Error(`indicators must be an array of at most ${MAX_INDICATORS}`);
    for (const j of m.indicators) {
      if (!isObj(j) || typeof j.id !== "string" || j.id.length > 64) throw new Error("indicator jobs need an id");
      plainParams(j.params);
    }
    return m as Request;
  }
  if (m.type === "derived") {
    if (typeof m.kind !== "string") throw new Error("kind must be a string");
    plainParams(m.settings);
    return m as Request;
  }
  throw new Error(`unknown message type "${String(m.type)}"`);
}

/** Validates a response received by the main thread. */
export function validateResponse(m: unknown): Response {
  if (!isObj(m) || m.v !== PROTOCOL_VERSION || typeof m.type !== "string" || !okId(m.jobId)) throw new Error("malformed worker response");
  if (m.type === "indicators") {
    if (!okId(m.datasetVersion) || !Array.isArray(m.results)) throw new Error("malformed indicator result");
    for (const r of m.results) {
      if (!isObj(r)) throw new Error("malformed indicator result");
      if (r.outputs !== undefined) {
        if (!isObj(r.outputs)) throw new Error("malformed outputs");
        for (const a of Object.values(r.outputs)) if (!(a instanceof Float64Array)) throw new Error("outputs must be Float64Array");
      } else if (typeof r.error !== "string") throw new Error("malformed indicator error");
    }
  } else if (m.type === "derived") {
    if (!okId(m.datasetVersion) || !Array.isArray(m.points)) throw new Error("malformed derived result");
  } else if (m.type !== "error" && m.type !== "cancelled") throw new Error(`unknown response type "${String(m.type)}"`);
  return m as Response;
}

/** Copies columns into NEW buffers (the copies can be transferred; the caller's arrays stay usable). */
export function toColumns(src: { time: ArrayLike<number>; open: ArrayLike<number>; high: ArrayLike<number>; low: ArrayLike<number>; close: ArrayLike<number>; volume: ArrayLike<number> }): Columns {
  return { time: Float64Array.from(src.time), open: Float64Array.from(src.open), high: Float64Array.from(src.high), low: Float64Array.from(src.low), close: Float64Array.from(src.close), volume: Float64Array.from(src.volume) };
}
export const transferList = (c: Columns): ArrayBuffer[] => COLS.map((k) => c[k].buffer as ArrayBuffer);
