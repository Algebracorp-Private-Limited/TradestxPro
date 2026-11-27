import { isDbConfigured, db } from "@/lib/db";
import { fail, json } from "@/lib/api";
import { advanceScan, pendingScans, scanTablesAvailable } from "@/lib/intelligence/market-scan/jobs";
import { intelligenceAI } from "@/lib/intelligence/server";
import { runMonitoring } from "@/lib/intelligence/monitoring/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Background trigger: advances pending scans and runs trade-plan / alert monitoring without an open browser tab.
 * (Monitoring also runs daily at the end of /api/cron/eod, which is scheduled.)
 * Requires `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set (it can spend AI budget).
 * Not scheduled in vercel.json: the current plan allows only daily cron jobs. Schedule it on a plan
 * or scheduler that permits minute-level runs (see docs/intelligence/monitoring.md).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return fail("Unauthorized", 401);
  if (!isDbConfigured()) return fail("Database not configured.", 503);
  const sql = await db();
  const monitoring = await runMonitoring(sql, { deadlineMs: 15_000 }).catch((e) => ({ ok: false as const, note: String(e).slice(0, 200) }));
  if (!(await scanTablesAvailable(sql))) return json({ ok: true, advanced: 0, monitoring, note: "scan storage not migrated" });
  const deadline = Date.now() + 45_000;
  let advanced = 0;
  for (const id of await pendingScans(sql, 10)) {
    if (Date.now() > deadline) break;
    await advanceScan(sql, id, null, { chunk: 60, ai: intelligenceAI(), explainTop: 5 }).catch((e) => console.error("scan advance failed", id, e));
    advanced++;
  }
  return json({ ok: true, advanced, monitoring });
}
