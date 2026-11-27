/**
 * Trade-plan tracking and price alerts (migration 005). All evaluation uses stored end-of-day bars
 * (`candles`), so outcomes are as of the latest completed session and labelled that way. Plans are paper
 * plans: nothing is sent to a broker.
 */
import type postgres from "postgres";
import { advancePlan, initialState, validatePlan, type DayBar, type PlanLevels, type PlanState } from "./lifecycle.ts";
import { tradeStats, calibration, type TradeResult } from "../backtest/stats.ts";

type Sql = postgres.Sql;
export class MonitorError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function monitoringAvailable(sql: Sql): Promise<boolean> {
  const [r] = await sql<{ t: string | null }[]>`SELECT to_regclass('public.trade_plans')::text AS t`;
  return Boolean(r?.t);
}

const INSTRUMENT = /^(NSE|NSEIDX):[A-Z0-9 &_.-]{1,40}$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function lastBarDate(sql: Sql, instrument: string): Promise<string | null> {
  const [r] = await sql<{ d: Date | null }[]>`SELECT max(d) AS d FROM candles WHERE series = ${instrument}`;
  return r?.d ? iso(r.d) : null;
}

async function barsAfter(sql: Sql, instrument: string, after: string, limit = 400): Promise<DayBar[]> {
  const rows = await sql<{ d: Date; o: number; h: number; l: number; c: number }[]>`SELECT d, o, h, l, c FROM candles WHERE series = ${instrument} AND d > ${after} ORDER BY d LIMIT ${limit}`;
  return rows.map((r) => ({ d: iso(r.d), o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c) }));
}

export type PlanInput = { instrument: string; origin: "engine" | "manual"; analysisId?: number | null; setup?: string | null; score?: number | null; plan: PlanLevels };

