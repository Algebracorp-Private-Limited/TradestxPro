/**
 * Paper-trading storage and daily processing (migration 007). Simulation only: no broker is contacted,
 * no order leaves TradestXPro. Orders are processed by the daily monitoring job on end-of-day data.
 */
import type postgres from "postgres";
import { UNDERLYING_INDEX } from "../../options/underlyings.ts";
import { estimateCosts, hasScheduleFor } from "../risk/costs.ts";
import { MonitorError } from "../monitoring/errors.ts";
import { notify } from "../monitoring/alerts.ts";
import { applyFill, cashDelta, parseInstrument, settlementValue, tryFill, type Parsed, type Session } from "./engine.ts";

type Sql = postgres.Sql;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const r2 = (v: number) => Math.round(v * 100) / 100;
export const DEFAULT_STARTING_CASH = 1_000_000;

export async function paperAvailable(sql: Sql): Promise<boolean> {
  const [r] = await sql<{ t: string | null }[]>`SELECT to_regclass('public.paper_orders')::text AS t`;
  return Boolean(r?.t);
}

async function account(sql: Sql, userId: number) {
  await sql`INSERT INTO paper_accounts (user_id, starting_cash, cash) VALUES (${userId}, ${DEFAULT_STARTING_CASH}, ${DEFAULT_STARTING_CASH}) ON CONFLICT (user_id) DO NOTHING`;
  const [a] = await sql<{ starting_cash: number; cash: number; costs_paid: number; created_at: Date; reset_at: Date | null }[]>`SELECT * FROM paper_accounts WHERE user_id = ${userId}`;
  return a;
}

/** Latest data for an instrument: sessions after `after` (equity bars; one F&O session — only the latest is stored). */
export async function sessionsFor(sql: Sql, p: Parsed, after: string): Promise<Session[]> {
  if (p.kind === "equity") {
    const rows = await sql<{ d: Date; o: number; h: number; l: number; c: number }[]>`SELECT d, o, h, l, c FROM candles WHERE series = ${p.key} AND d > ${after} ORDER BY d LIMIT 60`;
    return rows.map((r) => ({ d: iso(r.d), o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c) }));
  }
  const rows = p.kind === "future"
    ? await sql<{ d: Date; close: number; lot: number }[]>`SELECT d, close, lot FROM fo_futures WHERE underlying = ${p.underlying} AND expiry = ${p.expiry} AND d > ${after}`
    : await sql<{ d: Date; close: number; lot: number }[]>`SELECT d, close, lot FROM fo_contracts WHERE underlying = ${p.underlying} AND expiry = ${p.expiry} AND strike = ${p.strike} AND opt = ${p.right} AND d > ${after}`;
  return rows.map((r) => ({ d: iso(r.d), o: null, h: null, l: null, c: Number(r.close) }));
}

/** Latest known price and its date (for valuation and order placement). */
export async function latestPrice(sql: Sql, p: Parsed): Promise<{ d: string; price: number; lot: number } | null> {
  if (p.kind === "equity") {
    const [r] = await sql<{ d: Date; c: number }[]>`SELECT d, c FROM candles WHERE series = ${p.key} ORDER BY d DESC LIMIT 1`;
    return r ? { d: iso(r.d), price: Number(r.c), lot: 1 } : null;
  }
  if (p.kind === "future") {
    const t = await sql<{ t: string | null }[]>`SELECT to_regclass('public.fo_futures')::text AS t`;
    if (!t[0].t) return null;
    const [r] = await sql<{ d: Date; close: number; lot: number }[]>`SELECT d, close, lot FROM fo_futures WHERE underlying = ${p.underlying} AND expiry = ${p.expiry}`;
    return r ? { d: iso(r.d), price: Number(r.close), lot: Number(r.lot) } : null;
  }
  const [r] = await sql<{ d: Date; close: number; lot: number }[]>`SELECT d, close, lot FROM fo_contracts WHERE underlying = ${p.underlying} AND expiry = ${p.expiry} AND strike = ${p.strike} AND opt = ${p.right}`;
  return r ? { d: iso(r.d), price: Number(r.close), lot: Number(r.lot) } : null;
}

async function underlyingCloseOn(sql: Sql, underlying: string, d: string): Promise<{ d: string; c: number } | null> {
  const idx = UNDERLYING_INDEX[underlying];
  const series = idx ? `NSEIDX:${idx}` : `NSE:${underlying}`;
  const [r] = await sql<{ d: Date; c: number }[]>`SELECT d, c FROM candles WHERE series = ${series} AND d <= ${d} ORDER BY d DESC LIMIT 1`;
  return r && iso(r.d) === d ? { d, c: Number(r.c) } : null;
}

export type OrderInput = { instrument: string; side: string; qty: number; type: string; limit?: number | null; validSessions?: number };

