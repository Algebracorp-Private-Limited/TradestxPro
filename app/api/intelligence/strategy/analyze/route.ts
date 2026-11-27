import { fail, json, userHandler } from "@/lib/api";
import { db } from "@/lib/db";
import { recordAnalysis } from "@/lib/intelligence/audit/store";
import { requireFlag, symbolParam, rateLimit } from "@/lib/intelligence/http";
import { underlyingContext } from "@/lib/intelligence/options/server";
import { gate, present } from "@/lib/intelligence/present";
import { rankStrategies } from "@/lib/intelligence/strategy/evaluate";
import { filterStrategies } from "@/lib/intelligence/strategy/registry";
import { strategyInputs } from "@/lib/intelligence/strategy/server";
import { applyStrategyValidation } from "@/lib/intelligence/validation/plans";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const num = (v: string | null, d: number, lo: number, hi: number) => (v !== null && Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

/**
 * Strategy AI for one underlying: every applicable registry strategy is built at real strikes and
 * evaluated deterministically (payoff, Greeks, liquidity, view fit), then ranked. BUY ONLY / SELL ONLY
 * restrict the registry before evaluation. Scores rank; they are not probabilities of profit.
 */
export const GET = userHandler(async ({ user, req }) => {
  const limited = rateLimit("strategy", user.id);
  if (limited) return limited;
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const p = new URL(req.url).searchParams;
  const u = symbolParam(p.get("u"));
  if (!u) return fail("u (underlying) is required");
  const expiry = p.get("expiry") ?? undefined;
  if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return fail("invalid expiry");
  const modeP = p.get("mode");
  const mode = modeP === "BUY_ONLY" || modeP === "SELL_ONLY" ? modeP : "ALL";
  const src = await strategyInputs(user.id, u, expiry);
  if (!src) return fail("No option chain for this underlying.", 404);
  const ctx = await underlyingContext(u);
  const capital = num(p.get("capital"), 500_000, 1_000, 1e10);
  const limits = { capital, maxRiskPerTrade: num(p.get("maxRisk"), 5_000, 1, capital) };
  const defs = filterStrategies({ mode, definedRiskOnly: p.get("definedRiskOnly") === "1", singleLegOnly: p.get("singleLegOnly") === "1", family: p.get("family") });
  const r0 = rankStrategies(defs, src.inputs, ctx, limits, { top: Math.round(num(p.get("top"), 15, 1, 50)) });
  // Independent validation (legs exist, lot size, recomputed maximum loss, risk constraints): failures are dropped and counted.
  const v = applyStrategyValidation(r0.ranked, src.inputs, { definedRiskOnly: p.get("definedRiskOnly") === "1" });
  const r = { ...r0, ranked: v.kept };
  const g = gate();
  await recordAnalysis(await db(), { userId: user.id, kind: "strategy-rank", target: `${u}:${src.inputs.near.expiry}:${mode}`, versions: { engine: "strategy.rank", engineVersion: "1", dataVersion: r.provenance.exchangeTime ?? "none" }, input: { mode, limits, candidates: defs.length }, output: { ids: r.ranked.map((x) => [x.id, x.score]) } }).catch(() => null);
  return json({
    ok: true, underlying: u, expiry: src.inputs.near.expiry, spot: src.inputs.near.spot, expiries: src.expiries, source: src.source, mode, context: ctx, futuresNote: src.futuresNote,
    candidates: defs.length, evaluated: r.evaluated, validationRejected: v.rejected, insufficient: r.insufficient, missingSample: r.missingSample, provenance: r.provenance,
    ranked: r.ranked.map((e) => present(e as unknown as Record<string, unknown>, g)),
    scoreNote: "Rank score 0–100 from view fit, risk definition and reward:risk, liquidity, breakeven reach and volatility fit. It is not a probability of profit.",
  });
});
