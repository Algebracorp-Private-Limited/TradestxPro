import { db } from "@/lib/db";
import { SORT_KEYS, sanitizeFilters, type SortKey } from "@/lib/screener";
import { json, userHandler } from "@/lib/api";

type Row = {
  symbol: string; name: string; d: Date; close: number; change_pct: number; volume: number; rel_vol: number | null;
  rsi14: number | null; ema20: number | null; ema50: number | null; ema200: number | null; adx14: number | null;
  atr_pct: number | null; supertrend_dir: number | null; ret5: number | null; ret20: number | null; ret60: number | null;
  high52: number; low52: number; macd_hist: number | null; has_derivatives: boolean;
};

export const POST = userHandler(async ({ body }) => {
  const b = (body ?? {}) as Record<string, unknown>;
  const f = sanitizeFilters(b.filters);
  const sort: SortKey = SORT_KEYS.includes(b.sort as SortKey) ? (b.sort as SortKey) : "change_pct";
  const dir = b.dir === "asc" ? "ASC" : "DESC";
  const limit = Math.min(500, Math.max(1, Number(b.limit) || 200));

  const sql = await db();
  const conds: unknown[] = [sql`true`];
  const add = (c: unknown) => conds.push(c);
  if (f.universe === "fno") add(sql`has_derivatives`);
  if (f.priceMin !== undefined) add(sql`close >= ${f.priceMin}`);
  if (f.priceMax !== undefined) add(sql`close <= ${f.priceMax}`);
  if (f.changeMin !== undefined) add(sql`change_pct >= ${f.changeMin}`);
  if (f.changeMax !== undefined) add(sql`change_pct <= ${f.changeMax}`);
  if (f.volumeMin !== undefined) add(sql`volume >= ${f.volumeMin}`);
  if (f.relVolMin !== undefined) add(sql`rel_vol >= ${f.relVolMin}`);
  if (f.rsiMin !== undefined) add(sql`rsi14 >= ${f.rsiMin}`);
  if (f.rsiMax !== undefined) add(sql`rsi14 <= ${f.rsiMax}`);
  if (f.adxMin !== undefined) add(sql`adx14 >= ${f.adxMin}`);
  if (f.ret20Min !== undefined) add(sql`ret20 >= ${f.ret20Min}`);
  if (f.ret20Max !== undefined) add(sql`ret20 <= ${f.ret20Max}`);
  if (f.aboveEma20) add(sql`close > ema20`);
  if (f.aboveEma50) add(sql`close > ema50`);
  if (f.aboveEma200) add(sql`close > ema200`);
  if (f.belowEma50) add(sql`close < ema50`);
  if (f.belowEma200) add(sql`close < ema200`);
  if (f.emaStack) add(sql`close > ema20 AND ema20 > ema50 AND ema50 > ema200`);
  if (f.near52High !== undefined) add(sql`close >= high52 * (1 - ${f.near52High} / 100.0)`);
  if (f.near52Low !== undefined) add(sql`close <= low52 * (1 + ${f.near52Low} / 100.0)`);
  if (f.macdBullCross) add(sql`macd_hist > 0 AND macd_hist_prev <= 0`);
  if (f.macdBearCross) add(sql`macd_hist < 0 AND macd_hist_prev >= 0`);
  if (f.supertrend === "up") add(sql`supertrend_dir = 1`);
  if (f.supertrend === "down") add(sql`supertrend_dir = -1`);

  const where = conds.reduce((acc, c) => sql`${acc as never} AND ${c as never}`) as never;
  const orderCol = sort === "dist52h" ? sql`(close / NULLIF(high52, 0))` : sql(sort);

  const [rows, [{ total, asof }]] = await Promise.all([
    sql<Row[]>`
      SELECT symbol, name, d, close, change_pct, volume, rel_vol, rsi14, ema20, ema50, ema200, adx14, atr_pct,
             supertrend_dir, ret5, ret20, ret60, high52, low52, macd_hist, has_derivatives
        FROM screener_snapshot WHERE ${where}
       ORDER BY ${orderCol} ${sql.unsafe(dir)} NULLS LAST, symbol
       LIMIT ${limit}`,
    sql<{ total: number; asof: Date | null }[]>`SELECT count(*)::int AS total, max(d) AS asof FROM screener_snapshot WHERE ${where}`,
  ]);

  return json({
    ok: true,
    asOf: asof ? asof.toISOString().slice(0, 10) : null,
    total,
    results: rows.map((r) => ({
      symbol: r.symbol, name: r.name, close: r.close, changePct: r.change_pct, volume: r.volume, relVol: r.rel_vol,
      rsi: r.rsi14, adx: r.adx14, atrPct: r.atr_pct, supertrend: r.supertrend_dir, ret5: r.ret5, ret20: r.ret20, ret60: r.ret60,
      dist52h: r.high52 ? (r.close / r.high52 - 1) * 100 : null,
      trend: r.ema20 && r.ema50 && r.ema200 ? (r.close > r.ema20 && r.ema20 > r.ema50 && r.ema50 > r.ema200 ? "up" : r.close < r.ema200 ? "down" : "mixed") : null,
      macdHist: r.macd_hist, fno: r.has_derivatives,
    })),
  });
});
