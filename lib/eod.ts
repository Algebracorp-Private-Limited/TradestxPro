import "server-only";
import { unzipSync } from "fflate";
import { db } from "./db";
import { istToday } from "./instrument-map.ts";
import { nseEquityUrl, nseIndexUrl, parseEquityBhavcopy, parseIndexFile, recentWeekdays, type EodBar } from "./eod-parse.ts";
import * as ta from "./ta/indicators.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
export const BACKFILL_DAYS = 420;
const LEASE_SECONDS = 330; // longer than the 300 s function limit, so a killed run frees it

async function download(url: string): Promise<ArrayBuffer | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*", Referer: "https://www.nseindia.com/" },
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 404) return null; // holiday / not yet published
  if (!res.ok) throw new Error(`NSE responded ${res.status} for ${url.split("/").pop()}`);
  return res.arrayBuffer();
}

type Sql = Awaited<ReturnType<typeof db>>;

async function insertBars(sql: Sql, bars: EodBar[]) {
  for (let i = 0; i < bars.length; i += 2000) {
    const part = bars.slice(i, i + 2000);
    await sql`
      INSERT INTO candles ${sql(part, "series", "d", "o", "h", "l", "c", "v")}
      ON CONFLICT (series, d) DO UPDATE SET o = EXCLUDED.o, h = EXCLUDED.h, l = EXCLUDED.l, c = EXCLUDED.c, v = EXCLUDED.v`;
  }
}

async function mark(sql: Sql, kind: string, d: string, status: string, rows: number, error?: string) {
  await sql`
    INSERT INTO eod_days (exchange, kind, d, status, rows, error) VALUES ('NSE', ${kind}, ${d}, ${status}, ${rows}, ${error ?? null})
    ON CONFLICT (exchange, kind, d) DO UPDATE SET status = EXCLUDED.status, rows = EXCLUDED.rows, error = EXCLUDED.error, loaded_at = now()`;
}

export async function ingestDay(sql: Sql, d: string): Promise<{ index: number | null; equity: number | null }> {
  const result = { index: null as number | null, equity: null as number | null };

  const idx = await download(nseIndexUrl(d));
  if (idx) {
    const { bars, meta } = parseIndexFile(new TextDecoder().decode(idx), d);
    await insertBars(sql, bars);
    const uniq = [...new Map(meta.map((m) => [m.key, { ...m, last_d: d }])).values()];
    if (uniq.length) {
      await sql`
        INSERT INTO market_indices ${sql(uniq, "key", "name", "last_d", "close", "change_pct", "pe", "pb", "div_yield")}
        ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, last_d = EXCLUDED.last_d, close = EXCLUDED.close,
          change_pct = EXCLUDED.change_pct, pe = EXCLUDED.pe, pb = EXCLUDED.pb, div_yield = EXCLUDED.div_yield
        WHERE market_indices.last_d IS NULL OR market_indices.last_d <= EXCLUDED.last_d`;
    }
    result.index = bars.length;
  }
  await mark(sql, "index", d, idx ? "ok" : "no_data", result.index ?? 0);

  const eq = await download(nseEquityUrl(d));
  if (eq) {
    const files = unzipSync(new Uint8Array(eq));
    const csv = Object.values(files)[0];
    const bars = csv ? parseEquityBhavcopy(new TextDecoder().decode(csv)) : [];
    await insertBars(sql, bars);
    result.equity = bars.length;
  }
  await mark(sql, "equity", d, eq ? "ok" : "no_data", result.equity ?? 0);
  return result;
}

/** Today's file is published after market close; only try it after 18:30 IST. */
function latestTradingCandidate(now = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const today = istToday(now);
  return minutes >= 18 * 60 + 30 ? today : new Date(new Date(today + "T00:00:00Z").getTime() - 86400_000).toISOString().slice(0, 10);
}

export type EodRunResult = { processed: { d: string; index: number | null; equity: number | null }[]; remaining: number; snapshot?: number; locked?: boolean };

/**
 * Loads missing NSE end-of-day files, newest first, within a time budget, then rebuilds the
 * screener snapshot once nothing is missing. Safe to call repeatedly: a lease row (which expires
 * on its own if the function is killed) prevents concurrent runs.
 */
export async function runEod(budgetMs = 150_000): Promise<EodRunResult> {
  const t0 = Date.now();
  const sql = await db();
  const got = await sql`
    INSERT INTO job_locks (name, until) VALUES ('eod', now() + ${LEASE_SECONDS} * interval '1 second')
    ON CONFLICT (name) DO UPDATE SET until = EXCLUDED.until WHERE job_locks.until < now()
    RETURNING name`;
  if (!got.length) return { processed: [], remaining: -1, locked: true };
  try {
    const candidates = recentWeekdays(latestTradingCandidate(), BACKFILL_DAYS);
    const done = await sql<{ d: Date }[]>`
      SELECT d FROM eod_days WHERE exchange = 'NSE' AND kind = 'equity' AND status IN ('ok', 'no_data') AND d >= ${candidates[candidates.length - 1]}`;
    const doneSet = new Set(done.map((r) => r.d.toISOString().slice(0, 10)));
    const todo = candidates.filter((d) => !doneSet.has(d));
    const processed: EodRunResult["processed"] = [];
    for (const d of todo) {
      if (Date.now() - t0 > budgetMs) break;
      try {
        processed.push({ d, ...(await ingestDay(sql, d)) });
      } catch (e) {
        await mark(sql, "equity", d, "error", 0, String(e).slice(0, 300));
        throw e;
      }
    }
    const remaining = todo.length - processed.length;
    let snapshot: number | undefined;
    const [{ n, snapD }] = await sql<{ n: number; snapD: Date | null }[]>`
      SELECT count(*)::int AS n, max(d) AS "snapD" FROM screener_snapshot`;
    const [{ lastD }] = await sql<{ lastD: Date | null }[]>`
      SELECT max(d) AS "lastD" FROM eod_days WHERE exchange = 'NSE' AND kind = 'equity' AND status = 'ok'`;
    const stale = n === 0 || !snapD || (lastD && snapD.getTime() < lastD.getTime());
    if (remaining === 0 && stale && Date.now() - t0 < 200_000) snapshot = await buildSnapshot(sql);
    return { processed, remaining, snapshot };
  } finally {
    await sql`DELETE FROM job_locks WHERE name = 'eod'`;
  }
}