export async function placeOrder(sql: Sql, userId: number, o: OrderInput) {
  const p = parseInstrument(o.instrument);
  if (!p) throw new MonitorError("Instrument must be NSE:SYMBOL, FUT:UNDERLYING:YYYY-MM-DD or OPT:UNDERLYING:YYYY-MM-DD:STRIKE:CE|PE");
  if (o.side !== "BUY" && o.side !== "SELL") throw new MonitorError("side must be BUY or SELL");
  if (o.type !== "MARKET" && o.type !== "LIMIT") throw new MonitorError("type must be MARKET or LIMIT");
  if (!Number.isInteger(o.qty) || o.qty < 1 || o.qty > 1_000_000) throw new MonitorError("quantity must be a whole number from 1 to 1,000,000");
  const limit = o.type === "LIMIT" ? Number(o.limit) : null;
  if (o.type === "LIMIT" && !(limit! > 0)) throw new MonitorError("limit price must be positive");
  const valid = Math.min(30, Math.max(1, Math.round(o.validSessions ?? 5)));
  const last = await latestPrice(sql, p);
  if (!last) throw new MonitorError("No market data for this instrument (expired, not traded, or not in the latest F&O session).", 404);
  if (p.kind !== "equity" && o.qty % last.lot !== 0) throw new MonitorError(`F&O quantity must be a multiple of the lot size (${last.lot}).`);
  if (p.expiry && p.expiry <= last.d) throw new MonitorError("This contract expires on or before the next session.");
  if (p.kind === "equity" && o.side === "SELL") {
    const [pos] = await sql<{ qty: number }[]>`SELECT qty FROM paper_positions WHERE user_id = ${userId} AND instrument = ${p.key}`;
    const [{ pending }] = await sql<{ pending: number }[]>`SELECT COALESCE(sum(qty), 0)::int AS pending FROM paper_orders WHERE user_id = ${userId} AND instrument = ${p.key} AND side = 'SELL' AND status = 'OPEN'`;
    if ((pos?.qty ?? 0) - pending < o.qty) throw new MonitorError("Cash equities cannot be sold short: sell quantity exceeds your position (including open sell orders).");
  }
  await account(sql, userId);
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM paper_orders WHERE user_id = ${userId} AND status = 'OPEN'`;
  if (n >= 50) throw new MonitorError("At most 50 open paper orders.", 429);
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO paper_orders (user_id, instrument, side, qty, order_type, limit_price, placed_d, valid_sessions)
    VALUES (${userId}, ${p.key}, ${o.side}, ${o.qty}, ${o.type}, ${limit}, ${last.d}, ${valid}) RETURNING id`;
  return { id: Number(row.id), placedAfter: last.d, note: p.kind === "equity" ? "Fills on a later session (market orders at that session's open)." : "Fills on a later F&O session at its close (only closes are stored). Margin is not simulated." };
}

export async function cancelOrder(sql: Sql, userId: number, id: number) {
  return (await sql`UPDATE paper_orders SET status = 'CANCELLED', reason = 'Cancelled by you' WHERE id = ${id} AND user_id = ${userId} AND status = 'OPEN' RETURNING id`).length > 0;
}

export async function resetAccount(sql: Sql, userId: number, startingCash: number) {
  if (!(startingCash >= 10_000 && startingCash <= 1e9)) throw new MonitorError("starting cash must be between ₹10,000 and ₹100 crore");
  await sql.begin(async (tx) => {
    await tx`DELETE FROM paper_fills WHERE user_id = ${userId}`;
    await tx`DELETE FROM paper_orders WHERE user_id = ${userId}`;
    await tx`DELETE FROM paper_positions WHERE user_id = ${userId}`;
    await tx`INSERT INTO paper_accounts (user_id, starting_cash, cash, costs_paid, reset_at) VALUES (${userId}, ${startingCash}, ${startingCash}, 0, now())
             ON CONFLICT (user_id) DO UPDATE SET starting_cash = EXCLUDED.starting_cash, cash = EXCLUDED.cash, costs_paid = 0, reset_at = now()`;
  });
}

function costsFor(p: Parsed, side: "BUY" | "SELL", qty: number, price: number, d: string): number {
  if (!hasScheduleFor(d)) return 0;
  const segment = p.kind === "equity" ? "equity-delivery" : p.kind === "future" ? "futures" : "options";
  return estimateCosts([{ segment, side, price, quantity: qty }], { tradeDate: d, slippage: 0 }).total;
}

type OrderRow = { id: number; user_id: number; instrument: string; side: "BUY" | "SELL"; qty: number; order_type: "MARKET" | "LIMIT"; limit_price: number | null; placed_d: Date; valid_sessions: number; sessions_seen: number };

