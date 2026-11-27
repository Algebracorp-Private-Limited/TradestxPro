import { fail, json, userHandler } from "@/lib/api";
import { db } from "@/lib/db";
import { recordAnalysis } from "@/lib/intelligence/audit/store";
import { analyzeFutures } from "@/lib/intelligence/futures/analyze";
import { requireFlag, symbolParam, rateLimit } from "@/lib/intelligence/http";
import { eodFutures } from "@/lib/intelligence/market-data/data";
import { underlyingContext } from "@/lib/intelligence/options/server";
import { gate, presentFutures } from "@/lib/intelligence/present";
import { validateEquityPlan, validateFreshness } from "@/lib/intelligence/validation/plans";

export const dynamic = "force-dynamic";
const num = (v: string | null, d: number, lo: number, hi: number) => (v !== null && Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

/** Futures AI for one underlying (latest-session NSE futures; EOD, so never an entry plan). */
export const GET = userHandler(async ({ user, req }) => {
  const limited = rateLimit("futures", user.id);
  if (limited) return limited;
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const p = new URL(req.url).searchParams;
  const u = symbolParam(p.get("u"));
  if (!u) return fail("u (underlying) is required");
  const sql = await db();
  const f = await eodFutures(sql, [u]);
  const ctx = await underlyingContext(u);
  const capital = num(p.get("capital"), 500_000, 1_000, 1e10);
  const a = analyzeFutures(u, f.value, ctx, f.value[0]?.underlyingPx ?? null, { capital, maxRiskPerTrade: num(p.get("maxRisk"), 5_000, 1, capital), maxCapitalPerTrade: capital, minRewardRisk: num(p.get("minRR"), 1.5, 0.5, 10) }, f.provenance);
  // Independent check of the futures plan (side relationships; entry statuses need real-time prices).
  if (a.plan.side && a.plan.entryTrigger && a.plan.stop && a.plan.target) {
    const v = validateEquityPlan({ status: a.status, direction: a.plan.side === "LONG" ? "long" : "short", entry: { low: a.plan.entryTrigger, high: a.plan.entryTrigger }, stop: a.plan.stop, targets: [{ price: a.plan.target }, ...(a.plan.target2 ? [{ price: a.plan.target2 }] : [])], price: a.near?.price ?? null }, f.provenance);
    const issues = [...v.issues, ...validateFreshness(a.status, f.provenance)];
    if (issues.length) Object.assign(a, { status: "INSUFFICIENT DATA", reasons: [...a.reasons, ...issues.map((i) => `validation: ${i}`)], plan: { ...a.plan, entryTrigger: null, stop: null, target: null, target2: null, sizing: null, costs: null } });
  }
  await recordAnalysis(sql, { userId: user.id, kind: "futures", target: u, versions: { engine: "futures.analyze", engineVersion: "1", dataVersion: f.provenance.exchangeTime ?? "none" }, input: { provenance: f.provenance }, output: { status: a.status, score: a.score } }).catch(() => null);
  return json({ ok: true, analysis: presentFutures(a as unknown as typeof a & { plan: Record<string, unknown> }, gate()), context: ctx });
});
