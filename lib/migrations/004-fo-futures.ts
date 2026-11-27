import type { Migration } from "./index.ts";

/**
 * Latest-session futures contracts from the NSE F&O bhavcopy (index and stock futures), used by Futures AI
 * and the F&O scanner. Like fo_contracts, only the newest session is kept; no history is reconstructed.
 */
export const FO_FUTURES: Migration = {
  id: "004-fo-futures",
  description: "Latest-session NSE futures contracts (close, settlement, OI, lot) for Futures AI",
  sql: `
CREATE TABLE IF NOT EXISTS fo_futures (
  d             DATE             NOT NULL,
  underlying    TEXT             NOT NULL,
  inst          TEXT             NOT NULL CHECK (inst IN ('IDF', 'STF')),
  expiry        DATE             NOT NULL,
  close         DOUBLE PRECISION NOT NULL,
  prev_close    DOUBLE PRECISION,
  settle        DOUBLE PRECISION,
  underlying_px DOUBLE PRECISION,
  oi_qty        DOUBLE PRECISION NOT NULL,
  oi_chg_qty    DOUBLE PRECISION NOT NULL,
  contracts     DOUBLE PRECISION NOT NULL,
  lot           DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (underlying, expiry)
);
CREATE INDEX IF NOT EXISTS fo_futures_expiry ON fo_futures (expiry);`,
};