/** Processes one open order against data after its placement date. */
export async function processOrder(sql: Sql, o: OrderRow): Promise<"filled" | "rejected" | "expired" | "open"> {
  const p = parseInstrument(o.instrument)!;
  const sessions = await sessionsFor(sql, p, iso(o.placed_d));
  const r = tryFill(p.kind, { side: o.side, type: o.order_type, limit: o.limit_price, placedD: iso(o.placed_d), validSessions: o.valid_sessions, sessionsSeen: o.sessions_seen }, sessions);
  if (!r.fill) {
    await sql`UPDATE paper_orders SET sessions_seen = ${r.sessionsSeen}, status = ${r.expired ? "EXPIRED" : "OPEN"}, reason = ${r.expired ? `No fill within ${o.valid_sessions} sessions` : null} WHERE id = ${o.id} AND status = 'OPEN'`;
    return r.expired ? "expired" : "open";
  }
  const { d, price } = r.fill;
  let outcome: "filled" | "rejected" = "filled";
  await sql.begin(async (tx) => {
    const [acct] = await tx<{ cash: number }[]>`SELECT cash FROM paper_accounts WHERE user_id = ${o.user_id} FOR UPDATE`;
    const [pos] = await tx<{ qty: number; avg_price: number; realized_pnl: number }[]>`SELECT qty, avg_price, realized_pnl FROM paper_positions WHERE user_id = ${o.user_id} AND instrument = ${p.key} FOR UPDATE`;
    const cur = { qty: pos?.qty ?? 0, avg: pos?.avg_price ?? 0, realized: pos?.realized_pnl ?? 0 };
    const res = applyFill(cur, o.side, o.qty, price);
    const costs = r2(costsFor(p, o.side, o.qty, price, d));
    const delta = r2(cashDelta(p.kind, o.side, o.qty, price, res.realized) - costs);
    let reject: string | null = null;
    if (p.kind === "equity" && res.position.qty < 0) reject = "Cash equities cannot be sold short.";
    else if (delta < 0 && acct.cash + delta < 0) reject = `Insufficient paper cash (needs ₹${-delta}, available ₹${r2(acct.cash)}).`;
    if (reject) {
      await tx`UPDATE paper_orders SET status = 'REJECTED', reason = ${reject}, sessions_seen = ${r.sessionsSeen} WHERE id = ${o.id}`;
      outcome = "rejected";
      return;
    }
    await tx`UPDATE paper_accounts SET cash = cash + ${delta}, costs_paid = costs_paid + ${costs} WHERE user_id = ${o.user_id}`;
    await tx`INSERT INTO paper_positions (user_id, instrument, qty, avg_price, realized_pnl, updated_at) VALUES (${o.user_id}, ${p.key}, ${res.position.qty}, ${res.position.avg}, ${res.position.realized}, now())
             ON CONFLICT (user_id, instrument) DO UPDATE SET qty = EXCLUDED.qty, avg_price = EXCLUDED.avg_price, realized_pnl = EXCLUDED.realized_pnl, settled = false, updated_at = now()`;
    await tx`INSERT INTO paper_fills (user_id, order_id, instrument, side, qty, price, costs, realized, d) VALUES (${o.user_id}, ${o.id}, ${p.key}, ${o.side}, ${o.qty}, ${price}, ${costs}, ${res.realized}, ${d})`;
    await tx`UPDATE paper_orders SET status = 'FILLED', fill_price = ${price}, fill_d = ${d}, costs = ${costs}, sessions_seen = ${r.sessionsSeen} WHERE id = ${o.id}`;
  });
  await notify(sql, Number(o.user_id), { kind: "plan", d, title: `Paper ${o.side} ${o.qty} ${p.key} ${outcome}`, body: outcome === "filled" ? `Simulated fill at ${price} on ${d}. No real order was placed.` : `Simulated order rejected. No real order was placed.`, link: "/ai-intelligence/paper" });
  return outcome;
}

/** Settles F&O positions whose expiry has passed, at the expiry-day close of the underlying. */
export async function settleExpired(sql: Sql) {
  const rows = await sql<{ user_id: number; instrument: string; qty: number; avg_price: number; realized_pnl: number }[]>`
    SELECT user_id, instrument, qty, avg_price, realized_pnl FROM paper_positions WHERE qty <> 0 AND (instrument LIKE 'FUT:%' OR instrument LIKE 'OPT:%')`;
  let settled = 0;
  for (const r of rows) {
    const p = parseInstrument(r.instrument)!;
    const und = await underlyingCloseOn(sql, p.underlying, p.expiry!);
    if (!und) continue; // expiry-day close not loaded yet (or expiry still ahead)
    const value = settlementValue(p, und.c);
    const side = r.qty > 0 ? "SELL" : "BUY";
    const res = applyFill({ qty: r.qty, avg: r.avg_price, realized: r.realized_pnl }, side, Math.abs(r.qty), value);
    const delta = r2(cashDelta(p.kind, side, Math.abs(r.qty), value, res.realized));
    await sql.begin(async (tx) => {
      await tx`UPDATE paper_accounts SET cash = cash + ${delta} WHERE user_id = ${r.user_id}`;
      await tx`UPDATE paper_positions SET qty = 0, avg_price = 0, realized_pnl = ${res.position.realized}, settled = true, updated_at = now() WHERE user_id = ${r.user_id} AND instrument = ${r.instrument}`;
      await tx`INSERT INTO paper_fills (user_id, instrument, side, qty, price, realized, kind, d) VALUES (${r.user_id}, ${r.instrument}, ${side}, ${Math.abs(r.qty)}, ${value}, ${res.realized}, 'SETTLEMENT', ${und.d})`;
    });
    settled++;
  }
  return settled;
}

