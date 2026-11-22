import "server-only";
import { db } from "./db";

export type InstrumentRow = {
  id: number;
  exchange: "NSE" | "BSE";
  token: string;
  symbol: string;
  breezeCode: string;
  name: string;
  series: string | null;
  isin: string | null;
  tickSize: number | null;
  lotSize: number | null;
  faceValue: number | null;
  hasDerivatives: boolean;
};

type RawInstrument = {
  id: string; exchange: "NSE" | "BSE"; token: string; symbol: string; breeze_code: string; name: string;
  series: string | null; isin: string | null; tick_size: string | null; lot_size: number | null;
  face_value: string | null; has_derivatives: boolean;
};

const n = (v: string | null) => (v === null ? null : Number(v));

function toRow(r: RawInstrument): InstrumentRow {
  return {
    id: Number(r.id), exchange: r.exchange, token: r.token, symbol: r.symbol, breezeCode: r.breeze_code,
    name: r.name, series: r.series, isin: r.isin, tickSize: n(r.tick_size), lotSize: r.lot_size,
    faceValue: n(r.face_value), hasDerivatives: r.has_derivatives,
  };
}

const COLS = "id, exchange, token, symbol, breeze_code, name, series, isin, tick_size, lot_size, face_value, has_derivatives";

/** Ranked search: exact symbol, symbol prefix, name word prefix, then contains. NSE before BSE. */
export async function searchInstruments(q: string, exchange?: "NSE" | "BSE", limit = 20): Promise<InstrumentRow[]> {
  const term = q.trim().toUpperCase().slice(0, 40);
  if (!term) return [];
  const sql = await db();
  const like = term.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await sql<RawInstrument[]>`
    SELECT ${sql.unsafe(COLS)} FROM instruments
     WHERE active
       AND (${exchange ?? null}::text IS NULL OR exchange = ${exchange ?? null})
       AND (upper(symbol) LIKE ${"%" + like + "%"} OR upper(name) LIKE ${"%" + like + "%"} OR isin = ${term})
     ORDER BY
       CASE WHEN upper(symbol) = ${term} THEN 0
            WHEN upper(symbol) LIKE ${like + "%"} THEN 1
            WHEN upper(name) LIKE ${like + "%"} OR upper(name) LIKE ${"% " + like + "%"} THEN 2
            ELSE 3 END,
       CASE exchange WHEN 'NSE' THEN 0 ELSE 1 END,
       has_derivatives DESC, length(symbol), symbol
     LIMIT ${Math.min(Math.max(limit, 1), 50)}`;
  return rows.map(toRow);
}

export async function getInstrument(exchange: string, symbol: string): Promise<InstrumentRow | null> {
  const sql = await db();
  const [row] = await sql<RawInstrument[]>`
    SELECT ${sql.unsafe(COLS)} FROM instruments
     WHERE exchange = ${exchange.toUpperCase()} AND symbol = ${symbol.toUpperCase()} AND active
     ORDER BY id LIMIT 1`;
  return row ? toRow(row) : null;
}

export type Underlying = { exchange: "NFO" | "BFO"; underlying: string; name: string; kind: "index" | "stock"; expiries: number; contracts: number };

export async function listUnderlyings(): Promise<Underlying[]> {
  const sql = await db();
  const rows = await sql<{ exchange: "NFO" | "BFO"; underlying: string; name: string; is_index: boolean; expiries: number; contracts: number }[]>`
    SELECT exchange, underlying, min(underlying_name) AS name,
           bool_or(instrument_type IN ('FUTIDX', 'OPTIDX')) AS is_index,
           count(DISTINCT expiry)::int AS expiries, count(*)::int AS contracts
      FROM derivative_contracts GROUP BY exchange, underlying
     ORDER BY bool_or(instrument_type IN ('FUTIDX', 'OPTIDX')) DESC, exchange, underlying`;
  return rows.map((r) => ({ exchange: r.exchange, underlying: r.underlying, name: r.name, kind: r.is_index ? "index" : "stock", expiries: r.expiries, contracts: r.contracts }));
}

