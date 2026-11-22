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
