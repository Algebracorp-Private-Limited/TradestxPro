import { db } from "@/lib/db";
import { fail, json, userHandler } from "@/lib/api";
import { SCRIPT_LIMITS, validateScript as validate } from "@/lib/scripts";

export const GET = userHandler(async ({ user }) => {
  const sql = await db();
  const rows = await sql<{ id: string; name: string; code: string; updated_at: Date }[]>`
    SELECT id, name, code, updated_at FROM scripts WHERE user_id = ${user.id} ORDER BY updated_at DESC`;
  return json({ ok: true, scripts: rows.map((r) => ({ id: Number(r.id), name: r.name, code: r.code, updatedAt: r.updated_at.toISOString() })) });
});

export const POST = userHandler(async ({ user, body }) => {
  const v = validate(body);
  if (typeof v === "string") return fail(v);
  const sql = await db();
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM scripts WHERE user_id = ${user.id}`;
  if (n >= SCRIPT_LIMITS.count) return fail(`You can save up to ${SCRIPT_LIMITS.count} scripts.`, 409);
  const [row] = await sql<{ id: string }[]>`INSERT INTO scripts (user_id, name, code) VALUES (${user.id}, ${v.name}, ${v.code}) RETURNING id`;
  return json({ ok: true, id: Number(row.id) }, 201);
});
