import { db } from "@/lib/db";
import { validIndexKeys } from "@/lib/overview";
import { fail, json, userHandler } from "@/lib/api";

/** Saves the user's chosen dashboard indices (empty list = back to defaults). */
export const PUT = userHandler(async ({ user, body }) => {
  const raw = (body as { indices?: unknown })?.indices;
  if (!Array.isArray(raw)) return fail("indices must be a list.");
  if (raw.length > 24) return fail("Choose up to 24 indices.");
  const keys = await validIndexKeys(raw.map(String));
  const sql = await db();
  await sql`
    INSERT INTO user_prefs (user_id, dashboard_indices, updated_at) VALUES (${user.id}, ${keys}, now())
    ON CONFLICT (user_id) DO UPDATE SET dashboard_indices = EXCLUDED.dashboard_indices, updated_at = now()`;
  return json({ ok: true, indices: keys });
});
