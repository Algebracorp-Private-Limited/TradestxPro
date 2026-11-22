import { db } from "@/lib/db";
import { fail, json, userHandler } from "@/lib/api";

/** Removes several symbols (or all, with { all: true }) from one of the user's watchlists. */
export const POST = userHandler<{ id: string }>(async ({ user, body, params }) => {
  const b = (body ?? {}) as { instrumentIds?: unknown; all?: unknown };
  const ids = Array.isArray(b.instrumentIds) ? b.instrumentIds.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500) : [];
  if (b.all !== true && !ids.length) return fail("Nothing selected.");
  const sql = await db();
  const [list] = await sql`SELECT id FROM watchlists WHERE id = ${Number(params.id) || 0} AND user_id = ${user.id}`;
  if (!list) return fail("Watchlist not found.", 404);
  const r = b.all === true
    ? await sql`DELETE FROM watchlist_items WHERE watchlist_id = ${list.id}`
    : await sql`DELETE FROM watchlist_items WHERE watchlist_id = ${list.id} AND instrument_id IN ${sql(ids)}`;
  return json({ ok: true, removed: r.count });
});
