/**
 * Trading calendars: exchange sessions in the exchange's own IANA time zone (daylight saving via
 * Intl), weekends, and holidays/early closes from a caller-supplied provider.
 *
 * No holiday lists are bundled: exchange holidays change every year and a stale list would be
 * wrong data. Supply them (e.g. from the exchange's published circular) with a HolidayProvider.
 * Pure TypeScript, no DOM.
 */
import { XChartError, isTimeZone } from "../validation.ts";
import { CalendarRegistry, type CalendarProvider, type DayStatus } from "./providers.ts";
export { CALENDAR_DATASET_FORMAT, CalendarRegistry, importCalendarDataset, type CalendarDataset, type CalendarProvider, type DayStatus, type ProviderStatus } from "./providers.ts";

export type SessionKind = "pre" | "regular" | "post";
export type SessionState = SessionKind | "closed";
/** Local wall-clock times "HH:MM" ("24:00" allowed as an end). */
export type SessionDef = { kind: SessionKind; start: string; end: string };
export type CalendarDef = {
  id: string;
  name: string;
  timeZone: string;
  /** Sessions per weekday, 0 = Sunday … 6 = Saturday. Missing days are closed. */
  week: Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, SessionDef[]>>;
  /** Optional per-date adjustment (e.g. MCX's evening session follows US daylight saving). */
  adjust?: (date: string, sessions: SessionDef[]) => SessionDef[];
  note?: string;
};
export interface HolidayProvider {
  /** True when the exchange is closed all day on `date` (YYYY-MM-DD, exchange-local). */
  isHoliday(calendarId: string, date: string): boolean;
  /** Early close time "HH:MM" for `date`, or null. */
  earlyClose?(calendarId: string, date: string): string | null;
}
/** Holiday provider from plain lists: { NSE: ["2026-01-26", ...] }. */
export function holidayList(holidays: Record<string, string[]>, earlyCloses: Record<string, Record<string, string>> = {}): HolidayProvider {
  for (const [id, list] of Object.entries(holidays)) {
    if (!Array.isArray(list) || list.some((d) => typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d))) throw new XChartError("INVALID_CALENDAR", `Holidays for ${id} must be YYYY-MM-DD strings`);
  }
  const sets = new Map(Object.entries(holidays).map(([k, v]) => [k, new Set(v)]));
  return {
    isHoliday: (id, date) => sets.get(id)?.has(date) ?? false,
    earlyClose: (id, date) => earlyCloses[id]?.[date] ?? null,
  };
}

const wk = (s: SessionDef[]) => ({ 1: s, 2: s, 3: s, 4: s, 5: s });
const INDIA_CASH: SessionDef[] = [
  { kind: "pre", start: "09:00", end: "09:15" },
  { kind: "regular", start: "09:15", end: "15:30" },
  { kind: "post", start: "15:40", end: "16:00" },
];
const US_EQUITY: SessionDef[] = [
  { kind: "pre", start: "04:00", end: "09:30" },
  { kind: "regular", start: "09:30", end: "16:00" },
  { kind: "post", start: "16:00", end: "20:00" },
];

/** US daylight saving on a calendar date (second Sunday of March → first Sunday of November). */
function usDst(date: string): boolean {
  const off = (tz: string, t: number) => offsetSeconds(tz, t);
  const t = Date.parse(`${date}T12:00:00Z`) / 1000;
  return off("America/New_York", t) === -4 * 3600;
}

export const CALENDARS = {
  NSE: { id: "NSE", name: "National Stock Exchange of India", timeZone: "Asia/Kolkata", week: wk(INDIA_CASH), note: "Equity cash market: pre-open 09:00–09:15 (order entry 09:00–09:08), normal 09:15–15:30, closing session 15:40–16:00 IST." },
  BSE: { id: "BSE", name: "BSE", timeZone: "Asia/Kolkata", week: wk(INDIA_CASH), note: "Same equity session timings as NSE." },
  MCX: {
    id: "MCX", name: "Multi Commodity Exchange of India", timeZone: "Asia/Kolkata",
    week: wk([{ kind: "regular", start: "09:00", end: "23:30" }]),
    adjust: (date, s) => (usDst(date) ? s.map((x) => ({ ...x, end: "23:55" })) : s),
    note: "Non-agricultural commodities 09:00–23:30 IST, extended to 23:55 while US daylight saving is in effect. Agricultural contracts close earlier: define a custom calendar for them.",
  },
  NYSE: { id: "NYSE", name: "New York Stock Exchange", timeZone: "America/New_York", week: wk(US_EQUITY), note: "Core session 09:30–16:00 ET; extended hours 04:00–09:30 and 16:00–20:00 ET." },
  NASDAQ: { id: "NASDAQ", name: "Nasdaq", timeZone: "America/New_York", week: wk(US_EQUITY), note: "Core session 09:30–16:00 ET; extended hours 04:00–09:30 and 16:00–20:00 ET." },
  FOREX: {
    id: "FOREX", name: "Spot FX (24/5)", timeZone: "America/New_York",
    week: { 0: [{ kind: "regular", start: "17:00", end: "24:00" }], 1: [{ kind: "regular", start: "00:00", end: "24:00" }], 2: [{ kind: "regular", start: "00:00", end: "24:00" }], 3: [{ kind: "regular", start: "00:00", end: "24:00" }], 4: [{ kind: "regular", start: "00:00", end: "24:00" }], 5: [{ kind: "regular", start: "00:00", end: "17:00" }] },
    note: "Opens Sunday 17:00 New York time, closes Friday 17:00 New York time.",
  },
  CRYPTO: { id: "CRYPTO", name: "Crypto (24/7)", timeZone: "UTC", week: { 0: [{ kind: "regular", start: "00:00", end: "24:00" }], 1: [{ kind: "regular", start: "00:00", end: "24:00" }], 2: [{ kind: "regular", start: "00:00", end: "24:00" }], 3: [{ kind: "regular", start: "00:00", end: "24:00" }], 4: [{ kind: "regular", start: "00:00", end: "24:00" }], 5: [{ kind: "regular", start: "00:00", end: "24:00" }], 6: [{ kind: "regular", start: "00:00", end: "24:00" }] } },
} satisfies Record<string, CalendarDef>;
export type CalendarId = keyof typeof CALENDARS;

