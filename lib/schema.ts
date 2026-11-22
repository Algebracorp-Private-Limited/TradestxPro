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

-- P2: instrument master (cash segment). Identity = exchange + exchange token.
CREATE TABLE IF NOT EXISTS instruments (
  id                 BIGSERIAL PRIMARY KEY,
  exchange           TEXT        NOT NULL,              -- NSE | BSE
  token              TEXT        NOT NULL,              -- exchange token / BSE scrip code
  symbol             TEXT        NOT NULL,              -- exchange trading symbol, e.g. RELIANCE
  breeze_code        TEXT        NOT NULL,              -- ICICI Breeze stock_code, e.g. RELIND
  name               TEXT        NOT NULL,
  series             TEXT,
  isin               TEXT,
  tick_size          NUMERIC,
  lot_size           INTEGER,
  face_value         NUMERIC,
  has_derivatives    BOOLEAN     NOT NULL DEFAULT false,
  active             BOOLEAN     NOT NULL DEFAULT true,
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exchange, token)
);
CREATE INDEX IF NOT EXISTS instruments_symbol_idx ON instruments (lower(symbol));
CREATE INDEX IF NOT EXISTS instruments_isin_idx ON instruments (isin);

-- P2: listed futures & options contracts. Identity = exchange + token;
-- canonical meaning = exchange + underlying + expiry + strike + option type.
CREATE TABLE IF NOT EXISTS derivative_contracts (
  exchange           TEXT        NOT NULL,              -- NFO | BFO
  token              TEXT        NOT NULL,
  instrument_type    TEXT        NOT NULL,              -- FUTIDX | FUTSTK | OPTIDX | OPTSTK
  underlying         TEXT        NOT NULL,              -- exchange symbol, e.g. NIFTY, RELIANCE
  underlying_name    TEXT        NOT NULL,
  breeze_code        TEXT        NOT NULL,
  expiry             DATE        NOT NULL,
  strike             NUMERIC,                           -- null for futures
  option_type        TEXT,                              -- CE | PE | null for futures
  lot_size           INTEGER     NOT NULL,
  tick_size          NUMERIC,
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (exchange, token)
);
CREATE INDEX IF NOT EXISTS derivative_underlying_idx ON derivative_contracts (underlying, expiry);

CREATE TABLE IF NOT EXISTS instrument_syncs (
  id                 BIGSERIAL PRIMARY KEY,
  source             TEXT        NOT NULL,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ,
  status             TEXT        NOT NULL DEFAULT 'running',  -- running | ok | error
  file_date          TIMESTAMPTZ,
  counts             JSONB,
  error              TEXT
);

-- P2: watchlists, scoped per user.
CREATE TABLE IF NOT EXISTS watchlists (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT        NOT NULL,
  position           INTEGER     NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS watchlists_user_idx ON watchlists (user_id);

-- P3: end-of-day OHLCV bars. series = 'NSE:<symbol>' for equities, 'NSEIDX:<INDEX NAME>' for indices.
CREATE TABLE IF NOT EXISTS candles (
  series             TEXT        NOT NULL,
  d                  DATE        NOT NULL,
  o                  DOUBLE PRECISION NOT NULL,
  h                  DOUBLE PRECISION NOT NULL,
  l                  DOUBLE PRECISION NOT NULL,
  c                  DOUBLE PRECISION NOT NULL,
  v                  DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (series, d)
);

CREATE TABLE IF NOT EXISTS market_indices (
  key                TEXT        PRIMARY KEY,           -- upper-case index name, e.g. NIFTY 50
  name               TEXT        NOT NULL,
  exchange           TEXT        NOT NULL DEFAULT 'NSE',
  last_d             DATE,
  close              DOUBLE PRECISION,
  change_pct         DOUBLE PRECISION,
  pe                 DOUBLE PRECISION,
  pb                 DOUBLE PRECISION,
  div_yield          DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS eod_days (
  exchange           TEXT        NOT NULL,
  kind               TEXT        NOT NULL,               -- index | equity
  d                  DATE        NOT NULL,
  status             TEXT        NOT NULL,               -- ok | no_data | error
  rows               INTEGER     NOT NULL DEFAULT 0,
  error              TEXT,
  loaded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (exchange, kind, d)
);

-- P3: precomputed technical snapshot per NSE equity for the screener (latest EOD bar).
CREATE TABLE IF NOT EXISTS screener_snapshot (
  symbol             TEXT        PRIMARY KEY,
  d                  DATE        NOT NULL,
  name               TEXT,
  close              DOUBLE PRECISION,
  change_pct         DOUBLE PRECISION,
  volume             DOUBLE PRECISION,
  avg_vol20          DOUBLE PRECISION,
  rel_vol            DOUBLE PRECISION,
  high52             DOUBLE PRECISION,
  low52              DOUBLE PRECISION,
  rsi14              DOUBLE PRECISION,
  ema20              DOUBLE PRECISION,
  ema50              DOUBLE PRECISION,
  ema200             DOUBLE PRECISION,
  macd_hist          DOUBLE PRECISION,
  macd_hist_prev     DOUBLE PRECISION,
  adx14              DOUBLE PRECISION,
  atr_pct            DOUBLE PRECISION,
  supertrend_dir     SMALLINT,
  ret5               DOUBLE PRECISION,
  ret20              DOUBLE PRECISION,
  ret60              DOUBLE PRECISION,
  bars               INTEGER,
  has_derivatives    BOOLEAN     NOT NULL DEFAULT false
);

-- Algo-trading interest waitlist (public sign-up).
CREATE TABLE IF NOT EXISTS algo_waitlist (
  id                 BIGSERIAL PRIMARY KEY,
  email              TEXT        NOT NULL UNIQUE,
  name               TEXT        NOT NULL,
  phone              TEXT,
  broker             TEXT,
  experience         TEXT,
  interests          TEXT[]      NOT NULL DEFAULT '{}',
  capital            TEXT,
  notes              TEXT,
  user_id            BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  ip                 TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Broker connections: credentials and session tokens are AES-256-GCM encrypted (BROKER_ENC_KEY).
CREATE TABLE IF NOT EXISTS broker_connections (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker             TEXT        NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'pending',   -- pending | connected | expired | error
  account_label      TEXT,                                     -- e.g. client id / name shown to the user
  credentials_enc    TEXT,                                     -- user-supplied app keys (encrypted JSON)
  session_enc        TEXT,                                     -- session tokens (encrypted JSON)
  oauth_state        TEXT,
  expires_at         TIMESTAMPTZ,
  last_error         TEXT,
  connected_at       TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, broker)
);

-- Short leases for background jobs (expire on their own if a run is killed).
CREATE TABLE IF NOT EXISTS job_locks (
  name               TEXT        PRIMARY KEY,
  until              TIMESTAMPTZ NOT NULL
);

-- P3: user XScript files.
CREATE TABLE IF NOT EXISTS scripts (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT        NOT NULL,
  code               TEXT        NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scripts_user_idx ON scripts (user_id);

CREATE TABLE IF NOT EXISTS watchlist_items (
  watchlist_id       BIGINT      NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  instrument_id      BIGINT      NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  position           INTEGER     NOT NULL DEFAULT 0,
  added_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (watchlist_id, instrument_id)
);
`;
