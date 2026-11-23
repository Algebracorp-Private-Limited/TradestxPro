// Adds/updates today's candle on daily or weekly bars from a live quote (brokers' daily history
// usually stops at the previous session). Pure and unit tested.
import type { Bar } from "./ta/catalog.ts";

export type LiveQuote = { ltp: number; open: number | null; high: number | null; low: number | null; volume: number | null };

const istDay = (ms: number) => new Date(ms + 19800_000).toISOString().slice(0, 10);
const mondayOf = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400_000).toISOString().slice(0, 10);
};

export function mergeLiveCandle(bars: Bar[], q: LiveQuote, tf: "1D" | "1W", now = Date.now()): Bar[] {
  if (!bars.length || !(q.ltp > 0)) return bars;
  const today = istDay(now);
  const wd = new Date(today + "T00:00:00Z").getUTCDay();
  if (wd === 0 || wd === 6) return bars; // no session at weekends
  const todayT = Date.parse(today + "T00:00:00Z") / 1000;
  const out = bars.slice();
  const last = out[out.length - 1];
  const lastDay = new Date(last.t * 1000).toISOString().slice(0, 10);
  const live: Bar = {
    t: todayT,
    o: q.open && q.open > 0 ? q.open : q.ltp,
    h: Math.max(q.high ?? q.ltp, q.ltp),
    l: Math.min(q.low && q.low > 0 ? q.low : q.ltp, q.ltp),
    c: q.ltp,
    v: q.volume ?? 0,
  };
  if (tf === "1D") {
    if (lastDay === today) out[out.length - 1] = { ...last, h: Math.max(last.h, live.h), l: Math.min(last.l, live.l), c: live.c, v: Math.max(last.v, live.v) };
    else if (lastDay < today) out.push(live);
    return out;
  }
  // Weekly: extend this week's bar, or start a new one.
  if (mondayOf(lastDay) === mondayOf(today)) {
    out[out.length - 1] = { ...last, h: Math.max(last.h, live.h), l: Math.min(last.l, live.l), c: live.c };
  } else if (lastDay < today) out.push({ ...live, t: Date.parse(mondayOf(today) + "T00:00:00Z") / 1000 });
  return out;
}
