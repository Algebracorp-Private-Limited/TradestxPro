import { db } from "@/lib/db";
import { BSE_INDICES, MCX_ITEMS } from "@/lib/index-catalog";
import { hasConstituents } from "@/lib/constituents";
import { json, userHandler } from "@/lib/api";

export const GET = userHandler(async () => {
  const sql = await db();
  const rows = await sql<{ key: string; name: string }[]>`SELECT key, name FROM market_indices ORDER BY key`;
  return json({
    ok: true,
    groups: [
      { group: "NSE", items: rows.map((r) => ({ key: r.key, name: r.name, group: "NSE", available: true, constituents: hasConstituents(r.key) })) },
      { group: "BSE", items: BSE_INDICES.map((b) => ({ ...b, constituents: false })) },
      { group: "MCX", items: MCX_ITEMS.map((m) => ({ ...m, constituents: false })) },
    ],
  });
});
