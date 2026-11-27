/**
 * Trade-plan tracking and price alerts (migration 005). All evaluation uses stored end-of-day bars
 * (`candles`), so outcomes are as of the latest completed session and labelled that way. Plans are paper
 * plans: nothing is sent to a broker.
 */
import type postgres from "postgres";
import { advancePlan, initialState, validatePlan, type DayBar, type PlanLevels, type PlanState } from "./lifecycle.ts";
import { tradeStats, calibration, type TradeResult } from "../backtest/stats.ts";
import { activeAlerts, dispatchEmails, evaluateAlert, evaluateWatch, notify, watchItems, type Digest } from "./alerts.ts";
import { evaluateSeries } from "./conditions.ts";

type Sql = postgres.Sql;
export { MonitorError } from "./errors.ts";
import { MonitorError } from "./errors.ts";

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
  const label = r.instrument.replace(/^(NSE|NSEIDX):/, "");
  for (const e of events) await notify(sql, Number(r.user_id), { kind: "plan", d: e.d, title: `${label} plan: ${e.kind.toLowerCase().replace("_", " ")}`, body: `${e.note}. Paper plan evaluated on end-of-day data.`, link: "/ai-intelligence/monitor?tab=plans" });
  return true;
}

// ---------------- Alerts, notifications, AI watchlist (monitoring/alerts.ts) ----------------
export { createAlert, listAlerts, deleteAlert, markAlertsSeen } from "./alerts.ts";
export { CONDITION_IDS as ALERT_CONDITIONS } from "./conditions.ts";

/** Evaluates a price condition on one bar (kept for callers of the 4G API). */
export function alertHit(condition: string, threshold: number, bar: DayBar, prevClose: number | null): number | null {
  const prev = { d: "0000-00-00", o: prevClose ?? bar.o, h: prevClose ?? bar.h, l: prevClose ?? bar.l, c: prevClose ?? NaN, v: 0 };
  if (prevClose === null && condition.startsWith("pct")) return null;
  const hits = evaluateSeries(condition, threshold, {}, [prev, { ...bar, v: 0 }], "0000-00-00");
  return hits[0]?.value ?? null;
}

/**
 * Background job (daily after the EOD load): advances open plans, evaluates active alerts and the AI
 * watchlist within a time budget, then sends e-mail digests to opted-in users when `email` is given.
 */
export async function runMonitoring(sql: Sql, opts: { deadlineMs?: number; limit?: number; email?: (d: Digest) => Promise<void> } = {}) {
  if (!(await monitoringAvailable(sql))) return { ok: false as const, note: "monitoring storage not migrated (005-trade-monitoring)" };
  const deadline = Date.now() + (opts.deadlineMs ?? 40_000);
  let plans = 0, alerts = 0, watched = 0;
  const open = await sql<PlanRow[]>`SELECT * FROM trade_plans WHERE status IN ('WATCHING', 'ACTIVE') ORDER BY evaluated_through NULLS FIRST LIMIT ${opts.limit ?? 2000}`;
  for (const r of open) {
    if (Date.now() > deadline) break;
    if (await evaluatePlan(sql, r)) plans++;
  }
  const act = await activeAlerts(sql, opts.limit ?? 5000);
  for (const a of act) {
    if (Date.now() > deadline) break;
    if (await evaluateAlert(sql, a)) alerts++;
  }
  const w = await watchItems(sql, opts.limit ?? 5000);
  for (const it of w) {
    if (Date.now() > deadline) break;
    if (await evaluateWatch(sql, it)) watched++;
  }
  const emails = opts.email ? await dispatchEmails(sql, opts.email) : null;
  return { ok: true as const, plansAdvanced: plans, alertsEvaluated: alerts, watchEvaluated: watched, openPlans: open.length, activeAlerts: act.length, watchItems: w.length, emails };
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
