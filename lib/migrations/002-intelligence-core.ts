import type { Migration } from "./index.ts";

/**
 * AI Intelligence core: AI provider usage (cost monitoring) and immutable analysis records.
 * `ai_analyses` rows cannot be updated (trigger): an analysis is never rewritten after the fact;
 * corrections are new rows that reference the original. Retention: usage 400 days, analyses kept.
 */
export const INTELLIGENCE_CORE: Migration = {
  id: "002-intelligence-core",
  description: "AI usage records and immutable AI analysis records",
  sql: `
CREATE TABLE IF NOT EXISTS ai_usage (
  id             BIGSERIAL PRIMARY KEY,
  at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id        BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  provider       TEXT        NOT NULL,
  model          TEXT,
  prompt_id      TEXT        NOT NULL,
  prompt_version TEXT        NOT NULL,
  input_tokens   INTEGER     NOT NULL DEFAULT 0,
  output_tokens  INTEGER     NOT NULL DEFAULT 0,
  cost_usd       NUMERIC(12, 6),
  latency_ms     INTEGER     NOT NULL DEFAULT 0,
  outcome        TEXT        NOT NULL,
  error          TEXT
);
CREATE INDEX IF NOT EXISTS ai_usage_at_idx ON ai_usage (at);
CREATE INDEX IF NOT EXISTS ai_usage_user_idx ON ai_usage (user_id, at);

CREATE TABLE IF NOT EXISTS ai_analyses (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT      REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT        NOT NULL,
  target         TEXT        NOT NULL,
  versions       JSONB       NOT NULL,
  input_snapshot JSONB       NOT NULL,
  output         JSONB       NOT NULL,
  supersedes     BIGINT      REFERENCES ai_analyses(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_analyses_user_idx ON ai_analyses (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_analyses_target_idx ON ai_analyses (kind, target, created_at DESC);

CREATE OR REPLACE FUNCTION ai_analyses_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ai_analyses rows are immutable; insert a new row that supersedes this one';
END $$;
DROP TRIGGER IF EXISTS ai_analyses_no_update ON ai_analyses;
CREATE TRIGGER ai_analyses_no_update BEFORE UPDATE ON ai_analyses FOR EACH ROW EXECUTE FUNCTION ai_analyses_immutable();
`,
};
