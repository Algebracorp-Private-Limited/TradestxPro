import { db } from "@/lib/db";
import { WATCHLIST_LIMITS, listWatchlists } from "@/lib/market-data";
import { fail, json, userHandler } from "@/lib/api";

export const GET = userHandler(async ({ user }) => json({ ok: true, watchlists: await listWatchlists(user.id) }));

export const POST = userHandler(async ({ user, body }) => {
  const name = String((body as { name?: unknown })?.name ?? "").trim();
  if (!name || name.length > WATCHLIST_LIMITS.nameLength) return fail(`Name must be 1–${WATCHLIST_LIMITS.nameLength} characters.`);
  const sql = await db();
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM watchlists WHERE user_id = ${user.id}`;
  if (n >= WATCHLIST_LIMITS.lists) return fail(`You can have up to ${WATCHLIST_LIMITS.lists} watchlists.`, 409);
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO watchlists (user_id, name, position) VALUES (${user.id}, ${name}, ${n}) RETURNING id`;
  return json({ ok: true, id: Number(row.id) }, 201);
});
