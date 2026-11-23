import "server-only";
import { db } from "./db";
import { getConstituents } from "./constituents";
import { getQuotes, type QuoteReq } from "./brokers/quotes";
import { isVaultConfigured } from "./brokers/vault";
import { BSE_INDICES } from "./index-catalog";

export type ComponentRow = {
  symbol: string;
  name: string;
  industry: string | null;
  ltp: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  beta: number | null;
  corr: number | null;
  vsIndex: number | null;
  live: boolean;
};

export type IndexComponents = {
  key: string;
  name: string;
  index: { ltp: number | null; change: number | null; changePct: number | null; live: boolean };
  rows: ComponentRow[];
  broker: string | null;
  eodDate: string | null;
  notice?: string;
  breadth: { up: number; down: number; flat: number };
};

const LIVE_LIMIT = 60;

export async function getIndexComponents(userId: number, key: string): Promise<IndexComponents | null> {
  const k = key.toUpperCase();
  const members = await getConstituents(k);
  if (!members.length) return null;
  const sql = await db();
  const symbols = members.map((m) => m.symbol);
  const bse = BSE_INDICES.find((b) => b.key === k);

  const [inst, snap, idxRow] = await Promise.all([
    sql<{ symbol: string; token: string; breeze_code: string }[]>`
      SELECT DISTINCT ON (symbol) symbol, token, breeze_code FROM instruments WHERE exchange = 'NSE' AND active AND symbol IN ${sql(symbols)}`,
    sql<{ symbol: string; d: Date; close: number | null; change_pct: number | null; volume: number | null; avg_vol20: number | null; beta: number | null; corr: number | null }[]>`
      SELECT symbol, d, close, change_pct, volume, avg_vol20, beta, corr FROM screener_snapshot WHERE symbol IN ${sql(symbols)}`,
    sql<{ name: string; close: number | null; change_pct: number | null }[]>`SELECT name, close, change_pct FROM market_indices WHERE key = ${k}`,
  ]);
  const instBy = new Map(inst.map((i) => [i.symbol, i]));
  const snapBy = new Map(snap.map((s) => [s.symbol, s]));
  const eodDate = snap.length ? snap.reduce((m, s) => (s.d > m ? s.d : m), snap[0].d).toISOString().slice(0, 10) : null;

  // End-of-day OHLC for the last session.
  const ohlc = eodDate
    ? await sql<{ series: string; o: number; h: number; l: number }[]>`
        SELECT series, o, h, l FROM candles WHERE d = ${eodDate} AND series IN ${sql(symbols.map((s) => "NSE:" + s))}`
    : [];
  const ohlcBy = new Map(ohlc.map((r) => [r.series.slice(4), r]));

  // Live quotes: the most traded members first when the index is large.
  let broker: string | null = null;
  let notice: string | undefined;
  let quotes: Awaited<ReturnType<typeof getQuotes>>["quotes"] = {};
  if (isVaultConfigured()) {
    const ranked = [...symbols].sort((a, b) => {
      const ta = (snapBy.get(a)?.avg_vol20 ?? 0) * (snapBy.get(a)?.close ?? 0);
      const tb = (snapBy.get(b)?.avg_vol20 ?? 0) * (snapBy.get(b)?.close ?? 0);
      return tb - ta;
    });
    const reqs: QuoteReq[] = [{ key: "__INDEX__", kind: "index", symbol: k }];
    for (const s of ranked.slice(0, LIVE_LIMIT)) {
      const i = instBy.get(s);
      if (i) reqs.push({ key: s, kind: "stock", symbol: s, token: i.token, breezeCode: i.breeze_code });
    }
    const q = await getQuotes(userId, reqs, { maxCalls: LIVE_LIMIT + 1, concurrency: 5 }).catch(() => null);
    if (q) {
      broker = q.brokerName;
      quotes = q.quotes;
      notice = q.error;
      if (q.broker && symbols.length > LIVE_LIMIT) notice = `Live prices for the ${LIVE_LIMIT} most traded members; the rest show the last close.`;
    }
  }

  const iq = quotes.__INDEX__;
  const index = iq
    ? { ltp: iq.ltp, change: iq.change, changePct: iq.changePct, live: true }
    : { ltp: idxRow[0]?.close ?? null, change: null, changePct: idxRow[0]?.change_pct ?? null, live: false };

  const rows: ComponentRow[] = members.map((m) => {
    const q = quotes[m.symbol];
    const s = snapBy.get(m.symbol);
    const o = ohlcBy.get(m.symbol);
    const prevEod = s?.close && s.change_pct !== null ? s.close / (1 + s.change_pct / 100) : null;
    const ltp = q?.ltp ?? s?.close ?? null;
    const changePct = q ? q.changePct : s?.change_pct ?? null;
    return {
      symbol: m.symbol,
      name: m.name,
      industry: m.industry,
      ltp,
      open: q ? q.open : o?.o ?? null,
      high: q ? q.high : o?.h ?? null,
      low: q ? q.low : o?.l ?? null,
      prevClose: q ? q.prevClose : prevEod,
      change: q ? q.change : s?.close && prevEod ? s.close - prevEod : null,
      changePct,
      volume: q ? q.volume : s?.volume ?? null,
      beta: s?.beta ?? null,
      corr: s?.corr ?? null,
      vsIndex: changePct !== null && index.changePct !== null ? changePct - index.changePct : null,
      live: Boolean(q),
    };
  });
  const breadth = { up: 0, down: 0, flat: 0 };
  for (const r of rows) {
    if (r.changePct === null) continue;
    if (r.changePct > 0.001) breadth.up++;
    else if (r.changePct < -0.001) breadth.down++;
    else breadth.flat++;
  }
  return { key: k, name: bse?.name ?? idxRow[0]?.name ?? k, index, rows, broker, eodDate, notice, breadth };
}
