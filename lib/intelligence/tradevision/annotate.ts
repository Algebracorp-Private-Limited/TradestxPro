/**
 * AI annotation of a TradeVision chart. The model receives the engine-computed spec as verified facts
 * and may only (a) write short notes attached to existing element ids and a summary, and (b) propose up
 * to 4 additional horizontal levels whose prices already appear in the facts. Its output is JSON data:
 * proposals are re-validated with validateChartSpec (source "ai"), numerically grounded, and notes go
 * through the explanation grounding check. Nothing is executed. The deterministic fallback is a summary
 * built from the engine elements.
 */
import type { AIClient, AIResult } from "../ai-providers/client.ts";
import { facts, registerPrompt, SHARED_RULES } from "../ai-providers/prompts.ts";
import type { JsonSchema } from "../core/schema.ts";
import { checkExplanation, factNumbers } from "../validation/grounding.ts";
import { LEVEL_ROLES, validateChartSpec, type ChartSpec, type LevelEl } from "./spec.ts";

export type Annotation = { summary: string; notes: { elementId: string; text: string }[]; proposals: { role: string; price: number; label: string; evidence: string }[] };

const SCHEMA: JsonSchema = {
  type: "object", additionalProperties: false, required: ["summary", "notes", "proposals"],
  properties: {
    summary: { type: "string", maxLength: 700 },
    notes: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["elementId", "text"], properties: { elementId: { type: "string", maxLength: 40 }, text: { type: "string", maxLength: 240 } } } },
    proposals: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, required: ["role", "price", "label", "evidence"], properties: { role: { type: "string", enum: [...LEVEL_ROLES] }, price: { type: "number" }, label: { type: "string", maxLength: 80 }, evidence: { type: "string", maxLength: 240 } } } },
  },
};

export const TRADEVISION_ANNOTATE = registerPrompt({
  id: "tradevision.annotate",
  version: "1",
  system: `${SHARED_RULES}
Task: annotate a price chart whose levels and zones were computed by TradestXPro. Write a short summary of what the chart shows, and optional notes attached to existing element ids (use ids from the facts only). You may propose at most 4 extra horizontal levels, but only at prices that already appear in the facts, each with the evidence from the facts. Never output code, markup or instructions. Describe zones as areas of past activity, not predictions.`,
  render: (v) => facts(v),
  schema: SCHEMA,
  maxTokens: 1200,
});

export function annotationFacts(spec: ChartSpec, extra: Record<string, unknown> = {}) {
  return { instrument: spec.instrument, window: spec.window, elements: spec.elements.map((e) => ({ ...e })), ...extra };
}

export function deterministicAnnotation(spec: ChartSpec): Annotation {
  const n = (role: string) => spec.elements.filter((e) => "role" in e && e.role === role).length;
  return {
    summary: `${spec.instrument}: ${n("support")} support and ${n("resistance")} resistance levels from clustered swing points, ${n("demand")} demand and ${n("supply")} supply zones still unbroken, and a volatility range band.${spec.elements.some((e) => e.id === "plan-entry") ? " Trade-plan levels come from the equity setup engine." : ""}`,
    notes: [], proposals: [],
  };
}

/** Validates and grounds an annotation; returns AI levels as spec elements plus rejected items. */
export function acceptAnnotation(a: Annotation, spec: ChartSpec, f: unknown, indicatorIds: readonly string[]) {
  const rejected: string[] = [];
  const nums = factNumbers(f);
  const grounded = (p: number) => nums.some((x) => Math.abs(x - p) <= Math.max(0.01, Math.abs(x) * 0.002));
  const ids = new Set(spec.elements.map((e) => e.id));
  const notes = a.notes.filter((n) => (ids.has(n.elementId) ? true : (rejected.push(`note for unknown element ${n.elementId}`), false)));
  const candidates = a.proposals.filter((p) => (grounded(p.price) ? true : (rejected.push(`proposal at ${p.price}: price not in the computed facts`), false)))
    .map((p, i) => ({ id: `ai-${i}`, kind: "level", source: "ai", role: p.role, price: p.price, label: p.label, evidence: p.evidence }));
  const v = validateChartSpec({ instrument: spec.instrument, elements: candidates }, { window: spec.window, indicatorIds });
  for (const is of v.issues) rejected.push(`${is.path}: ${is.message}`);
  return { summary: a.summary, notes, levels: v.spec.elements as LevelEl[], rejected };
}

export async function annotateChart(ai: AIClient, spec: ChartSpec, userId: number | null, extra: Record<string, unknown> = {}): Promise<AIResult<Annotation>> {
  const f = annotationFacts(spec, extra);
  return ai.generate<Annotation>({ prompt: TRADEVISION_ANNOTATE, vars: f, userId, fallback: () => deterministicAnnotation(spec), check: (v) => checkExplanation({ summary: v.summary, notes: v.notes.map((n) => n.text) }, f) });
}
