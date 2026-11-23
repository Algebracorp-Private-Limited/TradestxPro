import { buildTiles } from "@/lib/overview";
import { json, userHandler } from "@/lib/api";

const TICKER_KEYS = ["NIFTY 50", "SENSEX", "NIFTY BANK", "INDIA VIX"];

export const GET = userHandler(async ({ user }) => {
  const r = await buildTiles(user.id, TICKER_KEYS);
  return json({ ok: true, broker: r.broker, items: r.tiles.map((t) => ({ key: t.key, name: t.name, chartSymbol: t.chartSymbol, live: t.live, eod: t.eod })) });
});
