import { db } from "@/lib/db";
import { getConstituents } from "@/lib/constituents";
import { json, userHandler } from "@/lib/api";

type Row = { underlying: string; inst: string; contracts: string; ce_contracts: string; pe_contracts: string; ce_oi_qty: string; pe_oi_qty: string; premium_turnover: number };

/** Previous-session F&O activity: market totals, a given underlying, top stock options, and sector split. */
export const GET = userHandler(async ({ req }) => {
  const u = new URL(req.url).searchParams.get("u")?.toUpperCase() ?? null;
  const sql = await db();
  const [{ d }] = await sql<{ d: Date | null }[]>`SELECT max(d) AS d FROM fo_activity`;
  if (!d) return json({ ok: true, d: null });
  const rows = await sql<Row[]>`
    SELECT underlying, inst, contracts, ce_contracts, pe_contracts, ce_oi_qty, pe_oi_qty, premium_turnover FROM fo_activity WHERE d = ${d}`;
  const N = (v: string | number) => Number(v);

  const totals: Record<string, { contracts: number; ce: number; pe: number; premium: number; pcrOi: number | null }> = {};
  for (const r of rows) {
    const t = (totals[r.inst] ??= { contracts: 0, ce: 0, pe: 0, premium: 0, pcrOi: null });
    t.contracts += N(r.contracts);
    t.ce += N(r.ce_contracts);
    t.pe += N(r.pe_contracts);
    t.premium += r.premium_turnover;
  }
  for (const inst of ["IDO", "STO"]) {
    const ce = rows.filter((r) => r.inst === inst).reduce((s, r) => s + N(r.ce_oi_qty), 0);
    const pe = rows.filter((r) => r.inst === inst).reduce((s, r) => s + N(r.pe_oi_qty), 0);
    if (totals[inst]) totals[inst].pcrOi = ce ? pe / ce : null;
  }

  const forU = u
    ? rows.filter((r) => r.underlying === u).map((r) => ({
        inst: r.inst, contracts: N(r.contracts), ce: N(r.ce_contracts), pe: N(r.pe_contracts),
        pcrOi: N(r.ce_oi_qty) ? N(r.pe_oi_qty) / N(r.ce_oi_qty) : null, premium: r.premium_turnover,
      }))
    : [];

  const stockOpt = rows.filter((r) => r.inst === "STO");
  const top = stockOpt
    .sort((a, b) => N(b.contracts) - N(a.contracts))
    .slice(0, 10)
    .map((r) => ({ underlying: r.underlying, contracts: N(r.contracts), ce: N(r.ce_contracts), pe: N(r.pe_contracts), premium: r.premium_turnover }));

  // Sector split of stock options + futures using NIFTY 500 industry tags.
  const members = await getConstituents("NIFTY 500").catch(() => []);
  const industry = new Map(members.map((m) => [m.symbol, m.industry ?? "Other"]));
  const sectors = new Map<string, { industry: string; options: number; futures: number; premium: number; ceOi: number; peOi: number }>();
  for (const r of rows) {
    if (r.inst !== "STO" && r.inst !== "STF") continue;
    const ind = industry.get(r.underlying) ?? "Other";
    const s = sectors.get(ind) ?? { industry: ind, options: 0, futures: 0, premium: 0, ceOi: 0, peOi: 0 };
    if (r.inst === "STO") {
      s.options += N(r.contracts);
      s.premium += r.premium_turnover;
      s.ceOi += N(r.ce_oi_qty);
      s.peOi += N(r.pe_oi_qty);
    } else s.futures += N(r.contracts);
    sectors.set(ind, s);
  }
  return json({
    ok: true,
    d: d.toISOString().slice(0, 10),
    totals,
    underlying: u ? { symbol: u, rows: forU } : null,
    top,
    sectors: [...sectors.values()]
      .map((s) => ({ industry: s.industry, options: s.options, futures: s.futures, premium: s.premium, pcrOi: s.ceOi ? s.peOi / s.ceOi : null }))
      .sort((a, b) => b.options - a.options),
  });
});
