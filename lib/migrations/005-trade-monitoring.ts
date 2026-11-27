import type { Migration } from "./index.ts";

/**
 * Trade-plan monitoring (paper tracking only: nothing is ever sent to a broker), its event history,
 * and price alerts. Evaluated on end-of-day closes by the daily EOD job.
 */
export const TRADE_MONITORING: Migration = {
  id: "005-trade-monitoring",
  description: "Tracked trade plans, plan events and price alerts (evaluated on end-of-day data)",
  sql: `
CREATE TABLE IF NOT EXISTS trade_plans (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instrument       TEXT        NOT NULL,
  origin           TEXT        NOT NULL CHECK (origin IN ('engine', 'manual')),
  analysis_id      BIGINT,
  setup            TEXT,
  score            REAL,
  plan             JSONB       NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'WATCHING' CHECK (status IN ('WATCHING', 'ACTIVE', 'CLOSED', 'EXPIRED', 'INVALIDATED', 'CANCELLED')),
  outcome          JSONB,
  start_date       DATE        NOT NULL,
  evaluated_through DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trade_plans_user_idx ON trade_plans (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trade_plans_open_idx ON trade_plans (status) WHERE status IN ('WATCHING', 'ACTIVE');

CREATE TABLE IF NOT EXISTS trade_plan_events (
  id         BIGSERIAL PRIMARY KEY,
  plan_id    BIGINT      NOT NULL REFERENCES trade_plans(id) ON DELETE CASCADE,
  d          DATE        NOT NULL,
  kind       TEXT        NOT NULL,
  price      DOUBLE PRECISION,
  note       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trade_plan_events_plan_idx ON trade_plan_events (plan_id, id);

CREATE TABLE IF NOT EXISTS price_alerts (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instrument    TEXT        NOT NULL,
  condition     TEXT        NOT NULL CHECK (condition IN ('close_above', 'close_below', 'high_above', 'low_below', 'pct_change_above', 'pct_change_below')),
  threshold     DOUBLE PRECISION NOT NULL,
  note          TEXT,
  status        TEXT        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'TRIGGERED', 'DISABLED')),
  repeat        BOOLEAN     NOT NULL DEFAULT false,
  last_evaluated DATE,
  triggered_at  TIMESTAMPTZ,
  trigger_d     DATE,
  trigger_value DOUBLE PRECISION,
  seen          BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_alerts_user_idx ON price_alerts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS price_alerts_active_idx ON price_alerts (status) WHERE status = 'ACTIVE';`,
};
