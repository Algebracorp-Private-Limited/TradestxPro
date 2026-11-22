import "server-only";
import type { SessionUser } from "./auth";

/** Admins are listed by email in the ADMIN_EMAILS environment variable (comma separated). */
export function isAdmin(user: SessionUser | null): boolean {
  if (!user) return false;
  const list = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(user.email.toLowerCase());
}
