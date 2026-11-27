/**
 * Data freshness rules. A record is classified from its exchange timestamp, the kind of source and
 * the NSE session calendar, never from the source's own claim alone.
 *
 * - real-time: a streaming/broker quote stamped within REALTIME_MAX_AGE_S of now, while NSE is open.
 * - delayed:   a quote older than that (or a source declared delayed) from the current session.
 * - eod:       an end-of-day record for the most recent completed session.
 * - stale:     anything older (an EOD record older than the last completed session, a quote from an
 *              earlier session, a snapshot past its maximum age).
 *
 * Holidays: the calendar knows weekends and session hours; exchange holidays come from calendar
 * datasets (none are bundled). Without one, "last completed session" assumes weekdays are sessions
 * and the classification carries a note that holidays are unverified.
 */
import { TradingCalendar } from "../../xchart-sdk/calendar/index.ts";
import type { Entitlement, Freshness, Provenance } from "./types.ts";

export const REALTIME_MAX_AGE_S = 120;
const NSE = new TradingCalendar("NSE");
const DAY = 86_400;

export type SourceKind = "stream" | "broker-quote" | "delayed-feed" | "eod-file" | "snapshot" | "synthetic";

/** Most recent NSE trading date whose regular session has closed at or before `now` (YYYY-MM-DD). */
export function lastCompletedSession(now: Date, cal: TradingCalendar = NSE): string {
  const t = Math.floor(now.getTime() / 1000);
  for (let k = 0; k < 15; k++) {
    const date = cal.localDate(t - k * DAY);
    if (!cal.isTradingDay(date)) continue;
    const b = cal.regularBounds(date);
    if (b && b.close <= t) return date;
  }
  return cal.localDate(t - DAY);
}

export function isMarketOpen(now: Date, cal: TradingCalendar = NSE): boolean {
  return cal.isOpen(Math.floor(now.getTime() / 1000), false);
}

export type FreshnessInput = {
  kind: SourceKind;
  /** Exchange timestamp (ISO-8601 or epoch seconds); for EOD files, the trading date (YYYY-MM-DD). */
  exchangeTime: string | number | null;
  now?: Date;
  /** Snapshots: maximum age in seconds before the data counts as stale. */
  maxAgeSeconds?: number;
};

export function classifyFreshness(i: FreshnessInput): { freshness: Freshness; ageSeconds: number | null; notes: string[] } {
  const now = i.now ?? new Date();
  const notes: string[] = [];
  if (i.kind === "synthetic") return { freshness: "unknown", ageSeconds: null, notes: ["synthetic test data, not market data"] };
  if (i.exchangeTime === null || i.exchangeTime === undefined || i.exchangeTime === "") return { freshness: "unknown", ageSeconds: null, notes: ["exchange timestamp missing"] };

  if (i.kind === "eod-file") {
    const d = String(i.exchangeTime).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { freshness: "unknown", ageSeconds: null, notes: ["invalid trading date"] };
    const last = lastCompletedSession(now);
    notes.push("NSE holidays unverified unless a calendar dataset is loaded");
    const close = NSE.regularBounds(d)?.close ?? Date.parse(`${d}T10:00:00Z`) / 1000;
    const ageSeconds = Math.max(0, Math.round(now.getTime() / 1000 - close));
    if (d === last) return { freshness: "eod", ageSeconds, notes };
    if (d > last) return { freshness: "unknown", ageSeconds, notes: [...notes, "trading date is in the future"] };
    return { freshness: "stale", ageSeconds, notes: [...notes, `latest completed session is ${last}`] };
  }

  const ts = typeof i.exchangeTime === "number" ? i.exchangeTime * (i.exchangeTime < 1e12 ? 1000 : 1) : Date.parse(i.exchangeTime);
  if (!Number.isFinite(ts)) return { freshness: "unknown", ageSeconds: null, notes: ["invalid exchange timestamp"] };
  const ageSeconds = Math.round((now.getTime() - ts) / 1000);
  if (ageSeconds < -5) return { freshness: "unknown", ageSeconds, notes: ["timestamp is in the future (clock skew?)"] };
  if (i.kind === "snapshot") {
    const max = i.maxAgeSeconds ?? DAY;
    return { freshness: ageSeconds <= max ? "delayed" : "stale", ageSeconds, notes };
  }
  const sameSession = NSE.localDate(Math.floor(ts / 1000)) === NSE.localDate(Math.floor(now.getTime() / 1000));
  const open = isMarketOpen(now);
  if ((i.kind === "stream" || i.kind === "broker-quote") && open && ageSeconds <= REALTIME_MAX_AGE_S) return { freshness: "real-time", ageSeconds, notes };
  if (sameSession && (open || i.kind === "delayed-feed")) return { freshness: "delayed", ageSeconds, notes: open ? notes : [...notes, "market closed"] };
  if (!open && sameSession) return { freshness: "delayed", ageSeconds, notes: [...notes, "market closed: last price of today's session"] };
  return { freshness: "stale", ageSeconds, notes: [...notes, "from an earlier session"] };
}

export function provenance(p: { source: string; kind: SourceKind; exchangeTime: string | number | null; entitlement: Entitlement; missing?: string[]; now?: Date; maxAgeSeconds?: number; invalid?: boolean }): Provenance {
  const now = p.now ?? new Date();
  const f = classifyFreshness({ kind: p.kind, exchangeTime: p.exchangeTime, now, maxAgeSeconds: p.maxAgeSeconds });
  const missing = p.missing ?? [];
  const exch = p.exchangeTime === null ? null : typeof p.exchangeTime === "number" ? new Date(p.exchangeTime * (p.exchangeTime < 1e12 ? 1000 : 1)).toISOString() : String(p.exchangeTime);
  return {
    source: p.source, exchangeTime: exch, receivedAt: now.toISOString(), ageSeconds: f.ageSeconds, freshness: f.freshness, entitlement: p.entitlement,
    missing, validation: p.invalid ? "invalid" : missing.length ? "partial" : "valid", ...(f.notes.length ? { notes: f.notes } : {}),
  };
}

/** Intraday trade setups need prices from the live session: real-time only. */
export function usableForIntraday(p: Provenance): { ok: boolean; reason?: string } {
  if (p.validation === "invalid") return { ok: false, reason: "data failed validation" };
  if (p.freshness !== "real-time") return { ok: false, reason: `intraday setups need real-time data; this is ${p.freshness}` };
  return { ok: true };
}

/** Swing/positional/investment analysis: the latest completed session (EOD) or fresher. */
export function usableForEndOfDay(p: Provenance): { ok: boolean; reason?: string } {
  if (p.validation === "invalid") return { ok: false, reason: "data failed validation" };
  if (p.freshness === "stale" || p.freshness === "unknown") return { ok: false, reason: `data is ${p.freshness}` };
  return { ok: true };
}

/** Label shown next to every price in the UI. */
export function freshnessLabel(p: Pick<Provenance, "freshness" | "exchangeTime" | "source">): string {
  const when = p.exchangeTime ? p.exchangeTime.slice(0, 16).replace("T", " ") : "time unknown";
  const what = { "real-time": "Real-time", delayed: "Delayed", eod: "End of day", stale: "Stale", unknown: "Unverified" }[p.freshness];
  return `${what} · ${p.source} · ${when}`;
}
