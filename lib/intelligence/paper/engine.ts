/**
 * Paper-trading engine (pure): instruments, fill rules and position accounting. Simulation only.
 *
 * Instruments
 *   NSE:SYMBOL                         cash equity (daily OHLC from the equity bhavcopy)
 *   FUT:UNDERLYING:YYYY-MM-DD          future (session close from the F&O bhavcopy)
 *   OPT:UNDERLYING:YYYY-MM-DD:STRIKE:CE|PE   option (session close from the F&O bhavcopy)
 *
 * Fill rules (only data AFTER the order's placement date is used)
 *   equity  MARKET → next session's open; LIMIT BUY → first session whose low ≤ limit, at min(open, limit);
 *           LIMIT SELL → first session whose high ≥ limit, at max(open, limit)
 *   F&O     only the session close is stored: MARKET → next session's close; LIMIT BUY fills when that
 *           close ≤ limit (at the close), LIMIT SELL when the close ≥ limit (at the close)
 *   Orders expire after `valid_sessions` sessions without a fill.
 *
 * Accounting: signed quantity with average price; realised P&L on reductions. Cash moves by the full
 * value for equities and option premiums; futures move cash only by realised P&L (no notional debit).
 * Margin is NOT simulated: short options and futures are allowed and flagged. Cash equities cannot be
 * sold short (delivery segment).
 */

export type Kind = "equity" | "future" | "option";
export type Parsed = { kind: Kind; underlying: string; expiry: string | null; strike: number | null; right: "CE" | "PE" | null; key: string };

export function parseInstrument(raw: string): Parsed | null {
  const s = raw.trim().toUpperCase();
  let m = /^NSE:([A-Z0-9&.-]{1,30})$/.exec(s);
  if (m) return { kind: "equity", underlying: m[1], expiry: null, strike: null, right: null, key: s };
  m = /^FUT:([A-Z0-9&.-]{1,30}):(\d{4}-\d{2}-\d{2})$/.exec(s);
  if (m) return { kind: "future", underlying: m[1], expiry: m[2], strike: null, right: null, key: s };
  m = /^OPT:([A-Z0-9&.-]{1,30}):(\d{4}-\d{2}-\d{2}):(\d+(?:\.\d+)?):(CE|PE)$/.exec(s);
  if (m) return { kind: "option", underlying: m[1], expiry: m[2], strike: Number(m[3]), right: m[4] as "CE" | "PE", key: `OPT:${m[1]}:${m[2]}:${Number(m[3])}:${m[4]}` };
  return null;
}

export type Session = { d: string; o: number | null; h: number | null; l: number | null; c: number };
export type OrderIn = { side: "BUY" | "SELL"; type: "MARKET" | "LIMIT"; limit: number | null; placedD: string; validSessions: number; sessionsSeen: number };

/** Returns a fill on the first eligible session after the placement date, or the sessions consumed. */
export function tryFill(kind: Kind, o: OrderIn, sessions: Session[]): { fill: { d: string; price: number } | null; sessionsSeen: number; expired: boolean } {
  let seen = o.sessionsSeen;
  for (const s of sessions) {
    if (s.d <= o.placedD) continue;
    seen++;
    if (kind === "equity" && s.o !== null && s.h !== null && s.l !== null) {
      if (o.type === "MARKET") return { fill: { d: s.d, price: s.o }, sessionsSeen: seen, expired: false };
      if (o.side === "BUY" && s.l <= o.limit!) return { fill: { d: s.d, price: Math.min(s.o, o.limit!) }, sessionsSeen: seen, expired: false };
      if (o.side === "SELL" && s.h >= o.limit!) return { fill: { d: s.d, price: Math.max(s.o, o.limit!) }, sessionsSeen: seen, expired: false };
    } else {
      if (o.type === "MARKET") return { fill: { d: s.d, price: s.c }, sessionsSeen: seen, expired: false };
      if (o.side === "BUY" ? s.c <= o.limit! : s.c >= o.limit!) return { fill: { d: s.d, price: s.c }, sessionsSeen: seen, expired: false };
    }
    if (seen >= o.validSessions) return { fill: null, sessionsSeen: seen, expired: true };
  }
  return { fill: null, sessionsSeen: seen, expired: false };
}

export type Position = { qty: number; avg: number; realized: number };

/** Applies a fill to a position (signed qty). Returns the new position and the realised P&L of this fill. */
export function applyFill(p: Position, side: "BUY" | "SELL", qty: number, price: number): { position: Position; realized: number } {
  const signed = side === "BUY" ? qty : -qty;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  if (p.qty === 0 || Math.sign(p.qty) === Math.sign(signed)) {
    const nq = p.qty + signed;
    return { position: { qty: nq, avg: (Math.abs(p.qty) * p.avg + qty * price) / Math.abs(nq), realized: p.realized }, realized: 0 };
  }
  const closing = Math.min(Math.abs(p.qty), qty);
  const realized = r2(closing * (price - p.avg) * Math.sign(p.qty));
  const nq = p.qty + signed;
  const avg = nq === 0 ? 0 : Math.sign(nq) === Math.sign(p.qty) ? p.avg : price; // flipped: the remainder opens at this price
  return { position: { qty: nq, avg, realized: r2(p.realized + realized) }, realized };
}

/** Cash change of a fill (before costs). Futures settle only realised P&L. */
export function cashDelta(kind: Kind, side: "BUY" | "SELL", qty: number, price: number, realized: number): number {
  if (kind === "future") return realized;
  return (side === "BUY" ? -1 : 1) * qty * price;
}

/** Expiry value per unit: futures at the final price, options at intrinsic value against the underlying. */
export function settlementValue(p: Parsed, underlyingClose: number): number {
  if (p.kind === "future") return underlyingClose;
  return Math.max(0, p.right === "CE" ? underlyingClose - p.strike! : p.strike! - underlyingClose);
}