export async function runPaper(sql: Sql, deadline: number) {
  if (!(await paperAvailable(sql))) return null;
  const open = await sql<OrderRow[]>`SELECT * FROM paper_orders WHERE status = 'OPEN' ORDER BY created_at LIMIT 5000`;
  const counts = { filled: 0, rejected: 0, expired: 0, open: 0 };
  for (const o of open) {
    if (Date.now() > deadline) break;
    counts[await processOrder(sql, o)]++;
  }
  const settled = await settleExpired(sql);
  return { ...counts, settled };
}

/** Account summary with mark-to-market from the latest stored prices. */
export async function accountSummary(sql: Sql, userId: number) {
  const a = await account(sql, userId);
  const positions = await sql<{ instrument: string; qty: number; avg_price: number; realized_pnl: number; settled: boolean }[]>`SELECT instrument, qty, avg_price, realized_pnl, settled FROM paper_positions WHERE user_id = ${userId} ORDER BY updated_at DESC`;
  const rows = [];
  let unrealized = 0, marketValue = 0, realized = 0;
  for (const pos of positions) {
    const p = parseInstrument(pos.instrument)!;
    const last = pos.qty !== 0 ? await latestPrice(sql, p) : null;
    const mark = last?.price ?? null;
    const u = mark !== null ? r2((mark - pos.avg_price) * pos.qty) : null;
    if (u !== null) unrealized += u;
    if (mark !== null && p.kind !== "future") marketValue += mark * pos.qty;
    realized += pos.realized_pnl;
    rows.push({ instrument: pos.instrument, kind: p.kind, qty: pos.qty, avgPrice: r2(pos.avg_price), mark, markDate: last?.d ?? null, unrealized: u, realized: r2(pos.realized_pnl), settled: pos.settled, short: pos.qty < 0 });
  }
  const orders = await sql<{ id: number; instrument: string; side: string; qty: number; order_type: string; limit_price: number | null; placed_d: Date; status: string; fill_price: number | null; fill_d: Date | null; costs: number | null; reason: string | null }[]>`
    SELECT id, instrument, side, qty, order_type, limit_price, placed_d, status, fill_price, fill_d, costs, reason FROM paper_orders WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 100`;
  const fills = await sql<{ instrument: string; side: string; qty: number; price: number; costs: number; realized: number; kind: string; d: Date }[]>`
    SELECT instrument, side, qty, price, costs, realized, kind, d FROM paper_fills WHERE user_id = ${userId} ORDER BY id DESC LIMIT 100`;
  // Futures never debited their notional, so their open P&L is added on top of cash; equities and options
  // are valued at market (short positions count negative).
  const futuresOpen = rows.filter((x) => x.kind === "future").reduce((sum, x) => sum + (x.unrealized ?? 0), 0);
  const equity = r2(a.cash + marketValue + futuresOpen);
  return {
    account: { startingCash: a.starting_cash, cash: r2(a.cash), costsPaid: r2(a.costs_paid), marketValue: r2(marketValue), equity, realized: r2(realized), unrealized: r2(unrealized), totalPnl: r2(equity - a.starting_cash), since: (a.reset_at ?? a.created_at).toISOString() },
    positions: rows,
    orders: orders.map((o) => ({ id: Number(o.id), instrument: o.instrument, side: o.side, qty: o.qty, type: o.order_type, limit: o.limit_price, placedAfter: iso(o.placed_d), status: o.status, fillPrice: o.fill_price, fillDate: o.fill_d ? iso(o.fill_d) : null, costs: o.costs, reason: o.reason })),
    fills: fills.map((f) => ({ instrument: f.instrument, side: f.side, qty: f.qty, price: f.price, costs: f.costs, realized: f.realized, kind: f.kind, d: iso(f.d) })),
    basis: "Simulation on end-of-day data: equities fill at a later session's open, F&O at a later session's close. Margin is not simulated. No order is ever sent to a broker.",
  };
}
