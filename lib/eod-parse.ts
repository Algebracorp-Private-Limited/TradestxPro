// Pure parsers for NSE end-of-day files. Unit tested.
import { parseCsv } from "./csv.ts";

export type EodBar = { series: string; d: string; o: number; h: number; l: number; c: number; v: number };
export type IndexMeta = { key: string; name: string; close: number; change_pct: number | null; pe: number | null; pb: number | null; div_yield: number | null };

const num = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const t = v.trim();
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export const indexSeries = (key: string) => `NSEIDX:${key}`;
export const equitySeries = (symbol: string) => `NSE:${symbol}`;

/** ind_close_all_DDMMYYYY.csv */
export function parseIndexFile(text: string, isoDate: string): { bars: EodBar[]; meta: IndexMeta[] } {
  const bars: EodBar[] = [];
  const meta: IndexMeta[] = [];
  for (const r of parseCsv(text)) {
    const name = r["Index Name"]?.trim();
    const c = num(r["Closing Index Value"]);
    if (!name || c === null || c <= 0) continue;
    const o = num(r["Open Index Value"]) ?? c;
    const h = num(r["High Index Value"]) ?? Math.max(o, c);
    const l = num(r["Low Index Value"]) ?? Math.min(o, c);
    const key = name.toUpperCase();
    bars.push({
      series: indexSeries(key), d: isoDate,
      // NSE reports 0/blank OHLC for some indices; fall back to close so bars stay valid.
      o: o > 0 ? o : c, h: h > 0 ? Math.max(h, c) : c, l: l > 0 ? Math.min(l, c) : c, c,
      v: num(r["Volume"]) ?? 0,
    });
    meta.push({ key, name, close: c, change_pct: num(r["Change(%)"]), pe: num(r["P/E"]), pb: num(r["P/B"]), div_yield: num(r["Div Yield"]) });
  }
  return { bars, meta };
}

const EQUITY_SERIES = new Set(["EQ", "BE", "BZ", "SM", "ST"]);

/** BhavCopy_NSE_CM_0_0_0_YYYYMMDD_F_0000.csv (UDiFF format). */
export function parseEquityBhavcopy(text: string): EodBar[] {
  const out: EodBar[] = [];
  for (const r of parseCsv(text)) {
    if (r.FinInstrmTp !== "STK" || !EQUITY_SERIES.has(r.SctySrs)) continue;
    const symbol = r.TckrSymb?.trim();
    const c = num(r.ClsPric);
    const o = num(r.OpnPric);
    const h = num(r.HghPric);
    const l = num(r.LwPric);
    const d = r.TradDt?.trim();
    if (!symbol || !d || c === null || o === null || h === null || l === null || c <= 0) continue;
    out.push({ series: equitySeries(symbol), d, o, h, l, c, v: num(r.TtlTradgVol) ?? 0 });
  }
  return out;
}

export function nseIndexUrl(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `https://nsearchives.nseindia.com/content/indices/ind_close_all_${d}${m}${y}.csv`;
}

export function nseEquityUrl(iso: string): string {
  return `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${iso.replaceAll("-", "")}_F_0000.csv.zip`;
}

/** Weekdays (Mon–Fri) from `from` back `days` calendar days, newest first. */
export function recentWeekdays(fromIso: string, days: number): string[] {
  const out: string[] = [];
  const base = new Date(fromIso + "T00:00:00Z");
  for (let i = 0; i < days; i++) {
    const d = new Date(base.getTime() - i * 86400_000);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
