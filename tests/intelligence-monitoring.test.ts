import test from "node:test";
import assert from "node:assert/strict";
import { advancePlan, initialState, validatePlan, type DayBar, type PlanLevels } from "../lib/intelligence/monitoring/lifecycle.ts";
import { calibration, tradeStats, wilson, type TradeResult } from "../lib/intelligence/backtest/stats.ts";
import { backtestEquity } from "../lib/intelligence/backtest/engine.ts";
import { alertHit, cancelPlan, createAlert, createPlan, listAlerts, listPlans, MonitorError, performance, planEvents, runMonitoring } from "../lib/intelligence/monitoring/store.ts";
import { freshDb, makeUser, noDbReason, scratchDb } from "./helpers/test-db.ts";

const long: PlanLevels = { direction: "long", entry: { low: 100, high: 102 }, stop: 96, target: 110, timeExitSessions: 5, entryValidSessions: 3, costFraction: 0.002 };
const b = (d: string, o: number, h: number, l: number, c: number): DayBar => ({ d, o, h, l, c });

// ---------------- Lifecycle ----------------
test("validatePlan rejects inconsistent levels", () => {
  assert.deepEqual(validatePlan(long), []);
  assert.ok(validatePlan({ ...long, stop: 101 }).length);
  assert.ok(validatePlan({ ...long, direction: "short" }).length);
  assert.ok(validatePlan({ ...long, timeExitSessions: 0 }).length);
  assert.ok(validatePlan({ ...long, entry: { low: 103, high: 102 } }).length);
});

test("lifecycle: entry fill rules, target exit, R and net R", () => {
  const { state, events } = advancePlan(long, initialState(), [b("d1", 105, 106, 103, 104), b("d2", 104, 104.5, 101, 103), b("d3", 103, 111, 102.5, 110.5)]);
  assert.equal(state.entryDate, "d2");
  assert.equal(state.entryPrice, 102, "open above the zone fills at the zone top");
  assert.equal(state.status, "CLOSED");
  assert.equal(state.exitReason, "TARGET");
  assert.equal(state.exitPrice, 110);
  assert.equal(state.r, 1.3333);
  assert.ok(state.netR! < state.r!);
  assert.deepEqual(events.map((e) => e.kind), ["ENTERED", "TARGET"]);
});

test("lifecycle: both stop and target in one bar counts as stop; gaps fill at the open", () => {
  const s1 = advancePlan(long, initialState(), [b("d1", 101, 101.5, 100.5, 101), b("d2", 101, 112, 95, 105)]).state;
  assert.equal(s1.exitReason, "STOP");
  assert.equal(s1.exitPrice, 96);
  const s2 = advancePlan(long, initialState(), [b("d1", 101, 101.5, 100.5, 101), b("d2", 94, 95, 93, 94)]).state;
  assert.equal(s2.exitPrice, 94, "gap below the stop exits at the open");
  const s3 = advancePlan(long, initialState(), [b("d1", 101, 101.5, 100.5, 101), b("d2", 113, 114, 112, 113)]).state;
  assert.equal(s3.exitPrice, 113, "gap above the target exits at the open");
  assert.equal(s3.exitReason, "TARGET");
});

test("lifecycle: invalidation, expiry, time exit, entry-bar stop, short plans", () => {
  assert.equal(advancePlan(long, initialState(), [b("d1", 95, 96, 94, 95)]).state.status, "INVALIDATED");
  assert.equal(advancePlan(long, initialState(), [b("d1", 105, 106, 103, 104), b("d2", 105, 106, 103, 104), b("d3", 105, 106, 103, 104)]).state.status, "EXPIRED");
  const t = advancePlan(long, initialState(), [b("d1", 101, 102, 100.5, 101), ...["d2", "d3", "d4", "d5", "d6"].map((d) => b(d, 103, 104, 102, 103.5))]).state;
  assert.equal(t.exitReason, "TIME_EXIT");
  assert.equal(t.exitDate, "d6");
  assert.equal(t.exitPrice, 103.5);
  const eb = advancePlan(long, initialState(), [b("d1", 101, 101.5, 95.5, 96)]).state;
  assert.equal(eb.exitReason, "STOP");
  assert.equal(eb.entryDate, "d1");
  const short: PlanLevels = { direction: "short", entry: { low: 100, high: 102 }, stop: 106, target: 92, timeExitSessions: 5, entryValidSessions: 3, costFraction: 0 };
  const sh = advancePlan(short, initialState(), [b("d1", 99, 100.5, 98, 99), b("d2", 99, 99.5, 91, 92)]).state;
  assert.equal(sh.entryPrice, 100);
  assert.equal(sh.exitReason, "TARGET");
  assert.equal(sh.r, 1.3333);
});

