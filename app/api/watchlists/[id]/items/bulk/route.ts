import { db } from "@/lib/db";
import { getConstituents, hasConstituents } from "@/lib/constituents";
import { WATCHLIST_LIMITS } from "@/lib/market-data";
import { fail, json, userHandler } from "@/lib/api";

/** Adds every constituent of an NSE index to the watchlist. */
export const POST = userHandler<{ id: string }>(async ({ user, body, params }) => {
  const index = String((body as { index?: unknown })?.index ?? "");
  if (!hasConstituents(index)) return fail("That index has no constituent list.", 400);
  const sql = await db();
  const [list] = await sql<{ id: string; n: number }[]>`
    SELECT w.id, (SELECT count(*)::int FROM watchlist_items WHERE watchlist_id = w.id) AS n
      FROM watchlists w WHERE w.id = ${Number(params.id) || 0} AND w.user_id = ${user.id}`;
  if (!list) return fail("Watchlist not found.", 404);
  const members = await getConstituents(index);
  if (!members.length) return fail("Could not load the constituent list from NSE right now. Please try again.", 502);
  const inst = await sql<{ id: string; symbol: string }[]>`
    SELECT DISTINCT ON (symbol) id, symbol FROM instruments
     WHERE exchange = 'NSE' AND active AND symbol IN ${sql(members.map((m) => m.symbol))} ORDER BY symbol, id`;
  const existing = await sql<{ instrument_id: string }[]>`SELECT instrument_id FROM watchlist_items WHERE watchlist_id = ${list.id}`;
  const have = new Set(existing.map((e) => e.instrument_id));
  const toAdd = inst.filter((i) => !have.has(i.id));
  const room = WATCHLIST_LIMITS.itemsPerList - list.n;
  if (toAdd.length > room) return fail(`That would exceed ${WATCHLIST_LIMITS.itemsPerList} symbols in this list (${toAdd.length} to add, ${room} free). Create a new list for it.`, 409);
  if (toAdd.length) {
    await sql`INSERT INTO watchlist_items ${sql(toAdd.map((t, i) => ({ watchlist_id: list.id, instrument_id: t.id, position: list.n + i })), "watchlist_id", "instrument_id", "position")}
              ON CONFLICT DO NOTHING`;
  }
  return json({ ok: true, added: toAdd.length, skipped: inst.length - toAdd.length, missing: members.length - inst.length });
});
