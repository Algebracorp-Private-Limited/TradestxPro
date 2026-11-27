import { json, userHandler } from "@/lib/api";
import { monitorDb, requireFlag } from "@/lib/intelligence/http";
import { performance } from "@/lib/intelligence/monitoring/store";

export const dynamic = "force-dynamic";

/** Performance of the user's closed paper plans (net R) with score calibration. */
export const GET = userHandler(async ({ user }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const r = await monitorDb();
  if (r.error) return r.error;
  return json({ ok: true, ...(await performance(r.sql, user.id)) });
});
