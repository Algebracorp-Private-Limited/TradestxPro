import { runOptionScreener, sanitizeOptFilters, type OptSort } from "@/lib/option-screener";
import { json, userHandler } from "@/lib/api";

const SORTS: OptSort[] = ["contracts", "oi", "oiChg", "oiChgPct", "chgPct", "iv", "turnover"];

export const POST = userHandler(async ({ body }) => {
  const b = (body ?? {}) as { filters?: unknown; sort?: string; dir?: string; limit?: number };
  const sort = SORTS.includes(b.sort as OptSort) ? (b.sort as OptSort) : "contracts";
  const r = await runOptionScreener(sanitizeOptFilters(b.filters), sort, b.dir === "asc" ? "asc" : "desc", Number(b.limit) || 300);
  return json({ ok: true, ...r });
});
