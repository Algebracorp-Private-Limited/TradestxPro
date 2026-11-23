import "server-only";
import { db } from "./db";
import { deltaCandles, deltaProducts, DELTA_RESOLUTIONS } from "./delta";
import { resample, type Bar } from "./ta/catalog";
import { searchInstruments } from "./market-data";
import { brokerHistory, historyBroker } from "./brokers/store";
import { BROKER_BY_ID } from "./brokers/catalog";
import { BROKER_TFS, INDEX_IDS, type Instrument, type Tf } from "./brokers/common";
import { isVaultConfigured } from "./brokers/vault";
import { BSE_INDICES, indexCategory } from "./index-catalog";
import { getQuotes } from "./brokers/quotes";
import { mergeLiveCandle } from "./live-candle.ts";

export type ChartSymbol = { symbol: string; name: string; kind: "index" | "stock" | "crypto"; exchange: string };
export type BarsResponse = { symbol: string; name: string; source: string; delayed: string | null; tf: string; tfs: string[]; bars: Bar[]; notice?: string };

export const EOD_TFS = ["1D", "1W", "1M"] as const;
export const DELTA_TFS = ["1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W"] as const;

export async function getBars(symbol: string, tf: string, userId?: number): Promise<BarsResponse | null> {
  const [prefix, ...rest] = symbol.split(":");
  const code = rest.join(":");
  if (!code) return null;

  if (prefix === "DELTA") {
    const res = tf === "1D" ? "1d" : tf === "1W" ? "1w" : tf;
    if (!DELTA_RESOLUTIONS[res]) return null;
    const products = await deltaProducts().catch(() => []);
    const p = products.find((x) => x.symbol === code);
    const bars = await deltaCandles(code, res, 1500);
    return { symbol, name: p?.description ?? code, source: "Delta Exchange", delayed: null, tf, tfs: [...DELTA_TFS], bars };
  }

  if (prefix === "NFO" || prefix === "BFO") return contractBars(prefix, code, tf, userId);
  if (prefix !== "NSE" && prefix !== "NSEIDX" && prefix !== "BSEIDX") return null;
  const sql = await db();

  // Prefer the user's own connected broker (intraday + today's candle); fall back to end-of-day files.
  let notice: string | undefined;
  if (userId && isVaultConfigured() && (prefix === "NSE" || INDEX_IDS[code.toUpperCase()])) {
    const hb = await historyBroker(userId).catch(() => null);
    if (hb && (BROKER_TFS as string[]).includes(tf)) {
      let inst: Instrument | null = null;
      if (prefix === "NSEIDX" || prefix === "BSEIDX") inst = { kind: "index", symbol: code.toUpperCase(), token: null, isin: null, breezeCode: null };
      else {
        const [i] = await sql<{ token: string; isin: string | null; breeze_code: string; name: string }[]>`
          SELECT token, isin, breeze_code, name FROM instruments WHERE exchange = 'NSE' AND symbol = ${code.toUpperCase()} AND active LIMIT 1`;
        if (i) inst = { kind: "stock", symbol: code.toUpperCase(), token: i.token, isin: i.isin, breezeCode: i.breeze_code };
      }
      if (inst) {
        try {
          const r = await brokerHistory(userId, inst, tf as Tf);
          if (r && r.bars.length) {
            const name = await displayName(sql, prefix, code);
            let bars = r.bars;
            if (tf === "1D" || tf === "1W") {
              // Brokers' daily history stops at the previous session: add today's candle from a live quote.
              const key = inst.kind === "index" ? inst.symbol : inst.symbol;
              const q = await getQuotes(userId, [{ key, kind: inst.kind === "index" ? "index" : "stock", symbol: inst.symbol, token: inst.token, breezeCode: inst.breezeCode }]).catch(() => null);
              const lq = q?.quotes[key];
              if (lq) bars = mergeLiveCandle(bars, { ltp: lq.ltp, open: lq.open, high: lq.high, low: lq.low, volume: lq.volume }, tf);
            }
            return { symbol: `${prefix}:${code.toUpperCase()}`, name, source: `${BROKER_BY_ID[r.broker].name} (your account)`, delayed: null, tf, tfs: [...BROKER_TFS], bars };
          }
          notice = `${BROKER_BY_ID[hb.broker].name} returned no data for this view; showing end-of-day data.`;
        } catch (e) {
          notice = `${BROKER_BY_ID[hb.broker].name}: ${(e as Error).message} Showing end-of-day data.`;
        }
      }
    }
  }
  if (prefix === "BSEIDX") {
    // No public end-of-day source for BSE indices yet: they need a connected broker.
    return { symbol: `${prefix}:${code.toUpperCase()}`, name: await displayName(sql, prefix, code), source: "—", delayed: "End of day", tf, tfs: [...EOD_TFS], bars: [], notice: notice ?? "Connect ICICI Direct or Dhan on the Brokers page to chart BSE indices." };
  }
  if (!(EOD_TFS as readonly string[]).includes(tf)) tf = "1D";
  const rows = await sql<{ d: Date; o: number; h: number; l: number; c: number; v: number }[]>`
    SELECT d, o, h, l, c, v FROM candles WHERE series = ${prefix + ":" + code.toUpperCase()} ORDER BY d DESC LIMIT 2500`;
  let bars: Bar[] = rows.reverse().map((r) => ({ t: Math.floor(r.d.getTime() / 1000), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }));
  if (tf === "1W" || tf === "1M") bars = resample(bars, tf === "1W" ? "W" : "M");

  const name = await displayName(sql, prefix, code);
  return { symbol: `${prefix}:${code.toUpperCase()}`, name, source: "NSE end-of-day files", delayed: "End of day", tf, tfs: [...EOD_TFS], bars, notice };
}

