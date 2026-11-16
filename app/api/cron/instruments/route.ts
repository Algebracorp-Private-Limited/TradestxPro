import { timingSafeEqual } from "node:crypto";
import { db, isDbConfigured } from "@/lib/db";
import { syncInstruments } from "@/lib/instruments";
import { fail, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  if (!secret) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Daily instrument-master refresh (Vercel Cron, see vercel.json).
 * Without the cron secret it only runs when no successful sync happened in the last 20 hours and
 * none is in progress, so the first load can be triggered once after deploy without credentials.
 */
export async function GET(req: Request) {
  if (!isDbConfigured()) return fail("Database not configured.", 503);
  if (!authorised(req)) {
    const sql = await db();
    const [recent] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM instrument_syncs
       WHERE (status = 'ok' AND finished_at > now() - interval '20 hours')
          OR (status = 'running' AND started_at > now() - interval '10 minutes')`;
    if (recent.n > 0) return fail("Instrument master is already fresh.", 429);
  }
  try {
    return json({ ok: true, ...(await syncInstruments()) });
  } catch (e) {
    console.error("instrument sync failed", e);
    return fail("Instrument sync failed.", 502);
  }
}
