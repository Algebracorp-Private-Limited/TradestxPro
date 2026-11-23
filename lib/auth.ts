import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { db, isDbConfigured } from "./db";
import { generateOtp, newSessionToken, sha256 } from "./crypto";
import { sendOtpEmail } from "./mail";

export const SESSION_COOKIE = "txp_session";
const SESSION_DAYS = 14;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SECONDS = 60;
export const OTP_MAX_SENDS_PER_HOUR = 5;
export const LOGIN_MAX_FAILURES = 8;
export const LOGIN_LOCK_MINUTES = 15;
export const TRIAL_DAYS = 7;

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  plan: string;
  trialEndsAt: string | null;
  emailVerified: boolean;
};

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function audit(userId: number | null, action: string, detail?: Record<string, unknown>) {
  try {
    const sql = await db();
    const ip = await clientIp();
    await sql`INSERT INTO audit_logs (user_id, action, detail, ip)
              VALUES (${userId}, ${action}, ${detail ? sql.json(detail as never) : null}, ${ip})`;
  } catch (e) {
    console.error("audit log failed", e);
  }
}

/** Creates (or replaces) the user's OTP and emails it, enforcing resend cooldown and hourly cap. */
export async function issueOtp(
  userId: number,
  email: string,
  name: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const sql = await db();
  const [existing] = await sql<{ last_sent_at: Date; sends_window_start: Date; sends_in_window: number }[]>`
    SELECT last_sent_at, sends_window_start, sends_in_window FROM email_otps WHERE user_id = ${userId}`;

  const now = Date.now();
  let windowStart = new Date(now);
  let sends = 1;
  if (existing) {
    const since = (now - existing.last_sent_at.getTime()) / 1000;
    if (since < OTP_RESEND_SECONDS) {
      return { ok: false, status: 429, error: `Please wait ${Math.ceil(OTP_RESEND_SECONDS - since)}s before requesting another code.` };
    }
    if (now - existing.sends_window_start.getTime() < 3600_000) {
      if (existing.sends_in_window >= OTP_MAX_SENDS_PER_HOUR) {
        return { ok: false, status: 429, error: "Too many codes requested. Please try again in an hour." };
      }
      windowStart = existing.sends_window_start;
      sends = existing.sends_in_window + 1;
    }
  }

  const code = generateOtp();
  const expires = new Date(now + OTP_TTL_MINUTES * 60_000);
  await sql`
    INSERT INTO email_otps (user_id, code_hash, expires_at, attempts, last_sent_at, sends_window_start, sends_in_window)
    VALUES (${userId}, ${sha256(code)}, ${expires}, 0, now(), ${windowStart}, ${sends})
    ON CONFLICT (user_id) DO UPDATE SET
      code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0,
      last_sent_at = now(), sends_window_start = EXCLUDED.sends_window_start,
      sends_in_window = EXCLUDED.sends_in_window`;
  await sendOtpEmail(email, name, code);
  return { ok: true };
}

export async function createSession(userId: number): Promise<void> {
  const sql = await db();
  const token = newSessionToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at, user_agent)
            VALUES (${sha256(token)}, ${userId}, ${expires}, ${ua})`;
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token && isDbConfigured()) {
    const sql = await db();
    await sql`DELETE FROM sessions WHERE token_hash = ${sha256(token)}`;
  }
  jar.delete(SESSION_COOKIE);
}

/** Memoised per request, so the layout and page share one lookup. */
export const getSessionUser = cache(async function getSessionUser(): Promise<SessionUser | null> {
  if (!isDbConfigured()) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const sql = await db();
  const [row] = await sql<
    { id: string; name: string; email: string; plan: string; trial_ends_at: Date | null; email_verified_at: Date | null }[]
  >`SELECT u.id, u.name, u.email, u.plan, u.trial_ends_at, u.email_verified_at
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ${sha256(token)} AND s.expires_at > now()`;
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    plan: row.plan,
    trialEndsAt: row.trial_ends_at?.toISOString() ?? null,
    emailVerified: Boolean(row.email_verified_at),
  };
});
