import { fail, json, userHandler } from "@/lib/api";
import { intParam, monitorDb, requireFlag } from "@/lib/intelligence/http";
import { createAlert, deleteAlert, listAlerts, markAlertsSeen, MonitorError } from "@/lib/intelligence/monitoring/store";

export const dynamic = "force-dynamic";

/** Price alerts, evaluated on end-of-day bars after each daily load (in-app notifications). */
export const GET = userHandler(async ({ user }) => {
  const off = await requireFlag("MARKET_ANALYTICS");
  if (off) return off;
  const r = await monitorDb();
  if (r.error) return r.error;
  return json({ ok: true, alerts: await listAlerts(r.sql, user.id), basis: "Evaluated on end-of-day bars after each daily data load; not real-time." });
});

export const POST = userHandler(async ({ user, body }) => {
  const off = await requireFlag("MARKET_ANALYTICS");
  if (off) return off;
  const r = await monitorDb();
  if (r.error) return r.error;
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (!b) return fail("JSON body required");
  if (b.action === "seen") {
    await markAlertsSeen(r.sql, user.id);
    return json({ ok: true });
  }
  try {
    const id = await createAlert(r.sql, user.id, { instrument: String(b.instrument ?? "").toUpperCase(), condition: String(b.condition ?? ""), threshold: Number(b.threshold), note: typeof b.note === "string" ? b.note : null, repeat: b.repeat === true });
    return json({ ok: true, id });
  } catch (e) {
    if (e instanceof MonitorError) return fail(e.message, e.status);
    throw e;
  }
});

export const DELETE = userHandler(async ({ user, req }) => {
  const off = await requireFlag("MARKET_ANALYTICS");
  if (off) return off;
  const r = await monitorDb();
  if (r.error) return r.error;
  const id = intParam(new URL(req.url).searchParams.get("id"));
  if (!id) return fail("id required");
  return (await deleteAlert(r.sql, user.id, id)) ? json({ ok: true }) : fail("Alert not found", 404);
});
