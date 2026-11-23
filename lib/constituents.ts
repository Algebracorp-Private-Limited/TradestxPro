import "server-only";
import { db } from "./db";
import { parseCsv } from "./csv.ts";

// NSE publishes a constituent list per index at nsearchives.nseindia.com/content/indices/ind_<file>list.csv
export const CONSTITUENT_FILES: Record<string, string> = {
  "NIFTY 50": "nifty50", "NIFTY NEXT 50": "niftynext50", "NIFTY 100": "nifty100", "NIFTY 200": "nifty200", "NIFTY 500": "nifty500",
  "NIFTY BANK": "niftybank", "NIFTY IT": "niftyit", "NIFTY AUTO": "niftyauto", "NIFTY PHARMA": "niftypharma", "NIFTY FMCG": "niftyfmcg",
  "NIFTY METAL": "niftymetal", "NIFTY REALTY": "niftyrealty", "NIFTY ENERGY": "niftyenergy", "NIFTY PSU BANK": "niftypsubank",
  "NIFTY FINANCIAL SERVICES": "niftyfinance", "NIFTY MIDCAP 100": "niftymidcap100", "NIFTY SMALLCAP 100": "niftysmallcap100",
  "NIFTY MIDCAP 50": "niftymidcap50", "NIFTY MEDIA": "niftymedia", "NIFTY PRIVATE BANK": "nifty_privatebank",
  "NIFTY MIDCAP 150": "niftymidcap150", "NIFTY SMALLCAP 250": "niftysmallcap250", "NIFTY HEALTHCARE INDEX": "niftyhealthcare",
  "NIFTY CONSUMER DURABLES": "niftyconsumerdurables", "NIFTY OIL & GAS": "niftyoilgas",
};

// BSE does not publish a downloadable list we can reach, so the 30 SENSEX members are kept here
// (NSE symbols; BSE reviews them in June and December).
export const SENSEX_MEMBERS = [
  "ADANIPORTS", "ASIANPAINT", "AXISBANK", "BAJFINANCE", "BAJAJFINSV", "BEL", "BHARTIARTL", "ETERNAL", "HCLTECH", "HDFCBANK",
  "HINDUNILVR", "ICICIBANK", "INFY", "ITC", "KOTAKBANK", "LT", "M&M", "MARUTI", "NTPC", "POWERGRID",
  "RELIANCE", "SBIN", "SUNPHARMA", "TMPV", "TATASTEEL", "TCS", "TECHM", "TITAN", "TRENT", "ULTRACEMCO",
];

export const hasConstituents = (key: string) => key.toUpperCase() === "SENSEX" || Object.hasOwn(CONSTITUENT_FILES, key.toUpperCase());

async function sensexConstituents(): Promise<Constituent[]> {
  const sql = await db();
  const meta = await sql<{ symbol: string; name: string; isin: string | null }[]>`
    SELECT DISTINCT ON (symbol) symbol, name, isin FROM instruments WHERE exchange = 'NSE' AND active AND symbol IN ${sql(SENSEX_MEMBERS)}`;
  const ind = await sql<{ symbol: string; industry: string | null }[]>`
    SELECT DISTINCT ON (symbol) symbol, industry FROM index_constituents WHERE symbol IN ${sql(SENSEX_MEMBERS)} AND industry IS NOT NULL`;
  const m = new Map(meta.map((r) => [r.symbol, r]));
  const i = new Map(ind.map((r) => [r.symbol, r.industry]));
  return SENSEX_MEMBERS.map((symbol) => ({ symbol, name: m.get(symbol)?.name ?? symbol, industry: i.get(symbol) ?? null, isin: m.get(symbol)?.isin ?? null }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export type Constituent = { symbol: string; name: string; industry: string | null; isin: string | null };

/** Returns the constituents of an NSE index, refreshing from NSE when older than 3 days. */
export async function getConstituents(indexKey: string): Promise<Constituent[]> {
  const key = indexKey.toUpperCase();
  if (key === "SENSEX") {
    await getConstituents("NIFTY 500").catch(() => []); // loads industries
    return sensexConstituents();
  }
  const file = CONSTITUENT_FILES[key];
  if (!file) return [];
  const sql = await db();
  const rows = await sql<(Constituent & { updated_at: Date })[]>`
    SELECT symbol, name, industry, isin, updated_at FROM index_constituents WHERE index_key = ${key} ORDER BY symbol`;
  const fresh = rows.length && rows[0].updated_at.getTime() > Date.now() - 3 * 86400_000;
  if (fresh) return rows.map(({ symbol, name, industry, isin }) => ({ symbol, name, industry, isin }));
  try {
    const res = await fetch(`https://nsearchives.nseindia.com/content/indices/ind_${file}list.csv`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", Referer: "https://www.nseindia.com/" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`NSE ${res.status}`);
    const list: Constituent[] = [];
    for (const r of parseCsv(await res.text())) {
      const symbol = r.Symbol?.trim();
      if (symbol) list.push({ symbol, name: r["Company Name"]?.trim() || symbol, industry: r.Industry?.trim() || null, isin: r["ISIN Code"]?.trim() || null });
    }
    if (list.length) {
      await sql.begin(async (tx) => {
        await tx`DELETE FROM index_constituents WHERE index_key = ${key}`;
        await tx`INSERT INTO index_constituents ${tx(list.map((c) => ({ index_key: key, ...c })), "index_key", "symbol", "name", "industry", "isin")}`;
      });
      return list.sort((a, b) => a.symbol.localeCompare(b.symbol));
    }
  } catch (e) {
    console.error("constituents fetch failed", key, e);
  }
  return rows.map(({ symbol, name, industry, isin }) => ({ symbol, name, industry, isin }));
}
