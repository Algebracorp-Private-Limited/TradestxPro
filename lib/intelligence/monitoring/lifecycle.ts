/**
 * Trade-plan lifecycle on daily bars (pure). Paper tracking only: no order is ever placed.
 *
 * States: WATCHING → ACTIVE → CLOSED (TARGET | STOP | TIME_EXIT), or WATCHING → EXPIRED (entry not
 * reached within `entryValidSessions`) / INVALIDATED (stop traded before entry); CANCELLED by the user.
 *
 * Fill rules on daily OHLC (stated, conservative):
 *   - entry: the first bar that trades into the entry zone; fill at the open when the open is inside the
 *     zone, otherwise at the zone edge first reached (a gap through the zone fills at the open);
 *   - exits: a bar that reaches both stop and target exits at the STOP (intrabar order is unknown);
 *     gaps beyond a level fill at the open, not at the level;
 *   - the entry bar itself can stop out (it cannot hit the target on the same bar, since the bar's
 *     path after the fill is unknown);
 *   - time exit at the close of the `timeExitSessions`-th session after entry.
 * R = (exit − entry) / |entry − stop| for longs (sign-flipped for shorts); net R subtracts costs.
 */

export type DayBar = { d: string; o: number; h: number; l: number; c: number };
export type PlanLevels = {
  direction: "long" | "short";
  entry: { low: number; high: number };
  stop: number;
  target: number;
  timeExitSessions: number;
  entryValidSessions: number;
  /** Round-trip cost as a fraction of the entry price (e.g. 0.002 = 0.2%). */
  costFraction: number;
};
export type PlanStatus = "WATCHING" | "ACTIVE" | "CLOSED" | "EXPIRED" | "INVALIDATED" | "CANCELLED";
export type PlanEvent = { d: string; kind: "ENTERED" | "STOP" | "TARGET" | "TIME_EXIT" | "EXPIRED" | "INVALIDATED"; price: number | null; note: string };
export type PlanState = {
  status: PlanStatus;
  entryDate: string | null; entryPrice: number | null; sessionsWaiting: number; sessionsHeld: number;
  exitDate: string | null; exitPrice: number | null; exitReason: "TARGET" | "STOP" | "TIME_EXIT" | null;
  r: number | null; netR: number | null; mae: number | null; mfe: number | null;
};

export const initialState = (): PlanState => ({ status: "WATCHING", entryDate: null, entryPrice: null, sessionsWaiting: 0, sessionsHeld: 0, exitDate: null, exitPrice: null, exitReason: null, r: null, netR: null, mae: null, mfe: null });
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function validatePlan(p: PlanLevels): string[] {
  const e: string[] = [];
  const fin = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (!fin(p.entry?.low) || !fin(p.entry?.high) || p.entry.low > p.entry.high) e.push("entry zone must be positive with low ≤ high");
  if (!fin(p.stop) || !fin(p.target)) e.push("stop and target must be positive numbers");
  if (p.direction === "long" && !(p.stop < p.entry.low && p.target > p.entry.high)) e.push("long plans need stop < entry zone < target");
  if (p.direction === "short" && !(p.stop > p.entry.high && p.target < p.entry.low)) e.push("short plans need target < entry zone < stop");
  if (!Number.isInteger(p.timeExitSessions) || p.timeExitSessions < 1 || p.timeExitSessions > 250) e.push("time exit must be 1–250 sessions");
  if (!Number.isInteger(p.entryValidSessions) || p.entryValidSessions < 1 || p.entryValidSessions > 60) e.push("entry validity must be 1–60 sessions");
  if (!(p.costFraction >= 0 && p.costFraction < 0.05)) e.push("cost fraction must be between 0 and 5%");
  return e;
}

/** Advances a plan over bars strictly after `startDate` (and after the state's last processed bar). */
export function advancePlan(p: PlanLevels, state: PlanState, bars: DayBar[]): { state: PlanState; events: PlanEvent[] } {
  const s: PlanState = { ...state };
  const events: PlanEvent[] = [];
  const long = p.direction === "long";
  const risk = (entry: number) => Math.abs(entry - p.stop);
  const close = (b: DayBar, price: number, reason: "TARGET" | "STOP" | "TIME_EXIT") => {
    s.status = "CLOSED"; s.exitDate = b.d; s.exitPrice = r4(price); s.exitReason = reason;
    const rr = ((long ? price - s.entryPrice! : s.entryPrice! - price) / risk(s.entryPrice!));
    s.r = r4(rr);
    s.netR = r4(rr - (p.costFraction * s.entryPrice!) / risk(s.entryPrice!));
    events.push({ d: b.d, kind: reason, price: s.exitPrice, note: `${reason === "TARGET" ? "Target reached" : reason === "STOP" ? "Stop-loss reached" : "Time exit at the close"} at ${s.exitPrice} (${s.r}R gross)` });
  };
  const track = (b: DayBar) => {
    const adverse = long ? (s.entryPrice! - b.l) / risk(s.entryPrice!) : (b.h - s.entryPrice!) / risk(s.entryPrice!);
    const favour = long ? (b.h - s.entryPrice!) / risk(s.entryPrice!) : (s.entryPrice! - b.l) / risk(s.entryPrice!);
    s.mae = r4(Math.max(s.mae ?? 0, adverse));
    s.mfe = r4(Math.max(s.mfe ?? 0, favour));
  };
  const stopHit = (b: DayBar) => (long ? b.l <= p.stop : b.h >= p.stop);
  const stopFill = (b: DayBar) => (long ? Math.min(b.o, p.stop) : Math.max(b.o, p.stop));
  for (const b of bars) {
    if (s.status !== "WATCHING" && s.status !== "ACTIVE") break;
    if (s.status === "WATCHING") {
      s.sessionsWaiting++;
      const touches = b.l <= p.entry.high && b.h >= p.entry.low;
      // Stop traded with no entry possible first (gap beyond the stop, or zone never touched on that bar).
      const gappedPastStop = long ? b.o <= p.stop : b.o >= p.stop;
      if (gappedPastStop || (!touches && stopHit(b))) {
        s.status = "INVALIDATED";
        events.push({ d: b.d, kind: "INVALIDATED", price: null, note: "Stop level traded before the entry zone: plan invalidated without entry" });
        break;
      }
      if (touches) {
        const fill = b.o >= p.entry.low && b.o <= p.entry.high ? b.o : long ? (b.o > p.entry.high ? p.entry.high : b.o) : (b.o < p.entry.low ? p.entry.low : b.o);
        s.status = "ACTIVE"; s.entryDate = b.d; s.entryPrice = r4(fill);
        events.push({ d: b.d, kind: "ENTERED", price: s.entryPrice, note: `Entry zone traded: paper entry at ${s.entryPrice}` });
        track(b);
        if (stopHit(b)) close(b, stopFill(b), "STOP");
        continue;
      }
      if (s.sessionsWaiting >= p.entryValidSessions) {
        s.status = "EXPIRED";
        events.push({ d: b.d, kind: "EXPIRED", price: null, note: `Entry zone not reached within ${p.entryValidSessions} sessions` });
        break;
      }
      continue;
    }
    // ACTIVE
    s.sessionsHeld++;
    track(b);
    const tgtHit = long ? b.h >= p.target : b.l <= p.target;
    if (stopHit(b)) close(b, stopFill(b), "STOP");
    else if (tgtHit) close(b, long ? Math.max(b.o, p.target) : Math.min(b.o, p.target), "TARGET");
    else if (s.sessionsHeld >= p.timeExitSessions) close(b, b.c, "TIME_EXIT");
  }
  return { state: s, events };
}
