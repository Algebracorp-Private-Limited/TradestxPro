import { fail, json, userHandler } from "@/lib/api";
import { intParam, monitorDb, rateLimit, requireFlag } from "@/lib/intelligence/http";
import { addWatch, listWatch, removeWatch } from "@/lib/intelligence/monitoring/alerts";
import { MonitorError } from "@/lib/intelligence/monitoring/store";
import { gate, present } from "@/lib/intelligence/present";

export const dynamic = "force-dynamic";

/** AI watchlist: symbols re-evaluated by the setup engine after each daily load (research feature). */
export const GET = userHandler(async ({ user }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const r = await monitorDb();
  if (r.error) return r.error;
  try {
    const g = gate();
    const items = await listWatch(r.sql, user.id);
    return json({ ok: true, items: items.map((i) => ({ ...i, setupDetail: i.setupDetail ? present(i.setupDetail, g) : null })), basis: "Re-evaluated on each new end-of-day session. Scores rank setups; they are not probabilities." });
  } catch (e) {
    if (e instanceof Error && /ai_watch_items/.test(e.message)) return fail("The AI watchlist needs database migration 006 (not applied yet).", 503);
    throw e;
  }
});

export const POST = userHandler(async ({ user, body }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const limited = rateLimit("equity", user.id);
  if (limited) return limited;
  const r = await monitorDb();
  if (r.error) return r.error;
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  try {
    return json({ ok: true, id: await addWatch(r.sql, user.id, String(b.symbol ?? ""), String(b.horizon ?? "swing")) });
  } catch (e) {
    if (e instanceof MonitorError) return fail(e.message, e.status);
    throw e;
  }
});

export const DELETE = userHandler(async ({ user, req }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const r = await monitorDb();
  if (r.error) return r.error;
  const id = intParam(new URL(req.url).searchParams.get("id"));
  if (!id) return fail("id required");
  return (await removeWatch(r.sql, user.id, id)) ? json({ ok: true }) : fail("Not found", 404);
});
