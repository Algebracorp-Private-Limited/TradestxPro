import { searchInstruments } from "@/lib/market-data";
import { json, userHandler } from "@/lib/api";

export const GET = userHandler(async ({ req }) => {
  const url = new URL(req.url);
  const ex = url.searchParams.get("exchange")?.toUpperCase();
  const exchange = ex === "NSE" || ex === "BSE" ? ex : undefined;
  const results = await searchInstruments(url.searchParams.get("q") ?? "", exchange, Number(url.searchParams.get("limit") ?? 20));
  return json({ ok: true, results });
});
