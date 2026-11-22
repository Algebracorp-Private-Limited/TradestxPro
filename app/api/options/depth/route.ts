import { contractDepth } from "@/lib/options/chain";
import { fail, json, userHandler } from "@/lib/api";

export const GET = userHandler(async ({ user, req }) => {
  const u = new URL(req.url).searchParams;
  const token = (u.get("token") ?? "").replace(/\D/g, "");
  const ex = u.get("exchange") === "BFO" ? "BFO" : "NFO";
  if (!token) return fail("token is required.");
  try {
    const d = await contractDepth(user.id, token, ex);
    return json({ ok: true, depth: d });
  } catch (e) {
    return json({ ok: true, depth: null, error: (e as Error).message });
  }
});
