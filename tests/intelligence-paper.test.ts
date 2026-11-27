import test from "node:test";
import assert from "node:assert/strict";
import { applyFill, cashDelta, parseInstrument, settlementValue, tryFill } from "../lib/intelligence/paper/engine.ts";
import { accountSummary, cancelOrder, placeOrder, resetAccount } from "../lib/intelligence/paper/store.ts";
import { runMonitoring, MonitorError } from "../lib/intelligence/monitoring/store.ts";
import { optimizeStrategy, variant } from "../lib/intelligence/strategy/optimize.ts";
import { getStrategy } from "../lib/intelligence/strategy/registry.ts";
import { provenance } from "../lib/intelligence/core/freshness.ts";
import { bsPrice } from "../lib/options/bs.ts";
import type { ChainInput, LegIn } from "../lib/intelligence/options/contract.ts";
import { freshDb, makeUser, noDbReason } from "./helpers/test-db.ts";

// ---------------- Paper engine (pure) ----------------
test("instrument parsing", () => {
  assert.equal(parseInstrument("nse:reliance")!.kind, "equity");
  assert.deepEqual(parseInstrument("OPT:NIFTY:2026-12-29:24000:CE"), { kind: "option", underlying: "NIFTY", expiry: "2026-12-29", strike: 24000, right: "CE", key: "OPT:NIFTY:2026-12-29:24000:CE" });
  assert.equal(parseInstrument("FUT:NIFTY:2026-12-29")!.kind, "future");
  for (const bad of ["NIFTY", "OPT:NIFTY:2026-12-29:24000:XX", "FUT:NIFTY:29-12-2026", "NSE:<script>"]) assert.equal(parseInstrument(bad), null, bad);
});

test("fill rules: only later sessions; equity market at open, limits at the better of open and limit; F&O at close", () => {
  const S = [{ d: "2026-01-01", o: 100, h: 101, l: 99, c: 100 }, { d: "2026-01-02", o: 103, h: 105, l: 97, c: 104 }, { d: "2026-01-05", o: 95, h: 96, l: 90, c: 92 }];
  const base = { placedD: "2026-01-01", validSessions: 5, sessionsSeen: 0 };
  assert.deepEqual(tryFill("equity", { ...base, side: "BUY", type: "MARKET", limit: null }, S).fill, { d: "2026-01-02", price: 103 });
  assert.deepEqual(tryFill("equity", { ...base, side: "BUY", type: "LIMIT", limit: 98 }, S).fill, { d: "2026-01-02", price: 98 });
  assert.deepEqual(tryFill("equity", { ...base, side: "BUY", type: "LIMIT", limit: 96 }, S).fill, { d: "2026-01-05", price: 95 }, "gap below the limit fills at the open");
  assert.deepEqual(tryFill("equity", { ...base, side: "SELL", type: "LIMIT", limit: 104 }, S).fill, { d: "2026-01-02", price: 104 });
  const none = tryFill("equity", { ...base, side: "BUY", type: "LIMIT", limit: 80, validSessions: 2 }, S);
  assert.equal(none.fill, null);
  assert.equal(none.expired, true);
  assert.deepEqual(tryFill("option", { ...base, side: "BUY", type: "MARKET", limit: null }, [{ d: "2026-01-02", o: null, h: null, l: null, c: 12.5 }]).fill, { d: "2026-01-02", price: 12.5 });
  assert.equal(tryFill("option", { ...base, side: "BUY", type: "LIMIT", limit: 12 }, [{ d: "2026-01-02", o: null, h: null, l: null, c: 12.5 }]).fill, null);
  assert.equal(tryFill("equity", { ...base, placedD: "2026-01-05", side: "BUY", type: "MARKET", limit: null }, S).fill, null, "no fill from data on or before placement");
});

