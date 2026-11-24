/**
 * Market-data intake: TradestXPro's existing `/api/charts/bars` (or any { t, o, h, l, c, v } source)
 * → SDK candles, with explicit data-integrity checks.
 *
 * Integrity rules (v0.2.1):
 * - Source values are never modified: no clamping of high/low, no rounding or truncating of time,
 *   no fabricated candles, no volume rewriting (0 stays 0, absent stays absent).
 * - Every rejected record is reported with its index and reason; nothing is dropped silently.
 * - "strict" (default) throws XChartError("INVALID_MARKET_DATA") if any record is rejected.
 *   "tolerant" (opt-in) returns the valid records and quarantines the rest in the report.
 */
import type { CandlestickData } from "./types.ts";
import { XChartError } from "./validation.ts";

export type TradestxproBar = { t: number; o: number; h: number; l: number; c: number; v?: number | null };

export type ValidationMode = "strict" | "tolerant";

export type RejectionReason =
  | "MALFORMED_RECORD"
  | "INVALID_TIMESTAMP"
  | "MILLISECOND_TIMESTAMP"
  | "FRACTIONAL_TIMESTAMP"
  | "INVALID_PRICE"
  | "INVALID_OHLC"
  | "INVALID_VOLUME"
  | "DUPLICATE_TIMESTAMP"
  | "OUT_OF_ORDER";

export type Rejection = {
  /** Position of the record in the input array. */
  index: number;
  /** The record's timestamp when it is a number, else null. */
  time: number | null;
  reason: RejectionReason;
  message: string;
  /** The original record, unmodified. */
  record: unknown;
};

export type ValidationReport = {
  source: string;
  mode: ValidationMode;
  /** ISO-8601 time the validation ran. */
  validatedAt: string;
  totalRecords: number;
  validRecords: number;
  rejectedRecords: number;
  duplicateTimestamps: number;
  outOfOrderRecords: number;
  invalidOhlcRecords: number;
  invalidVolumeRecords: number;
  invalidTimestampRecords: number;
  malformedRecords: number;
  rejections: Rejection[];
};

export type MarketDataOptions = {
  /** Default "strict". */
  mode?: ValidationMode;
  /** Free-text origin recorded in the report (symbol, endpoint, file name...). */
  source?: string;
};

