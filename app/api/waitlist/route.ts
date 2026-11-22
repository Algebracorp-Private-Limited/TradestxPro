import { db } from "@/lib/db";
import { audit, clientIp, getSessionUser } from "@/lib/auth";
import { validateWaitlist } from "@/lib/waitlist";
import { fail, json, postHandler } from "@/lib/api";

export const POST = postHandler(async (body) => {
  // Honeypot: real people never fill the hidden "website" field.
  if ((body as Record<string, unknown>)?.website) return json({ ok: true });
  const v = validateWaitlist(body);
  if (!v.ok) return fail(v.error);
  const e = v.value;
  const sql = await db();
  const ip = await clientIp();
  if (ip) {
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM algo_waitlist WHERE ip = ${ip} AND created_at > now() - interval '1 hour'`;
    if (n >= 10) return fail("Too many sign-ups from this network. Please try again later.", 429);
  }
  const user = await getSessionUser().catch(() => null);
  const rows = await sql`
    INSERT INTO algo_waitlist (email, name, phone, broker, experience, interests, capital, notes, user_id, ip)
    VALUES (${e.email}, ${e.name}, ${e.phone}, ${e.broker}, ${e.experience}, ${e.interests}, ${e.capital}, ${e.notes}, ${user?.id ?? null}, ${ip})
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, phone = COALESCE(EXCLUDED.phone, algo_waitlist.phone),
      broker = COALESCE(EXCLUDED.broker, algo_waitlist.broker),
      experience = COALESCE(EXCLUDED.experience, algo_waitlist.experience),
      interests = CASE WHEN cardinality(EXCLUDED.interests) > 0 THEN EXCLUDED.interests ELSE algo_waitlist.interests END,
      capital = COALESCE(EXCLUDED.capital, algo_waitlist.capital), notes = COALESCE(EXCLUDED.notes, algo_waitlist.notes)
    RETURNING (xmax = 0) AS inserted`;
  await audit(user?.id ?? null, "algo_waitlist", { inserted: rows[0]?.inserted });
  return json({ ok: true, updated: !rows[0]?.inserted });
});
