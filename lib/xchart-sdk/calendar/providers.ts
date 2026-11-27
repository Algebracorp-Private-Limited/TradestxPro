/**
 * Calendar providers: authoritative exchange schedules (holidays, special sessions, early closes)
 * supplied as versioned, attributed datasets. Nothing is hard-coded: a date outside every
 * provider's coverage is UNKNOWN, never assumed to be a trading day.
 */
import { XChartError } from "../validation.ts";
import type { HolidayProvider, SessionDef } from "./index.ts";

export const CALENDAR_DATASET_FORMAT = "xchart-calendar";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-4]):[0-5]\d$/;

export type CalendarDataset = {
  format: typeof CALENDAR_DATASET_FORMAT;
  version: 1;
  /** Dataset revision chosen by the publisher (e.g. "2026.2"). */
  revision: string;
  provider: { id: string; name: string; source: { name: string; url?: string }; retrievedAt: string; validUntil?: string; license?: string; notes?: string };
  calendars: Record<string, {
    /** Inclusive local-date range the dataset is authoritative for. */
    coverage: { from: string; to: string };
    holidays: { date: string; name: string }[];
    earlyCloses?: { date: string; close: string; name?: string }[];
    /** Sessions on dates that normally have none (e.g. a weekend special session) or replace the normal ones. */
    specialSessions?: { date: string; name?: string; sessions: SessionDef[] }[];
  }>;
};

export type DayStatus = {
  status: "trading" | "non-trading" | "unknown";
  reason: string;
  /** Provider id and revision that confirmed it (absent for weekly-schedule facts and unknowns). */
  source?: string;
  special?: boolean;
};

/** A provider that can say what it covers (datasets do; plain holiday lists cover everything you give them). */
export interface CalendarProvider extends HolidayProvider {
  readonly id: string;
  readonly revision: string;
  covers(calendarId: string, date: string): boolean;
  specialSessions?(calendarId: string, date: string): SessionDef[] | null;
  holidayName?(calendarId: string, date: string): string | null;
  metadata(): CalendarDataset["provider"] & { revision: string; coverage: Record<string, { from: string; to: string }> };
}

const err = (m: string) => new XChartError("INVALID_CALENDAR", m);
function checkSessions(list: unknown, where: string): asserts list is SessionDef[] {
  if (!Array.isArray(list) || !list.length) throw err(`${where}: sessions must be a non-empty array`);
  for (const s of list as SessionDef[]) {
    if (!s || !["pre", "regular", "post"].includes(s.kind) || !HHMM.test(s.start) || !HHMM.test(s.end)) throw err(`${where}: invalid session ${JSON.stringify(s)}`);
  }
}

/** Validates and imports a calendar dataset (JSON text or object). Throws INVALID_CALENDAR on any problem. */
export function importCalendarDataset(input: unknown): CalendarProvider {
  let d: unknown = input;
  if (typeof input === "string") {
    if (input.length > 2_000_000) throw err("Calendar dataset is too large");
    try {
      d = JSON.parse(input);
    } catch {
      throw err("Calendar dataset is not valid JSON");
    }
  }
  const o = d as CalendarDataset;
  if (!o || typeof o !== "object" || o.format !== CALENDAR_DATASET_FORMAT || o.version !== 1) throw err(`Not an XChart calendar dataset (format "${CALENDAR_DATASET_FORMAT}", version 1)`);
  if (typeof o.revision !== "string" || !o.revision) throw err("revision is required");
  const p = o.provider;
  if (!p || typeof p.id !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(p.id) || typeof p.name !== "string" || !p.source || typeof p.source.name !== "string") throw err("provider needs id, name and source.name");
  if (!DATE.test(p.retrievedAt ?? "")) throw err("provider.retrievedAt must be YYYY-MM-DD (when the data was obtained from the source)");
  if (p.validUntil !== undefined && !DATE.test(p.validUntil)) throw err("provider.validUntil must be YYYY-MM-DD");
  if (!o.calendars || typeof o.calendars !== "object") throw err("calendars must be an object");
  const cals = new Map<string, { from: string; to: string; holidays: Map<string, string>; early: Map<string, string>; special: Map<string, SessionDef[]> }>();
  for (const [id, c] of Object.entries(o.calendars)) {
    if (["__proto__", "constructor", "prototype"].includes(id) || !/^[A-Za-z0-9_-]{1,32}$/.test(id)) throw err(`invalid calendar id "${id}"`);
    if (!c?.coverage || !DATE.test(c.coverage.from) || !DATE.test(c.coverage.to) || c.coverage.from > c.coverage.to) throw err(`${id}: coverage must be { from, to } dates with from ≤ to`);
    if (!Array.isArray(c.holidays)) throw err(`${id}: holidays must be an array`);
    const holidays = new Map<string, string>();
    for (const h of c.holidays) {
      if (!h || !DATE.test(h.date) || typeof h.name !== "string") throw err(`${id}: holidays need { date, name }`);
      if (h.date < c.coverage.from || h.date > c.coverage.to) throw err(`${id}: holiday ${h.date} lies outside the coverage`);
      if (holidays.has(h.date)) throw err(`${id}: duplicate holiday ${h.date}`);
      holidays.set(h.date, h.name);
    }
    const early = new Map<string, string>();
    for (const e of c.earlyCloses ?? []) {
      if (!e || !DATE.test(e.date) || !HHMM.test(e.close)) throw err(`${id}: early closes need { date, close: "HH:MM" }`);
      if (holidays.has(e.date)) throw err(`${id}: ${e.date} cannot be both a holiday and an early close`);
      early.set(e.date, e.close);
    }
    const special = new Map<string, SessionDef[]>();
    for (const s of c.specialSessions ?? []) {
      if (!s || !DATE.test(s.date)) throw err(`${id}: special sessions need a date`);
      checkSessions(s.sessions, `${id} ${s.date}`);
      if (holidays.has(s.date)) throw err(`${id}: ${s.date} cannot be both a holiday and a special session`);
      special.set(s.date, s.sessions.map((x) => ({ ...x })));
    }
    cals.set(id, { from: c.coverage.from, to: c.coverage.to, holidays, early, special });
  }
  const meta = { ...p, source: { ...p.source }, revision: o.revision, coverage: Object.fromEntries([...cals].map(([k, v]) => [k, { from: v.from, to: v.to }])) };
  return {
    id: p.id,
    revision: o.revision,
    covers: (cal, date) => {
      const c = cals.get(cal);
      return !!c && date >= c.from && date <= c.to;
    },
    isHoliday: (cal, date) => cals.get(cal)?.holidays.has(date) ?? false,
    holidayName: (cal, date) => cals.get(cal)?.holidays.get(date) ?? null,
    earlyClose: (cal, date) => cals.get(cal)?.early.get(date) ?? null,
    specialSessions: (cal, date) => cals.get(cal)?.special.get(date)?.map((x) => ({ ...x })) ?? null,
    metadata: () => JSON.parse(JSON.stringify(meta)),
  };
}

