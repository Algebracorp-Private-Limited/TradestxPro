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

export const hasConstituents = (key: string) => Object.hasOwn(CONSTITUENT_FILES, key.toUpperCase());

export type Constituent = { symbol: string; name: string; industry: string | null; isin: string | null };

/** Returns the constituents of an NSE index, refreshing from NSE when older than 3 days. */
export async function getConstituents(indexKey: string): Promise<Constituent[]> {
  const key = indexKey.toUpperCase();
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
