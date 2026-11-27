import { fail, json, userHandler } from "@/lib/api";
import { db } from "@/lib/db";
import { intParam, rateLimit, requireFlag } from "@/lib/intelligence/http";
import { MonitorError } from "@/lib/intelligence/monitoring/errors";
import { accountSummary, cancelOrder, paperAvailable, placeOrder, resetAccount } from "@/lib/intelligence/paper/store";

export const dynamic = "force-dynamic";

async function paperDb() {
  const sql = await db();
  if (!(await paperAvailable(sql))) return { error: fail("Paper trading needs database migration 007 (not applied yet).", 503) };
  return { sql };
}

/** Paper-trading account: positions with mark-to-market, orders, fills. Simulation only. */
export const GET = userHandler(async ({ user }) => {
  const off = await requireFlag("PAPER_TRADING");
  if (off) return off;
  const r = await paperDb();
  if (r.error) return r.error;
  return json({ ok: true, ...(await accountSummary(r.sql, user.id)) });
});

/** `{ action: "order", instrument, side, qty, type, limit?, validSessions? }` · `{ action: "cancel", id }` · `{ action: "reset", startingCash }`. */
export const POST = userHandler(async ({ user, body }) => {
  const off = await requireFlag("PAPER_TRADING");
  if (off) return off;
  const limited = rateLimit("contract", user.id);
  if (limited) return limited;
  const r = await paperDb();
  if (r.error) return r.error;
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  try {
    if (b.action === "order") return json({ ok: true, ...(await placeOrder(r.sql, user.id, { instrument: String(b.instrument ?? ""), side: String(b.side ?? ""), qty: Number(b.qty), type: String(b.type ?? "MARKET"), limit: b.limit === undefined || b.limit === null ? null : Number(b.limit), validSessions: b.validSessions === undefined ? undefined : Number(b.validSessions) })) });
    if (b.action === "cancel") {
      const id = intParam(String(b.id ?? ""));
      if (!id) return fail("id required");
      return (await cancelOrder(r.sql, user.id, id)) ? json({ ok: true }) : fail("Order not found or not open", 404);
    }
    if (b.action === "reset") {
      await resetAccount(r.sql, user.id, Number(b.startingCash));
      return json({ ok: true });
    }
    return fail("unknown action");
  } catch (e) {
    if (e instanceof MonitorError) return fail(e.message, e.status);
    throw e;
  }
});
