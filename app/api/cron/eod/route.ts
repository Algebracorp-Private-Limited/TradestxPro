import { db, isDbConfigured } from "@/lib/db";
import { runMonitoring } from "@/lib/intelligence/monitoring/store";
import { sendNotificationDigest } from "@/lib/mail";
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
    const r = await runEod(150_000);
    if (r.locked) return fail("An end-of-day load is already running.", 409);
    // Trade-plan and alert monitoring runs on the freshly loaded end-of-day bars (needs migration 005).
    const monitoring = await runMonitoring(await db(), { deadlineMs: 60_000, email: (d) => sendNotificationDigest(d.email, d.name, d.items) }).catch((e) => ({ ok: false as const, note: String(e).slice(0, 200) }));
    return json({ ok: true, ...r, monitoring });
  } catch (e) {
    console.error("eod run failed", e);
    return fail(`End-of-day load failed: ${String(e).slice(0, 200)}`, 502);
  }
}
