// Pure mapping from ICICI security-master rows to TradestXPro instrument records. Unit tested.

export type CashInstrument = {
  exchange: "NSE" | "BSE";
  token: string;
  symbol: string;
  breeze_code: string;
  name: string;
  series: string | null;
  isin: string | null;
  tick_size: number | null;
  lot_size: number | null;
  face_value: number | null;
};

export type Contract = {
  exchange: "NFO" | "BFO";
  token: string;
  instrument_type: "FUTIDX" | "FUTSTK" | "OPTIDX" | "OPTSTK";
  underlying: string;
  underlying_name: string;
  breeze_code: string;
  expiry: string; // YYYY-MM-DD
  strike: number | null;
  option_type: "CE" | "PE" | null;
  lot_size: number;
  tick_size: number | null;
};

const NSE_EQUITY_SERIES = new Set(["EQ", "BE", "BZ", "SM", "ST"]);
const EQUITY_ISIN = /^INE[A-Z0-9]{4}01[A-Z0-9]{3}$/;

// ICICI short names for index underlyings -> exchange symbols.
const INDEX_SYMBOLS: Record<string, string> = {
  NIFTY: "NIFTY",
  CNXBAN: "BANKNIFTY",
  NIFFIN: "FINNIFTY",
  NIFSEL: "MIDCPNIFTY",
  NIFNEX: "NIFTYNXT50",
  NIF150: "NIFTYFPI150",
  BSESEN: "SENSEX",
  BANKEX: "BANKEX",
  BSESN5: "SENSEX50",
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "23-Nov-2026" -> "2026-11-23"; null when unparseable. */
export function parseIciciDate(v: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(v.trim());
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  return mon ? `${m[3]}-${mon}-${m[1].padStart(2, "0")}` : null;
}

function num(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function validToken(t: string | undefined): t is string {
  return Boolean(t && /^\d+$/.test(t) && Number(t) > 0);
}

export function mapNse(r: Record<string, string>): CashInstrument | null {
  const series = r.Series?.trim();
  const symbol = r.ExchangeCode?.trim();
  if (!NSE_EQUITY_SERIES.has(series) || !validToken(r.Token) || !symbol) return null;
  return {
    exchange: "NSE",
    token: r.Token,
    symbol,
    breeze_code: r.ShortName.trim(),
    name: r.CompanyName.trim(),
    series,
    isin: r.ISINCode?.trim() || null,
    tick_size: num(r.ticksize),
    lot_size: num(r.Lotsize),
    face_value: num(r.FaceValue),
  };
}

export function mapBse(r: Record<string, string>): CashInstrument | null {
  const isin = r.ISINCode?.trim();
  const symbol = (r.ScripID || r.ExchangeCode)?.trim();
  if (!isin || !EQUITY_ISIN.test(isin) || !validToken(r.ScripCode) || !symbol) return null;
  return {
    exchange: "BSE",
    token: r.ScripCode,
    symbol,
    breeze_code: r.ShortName.trim(),
    name: (r.ScripName || r.CompanyName).trim(),
    series: null,
    isin,
    tick_size: null, // ICICI's BSE file reuses this column for prices; not reliable
    lot_size: num(r.LotSize),
    face_value: num(r.FaceValue),
  };
}

export function mapContract(r: Record<string, string>, fallbackExchange: "NFO" | "BFO", today: string): Contract | null {
  const raw = r.InstrumentName?.trim();
  // BSE names index derivatives FUTIND / OPTIND; NSE uses FUTIDX / OPTIDX.
  const type = (raw === "FUTIND" ? "FUTIDX" : raw === "OPTIND" ? "OPTIDX" : raw) as Contract["instrument_type"];
  if (!["FUTIDX", "FUTSTK", "OPTIDX", "OPTSTK"].includes(type) || !validToken(r.Token)) return null;
  const expiry = parseIciciDate(r.ExpiryDate ?? "");
  if (!expiry || expiry < today) return null;
  const lot = num(r.LotSize);
  if (!lot) return null;
  const short = r.ShortName.trim();
  const isIndex = type === "FUTIDX" || type === "OPTIDX";
  const underlying = (isIndex ? INDEX_SYMBOLS[short] : undefined) ?? r.ExchangeCode?.trim() ?? short;
  const isOption = type.startsWith("OPT");
  const opt = r.OptionType?.trim();
  const exchange = r.ExAllowed === "NFO" || r.ExAllowed === "BFO" ? r.ExAllowed : fallbackExchange;
  return {
    exchange,
    token: r.Token,
    instrument_type: type,
    underlying,
    underlying_name: r.CompanyName.trim(),
    breeze_code: short,
    expiry,
    strike: isOption ? num(r.StrikePrice) : null,
    option_type: isOption && (opt === "CE" || opt === "PE") ? opt : null,
    lot_size: lot,
    tick_size: num(r.TickSize),
  };
}

/** Today's date in India (YYYY-MM-DD), used to drop expired contracts. */
export function istToday(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
