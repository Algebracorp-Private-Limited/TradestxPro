import { contractChoices } from "@/lib/watch";
import { fail, json, userHandler } from "@/lib/api";

export const GET = userHandler(async ({ req }) => {
  const p = new URL(req.url).searchParams;
  const u = p.get("underlying");
  const type = p.get("type") === "future" ? "future" : "option";
  if (!u) return fail("underlying is required.");
  return json({ ok: true, ...(await contractChoices(u, type, p.get("expiry") ?? undefined)) });
});
