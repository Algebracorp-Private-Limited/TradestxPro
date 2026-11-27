import test from "node:test";
import assert from "node:assert/strict";
import { evaluateOi, evaluateSeries, validateCondition, describe, type Bar } from "../lib/intelligence/monitoring/conditions.ts";
import { addWatch, atmIv, createAlert, dispatchEmails, getSettings, listAlerts, listNotifications, listWatch, markRead, removeWatch, setSettings, unreadCount, type Digest } from "../lib/intelligence/monitoring/alerts.ts";
import { createPlan, MonitorError, runMonitoring } from "../lib/intelligence/monitoring/store.ts";
import { MIGRATIONS, MIGRATIONS_TABLE_SQL } from "../lib/migrations/index.ts";
import { freshDb, makeUser, noDbReason, scratchDb } from "./helpers/test-db.ts";
import { bsPrice } from "../lib/options/bs.ts";

const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86400e3).toISOString().slice(0, 10);
const mk = (closes: number[], vols?: number[]): Bar[] => closes.map((c, i) => ({ d: day(i), o: c, h: c + 1, l: c - 1, c, v: vols?.[i] ?? 1000 }));

// ---------------- Pure ----------------
test("condition validation: instrument formats, ranges, params, setup statuses", () => {
  assert.equal(validateCondition("NSE:ABC", "rsi_above", 70, {}).ok, true);
  assert.deepEqual((validateCondition("NSE:ABC", "rsi_above", 70, {}) as { params: unknown }).params, { length: 14 });
  assert.match((validateCondition("FO:NIFTY", "rsi_above", 70, {}) as { error: string }).error, /NSE:SYMBOL/);
  assert.match((validateCondition("NSE:ABC", "oi_change_pct_above", 10, {}) as { error: string }).error, /FO:UNDERLYING/);
  assert.equal(validateCondition("FO:NIFTY", "atm_iv_above", 20, {}).ok, true);
  assert.match((validateCondition("NSE:ABC", "rsi_above", 120, {}) as { error: string }).error, /between/);
  assert.match((validateCondition("NSE:ABC", "cross_above_sma", 20.5, {}) as { error: string }).error, /whole number/);
  assert.match((validateCondition("NSE:ABC", "rsi_below", 30, { length: 1 }) as { error: string }).error, /RSI length/);
  assert.equal(validateCondition("NSEIDX:NIFTY 50", "setup_signal", 60, {}).ok, false, "setup alerts are for equities only");
  const s = validateCondition("NSE:ABC", "setup_signal", 60, { statuses: ["WATCHLIST", "BUY NOW"] });
  assert.ok(s.ok && JSON.stringify(s.params) === JSON.stringify({ statuses: ["WATCHLIST"] }));
  assert.equal(validateCondition("NSE:ABC", "telepathy", 1, {}).ok, false);
});

test("series evaluation: only bars after the start date; crosses fire once on the crossing bar", () => {
  const closes = [...Array(30).fill(100), 99, 98, 97, 105, 106, 107];
  const b = mk(closes);
  const x = evaluateSeries("cross_above_sma", 5, {}, b, day(29));
  assert.deepEqual(x.map((h) => h.d), [day(33)], "the bar closing above the SMA after closing below it");
  assert.deepEqual(evaluateSeries("cross_above_sma", 5, {}, b, day(33)), [], "already processed bars do not fire again");
  assert.deepEqual(evaluateSeries("close_above", 105.5, {}, b, day(0)).map((h) => h.d), [day(34), day(35)]);
  const rsiUp = evaluateSeries("rsi_above", 70, { length: 14 }, mk(Array.from({ length: 40 }, (_, i) => 100 + i)), day(30));
  assert.ok(rsiUp.length > 0 && rsiUp.every((h) => h.value > 70));
  const vols = [...Array(25).fill(1000), 5000];
  assert.deepEqual(evaluateSeries("volume_spike", 3, {}, mk(Array(26).fill(100), vols), day(20)).map((h) => [h.d, h.value]), [[day(25), 5]]);
  assert.deepEqual(evaluateSeries("pct_change_below", -2, {}, mk([100, 97]), day(0)).map((h) => h.value), [-3]);
});

