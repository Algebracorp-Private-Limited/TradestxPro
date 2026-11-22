import { BROKER_BY_ID, isBrokerId } from "@/lib/brokers/catalog";
import { beginRedirect, disconnect, formConnect, recordError, redirectUriFor } from "@/lib/brokers/store";
import { BrokerAuthError, BrokerError } from "@/lib/brokers/common";
import { VaultNotConfigured } from "@/lib/brokers/vault";
import { audit } from "@/lib/auth";
import { fail, json, userHandler } from "@/lib/api";

type P = { broker: string };

/** Start a connection: returns a redirect URL (redirect brokers) or logs in directly (form brokers). */
export const POST = userHandler<P>(async ({ user, body, params, req }) => {
  if (!isBrokerId(params.broker)) return fail("Unknown broker.", 404);
  const info = BROKER_BY_ID[params.broker];
  const raw = (body ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const f of info.fields) if (typeof raw[f.key] === "string") fields[f.key] = (raw[f.key] as string).slice(0, 500);
  if (info.envKeys && !info.envKeys.every((k) => process.env[k])) {
    return fail(`${info.name} isn't enabled on TradestXPro yet. The site owner needs to register the ${info.api} app.`, 503);
  }
  try {
    if (info.mode === "form") {
      const r = await formConnect(user.id, info.id, fields);
      await audit(user.id, "broker_connected", { broker: info.id });
      return json({ ok: true, connected: true, label: r.label });
    }
    const url = await beginRedirect(user.id, info.id, fields, redirectUriFor(req, info.id));
    return json({ ok: true, redirect: url });
  } catch (e) {
    if (e instanceof VaultNotConfigured) return fail(e.message, 503);
    const msg = e instanceof BrokerAuthError || e instanceof BrokerError ? e.message : `Could not connect to ${info.name}. ${(e as Error).message ?? ""}`.trim();
    if (info.mode === "form") await recordError(user.id, info.id, msg, e instanceof BrokerAuthError).catch(() => {});
    await audit(user.id, "broker_connect_failed", { broker: info.id });
    return fail(msg, e instanceof BrokerAuthError ? 401 : 400);
  }
});

export const DELETE = userHandler<P>(async ({ user, params, req }) => {
  if (!isBrokerId(params.broker)) return fail("Unknown broker.", 404);
  const forget = new URL(req.url).searchParams.get("forget") === "1";
  await disconnect(user.id, params.broker, forget);
  await audit(user.id, forget ? "broker_forgotten" : "broker_disconnected", { broker: params.broker });
  return json({ ok: true });
});
