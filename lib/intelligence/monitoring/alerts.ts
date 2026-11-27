/**
 * Alerts (all categories), notifications and the AI watchlist. Evaluated on end-of-day data by the
 * daily job; idempotent (each alert and watch item records the last date it processed).
 * Needs migration 005 for price alerts and 006 for the other categories, notifications and the watchlist;
 * without 006, only price alerts are accepted and no notifications are written.
 */
import type postgres from "postgres";
import { provenance } from "../core/freshness.ts";
import { analyzeEquity, type Horizon } from "../equity/setup.ts";
import { eodToChains } from "../options/inputs.ts";
import { expectedMove } from "../options/contract.ts";
import { applyEquityValidation } from "../validation/plans.ts";
import { conditionDef, describe, evaluateOi, evaluateSeries, validateCondition, type Bar } from "./conditions.ts";

type Sql = postgres.Sql;
const iso = (d: Date) => d.toISOString().slice(0, 10);

import { MonitorError } from "./errors.ts";
/** Alias kept for readability inside this module. */
const AlertError = MonitorError;

export async function extendedAvailable(sql: Sql): Promise<boolean> {
  const [r] = await sql<{ t: string | null }[]>`SELECT to_regclass('public.notifications')::text AS t`;
  return Boolean(r?.t);
}

async function seriesLast(sql: Sql, series: string): Promise<string | null> {
  const [r] = await sql<{ d: Date | null }[]>`SELECT max(d) AS d FROM candles WHERE series = ${series}`;
  return r?.d ? iso(r.d) : null;
}
async function bars(sql: Sql, series: string, limit = 320): Promise<Bar[]> {
  const rows = await sql<{ d: Date; o: number; h: number; l: number; c: number; v: number }[]>`SELECT d, o, h, l, c, v FROM (SELECT * FROM candles WHERE series = ${series} ORDER BY d DESC LIMIT ${limit}) x ORDER BY d`;
  return rows.map((r) => ({ d: iso(r.d), o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c), v: Number(r.v) }));
}
async function oiDays(sql: Sql, underlying: string): Promise<{ d: string; oi: number }[]> {
  const rows = await sql<{ d: Date; oi: number }[]>`SELECT d, sum(oi_qty)::float AS oi FROM fo_activity WHERE underlying = ${underlying} GROUP BY d ORDER BY d DESC LIMIT 60`;
  return rows.reverse().map((r) => ({ d: iso(r.d), oi: Number(r.oi) }));
}
/** ATM IV (%) of the nearest unexpired expiry in the latest F&O session, with that session's date. */
export async function atmIv(sql: Sql, underlying: string, today = new Date()): Promise<{ d: string; iv: number } | null> {
  const rows = await sql<Record<string, unknown>[]>`SELECT * FROM fo_contracts WHERE underlying = ${underlying} ORDER BY expiry, strike`;
  if (!rows.length) return null;
  const d = iso(rows[0].d as Date);
  const eod = rows.map((r) => ({ underlying, inst: String(r.inst), expiry: iso(r.expiry as Date), strike: Number(r.strike), right: r.opt as "CE" | "PE", close: Number(r.close), prevClose: null, underlyingPx: r.underlying_px === null ? null : Number(r.underlying_px), oi: Number(r.oi_qty), oiChange: Number(r.oi_chg_qty), contracts: Number(r.contracts), lot: Number(r.lot), d }));
  const prov = provenance({ source: "nse-fo-bhavcopy", kind: "eod-file", exchangeTime: d, entitlement: "public-eod", now: today });
  const evalAt = new Date(`${d}T14:00:00Z`);
  const chain = eodToChains(eod, prov, rows[0].inst === "IDO" ? "index" : "stock", evalAt).filter((c) => c.expiry > d).sort((a, b) => (a.expiry < b.expiry ? -1 : 1))[0];
  const iv = chain ? expectedMove(chain).atmIv : null;
  return iv ? { d, iv: Math.round(iv * 10000) / 100 } : null;
}

