import { db } from "@/lib/db";
import { fail, json, userHandler } from "@/lib/api";
import { recordAnalysis } from "@/lib/intelligence/audit/store";
import { analyzeEquity, type Horizon } from "@/lib/intelligence/equity/setup";
import { requireFlag, symbolParam } from "@/lib/intelligence/http";
import { dailyBars, resolveInstrument } from "@/lib/intelligence/market-data/data";
import { HORIZONS } from "@/lib/intelligence/market-scan/config";
import { gate, RESTRICTED_NOTICE } from "@/lib/intelligence/present";
import { intelligenceAI } from "@/lib/intelligence/server";
import { acceptAnnotation, annotateChart, annotationFacts } from "@/lib/intelligence/tradevision/annotate";
import { validateChartSpec } from "@/lib/intelligence/tradevision/spec";
import { buildEquitySpec } from "@/lib/intelligence/tradevision/zones";
import { listIndicators } from "@/lib/xchart-sdk/indicators/index";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * TradeVision chart for one NSE stock: daily bars plus a validated chart spec (levels, zones, plan) from
 * the deterministic engines, and optionally an AI annotation layer (one request per explicit user
 * action, cached by the AI client; never on hover).
 */
export const GET = userHandler(async ({ user, req }) => {
  const off = await requireFlag("MARKET_ANALYTICS");
  if (off) return off;
  const p = new URL(req.url).searchParams;
  const symbol = symbolParam(p.get("symbol"));
  if (!symbol) return fail("symbol is required");
  const horizon = (HORIZONS as string[]).includes(p.get("horizon") ?? "") ? (p.get("horizon") as Horizon) : "swing";
  const sql = await db();
  const inst = await resolveInstrument(sql, `NSE:${symbol}`);
  if (!inst) return fail("Unknown NSE equity.", 404);
  const bars = await dailyBars(sql, `NSE:${symbol}`, 400);
  const b = bars.value;
  if (b.length < 30) return json({ ok: true, symbol, bars: b, spec: null, insufficient: ["at least 30 daily bars"], provenance: bars.provenance });
  const g = gate();
  const setup = g.research ? analyzeEquity({ symbol, name: inst.name, sector: inst.industry, bars: b, provenance: bars.provenance, horizon, constraints: { capital: 500_000, maxRiskPerTrade: 5_000, maxCapitalPerTrade: 100_000, minRewardRisk: 1.5, minLiquidity: 0 } }) : null;
  const raw = buildEquitySpec(symbol, b.slice(-300), setup);
  const indicatorIds = listIndicators().map((d) => d.id);
  // The engine spec goes through the same validator as AI output.
  const { spec, issues } = validateChartSpec(raw, { window: raw.window, indicatorIds });
  const notices: string[] = [];
  if (!g.actionable) {
    const before = spec.elements.length;
    spec.elements = spec.elements.filter((e) => !e.id.startsWith("plan-"));
    if (spec.elements.length < before) notices.push(RESTRICTED_NOTICE);
  }
  let annotation = null;
  if (p.get("annotate") === "1" && g.research) {
    const r = await annotateChart(intelligenceAI(), spec, user.id, { setupStatus: setup?.status ?? null });
    const acc = acceptAnnotation(r.value, spec, annotationFacts(spec, { setupStatus: setup?.status ?? null }), indicatorIds);
    annotation = { ...acc, source: r.source, model: r.model, prompt: `${r.promptId}@${r.promptVersion}`, fallbackReason: r.fallbackReason ?? null };
  }
  await recordAnalysis(sql, { userId: user.id, kind: "tradevision", target: `NSE:${symbol}`, versions: { engine: "tradevision.spec", engineVersion: "1", dataVersion: bars.provenance.exchangeTime ?? "none", promptId: annotation ? "tradevision.annotate" : undefined, promptVersion: annotation ? "1" : undefined }, input: { horizon, provenance: bars.provenance }, output: { elements: spec.elements.length, issues, annotation } }).catch(() => null);
  return json({ ok: true, symbol, name: inst.name, bars: b.slice(-300), spec, specIssues: issues, annotation, setupStatus: setup?.status ?? null, notices, provenance: bars.provenance });
});
