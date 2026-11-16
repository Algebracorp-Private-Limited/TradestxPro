import { db } from "@/lib/db";
import { fail, json, userHandler } from "@/lib/api";

export const DELETE = userHandler<{ id: string; instrumentId: string }>(async ({ user, params }) => {
  const sql = await db();
  const r = await sql`
    DELETE FROM watchlist_items wi USING watchlists w
     WHERE wi.watchlist_id = w.id AND w.user_id = ${user.id}
       AND w.id = ${Number(params.id) || 0} AND wi.instrument_id = ${Number(params.instrumentId) || 0}`;
  return r.count ? json({ ok: true }) : fail("Not found.", 404);
});