export async function createPlan(sql: Sql, userId: number, input: PlanInput) {
  if (!INSTRUMENT.test(input.instrument)) throw new MonitorError("instrument must look like NSE:SYMBOL or NSEIDX:INDEX");
  const errs = validatePlan(input.plan);
  if (errs.length) throw new MonitorError(errs.join("; "));
  const [{ open }] = await sql<{ open: number }[]>`SELECT count(*)::int AS open FROM trade_plans WHERE user_id = ${userId} AND status IN ('WATCHING', 'ACTIVE')`;
  if (open >= 100) throw new MonitorError("You can track at most 100 open plans.", 429);
  const start = await lastBarDate(sql, input.instrument);
  if (!start) throw new MonitorError("No price history for this instrument.", 404);
  const p = input.plan;
  const plan: PlanLevels = { direction: p.direction, entry: { low: p.entry.low, high: p.entry.high }, stop: p.stop, target: p.target, timeExitSessions: p.timeExitSessions, entryValidSessions: p.entryValidSessions, costFraction: p.costFraction };
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO trade_plans (user_id, instrument, origin, analysis_id, setup, score, plan, outcome, start_date, evaluated_through)
    VALUES (${userId}, ${input.instrument}, ${input.origin}, ${input.analysisId ?? null}, ${input.setup?.slice(0, 80) ?? null}, ${input.score ?? null}, ${sql.json(plan as never)}, ${sql.json(initialState() as never)}, ${start}, ${start}) RETURNING id`;
  await sql`INSERT INTO trade_plan_events (plan_id, d, kind, price, note) VALUES (${row.id}, ${start}, 'CREATED', null, ${`Tracking from the close of ${start} (paper plan; evaluated on end-of-day data)`})`;
  return Number(row.id);
}

type PlanRow = { id: number; user_id: number; instrument: string; origin: string; setup: string | null; score: number | null; plan: PlanLevels; status: string; outcome: PlanState; start_date: Date; evaluated_through: Date | null; created_at: Date };
const view = (r: PlanRow) => ({ id: Number(r.id), instrument: r.instrument, origin: r.origin, setup: r.setup, score: r.score, plan: r.plan, status: r.status, state: r.outcome, startDate: iso(r.start_date), evaluatedThrough: r.evaluated_through ? iso(r.evaluated_through) : null, createdAt: r.created_at.toISOString() });

export async function listPlans(sql: Sql, userId: number, opts: { status?: string | null; limit?: number } = {}) {
  const rows = await sql<PlanRow[]>`SELECT * FROM trade_plans WHERE user_id = ${userId} ${opts.status ? sql`AND status = ${opts.status}` : sql``} ORDER BY created_at DESC LIMIT ${Math.min(500, opts.limit ?? 200)}`;
  return rows.map(view);
}

export async function planEvents(sql: Sql, userId: number, planId: number) {
  const [own] = await sql<{ id: number }[]>`SELECT id FROM trade_plans WHERE id = ${planId} AND user_id = ${userId}`;
  if (!own) throw new MonitorError("Plan not found", 404);
  const rows = await sql<{ d: Date; kind: string; price: number | null; note: string }[]>`SELECT d, kind, price, note FROM trade_plan_events WHERE plan_id = ${planId} ORDER BY id`;
  return rows.map((r) => ({ d: iso(r.d), kind: r.kind, price: r.price, note: r.note }));
}

export async function cancelPlan(sql: Sql, userId: number, planId: number): Promise<boolean> {
  const rows = await sql`UPDATE trade_plans SET status = 'CANCELLED', updated_at = now() WHERE id = ${planId} AND user_id = ${userId} AND status IN ('WATCHING', 'ACTIVE') RETURNING id`;
  if (rows.length) await sql`INSERT INTO trade_plan_events (plan_id, d, kind, price, note) VALUES (${planId}, CURRENT_DATE, 'CANCELLED', null, 'Cancelled by you')`;
  return rows.length > 0;
}

/** Advances one plan over new bars (idempotent: only bars after evaluated_through are processed). */
export async function evaluatePlan(sql: Sql, r: PlanRow) {
  const after = iso(r.evaluated_through ?? r.start_date);
  const bars = await barsAfter(sql, r.instrument, after);
  if (!bars.length) return false;
  const { state, events } = advancePlan(r.plan, r.outcome ?? initialState(), bars);
  const through = state.status === "WATCHING" || state.status === "ACTIVE" ? bars.at(-1)!.d : (events.at(-1)?.d ?? bars.at(-1)!.d);
  await sql.begin(async (tx) => {
    for (const e of events) await tx`INSERT INTO trade_plan_events (plan_id, d, kind, price, note) VALUES (${r.id}, ${e.d}, ${e.kind}, ${e.price}, ${e.note})`;
    await tx`UPDATE trade_plans SET status = ${state.status}, outcome = ${tx.json(state as never)}, evaluated_through = ${through}, updated_at = now() WHERE id = ${r.id} AND status IN ('WATCHING', 'ACTIVE')`;
  });
  return true;
}

// ---------------- Alerts ----------------
export const ALERT_CONDITIONS = ["close_above", "close_below", "high_above", "low_below", "pct_change_above", "pct_change_below"] as const;
export type AlertCondition = (typeof ALERT_CONDITIONS)[number];

export async function createAlert(sql: Sql, userId: number, a: { instrument: string; condition: string; threshold: number; note?: string | null; repeat?: boolean }) {
  if (!INSTRUMENT.test(a.instrument)) throw new MonitorError("instrument must look like NSE:SYMBOL or NSEIDX:INDEX");
  if (!ALERT_CONDITIONS.includes(a.condition as AlertCondition)) throw new MonitorError("unknown alert condition");
  if (!Number.isFinite(a.threshold) || (a.condition.startsWith("pct") ? Math.abs(a.threshold) > 50 : a.threshold <= 0)) throw new MonitorError("threshold out of range");
  const note = typeof a.note === "string" ? a.note.replace(/[<>]/g, "").slice(0, 200) : null;
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM price_alerts WHERE user_id = ${userId} AND status = 'ACTIVE'`;
  if (n >= 200) throw new MonitorError("You can have at most 200 active alerts.", 429);
  const last = await lastBarDate(sql, a.instrument);
  if (!last) throw new MonitorError("No price history for this instrument.", 404);
  const [row] = await sql<{ id: number }[]>`INSERT INTO price_alerts (user_id, instrument, condition, threshold, note, repeat, last_evaluated) VALUES (${userId}, ${a.instrument}, ${a.condition}, ${a.threshold}, ${note}, ${Boolean(a.repeat)}, ${last}) RETURNING id`;
  return Number(row.id);
}

export async function listAlerts(sql: Sql, userId: number) {
  const rows = await sql<{ id: number; instrument: string; condition: string; threshold: number; note: string | null; status: string; repeat: boolean; last_evaluated: Date | null; triggered_at: Date | null; trigger_d: Date | null; trigger_value: number | null; seen: boolean }[]>`
    SELECT id, instrument, condition, threshold, note, status, repeat, last_evaluated, triggered_at, trigger_d, trigger_value, seen FROM price_alerts WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 300`;
  return rows.map((r) => ({ id: Number(r.id), instrument: r.instrument, condition: r.condition, threshold: r.threshold, note: r.note, status: r.status, repeat: r.repeat, lastEvaluated: r.last_evaluated ? iso(r.last_evaluated) : null, triggeredOn: r.trigger_d ? iso(r.trigger_d) : null, triggerValue: r.trigger_value, unseen: r.trigger_d !== null && !r.seen }));
}

export async function deleteAlert(sql: Sql, userId: number, id: number) {
  return (await sql`DELETE FROM price_alerts WHERE id = ${id} AND user_id = ${userId} RETURNING id`).length > 0;
}
export async function markAlertsSeen(sql: Sql, userId: number) {
  await sql`UPDATE price_alerts SET seen = true WHERE user_id = ${userId} AND trigger_d IS NOT NULL AND seen = false`;
}

