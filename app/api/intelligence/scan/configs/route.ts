import { fail, json, userHandler } from "@/lib/api";
import { deleteScanConfig, listScanConfigs, saveScanConfig, ScanError } from "@/lib/intelligence/market-scan/jobs";
import { intParam, requireFlag, scanDb } from "@/lib/intelligence/http";

/** Saved scanner configurations (per user). */
export const GET = userHandler(async ({ user }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const r = await scanDb();
  if (r.error) return r.error;
  return json({ ok: true, configs: await listScanConfigs(r.sql, user.id) });
});

export const POST = userHandler(async ({ user, body }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const r = await scanDb();
  if (r.error) return r.error;
  const b = (body ?? {}) as { name?: unknown; config?: unknown };
  try {
    return json({ ok: true, ...(await saveScanConfig(r.sql, user.id, b.name, b.config)) }, 201);
  } catch (e) {
    if (e instanceof ScanError) return fail(e.message, e.status);
    throw e;
  }
});

export const DELETE = userHandler(async ({ user, req }) => {
  const r = await scanDb();
  if (r.error) return r.error;
  const id = intParam(new URL(req.url).searchParams.get("id"));
  if (!id) return fail("id is required");
  return (await deleteScanConfig(r.sql, user.id, id)) ? json({ ok: true }) : fail("Not found", 404);
});
