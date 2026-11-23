import { db } from "@/lib/db";
import { SORT_KEYS, sanitizeFilters } from "@/lib/screener";
import { fail, json, userHandler } from "@/lib/api";

export const GET = userHandler(async ({ user }) => {
  const sql = await db();
  const rows = await sql<{ id: string; name: string; filters: unknown; sort: string | null; dir: string | null; updated_at: Date }[]>`
    SELECT id, name, filters, sort, dir, updated_at FROM saved_screens WHERE user_id = ${user.id} ORDER BY updated_at DESC`;
  return json({ ok: true, screens: rows.map((r) => ({ id: Number(r.id), name: r.name, filters: r.filters, sort: r.sort, dir: r.dir, updatedAt: r.updated_at.toISOString() })) });
});

/** Saves a screener (same name overwrites). */
export const POST = userHandler(async ({ user, body }) => {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? "").trim().slice(0, 60);
  if (!name) return fail("Give your screener a name.");
  const filters = sanitizeFilters(b.filters);
  if (!Object.keys(filters).length) return fail("Add at least one filter before saving.");
  const sort = SORT_KEYS.includes(b.sort as never) ? String(b.sort) : null;
  const dir = b.dir === "asc" ? "asc" : "desc";
  const sql = await db();
  const [existing] = await sql<{ id: string }[]>`SELECT id FROM saved_screens WHERE user_id = ${user.id} AND lower(name) = lower(${name})`;
  if (existing) {
    await sql`UPDATE saved_screens SET filters = ${sql.json(filters as never)}, sort = ${sort}, dir = ${dir}, updated_at = now() WHERE id = ${existing.id}`;
    return json({ ok: true, id: Number(existing.id), updated: true });
  }
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM saved_screens WHERE user_id = ${user.id}`;
  if (n >= 50) return fail("You can save up to 50 screeners.", 409);
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO saved_screens (user_id, name, filters, sort, dir) VALUES (${user.id}, ${name}, ${sql.json(filters as never)}, ${sort}, ${dir}) RETURNING id`;
  return json({ ok: true, id: Number(row.id) }, 201);
});
