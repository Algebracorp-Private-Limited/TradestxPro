import type { Migration } from "./index.ts";

/**
 * Market scanner jobs and results, saved scan configurations, imported fundamentals.
 * Retention: scan jobs/results older than 30 days may be deleted (`pruneScans`).
 */
export const MARKET_SCAN: Migration = {
  id: "003-market-scan",
  description: "Scan jobs, scan results, saved scan configurations, fundamentals datasets",
  sql: `
CREATE TABLE IF NOT EXISTS scan_jobs (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key  TEXT,
  kind             TEXT        NOT NULL CHECK (kind IN ('equity', 'fo')),
  mode             TEXT        NOT NULL CHECK (mode IN ('comprehensive', 'accelerated')),
  config           JSONB       NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'cancelled', 'failed')),
  queue            JSONB       NOT NULL DEFAULT '[]',
  coverage         JSONB       NOT NULL DEFAULT '{}',
  progress         REAL        NOT NULL DEFAULT 0,
  data_version     TEXT,
  error            TEXT,
  lease_until      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS scan_jobs_user_idx ON scan_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scan_jobs_pending_idx ON scan_jobs (status) WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS scan_results (
  job_id           BIGINT      NOT NULL REFERENCES scan_jobs(id) ON DELETE CASCADE,
  key              TEXT        NOT NULL,
  symbol           TEXT        NOT NULL,
  kind             TEXT        NOT NULL,
  status           TEXT        NOT NULL,
  score            REAL,
  payload          JSONB       NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, key)
);
CREATE INDEX IF NOT EXISTS scan_results_rank_idx ON scan_results (job_id, score DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS scan_configs (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  kind             TEXT        NOT NULL CHECK (kind IN ('equity', 'fo')),
  config           JSONB       NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scan_configs_user_idx ON scan_configs (user_id);

CREATE TABLE IF NOT EXISTS fundamentals_companies (
  symbol           TEXT        NOT NULL,
  provider_id      TEXT        NOT NULL,
  revision         TEXT        NOT NULL,
  provider         JSONB       NOT NULL,
  company          JSONB       NOT NULL,
  imported_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, provider_id)
);
`,
};
