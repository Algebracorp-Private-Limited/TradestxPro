import { db } from "@/lib/db";
import { fail, json, userHandler } from "@/lib/api";
import { analyzeInvestment } from "@/lib/intelligence/fundamentals/analysis";
import { explainInvestment } from "@/lib/intelligence/fundamentals/explain";
import { getCompany, peersOf } from "@/lib/intelligence/fundamentals/store";
import { dailyBars, resolveInstrument } from "@/lib/intelligence/market-data/data";
import { scanTablesAvailable } from "@/lib/intelligence/market-scan/jobs";
import { recordAnalysis } from "@/lib/intelligence/audit/store";
import { requireFlag, symbolParam } from "@/lib/intelligence/http";
import { intelligenceAI } from "@/lib/intelligence/server";
import { gate } from "@/lib/intelligence/present";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Fundamental investment analysis from imported statements; INSUFFICIENT DATA when none exist. */
export const GET = userHandler(async ({ user, req }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const p = new URL(req.url).searchParams;
  const symbol = symbolParam(p.get("symbol"));
  if (!symbol) return fail("symbol is required");
  const sql = await db();
  const inst = await resolveInstrument(sql, `NSE:${symbol}`);
  if (!inst) return fail("Unknown NSE equity.", 404);
  const storage = await scanTablesAvailable(sql);
  const stored = storage ? await getCompany(sql, symbol) : null;
  const bars = await dailyBars(sql, `NSE:${symbol}`, 600);
  const last = bars.value.at(-1);
  const asOf = new Date().toISOString().slice(0, 10);
  const closeOn = (d: string) => {
    const t = Date.parse(d + "T00:00:00Z") / 1000;
    const b = [...bars.value].reverse().find((x) => x.t <= t && t - x.t < 7 * 86400);
    return b?.c;
  };
  const peers = stored ? await Promise.all((await peersOf(sql, symbol, stored.company.industry)).map(async (x) => ({ symbol: x.symbol, company: x.company, price: (await dailyBars(sql, `NSE:${x.symbol}`, 1)).value.at(-1)?.c ?? NaN }))) : [];
  const a = analyzeInvestment({
    symbol, company: stored?.company ?? null, price: last?.c ?? null, priceDate: bars.provenance.exchangeTime, asOf,
    peers: peers.filter((x) => Number.isFinite(x.price)),
    historicalPrices: stored ? Object.fromEntries(stored.company.periods.map((pp) => [pp.periodEnd, closeOn(pp.periodEnd)]).filter((x) => x[1] !== undefined)) : {},
  });
  if (!storage) a.missing.unshift("fundamentals storage (database migration pending)");
  const g = gate();
  let thesis = null;
  if (a.status === "ANALYSED" && p.get("explain") === "1" && g.actionable) {
    const r = await explainInvestment(intelligenceAI(), a, stored?.company.profile?.description ?? null, user.id);
    thesis = { ...r.value, source: r.source, model: r.model, prompt: `${r.promptId}@${r.promptVersion}`, fallbackReason: r.fallbackReason ?? null };
  }
  await recordAnalysis(sql, { userId: user.id, kind: "investment", target: `NSE:${symbol}`, versions: { engine: "investment", engineVersion: "1", dataVersion: `${stored?.provider.id ?? "none"}@${stored?.revision ?? "-"}` }, input: { price: last?.c ?? null }, output: { a, thesis } }).catch(() => null);
  return json({
    ok: true, provenance: { price: bars.provenance, fundamentals: stored ? { provider: stored.provider, revision: stored.revision, importedAt: stored.importedAt } : null },
    analysis: g.actionable ? a : { ...a, entryRange: null, restricted: ["entryRange"] }, thesis,
  });
});
