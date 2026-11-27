import { fail, json, userHandler } from "@/lib/api";
import { audit } from "@/lib/auth";
import { createScan, listScans, ScanError } from "@/lib/intelligence/market-scan/jobs";
import { requireFlag, scanDb } from "@/lib/intelligence/http";

export const dynamic = "force-dynamic";

/** GET: the user's recent scans. POST { config, mode, idempotencyKey }: queue a scan (processed in chunks). */
export const GET = userHandler(async ({ user }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const r = await scanDb();
  if (r.error) return r.error;
  return json({ ok: true, scans: await listScans(r.sql, user.id) });
});

export const POST = userHandler(async ({ user, body }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const r = await scanDb();
  if (r.error) return r.error;
  const b = (body ?? {}) as { config?: unknown; mode?: unknown; idempotencyKey?: unknown };
  const mode = b.mode === "accelerated" ? "accelerated" : "comprehensive";
  try {
    const job = await createScan(r.sql, user.id, b.config, mode, typeof b.idempotencyKey === "string" ? b.idempotencyKey : null);
    if (!job.reused) await audit(user.id, "intel.scan.create", { jobId: job.id, mode });
    return json({ ok: true, ...job }, job.reused ? 200 : 201);
  } catch (e) {
    if (e instanceof ScanError) return fail(e.message, e.status);
    throw e;
  }
});
