/**
 * Core types of TradestXPro AI Intelligence. Every number an engine uses carries its provenance,
 * and every engine can answer "insufficient data" instead of guessing.
 */

/** How current a piece of market data is. EOD and delayed data must never be presented as live. */
export type Freshness = "real-time" | "delayed" | "eod" | "stale" | "unknown";

/** Who may see it: the user's own broker session, a public EOD file, a licensed feed, or synthetic test data. */
export type Entitlement = "user-broker-session" | "public-eod" | "licensed-feed" | "synthetic" | "none";

export type ValidationStatus = "valid" | "partial" | "invalid";

/** Provenance attached to every market-data record. */
export type Provenance = {
  /** Provider id, e.g. "nse-bhavcopy", "broker:dhan", "synthetic". */
  source: string;
  /** Time the exchange stamped the data (ISO-8601), or null when unknown. */
  exchangeTime: string | null;
  /** Time TradestXPro received it (ISO-8601). */
  receivedAt: string;
  /** Seconds between exchangeTime and the evaluation time (null when exchangeTime is unknown). */
  ageSeconds: number | null;
  freshness: Freshness;
  entitlement: Entitlement;
  /** Fields that were requested but not provided by the source. */
  missing: string[];
  validation: ValidationStatus;
  /** Human-readable notes (e.g. "holidays unverified"). */
  notes?: string[];
};

export type Sourced<T> = { value: T; provenance: Provenance };

/** Analysis statuses shared by the engines (equity, options, futures, strategies). */
export type SetupStatus =
  | "ENTER IF CONFIRMED"
  | "WAIT FOR CONFIRMATION"
  | "WATCHLIST"
  | "AVOID"
  | "NO TRADE"
  | "INVALIDATED"
  | "INSUFFICIENT DATA";

/** Returned instead of a result when required inputs are missing or unusable. */
export type InsufficientData = { status: "INSUFFICIENT DATA"; missing: string[]; reasons: string[] };

export const insufficient = (missing: string[], ...reasons: string[]): InsufficientData => ({ status: "INSUFFICIENT DATA", missing, reasons });
export const isInsufficient = (x: unknown): x is InsufficientData => !!x && typeof x === "object" && (x as { status?: unknown }).status === "INSUFFICIENT DATA";

/** One piece of evidence behind a conclusion: a verified number and what it means. */
export type Evidence = { id: string; label: string; value: number | string | boolean | null; detail: string; weight?: number };

/** Versions recorded with every stored analysis so it can be reproduced and never silently rewritten. */
export type AnalysisVersions = { engine: string; engineVersion: string; dataVersion: string; promptId?: string; promptVersion?: string; model?: string };
