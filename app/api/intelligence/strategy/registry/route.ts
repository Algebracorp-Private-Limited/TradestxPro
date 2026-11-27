import { json, userHandler } from "@/lib/api";
import { filterStrategies, type RegistryFilter } from "@/lib/intelligence/strategy/registry";
import { requireFlag } from "@/lib/intelligence/http";

export const dynamic = "force-dynamic";

/** Strategy catalogue (educational: structures only, no prices or levels). */
export const GET = userHandler(async ({ req }) => {
  const off = await requireFlag("EDUCATIONAL_DEMOS");
  if (off) return off;
  const p = new URL(req.url).searchParams;
  const mode = p.get("mode");
  const f: RegistryFilter = {
    mode: mode === "BUY_ONLY" || mode === "SELL_ONLY" ? mode : "ALL",
    definedRiskOnly: p.get("definedRiskOnly") === "1", singleLegOnly: p.get("singleLegOnly") === "1",
    allowFutures: p.get("futures") !== "0", allowMultiExpiry: p.get("multiExpiry") !== "0", family: p.get("family"),
  };
  const all = filterStrategies(f);
  const families = [...new Set(filterStrategies({}).map((d) => d.family))].sort();
  return json({ ok: true, total: all.length, families, strategies: all.map((d) => ({ id: d.id, name: d.name, family: d.family, view: d.view, summary: d.summary, classification: d.classification, risk: d.risk, legs: d.legs, multiExpiry: d.multiExpiry, usesFutures: d.usesFutures })) });
});
