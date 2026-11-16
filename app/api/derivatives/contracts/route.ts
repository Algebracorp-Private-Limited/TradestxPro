import { getUnderlying } from "@/lib/market-data";
import { fail, json, userHandler } from "@/lib/api";

export const GET = userHandler(async ({ req }) => {
  const url = new URL(req.url);
  const underlying = url.searchParams.get("underlying");
  if (!underlying) return fail("underlying is required.");
  const detail = await getUnderlying(underlying, url.searchParams.get("expiry") ?? undefined, url.searchParams.get("exchange") ?? undefined);
  return detail ? json({ ok: true, ...detail }) : fail("No listed contracts for that underlying.", 404);
});
