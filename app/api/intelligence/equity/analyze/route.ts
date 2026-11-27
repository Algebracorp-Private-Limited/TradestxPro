import { db } from "@/lib/db";
import { fail, json, userHandler } from "@/lib/api";
import { dailyBars, resolveInstrument } from "@/lib/intelligence/market-data/data";
import { analyzeEquity, type Horizon } from "@/lib/intelligence/equity/setup";
import { explainEquity } from "@/lib/intelligence/equity/explain";
import { HORIZONS } from "@/lib/intelligence/market-scan/config";
import { recordAnalysis } from "@/lib/intelligence/audit/store";
import { requireFlag, symbolParam } from "@/lib/intelligence/http";
import { intelligenceAI } from "@/lib/intelligence/server";
import { gate, present } from "@/lib/intelligence/present";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const num = (v: string | null, d: number, lo: number, hi: number) => {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Equity setup for one NSE stock: deterministic plan + (optional) grounded AI explanation. */
export const GET = userHandler(async ({ user, req }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const p = new URL(req.url).searchParams;
  const symbol = symbolParam(p.get("symbol"));
  if (!symbol) return fail("symbol is required");
  const horizon = (HORIZONS as string[]).includes(p.get("horizon") ?? "") ? (p.get("horizon") as Horizon) : "swing";
  const sql = await db();
  const inst = await resolveInstrument(sql, `NSE:${symbol}`);
  if (!inst) return fail("Unknown NSE equity.", 404);
  const bars = await dailyBars(sql, `NSE:${symbol}`, 400);
  const capital = num(p.get("capital"), 500_000, 1_000, 1e10);
  const setup = analyzeEquity({
    symbol, name: inst.name, sector: inst.industry, bars: bars.value, provenance: bars.provenance, horizon,
    constraints: { capital, maxRiskPerTrade: num(p.get("maxRisk"), 5_000, 1, capital), maxCapitalPerTrade: num(p.get("maxCapital"), 100_000, 100, capital), minRewardRisk: num(p.get("minRR"), 1.5, 0.5, 10), minLiquidity: num(p.get("minLiquidity"), 5e7, 0, 1e11) },
  });
  const g = gate();
  let explanation = null;
  if (p.get("explain") === "1" && g.actionable) {
    const r = await explainEquity(intelligenceAI(), setup, user.id, p.get("fresh") === "1");
    explanation = { ...r.value, source: r.source, model: r.model, prompt: `${r.promptId}@${r.promptVersion}`, fallbackReason: r.fallbackReason ?? null };
  }
  const analysisId = await recordAnalysis(sql, { userId: user.id, kind: "equity", target: `NSE:${symbol}`, versions: { engine: "equity.setup", engineVersion: "1", dataVersion: bars.provenance.exchangeTime ?? "none", promptId: explanation ? "equity.explain" : undefined, promptVersion: explanation ? "1" : undefined }, input: { horizon, provenance: bars.provenance }, output: { setup, explanation } }).catch(() => null);
  return json({ ok: true, analysisId, provenance: bars.provenance, setup: present({ ...setup, explanation } as unknown as Record<string, unknown>, g) });
});