test("position accounting: averaging, partial close, flip, realised P&L; cash and settlement", () => {
  let p = { qty: 0, avg: 0, realized: 0 };
  p = applyFill(p, "BUY", 10, 100).position;
  p = applyFill(p, "BUY", 10, 110).position;
  assert.deepEqual(p, { qty: 20, avg: 105, realized: 0 });
  const s1 = applyFill(p, "SELL", 5, 120);
  assert.equal(s1.realized, 75);
  assert.deepEqual(s1.position, { qty: 15, avg: 105, realized: 75 });
  const flip = applyFill(s1.position, "SELL", 25, 100);
  assert.equal(flip.realized, -75);
  assert.deepEqual(flip.position, { qty: -10, avg: 100, realized: 0 });
  const cover = applyFill(flip.position, "BUY", 10, 90);
  assert.equal(cover.realized, 100);
  assert.equal(cover.position.qty, 0);
  assert.equal(cashDelta("equity", "BUY", 10, 100, 0), -1000);
  assert.equal(cashDelta("option", "SELL", 50, 12, 0), 600);
  assert.equal(cashDelta("future", "SELL", 50, 24000, 2500), 2500, "futures move cash only by realised P&L");
  assert.equal(settlementValue(parseInstrument("OPT:X:2026-01-29:100:CE")!, 112), 12);
  assert.equal(settlementValue(parseInstrument("OPT:X:2026-01-29:100:PE")!, 112), 0);
  assert.equal(settlementValue(parseInstrument("FUT:X:2026-01-29")!, 112), 112);
});

// ---------------- Optimiser ----------------
const NOW = new Date("2026-11-18T05:30:00Z");
function chain(expiry: string, sigma = 0.15): ChainInput {
  const S = 24000, T = (Date.parse(`${expiry}T10:00:00Z`) - NOW.getTime()) / (365 * 86400e3);
  const leg = (K: number, right: "CE" | "PE"): LegIn => {
    const p = Math.max(0.05, bsPrice({ S, K, T, r: 0.065, sigma, right }));
    return { ltp: p, bid: p * 0.997, ask: p * 1.003, oi: 50000, oiChange: 0, volume: 1000, iv: null, delta: null, gamma: null, theta: null, vega: null, greeksSource: null };
  };
  const rows = [];
  for (let K = 22000; K <= 26000; K += 100) rows.push({ strike: K, ce: leg(K, "CE"), pe: leg(K, "PE") });
  const prov = provenance({ source: "nse-fo-bhavcopy", kind: "eod-file", exchangeTime: "2026-11-17", entitlement: "public-eod", now: NOW });
  return { underlying: "NIFTY", kind: "index", spot: S, expiry, lotSize: 75, rows, provenance: prov, now: NOW };
}

test("variant keeps structure: shift moves all legs, scale multiplies spacing", () => {
  const ic = getStrategy("iron-condor")!; // ±2 inner, ±4 wings
  const v = variant(ic, 1, 2);
  // Legs at ±2/±4 are 1 and 2 base widths (gcd 2): scale 2 restores the canonical spacing, shift +1 moves it.
  assert.deepEqual(v.legs.map((l) => l.offset), [3, 5, -1, -3]);
  assert.deepEqual(variant(ic, 0, 2).legs.map((l) => l.offset), ic.legs.map((l) => l.offset), "the canonical strategy is inside the search space");
  assert.deepEqual(variant(ic, 0, 1).legs.map((l) => l.offset), [1, 2, -1, -2], "scale 1 is the narrowest version");
  assert.deepEqual(v.legs.map((l) => `${l.side}${l.right}`), ic.legs.map((l) => `${l.side}${l.right}`));
  assert.equal(v.risk, "defined");
  assert.deepEqual(variant(getStrategy("long-call")!, -2, 3).legs.map((l) => l.offset), [-2]);
});

