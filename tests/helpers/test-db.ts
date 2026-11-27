/**
 * Integration-test database: a scratch Postgres given by TEST_DATABASE_URL (never DATABASE_URL).
 * Each call resets the `public` schema, then applies lib/schema.ts and every lib/migrations entry,
 * exactly as an operator would. Tests skip (with a reason) when no test database is configured.
 */
import postgres from "postgres";
import { SCHEMA_SQL } from "../../lib/schema.ts";
import { MIGRATIONS, MIGRATIONS_TABLE_SQL } from "../../lib/migrations/index.ts";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "";
export const noDbReason = TEST_DB_URL ? false : "set TEST_DATABASE_URL to a scratch Postgres to run database tests";

export async function freshDb() {
  if (/prod|supabase|neon|amazonaws|vercel/i.test(TEST_DB_URL)) throw new Error("TEST_DATABASE_URL looks like a hosted database; use a local scratch database");
  const sql = postgres(TEST_DB_URL, { max: 4, prepare: false, onnotice: () => {} });
  await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await sql.unsafe(SCHEMA_SQL);
  await sql.unsafe(MIGRATIONS_TABLE_SQL);
  for (const m of MIGRATIONS) await sql.unsafe(m.sql);
  return sql;
}

export async function makeUser(sql: postgres.Sql, email: string): Promise<number> {
  const [u] = await sql<{ id: number }[]>`INSERT INTO users (email, name, password_hash) VALUES (${email}, ${email.split("@")[0]}, 'x') RETURNING id`;
  return Number(u.id);
}
