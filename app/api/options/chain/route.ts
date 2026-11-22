import { getOptionChain } from "@/lib/options/chain";
import { fail, json, userHandler } from "@/lib/api";

export const GET = userHandler(async ({ user, req }) => {
  const u = new URL(req.url).searchParams;
  const underlying = (u.get("u") ?? "NIFTY").slice(0, 40);
  const r = await getOptionChain(user.id, underlying, u.get("expiry") ?? undefined, u.get("exchange") ?? undefined);
  return r ? json({ ok: true, ...r }) : fail("No listed options for that underlying.", 404);
});