/** Error thrown in strict mode; carries the full report. */
export class MarketDataError extends XChartError {
  readonly report: ValidationReport;
  constructor(report: ValidationReport) {
    const first = report.rejections[0];
    super(
      "INVALID_MARKET_DATA",
      `${report.rejectedRecords} of ${report.totalRecords} records from ${report.source} are invalid` +
        (first ? ` (first: item ${first.index}, ${first.reason}: ${first.message})` : ""),
    );
    this.name = "MarketDataError";
    this.report = report;
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Checks one record on its own (no ordering); returns the problem or null. */
function checkRecord(r: unknown): { reason: RejectionReason; message: string } | null {
  if (!r || typeof r !== "object") return { reason: "MALFORMED_RECORD", message: "record is not an object" };
  const b = r as Record<string, unknown>;
  if (!isNum(b.t)) return { reason: "INVALID_TIMESTAMP", message: `timestamp is not a finite number (${String(b.t)})` };
  if (b.t < 0) return { reason: "INVALID_TIMESTAMP", message: `timestamp is negative (${b.t})` };
  if (b.t > 1e11) return { reason: "MILLISECOND_TIMESTAMP", message: `timestamp ${b.t} looks like milliseconds; expected Unix seconds` };
  if (!Number.isInteger(b.t)) return { reason: "FRACTIONAL_TIMESTAMP", message: `timestamp ${b.t} has a fractional part; expected whole seconds` };
  for (const k of ["o", "h", "l", "c"] as const) {
    if (!isNum(b[k])) return { reason: "INVALID_PRICE", message: `${k} is not a finite number (${String(b[k])})` };
  }
  const o = b.o as number, h = b.h as number, l = b.l as number, c = b.c as number;
  if (h < Math.max(o, c, l) || l > Math.min(o, c, h)) {
    return { reason: "INVALID_OHLC", message: `inconsistent OHLC (o=${o}, h=${h}, l=${l}, c=${c}): high must be ≥ open/close/low and low ≤ open/close/high` };
  }
  if (b.v !== undefined && b.v !== null && (!isNum(b.v) || b.v < 0)) {
    return { reason: "INVALID_VOLUME", message: `volume must be a nonnegative finite number (${String(b.v)})` };
  }
  return null;
}

/**
 * Validates source bars and converts them to SDK candles without altering any value.
 * Strict mode throws MarketDataError on the first dataset with any invalid record.
 */
export function validateTradestxproBars(bars: ReadonlyArray<unknown>, options: MarketDataOptions = {}): { candles: CandlestickData[]; report: ValidationReport } {
  const mode = options.mode ?? "strict";
  if (mode !== "strict" && mode !== "tolerant") throw new XChartError("INVALID_OPTION", 'mode must be "strict" or "tolerant"');
  if (!Array.isArray(bars)) throw new XChartError("INVALID_DATA", "market data must be an array of bars");
  const report: ValidationReport = {
    source: options.source ?? "unspecified",
    mode,
    validatedAt: new Date().toISOString(),
    totalRecords: bars.length,
    validRecords: 0,
    rejectedRecords: 0,
    duplicateTimestamps: 0,
    outOfOrderRecords: 0,
    invalidOhlcRecords: 0,
    invalidVolumeRecords: 0,
    invalidTimestampRecords: 0,
    malformedRecords: 0,
    rejections: [],
  };
  const candles: CandlestickData[] = [];
  const reject = (index: number, record: unknown, reason: RejectionReason, message: string) => {
    const t = record && typeof record === "object" ? (record as Record<string, unknown>).t : undefined;
    report.rejections.push({ index, time: isNum(t) ? t : null, reason, message, record });
    report.rejectedRecords++;
    if (reason === "DUPLICATE_TIMESTAMP") report.duplicateTimestamps++;
    else if (reason === "OUT_OF_ORDER") report.outOfOrderRecords++;
    else if (reason === "INVALID_OHLC" || reason === "INVALID_PRICE") report.invalidOhlcRecords++;
    else if (reason === "INVALID_VOLUME") report.invalidVolumeRecords++;
    else if (reason === "MALFORMED_RECORD") report.malformedRecords++;
    else report.invalidTimestampRecords++;
  };
  let lastTime = -Infinity;
  for (let i = 0; i < bars.length; i++) {
    const r = bars[i];
    const problem = checkRecord(r);
    if (problem) {
      reject(i, r, problem.reason, problem.message);
      continue;
    }
    const b = r as TradestxproBar;
    // Ordering is checked against the last ACCEPTED record, so one bad row cannot hide others.
    if (b.t === lastTime) {
      reject(i, r, "DUPLICATE_TIMESTAMP", `timestamp ${b.t} repeats the previous accepted record`);
      continue;
    }
    if (b.t < lastTime) {
      reject(i, r, "OUT_OF_ORDER", `timestamp ${b.t} is earlier than the previous accepted record (${lastTime})`);
      continue;
    }
    lastTime = b.t;
    const c: CandlestickData = { time: b.t, open: b.o, high: b.h, low: b.l, close: b.c };
    if (b.v !== undefined && b.v !== null) c.volume = b.v; // 0 is preserved
    candles.push(c);
  }
  report.validRecords = candles.length;
  if (mode === "strict" && report.rejectedRecords > 0) throw new MarketDataError(report);
  return { candles, report };
}

/**
 * Converts TradestXPro bars to SDK candles. Strict by default: throws MarketDataError (with a
 * report) if any record is invalid. v0.2 silently repaired or dropped bad records; it no longer does.
 */
export function fromTradestxproBars(bars: ReadonlyArray<TradestxproBar>, options: MarketDataOptions = {}): CandlestickData[] {
  return validateTradestxproBars(bars, options).candles;
}

/** Loads candles for a TradestXPro symbol (e.g. "NSE:RELIANCE", tf "1D"). Requires a signed-in session. */
export async function loadTradestxproCandles(
  symbol: string,
  tf = "1D",
  opts: (MarketDataOptions & { baseUrl?: string }) | string = {},
): Promise<{ candles: CandlestickData[]; report: ValidationReport; source: string; name: string }> {
  // v0.2 accepted a baseUrl string as the third argument; still supported.
  const options = typeof opts === "string" ? { baseUrl: opts } : opts;
  const base = options.baseUrl ?? "";
  const res = await fetch(`${base}/api/charts/bars?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}`, { credentials: "same-origin" });
  const body = (await res.json().catch(() => ({}))) as { bars?: unknown[]; source?: string; name?: string; error?: string };
  if (!res.ok || !Array.isArray(body.bars)) {
    throw new XChartError("DATA_UNAVAILABLE", `Could not load ${symbol} (${tf}): ${body.error ?? `HTTP ${res.status}`}`);
  }
  const source = `${symbol} ${tf} · ${body.source || "TradestXPro /api/charts/bars"}`;
  const { candles, report } = validateTradestxproBars(body.bars, { mode: options.mode, source: options.source ?? source });
  return { candles, report, source: body.source ?? "", name: body.name ?? symbol };
}
