/** AI investment thesis over computed fundamentals (grounded; deterministic fallback). */
import { facts, registerPrompt, SHARED_RULES, untrusted } from "../ai-providers/prompts.ts";
import type { AIClient, AIResult } from "../ai-providers/client.ts";
import type { JsonSchema } from "../core/schema.ts";
import { checkExplanation } from "../validation/grounding.ts";
import type { InvestmentAnalysis } from "./analysis.ts";

export type Thesis = { thesis: string; qualityAssessment: string; valuationAssessment: string; growthDrivers: string[]; risks: string[]; avoidIf: string[] };
const SCHEMA: JsonSchema = {
  type: "object", additionalProperties: false, required: ["thesis", "qualityAssessment", "valuationAssessment", "growthDrivers", "risks", "avoidIf"],
  properties: {
    thesis: { type: "string", maxLength: 800 }, qualityAssessment: { type: "string", maxLength: 600 }, valuationAssessment: { type: "string", maxLength: 600 },
    growthDrivers: { type: "array", maxItems: 5, items: { type: "string", maxLength: 300 } }, risks: { type: "array", maxItems: 6, items: { type: "string", maxLength: 300 } },
    avoidIf: { type: "array", maxItems: 5, items: { type: "string", maxLength: 300 } },
  },
};

export const INVESTMENT_EXPLAIN = registerPrompt({
  id: "investment.explain",
  version: "1",
  system: `${SHARED_RULES}
Task: write an investment research summary from computed fundamentals (ratios, multiples, DCF scenarios). Growth drivers may only cite trends visible in the numbers or in the company profile provided as untrusted data. Do not use technical indicators. State clearly when the margin of safety is negative or data is missing.`,
  render: (v) => `${facts(v.facts)}${v.profile ? `\n\n${untrusted("company profile", String(v.profile))}` : ""}`,
  schema: SCHEMA,
  maxTokens: 2000,
});

export function investmentFacts(a: InvestmentAnalysis) {
  return { symbol: a.symbol, name: a.name, asOf: a.asOf, price: a.price, latestPeriod: a.latestPeriod, quality: a.quality, multiples: a.multiples, historical: a.historical, peers: a.peers, dcf: a.dcf, marginOfSafety: a.marginOfSafety, reasonsToAvoid: a.reasonsToAvoid, missing: a.missing };
}

export function deterministicThesis(a: InvestmentAnalysis): Thesis {
  const q = a.quality, m = a.multiples;
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(1)}%`);
  return {
    thesis: a.status === "ANALYSED" ? `${a.name}: ${a.marginOfSafety !== null && a.marginOfSafety > 0 ? "trades below" : "does not trade below"} the base-case DCF value under the stated assumptions.` : `${a.name}: insufficient data for an investment view.`,
    qualityAssessment: q ? `ROE ${pct(q.returns.roe)}, ROCE ${pct(q.returns.roce)}, operating margin ${pct(q.margins.operating)}, cash conversion ${q.cash.cashConversion ?? "n/a"}.` : "Not available.",
    valuationAssessment: m ? `P/E ${m.pe ?? "n/a"}, EV/EBITDA ${m.evEbitda ?? "n/a"}, FCF yield ${pct(m.fcfYield)}; margin of safety ${pct(a.marginOfSafety)}.` : "Not available.",
    growthDrivers: q ? [`Revenue growth ${pct(q.growth.revenueYoY)} year on year${q.growth.revenueCagr3y !== null ? `, ${pct(q.growth.revenueCagr3y)} three-year CAGR` : ""}.`] : [],
    risks: q?.flags ?? [],
    avoidIf: a.reasonsToAvoid.slice(0, 5),
  };
}

export async function explainInvestment(ai: AIClient, a: InvestmentAnalysis, profile: string | null, userId: number | null): Promise<AIResult<Thesis>> {
  const f = investmentFacts(a);
  return ai.generate<Thesis>({ prompt: INVESTMENT_EXPLAIN, vars: { facts: f, profile }, userId, fallback: () => deterministicThesis(a), check: (v) => checkExplanation(v, { f, profile }) });
}