// ---------------- Notifications ----------------
export type NotificationKind = "alert" | "plan" | "watchlist";
export async function notify(sql: Sql, userId: number, n: { kind: NotificationKind; title: string; body: string; link?: string | null; d: string }) {
  if (!(await extendedAvailable(sql))) return;
  await sql`INSERT INTO notifications (user_id, kind, title, body, link, d) VALUES (${userId}, ${n.kind}, ${n.title.slice(0, 160)}, ${n.body.slice(0, 600)}, ${n.link ?? null}, ${n.d})`;
}
export async function listNotifications(sql: Sql, userId: number, limit = 100) {
  const rows = await sql<{ id: number; kind: string; title: string; body: string; link: string | null; d: Date; read_at: Date | null; created_at: Date }[]>`
    SELECT id, kind, title, body, link, d, read_at, created_at FROM notifications WHERE user_id = ${userId} ORDER BY created_at DESC, id DESC LIMIT ${Math.min(300, limit)}`;
  const [{ unread }] = await sql<{ unread: number }[]>`SELECT count(*)::int AS unread FROM notifications WHERE user_id = ${userId} AND read_at IS NULL`;
  return { unread, items: rows.map((r) => ({ id: Number(r.id), kind: r.kind, title: r.title, body: r.body, link: r.link, d: iso(r.d), read: r.read_at !== null, createdAt: r.created_at.toISOString() })) };
}
export async function unreadCount(sql: Sql, userId: number): Promise<number> {
  if (!(await extendedAvailable(sql))) return 0;
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${userId} AND read_at IS NULL`;
  return n;
}
export async function markRead(sql: Sql, userId: number, id: number | "all") {
  if (id === "all") await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${userId} AND read_at IS NULL`;
  else await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${userId} AND id = ${id} AND read_at IS NULL`;
}
export async function getSettings(sql: Sql, userId: number) {
  const [r] = await sql<{ email_alerts: boolean }[]>`SELECT email_alerts FROM notification_settings WHERE user_id = ${userId}`;
  return { emailAlerts: r?.email_alerts ?? false };
}
export async function setSettings(sql: Sql, userId: number, s: { emailAlerts: boolean }) {
  await sql`INSERT INTO notification_settings (user_id, email_alerts, updated_at) VALUES (${userId}, ${s.emailAlerts}, now())
            ON CONFLICT (user_id) DO UPDATE SET email_alerts = EXCLUDED.email_alerts, updated_at = now()`;
}

export type Digest = { userId: number; email: string; name: string; items: { title: string; body: string; d: string }[] };
/**
 * Sends one digest per opted-in user for notifications not yet e-mailed (at most 20 items listed).
 * `send` is injected (the route passes the mail service), so this module never reaches an e-mail
 * provider by itself and tests can observe what would be sent.
 */
export async function dispatchEmails(sql: Sql, send: (d: Digest) => Promise<void>, max = 200): Promise<{ users: number; failed: number }> {
  if (!(await extendedAvailable(sql))) return { users: 0, failed: 0 };
  const users = await sql<{ id: number; email: string; name: string }[]>`
    SELECT DISTINCT u.id, u.email, u.name FROM notifications n JOIN notification_settings s ON s.user_id = n.user_id AND s.email_alerts JOIN users u ON u.id = n.user_id
     WHERE n.emailed_at IS NULL LIMIT ${max}`;
  let failed = 0;
  for (const u of users) {
    const items = await sql<{ id: number; title: string; body: string; d: Date }[]>`SELECT id, title, body, d FROM notifications WHERE user_id = ${u.id} AND emailed_at IS NULL ORDER BY created_at, id`;
    try {
      await send({ userId: Number(u.id), email: u.email, name: u.name, items: items.slice(0, 20).map((i) => ({ title: i.title, body: i.body, d: iso(i.d) })) });
      await sql`UPDATE notifications SET emailed_at = now() WHERE id IN ${sql(items.map((i) => i.id))}`;
    } catch (e) {
      failed++;
      console.error("notification e-mail failed", u.id, (e as Error).message);
    }
  }
  return { users: users.length, failed };
}

// ---------------- Alerts ----------------
export async function createAlert(sql: Sql, userId: number, a: { instrument: string; condition: string; threshold: number; note?: string | null; repeat?: boolean; params?: unknown }, opts: { research?: boolean } = {}) {
  const def = conditionDef(a.condition);
  if (!def) throw new AlertError("unknown alert condition");
  const ext = await extendedAvailable(sql);
  if (def.category !== "price" && !ext) throw new AlertError("This alert type needs database migration 006 (not applied yet).", 503);
  if (def.category === "setup" && !opts.research) throw new AlertError("Engine setup alerts need the research feature.", 403);
  const v = validateCondition(a.instrument, a.condition, a.threshold, a.params);
  if (!v.ok) throw new AlertError(v.error);
  const note = typeof a.note === "string" ? a.note.replace(/[<>]/g, "").slice(0, 200) : null;
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM price_alerts WHERE user_id = ${userId} AND status = 'ACTIVE'`;
  if (n >= 200) throw new AlertError("You can have at most 200 active alerts.", 429);
  // Start point: the latest data already available, so only new sessions can trigger.
  let last: string | null;
  if (def.category === "oi" || def.category === "iv") {
    const u = a.instrument.slice(3);
    const [r] = def.category === "oi"
      ? await sql<{ d: Date | null }[]>`SELECT max(d) AS d FROM fo_activity WHERE underlying = ${u}`
      : await sql<{ d: Date | null }[]>`SELECT max(d) AS d FROM fo_contracts WHERE underlying = ${u}`;
    last = r?.d ? iso(r.d) : null;
    if (!last) throw new AlertError(`No F&O data for ${u}.`, 404);
  } else {
    last = await seriesLast(sql, a.instrument);
    if (!last) throw new AlertError("No price history for this instrument.", 404);
  }
  const [row] = ext
    ? await sql<{ id: number }[]>`INSERT INTO price_alerts (user_id, instrument, condition, threshold, note, repeat, last_evaluated, params) VALUES (${userId}, ${a.instrument}, ${a.condition}, ${a.threshold}, ${note}, ${Boolean(a.repeat)}, ${last}, ${sql.json(v.params as never)}) RETURNING id`
    : await sql<{ id: number }[]>`INSERT INTO price_alerts (user_id, instrument, condition, threshold, note, repeat, last_evaluated) VALUES (${userId}, ${a.instrument}, ${a.condition}, ${a.threshold}, ${note}, ${Boolean(a.repeat)}, ${last}) RETURNING id`;
  return Number(row.id);
}

