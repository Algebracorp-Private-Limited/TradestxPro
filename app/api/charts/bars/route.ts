import { getBars } from "@/lib/chart-data";
import { fail, json, userHandler } from "@/lib/api";

export const GET = userHandler(async ({ req, user }) => {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") ?? "";
  const tf = url.searchParams.get("tf") ?? "1D";
  try {
    const data = await getBars(symbol, tf, user.id);
    if (!data) return fail("Unknown symbol or timeframe.", 404);
    return json({ ok: true, ...data });
  } catch (e) {
    console.error("bars failed", e);
    return fail("Market data source is unavailable right now.", 502);
  }
});
