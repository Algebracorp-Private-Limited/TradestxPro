// Grouped index catalogue for pickers (client-safe).
export type IndexEntry = { key: string; name: string; group: "NSE" | "BSE" | "MCX"; available: boolean; note?: string };

export const BSE_INDICES: IndexEntry[] = [
  { key: "SENSEX", name: "BSE SENSEX", group: "BSE", available: true },
  { key: "BANKEX", name: "BSE BANKEX", group: "BSE", available: true },
];

export const MCX_ITEMS: IndexEntry[] = ["GOLD", "SILVER", "CRUDE OIL", "NATURAL GAS", "COPPER", "MCX iCOMDEX"].map((k) => ({
  key: `MCX:${k}`,
  name: k,
  group: "MCX",
  available: false,
  note: "Coming soon",
}));

export const DEFAULT_DASHBOARD_INDICES = ["NIFTY 50", "SENSEX", "NIFTY BANK", "INDIA VIX", "NIFTY FINANCIAL SERVICES", "NIFTY MIDCAP 100"];

// NSE's own index families, in display order.
export const NSE_CATEGORIES = ["Broad market", "Sectoral", "Thematic", "Strategy", "Fixed income", "Volatility & derivatives"] as const;
export type NseCategory = (typeof NSE_CATEGORIES)[number];

const BROAD = new Set([
  "NIFTY 50", "NIFTY NEXT 50", "NIFTY 100", "NIFTY NEXT 100", "NIFTY 200", "NIFTY 500", "NIFTY 1000", "NIFTY TOTAL MARKET",
  "NIFTY MIDCAP 50", "NIFTY MIDCAP 100", "NIFTY MIDCAP 150", "NIFTY MIDCAP SELECT", "NIFTY SMALLCAP 50", "NIFTY SMALLCAP 100",
  "NIFTY SMALLCAP 250", "NIFTY SMALLCAP 500", "NIFTY MICROCAP 250", "NIFTY LARGEMIDCAP 250", "NIFTY MIDSMALLCAP 400",
  "NIFTY500 MULTICAP 50:25:25", "NIFTY500 LARGEMIDSMALL EQUAL-CAP WEIGHTED", "NIFTY SME EMERGE",
]);
const SECTORAL = [
  "NIFTY AUTO", "NIFTY BANK", "NIFTY CEMENT", "NIFTY CHEMICALS", "NIFTY CONSUMER DURABLES", "NIFTY ENERGY", "NIFTY FINANCIAL SERVICES",
  "NIFTY FINANCIAL SERVICES 25/50", "NIFTY FINANCIAL SERVICES EX-BANK", "NIFTY FMCG", "NIFTY HEALTHCARE INDEX", "NIFTY IT", "NIFTY MEDIA",
  "NIFTY METAL", "NIFTY OIL & GAS", "NIFTY PHARMA", "NIFTY PRIVATE BANK", "NIFTY PSU BANK", "NIFTY REALTY", "NIFTY CAPITAL GOODS",
  "NIFTY TELECOMMUNICATIONS", "NIFTY MIDSMALL FINANCIAL SERVICES", "NIFTY MIDSMALL HEALTHCARE", "NIFTY MIDSMALL IT & TELECOM",
  "NIFTY500 HEALTHCARE", "NIFTY INSURANCE", "NIFTY NBFC", "NIFTY CAPITAL MARKETS", "NIFTY HOSPITALS", "NIFTY POWER",
];

/** NSE family an index belongs to (by name, following NSE's index classification). */
export function indexCategory(key: string): NseCategory {
  const k = key.toUpperCase().trim();
  if (/VIX|FUTURES|ARBITRAGE|LEVERAGE|INVERSE|DIVIDEND POINTS/.test(k)) return "Volatility & derivatives";
  if (/G-SEC|GSEC|BOND|RATE INDEX|SDL|T-BILL|MONEY MARKET|DEBT|GILT/.test(k)) return "Fixed income";
  if (BROAD.has(k)) return "Broad market";
  if (/ALPHA|BETA|LOW[ -]VOLATILITY|QUALITY|VALUE|MOMENTUM|EQUAL[ -]WEIGHT|DIVIDEND|GROWTH 50|MULTIFACTOR|FLEXICAP|LIQUID 15|SHARIAH|USD|50:50|AHIMSA/.test(k)) return "Strategy";
  if (SECTORAL.includes(k)) return "Sectoral";
  return "Thematic";
}

/** Groups items by NSE family, keeping each family's input order. */
export function groupByCategory<T extends { key: string }>(items: T[]): { category: NseCategory; items: T[] }[] {
  const by = new Map<NseCategory, T[]>(NSE_CATEGORIES.map((c) => [c, []]));
  for (const i of items) by.get(indexCategory(i.key))!.push(i);
  return NSE_CATEGORIES.map((c) => ({ category: c, items: by.get(c)! })).filter((g) => g.items.length);
}
