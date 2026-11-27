/** AI explanation of an option-contract analysis (grounded; deterministic fallback). */
import { facts, registerPrompt, SHARED_RULES } from "../ai-providers/prompts.ts";
import type { AIClient, AIResult } from "../ai-providers/client.ts";
import type { JsonSchema } from "../core/schema.ts";
import { checkExplanation } from "../validation/grounding.ts";
import type { ContractAnalysis } from "./contract.ts";

export type ContractExplanation = { buyAssessment: string; sellAssessment: string; strikeChoice: string; expiryChoice: string; risks: string[]; waitOrAvoid: string };
const SCHEMA: JsonSchema = {
  type: "object", additionalProperties: false, required: ["buyAssessment", "sellAssessment", "strikeChoice", "expiryChoice", "risks", "waitOrAvoid"],
  properties: {
    buyAssessment: { type: "string", maxLength: 600 }, sellAssessment: { type: "string", maxLength: 600 }, strikeChoice: { type: "string", maxLength: 500 },
    expiryChoice: { type: "string", maxLength: 400 }, risks: { type: "array", maxItems: 6, items: { type: "string", maxLength: 300 } }, waitOrAvoid: { type: "string", maxLength: 400 },
  },
};

export const CONTRACT_EXPLAIN = registerPrompt({
  id: "options.contract",
  version: "1",
  system: `${SHARED_RULES}
Task: explain an option-contract analysis. Answer: is it suitable for buying, for selling, should the user wait for the stated underlying confirmation or avoid it, is another strike or expiry preferable (only those listed in the facts) and why, and the principal risks. Keep underlying price levels, option premium levels and expiry payoff clearly separate. Keep each plan's status exactly as given. Never describe short options as low risk.`,
  render: (v) => facts(v),
  schema: SCHEMA,
  maxTokens: 1800,
});

export function contractFacts(a: ContractAnalysis) {
  return { contract: `${a.underlying} ${a.expiry} ${a.strike} ${a.right}`, spot: a.spot, lotSize: a.lotSize, metrics: a.metrics, expectedMove: a.expectedMove, view: a.view, buy: a.buy, sell: a.sell, alternatives: a.alternatives.slice(0, 4), preferred: a.preferred, ivRankNote: a.ivRankNote, dataFreshness: a.provenance.freshness, labels: a.labels };
}

export function deterministicContractExplanation(a: ContractAnalysis): ContractExplanation {
  return {
    buyAssessment: `Buying: ${a.buy.status}. ${a.buy.reasons[0] ?? ""}`.trim(),
    sellAssessment: `Selling: ${a.sell.status}. ${a.sell.reasons[0] ?? ""}`.trim(),
    strikeChoice: a.preferred ? `Strike ${a.preferred.strike} ranks higher: ${a.preferred.reason}.` : "No alternative strike in this expiry ranks clearly higher.",
    expiryChoice: `${a.metrics.daysToExpiry} days to expiry; compare expiries in Chain Intelligence.`,
    risks: [...a.sell.disclosures.slice(0, 2), ...(a.metrics.thetaPctPerDay !== null ? [`Time decay about ${a.metrics.thetaPctPerDay}% of the premium per day.`] : [])],
    waitOrAvoid: a.buy.underlyingConfirmation ? `Wait for: ${a.buy.underlyingConfirmation}.` : "Insufficient data for a plan.",
  };
}

export async function explainContract(ai: AIClient, a: ContractAnalysis, userId: number | null): Promise<AIResult<ContractExplanation>> {
  const f = contractFacts(a);
  return ai.generate<ContractExplanation>({ prompt: CONTRACT_EXPLAIN, vars: f, userId, fallback: () => deterministicContractExplanation(a), check: (v) => checkExplanation(v, f) });
}
