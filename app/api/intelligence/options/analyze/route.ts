import { fail, json, userHandler } from "@/lib/api";
import { analyzeContract } from "@/lib/intelligence/options/contract";
import { explainContract } from "@/lib/intelligence/options/explain";
import { chainFor, underlyingContext } from "@/lib/intelligence/options/server";
import { recordAnalysis } from "@/lib/intelligence/audit/store";
import { requireFlag, symbolParam } from "@/lib/intelligence/http";
import { intelligenceAI } from "@/lib/intelligence/server";
import { gate, present } from "@/lib/intelligence/present";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const num = (v: string | null, d: number, lo: number, hi: number) => (v !== null && Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

/** Detailed contract analysis (deterministic) + optional grounded AI explanation. */
export const GET = userHandler(async ({ user, req }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const p = new URL(req.url).searchParams;
  const u = symbolParam(p.get("u"));
  const strike = Number(p.get("strike"));
  const right = p.get("right");
  if (!u || !Number.isFinite(strike) || (right !== "CE" && right !== "PE")) return fail("u, strike and right (CE/PE) are required");
  const src = await chainFor(user.id, u, p.get("expiry") ?? undefined);
  if (!src) return fail("No option chain for this underlying.", 404);
  if (!src.chain.rows.some((r) => r.strike === strike && (right === "CE" ? r.ce : r.pe))) return fail("This contract does not exist in the chain.", 404);
  const ctx = await underlyingContext(u);
  const capital = num(p.get("capital"), 500_000, 1_000, 1e10);
  const a = analyzeContract(src.chain, strike, right, ctx, { capital, maxRiskPerTrade: num(p.get("maxRisk"), 5_000, 1, capital), minRewardRisk: num(p.get("minRR"), 1.5, 0.5, 10), maxSpreadPct: num(p.get("maxSpread"), 2, 0.05, 50), definedRiskOnly: p.get("definedRiskOnly") === "1" })!;
  const g = gate();
  let explanation = null;
  if (p.get("explain") === "1" && g.actionable) {
    const r = await explainContract(intelligenceAI(), a, user.id);
    explanation = { ...r.value, source: r.source, model: r.model, prompt: `${r.promptId}@${r.promptVersion}`, fallbackReason: r.fallbackReason ?? null };
  }
  const id = await recordAnalysis(await db(), { userId: user.id, kind: "option-contract", target: `${u}:${a.expiry}:${strike}:${right}`, versions: { engine: "options.contract", engineVersion: "1", dataVersion: a.provenance.exchangeTime ?? "none" }, input: { provenance: a.provenance }, output: { a, explanation } }).catch(() => null);
  return json({ ok: true, analysisId: id, source: src.source, analysis: { ...a, buy: present(a.buy as unknown as Record<string, unknown>, g), sell: present(a.sell as unknown as Record<string, unknown>, g) }, explanation: g.actionable ? explanation : null });
});
