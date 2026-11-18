import "server-only";
import { db } from "./db";
import { deltaCandles, deltaProducts, DELTA_RESOLUTIONS } from "./delta";
import { resample, type Bar } from "./ta/catalog";
import { searchInstruments } from "./market-data";

export type ChartSymbol = { symbol: string; name: string; kind: "index" | "stock" | "crypto"; exchange: string };
export type BarsResponse = { symbol: string; name: string; source: string; delayed: string | null; tf: string; bars: Bar[] };

export const EOD_TFS = ["1D", "1W", "1M"] as const;
export const DELTA_TFS = ["1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W"] as const;

export async function getBars(symbol: string, tf: string): Promise<BarsResponse | null> {
  const [prefix, ...rest] = symbol.split(":");
  const code = rest.join(":");
  if (!code) return null;

  if (prefix === "DELTA") {
    const res = tf === "1D" ? "1d" : tf === "1W" ? "1w" : tf;
    if (!DELTA_RESOLUTIONS[res]) return null;
    const products = await deltaProducts().catch(() => []);
    const p = products.find((x) => x.symbol === code);
    const bars = await deltaCandles(code, res, 1500);
    return { symbol, name: p?.description ?? code, source: "Delta Exchange", delayed: null, tf, bars };
  }

  if (prefix !== "NSE" && prefix !== "NSEIDX") return null;
  if (!(EOD_TFS as readonly string[]).includes(tf)) tf = "1D";
  const sql = await db();
  const rows = await sql<{ d: Date; o: number; h: number; l: number; c: number; v: number }[]>`
    SELECT d, o, h, l, c, v FROM candles WHERE series = ${prefix + ":" + code.toUpperCase()} ORDER BY d DESC LIMIT 2500`;
  let bars: Bar[] = rows.reverse().map((r) => ({ t: Math.floor(r.d.getTime() / 1000), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }));
  if (tf === "1W" || tf === "1M") bars = resample(bars, tf === "1W" ? "W" : "M");

  let name = code;
  if (prefix === "NSEIDX") {
    const [m] = await sql<{ name: string }[]>`SELECT name FROM market_indices WHERE key = ${code.toUpperCase()}`;
    name = m?.name ?? code;
  } else {
    const [m] = await sql<{ name: string }[]>`SELECT name FROM instruments WHERE exchange = 'NSE' AND symbol = ${code.toUpperCase()} AND active LIMIT 1`;
    name = m?.name ?? code;
  }
  return { symbol: `${prefix}:${code.toUpperCase()}`, name, source: "NSE end-of-day files", delayed: "End of day", tf, bars };
}

export async function searchChartSymbols(q: string): Promise<ChartSymbol[]> {
  const term = q.trim().toUpperCase();
  const sql = await db();
  const like = "%" + term.replace(/[\\%_]/g, (c) => `\\${c}`) + "%";
  const idx = await sql<{ key: string; name: string }[]>`
    SELECT key, name FROM market_indices
     WHERE ${term} = '' OR key LIKE ${like}
     ORDER BY CASE WHEN key IN ('NIFTY 50','NIFTY BANK','NIFTY NEXT 50','NIFTY 500','INDIA VIX','NIFTY FINANCIAL SERVICES','NIFTY MIDCAP 100') THEN 0 ELSE 1 END, key
     LIMIT ${term ? 8 : 10}`;
  const indices: ChartSymbol[] = idx.map((i) => ({ symbol: `NSEIDX:${i.key}`, name: i.name, kind: "index", exchange: "NSE" }));
  const out: ChartSymbol[] = [];
  if (term) {
    const stocks = await searchInstruments(term, "NSE", 10);
    const st = stocks.map((s) => ({ symbol: `NSE:${s.symbol}`, name: s.name, kind: "stock" as const, exchange: "NSE" }));
    // Exact/prefix index matches (e.g. "NIFTY") first, otherwise stocks lead.
    const strongIdx = indices.filter((i) => i.symbol.slice(7).startsWith(term));
    out.push(...strongIdx, ...st, ...indices.filter((i) => !strongIdx.includes(i)));
  } else out.push(...indices);
  const crypto = await deltaProducts().catch(() => []);
  const cHits = crypto
    .filter((p) => (term ? p.symbol.includes(term) || p.description.toUpperCase().includes(term) : ["BTCUSD", "ETHUSD", "SOLUSD"].includes(p.symbol)))
    .sort((a, b) => (a.symbol.startsWith(term) ? 0 : 1) - (b.symbol.startsWith(term) ? 0 : 1) || a.symbol.length - b.symbol.length)
    .slice(0, 8);
  out.push(...cHits.map((p) => ({ symbol: `DELTA:${p.symbol}`, name: p.description, kind: "crypto" as const, exchange: "Delta" })));
  return out;
}

export type IndexRow = { key: string; name: string; lastDate: string | null; close: number | null; changePct: number | null; pe: number | null; pb: number | null; divYield: number | null };

export async function listIndices(): Promise<IndexRow[]> {
  const sql = await db();
  const rows = await sql<{ key: string; name: string; last_d: Date | null; close: number | null; change_pct: number | null; pe: number | null; pb: number | null; div_yield: number | null }[]>`
    SELECT key, name, last_d, close, change_pct, pe, pb, div_yield FROM market_indices ORDER BY key`;
  return rows.map((r) => ({ key: r.key, name: r.name, lastDate: r.last_d?.toISOString().slice(0, 10) ?? null, close: r.close, changePct: r.change_pct, pe: r.pe, pb: r.pb, divYield: r.div_yield }));
}
