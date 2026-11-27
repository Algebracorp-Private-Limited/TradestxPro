import { fail, json, userHandler } from "@/lib/api";
import { intParam, monitorDb, requireFlag } from "@/lib/intelligence/http";
import { cancelPlan, MonitorError, planEvents } from "@/lib/intelligence/monitoring/store";

export const dynamic = "force-dynamic";

/** Event history of one of the user's plans. */
export const GET = userHandler<{ id: string }>(async ({ user, params }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const r = await monitorDb();
  if (r.error) return r.error;
  const id = intParam(params.id ?? null);
  if (!id) return fail("invalid id");
  try {
    return json({ ok: true, events: await planEvents(r.sql, user.id, id) });
  } catch (e) {
    if (e instanceof MonitorError) return fail(e.message, e.status);
    throw e;
  }
});

/** Cancel an open plan. */
export const DELETE = userHandler<{ id: string }>(async ({ user, params }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const r = await monitorDb();
  if (r.error) return r.error;
  const id = intParam(params.id ?? null);
  if (!id) return fail("invalid id");
  return (await cancelPlan(r.sql, user.id, id)) ? json({ ok: true }) : fail("Plan not found or already closed", 404);
});
