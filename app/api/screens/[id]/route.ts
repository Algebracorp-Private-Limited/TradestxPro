import { db } from "@/lib/db";
import { fail, json, userHandler } from "@/lib/api";

export const DELETE = userHandler<{ id: string }>(async ({ user, params }) => {
  const sql = await db();
  const r = await sql`DELETE FROM saved_screens WHERE id = ${Number(params.id) || 0} AND user_id = ${user.id}`;
  return r.count ? json({ ok: true }) : fail("Screener not found.", 404);
});
