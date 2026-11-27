import { fail, json, userHandler } from "@/lib/api";
import { cancelScan } from "@/lib/intelligence/market-scan/jobs";
import { requireFlag, scanDb } from "@/lib/intelligence/http";

export const POST = userHandler(async ({ user, body }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const r = await scanDb();
  if (r.error) return r.error;
  const id = (body as { id?: unknown })?.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id)) return fail("id is required");
  return (await cancelScan(r.sql, user.id, id)) ? json({ ok: true }) : fail("No running scan with that id.", 404);
});