// ---------- time-zone arithmetic (Intl based; formatters cached per zone) ----------
const fmts = new Map<string, Intl.DateTimeFormat>();
function parts(tz: string, t: number) {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    fmts.set(tz, f);
  }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(t * 1000))) o[p.type] = p.value;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday);
  return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour % 24, mm: +o.minute, ss: +o.second, dow };
}
/** Offset of `tz` from UTC at instant t, in seconds (east positive). */
export function offsetSeconds(tz: string, t: number): number {
  const p = parts(tz, t);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) / 1000 - Math.floor(t);
}
/** UTC instant of a local wall-clock time in `tz` (resolves DST gaps forward). */
export function zonedTime(tz: string, date: string, hhmm: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm) / 1000;
  let t = guess - offsetSeconds(tz, guess);
  t = guess - offsetSeconds(tz, t);
  return t;
}
const ymd = (p: { y: number; m: number; d: number }) => `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function validateDef(def: CalendarDef) {
  if (!def || typeof def !== "object" || typeof def.id !== "string" || !def.id) throw new XChartError("INVALID_CALENDAR", "Calendar needs an id");
  if (!isTimeZone(def.timeZone)) throw new XChartError("INVALID_CALENDAR", `Unknown time zone "${String(def.timeZone)}"`);
  for (const [day, list] of Object.entries(def.week ?? {})) {
    if (!/^[0-6]$/.test(day) || !Array.isArray(list)) throw new XChartError("INVALID_CALENDAR", "week keys must be 0–6 with session arrays");
    for (const s of list) {
      const ok = (v: unknown) => typeof v === "string" && /^([01]\d|2[0-4]):[0-5]\d$/.test(v) && minutes(v) <= 1440;
      // end ≤ start means the session runs past midnight into the next day (overnight session).
      if (!["pre", "regular", "post"].includes(s.kind) || !ok(s.start) || !ok(s.end) || minutes(s.end) === minutes(s.start)) throw new XChartError("INVALID_CALENDAR", `Invalid session on day ${day}: ${JSON.stringify(s)}`);
    }
  }
}

export class TradingCalendar {
  readonly def: CalendarDef;
  private holidays: HolidayProvider | null;
  private registry: CalendarRegistry | null;
  private cache = new Map<string, DayStatus>();
  private cacheRev = -1;
  /**
   * `holidays`: a HolidayProvider (e.g. holidayList), a CalendarProvider (imported dataset) or a
   * CalendarRegistry. Plain HolidayProviders without covers() are treated as covering every date
   * (you vouch for the list); datasets cover only their declared range.
   */
  constructor(def: CalendarDef | CalendarId, holidays: HolidayProvider | CalendarRegistry | null = null) {
    const d = typeof def === "string" ? (CALENDARS as Record<string, CalendarDef>)[def] : def;
    if (!d) throw new XChartError("INVALID_CALENDAR", `Unknown calendar "${String(def)}". Built in: ${Object.keys(CALENDARS).join(", ")}`);
    validateDef(d);
    this.def = d;
    this.registry = holidays instanceof CalendarRegistry ? holidays : null;
    this.holidays = holidays instanceof CalendarRegistry ? null : holidays;
  }

  /** Provider authoritative for a date (null → the schedule for that date is unverified). */
  private providerFor(date: string): HolidayProvider | null {
    if (this.registry) return this.registry.providerFor(this.def.id, date);
    const h = this.holidays as (HolidayProvider & { covers?: (c: string, d: string) => boolean }) | null;
    if (!h) return null;
    return !h.covers || h.covers(this.def.id, date) ? h : null;
  }

  /**
   * Confirmed status of a local date. Weekly-schedule facts (a weekday with sessions, a weekend
   * without) are only CONFIRMED when a provider covers the date; otherwise weekdays are "unknown"
   * (holidays unverified). Weekend days with no sessions are non-trading unless a provider lists a
   * special session.
   */
  dayStatus(date: string): DayStatus {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new XChartError("INVALID_CALENDAR", "date must be YYYY-MM-DD");
    const rev = this.registry?.revision ?? 0;
    if (rev !== this.cacheRev) {
      this.cache.clear();
      this.cacheRev = rev;
    }
    const hit = this.cache.get(date);
    if (hit) return hit;
    const prov = this.providerFor(date) as (CalendarProvider | (HolidayProvider & Partial<CalendarProvider>)) | null;
    const src = prov && "id" in prov && prov.id ? `${prov.id}@${prov.revision ?? ""}` : prov ? "holiday list" : undefined;
    const weekly = (this.def.week[new Date(`${date}T12:00:00Z`).getUTCDay() as 0] ?? []).some((s) => s.kind === "regular");
    let st: DayStatus;
    if (!prov) st = weekly ? { status: "unknown", reason: "No calendar provider covers this date: holidays are unverified" } : { status: "non-trading", reason: "No session in the weekly schedule (special sessions unverified)" };
    else if (prov.isHoliday(this.def.id, date)) st = { status: "non-trading", reason: prov.holidayName?.(this.def.id, date) ?? "Holiday", source: src };
    else if (prov.specialSessions?.(this.def.id, date)) st = { status: "trading", reason: "Special session", source: src, special: true };
    else st = weekly ? { status: "trading", reason: "Regular trading day", source: src } : { status: "non-trading", reason: "Weekend / no scheduled session", source: src };
    this.cache.set(date, st);
    return st;
  }
  get id() {
    return this.def.id;
  }
  get timeZone() {
    return this.def.timeZone;
  }
  /** Exchange-local date (YYYY-MM-DD) of an instant. */
  localDate(t: number): string {
    return ymd(parts(this.def.timeZone, t));
  }
  isHoliday(date: string): boolean {
    return this.providerFor(date)?.isHoliday(this.def.id, date) ?? false;
  }
  /** Sessions of a local date after weekends, holidays, special sessions, adjustments and early closes. */
  sessions(date: string): SessionDef[] {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new XChartError("INVALID_CALENDAR", "date must be YYYY-MM-DD");
    const prov = this.providerFor(date) as (HolidayProvider & Partial<CalendarProvider>) | null;
    if (prov?.isHoliday(this.def.id, date)) return [];
    const special = prov?.specialSessions?.(this.def.id, date);
    if (special) return special;
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    let list = this.def.week[dow] ?? [];
    if (this.def.adjust) list = this.def.adjust(date, list);
    const early = prov?.earlyClose?.(this.def.id, date);
    if (early) {
      const e = minutes(early);
      list = list.filter((s) => minutes(s.start) < e).map((s) => (minutes(s.end) > e ? { ...s, end: early } : s));
    }
    return list;
  }
  isTradingDay(date: string): boolean {
    return this.sessions(date).some((s) => s.kind === "regular");
  }
  /** Session state at an instant (overnight sessions continue past midnight). */
  sessionAt(t: number): SessionState {
    const p = parts(this.def.timeZone, t);
    const m = p.hh * 60 + p.mm;
    const date = ymd(p);
    for (const s of this.sessions(date)) {
      const a = minutes(s.start), b = minutes(s.end);
      if (b > a ? m >= a && m < b : m >= a) return s.kind;
    }
    // The tail of yesterday's overnight sessions.
    for (const s of this.sessions(addDays(date, -1))) if (minutes(s.end) <= minutes(s.start) && m < minutes(s.end)) return s.kind;
    return "closed";
  }
  isOpen(t: number, includeExtended = false): boolean {
    const s = this.sessionAt(t);
    return s === "regular" || (includeExtended && s !== "closed");
  }
  /** UTC bounds of the regular session on a local date, or null when closed. */
  regularBounds(date: string): { open: number; close: number } | null {
    const reg = this.sessions(date).filter((s) => s.kind === "regular");
    if (!reg.length) return null;
    const last = reg[reg.length - 1];
    const close = last.end;
    const overnight = minutes(close) <= minutes(last.start);
    return {
      open: zonedTime(this.def.timeZone, date, reg[0].start),
      close: close === "24:00" ? zonedTime(this.def.timeZone, addDays(date, 1), "00:00") : zonedTime(this.def.timeZone, overnight ? addDays(date, 1) : date, close),
    };
  }
  /** Next regular-session open at or after t (searches up to 30 days ahead). */
  nextOpen(t: number): number | null {
    let date = this.localDate(t);
    for (let k = 0; k < 30; k++, date = addDays(date, 1)) {
      const b = this.regularBounds(date);
      if (!b) continue;
      if (b.open >= t) return b.open;
      if (t < b.close) return t; // already open
    }
    return null;
  }
  /** Regular trading days in [from, to] (local dates, inclusive). */
  tradingDaysBetween(from: string, to: string): number {
    let n = 0;
    for (let d = from, k = 0; d <= to && k < 3700; d = addDays(d, 1), k++) if (this.isTradingDay(d)) n++;
    return n;
  }
}
