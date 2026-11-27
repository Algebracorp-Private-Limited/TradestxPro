// Pure (client- and test-safe) F&O underlying metadata.

/** F&O underlying symbol → index key used by quotes and charts. */
export const UNDERLYING_INDEX: Record<string, string> = {
  NIFTY: "NIFTY 50",
  BANKNIFTY: "NIFTY BANK",
  FINNIFTY: "NIFTY FINANCIAL SERVICES",
  MIDCPNIFTY: "NIFTY MIDCAP SELECT",
  NIFTYNXT50: "NIFTY NEXT 50",
  SENSEX: "SENSEX",
  BANKEX: "BANKEX",
};
