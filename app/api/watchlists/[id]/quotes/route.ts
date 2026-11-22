import { db } from "@/lib/db";
import { getQuotes } from "@/lib/brokers/quotes";
import { isVaultConfigured } from "@/lib/brokers/vault";
import { fail, json, userHandler } from "@/lib/api";

export const GET = userHandler<{ id: string }>(async ({ user, params }) => {
  const sql = await db();
  const items = await sql<{ id: string; exchange: string; symbol: string; token: string; breeze_code: string }[]>`
    SELECT i.id, i.exchange, i.symbol, i.token, i.breeze_code
      FROM watchlist_items wi JOIN watchlists w ON w.id = wi.watchlist_id JOIN instruments i ON i.id = wi.instrument_id
     WHERE w.id = ${Number(params.id) || 0} AND w.user_id = ${user.id} ORDER BY wi.position, wi.added_at`;
  if (!items.length) return json({ ok: true, broker: null, quotes: {} });
  // NSE quotes (BSE listings fall back to end-of-day).
  const reqs = items.filter((i) => i.exchange === "NSE").map((i) => ({ key: String(i.id), kind: "stock" as const, symbol: i.symbol, token: i.token, breezeCode: i.breeze_code }));
  const live = isVaultConfigured() ? await getQuotes(user.id, reqs, { maxCalls: 25 }) : { broker: null, brokerName: null, quotes: {} };
  // End-of-day fallback from the screener snapshot.
  const eod = await sql<{ symbol: string; close: number; change_pct: number; volume: number; d: Date }[]>`
    SELECT symbol, close, change_pct, volume, d FROM screener_snapshot WHERE symbol IN ${sql(items.map((i) => i.symbol))}`;
  if (!items.some(Boolean)) return fail("Not found.", 404);
  return json({
    ok: true,
    broker: live.brokerName,
    error: "error" in live ? live.error : undefined,
    quotes: live.quotes,
    eod: Object.fromEntries(eod.map((e) => [e.symbol, { close: e.close, changePct: e.change_pct, volume: e.volume, date: e.d.toISOString().slice(0, 10) }])),
  });
});
