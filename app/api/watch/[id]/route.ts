import { db } from "@/lib/db";
import { addEntry, SECTIONS, type Section } from "@/lib/watch";
import { fail, json, userHandler } from "@/lib/api";

export const DELETE = userHandler<{ id: string }>(async ({ user, params }) => {
  const sql = await db();
  const r = await sql`DELETE FROM watch_items WHERE id = ${Number(params.id) || 0} AND user_id = ${user.id}`;
  return r.count ? json({ ok: true }) : fail("Item not found.", 404);
});

/** Edit (pen): replace the item with another index or contract. */
export const PATCH = userHandler<{ id: string }>(async ({ user, params, body }) => {
  const b = (body ?? {}) as { section?: string; exchange?: string; key?: string };
  if (!SECTIONS.includes(b.section as Section) || !b.key) return fail("section and key are required.");
  const err = await addEntry(user.id, b.section as Section, String(b.exchange ?? ""), String(b.key), Number(params.id) || 0);
  return err ? fail(err, 400) : json({ ok: true });
});
