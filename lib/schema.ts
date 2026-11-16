// Idempotent schema (P1 Foundation), applied automatically on first database use.
export const SCHEMA_SQL = /* sql */ `
-- TradestXPro schema (P1 Foundation). Idempotent: safe to run repeatedly.
CREATE TABLE IF NOT EXISTS users (
  id                 BIGSERIAL PRIMARY KEY,
  name               TEXT        NOT NULL,
  email              TEXT        NOT NULL UNIQUE,
  phone              TEXT,
  password_hash      TEXT        NOT NULL,
  plan               TEXT        NOT NULL DEFAULT 'trial',
  trial_ends_at      TIMESTAMPTZ,
  email_verified_at  TIMESTAMPTZ,
  failed_logins      INTEGER     NOT NULL DEFAULT 0,
  locked_until       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_otps (
  user_id            BIGINT      PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash          TEXT        NOT NULL,
  expires_at         TIMESTAMPTZ NOT NULL,
  attempts           INTEGER     NOT NULL DEFAULT 0,
  last_sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sends_window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  sends_in_window    INTEGER     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash         TEXT        PRIMARY KEY,
  user_id            BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  user_agent         TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  action             TEXT        NOT NULL,
  detail             JSONB,
  ip                 TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
