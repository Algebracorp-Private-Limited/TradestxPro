import { db } from "@/lib/db";
import { normalizeEmail, safeEqualHex, sha256 } from "@/lib/crypto";
import { OTP_MAX_ATTEMPTS, TRIAL_DAYS, audit, createSession } from "@/lib/auth";
import { fail, json, postHandler } from "@/lib/api";

const GENERIC = "That code is invalid or has expired.";

export const POST = postHandler(async (body) => {
  const b = (body ?? {}) as Record<string, unknown>;
  const email = normalizeEmail(b.email);
  const code = String(b.code ?? "").replace(/\D/g, "");
  if (!email || code.length !== 6) return fail("Enter the 6-digit code from your email.");

  const sql = await db();
  const [row] = await sql<
    { id: string; code_hash: string | null; expires_at: Date | null; attempts: number | null; email_verified_at: Date | null }[]
  >`SELECT u.id, u.email_verified_at, o.code_hash, o.expires_at, o.attempts
      FROM users u LEFT JOIN email_otps o ON o.user_id = u.id
     WHERE u.email = ${email}`;

  if (!row || !row.code_hash || !row.expires_at) return fail(GENERIC);
  const userId = Number(row.id);
  if ((row.attempts ?? 0) >= OTP_MAX_ATTEMPTS) return fail("Too many incorrect attempts. Request a new code.", 429);
  if (row.expires_at.getTime() < Date.now()) return fail(GENERIC);

  if (!safeEqualHex(sha256(code), row.code_hash)) {
    await sql`UPDATE email_otps SET attempts = attempts + 1 WHERE user_id = ${userId}`;
    await audit(userId, "otp_failed");
    return fail(GENERIC);
  }

  const trialEnds = new Date(Date.now() + TRIAL_DAYS * 86400_000);
  await sql.begin(async (tx) => {
    await tx`DELETE FROM email_otps WHERE user_id = ${userId}`;
    await tx`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()),
                              trial_ends_at = COALESCE(trial_ends_at, ${trialEnds}),
                              updated_at = now()
             WHERE id = ${userId}`;
  });
  await createSession(userId);
  await audit(userId, "email_verified");
  return json({ ok: true, next: "dashboard" });
});