/** Recomputes the screener snapshot from the last ~260 bars of every NSE equity. */
export async function buildSnapshot(sql: Sql): Promise<number> {
  const [{ last }] = await sql<{ last: Date | null }[]>`
    SELECT max(d) AS last FROM eod_days WHERE exchange = 'NSE' AND kind = 'equity' AND status = 'ok'`;
  if (!last) return 0;
  const lastD = last.toISOString().slice(0, 10);
  const from = new Date(last.getTime() - 400 * 86400_000).toISOString().slice(0, 10);
  const symbols = await sql<{ series: string }[]>`SELECT DISTINCT series FROM candles WHERE d = ${lastD} AND series LIKE 'NSE:%'`;
  const meta = await sql<{ symbol: string; name: string; has_derivatives: boolean }[]>`
    SELECT symbol, name, has_derivatives FROM instruments WHERE exchange = 'NSE' AND active`;
  const metaBy = new Map(meta.map((m) => [m.symbol, m]));

  const rows: Record<string, unknown>[] = [];
  const list = symbols.map((s) => s.series);
  for (let i = 0; i < list.length; i += 400) {
    const chunk = list.slice(i, i + 400);
    const bars = await sql<{ series: string; h: number; l: number; c: number; v: number }[]>`
      SELECT series, h, l, c, v FROM candles WHERE series IN ${sql(chunk)} AND d >= ${from} ORDER BY series, d`;
    const by = new Map<string, { h: number[]; l: number[]; c: number[]; v: number[] }>();
    for (const b of bars) {
      let s = by.get(b.series);
      if (!s) by.set(b.series, (s = { h: [], l: [], c: [], v: [] }));
      s.h.push(b.h); s.l.push(b.l); s.c.push(b.c); s.v.push(b.v);
    }
    for (const [series, s] of by) {
      const n = s.c.length;
      if (n < 2) continue;
      const last = n - 1;
      const pick = (arr: number[]) => (Number.isFinite(arr[last]) ? arr[last] : null);
      const ret = (k: number) => (n > k ? (s.c[last] / s.c[last - k] - 1) * 100 : null);
      const yr = Math.min(n, 250);
      const avg20 = ta.sma(s.v, 20);
      const m = ta.macd(s.c);
      const st = ta.supertrend(s.h, s.l, s.c, 10, 3);
      const symbol = series.slice(4);
      const info = metaBy.get(symbol);
      rows.push({
        symbol, d: lastD, name: info?.name ?? symbol,
        close: s.c[last], change_pct: (s.c[last] / s.c[last - 1] - 1) * 100, volume: s.v[last],
        avg_vol20: pick(avg20), rel_vol: Number.isFinite(avg20[last]) && avg20[last] > 0 ? s.v[last] / avg20[last] : null,
        high52: Math.max(...s.h.slice(n - yr)), low52: Math.min(...s.l.slice(n - yr)),
        rsi14: pick(ta.rsi(s.c, 14)), ema20: pick(ta.ema(s.c, 20)), ema50: pick(ta.ema(s.c, 50)), ema200: pick(ta.ema(s.c, 200)),
        macd_hist: pick(m.hist), macd_hist_prev: Number.isFinite(m.hist[last - 1]) ? m.hist[last - 1] : null,
        adx14: pick(ta.adx(s.h, s.l, s.c, 14).adx),
        atr_pct: (() => { const a = ta.atr(s.h, s.l, s.c, 14)[last]; return Number.isFinite(a) ? (a / s.c[last]) * 100 : null; })(),
        supertrend_dir: Number.isFinite(st.dir[last]) ? st.dir[last] : null,
        ret5: ret(5), ret20: ret(20), ret60: ret(60), bars: n, has_derivatives: info?.has_derivatives ?? false,
      });
    }
  }

  await sql.begin(async (tx) => {
    await tx`DELETE FROM screener_snapshot`;
    for (let i = 0; i < rows.length; i += 1000) {
      const part = rows.slice(i, i + 1000);
      await tx`INSERT INTO screener_snapshot ${tx(part as never[])}`;
    }
  });
  return rows.length;
}

export async function eodStatus() {
  const sql = await db();
  const [r] = await sql<{ last: Date | null; days: number; errors: number; err: string | null; snap: number }[]>`
    SELECT max(d) FILTER (WHERE status = 'ok') AS last, count(*) FILTER (WHERE status = 'ok')::int AS days,
           count(*) FILTER (WHERE status = 'error')::int AS errors,
           (SELECT error FROM eod_days WHERE status = 'error' ORDER BY loaded_at DESC LIMIT 1) AS err,
           (SELECT count(*)::int FROM screener_snapshot) AS snap
      FROM eod_days WHERE exchange = 'NSE' AND kind = 'equity'`;
  return {
    lastDate: r?.last ? r.last.toISOString().slice(0, 10) : null,
    days: r?.days ?? 0,
    errors: r?.errors ?? 0,
    lastError: r?.err ?? null,
    screenerRows: r?.snap ?? 0,
  };
}
