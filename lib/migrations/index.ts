/**
 * Phase 4 database migrations.
 *
 * Unlike `lib/schema.ts` (applied automatically by `db()`), these are NEVER applied by the
 * application. They are applied explicitly with `scripts/migrate.ts --apply` against a chosen
 * database, after review. Features that need these tables check for them and report
 * "not configured" when they are missing. Migrations are append-only: never edit an applied one.
 */
import { DEVELOPER_ACCOUNTS } from "./001-developer-accounts.ts";
import { INTELLIGENCE_CORE } from "./002-intelligence-core.ts";
import { MARKET_SCAN } from "./003-market-scan.ts";
import { FO_FUTURES } from "./004-fo-futures.ts";
import { TRADE_MONITORING } from "./005-trade-monitoring.ts";
import { ALERTS_NOTIFICATIONS } from "./006-alerts-notifications.ts";

export type Migration = { id: string; description: string; sql: string };

export const MIGRATIONS: Migration[] = [DEVELOPER_ACCOUNTS, INTELLIGENCE_CORE, MARKET_SCAN, FO_FUTURES, TRADE_MONITORING, ALERTS_NOTIFICATIONS];

/** Bookkeeping table for applied migrations. */
export const MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  checksum    TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);`;
