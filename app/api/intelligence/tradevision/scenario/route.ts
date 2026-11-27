import { fail, json, userHandler } from "@/lib/api";
import { requireFlag, symbolParam } from "@/lib/intelligence/http";
import { gate, RESTRICTED_NOTICE } from "@/lib/intelligence/present";
import { buildLegs } from "@/lib/intelligence/strategy/evaluate";
import { getStrategy } from "@/lib/intelligence/strategy/registry";
import { strategyInputs } from "@/lib/intelligence/strategy/server";
import { expectedMove } from "@/lib/intelligence/options/contract";
import { payoffCurves, riskIntelligence, scenarioGrid, type PosLeg } from "@/lib/intelligence/tradevision/scenarios";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Payoff-by-date, scenario grid and risk intelligence for one registry strategy at real strikes. */
export const GET = userHandler(async ({ user, req }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const p = new URL(req.url).searchParams;
  const u = symbolParam(p.get("u"));
  const def = getStrategy(p.get("strategy") ?? "");
  if (!u || !def) return fail("u and a registry strategy id are required");
  const expiry = p.get("expiry") ?? undefined;
  if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return fail("invalid expiry");
  const lots = Math.min(50, Math.max(1, Math.round(Number(p.get("lots")) || 1)));
  const src = await strategyInputs(user.id, u, expiry);
  if (!src) return fail("No option chain for this underlying.", 404);
  const near = src.inputs.near;
  const { legs, missing } = buildLegs(def, src.inputs);
  if (!near.lotSize) missing.push("lot size");
  if (!near.spot) missing.push("underlying price");
  if (missing.length) return json({ ok: true, status: "INSUFFICIENT DATA", missing, strategy: def.id });
  const qty = near.lotSize! * lots;
  const pos: PosLeg[] = legs.map((l) => ({ side: l.side, right: l.right, strike: l.strike, expiry: l.right === "FUT" ? null : l.expiry, qty: l.ratio * qty, entry: l.premium, iv: l.iv }));
  const fut = src.inputs.futures;
  const now = near.now ?? new Date();
  const inp = { legs: pos, spot: near.spot!, now, atmIv: expectedMove(near).atmIv, forwardBasis: fut && fut.expiry === near.expiry ? fut.price - near.spot! : null };
  const g = gate();
  return json({
    ok: true, status: "OK", strategy: { id: def.id, name: def.name, classification: def.classification, risk: def.risk }, underlying: u, expiry: near.expiry, spot: near.spot, lots, lotSize: near.lotSize, source: src.source, provenance: near.provenance,
    legs: g.actionable ? legs.map((l) => ({ side: l.side, right: l.right, strike: l.strike, expiry: l.expiry, ratio: l.ratio, premium: l.premium, iv: l.iv })) : null,
    notices: g.actionable ? [] : [RESTRICTED_NOTICE],
    curves: payoffCurves(inp), grid: scenarioGrid(inp), gridWeek: scenarioGrid(inp, undefined, undefined, 7), risk: riskIntelligence(inp),
    disclaimer: "Model estimates (theoretical prices), not quotes. No probability of profit is computed.",
  });
});