export async function listAlerts(sql: Sql, userId: number) {
  const ext = await extendedAvailable(sql);
  const rows = await sql<{ id: number; instrument: string; condition: string; threshold: number; note: string | null; status: string; repeat: boolean; last_evaluated: Date | null; trigger_d: Date | null; trigger_value: number | null; seen: boolean; params: Record<string, unknown> | null }[]>`
    SELECT id, instrument, condition, threshold, note, status, repeat, last_evaluated, trigger_d, trigger_value, seen, ${ext ? sql`params` : sql`NULL::jsonb AS params`} FROM price_alerts WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 300`;
  return rows.map((r) => ({
    id: Number(r.id), instrument: r.instrument, condition: r.condition, category: conditionDef(r.condition)?.category ?? "price", threshold: r.threshold, params: r.params ?? {},
    description: describe(r.condition, r.threshold, r.params ?? {}), note: r.note, status: r.status, repeat: r.repeat,
    lastEvaluated: r.last_evaluated ? iso(r.last_evaluated) : null, triggeredOn: r.trigger_d ? iso(r.trigger_d) : null, triggerValue: r.trigger_value, unseen: r.trigger_d !== null && !r.seen,
  }));
}
export async function deleteAlert(sql: Sql, userId: number, id: number) {
  return (await sql`DELETE FROM price_alerts WHERE id = ${id} AND user_id = ${userId} RETURNING id`).length > 0;
}
export async function markAlertsSeen(sql: Sql, userId: number) {
  await sql`UPDATE price_alerts SET seen = true WHERE user_id = ${userId} AND trigger_d IS NOT NULL AND seen = false`;
}

type AlertRow = { id: number; user_id: number; instrument: string; condition: string; threshold: number; repeat: boolean; last_evaluated: Date | null; created_at: Date; params: Record<string, unknown> | null; note: string | null };

