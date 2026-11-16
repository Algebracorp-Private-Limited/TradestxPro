import { db } from "@/lib/db";
import { hashPassword, normalizeEmail, verifyPassword } from "@/lib/crypto";
import { LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILURES, audit, createSession, issueOtp } from "@/lib/auth";
import { fail, json, postHandler } from "@/lib/api";

const INVALID = "Incorrect email or password.";
let dummyHash: Promise<string> | null = null;

export const POST = postHandler(async (body) => {
  const b = (body ?? {}) as Record<string, unknown>;
  const email = normalizeEmail(b.email);
  const password = String(b.password ?? "");
  if (!email || !password) return fail("Email and password are required.");

  const sql = await db();
  const [user] = await sql<
    { id: string; name: string; password_hash: string; email_verified_at: Date | null; failed_logins: number; locked_until: Date | null }[]
  >`SELECT id, name, password_hash, email_verified_at, failed_logins, locked_until FROM users WHERE email = ${email}`;

  if (!user) {
    // Spend comparable time so response timing does not reveal whether the account exists.
    dummyHash ??= hashPassword("timing-equaliser-0");
    await verifyPassword(password, await dummyHash);
    return fail(INVALID, 401);
  }

  const userId = Number(user.id);
  if (user.locked_until && user.locked_until.getTime() > Date.now()) {
    return fail(`Too many failed attempts. Try again in ${LOGIN_LOCK_MINUTES} minutes.`, 429);
  }

  if (!(await verifyPassword(password, user.password_hash))) {
    const failures = user.failed_logins + 1;
    const lock = failures >= LOGIN_MAX_FAILURES ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60_000) : null;
    await sql`UPDATE users SET failed_logins = ${lock ? 0 : failures}, locked_until = ${lock} WHERE id = ${userId}`;
    await audit(userId, lock ? "login_locked" : "login_failed");
    return fail(INVALID, 401);
  }

  await sql`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ${userId}`;

  if (!user.email_verified_at) {
    const sent = await issueOtp(userId, email, user.name);
    return json({ ok: true, next: "verify", email, notice: sent.ok ? undefined : sent.error });
  }

  await createSession(userId);
  await audit(userId, "login");
  return json({ ok: true, next: "dashboard" });
});
