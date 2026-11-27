import { fail, json, userHandler } from "@/lib/api";
import { db } from "@/lib/db";
import { recordAnalysis } from "@/lib/intelligence/audit/store";
import { analyzeFutures } from "@/lib/intelligence/futures/analyze";
import { requireFlag, symbolParam } from "@/lib/intelligence/http";
import { eodFutures } from "@/lib/intelligence/market-data/data";
import { underlyingContext } from "@/lib/intelligence/options/server";
import { gate, presentFutures } from "@/lib/intelligence/present";

export const dynamic = "force-dynamic";
const num = (v: string | null, d: number, lo: number, hi: number) => (v !== null && Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

/** Futures AI for one underlying (latest-session NSE futures; EOD, so never an entry plan). */
export const GET = userHandler(async ({ user, req }) => {
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
  await recordAnalysis(sql, { userId: user.id, kind: "futures", target: u, versions: { engine: "futures.analyze", engineVersion: "1", dataVersion: f.provenance.exchangeTime ?? "none" }, input: { provenance: f.provenance }, output: { status: a.status, score: a.score } }).catch(() => null);
  return json({ ok: true, analysis: presentFutures(a as unknown as typeof a & { plan: Record<string, unknown> }, gate()), context: ctx });
});
