import { searchChartSymbols } from "@/lib/chart-data";
import { json, userHandler } from "@/lib/api";

export const GET = userHandler(async ({ req }) => {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return json({ ok: true, results: await searchChartSymbols(q.slice(0, 40)) });
});
