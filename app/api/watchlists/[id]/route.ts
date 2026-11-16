import { db } from "@/lib/db";
import { WATCHLIST_LIMITS } from "@/lib/market-data";
import { fail, json, userHandler } from "@/lib/api";

type P = { id: string };

export const PATCH = userHandler<P>(async ({ user, body, params }) => {
  const name = String((body as { name?: unknown })?.name ?? "").trim();
  if (!name || name.length > WATCHLIST_LIMITS.nameLength) return fail(`Name must be 1–${WATCHLIST_LIMITS.nameLength} characters.`);
  const sql = await db();
  const r = await sql`UPDATE watchlists SET name = ${name} WHERE id = ${Number(params.id) || 0} AND user_id = ${user.id}`;
  return r.count ? json({ ok: true }) : fail("Watchlist not found.", 404);
});

export const DELETE = userHandler<P>(async ({ user, params }) => {
  const sql = await db();
  const r = await sql`DELETE FROM watchlists WHERE id = ${Number(params.id) || 0} AND user_id = ${user.id}`;
  return r.count ? json({ ok: true }) : fail("Watchlist not found.", 404);
});