export type ProviderStatus = { id: string; state: "ok" | "stale" | "failed"; revision?: string; retrievedAt?: string; validUntil?: string; source?: string; error?: string; failedAt?: string };

/**
 * Registry of calendar providers (first registered = highest priority for a date it covers).
 * Every change increments `revision`, which calendars use to invalidate cached day statuses.
 * Loading failures keep the last good dataset and are reported by status().
 */
export class CalendarRegistry {
  private list: CalendarProvider[] = [];
  private failures = new Map<string, { error: string; at: string }>();
  revision = 0;

  register(p: CalendarProvider | CalendarDataset | string): CalendarProvider {
    const prov = typeof p === "string" || (p as CalendarDataset).format === CALENDAR_DATASET_FORMAT ? importCalendarDataset(p) : (p as CalendarProvider);
    if (typeof prov.covers !== "function" || typeof prov.isHoliday !== "function" || typeof prov.metadata !== "function") throw err("A provider needs covers(), isHoliday() and metadata()");
    this.list = [...this.list.filter((x) => x.id !== prov.id), prov];
    this.failures.delete(prov.id);
    this.revision++;
    return prov;
  }
  unregister(id: string): boolean {
    const n = this.list.length;
    this.list = this.list.filter((x) => x.id !== id);
    if (this.list.length !== n) this.revision++;
    return this.list.length !== n;
  }
  providers(): CalendarProvider[] {
    return [...this.list];
  }
  /** Provider authoritative for a calendar date, or null (→ unknown). */
  providerFor(calendarId: string, date: string): CalendarProvider | null {
    return this.list.find((p) => p.covers(calendarId, date)) ?? null;
  }
  /** Loads a dataset from any source (fetch, file, …). On failure the previous dataset stays in use. */
  async load(id: string, loader: () => Promise<unknown>): Promise<ProviderStatus> {
    try {
      const data = await loader();
      const prov = this.register(data as CalendarDataset);
      if (prov.id !== id) throw err(`loader for "${id}" returned provider "${prov.id}"`);
    } catch (e) {
      this.failures.set(id, { error: (e as Error).message, at: new Date().toISOString() });
    }
    return this.status(id);
  }
  status(id: string, today = new Date().toISOString().slice(0, 10)): ProviderStatus {
    const p = this.list.find((x) => x.id === id);
    const f = this.failures.get(id);
    if (!p) return { id, state: "failed", error: f?.error ?? "not loaded", failedAt: f?.at };
    const m = p.metadata();
    const stale = (m.validUntil && m.validUntil < today) || Boolean(f);
    return { id, state: stale ? "stale" : "ok", revision: m.revision, retrievedAt: m.retrievedAt, validUntil: m.validUntil, source: m.source.name, ...(f ? { error: f.error, failedAt: f.at } : {}) };
  }
}
