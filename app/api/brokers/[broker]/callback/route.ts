import { NextResponse } from "next/server";
import { BROKER_BY_ID, isBrokerId } from "@/lib/brokers/catalog";
import { completeRedirect, recordError, redirectUriFor, siteOrigin } from "@/lib/brokers/store";
import { BrokerAuthError } from "@/lib/brokers/common";
import { audit, getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ broker: string }> };

const back = (req: Request, q: Record<string, string>) => NextResponse.redirect(`${siteOrigin(req)}/brokers?${new URLSearchParams(q)}`, 303);

async function handle(req: Request, params: Record<string, string>, broker: string) {
  if (!isBrokerId(broker)) return back(req, { error: "Unknown broker." });
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(`${siteOrigin(req)}/login`, 303);
  const name = BROKER_BY_ID[broker].name;
  if (params.status && params.status !== "success" && !params.request_token && !params.code && !params.auth_code) {
    return back(req, { broker, error: `${name} login was cancelled.` });
  }
  try {
    const r = await completeRedirect(user.id, broker, params, redirectUriFor(req, broker));
    await audit(user.id, "broker_connected", { broker });
    return back(req, { broker, connected: r.label });
  } catch (e) {
    const msg = (e as Error).message || `Could not finish connecting ${name}.`;
    await recordError(user.id, broker, msg, e instanceof BrokerAuthError).catch(() => {});
    await audit(user.id, "broker_connect_failed", { broker });
    return back(req, { broker, error: msg });
  }
}

export async function GET(req: Request, ctx: Ctx) {
  const { broker } = await ctx.params;
  return handle(req, Object.fromEntries(new URL(req.url).searchParams), broker);
}

/**
 * Some brokers POST the session back as a form. A cross-site POST does not carry our SameSite=Lax
 * session cookie, so hand the values to a same-site GET of this URL instead.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { broker } = await ctx.params;
  const form = await req.formData().catch(() => null);
  const params: Record<string, string> = Object.fromEntries(new URL(req.url).searchParams);
  form?.forEach((v, k) => {
    if (typeof v === "string") params[k] = v.slice(0, 2000);
  });
  const target = `${siteOrigin(req)}/api/brokers/${encodeURIComponent(broker)}/callback?${new URLSearchParams(params)}`;
  const html = `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Connecting…</title><p style="font-family:sans-serif">Connecting your broker…</p><script>location.replace(${JSON.stringify(target)})</script>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
