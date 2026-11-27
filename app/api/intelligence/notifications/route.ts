import { fail, json, userHandler } from "@/lib/api";
import { intParam, monitorDb, requireFlag } from "@/lib/intelligence/http";
import { extendedAvailable, getSettings, listNotifications, markRead, setSettings, unreadCount } from "@/lib/intelligence/monitoring/alerts";
import { isMailConfigured } from "@/lib/mail";

export const dynamic = "force-dynamic";

/** The user's notifications (alerts, plan events, watchlist changes). `?count=1` returns only the unread count. */
export const GET = userHandler(async ({ user, req }) => {
  const off = await requireFlag("MARKET_ANALYTICS");
  if (off) return off;
  const r = await monitorDb();
  if (r.error) return r.error;
  if (!(await extendedAvailable(r.sql))) return new URL(req.url).searchParams.get("count") ? json({ ok: true, unread: 0 }) : fail("Notifications need database migration 006 (not applied yet).", 503);
  if (new URL(req.url).searchParams.get("count")) return json({ ok: true, unread: await unreadCount(r.sql, user.id) });
  return json({ ok: true, ...(await listNotifications(r.sql, user.id)), settings: await getSettings(r.sql, user.id), emailAvailable: isMailConfigured() });
});

/** `{ action: "read", id | "all" }` or `{ action: "settings", emailAlerts }`. */
export const POST = userHandler(async ({ user, body }) => {
  const off = await requireFlag("MARKET_ANALYTICS");
  if (off) return off;
  const r = await monitorDb();
  if (r.error) return r.error;
  if (!(await extendedAvailable(r.sql))) return fail("Notifications need database migration 006 (not applied yet).", 503);
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (b.action === "read") {
    const id = b.id === "all" ? "all" : intParam(String(b.id ?? ""));
    if (!id) return fail("id or \"all\" required");
    await markRead(r.sql, user.id, id);
    return json({ ok: true });
  }
  if (b.action === "settings") {
    if (typeof b.emailAlerts !== "boolean") return fail("emailAlerts must be true or false");
    await setSettings(r.sql, user.id, { emailAlerts: b.emailAlerts });
    return json({ ok: true, settings: await getSettings(r.sql, user.id) });
  }
  return fail("unknown action");
});
