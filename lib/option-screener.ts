import "server-only";
import { db } from "./db";
import { impliedVol, yearsToExpiry } from "./options/bs.ts";

export type OptFilters = {
  kind?: "all" | "index" | "stock";
  opt?: "all" | "CE" | "PE";
  expiry?: "near" | "next" | "all";
  moneyness?: "all" | "itm" | "atm" | "otm";
  buildup?: "all" | "long" | "short" | "cover" | "unwind";
  underlying?: string;
  minContracts?: number;
  minOiLots?: number;
  minPremium?: number;
  maxPremium?: number;
  minChgPct?: number;
  maxChgPct?: number;
  minOiChgPct?: number;
  minIv?: number;
  maxIv?: number;
};
export type OptSort = "contracts" | "oi" | "oiChg" | "oiChgPct" | "chgPct" | "iv" | "turnover";

export type OptRow = {
  underlying: string; kind: "index" | "stock"; expiry: string; strike: number; opt: "CE" | "PE"; close: number; chgPct: number | null;
  spot: number | null; moneyness: "ITM" | "ATM" | "OTM" | null; oiLots: number; oiChgLots: number; oiChgPct: number | null;
  contracts: number; turnover: number; iv: number | null; buildup: "Long build-up" | "Short build-up" | "Short covering" | "Long unwinding" | null; lot: number;
};

const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);

