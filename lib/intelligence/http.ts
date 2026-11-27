import "server-only";
/** Shared helpers for the /api/intelligence routes. */
import { db } from "../db";
import { fail } from "../api";
import { isEnabled, type Flag } from "../flags";
import { scanTablesAvailable } from "./market-scan/jobs.ts";

export async function requireFlag(flag: Flag): Promise<Response | null> {
  return isEnabled(flag) ? null : fail(`This feature is not activated (${flag.toLowerCase().replace(/_/g, " ")}).`, 403);
}

/** Database client after checking that the Phase 4 scan tables exist (migration 003). */
export async function scanDb() {
  const sql = await db();
  if (!(await scanTablesAvailable(sql))) return { error: fail("AI Intelligence storage is not configured yet (database migration pending).", 503) };
  return { sql };
}

export const intParam = (v: string | null, lo = 1, hi = Number.MAX_SAFE_INTEGER) => {
  if (v === null || !/^\d{1,15}$/.test(v)) return null;
  const n = Number(v);
  return n >= lo && n <= hi ? n : null;
};
export const symbolParam = (v: string | null) => (v && /^[A-Z0-9&.-]{1,30}$/.test(v.toUpperCase()) ? v.toUpperCase() : null);
