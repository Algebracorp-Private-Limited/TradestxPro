import { hasConstituents } from "@/lib/constituents";
import { getIndexComponents } from "@/lib/index-components";
import { fail, json, userHandler } from "@/lib/api";

export const GET = userHandler(async ({ req, user }) => {
  const index = (new URL(req.url).searchParams.get("index") ?? "NIFTY 50").slice(0, 80);
  if (!hasConstituents(index)) return fail("Constituent list not available for this index.", 404);
  const r = await getIndexComponents(user.id, index);
  if (!r) return fail("Could not load this index's members right now. Try again shortly.", 502);
  return json({ ok: true, ...r });
});