test("lifecycle is incremental: processing bars in two batches equals one batch", () => {
  const bars = [b("d1", 105, 106, 103, 104), b("d2", 104, 104.5, 101, 103), b("d3", 103, 105, 102.5, 104), b("d4", 104, 111, 103, 110)];
  const once = advancePlan(long, initialState(), bars).state;
  const a = advancePlan(long, initialState(), bars.slice(0, 2));
  const two = advancePlan(long, a.state, bars.slice(2)).state;
  assert.deepEqual(two, once);
});

// ---------------- Stats ----------------
const tr = (netR: number, score: number | null, date = "2026-01-01"): TradeResult => ({ date, score, setup: "X", exitReason: netR > 0 ? "TARGET" : "STOP", r: netR, netR, sessionsHeld: 3 });

test("stats: win rate, profit factor, drawdown, Wilson interval", () => {
  const s = tradeStats([tr(2, 70, "2026-01-01"), tr(-1, 60, "2026-01-02"), tr(-1, 60, "2026-01-03"), tr(1.5, 80, "2026-01-04")]);
  assert.equal(s.n, 4);
  assert.equal(s.winRatePct, 50);
  assert.equal(s.profitFactor, 1.75);
  assert.equal(s.maxDrawdownR, 2);
  assert.deepEqual(s.equityCurve.map((p) => p.cumR), [2, 1, 0, 1.5]);
  const w = wilson(5, 10)!;
  assert.ok(w[0] > 23.6 && w[0] < 23.7 && w[1] > 76.3 && w[1] < 76.4, String(w));
  assert.equal(tradeStats([]).n, 0);
});

test("calibration: buckets, small-sample handling and no probability claims", () => {
  const trades = [...Array.from({ length: 12 }, (_, i) => tr(i % 3 === 0 ? 1 : -1, 55)), ...Array.from({ length: 12 }, (_, i) => tr(i % 3 === 0 ? -1 : 1.5, 85))];
  const c = calibration(trades);
  assert.equal(c.rows.find((r) => r.bucket === "50–59")!.n, 12);
  assert.equal(c.monotonic, true);
  assert.match(c.note, /not a probability/);
  assert.equal(calibration(trades.slice(0, 3)).monotonic, null);
});

// ---------------- Backtest ----------------
function series(n: number, seed = 1) {
  let x = seed;
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  const out = [];
  let c = 100;
  for (let i = 0; i < n; i++) {
    c *= 1 + 0.0009 + (rnd() - 0.5) * 0.03;
    const o = c * (1 + (rnd() - 0.5) * 0.01);
    out.push({ t: Date.parse("2022-01-03T00:00:00Z") / 1000 + i * 86400, o, h: Math.max(o, c) * (1 + rnd() * 0.01), l: Math.min(o, c) * (1 - rnd() * 0.01), c, v: 1e6 });
  }
  return out;
}

test("backtest: no look-ahead (results on a prefix are unchanged by later bars), stats consistent", () => {
  const all = series(700);
  const full = backtestEquity("SYN", all, { step: 5 });
  assert.ok(full.evaluations > 50);
  assert.equal(full.stats.n, full.trades.length);
  for (const t of full.trades) assert.ok(t.exitDate >= t.date);
  const cut = full.trades[Math.floor(full.trades.length / 2)];
  if (cut) {
    // Trades that closed before the cut must be identical when later data is removed.
    const idx = all.findIndex((x) => new Date(x.t * 1000).toISOString().slice(0, 10) === cut.exitDate);
    const part = backtestEquity("SYN", all.slice(0, idx + 1), { step: 5 });
    const before = full.trades.filter((t) => t.exitDate <= cut.exitDate);
    assert.deepEqual(part.trades.slice(0, before.length), before);
  }
  assert.ok(full.limitations.length >= 4);
  assert.equal(full.truncated, false);
  const capped = backtestEquity("SYN", all, { step: 1, maxEvaluations: 20 });
  assert.equal(capped.truncated, true);
});

test("backtest: costs lower net R; trades do not overlap", () => {
  const all = series(700, 7);
  const a = backtestEquity("SYN", all, { costFraction: 0 }), c = backtestEquity("SYN", all, { costFraction: 0.01 });
  if (a.trades.length) assert.ok(c.trades[0].netR < c.trades[0].r);
  for (let i = 1; i < a.trades.length; i++) assert.ok(a.trades[i].date > a.trades[i - 1].exitDate);
});

