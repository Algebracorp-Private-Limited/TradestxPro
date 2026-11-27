/**
 * Market-data capability register: every data kind the Phase 4 engines may ask for, whether the
 * platform has it, from where, how fresh, and under which entitlement. Engines consult it before
 * computing, and the UI shows it, so a missing feed is reported instead of approximated.
 */
import type { Entitlement, Freshness } from "../core/types.ts";

export type DataKind =
  | "equity-quotes" | "index-quotes" | "intraday-ohlcv" | "historical-ohlcv" | "futures-prices" | "option-chain-snapshot"
  | "option-premium-history" | "bid-ask" | "volume" | "open-interest" | "oi-change" | "implied-volatility" | "greeks"
  | "market-breadth" | "corporate-actions" | "financial-statements" | "corporate-announcements" | "earnings-events"
  | "exchange-calendars" | "margin" | "index-constituents" | "historical-iv" | "historical-oi";

export type Capability = {
  kind: DataKind;
  available: "yes" | "with-broker" | "partial" | "no";
  source: string;
  freshness: Freshness | "per-source";
  entitlement: Entitlement;
  notes: string;
};

export const CAPABILITIES: Capability[] = [
  { kind: "historical-ohlcv", available: "yes", source: "NSE equity and index bhavcopies (candles table, ~420 sessions backfill)", freshness: "eod", entitlement: "public-eod", notes: "Daily bars only; not corporate-action adjusted." },
  { kind: "equity-quotes", available: "with-broker", source: "User's connected broker (Dhan, ICICI Breeze, …); otherwise last EOD close", freshness: "per-source", entitlement: "user-broker-session", notes: "Real-time only through the user's own broker session; shown only to that user." },
  { kind: "index-quotes", available: "with-broker", source: "User's broker; otherwise NSE index bhavcopy close", freshness: "per-source", entitlement: "user-broker-session", notes: "" },
  { kind: "intraday-ohlcv", available: "no", source: "—", freshness: "unknown", entitlement: "none", notes: "No intraday bar store for NSE instruments. Intraday setups are not generated." },
  { kind: "futures-prices", available: "partial", source: "NSE F&O bhavcopy (fo_activity, latest session); broker quotes when connected", freshness: "per-source", entitlement: "public-eod", notes: "Per-contract EOD futures prices are not stored; live through broker." },
  { kind: "option-chain-snapshot", available: "partial", source: "Broker option chain (Dhan/ICICI) when connected; NSE F&O bhavcopy latest session otherwise", freshness: "per-source", entitlement: "user-broker-session", notes: "EOD chain has close, OI, OI change and volume; no bid/ask or broker Greeks." },
  { kind: "bid-ask", available: "with-broker", source: "Broker option chain / depth", freshness: "per-source", entitlement: "user-broker-session", notes: "Not available from EOD files." },
  { kind: "volume", available: "yes", source: "Bhavcopies; broker", freshness: "per-source", entitlement: "public-eod", notes: "" },
  { kind: "open-interest", available: "yes", source: "NSE F&O bhavcopy; broker", freshness: "per-source", entitlement: "public-eod", notes: "" },
  { kind: "oi-change", available: "yes", source: "NSE F&O bhavcopy; broker", freshness: "per-source", entitlement: "public-eod", notes: "" },
  { kind: "implied-volatility", available: "partial", source: "Broker IV, or computed by TradestXPro (Black-Scholes) from premiums", freshness: "per-source", entitlement: "user-broker-session", notes: "Computed IV is labelled as model output." },
  { kind: "greeks", available: "partial", source: "Broker Greeks, or computed (Black-Scholes) from IV", freshness: "per-source", entitlement: "user-broker-session", notes: "Computed Greeks are labelled as model output." },
  { kind: "option-premium-history", available: "no", source: "—", freshness: "unknown", entitlement: "none", notes: "Only the latest F&O session is stored; premium charts cannot show observed history yet." },
  { kind: "historical-iv", available: "no", source: "—", freshness: "unknown", entitlement: "none", notes: "IV rank/percentile cannot be computed without IV history." },
  { kind: "historical-oi", available: "partial", source: "fo_activity (per underlying, daily)", freshness: "eod", entitlement: "public-eod", notes: "Per-underlying totals only; no per-contract OI history." },
  { kind: "market-breadth", available: "yes", source: "screener_snapshot (latest EOD) and index constituents", freshness: "eod", entitlement: "public-eod", notes: "" },
  { kind: "index-constituents", available: "yes", source: "NSE published constituent files", freshness: "eod", entitlement: "public-eod", notes: "Current membership only (not point-in-time)." },
  { kind: "exchange-calendars", available: "partial", source: "XChart calendars (sessions, time zones); holiday datasets must be loaded", freshness: "per-source", entitlement: "none", notes: "No holiday dataset is bundled." },
  { kind: "corporate-actions", available: "no", source: "—", freshness: "unknown", entitlement: "none", notes: "Prices are not adjusted for splits/bonuses." },
  { kind: "financial-statements", available: "no", source: "—", freshness: "unknown", entitlement: "none", notes: "Investment AI returns INSUFFICIENT DATA until a licensed fundamentals dataset is imported." },
  { kind: "corporate-announcements", available: "no", source: "—", freshness: "unknown", entitlement: "none", notes: "" },
  { kind: "earnings-events", available: "no", source: "—", freshness: "unknown", entitlement: "none", notes: "Event risk cannot be checked automatically." },
  { kind: "margin", available: "no", source: "—", freshness: "unknown", entitlement: "none", notes: "No SPAN/exposure margin source: margin-dependent plans are marked not execution-validated." },
];

export const capability = (k: DataKind) => CAPABILITIES.find((c) => c.kind === k)!;
export const missingKinds = (kinds: DataKind[]) => kinds.filter((k) => capability(k).available === "no");
