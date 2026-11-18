import { isDbConfigured } from "@/lib/db";
import { runEod } from "@/lib/eod";
import { fail, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Loads missing NSE end-of-day files (daily via Vercel Cron, see vercel.json) and rebuilds the
 * screener snapshot. Only ever does missing work and holds a DB lock, so it is safe to call
 * without credentials; repeat calls during backfill just continue where the last one stopped.
 */
export async function GET() {
  if (!isDbConfigured()) return fail("Database not configured.", 503);
  try {
    const r = await runEod(240_000);
    if (r.locked) return fail("An end-of-day load is already running.", 409);
    return json({ ok: true, ...r });
  } catch (e) {
    console.error("eod run failed", e);
    return fail(`End-of-day load failed: ${String(e).slice(0, 200)}`, 502);
  }
}