test("alertHit conditions", () => {
  const bar = b("d", 100, 105, 95, 103);
  assert.equal(alertHit("close_above", 102, bar, null), 103);
  assert.equal(alertHit("close_below", 102, bar, null), null);
  assert.equal(alertHit("high_above", 104, bar, null), 105);
  assert.equal(alertHit("low_below", 96, bar, null), 95);
  assert.equal(alertHit("pct_change_above", 2, bar, 100), 3);
  assert.equal(alertHit("pct_change_below", -2, bar, 100), null);
  assert.equal(alertHit("pct_change_above", 2, bar, null), null);
});

// ---------------- Database ----------------
test("monitoring store: plans, events, alerts, daily job, isolation, performance", { skip: noDbReason }, async () => {
  const sql = await freshDb("intel_monitor");
  try {
    const days = ["2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"];
    await sql`INSERT INTO candles (series, d, o, h, l, c, v) VALUES ('NSE:ABC', ${days[0]}, 100, 101, 99, 100, 1000)`;
    const alice = await makeUser(sql, "alice@example.test"), bob = await makeUser(sql, "bob@example.test");
    const pid = await createPlan(sql, alice, { instrument: "NSE:ABC", origin: "manual", plan: { ...long } });
    await assert.rejects(createPlan(sql, alice, { instrument: "NSE:ABC", origin: "manual", plan: { ...long, stop: 150 } }), MonitorError);
    await assert.rejects(createPlan(sql, alice, { instrument: "<script>", origin: "manual", plan: long }), MonitorError);
    await assert.rejects(createPlan(sql, alice, { instrument: "NSE:NOPE", origin: "manual", plan: long }), (e: unknown) => e instanceof MonitorError && e.status === 404);
    const aid = await createAlert(sql, alice, { instrument: "NSE:ABC", condition: "close_above", threshold: 108, note: "<b>breakout</b>" });
    await createAlert(sql, bob, { instrument: "NSE:ABC", condition: "pct_change_below", threshold: -50 });
    await assert.rejects(createAlert(sql, alice, { instrument: "NSE:ABC", condition: "moon_phase_above", threshold: 70 }), MonitorError);

    // Nothing new yet.
    let r = await runMonitoring(sql);
    assert.equal(r.ok, true);
    // New sessions arrive: entry on day 2, target on day 4.
    await sql`INSERT INTO candles (series, d, o, h, l, c, v) VALUES ('NSE:ABC', ${days[1]}, 103, 104, 101, 102.5, 1000), ('NSE:ABC', ${days[2]}, 103, 106, 102, 105, 1000), ('NSE:ABC', ${days[3]}, 106, 111, 105, 109, 1000)`;
    r = await runMonitoring(sql);
    assert.ok(r.ok && r.plansAdvanced === 1);
    const [p] = await listPlans(sql, alice);
    assert.equal(p.id, pid);
    assert.equal(p.status, "CLOSED");
    assert.equal(p.state.exitReason, "TARGET");
    assert.equal(p.evaluatedThrough, days[3]);
    assert.deepEqual((await planEvents(sql, alice, pid)).map((e) => e.kind), ["CREATED", "ENTERED", "TARGET"]);
    await assert.rejects(planEvents(sql, bob, pid), (e: unknown) => e instanceof MonitorError && e.status === 404);
    assert.equal((await listPlans(sql, bob)).length, 0);

    const al = await listAlerts(sql, alice);
    assert.equal(al[0].id, aid);
    assert.equal(al[0].status, "TRIGGERED");
    assert.equal(al[0].triggeredOn, days[3]);
    assert.equal(al[0].note, "bbreakout/b", "markup stripped");
    assert.equal((await listAlerts(sql, bob))[0].status, "ACTIVE");

    // Idempotent: running again with no new bars changes nothing.
    await runMonitoring(sql);
    assert.equal((await planEvents(sql, alice, pid)).length, 3);

    const perf = await performance(sql, alice);
    assert.equal(perf.stats.n, 1);
    assert.equal(perf.bySource.manual.n, 1);
    assert.equal(perf.counts.CLOSED, 1);

    const p2 = await createPlan(sql, alice, { instrument: "NSE:ABC", origin: "manual", plan: { ...long, entry: { low: 120, high: 122 }, stop: 115, target: 130 } });
    assert.equal(await cancelPlan(sql, bob, p2), false);
    assert.equal(await cancelPlan(sql, alice, p2), true);
    assert.equal(await cancelPlan(sql, alice, p2), false);
  } finally {
    await sql.end();
  }
});

test("runMonitoring reports missing storage without migration 005", { skip: noDbReason }, async () => {
  const { sql } = await scratchDb("intel_monitor_nomig", { migrate: false });
  try {
    const r = await runMonitoring(sql);
    assert.equal(r.ok, false);
  } finally {
    await sql.end();
  }
});
