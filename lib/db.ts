import "server-only";
import postgres from "postgres";
import { createHash } from "node:crypto";
import { SCHEMA_SQL } from "./schema";

const SCHEMA_VERSION = createHash("sha256").update(SCHEMA_SQL).digest("hex").slice(0, 16);

type Sql = ReturnType<typeof postgres>;

const g = globalThis as unknown as { __sql?: Sql; __schemaReady?: Promise<void> };

export class NotConfiguredError extends Error {
  constructor(what = "database") {
    super(`The ${what} is not configured yet.`);
  }
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function client(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new NotConfiguredError();
  if (!g.__sql) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    g.__sql = postgres(url, {
      max: 5,
      idle_timeout: 20,
      ssl: local ? false : "require",
      prepare: false, // works with pooled (PgBouncer) connection strings
      onnotice: () => {},
    });
  }
  return g.__sql;
}

/** Applies the idempotent schema only when it changed since it was last applied (one quick lookup otherwise). */
async function ensureSchema(sql: Sql): Promise<void> {
  try {
    const [row] = await sql<{ v: string }[]>`SELECT version AS v FROM schema_meta WHERE version = ${SCHEMA_VERSION}`;
    if (row) return;
  } catch {
    // schema_meta does not exist yet: fall through and create everything.
  }
  await sql.unsafe(SCHEMA_SQL);
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS schema_meta (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await sql`INSERT INTO schema_meta (version) VALUES (${SCHEMA_VERSION}) ON CONFLICT DO NOTHING`;
}

/** Returns a SQL client, making sure the schema is current once per server instance. */
export async function db(): Promise<Sql> {
  const sql = client();
  if (!g.__schemaReady) {
    g.__schemaReady = ensureSchema(sql);
    g.__schemaReady.catch(() => {
      g.__schemaReady = undefined;
    });
  }
  await g.__schemaReady;
  return sql;
}
