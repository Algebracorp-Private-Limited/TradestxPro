/**
 * Market-data access for the intelligence engines (database-backed sources). Every result carries
 * provenance (source, exchange time, freshness, entitlement, missing fields). Live broker data is
 * in `live.ts` (server-only, per user).
 */
import type postgres from "postgres";
import { provenance } from "../core/freshness.ts";
import type { Sourced } from "../core/types.ts";
import { contractInstrument, dedupeUniverse, equityInstrument, indexInstrument, parseInstrumentId, type ConstituentRow, type ContractRow, type EquityRow, type Instrument } from "../instruments/master.ts";

type Sql = postgres.Sql;
export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
const iso = (d: Date | string) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/** Daily bars for a series ('NSE:<symbol>' or 'NSEIDX:<INDEX>'), oldest first. */
export async function dailyBars(sql: Sql, series: string, limit = 400, now = new Date()): Promise<Sourced<Bar[]>> {
  const rows = await sql<{ d: Date; o: number; h: number; l: number; c: number; v: number }[]>`
    SELECT d, o, h, l, c, v FROM candles WHERE series = ${series} ORDER BY d DESC LIMIT ${Math.min(Math.max(1, limit), 2000)}`;
  rows.reverse();
  const bars = rows.map((r) => ({ t: Date.parse(iso(r.d) + "T00:00:00Z") / 1000, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }));
  const lastD = rows.length ? iso(rows[rows.length - 1].d) : null;
  const bad = bars.some((b) => !(b.l <= Math.min(b.o, b.c) && b.h >= Math.max(b.o, b.c)));
  return {
    value: bars,
    provenance: provenance({ source: series.startsWith("NSEIDX:") ? "nse-index-bhavcopy" : "nse-equity-bhavcopy", kind: "eod-file", exchangeTime: lastD, entitlement: "public-eod", now, missing: rows.length ? [] : ["daily bars"], invalid: bad }),
  };
}

export type SnapshotRow = {
  symbol: string; d: string; name: string | null; close: number; changePct: number | null; volume: number | null; avgVol20: number | null; relVol: number | null;
  high52: number | null; low52: number | null; rsi14: number | null; ema20: number | null; ema50: number | null; ema200: number | null; macdHist: number | null;
  adx14: number | null; atrPct: number | null; supertrendDir: number | null; ret5: number | null; ret20: number | null; ret60: number | null; beta: number | null; hasDerivatives: boolean;
};

/** Latest EOD technical snapshot per NSE equity (the existing screener table). */
export async function latestSnapshot(sql: Sql, symbols: string[] | null, now = new Date()): Promise<Sourced<SnapshotRow[]>> {
  const rows = symbols
    ? await sql<Record<string, unknown>[]>`SELECT * FROM screener_snapshot WHERE symbol IN ${sql(symbols)}`
    : await sql<Record<string, unknown>[]>`SELECT * FROM screener_snapshot`;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const out: SnapshotRow[] = rows.map((r) => ({
    symbol: String(r.symbol), d: iso(r.d as Date), name: (r.name as string) ?? null, close: Number(r.close), changePct: n(r.change_pct), volume: n(r.volume), avgVol20: n(r.avg_vol20), relVol: n(r.rel_vol),
    high52: n(r.high52), low52: n(r.low52), rsi14: n(r.rsi14), ema20: n(r.ema20), ema50: n(r.ema50), ema200: n(r.ema200), macdHist: n(r.macd_hist), adx14: n(r.adx14), atrPct: n(r.atr_pct),
    supertrendDir: n(r.supertrend_dir), ret5: n(r.ret5), ret20: n(r.ret20), ret60: n(r.ret60), beta: n(r.beta), hasDerivatives: Boolean(r.has_derivatives),
  }));
  const latest = out.reduce((m, r) => (r.d > m ? r.d : m), "");
  return { value: out, provenance: provenance({ source: "screener-snapshot (NSE EOD)", kind: "eod-file", exchangeTime: latest || null, entitlement: "public-eod", now, missing: out.length ? [] : ["snapshot rows"] }) };
}

