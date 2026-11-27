/**
 * Unified instrument master (pure part). Normalises the reference data the platform already
 * syncs (ICICI security master → `instruments`, `derivative_contracts`; NSE index constituents →
 * `index_constituents`) into one type. Lot sizes, tick sizes, expiries and strikes come only from
 * that reference data: nothing here is hard-coded per symbol.
 *
 * Settlement: NSE index derivatives are cash-settled; NSE stock derivatives have been physically
 * settled since October 2019 (SEBI circular SEBI/HO/MRD/DP/CIR/P/2018/67). Expiry time: contracts
 * expire at the close of trading (15:30 IST) on the expiry date.
 */
export type InstrumentKind = "equity" | "index" | "future" | "option";
export type OptionRight = "CE" | "PE";

export type Instrument = {
  /** Canonical id: NSE:RELIANCE · NSEIDX:NIFTY 50 · NFO:FUT:RELIANCE:2026-12-29 · NFO:OPT:NIFTY:2026-12-29:24000:CE */
  id: string;
  kind: InstrumentKind;
  exchange: "NSE" | "BSE" | "NFO" | "BFO";
  symbol: string;
  name: string;
  isin: string | null;
  /** Industry from NSE index constituent files (null when the stock is in no synced index). */
  industry: string | null;
  indexMembership: string[];
  foEligible: boolean;
  underlying: string | null;
  expiry: string | null;
  /** Expiry instant (15:30 IST on the expiry date), ISO-8601. */
  expiryTime: string | null;
  strike: number | null;
  right: OptionRight | null;
  lotSize: number | null;
  tickSize: number | null;
  settlement: "cash" | "physical" | null;
  exchangeToken: string | null;
  /** Reference data the platform does not have for this instrument (reported, not guessed). */
  unavailable: string[];
};

export const UNAVAILABLE_REFERENCE = ["corporate actions", "trading restrictions (F&O ban list)", "historical instrument definitions"];
export const INDEX_UNDERLYINGS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"]);

export const expiryTime = (expiry: string) => `${expiry}T10:00:00.000Z`; // 15:30 IST = 10:00 UTC

export type EquityRow = { exchange: string; token: string; symbol: string; name: string; isin: string | null; tick_size: number | string | null; lot_size: number | null; has_derivatives: boolean };
export type ContractRow = { exchange: string; token: string; instrument_type: string; underlying: string; underlying_name: string; expiry: string | Date; strike: number | string | null; option_type: string | null; lot_size: number; tick_size: number | string | null };
export type ConstituentRow = { index_key: string; symbol: string; industry: string | null; isin: string | null };

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const day = (d: string | Date) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

export function equityInstrument(r: EquityRow, constituents: ConstituentRow[]): Instrument {
  const mine = constituents.filter((c) => c.symbol === r.symbol);
  return {
    id: `${r.exchange}:${r.symbol}`, kind: "equity", exchange: r.exchange as Instrument["exchange"], symbol: r.symbol, name: r.name,
    isin: r.isin ?? mine.find((c) => c.isin)?.isin ?? null, industry: mine.find((c) => c.industry)?.industry ?? null,
    indexMembership: [...new Set(mine.map((c) => c.index_key))].sort(), foEligible: r.has_derivatives, underlying: null, expiry: null, expiryTime: null,
    strike: null, right: null, lotSize: num(r.lot_size), tickSize: num(r.tick_size), settlement: null, exchangeToken: r.token, unavailable: UNAVAILABLE_REFERENCE,
  };
}

export function indexInstrument(key: string, name = key): Instrument {
  return {
    id: `NSEIDX:${key}`, kind: "index", exchange: "NSE", symbol: key, name, isin: null, industry: null, indexMembership: [], foEligible: false,
    underlying: null, expiry: null, expiryTime: null, strike: null, right: null, lotSize: null, tickSize: null, settlement: null, exchangeToken: null, unavailable: ["corporate actions"],
  };
}

export function contractInstrument(r: ContractRow): Instrument {
  const isOpt = r.instrument_type.startsWith("OPT");
  const expiry = day(r.expiry);
  const strike = isOpt ? num(r.strike) : null;
  const right = isOpt ? (r.option_type as OptionRight) : null;
  const isIndex = r.instrument_type.endsWith("IDX") || INDEX_UNDERLYINGS.has(r.underlying);
  return {
    id: isOpt ? `${r.exchange}:OPT:${r.underlying}:${expiry}:${strike}:${right}` : `${r.exchange}:FUT:${r.underlying}:${expiry}`,
    kind: isOpt ? "option" : "future", exchange: r.exchange as Instrument["exchange"], symbol: r.underlying, name: r.underlying_name,
    isin: null, industry: null, indexMembership: [], foEligible: true, underlying: r.underlying, expiry, expiryTime: expiryTime(expiry), strike, right,
    lotSize: num(r.lot_size), tickSize: num(r.tick_size), settlement: isIndex ? "cash" : "physical", exchangeToken: r.token, unavailable: UNAVAILABLE_REFERENCE,
  };
}

/** Parses canonical ids (see `Instrument.id`); null when malformed. */
export function parseInstrumentId(id: string): { kind: InstrumentKind; exchange: string; symbol: string; expiry?: string; strike?: number; right?: OptionRight } | null {
  if (typeof id !== "string" || id.length > 120) return null;
  let m = /^NSEIDX:([A-Z0-9 &.-]{2,40})$/.exec(id);
  if (m) return { kind: "index", exchange: "NSE", symbol: m[1] };
  m = /^(NSE|BSE):([A-Z0-9&.-]{1,30})$/.exec(id);
  if (m) return { kind: "equity", exchange: m[1], symbol: m[2] };
  m = /^(NFO|BFO):FUT:([A-Z0-9&.-]{1,30}):(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (m) return { kind: "future", exchange: m[1], symbol: m[2], expiry: m[3] };
  m = /^(NFO|BFO):OPT:([A-Z0-9&.-]{1,30}):(\d{4}-\d{2}-\d{2}):(\d+(?:\.\d+)?):(CE|PE)$/.exec(id);
  if (m) return { kind: "option", exchange: m[1], symbol: m[2], expiry: m[3], strike: Number(m[4]), right: m[5] as OptionRight };
  return null;
}

/**
 * Union of index constituents with deduplication. Returns each symbol once with every index it
 * belongs to, plus counts so a scan can report overlap honestly.
 */
export function dedupeUniverse(lists: { index: string; symbols: string[] }[]): { symbols: string[]; membership: Record<string, string[]>; selected: number; duplicates: number } {
  const membership: Record<string, string[]> = {};
  let selected = 0;
  for (const l of lists) {
    for (const raw of l.symbols) {
      const s = raw.trim().toUpperCase();
      if (!s) continue;
      selected++;
      (membership[s] ??= []).push(l.index);
    }
  }
  const symbols = Object.keys(membership).sort();
  return { symbols, membership, selected, duplicates: selected - symbols.length };
}
