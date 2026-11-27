import type { Migration } from "./index.ts";

/**
 * Developer platform: organisations, members, projects, API credentials (hashed), usage and SDK
 * entitlements. No billing: entitlements are granted manually; `plan` records the intended tier.
 * SDK licensing is separate from exchange market-data licensing (no data entitlements here).
 */
export const DEVELOPER_ACCOUNTS: Migration = {
  id: "001-developer-accounts",
  description: "Developer organisations, projects, API credentials, usage and SDK entitlements",
  sql: `
CREATE TABLE IF NOT EXISTS dev_organizations (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT        NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  created_by    BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dev_members (
  org_id        BIGINT      NOT NULL REFERENCES dev_organizations(id) ON DELETE CASCADE,
  user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT        NOT NULL CHECK (role IN ('owner', 'admin', 'developer', 'viewer')),
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS dev_members_user_idx ON dev_members (user_id);

CREATE TABLE IF NOT EXISTS dev_projects (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT      NOT NULL REFERENCES dev_organizations(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  allowed_origins TEXT[]    NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS dev_projects_org_idx ON dev_projects (org_id);

-- Only a SHA-256 hash of each key is stored; the plaintext is shown once at creation.
CREATE TABLE IF NOT EXISTS dev_api_keys (
  id            BIGSERIAL PRIMARY KEY,
  project_id    BIGINT      NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
  label         TEXT        NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  prefix        TEXT        NOT NULL UNIQUE,
  key_hash      TEXT        NOT NULL UNIQUE,
  created_by    BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  replaced_by   BIGINT      REFERENCES dev_api_keys(id) ON DELETE SET NULL,
  rate_limit_per_min INTEGER NOT NULL DEFAULT 60 CHECK (rate_limit_per_min BETWEEN 1 AND 100000)
);
CREATE INDEX IF NOT EXISTS dev_api_keys_project_idx ON dev_api_keys (project_id);

-- Per-key, per-minute request counters (usage monitoring and rate limits). Retention: 35 days.
CREATE TABLE IF NOT EXISTS dev_api_usage (
  key_id        BIGINT      NOT NULL REFERENCES dev_api_keys(id) ON DELETE CASCADE,
  minute        TIMESTAMPTZ NOT NULL,
  requests      INTEGER     NOT NULL DEFAULT 0,
  rejected      INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, minute)
);
CREATE INDEX IF NOT EXISTS dev_api_usage_minute_idx ON dev_api_usage (minute);

-- SDK licence entitlements (software only; never market data). Granted manually; no billing.
CREATE TABLE IF NOT EXISTS dev_sdk_entitlements (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT      NOT NULL REFERENCES dev_organizations(id) ON DELETE CASCADE,
  product       TEXT        NOT NULL CHECK (product IN ('xchart')),
  plan          TEXT        NOT NULL CHECK (plan IN ('evaluation', 'commercial', 'enterprise')),
  status        TEXT        NOT NULL CHECK (status IN ('active', 'suspended', 'expired')),
  seats         INTEGER,
  valid_from    DATE        NOT NULL DEFAULT CURRENT_DATE,
  valid_until   DATE,
  notes         TEXT,
  granted_by    BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dev_sdk_entitlements_org_idx ON dev_sdk_entitlements (org_id);

CREATE TABLE IF NOT EXISTS dev_support_requests (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT      NOT NULL REFERENCES dev_organizations(id) ON DELETE CASCADE,
  user_id       BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  subject       TEXT        NOT NULL CHECK (length(subject) BETWEEN 3 AND 120),
  body          TEXT        NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  status        TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
`,
};