export function sanitizeOptFilters(f: unknown): OptFilters {
  const x = (f ?? {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, opts: readonly T[]): T | undefined => (opts.includes(v as T) ? (v as T) : undefined);
  return {
    kind: pick(x.kind, ["all", "index", "stock"] as const),
    opt: pick(x.opt, ["all", "CE", "PE"] as const),
    expiry: pick(x.expiry, ["near", "next", "all"] as const),
    moneyness: pick(x.moneyness, ["all", "itm", "atm", "otm"] as const),
    buildup: pick(x.buildup, ["all", "long", "short", "cover", "unwind"] as const),
    underlying: typeof x.underlying === "string" && /^[A-Z0-9&-]{1,30}$/.test(x.underlying.toUpperCase()) ? x.underlying.toUpperCase() : undefined,
    minContracts: num(x.minContracts, 0, 1e9), minOiLots: num(x.minOiLots, 0, 1e9),
    minPremium: num(x.minPremium, 0, 1e7), maxPremium: num(x.maxPremium, 0, 1e7),
    minChgPct: num(x.minChgPct, -100, 1e5), maxChgPct: num(x.maxChgPct, -100, 1e5), minOiChgPct: num(x.minOiChgPct, -100, 1e6),
    minIv: num(x.minIv, 0, 1000), maxIv: num(x.maxIv, 0, 1000),
  };
}

function buildup(chg: number | null, oiChg: number): OptRow["buildup"] {
  if (chg === null || !oiChg || !chg) return null;
  if (chg > 0) return oiChg > 0 ? "Long build-up" : "Short covering";
  return oiChg > 0 ? "Short build-up" : "Long unwinding";
}

export async function runOptionScreener(f: OptFilters, sort: OptSort = "contracts", dir: "asc" | "desc" = "desc", limit = 300) {
  const sql = await db();
  const [{ d }] = await sql<{ d: Date | null }[]>`SELECT max(d) AS d FROM fo_contracts`;
  if (!d) return { asOf: null, total: 0, rows: [] as OptRow[] };
  const asOf = d.toISOString().slice(0, 10);
  const conds = [sql`TRUE`];
  if (f.kind === "index") conds.push(sql`c.inst = 'IDO'`);
  if (f.kind === "stock") conds.push(sql`c.inst = 'STO'`);
  if (f.opt === "CE" || f.opt === "PE") conds.push(sql`c.opt = ${f.opt}`);
  if (f.underlying) conds.push(sql`c.underlying = ${f.underlying}`);
  if (f.minContracts) conds.push(sql`c.contracts >= ${f.minContracts}`);
  if (f.minOiLots) conds.push(sql`c.oi_qty >= ${f.minOiLots} * c.lot`);
  if (f.minPremium !== undefined) conds.push(sql`c.close >= ${f.minPremium}`);
  if (f.maxPremium !== undefined) conds.push(sql`c.close <= ${f.maxPremium}`);
  if (f.expiry === "near" || f.expiry === "next") conds.push(sql`e.rn = ${f.expiry === "near" ? 1 : 2}`);
  const where = conds.reduce((a, b) => sql`${a} AND ${b}`);
  const rows = await sql<{ underlying: string; inst: string; expiry: Date; strike: number; opt: "CE" | "PE"; close: number; prev_close: number | null; underlying_px: number | null; oi_qty: number; oi_chg_qty: number; contracts: number; lot: number; step: number | null }[]>`
    WITH e AS (
      SELECT underlying, expiry, row_number() OVER (PARTITION BY underlying ORDER BY expiry) AS rn
        FROM (SELECT DISTINCT underlying, expiry FROM fo_contracts) x
    ), s AS (
      SELECT underlying, expiry, min(strike_gap) AS step FROM (
        SELECT underlying, expiry, strike - lag(strike) OVER (PARTITION BY underlying, expiry ORDER BY strike) AS strike_gap
          FROM (SELECT DISTINCT underlying, expiry, strike FROM fo_contracts) y) z
       WHERE strike_gap > 0 GROUP BY 1, 2
    )
    SELECT c.underlying, c.inst, c.expiry, c.strike, c.opt, c.close, c.prev_close, c.underlying_px, c.oi_qty, c.oi_chg_qty, c.contracts, c.lot, s.step
      FROM fo_contracts c
      JOIN e ON e.underlying = c.underlying AND e.expiry = c.expiry
      LEFT JOIN s ON s.underlying = c.underlying AND s.expiry = c.expiry
     WHERE ${where}
     ORDER BY c.contracts DESC
     LIMIT 20000`;

  const at = new Date(`${asOf}T15:30:00+05:30`);
  let out: OptRow[] = rows.map((r) => {
    const expiry = r.expiry.toISOString().slice(0, 10);
    const chgPct = r.prev_close ? (r.close / r.prev_close - 1) * 100 : null;
    const prevOi = r.oi_qty - r.oi_chg_qty;
    const S = r.underlying_px;
    let moneyness: OptRow["moneyness"] = null;
    if (S) {
      const step = r.step ?? S * 0.01;
      if (Math.abs(r.strike - S) <= step / 2) moneyness = "ATM";
      else moneyness = (r.opt === "CE" ? r.strike < S : r.strike > S) ? "ITM" : "OTM";
    }
    return {
      underlying: r.underlying, kind: r.inst === "IDO" ? "index" : "stock", expiry, strike: r.strike, opt: r.opt, close: r.close, chgPct, spot: S, moneyness,
      oiLots: r.lot ? r.oi_qty / r.lot : r.oi_qty, oiChgLots: r.lot ? r.oi_chg_qty / r.lot : r.oi_chg_qty, oiChgPct: prevOi > 0 ? (r.oi_chg_qty / prevOi) * 100 : null,
      contracts: r.contracts, turnover: r.contracts * r.lot * r.close, iv: null, buildup: buildup(chgPct, r.oi_chg_qty), lot: r.lot,
    };
  });
  const mon = f.moneyness && f.moneyness !== "all" ? f.moneyness.toUpperCase() : null;
  const bu = { long: "Long build-up", short: "Short build-up", cover: "Short covering", unwind: "Long unwinding" } as const;
  out = out.filter((r) =>
    (!mon || r.moneyness === mon) &&
    (!f.buildup || f.buildup === "all" || r.buildup === bu[f.buildup]) &&
    (f.minChgPct === undefined || (r.chgPct !== null && r.chgPct >= f.minChgPct)) &&
    (f.maxChgPct === undefined || (r.chgPct !== null && r.chgPct <= f.maxChgPct)) &&
    (f.minOiChgPct === undefined || (r.oiChgPct !== null && r.oiChgPct >= f.minOiChgPct)));
  const needIv = f.minIv !== undefined || f.maxIv !== undefined || sort === "iv";
  const ivOf = (r: OptRow) => {
    if (!r.spot || !(r.close > 0)) return null;
    const v = impliedVol(r.close, { S: r.spot, K: r.strike, T: yearsToExpiry(r.expiry, at), r: 0.065, right: r.opt });
    return Number.isFinite(v) ? v * 100 : null;
  };
  if (needIv) {
    for (const r of out) r.iv = ivOf(r);
    out = out.filter((r) => (f.minIv === undefined || (r.iv !== null && r.iv >= f.minIv)) && (f.maxIv === undefined || (r.iv !== null && r.iv <= f.maxIv)));
  }
  const key: Record<OptSort, (r: OptRow) => number | null> = {
    contracts: (r) => r.contracts, oi: (r) => r.oiLots, oiChg: (r) => r.oiChgLots, oiChgPct: (r) => r.oiChgPct, chgPct: (r) => r.chgPct, iv: (r) => r.iv, turnover: (r) => r.turnover,
  };
  const k = key[sort] ?? key.contracts;
  out.sort((a, b) => {
    const x = k(a), y = k(b);
    if (x === null) return 1;
    if (y === null) return -1;
    return dir === "asc" ? x - y : y - x;
  });
  const total = out.length;
  const shown = out.slice(0, Math.min(500, Math.max(1, limit)));
  if (!needIv) for (const r of shown) r.iv = ivOf(r);
  return { asOf, total, rows: shown };
}
