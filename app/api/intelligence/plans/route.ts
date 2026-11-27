import { fail, json, userHandler } from "@/lib/api";
import { analyzeEquity, TIME_EXIT_SESSIONS, type Horizon } from "@/lib/intelligence/equity/setup";
import { monitorDb, requireFlag, symbolParam } from "@/lib/intelligence/http";
import { dailyBars, resolveInstrument } from "@/lib/intelligence/market-data/data";
import { HORIZONS } from "@/lib/intelligence/market-scan/config";
import { createPlan, listPlans, MonitorError } from "@/lib/intelligence/monitoring/store";
import { gate } from "@/lib/intelligence/present";

export const dynamic = "force-dynamic";
const STATUSES = ["WATCHING", "ACTIVE", "CLOSED", "EXPIRED", "INVALIDATED", "CANCELLED"];

/** The user's tracked paper plans. */
export const GET = userHandler(async ({ user, req }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const r = await monitorDb();
  if (r.error) return r.error;
  const status = new URL(req.url).searchParams.get("status");
  if (status && !STATUSES.includes(status)) return fail("unknown status");
  const g = gate();
  const plans = await listPlans(r.sql, user.id, { status });
  // Engine-origin levels are trade-plan levels: withheld unless actionable recommendations are enabled.
  return json({ ok: true, plans: plans.map((p) => (p.origin === "engine" && !g.actionable ? { ...p, plan: null, restricted: true } : p)) });
});

/**
 * Track a plan. Either `{ symbol, fromEngine: true, horizon }` (levels recomputed on the server by the
 * equity engine; needs actionable recommendations) or a manual plan `{ instrument, plan }` with the
 * user's own levels. Paper tracking only.
 */
export const POST = userHandler(async ({ user, body: raw }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const r = await monitorDb();
  if (r.error) return r.error;
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!body) return fail("JSON body required");
  try {
    if (body.fromEngine === true) {
      if (!gate().actionable) return fail("Tracking engine trade plans is restricted until actionable recommendations are approved.", 403);
      const symbol = symbolParam(typeof body.symbol === "string" ? body.symbol : null);
      if (!symbol) return fail("symbol required");
      const horizon = (HORIZONS as string[]).includes(String(body.horizon)) ? (body.horizon as Horizon) : "swing";
      const inst = await resolveInstrument(r.sql, `NSE:${symbol}`);
      if (!inst) return fail("Unknown NSE equity.", 404);
      const bars = await dailyBars(r.sql, `NSE:${symbol}`, 400);
      const s = analyzeEquity({ symbol, name: inst.name, sector: inst.industry, bars: bars.value, provenance: bars.provenance, horizon, constraints: { capital: 500_000, maxRiskPerTrade: 5_000, maxCapitalPerTrade: 100_000, minRewardRisk: 1.5, minLiquidity: 0 } });
      if (!s.entry || !s.stop || !s.targets[0] || !s.direction) return fail(`No trade plan to track: the engine's status is ${s.status}.`, 409);
      const id = await createPlan(r.sql, user.id, { instrument: `NSE:${symbol}`, origin: "engine", setup: s.setup, score: s.score?.total ?? null, plan: { direction: s.direction, entry: s.entry, stop: s.stop, target: s.targets[0].price, timeExitSessions: Math.max(1, TIME_EXIT_SESSIONS[horizon]), entryValidSessions: 5, costFraction: 0.0025 } });
      return json({ ok: true, id });
    }
    const p = body.plan as Record<string, unknown> | undefined;
    if (!p || typeof body.instrument !== "string") return fail("instrument and plan required");
    const entry = p.entry as { low?: unknown; high?: unknown } | undefined;
    const id = await createPlan(r.sql, user.id, {
      instrument: body.instrument.toUpperCase(), origin: "manual",
      plan: { direction: p.direction === "short" ? "short" : "long", entry: { low: Number(entry?.low), high: Number(entry?.high) }, stop: Number(p.stop), target: Number(p.target), timeExitSessions: Number(p.timeExitSessions ?? 10), entryValidSessions: Number(p.entryValidSessions ?? 5), costFraction: Number(p.costFraction ?? 0.0025) },
    });
    return json({ ok: true, id });
  } catch (e) {
    if (e instanceof MonitorError) return fail(e.message, e.status);
    throw e;
  }
});
