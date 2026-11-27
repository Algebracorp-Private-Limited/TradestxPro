import { fail, json, userHandler } from "@/lib/api";
import { scanResults, ScanError } from "@/lib/intelligence/market-scan/jobs";
import { intParam, requireFlag, scanDb } from "@/lib/intelligence/http";
import { gate, present, presentFutures } from "@/lib/intelligence/present";

export const dynamic = "force-dynamic";
const STATUSES = ["ENTER IF CONFIRMED", "WAIT FOR CONFIRMATION", "WATCHLIST", "AVOID", "NO TRADE", "INVALIDATED", "INSUFFICIENT DATA"];

/** Paginated, sorted, filtered results of the user's own scan, with the regulatory presentation gate applied. */
export const GET = userHandler(async ({ user, req }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const r = await scanDb();
  if (r.error) return r.error;
  const p = new URL(req.url).searchParams;
  const id = intParam(p.get("id"));
  if (!id) return fail("id is required");
  const status = p.get("status");
  if (status && !STATUSES.includes(status)) return fail("unknown status filter");
  const sort = (["score", "symbol", "rr"] as const).find((s) => s === p.get("sort")) ?? "score";
  try {
    const res = await scanResults(r.sql, user.id, id, { page: intParam(p.get("page"), 1, 10_000) ?? 1, pageSize: intParam(p.get("pageSize"), 1, 100) ?? 25, status, sort });
    const g = gate();
    return json({ ok: true, ...res, results: res.results.map((x) => ({ ...x, payload: x.kind === "futures" ? presentFutures(x.payload as { plan: Record<string, unknown> }, g) : present(x.payload as Record<string, unknown>, g) })) });
  } catch (e) {
    if (e instanceof ScanError) return fail(e.message, e.status);
    throw e;
  }
});
