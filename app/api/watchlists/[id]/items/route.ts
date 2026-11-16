import { db } from "@/lib/db";
import { WATCHLIST_LIMITS } from "@/lib/market-data";
import { fail, json, userHandler } from "@/lib/api";

export const POST = userHandler<{ id: string }>(async ({ user, body, params }) => {
  const instrumentId = Number((body as { instrumentId?: unknown })?.instrumentId);
  if (!Number.isInteger(instrumentId) || instrumentId <= 0) return fail("instrumentId is required.");
  const sql = await db();
  const [list] = await sql<{ id: string; n: number }[]>`
    SELECT w.id, (SELECT count(*)::int FROM watchlist_items WHERE watchlist_id = w.id) AS n
      FROM watchlists w WHERE w.id = ${Number(params.id) || 0} AND w.user_id = ${user.id}`;
  if (!list) return fail("Watchlist not found.", 404);
  if (list.n >= WATCHLIST_LIMITS.itemsPerList) return fail(`A watchlist can hold up to ${WATCHLIST_LIMITS.itemsPerList} symbols.`, 409);
  const [inst] = await sql`SELECT 1 FROM instruments WHERE id = ${instrumentId} AND active`;
  if (!inst) return fail("Instrument not found.", 404);
  await sql`INSERT INTO watchlist_items (watchlist_id, instrument_id, position)
            VALUES (${list.id}, ${instrumentId}, ${list.n}) ON CONFLICT DO NOTHING`;
  return json({ ok: true }, 201);
});