export type EodOptionRow = { underlying: string; inst: string; expiry: string; strike: number; right: "CE" | "PE"; close: number; prevClose: number | null; underlyingPx: number | null; oi: number; oiChange: number; contracts: number; lot: number; d: string };

/** Latest-session option contracts from the NSE F&O bhavcopy (no bid/ask, no broker Greeks). */
export async function eodChain(sql: Sql, underlying: string, expiry: string | null = null, now = new Date()): Promise<Sourced<EodOptionRow[]>> {
  const rows = expiry
    ? await sql<Record<string, unknown>[]>`SELECT * FROM fo_contracts WHERE underlying = ${underlying} AND expiry = ${expiry} ORDER BY expiry, strike, opt`
    : await sql<Record<string, unknown>[]>`SELECT * FROM fo_contracts WHERE underlying = ${underlying} ORDER BY expiry, strike, opt`;
  const out: EodOptionRow[] = rows.map((r) => ({
    underlying: String(r.underlying), inst: String(r.inst), expiry: iso(r.expiry as Date), strike: Number(r.strike), right: r.opt as "CE" | "PE", close: Number(r.close),
    prevClose: r.prev_close === null ? null : Number(r.prev_close), underlyingPx: r.underlying_px === null ? null : Number(r.underlying_px), oi: Number(r.oi_qty), oiChange: Number(r.oi_chg_qty),
    contracts: Number(r.contracts), lot: Number(r.lot), d: iso(r.d as Date),
  }));
  const d = out[0]?.d ?? null;
  return { value: out, provenance: provenance({ source: "nse-fo-bhavcopy", kind: "eod-file", exchangeTime: d, entitlement: "public-eod", now, missing: ["bid", "ask", "bid quantity", "ask quantity", "broker IV", "broker Greeks"] }) };
}

export type EodFutureRow = { underlying: string; inst: "IDF" | "STF"; expiry: string; close: number; prevClose: number | null; settle: number | null; underlyingPx: number | null; oi: number; oiChange: number; contracts: number; lot: number; d: string };

/**
 * Latest-session futures from the NSE F&O bhavcopy. Needs migration 004 (fo_futures); when the table is
 * missing the result is empty with "futures dataset not configured" in `missing` (never estimated).
 */
export async function eodFutures(sql: Sql, underlyings: string[] | null, now = new Date()): Promise<Sourced<EodFutureRow[]>> {
  const [{ t }] = await sql<{ t: string | null }[]>`SELECT to_regclass('public.fo_futures')::text AS t`;
  if (!t) return { value: [], provenance: provenance({ source: "nse-fo-bhavcopy", kind: "eod-file", exchangeTime: null, entitlement: "public-eod", now, missing: ["futures dataset not configured (migration 004-fo-futures)"] }) };
  const rows = underlyings
    ? await sql<Record<string, unknown>[]>`SELECT * FROM fo_futures WHERE underlying IN ${sql(underlyings)} ORDER BY underlying, expiry`
    : await sql<Record<string, unknown>[]>`SELECT * FROM fo_futures ORDER BY underlying, expiry`;
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const out: EodFutureRow[] = rows.map((r) => ({
    underlying: String(r.underlying), inst: r.inst as "IDF" | "STF", expiry: iso(r.expiry as Date), close: Number(r.close), prevClose: n(r.prev_close), settle: n(r.settle),
    underlyingPx: n(r.underlying_px), oi: Number(r.oi_qty), oiChange: Number(r.oi_chg_qty), contracts: Number(r.contracts), lot: Number(r.lot), d: iso(r.d as Date),
  }));
  return { value: out, provenance: provenance({ source: "nse-fo-bhavcopy", kind: "eod-file", exchangeTime: out[0]?.d ?? null, entitlement: "public-eod", now, missing: ["bid", "ask", "margin"] }) };
}

