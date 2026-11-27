import { fail, json, userHandler } from "@/lib/api";
import { advanceScan } from "@/lib/intelligence/market-scan/jobs";
import { intParam, requireFlag, scanDb } from "@/lib/intelligence/http";
import { intelligenceAI } from "@/lib/intelligence/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Progress of a scan. Each poll also processes the next chunk (under a lease), so no request runs long. */
export const GET = userHandler(async ({ user, req }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const r = await scanDb();
  if (r.error) return r.error;
  const id = intParam(new URL(req.url).searchParams.get("id"));
  if (!id) return fail("id is required");
  const s = await advanceScan(r.sql, id, user.id, { chunk: 40, ai: intelligenceAI(), explainTop: 5 });
  if (!s) return fail("Scan not found", 404);
  return json({ ok: true, scan: s });
});