test("OI evaluation and descriptions", () => {
  const days = [{ d: day(0), oi: 100 }, { d: day(1), oi: 120 }, { d: day(2), oi: 90 }];
  assert.deepEqual(evaluateOi("oi_change_pct_above", 10, days, day(0)), [{ d: day(1), value: 20 }]);
  assert.deepEqual(evaluateOi("oi_change_pct_below", -10, days, day(1)), [{ d: day(2), value: -25 }]);
  assert.equal(describe("rsi_below", 30, { length: 9 }), "RSI(9) below 30");
  assert.match(describe("setup_signal", 60, { statuses: ["ENTER IF CONFIRMED"] }), /score ≥ 60/);
});

// ---------------- Database ----------------
async function seed(sql: Awaited<ReturnType<typeof freshDb>>, n: number, f: (i: number) => number, series = "NSE:ABC", vol = (_: number) => 1e6) {
  const rows = Array.from({ length: n }, (_, i) => ({ series, d: day(i), o: f(i), h: f(i) * 1.01, l: f(i) * 0.99, c: f(i), v: vol(i) }));
  await sql`INSERT INTO candles ${sql(rows)}`;
}

test("alerts of every category trigger on new sessions, write notifications, and e-mail only opted-in users", { skip: noDbReason }, async () => {
  const sql = await freshDb("intel_alerts");
  try {
    const alice = await makeUser(sql, "alice@example.test"), bob = await makeUser(sql, "bob@example.test");
    await seed(sql, 60, () => 100);
    // OI history and an option chain for FO:XYZ.
    await sql`INSERT INTO fo_activity (d, underlying, inst, oi_qty) VALUES (${day(58)}, 'XYZ', 'STO', 1000), (${day(59)}, 'XYZ', 'STO', 1000)`;
    const T = (Date.UTC(2026, 3, 1) - Date.UTC(2026, 0, 1) - 59 * 86400e3) / (365 * 86400e3);
    const chain = (d: string, sigma: number) => Array.from({ length: 11 }, (_, k) => 90 + k * 2).flatMap((K) => (["CE", "PE"] as const).map((o) => ({ d, underlying: "XYZ", inst: "STO", expiry: "2026-04-01", strike: K, opt: o, close: Math.max(0.05, bsPrice({ S: 100, K, T, r: 0.065, sigma, right: o })), prev_close: null, underlying_px: 100, oi_qty: 100, oi_chg_qty: 0, contracts: 10, lot: 100 })));
    await sql`INSERT INTO fo_contracts ${sql(chain(day(59), 0.2))}`;

    const ids = {
      cross: await createAlert(sql, alice, { instrument: "NSE:ABC", condition: "cross_above_sma", threshold: 20 }),
      vol: await createAlert(sql, alice, { instrument: "NSE:ABC", condition: "volume_spike", threshold: 3 }),
      oi: await createAlert(sql, alice, { instrument: "FO:XYZ", condition: "oi_change_pct_above", threshold: 15 }),
      iv: await createAlert(sql, alice, { instrument: "FO:XYZ", condition: "atm_iv_above", threshold: 30 }),
      bobs: await createAlert(sql, bob, { instrument: "NSE:ABC", condition: "close_above", threshold: 1000 }),
    };
    await assert.rejects(createAlert(sql, alice, { instrument: "NSE:ABC", condition: "setup_signal", threshold: 50 }), (e: unknown) => e instanceof MonitorError && e.status === 403, "setup alerts need research");
    const setupId = await createAlert(sql, alice, { instrument: "NSE:ABC", condition: "setup_signal", threshold: 0, params: { statuses: ["WATCHLIST", "WAIT FOR CONFIRMATION", "ENTER IF CONFIRMED"] } }, { research: true });
    assert.ok(setupId > 0, "setup alerts are accepted with research enabled");
    await assert.rejects(createAlert(sql, alice, { instrument: "FO:NOPE", condition: "atm_iv_above", threshold: 20 }), (e: unknown) => e instanceof MonitorError && e.status === 404);
    const iv0 = await atmIv(sql, "XYZ", new Date(`${day(59)}T14:00:00Z`));
    assert.ok(iv0 && Math.abs(iv0.iv - 20) < 1, `ATM IV ${iv0?.iv}`);

    // Nothing new yet → no triggers.
    await runMonitoring(sql);
    assert.equal((await listNotifications(sql, alice)).items.length, 0);

    // New session: price jumps above the SMA on a 5× volume day; OI +30%; a richer option chain (IV ≈ 40%).
    await sql`INSERT INTO candles (series, d, o, h, l, c, v) VALUES ('NSE:ABC', ${day(60)}, 100, 112, 99, 110, 5e6)`;
    await sql`INSERT INTO fo_activity (d, underlying, inst, oi_qty) VALUES (${day(60)}, 'XYZ', 'STO', 1300)`;
    await sql`DELETE FROM fo_contracts`;
    await sql`INSERT INTO fo_contracts ${sql(chain(day(60), 0.4))}`;
    const r = await runMonitoring(sql);
    assert.equal(r.ok, true);
    const al = Object.fromEntries((await listAlerts(sql, alice)).map((a) => [a.id, a]));
    for (const k of ["cross", "vol", "oi", "iv"] as const) assert.equal(al[ids[k]].status, "TRIGGERED", k);
    assert.equal(al[ids.vol].triggerValue, 5);
    assert.equal(al[ids.oi].triggerValue, 30);
    const notes = await listNotifications(sql, alice);
    assert.equal(notes.items.filter((n) => n.kind === "alert" && /^ABC|^XYZ/.test(n.title)).length >= 4, true, JSON.stringify(notes.items.map((n) => n.title)));
    assert.equal(notes.unread, notes.items.length);
    assert.equal((await listNotifications(sql, bob)).items.length, 0, "bob's alert did not trigger and alice's notifications are not his");
    assert.equal((await listAlerts(sql, bob))[0].status, "ACTIVE");

    // Idempotent.
    await runMonitoring(sql);
    assert.equal((await listNotifications(sql, alice)).items.length, notes.items.length);

    // E-mail: only opted-in users, once.
    const sent: Digest[] = [];
    assert.deepEqual(await getSettings(sql, alice), { emailAlerts: false });
    assert.deepEqual(await dispatchEmails(sql, async (d) => { sent.push(d); }), { users: 0, failed: 0 });
    await setSettings(sql, alice, { emailAlerts: true });
    const res = await dispatchEmails(sql, async (d) => { sent.push(d); });
    assert.deepEqual(res, { users: 1, failed: 0 });
    assert.equal(sent[0].email, "alice@example.test");
    assert.ok(sent[0].items.length >= 4);
    assert.deepEqual(await dispatchEmails(sql, async (d) => { sent.push(d); }), { users: 0, failed: 0 }, "not sent twice");
    // A failing sender leaves items for the next run.
    await sql`INSERT INTO notifications (user_id, kind, title, body, d) VALUES (${alice}, 'alert', 't', 'b', ${day(60)})`;
    assert.deepEqual(await dispatchEmails(sql, async () => { throw new Error("provider down"); }), { users: 1, failed: 1 });
    assert.deepEqual(await dispatchEmails(sql, async () => {}), { users: 1, failed: 0 });

    await markRead(sql, alice, notes.items[0].id);
    assert.equal(await unreadCount(sql, alice), notes.items.length);
    await markRead(sql, bob, "all");
    assert.equal(await unreadCount(sql, alice), notes.items.length, "bob cannot mark alice's notifications");
    await markRead(sql, alice, "all");
    assert.equal(await unreadCount(sql, alice), 0);
  } finally {
    await sql.end();
  }
});

