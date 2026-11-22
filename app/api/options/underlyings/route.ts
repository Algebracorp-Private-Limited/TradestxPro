import { db } from "@/lib/db";
import { getConstituents } from "@/lib/constituents";
import { UNDERLYING_INDEX } from "@/lib/options/chain";
import { json, userHandler } from "@/lib/api";

/**
 * Option underlyings for the Options page. Without ?index: index underlyings + all stock underlyings.
 * With ?index=NIFTY (an index underlying): its constituent stocks that have listed options.
 */
export const GET = userHandler(async ({ req }) => {
  const sql = await db();
  const opt = await sql<{ underlying: string; exchange: string; name: string; is_index: boolean }[]>`
    SELECT underlying, exchange, min(underlying_name) AS name, bool_or(instrument_type = 'OPTIDX') AS is_index
      FROM derivative_contracts WHERE instrument_type IN ('OPTIDX', 'OPTSTK') GROUP BY underlying, exchange ORDER BY underlying`;
  const index = new URL(req.url).searchParams.get("index")?.toUpperCase();
  if (index) {
    const key = UNDERLYING_INDEX[index] ?? index;
    const members = await getConstituents(key);
    const fno = new Map(opt.filter((o) => !o.is_index).map((o) => [o.underlying, o]));
    return json({
      ok: true,
      index,
      stocks: members.filter((m) => fno.has(m.symbol)).map((m) => ({ symbol: m.symbol, name: m.name, exchange: fno.get(m.symbol)!.exchange })),
      withoutOptions: members.filter((m) => !fno.has(m.symbol)).length,
    });
  }
  const order = Object.keys(UNDERLYING_INDEX);
  return json({
    ok: true,
    indices: opt.filter((o) => o.is_index).sort((a, b) => (order.indexOf(a.underlying) + 1 || 99) - (order.indexOf(b.underlying) + 1 || 99))
      .map((o) => ({ symbol: o.underlying, name: o.name, exchange: o.exchange, hasMembers: Boolean(UNDERLYING_INDEX[o.underlying]) })),
    stocks: opt.filter((o) => !o.is_index).map((o) => ({ symbol: o.underlying, name: o.name, exchange: o.exchange })),
  });
});