export type ContractRow = {
  token: string; instrumentType: string; expiry: string; strike: number | null; optionType: "CE" | "PE" | null; lotSize: number; tickSize: number | null; breezeCode: string;
};

export type UnderlyingDetail = {
  exchange: "NFO" | "BFO"; underlying: string; name: string; breezeCode: string;
  futures: ContractRow[]; optionExpiries: string[]; selectedExpiry: string | null;
  chain: { strike: number; ce: ContractRow | null; pe: ContractRow | null }[];
};

export async function getUnderlying(underlying: string, expiry?: string, exchange?: string): Promise<UnderlyingDetail | null> {
  const sql = await db();
  const u = underlying.toUpperCase();
  const rows = await sql<{ exchange: "NFO" | "BFO"; token: string; instrument_type: string; underlying_name: string; breeze_code: string; expiry: Date; strike: string | null; option_type: "CE" | "PE" | null; lot_size: number; tick_size: string | null }[]>`
    SELECT exchange, token, instrument_type, underlying_name, breeze_code, expiry, strike, option_type, lot_size, tick_size
      FROM derivative_contracts
     WHERE underlying = ${u} AND (${exchange ?? null}::text IS NULL OR exchange = ${exchange?.toUpperCase() ?? null})
       AND expiry >= (now() AT TIME ZONE 'Asia/Kolkata')::date
     ORDER BY expiry, strike NULLS FIRST, option_type`;
  if (!rows.length) return null;

  const ex = rows[0].exchange;
  const mine = rows.filter((r) => r.exchange === ex);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const map = (r: (typeof rows)[number]): ContractRow => ({
    token: r.token, instrumentType: r.instrument_type, expiry: iso(r.expiry), strike: n(r.strike),
    optionType: r.option_type, lotSize: r.lot_size, tickSize: n(r.tick_size), breezeCode: r.breeze_code,
  });

  const futures = mine.filter((r) => r.instrument_type.startsWith("FUT")).map(map);
  const options = mine.filter((r) => r.instrument_type.startsWith("OPT")).map(map);
  const optionExpiries = [...new Set(options.map((o) => o.expiry))];
  const selectedExpiry = expiry && optionExpiries.includes(expiry) ? expiry : (optionExpiries[0] ?? null);

  const byStrike = new Map<number, { strike: number; ce: ContractRow | null; pe: ContractRow | null }>();
  for (const o of options) {
    if (o.expiry !== selectedExpiry || o.strike === null) continue;
    const row = byStrike.get(o.strike) ?? { strike: o.strike, ce: null, pe: null };
    if (o.optionType === "CE") row.ce = o;
    if (o.optionType === "PE") row.pe = o;
    byStrike.set(o.strike, row);
  }

  return {
    exchange: ex, underlying: u, name: mine[0].underlying_name, breezeCode: mine[0].breeze_code,
    futures, optionExpiries, selectedExpiry,
    chain: [...byStrike.values()].sort((a, b) => a.strike - b.strike),
  };
}

// ---- Watchlists (always scoped by user id) ----

export type Watchlist = { id: number; name: string; items: InstrumentRow[] };

export async function listWatchlists(userId: number): Promise<Watchlist[]> {
  const sql = await db();
  const lists = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM watchlists WHERE user_id = ${userId} ORDER BY position, id`;
  if (!lists.length) return [];
  const items = await sql<(RawInstrument & { watchlist_id: string })[]>`
    SELECT wi.watchlist_id, ${sql.unsafe(COLS.split(", ").map((c) => "i." + c).join(", "))}
      FROM watchlist_items wi JOIN instruments i ON i.id = wi.instrument_id
     WHERE wi.watchlist_id IN ${sql(lists.map((l) => l.id))}
     ORDER BY wi.position, wi.added_at`;
  return lists.map((l) => ({
    id: Number(l.id),
    name: l.name,
    items: items.filter((i) => i.watchlist_id === l.id).map(toRow),
  }));
}

export const WATCHLIST_LIMITS = { lists: 10, itemsPerList: 250, nameLength: 40 };
