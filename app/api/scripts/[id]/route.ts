import { db } from "@/lib/db";
import { fail, json, userHandler } from "@/lib/api";
import { validateScript } from "@/lib/scripts";

type P = { id: string };

export const PATCH = userHandler<P>(async ({ user, body, params }) => {
  const v = validateScript(body);
  if (typeof v === "string") return fail(v);
  const sql = await db();
  const r = await sql`UPDATE scripts SET name = ${v.name}, code = ${v.code}, updated_at = now()
                      WHERE id = ${Number(params.id) || 0} AND user_id = ${user.id}`;
  return r.count ? json({ ok: true }) : fail("Script not found.", 404);
});

export const DELETE = userHandler<P>(async ({ user, params }) => {
  const sql = await db();
  const r = await sql`DELETE FROM scripts WHERE id = ${Number(params.id) || 0} AND user_id = ${user.id}`;
  return r.count ? json({ ok: true }) : fail("Script not found.", 404);
});