/** Resolves a canonical instrument id against the reference tables (null when it does not exist). */
export async function resolveInstrument(sql: Sql, id: string): Promise<Instrument | null> {
  const p = parseInstrumentId(id);
  if (!p) return null;
  if (p.kind === "index") {
    const [r] = await sql<{ key: string; name: string }[]>`SELECT key, name FROM market_indices WHERE key = ${p.symbol}`;
    return r ? indexInstrument(r.key, r.name) : null;
  }
  if (p.kind === "equity") {
    const [r] = await sql<EquityRow[]>`SELECT exchange, token, symbol, name, isin, tick_size, lot_size, has_derivatives FROM instruments WHERE exchange = ${p.exchange} AND symbol = ${p.symbol} AND active ORDER BY series = 'EQ' DESC LIMIT 1`;
    if (!r) return null;
    const cons = await sql<ConstituentRow[]>`SELECT index_key, symbol, industry, isin FROM index_constituents WHERE symbol = ${p.symbol}`;
    return equityInstrument(r, cons);
  }
  const rows = p.kind === "future"
    ? await sql<ContractRow[]>`SELECT * FROM derivative_contracts WHERE exchange = ${p.exchange} AND underlying = ${p.symbol} AND expiry = ${p.expiry!} AND instrument_type LIKE 'FUT%' LIMIT 1`
    : await sql<ContractRow[]>`SELECT * FROM derivative_contracts WHERE exchange = ${p.exchange} AND underlying = ${p.symbol} AND expiry = ${p.expiry!} AND strike = ${p.strike!} AND option_type = ${p.right!} AND instrument_type LIKE 'OPT%' LIMIT 1`;
  return rows[0] ? contractInstrument(rows[0]) : null;
}

/** Listed contracts of an underlying (verified reference data: lot size, tick size, expiries, strikes). */
export async function contractsOf(sql: Sql, underlying: string, opts: { expiry?: string; kind?: "future" | "option" } = {}): Promise<Instrument[]> {
  const like = opts.kind === "future" ? "FUT%" : opts.kind === "option" ? "OPT%" : "%";
  const rows = opts.expiry
    ? await sql<ContractRow[]>`SELECT * FROM derivative_contracts WHERE underlying = ${underlying} AND expiry = ${opts.expiry} AND instrument_type LIKE ${like} ORDER BY expiry, strike NULLS FIRST, option_type`
    : await sql<ContractRow[]>`SELECT * FROM derivative_contracts WHERE underlying = ${underlying} AND instrument_type LIKE ${like} AND expiry >= CURRENT_DATE ORDER BY expiry, strike NULLS FIRST, option_type`;
  return rows.map(contractInstrument);
}

export type UniverseId = string; // an index key, "ALL_NSE_EQUITY", "ALL_FO_UNDERLYINGS"

/** Resolves universes to a deduplicated symbol list, reporting overlap and missing constituent files. */
export async function resolveUniverse(sql: Sql, ids: UniverseId[]) {
  const lists: { index: string; symbols: string[] }[] = [];
  const unavailable: string[] = [];
  for (const id of ids) {
    if (id === "ALL_NSE_EQUITY") {
      const r = await sql<{ symbol: string }[]>`SELECT DISTINCT symbol FROM screener_snapshot`;
      lists.push({ index: id, symbols: r.map((x) => x.symbol) });
    } else if (id === "ALL_FO_UNDERLYINGS") {
      const r = await sql<{ underlying: string }[]>`SELECT DISTINCT underlying FROM derivative_contracts WHERE exchange = 'NFO' AND expiry >= CURRENT_DATE`;
      lists.push({ index: id, symbols: r.map((x) => x.underlying) });
    } else {
      const r = await sql<{ symbol: string }[]>`SELECT symbol FROM index_constituents WHERE index_key = ${id}`;
      if (!r.length) unavailable.push(id);
      else lists.push({ index: id, symbols: r.map((x) => x.symbol) });
    }
  }
  return { ...dedupeUniverse(lists), unavailable };
}
