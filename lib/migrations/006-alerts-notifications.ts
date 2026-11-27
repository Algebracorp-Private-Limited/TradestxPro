import type { Migration } from "./index.ts";

/**
 * Alerts beyond price levels (technical, open interest, implied volatility, engine setups), an in-app
 * notification centre with opt-in e-mail, and the AI watchlist (daily engine re-evaluation of symbols).
 */
export const ALERTS_NOTIFICATIONS: Migration = {
  id: "006-alerts-notifications",
  description: "Technical/OI/IV/setup alert conditions, notifications, notification settings, AI watchlist",
  sql: `
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
CREATE INDEX IF NOT EXISTS ai_watch_items_user_idx ON ai_watch_items (user_id);`,
};
