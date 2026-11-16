import { db } from "@/lib/db";
import { hashPassword, validateSignup } from "@/lib/crypto";
import { audit, issueOtp } from "@/lib/auth";
import { assertMailAvailable } from "@/lib/mail";
import { fail, json, postHandler } from "@/lib/api";

export const POST = postHandler(async (body) => {
  const parsed = validateSignup(body);
  if (!parsed.ok) return fail(parsed.error);
  const { name, email, phone, password } = parsed.value;
  assertMailAvailable();

  const sql = await db();
  const [existing] = await sql<{ id: string; name: string; email_verified_at: Date | null }[]>`
    SELECT id, name, email_verified_at FROM users WHERE email = ${email}`;

  if (existing?.email_verified_at) {
    return fail("An account with this email already exists. Please log in.", 409);
  }

  let userId: number;
  if (existing) {
    // Unverified account: resend a code to the same address; do not overwrite its details.
    userId = Number(existing.id);
  } else {
    const passwordHash = await hashPassword(password);
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO users (name, email, phone, password_hash)
      VALUES (${name}, ${email}, ${phone}, ${passwordHash})
      RETURNING id`;
    userId = Number(row.id);
    await audit(userId, "signup");
  }

  const sent = await issueOtp(userId, email, existing?.name ?? name);
  if (!sent.ok && !existing) return fail(sent.error, sent.status);
  return json({ ok: true, next: "verify", email }, existing ? 200 : 201);
});