test("optimiser: exhaustive, validated, constraint-respecting, objective-sorted, distinct candidates", () => {
  const chains = [chain("2026-12-16"), chain("2026-12-30"), chain("2027-01-27")];
  const ctx = { direction: 0.6, regime: "Uptrend", atr: 220 };
  const r = optimizeStrategy(getStrategy("bull-call-spread")!, chains, null, ctx, { maxRiskPerTrade: 50_000, capital: 1e6 }, { objective: "rewardRisk", constraints: { maxLossPerLot: 15_000, minRewardRisk: 1, definedRiskOnly: true }, today: "2026-11-18" });
  assert.equal(r.evaluated, 11 * 6 * 3);
  assert.deepEqual(r.searchSpace.expiries, ["2026-12-16", "2026-12-30", "2027-01-27"]);
  assert.ok(r.best.length > 0);
  for (const c of r.best) {
    assert.ok(-(c.evaluation.maxLoss ?? -Infinity) <= 15_000, "max-loss constraint");
    assert.ok((c.evaluation.rewardRisk ?? 0) >= 1, "reward:risk constraint");
    assert.equal(c.evaluation.risk, "defined");
  }
  for (let i = 1; i < r.best.length; i++) assert.ok(r.best[i - 1].objectiveValue >= r.best[i].objectiveValue);
  const keys = r.best.map((c) => c.expiry + c.evaluation.legs.map((l) => l.strike).join(","));
  assert.equal(new Set(keys).size, keys.length, "distinct leg sets");
  assert.equal(r.evaluated, r.eligible + r.rejected.insufficientData + r.rejected.validation + r.rejected.constraints + (r.evaluated - r.eligible - r.rejected.insufficientData - r.rejected.validation - r.rejected.constraints));
  const cal = optimizeStrategy(getStrategy("long-call-calendar-aatm")!, chains, null, ctx, { maxRiskPerTrade: 50_000, capital: 1e6 }, { today: "2026-11-18" });
  assert.deepEqual(cal.searchSpace.expiries.length, 3);
  assert.ok(cal.best.every((c) => c.evaluation.legs.some((l) => l.expiry !== c.expiry)), "calendar keeps a later-expiry leg");
});

// ---------------- Paper trading on Postgres ----------------
const day = (i: number) => new Date(Date.UTC(2026, 0, 5) + i * 86400e3).toISOString().slice(0, 10);