test("AI watchlist: evaluated on add, re-evaluated per session, notifies on transition into an entry status; plan events notify", { skip: noDbReason }, async () => {
  const sql = await freshDb("intel_watch");
  try {
    const u = await makeUser(sql, "w@example.test"), other = await makeUser(sql, "o@example.test");
    // 300 bars of a steady uptrend with gentle pullbacks (synthetic).
    await seed(sql, 300, (i) => 100 * Math.exp(i * 0.004) * (1 + 0.012 * Math.sin(i / 3)));
    const id = await addWatch(sql, u, "abc", "swing");
    let w = (await listWatch(sql, u))[0];
    assert.equal(w.symbol, "ABC");
    assert.ok(w.status, "evaluated immediately");
    assert.equal(w.evaluatedOn, day(299));
    await assert.rejects(addWatch(sql, u, "NOPE", "swing"), (e: unknown) => e instanceof MonitorError && e.status === 404);
    assert.equal((await listWatch(sql, other)).length, 0);
    assert.equal(await removeWatch(sql, other, id), false, "other users cannot remove it");

    // Force a transition: pretend the last status was NO TRADE, then add a session.
    await sql`UPDATE ai_watch_items SET last_status = 'NO TRADE', last_eval_d = ${day(298)} WHERE id = ${id}`;
    const r = await runMonitoring(sql);
    assert.ok(r.ok && r.watchEvaluated === 1);
    w = (await listWatch(sql, u))[0];
    const n = (await listNotifications(sql, u)).items;
    if (["ENTER IF CONFIRMED", "WAIT FOR CONFIRMATION"].includes(w.status!)) {
      assert.equal(n.filter((x) => x.kind === "watchlist").length, 1);
      assert.match(n[0].body, /not a probability/);
    } else assert.equal(n.filter((x) => x.kind === "watchlist").length, 0);

    // Plan events create notifications.
    await createPlan(sql, u, { instrument: "NSE:ABC", origin: "manual", plan: { direction: "long", entry: { low: 1, high: 1e6 }, stop: 0.5, target: 2e6, timeExitSessions: 1, entryValidSessions: 5, costFraction: 0 } });
    // Entry on the next session; the 1-session time exit closes it on the session after that.
    for (const i of [300, 301]) await sql`INSERT INTO candles (series, d, o, h, l, c, v) SELECT 'NSE:ABC', ${day(i)}, c, c, c, c, 1e6 FROM candles WHERE series = 'NSE:ABC' AND d = ${day(299)}`;
    await runMonitoring(sql);
    const kinds = (await listNotifications(sql, u)).items.filter((x) => x.kind === "plan").map((x) => x.title);
    assert.ok(kinds.some((t) => /entered/.test(t)) && kinds.some((t) => /time exit/.test(t)), JSON.stringify(kinds));
    assert.equal(await removeWatch(sql, u, id), true);
  } finally {
    await sql.end();
  }
});