/** Evaluates a condition on one bar (with the previous close for % change). Returns the trigger value or null. */
export function alertHit(condition: AlertCondition, threshold: number, bar: DayBar, prevClose: number | null): number | null {
  switch (condition) {
    case "close_above": return bar.c > threshold ? bar.c : null;
    case "close_below": return bar.c < threshold ? bar.c : null;
    case "high_above": return bar.h > threshold ? bar.h : null;
    case "low_below": return bar.l < threshold ? bar.l : null;
    case "pct_change_above": { if (!prevClose) return null; const p = ((bar.c - prevClose) / prevClose) * 100; return p > threshold ? Math.round(p * 100) / 100 : null; }
    case "pct_change_below": { if (!prevClose) return null; const p = ((bar.c - prevClose) / prevClose) * 100; return p < threshold ? Math.round(p * 100) / 100 : null; }
  }
}

type AlertRow = { id: number; instrument: string; condition: AlertCondition; threshold: number; repeat: boolean; last_evaluated: Date | null; created_at: Date };
async function evaluateAlert(sql: Sql, a: AlertRow) {
  const after = iso(a.last_evaluated ?? a.created_at);
  const [prev] = await sql<{ c: number }[]>`SELECT c FROM candles WHERE series = ${a.instrument} AND d <= ${after} ORDER BY d DESC LIMIT 1`;
  const bars = await barsAfter(sql, a.instrument, after, 60);
  if (!bars.length) return false;
  let prevClose = prev ? Number(prev.c) : null;
  for (const b of bars) {
    const v = alertHit(a.condition, a.threshold, b, prevClose);
    prevClose = b.c;
    if (v !== null) {
      await sql`UPDATE price_alerts SET status = ${a.repeat ? "ACTIVE" : "TRIGGERED"}, triggered_at = now(), trigger_d = ${b.d}, trigger_value = ${v}, seen = false, last_evaluated = ${b.d} WHERE id = ${a.id}`;
      if (!a.repeat) return true;
    }
  }
  await sql`UPDATE price_alerts SET last_evaluated = ${bars.at(-1)!.d} WHERE id = ${a.id} AND status = 'ACTIVE'`;
  return true;
}

/** Background job (daily after the EOD load): advances open plans and active alerts within a time budget. */
export async function runMonitoring(sql: Sql, opts: { deadlineMs?: number; limit?: number } = {}) {
  if (!(await monitoringAvailable(sql))) return { ok: false as const, note: "monitoring storage not migrated (005-trade-monitoring)" };
  const deadline = Date.now() + (opts.deadlineMs ?? 40_000);
  let plans = 0, alerts = 0;
  const open = await sql<PlanRow[]>`SELECT * FROM trade_plans WHERE status IN ('WATCHING', 'ACTIVE') ORDER BY evaluated_through NULLS FIRST LIMIT ${opts.limit ?? 2000}`;
  for (const r of open) {
    if (Date.now() > deadline) break;
    if (await evaluatePlan(sql, r)) plans++;
  }
  const act = await sql<AlertRow[]>`SELECT id, instrument, condition, threshold, repeat, last_evaluated, created_at FROM price_alerts WHERE status = 'ACTIVE' ORDER BY last_evaluated NULLS FIRST LIMIT ${opts.limit ?? 5000}`;
  for (const a of act) {
    if (Date.now() > deadline) break;
    if (await evaluateAlert(sql, a)) alerts++;
  }
  return { ok: true as const, plansAdvanced: plans, alertsEvaluated: alerts, openPlans: open.length, activeAlerts: act.length };
}

/** Performance of the user's closed paper plans (net R), with calibration by engine score. */
export async function performance(sql: Sql, userId: number) {
  const rows = await sql<PlanRow[]>`SELECT * FROM trade_plans WHERE user_id = ${userId} ORDER BY created_at`;
  const done = rows.filter((r) => r.status === "CLOSED" && typeof r.outcome?.netR === "number");
  const toTrade = (r: PlanRow): TradeResult => ({ date: r.outcome.exitDate ?? iso(r.start_date), score: r.score, setup: r.setup ?? (r.origin === "manual" ? "Manual" : "Engine"), exitReason: r.outcome.exitReason!, r: r.outcome.r!, netR: r.outcome.netR!, sessionsHeld: r.outcome.sessionsHeld });
  const closed = done.map(toTrade);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const engine = done.filter((r) => r.origin === "engine").map(toTrade);
  const bySource = { engine: tradeStats(engine), manual: tradeStats(done.filter((r) => r.origin === "manual").map(toTrade)) };
  return { counts, stats: tradeStats(closed), bySource, calibration: calibration(engine), basis: "Paper plans evaluated on end-of-day bars with the lifecycle fill rules; net of each plan's cost assumption. Not brokerage P&L." };
}
