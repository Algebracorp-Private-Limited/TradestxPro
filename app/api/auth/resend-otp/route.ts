import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/crypto";
import { issueOtp } from "@/lib/auth";
import { fail, json, postHandler } from "@/lib/api";

export const POST = postHandler(async (body) => {
  const email = normalizeEmail((body as Record<string, unknown>)?.email);
  if (!email) return fail("Email is required.");

  const sql = await db();
  const [user] = await sql<{ id: string; name: string; email_verified_at: Date | null }[]>`
    SELECT id, name, email_verified_at FROM users WHERE email = ${email}`;

  // Same response for unknown or already-verified emails, to avoid revealing accounts.
  if (user && !user.email_verified_at) {
    const sent = await issueOtp(Number(user.id), email, user.name);
    if (!sent.ok) return fail(sent.error, sent.status);
  }
  return json({ ok: true, message: "If that account needs verification, a new code has been sent." });
});
