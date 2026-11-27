import type { Migration } from "./index.ts";

/**
 * Paper trading (simulation only; never sent to a broker): one virtual account per user, orders,
 * fills, positions. Orders fill only on market data that arrives after they are placed.
 */
export const PAPER_TRADING: Migration = {
  id: "007-paper-trading",
  description: "Paper-trading accounts, orders, fills and positions (simulation only)",
  sql: `
CREATE TABLE IF NOT EXISTS paper_accounts (
  user_id        BIGINT      PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  starting_cash  DOUBLE PRECISION NOT NULL,
  cash           DOUBLE PRECISION NOT NULL,
  costs_paid     DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reset_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS paper_orders (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instrument    TEXT        NOT NULL,
  side          TEXT        NOT NULL CHECK (side IN ('BUY', 'SELL')),
  qty           INTEGER     NOT NULL CHECK (qty > 0),
  order_type    TEXT        NOT NULL CHECK (order_type IN ('MARKET', 'LIMIT')),
  limit_price   DOUBLE PRECISION,
  placed_d      DATE        NOT NULL,
  valid_sessions INTEGER    NOT NULL DEFAULT 5,
  sessions_seen INTEGER     NOT NULL DEFAULT 0,
  status        TEXT        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED')),
  fill_price    DOUBLE PRECISION,
  fill_d        DATE,
  costs         DOUBLE PRECISION,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paper_orders_user_idx ON paper_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS paper_orders_open_idx ON paper_orders (status) WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS paper_positions (
  user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instrument    TEXT        NOT NULL,
  qty           INTEGER     NOT NULL,
  avg_price     DOUBLE PRECISION NOT NULL,
  realized_pnl  DOUBLE PRECISION NOT NULL DEFAULT 0,
  settled       BOOLEAN     NOT NULL DEFAULT false,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, instrument)
);

CREATE TABLE IF NOT EXISTS paper_fills (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id    BIGINT      REFERENCES paper_orders(id) ON DELETE SET NULL,
  instrument  TEXT        NOT NULL,
  side        TEXT        NOT NULL,
  qty         INTEGER     NOT NULL,
  price       DOUBLE PRECISION NOT NULL,
  costs       DOUBLE PRECISION NOT NULL DEFAULT 0,
  realized    DOUBLE PRECISION NOT NULL DEFAULT 0,
  kind        TEXT        NOT NULL DEFAULT 'TRADE' CHECK (kind IN ('TRADE', 'SETTLEMENT')),
  d           DATE        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paper_fills_user_idx ON paper_fills (user_id, id DESC);`,
};
