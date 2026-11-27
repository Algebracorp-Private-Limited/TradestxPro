/**
 * AI explanation of an equity setup. The model receives only the computed facts and must stay
 * grounded in them (numbers checked); otherwise the deterministic explanation is used.
 */
import { facts, registerPrompt, SHARED_RULES } from "../ai-providers/prompts.ts";
import type { AIClient, AIResult } from "../ai-providers/client.ts";
import type { JsonSchema } from "../core/schema.ts";
import { checkExplanation } from "../validation/grounding.ts";
import type { EquitySetup } from "./setup.ts";

export type Explanation = { summary: string; reasoning: string[]; risks: string[]; avoidIf: string[] };

const SCHEMA: JsonSchema = {
  type: "object", additionalProperties: false, required: ["summary", "reasoning", "risks", "avoidIf"],
  properties: {
    summary: { type: "string", maxLength: 600 },
    reasoning: { type: "array", maxItems: 6, items: { type: "string", maxLength: 400 } },
    risks: { type: "array", maxItems: 6, items: { type: "string", maxLength: 300 } },
    avoidIf: { type: "array", maxItems: 5, items: { type: "string", maxLength: 300 } },
  },
};

export const EQUITY_EXPLAIN = registerPrompt({
  id: "equity.explain",
  version: "1",
  system: `${SHARED_RULES}
Task: explain an equity trade setup that TradestXPro computed from end-of-day data. Explain why the setup was classified as it was, what must happen before entry (the confirmation), what invalidates it, and why a trader might avoid it. Keep the status exactly as given; do not upgrade it.`,
  render: (v) => facts(v),
  schema: SCHEMA,
  maxTokens: 1500,
});

/** Facts sent to the model: only computed values, no free text from outside sources. */
export function equityFacts(s: EquitySetup) {
  return {
    symbol: s.symbol, name: s.name, sector: s.sector, horizon: s.horizon, status: s.status, setup: s.setup, price: s.price, asOf: s.asOf, dataFreshness: s.freshness,
    regime: s.regime ? { primary: s.regime.primary, flags: s.regime.flags, confidence: s.regime.confidence, metrics: s.regime.metrics } : null,
    entry: s.entry, confirmation: s.confirmation, stop: s.stop, targets: s.targets, invalidation: s.invalidation, timeExit: s.timeExit,
    riskPerShare: s.riskPerShare, rewardPerShare: s.rewardPerShare, rewardRisk: s.rewardRisk, quantity: s.sizing?.quantity ?? null, plannedRisk: s.sizing?.plannedRisk ?? null,
    estimatedCosts: s.costs?.total ?? null, score: s.score?.total ?? null, scoreIsNotAProbability: true, reasonsToAvoid: s.reasonsToAvoid,
  };
}

export function deterministicExplanation(s: EquitySetup): Explanation {
  const r = s.regime;
  return {
    summary: s.entry
      ? `${s.name}: ${s.setup.toLowerCase()} in a ${r?.primary.toLowerCase() ?? "unclassified"} market. Status: ${s.status}. Entry ${s.entry.low}–${s.entry.high} only after: ${s.confirmation}`
      : `${s.name}: ${s.status}. ${s.reasonsToAvoid[0] ?? ""}`,
    reasoning: (r?.evidence ?? []).slice(0, 5).map((e) => e.detail),
    risks: [s.invalidation ? `Invalidation: ${s.invalidation}` : "", ...(r?.flags ?? []).map((f) => `Regime flag: ${f}`)].filter(Boolean),
    avoidIf: s.reasonsToAvoid.slice(0, 5),
  };
}

export async function explainEquity(ai: AIClient, s: EquitySetup, userId: number | null, fresh = false): Promise<AIResult<Explanation>> {
  const f = equityFacts(s);
  return ai.generate<Explanation>({ prompt: EQUITY_EXPLAIN, vars: f, userId, fresh, fallback: () => deterministicExplanation(s), check: (v) => checkExplanation(v, f) });
}
