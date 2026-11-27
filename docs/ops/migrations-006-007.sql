-- TradestxPro production migrations 006 + 007 (alerts/notifications/AI watchlist, paper trading).
-- Run once in the Neon SQL editor: project TradestxPro, branch main, database neondb.
-- All-or-nothing: if any statement fails, nothing is applied. Safe to check first with:
--   SELECT id FROM schema_migrations ORDER BY id;   (should end at 005-trade-monitoring)

BEGIN;

-- ===== 006-alerts-notifications =====
ALTER TABLE price_alerts DROP CONSTRAINT IF EXISTS price_alerts_condition_check;

ALTER TABLE price_alerts ADD CONSTRAINT price_alerts_condition_check CHECK (condition IN (
  'close_above', 'close_below', 'high_above', 'low_below', 'pct_change_above', 'pct_change_below',
  'rsi_above', 'rsi_below', 'cross_above_sma', 'cross_below_sma', 'cross_above_ema', 'cross_below_ema', 'volume_spike',
  'oi_change_pct_above', 'oi_change_pct_below', 'atm_iv_above', 'atm_iv_below', 'setup_signal'));

ALTER TABLE price_alerts ADD COLUMN IF NOT EXISTS params JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL CHECK (kind IN ('alert', 'plan', 'watchlist')),
  title       TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  link        TEXT,
  d           DATE        NOT NULL,
  read_at     TIMESTAMPTZ,
  emailed_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_unemailed_idx ON notifications (user_id) WHERE emailed_at IS NULL;

CREATE TABLE IF NOT EXISTS notification_settings (
  user_id      BIGINT      PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_alerts BOOLEAN     NOT NULL DEFAULT false,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_watch_items (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol       TEXT        NOT NULL,
  horizon      TEXT        NOT NULL DEFAULT 'swing',
  last_status  TEXT,
  last_score   REAL,
  last_setup   TEXT,
  last_eval_d  DATE,
  payload      JSONB,
  changed_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol, horizon)
);

CREATE INDEX IF NOT EXISTS ai_watch_items_user_idx ON ai_watch_items (user_id);

INSERT INTO schema_migrations (id, description, checksum) VALUES ('006-alerts-notifications', 'Technical/OI/IV/setup alert conditions, notifications, notification settings, AI watchlist', '7003081aa9c4e299fcec8e09eb1ae620560db62cf33272db8e5b79a5bb2f5799');

-- ===== 007-paper-trading =====
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

CREATE INDEX IF NOT EXISTS paper_fills_user_idx ON paper_fills (user_id, id DESC);

INSERT INTO schema_migrations (id, description, checksum) VALUES ('007-paper-trading', 'Paper-trading accounts, orders, fills and positions (simulation only)', 'b832f965e631bcfe6c286b7839dcfad923d65cdaca4ddc7f4b0f5a9301a9f9b4');

COMMIT;

-- Verify: SELECT id, left(checksum,12) FROM schema_migrations ORDER BY id;  (7 rows)