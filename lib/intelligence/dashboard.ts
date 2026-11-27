/** AI Intelligence dashboard data: market direction, indices, breadth, sectors, volatility, freshness, scans. */
import type postgres from "postgres";
import { provenance } from "./core/freshness.ts";
import { isInsufficient, type Provenance } from "./core/types.ts";
import { dailyBars } from "./market-data/data.ts";
import { detectRegime, type Regime } from "./technical/regime.ts";

type Sql = postgres.Sql;
const MAJOR = ["NIFTY 50", "NIFTY BANK", "NIFTY NEXT 50", "NIFTY MIDCAP 100", "NIFTY SMALLCAP 100", "NIFTY FINANCIAL SERVICES", "NIFTY IT", "INDIA VIX"];

export type Dashboard = {
  asOf: string | null;
  provenance: Provenance;
  marketRegime: Regime | null;
  marketRegimeMissing: string[];
  indices: { key: string; close: number | null; changePct: number | null; date: string | null }[];
  breadth: { advances: number; declines: number; unchanged: number; above200: number; total: number; newHighs: number; newLows: number } | null;
  sectors: { industry: string; members: number; avgChangePct: number; advancing: number }[];
  vix: { close: number | null; changePct: number | null } | null;
};

export async function dashboardData(sql: Sql, now = new Date()): Promise<Dashboard> {
  const bars = await dailyBars(sql, "NSEIDX:NIFTY 50", 400, now);
  const reg = bars.value.length ? detectRegime({ high: bars.value.map((b) => b.h), low: bars.value.map((b) => b.l), close: bars.value.map((b) => b.c) }) : null;
  const idx = await sql<{ key: string; close: number | null; change_pct: number | null; last_d: Date | null }[]>`SELECT key, close, change_pct, last_d FROM market_indices WHERE key IN ${sql(MAJOR)}`;
  const [b] = await sql<{ adv: number; dec: number; unch: number; above200: number; total: number; hi: number; lo: number; d: Date | null }[]>`
    SELECT count(*) FILTER (WHERE change_pct > 0)::int AS adv, count(*) FILTER (WHERE change_pct < 0)::int AS dec, count(*) FILTER (WHERE change_pct = 0)::int AS unch,
           count(*) FILTER (WHERE close > ema200)::int AS above200, count(*)::int AS total,
           count(*) FILTER (WHERE close >= high52 * 0.995)::int AS hi, count(*) FILTER (WHERE close <= low52 * 1.005)::int AS lo, max(d) AS d
      FROM screener_snapshot`;
  const sectors = await sql<{ industry: string; members: number; avg: number; adv: number }[]>`
    SELECT c.industry, count(DISTINCT s.symbol)::int AS members, avg(s.change_pct)::float AS avg, count(DISTINCT s.symbol) FILTER (WHERE s.change_pct > 0)::int AS adv
      FROM (SELECT DISTINCT ON (symbol) symbol, industry FROM index_constituents WHERE industry IS NOT NULL) c JOIN screener_snapshot s ON s.symbol = c.symbol
     GROUP BY c.industry HAVING count(*) >= 3 ORDER BY avg DESC`;
  const vix = idx.find((x) => x.key === "INDIA VIX");
  const latest = b?.d ? b.d.toISOString().slice(0, 10) : bars.provenance.exchangeTime;
  return {
    asOf: latest,
    provenance: provenance({ source: "NSE EOD (bhavcopies, screener snapshot)", kind: "eod-file", exchangeTime: latest, entitlement: "public-eod", now }),
    marketRegime: reg && !isInsufficient(reg) ? reg : null,
    marketRegimeMissing: reg && isInsufficient(reg) ? reg.reasons : reg ? [] : ["NIFTY 50 daily history"],
    indices: MAJOR.map((k) => {
      const r = idx.find((x) => x.key === k);
      return { key: k, close: r?.close ?? null, changePct: r?.change_pct ?? null, date: r?.last_d ? r.last_d.toISOString().slice(0, 10) : null };
    }),
    breadth: b && b.total ? { advances: b.adv, declines: b.dec, unchanged: b.unch, above200: b.above200, total: b.total, newHighs: b.hi, newLows: b.lo } : null,
    sectors: sectors.map((s) => ({ industry: s.industry, members: s.members, avgChangePct: Math.round(s.avg * 100) / 100, advancing: s.adv })),
    vix: vix ? { close: vix.close, changePct: vix.change_pct } : null,
  };
}
