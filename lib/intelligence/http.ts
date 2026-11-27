import "server-only";
/** Shared helpers for the /api/intelligence routes. */
import { db } from "../db";
import { fail } from "../api";
import { isEnabled, type Flag } from "../flags";
import { scanTablesAvailable } from "./market-scan/jobs.ts";
import { monitoringAvailable } from "./monitoring/store.ts";
import { limitFor, type ENDPOINT_LIMITS } from "./ratelimit.ts";
import { NextResponse } from "next/server";

export async function requireFlag(flag: Flag): Promise<Response | null> {
  return isEnabled(flag) ? null : fail(`This feature is not activated (${flag.toLowerCase().replace(/_/g, " ")}).`, 403);
}

/** Database client after checking that the Phase 4 scan tables exist (migration 003). */
export async function scanDb() {
  const sql = await db();
  if (!(await scanTablesAvailable(sql))) return { error: fail("AI Intelligence storage is not configured yet (database migration pending).", 503) };
  return { sql };
}

/** Database client after checking that the monitoring tables exist (migration 005). */
export async function monitorDb() {
  const sql = await db();
  if (!(await monitoringAvailable(sql))) return { error: fail("Trade monitoring storage is not configured yet (database migration 005 pending).", 503) };
  return { sql };
}

/** Per-user rate limit for a costly endpoint: 429 with Retry-After when exceeded. */
export function rateLimit(endpoint: keyof typeof ENDPOINT_LIMITS, userId: number): Response | null {
  const r = limitFor(endpoint).check(String(userId));
  if (r.ok) return null;
  return NextResponse.json({ ok: false, error: `Too many requests: try again in ${r.retryAfterS} s.` }, { status: 429, headers: { "Retry-After": String(r.retryAfterS), "Cache-Control": "no-store" } });
}

export const intParam = (v: string | null, lo = 1, hi = Number.MAX_SAFE_INTEGER) => {
  if (v === null || !/^\d{1,15}$/.test(v)) return null;
  const n = Number(v);
  return n >= lo && n <= hi ? n : null;
};
export const symbolParam = (v: string | null) => (v && /^[A-Z0-9&.-]{1,30}$/.test(v.toUpperCase()) ? v.toUpperCase() : null);
