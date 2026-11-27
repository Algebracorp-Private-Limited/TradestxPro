import { fail, json, userHandler } from "@/lib/api";
import { rateLimit, requireFlag, symbolParam } from "@/lib/intelligence/http";
import { underlyingContext } from "@/lib/intelligence/options/server";
import { gate, present } from "@/lib/intelligence/present";
import { optimizeStrategy, type Objective } from "@/lib/intelligence/strategy/optimize";
import { getStrategy } from "@/lib/intelligence/strategy/registry";
import { strategyInputs } from "@/lib/intelligence/strategy/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const OBJECTIVES: Objective[] = ["score", "rewardRisk", "lowestMaxLoss", "breakevenReach", "credit"];
const num = (v: string | null) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Strategy optimisation for one registry strategy: exhaustive search over strike shift, width and expiry
 * (bounded), each candidate evaluated and independently validated. Every candidate is validated
 * (validation/plans) inside optimizeStrategy; leg strikes are withheld unless actionable recommendations
 * are enabled.
 */
export const GET = userHandler(async ({ user, req }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const limited = rateLimit("strategy", user.id);
  if (limited) return limited;
  const p = new URL(req.url).searchParams;
  const u = symbolParam(p.get("u"));
  const def = getStrategy(p.get("strategy") ?? "");
  if (!u || !def) return fail("u and a registry strategy id are required");
  const objective = (OBJECTIVES as string[]).includes(p.get("objective") ?? "") ? (p.get("objective") as Objective) : "score";
  const src = await strategyInputs(user.id, u);
  if (!src) return fail("No option chain for this underlying.", 404);
  const chains = src.source === "broker" ? [src.inputs.near, ...(src.inputs.next ? [src.inputs.next] : [])] : await (async () => {
    const { chainFor } = await import("@/lib/intelligence/options/server");
    const c = await chainFor(user.id, u);
    return c?.eodChains ?? [src.inputs.near];
  })();
  const ctx = await underlyingContext(u);
  const maxRisk = Math.max(1, num(p.get("maxRisk")) ?? 5000);
  const r = optimizeStrategy(def, chains, src.inputs.futures ?? null, ctx, { maxRiskPerTrade: maxRisk, capital: Math.max(maxRisk * 20, 100000) }, {
    objective, expiries: num(p.get("expiries")) ?? 3, top: num(p.get("top")) ?? 10,
    constraints: { maxLossPerLot: num(p.get("maxLossPerLot")), minRewardRisk: num(p.get("minRR")), definedRiskOnly: p.get("definedRiskOnly") === "1", maxBreakevenVsMove: num(p.get("maxBeVsMove")) },
  });
  const g = gate();
  return json({ ok: true, underlying: u, source: src.source, provenance: src.inputs.near.provenance, ...r, best: r.best.map((c) => ({ ...c, evaluation: present(c.evaluation as unknown as Record<string, unknown>, g) })) });
});
