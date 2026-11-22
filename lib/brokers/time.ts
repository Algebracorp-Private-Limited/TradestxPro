// Pure time/bar helpers for broker data (unit tested).
import type { Bar } from "../ta/catalog.ts";

export const pad = (n: number) => String(n).padStart(2, "0");
/** Date → "YYYY-MM-DD" in IST. */
export function istDate(d: Date): string {
  return new Date(d.getTime() + 19800_000).toISOString().slice(0, 10);
}
/** Date → "YYYY-MM-DD HH:mm:ss" in IST. */
export function istDateTime(d: Date): string {
  return new Date(d.getTime() + 19800_000).toISOString().slice(0, 19).replace("T", " ");
}
/** Parses "YYYY-MM-DD HH:mm[:ss]" (IST wall clock) or ISO with offset into UTC seconds. */
export function parseIstTime(s: string): number {
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return Math.floor(new Date(s).getTime() / 1000);
  const [d, t = "00:00:00"] = s.trim().split(/[ T]/);
  return Math.floor(new Date(`${d}T${t.length === 5 ? t + ":00" : t}+05:30`).getTime() / 1000);
}
/** Daily candles are keyed to 00:00 UTC of their IST trading date, matching end-of-day bars. */
export function normaliseDaily(bars: Bar[]): Bar[] {
  return bars.map((b) => ({ ...b, t: Math.floor(Date.parse(istDate(new Date(b.t * 1000)) + "T00:00:00Z") / 1000) }));
}

/** Aggregates intraday bars into `minutes`-wide buckets aligned to the 09:15 IST session open. */
export function bucketMinutes(bars: Bar[], minutes: number): Bar[] {
  const out: Bar[] = [];
  let key = -1;
  for (const b of bars) {
    const ist = b.t + 19800;
    const day = Math.floor(ist / 86400);
    const sinceOpen = (ist % 86400) - (9 * 3600 + 15 * 60);
    const k = day * 10_000 + Math.floor(sinceOpen / (minutes * 60));
    if (k !== key) {
      out.push({ ...b });
      key = k;
    } else {
      const c = out[out.length - 1];
      c.h = Math.max(c.h, b.h);
      c.l = Math.min(c.l, b.l);
      c.c = b.c;
      c.v += b.v;
    }
  }
  return out;
}