test("paper trading: orders fill on later sessions, P&L and cash reconcile, shorts rules, expiry settlement, isolation", { skip: noDbReason }, async () => {
  const sql = await freshDb("intel_paper");
  try {
    const u = await makeUser(sql, "p@example.test"), other = await makeUser(sql, "o@example.test");
    await sql`INSERT INTO candles (series, d, o, h, l, c, v) VALUES ('NSE:ABC', ${day(0)}, 100, 101, 99, 100, 1e6), ('NSEIDX:NIFTY 50', ${day(0)}, 24000, 24100, 23900, 24000, 0)`;
    await sql`INSERT INTO fo_contracts (d, underlying, inst, expiry, strike, opt, close, prev_close, underlying_px, oi_qty, oi_chg_qty, contracts, lot) VALUES (${day(0)}, 'NIFTY', 'IDO', ${day(3)}, 24000, 'CE', 150, null, 24000, 1000, 0, 10, 75)`;

    await resetAccount(sql, u, 500_000);
    const eq = await placeOrder(sql, u, { instrument: "NSE:ABC", side: "BUY", qty: 100, type: "MARKET" });
    assert.equal(eq.placedAfter, day(0));
    await placeOrder(sql, u, { instrument: "OPT:NIFTY:" + day(3) + ":24000:CE", side: "BUY", qty: 75, type: "MARKET" });
    await assert.rejects(placeOrder(sql, u, { instrument: "OPT:NIFTY:" + day(3) + ":24000:CE", side: "BUY", qty: 70, type: "MARKET" }), /multiple of the lot size \(75\)/);
    await assert.rejects(placeOrder(sql, u, { instrument: "NSE:ABC", side: "SELL", qty: 10, type: "MARKET" }), /cannot be sold short/);
    await assert.rejects(placeOrder(sql, u, { instrument: "NSE:NOPE", side: "BUY", qty: 1, type: "MARKET" }), (e: unknown) => e instanceof MonitorError && e.status === 404);
    const lim = await placeOrder(sql, u, { instrument: "NSE:ABC", side: "BUY", qty: 10, type: "LIMIT", limit: 50, validSessions: 1 });

    // Nothing fills on the placement session.
    await runMonitoring(sql);
    assert.equal((await accountSummary(sql, u)).positions.length, 0);

    // Next session: equity opens at 102, option closes at 180.
    await sql`INSERT INTO candles (series, d, o, h, l, c, v) VALUES ('NSE:ABC', ${day(1)}, 102, 106, 101, 105, 1e6), ('NSEIDX:NIFTY 50', ${day(1)}, 24100, 24200, 24000, 24150, 0)`;
    await sql`UPDATE fo_contracts SET d = ${day(1)}, close = 180`;
    await runMonitoring(sql);
    let s = await accountSummary(sql, u);
    const pos = Object.fromEntries(s.positions.map((p) => [p.instrument, p]));
    assert.equal(pos["NSE:ABC"].qty, 100);
    assert.equal(pos["NSE:ABC"].avgPrice, 102);
    assert.equal(pos["NSE:ABC"].unrealized, 300, "marked at the latest close 105");
    assert.equal(pos[`OPT:NIFTY:${day(3)}:24000:CE`].avgPrice, 180);
    const costs = s.account.costsPaid;
    assert.ok(costs > 0, "costs charged");
    assert.equal(s.account.cash, Math.round((500_000 - 100 * 102 - 75 * 180 - costs) * 100) / 100);
    assert.equal(s.orders.find((o) => o.id === lim.id)!.status, "EXPIRED", "limit 50 not reached within 1 session");

    // Sell half the equity at a later session; then the option expires in the money.
    await placeOrder(sql, u, { instrument: "NSE:ABC", side: "SELL", qty: 50, type: "MARKET" });
    await sql`INSERT INTO candles (series, d, o, h, l, c, v) VALUES ('NSE:ABC', ${day(2)}, 110, 111, 108, 109, 1e6), ('NSEIDX:NIFTY 50', ${day(3)}, 24300, 24400, 24250, 24350, 0)`;
    await runMonitoring(sql);
    s = await accountSummary(sql, u);
    const p2 = Object.fromEntries(s.positions.map((p) => [p.instrument, p]));
    assert.equal(p2["NSE:ABC"].qty, 50);
    assert.equal(p2["NSE:ABC"].realized, 400, "(110 − 102) × 50");
    const opt = p2[`OPT:NIFTY:${day(3)}:24000:CE`];
    assert.equal(opt.qty, 0);
    assert.equal(opt.settled, true);
    assert.equal(opt.realized, (350 - 180) * 75, "settled at intrinsic 350 on the expiry-day index close");
    assert.ok(s.fills.some((f) => f.kind === "SETTLEMENT" && f.price === 350));
    // Reconciliation: equity = starting cash + realised + unrealised − costs.
    assert.ok(Math.abs(s.account.equity - (500_000 + s.account.realized + s.account.unrealized - s.account.costsPaid)) < 0.05, JSON.stringify(s.account));

    // Insufficient cash is rejected at fill time.
    await placeOrder(sql, u, { instrument: "NSE:ABC", side: "BUY", qty: 100_000, type: "MARKET" });
    await sql`INSERT INTO candles (series, d, o, h, l, c, v) VALUES ('NSE:ABC', ${day(4)}, 109, 110, 108, 109, 1e6)`;
    await runMonitoring(sql);
    assert.match((await accountSummary(sql, u)).orders[0].reason ?? "", /Insufficient paper cash/);

    // Isolation and cancel.
    assert.equal((await accountSummary(sql, other)).positions.length, 0);
    const o2 = await placeOrder(sql, u, { instrument: "NSE:ABC", side: "BUY", qty: 1, type: "LIMIT", limit: 1 });
    assert.equal(await cancelOrder(sql, other, o2.id), false);
    assert.equal(await cancelOrder(sql, u, o2.id), true);
    await resetAccount(sql, u, 100_000);
    const z = await accountSummary(sql, u);
    assert.deepEqual([z.positions.length, z.orders.length, z.account.cash], [0, 0, 100_000]);
  } finally {
    await sql.end();
  }
});
