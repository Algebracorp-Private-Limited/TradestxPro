import { db } from "@/lib/db";
import { BSE_INDICES, MCX_ITEMS } from "@/lib/index-catalog";
import { hasConstituents } from "@/lib/constituents";
import { json, userHandler } from "@/lib/api";

const MAJOR = ["NIFTY 50", "NIFTY BANK", "NIFTY NEXT 50", "NIFTY 100", "NIFTY 200", "NIFTY 500", "INDIA VIX", "NIFTY FINANCIAL SERVICES", "NIFTY MIDCAP SELECT", "NIFTY MIDCAP 50", "NIFTY MIDCAP 100", "NIFTY MIDCAP 150", "NIFTY SMALLCAP 100", "NIFTY SMALLCAP 250", "NIFTY IT", "NIFTY AUTO", "NIFTY PHARMA", "NIFTY FMCG", "NIFTY METAL", "NIFTY REALTY", "NIFTY ENERGY", "NIFTY PSU BANK", "NIFTY PRIVATE BANK", "NIFTY MEDIA", "NIFTY HEALTHCARE INDEX", "NIFTY OIL & GAS", "NIFTY CONSUMER DURABLES"];

export const GET = userHandler(async () => {
  const sql = await db();
  const raw = await sql<{ key: string; name: string }[]>`SELECT key, name FROM market_indices ORDER BY key`;
  const rank = (k: string) => {
    const i = MAJOR.indexOf(k);
    if (i >= 0) return i;
    return /G-SEC|GSEC|BOND|RATE|SDL|T-BILL|BHARAT BOND|CPSE ETF|CORPORATE BOND/i.test(k) ? 2000 : 1000;
  };
  const rows = raw.sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
  return json({
    ok: true,
    groups: [
      { group: "NSE", items: rows.map((r) => ({ key: r.key, name: r.name, group: "NSE", available: true, constituents: hasConstituents(r.key) })) },
      { group: "BSE", items: BSE_INDICES.map((b) => ({ ...b, constituents: false })) },
      { group: "MCX", items: MCX_ITEMS.map((m) => ({ ...m, constituents: false })) },
    ],
  });
});
