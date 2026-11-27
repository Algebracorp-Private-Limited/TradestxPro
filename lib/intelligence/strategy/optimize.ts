/**
 * Strategy optimisation: a bounded search over strike placement, width and expiry for one registry
 * strategy, keeping its structure (sides, rights, ratios, relative leg spacing). Each candidate is
 * evaluated by the same engine as Strategy AI and checked by the independent validator; candidates
 * that fail validation or the user's constraints are counted, not shown.
 *
 *   anchor shift  a ∈ [−maxShift, +maxShift] strikes (moves every option leg together)
 *   width scale   k ∈ 1…maxScale (multiplies the spacing between legs, in units of the base width)
 *   expiry        the near leg on each of the first `expiries` unexpired expiries (calendar legs keep
 *                 "next" = the following expiry)
 * The search is exhaustive inside these bounds (≤ 11 × 6 × 3 = 198 candidates by default).
 */
import type { UnderlyingContext } from "../options/contract.ts";
import type { ChainInput } from "../options/contract.ts";
import { validateStrategyEvaluation } from "../validation/plans.ts";
import { evaluateStrategy, type Evaluation } from "./evaluate.ts";
import { riskOf, type LegSpec, type StrategyDef } from "./registry.ts";

export type Objective = "score" | "rewardRisk" | "lowestMaxLoss" | "breakevenReach" | "credit";
export type OptimizeConstraints = { maxLossPerLot?: number | null; minRewardRisk?: number | null; definedRiskOnly?: boolean; maxBreakevenVsMove?: number | null };
export type Candidate = { anchor: number; scale: number; expiry: string; evaluation: Evaluation; objectiveValue: number };

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Builds the variant definition (not registered: it exists only for this evaluation). */
export function variant(def: StrategyDef, anchor: number, scale: number): StrategyDef {
  const offs = def.legs.filter((l) => l.right !== "FUT").map((l) => Math.abs(l.offset)).filter((o) => o > 0);
  const base = offs.length ? offs.reduce(gcd) : 1;
  // Offsets are whole multiples of the base width (the gcd), so scaled offsets stay on the strike ladder.
  const legs2: LegSpec[] = def.legs.map((l) => (l.right === "FUT" ? l : { ...l, offset: anchor + (l.offset / base) * scale }));
  return {
    ...def, id: `${def.id}~a${anchor}~k${scale}`, name: `${def.name} (shift ${anchor >= 0 ? "+" : ""}${anchor}, ×${scale})`, legs: legs2,
    risk: riskOf(legs2), multiExpiry: def.multiExpiry, usesFutures: def.usesFutures, legCount: def.legCount, classification: def.classification,
  };
}

function objectiveValue(e: Evaluation, o: Objective): number | null {
  switch (o) {
    case "score": return e.score;
    case "rewardRisk": return e.rewardRisk;
    case "lowestMaxLoss": return e.maxLoss === null ? null : e.maxLoss; // less negative is better
    case "breakevenReach": return e.breakevenVsExpectedMove === null ? null : -e.breakevenVsExpectedMove * (e.view === "Volatile" ? 1 : -1);
    case "credit": return e.netPremium === null ? null : -e.netPremium;
  }
}

export function optimizeStrategy(
  def: StrategyDef,
  chains: ChainInput[],
  futures: { price: number; expiry: string } | null,
  ctx: UnderlyingContext,
  limits: { maxRiskPerTrade: number; capital: number },
  opts: { objective?: Objective; constraints?: OptimizeConstraints; maxShift?: number; maxScale?: number; expiries?: number; top?: number; today?: string } = {},
) {
  const objective = opts.objective ?? "score";
  const c = opts.constraints ?? {};
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const sorted = chains.filter((x) => x.expiry > today).sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
  const nearList = sorted.slice(0, Math.max(1, Math.min(4, opts.expiries ?? 3)));
  const hasOffsets = def.legs.some((l) => l.right !== "FUT" && l.offset !== 0);
  const maxShift = Math.min(8, opts.maxShift ?? 5), maxScale = hasOffsets ? Math.min(8, opts.maxScale ?? 6) : 1;
  const kept: Candidate[] = [];
  const rejected = { insufficientData: 0, validation: 0, constraints: 0 };
  let evaluated = 0;
  for (const near of nearList) {
    const next = sorted[sorted.indexOf(near) + 1] ?? null;
    if (def.multiExpiry && !next) continue;
    for (let a = -maxShift; a <= maxShift; a++) for (let k = 1; k <= maxScale; k++) {
      const v = variant(def, a, k);
      const inp = { near, next, futures: futures && futures.expiry >= near.expiry ? futures : null };
      const e = evaluateStrategy(v, inp, ctx, limits, near.provenance);
      evaluated++;
      if (e.status !== "OK") { rejected.insufficientData++; continue; }
      if (!validateStrategyEvaluation(e, inp, { definedRiskOnly: c.definedRiskOnly }).ok) { rejected.validation++; continue; }
      const ml = e.maxLoss === null ? Infinity : -e.maxLoss;
      if ((c.definedRiskOnly && (e.risk === "undefined" || e.unlimitedLoss)) || (c.maxLossPerLot && ml > c.maxLossPerLot) || (c.minRewardRisk && (e.rewardRisk ?? 0) < c.minRewardRisk) || (c.maxBreakevenVsMove && e.breakevenVsExpectedMove !== null && e.breakevenVsExpectedMove > c.maxBreakevenVsMove)) {
        rejected.constraints++;
        continue;
      }
      const ov = objectiveValue(e, objective);
      if (ov === null) { rejected.constraints++; continue; }
      kept.push({ anchor: a, scale: k, expiry: near.expiry, evaluation: e, objectiveValue: ov });
    }
  }
  kept.sort((x, y) => y.objectiveValue - x.objectiveValue || (y.evaluation.score ?? 0) - (x.evaluation.score ?? 0));
  // Distinct leg sets only (different parameters can land on identical strikes at the ladder's edge).
  const seen = new Set<string>();
  const unique = kept.filter((k) => {
    const key = `${k.expiry}|${k.evaluation.legs.map((l) => `${l.side}${l.right}${l.strike}x${l.ratio}${l.expiry}`).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    strategy: { id: def.id, name: def.name, family: def.family }, objective, evaluated, eligible: unique.length, rejected,
    searchSpace: { anchors: 2 * maxShift + 1, scales: maxScale, expiries: nearList.map((x) => x.expiry) },
    best: unique.slice(0, Math.min(25, opts.top ?? 10)),
    note: "Exhaustive search inside the stated bounds. Every candidate is priced from the chain, evaluated by the strategy engine and checked by the independent validator. Scores rank; they are not probabilities.",
  };
}