async function displayName(sql: Awaited<ReturnType<typeof db>>, prefix: string, code: string): Promise<string> {
  if (prefix === "BSEIDX") return BSE_INDICES.find((b) => b.key === code.toUpperCase())?.name ?? code;
  if (prefix === "NSEIDX") {
    const [m] = await sql<{ name: string }[]>`SELECT name FROM market_indices WHERE key = ${code.toUpperCase()}`;
    return m?.name ?? code;
  }
  const [m] = await sql<{ name: string }[]>`SELECT name FROM instruments WHERE exchange = 'NSE' AND symbol = ${code.toUpperCase()} AND active LIMIT 1`;
  return m?.name ?? code;
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

export type IndexRow = { key: string; name: string; category: string; lastDate: string | null; close: number | null; changePct: number | null; pe: number | null; pb: number | null; divYield: number | null };

export async function listIndices(): Promise<IndexRow[]> {
  const sql = await db();
  const rows = await sql<{ key: string; name: string; last_d: Date | null; close: number | null; change_pct: number | null; pe: number | null; pb: number | null; div_yield: number | null }[]>`
    SELECT key, name, last_d, close, change_pct, pe, pb, div_yield FROM market_indices ORDER BY key`;
  return rows.map((r) => ({ key: r.key, name: r.name, category: indexCategory(r.key), lastDate: r.last_d?.toISOString().slice(0, 10) ?? null, close: r.close, changePct: r.change_pct, pe: r.pe, pb: r.pb, divYield: r.div_yield }));
}

/** Chart of a single futures/options contract, from the user's broker (ICICI or Dhan). */
async function contractBars(exchange: "NFO" | "BFO", token: string, tf: string, userId?: number): Promise<BarsResponse | null> {
  const sql = await db();
  const [c] = await sql<{ instrument_type: string; underlying: string; breeze_code: string; expiry: Date; strike: string | null; option_type: "CE" | "PE" | null }[]>`
    SELECT instrument_type, underlying, breeze_code, expiry, strike, option_type FROM derivative_contracts WHERE exchange = ${exchange} AND token = ${token}`;
  if (!c) return null;
  const expiry = c.expiry.toISOString().slice(0, 10);
  const strike = c.strike !== null ? Number(c.strike) : null;
  const name = `${c.underlying} ${expiry}${strike !== null ? ` ${strike} ${c.option_type}` : " FUT"}`;
  const symbol = `${exchange}:${token}`;
  const base = { symbol, name, delayed: null, tf, tfs: [...BROKER_TFS] };
  if (!userId || !isVaultConfigured()) return { ...base, source: "—", bars: [], notice: "Connect a broker to chart option and futures contracts." };
  const inst: Instrument = {
    kind: "stock", symbol: c.underlying, token: null, isin: null, breezeCode: c.breeze_code,
    contract: { exchange, token, type: c.instrument_type, expiry, strike, right: c.option_type },
  };
  if (!(BROKER_TFS as string[]).includes(tf)) tf = "5m";
  try {
    const r = await brokerHistory(userId, inst, tf as Tf);
    if (!r) return { ...base, tf, source: "—", bars: [], notice: "Connect ICICI Direct or Dhan to chart option contracts." };
    return { ...base, tf, source: `${BROKER_BY_ID[r.broker].name} (your account)`, bars: r.bars };
  } catch (e) {
    return { ...base, tf, source: "—", bars: [], notice: (e as Error).message };
  }
}
