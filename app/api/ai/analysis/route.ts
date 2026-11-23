import { getAnalysis, type Scope } from "@/lib/analysis";
import { fail, json, userHandler } from "@/lib/api";

const SCOPES: Scope[] = ["market", "index", "stock", "options"];

export const maxDuration = 60;

export const GET = userHandler(async ({ req, user }) => {
  const p = new URL(req.url).searchParams;
  const scope = p.get("scope") as Scope;
  if (!SCOPES.includes(scope)) return fail("Unknown analysis scope.", 400);
  const target = (p.get("target") ?? "NIFTY 50").slice(0, 80);
  const a = await getAnalysis(user.id, scope, target);
  if (!a) return fail("Not enough data to analyse this yet.", 404);
  return json({ ok: true, ...a });
});