/** Evaluates one alert on data after its last evaluated date. Returns true when it processed new data. */
export async function evaluateAlert(sql: Sql, a: AlertRow): Promise<boolean> {
  const def = conditionDef(a.condition);
  if (!def) return false;
  const after = iso(a.last_evaluated ?? a.created_at);
  const params = a.params ?? {};
  let hits: { d: string; value: number }[] = [];
  let through: string | null = null;
  if (def.category === "price" || def.category === "technical") {
    const b = await bars(sql, a.instrument);
    if (!b.length || b.at(-1)!.d <= after) return false;
    hits = evaluateSeries(a.condition, a.threshold, params, b, after);
    through = b.at(-1)!.d;
  } else if (def.category === "oi") {
    const days = await oiDays(sql, a.instrument.slice(3));
    if (!days.length || days.at(-1)!.d <= after) return false;
    hits = evaluateOi(a.condition, a.threshold, days, after);
    through = days.at(-1)!.d;
  } else if (def.category === "iv") {
    const r = await atmIv(sql, a.instrument.slice(3));
    if (!r || r.d <= after) return false;
    if (a.condition === "atm_iv_above" ? r.iv > a.threshold : r.iv < a.threshold) hits = [{ d: r.d, value: r.iv }];
    through = r.d;
  } else {
    const sym = a.instrument.slice(4);
    const b = await bars(sql, a.instrument, 400);
    if (!b.length || b.at(-1)!.d <= after) return false;
    const d = b.at(-1)!.d;
    const prov = provenance({ source: "nse-equity-bhavcopy", kind: "eod-file", exchangeTime: d, entitlement: "public-eod" });
    const s = applyEquityValidation(analyzeEquity({ symbol: sym, name: sym, sector: null, bars: b.map((x) => ({ t: Date.parse(`${x.d}T00:00:00Z`) / 1000, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v })), provenance: prov, horizon: "swing", constraints: { capital: 1e6, maxRiskPerTrade: 1e4, maxCapitalPerTrade: 3e5, minRewardRisk: 1.5, minLiquidity: 0 } }), prov);
    const statuses = (params.statuses as string[] | undefined) ?? ["ENTER IF CONFIRMED", "WAIT FOR CONFIRMATION"];
    if (statuses.includes(s.status) && (s.score?.total ?? -1) >= a.threshold) hits = [{ d, value: s.score!.total }];
    through = d;
  }
  const first = hits[0];
  if (first) {
    const fired = a.repeat ? hits : [first];
    const last = fired.at(-1)!;
    await sql`UPDATE price_alerts SET status = ${a.repeat ? "ACTIVE" : "TRIGGERED"}, triggered_at = now(), trigger_d = ${last.d}, trigger_value = ${last.value}, seen = false, last_evaluated = ${a.repeat ? through : last.d} WHERE id = ${a.id}`;
    const label = a.instrument.replace(/^(NSE|NSEIDX|FO):/, "");
    for (const h of fired) {
      await notify(sql, Number(a.user_id), { kind: "alert", d: h.d, title: `${label}: ${describe(a.condition, a.threshold, params)}`, body: `Triggered on the ${h.d} close (value ${h.value}).${a.note ? ` Note: ${a.note}` : ""} Evaluated on end-of-day data.`, link: "/ai-intelligence/monitor?tab=alerts" });
    }
    return true;
  }
  await sql`UPDATE price_alerts SET last_evaluated = ${through} WHERE id = ${a.id} AND status = 'ACTIVE'`;
  return true;
}

export async function activeAlerts(sql: Sql, limit: number): Promise<AlertRow[]> {
  const ext = await extendedAvailable(sql);
  return sql<AlertRow[]>`SELECT id, user_id, instrument, condition, threshold, repeat, last_evaluated, created_at, note, ${ext ? sql`params` : sql`NULL::jsonb AS params`} FROM price_alerts WHERE status = 'ACTIVE' ORDER BY last_evaluated NULLS FIRST LIMIT ${limit}`;
}

// ---------------- AI watchlist ----------------
const SYMBOL = /^[A-Z0-9&.-]{1,30}$/;
const HORIZONS: Horizon[] = ["swing", "positional", "short-term-investment"];

