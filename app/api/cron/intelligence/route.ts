import { isDbConfigured, db } from "@/lib/db";
import { fail, json } from "@/lib/api";
import { advanceScan, pendingScans, scanTablesAvailable } from "@/lib/intelligence/market-scan/jobs";
import { intelligenceAI } from "@/lib/intelligence/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Background trigger: advances pending scans (and, from 4G, monitoring jobs) without an open browser tab.
 * Requires `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set (it can spend AI budget).
 * Not scheduled in vercel.json: the current plan allows only daily cron jobs. Schedule it on a plan
 * or scheduler that permits minute-level runs (see docs/intelligence/monitoring.md).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return fail("Unauthorized", 401);
  if (!isDbConfigured()) return fail("Database not configured.", 503);
  const sql = await db();
  if (!(await scanTablesAvailable(sql))) return json({ ok: true, advanced: 0, note: "scan storage not migrated" });
  const deadline = Date.now() + 45_000;
  let advanced = 0;
  for (const id of await pendingScans(sql, 10)) {
    if (Date.now() > deadline) break;
    await advanceScan(sql, id, null, { chunk: 60, ai: intelligenceAI(), explainTop: 5 }).catch((e) => console.error("scan advance failed", id, e));
    advanced++;
  }
  return json({ ok: true, advanced });
}
