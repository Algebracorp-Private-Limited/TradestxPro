import "server-only";
import postgres from "postgres";
import { SCHEMA_SQL } from "./schema";

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

/** Returns a SQL client, applying the idempotent schema once per server instance. */
export async function db(): Promise<Sql> {
  const sql = client();
  if (!g.__schemaReady) {
    g.__schemaReady = sql.unsafe(SCHEMA_SQL).then(() => undefined);
    g.__schemaReady.catch(() => {
      g.__schemaReady = undefined;
    });
  }
  await g.__schemaReady;
  return sql;
}