test("without migration 006 only price alerts work and no notifications are written", { skip: noDbReason }, async () => {
  const { sql } = await scratchDb("intel_alerts_005", { migrate: false });
  try {
    await sql.unsafe(MIGRATIONS_TABLE_SQL);
    for (const m of MIGRATIONS.filter((x) => x.id < "006")) await sql.unsafe(m.sql);
    const u = await makeUser(sql, "x@example.test");
    await seed(sql, 30, () => 100);
    await assert.rejects(createAlert(sql, u, { instrument: "NSE:ABC", condition: "rsi_above", threshold: 70 }), (e: unknown) => e instanceof MonitorError && e.status === 503);
    await assert.rejects(addWatch(sql, u, "ABC", "swing"), (e: unknown) => e instanceof MonitorError && e.status === 503);
    const id = await createAlert(sql, u, { instrument: "NSE:ABC", condition: "close_above", threshold: 105 });
    await sql`INSERT INTO candles (series, d, o, h, l, c, v) VALUES ('NSE:ABC', ${day(30)}, 100, 111, 99, 110, 1000)`;
    const r = await runMonitoring(sql);
    assert.ok(r.ok);
    const a = (await listAlerts(sql, u)).find((x) => x.id === id)!;
    assert.equal(a.status, "TRIGGERED");
    assert.equal(await unreadCount(sql, u), 0);
  } finally {
    await sql.end();
  }
});
