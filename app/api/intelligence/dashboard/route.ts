import { db } from "@/lib/db";
import { fail, json, userHandler } from "@/lib/api";
import { isEnabled } from "@/lib/flags";
import { dashboardData } from "@/lib/intelligence/dashboard";
import { listScans, scanTablesAvailable } from "@/lib/intelligence/market-scan/jobs";
import { providerStatus } from "@/lib/intelligence/ai-providers/config";
import { CAPABILITIES } from "@/lib/intelligence/market-data/capabilities";
import { gate } from "@/lib/intelligence/present";

export const dynamic = "force-dynamic";

/** AI Intelligence dashboard: market analytics (always), the user's latest scans (when storage exists). */
export const GET = userHandler(async ({ user }) => {
  if (!isEnabled("MARKET_ANALYTICS")) return fail("Market analytics are not activated.", 403);
  const sql = await db();
  const d = await dashboardData(sql);
  const scans = (await scanTablesAvailable(sql)) ? (await listScans(sql, user.id, 5)).map((s) => ({ id: s.id, status: s.status, mode: s.mode, createdAt: s.createdAt, coverage: s.coverage, horizon: s.config.horizon })) : null;
  return json({
    ok: true, ...d, scans, gate: gate(),
    ai: providerStatus().map((p) => ({ id: p.id, configured: p.configured, model: p.model })),
    capabilities: CAPABILITIES.map((c) => ({ kind: c.kind, available: c.available, freshness: c.freshness, notes: c.notes })),
  });
});
