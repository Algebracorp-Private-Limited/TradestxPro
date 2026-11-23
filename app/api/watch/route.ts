import { addEntry, listWatch, SECTIONS, type Section } from "@/lib/watch";
import { fail, json, userHandler } from "@/lib/api";

export const GET = userHandler(async ({ user }) => json({ ok: true, ...(await listWatch(user.id)) }));

export const POST = userHandler(async ({ user, body }) => {
  const b = (body ?? {}) as { section?: string; exchange?: string; key?: string };
  if (!SECTIONS.includes(b.section as Section) || !b.key) return fail("section and key are required.");
  const err = await addEntry(user.id, b.section as Section, String(b.exchange ?? ""), String(b.key));
  return err ? fail(err, 400) : json({ ok: true });
});