export async function addWatch(sql: Sql, userId: number, symbol: string, horizon: string) {
  if (!(await extendedAvailable(sql))) throw new AlertError("The AI watchlist needs database migration 006 (not applied yet).", 503);
  const s = symbol.trim().toUpperCase();
  if (!SYMBOL.test(s)) throw new AlertError("invalid symbol");
  const h = (HORIZONS as string[]).includes(horizon) ? horizon : "swing";
  if (!(await seriesLast(sql, `NSE:${s}`))) throw new AlertError("No price history for this symbol.", 404);
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ai_watch_items WHERE user_id = ${userId}`;
  if (n >= 100) throw new AlertError("You can watch at most 100 symbols.", 429);
  const [r] = await sql<{ id: number }[]>`INSERT INTO ai_watch_items (user_id, symbol, horizon) VALUES (${userId}, ${s}, ${h}) ON CONFLICT (user_id, symbol, horizon) DO UPDATE SET symbol = EXCLUDED.symbol RETURNING id`;
  const [row] = await sql<WatchRow[]>`SELECT * FROM ai_watch_items WHERE id = ${r.id}`;
  await evaluateWatch(sql, row, { silent: true });
  return Number(r.id);
}
export async function removeWatch(sql: Sql, userId: number, id: number) {
  return (await sql`DELETE FROM ai_watch_items WHERE id = ${id} AND user_id = ${userId} RETURNING id`).length > 0;
}
export async function listWatch(sql: Sql, userId: number) {
  const rows = await sql<WatchRow[]>`SELECT * FROM ai_watch_items WHERE user_id = ${userId} ORDER BY last_score DESC NULLS LAST, symbol`;
  return rows.map((r) => ({ id: Number(r.id), symbol: r.symbol, horizon: r.horizon, status: r.last_status, score: r.last_score, setup: r.last_setup, evaluatedOn: r.last_eval_d ? iso(r.last_eval_d) : null, changedAt: r.changed_at?.toISOString() ?? null, setupDetail: r.payload }));
}

type WatchRow = { id: number; user_id: number; symbol: string; horizon: Horizon; last_status: string | null; last_score: number | null; last_setup: string | null; last_eval_d: Date | null; payload: Record<string, unknown> | null; changed_at: Date | null };
const ACTIONABLE_STATUSES = new Set(["ENTER IF CONFIRMED", "WAIT FOR CONFIRMATION"]);

/** Re-evaluates a watched symbol on the latest session; notifies when it newly reaches an entry status. */
export async function evaluateWatch(sql: Sql, w: WatchRow, opts: { silent?: boolean } = {}): Promise<boolean> {
  const b = await bars(sql, `NSE:${w.symbol}`, 400);
  if (!b.length) return false;
  const d = b.at(-1)!.d;
  if (w.last_eval_d && iso(w.last_eval_d) >= d) return false;
  const prov = provenance({ source: "nse-equity-bhavcopy", kind: "eod-file", exchangeTime: d, entitlement: "public-eod" });
  const s = applyEquityValidation(analyzeEquity({ symbol: w.symbol, name: w.symbol, sector: null, bars: b.map((x) => ({ t: Date.parse(`${x.d}T00:00:00Z`) / 1000, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v })), provenance: prov, horizon: w.horizon, constraints: { capital: 1e6, maxRiskPerTrade: 1e4, maxCapitalPerTrade: 3e5, minRewardRisk: 1.5, minLiquidity: 0 } }), prov);
  const changed = s.status !== w.last_status;
  await sql`UPDATE ai_watch_items SET last_status = ${s.status}, last_score = ${s.score?.total ?? null}, last_setup = ${s.setup}, last_eval_d = ${d}, payload = ${sql.json(s as never)}, changed_at = ${changed ? new Date() : w.changed_at} WHERE id = ${w.id}`;
  if (!opts.silent && changed && ACTIONABLE_STATUSES.has(s.status) && !ACTIONABLE_STATUSES.has(w.last_status ?? "")) {
    await notify(sql, Number(w.user_id), { kind: "watchlist", d, title: `${w.symbol}: ${s.setup} (${s.status})`, body: `The setup engine now rates ${w.symbol} "${s.status}" with score ${s.score?.total ?? "—"} (a rank, not a probability), on the ${d} close. Previously: ${w.last_status ?? "not evaluated"}.`, link: "/ai-intelligence/monitor?tab=watchlist" });
  }
  return true;
}
export async function watchItems(sql: Sql, limit: number): Promise<WatchRow[]> {
  if (!(await extendedAvailable(sql))) return [];
  return sql<WatchRow[]>`SELECT * FROM ai_watch_items ORDER BY last_eval_d NULLS FIRST LIMIT ${limit}`;
}
