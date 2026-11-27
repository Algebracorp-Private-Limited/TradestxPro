/**
 * Integration-test databases on a scratch Postgres given by TEST_DATABASE_URL (never DATABASE_URL).
 * Test files run in parallel, so each file gets its own database (`<db>_<name>`), recreated on every
 * run, with lib/schema.ts and every lib/migrations entry applied exactly as an operator would.
 * Tests skip (with a reason) when no test database is configured; CI makes such skips fail.
 */
import postgres from "postgres";
import { SCHEMA_SQL } from "../../lib/schema.ts";
import { MIGRATIONS, MIGRATIONS_TABLE_SQL } from "../../lib/migrations/index.ts";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "";
export const noDbReason = TEST_DB_URL ? false : "set TEST_DATABASE_URL to a scratch Postgres to run database tests";

/** Creates (or recreates) the database `<base>_<name>`; returns a client and its URL. */
export async function scratchDb(name: string, opts: { migrate?: boolean } = {}) {
  if (/prod|supabase|neon|amazonaws|vercel/i.test(TEST_DB_URL)) throw new Error("TEST_DATABASE_URL looks like a hosted database; use a local scratch database");
  if (!/^[a-z0-9_]{1,30}$/.test(name)) throw new Error("invalid scratch database name");
  const u = new URL(TEST_DB_URL);
  const base = u.pathname.slice(1) || "postgres";
  const dbName = `${base}_${name}`;
  const admin = postgres(TEST_DB_URL, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
  u.pathname = `/${dbName}`;
  const url = u.toString();
  const sql = postgres(url, { max: 4, prepare: false, onnotice: () => {} });
  await sql.unsafe(SCHEMA_SQL);
  if (opts.migrate !== false) {
    await sql.unsafe(MIGRATIONS_TABLE_SQL);
    for (const m of MIGRATIONS) await sql.unsafe(m.sql);
  }
  return { sql, url };
}

/** Database with the base schema and all migrations applied. */
export async function freshDb(name: string) {
  return (await scratchDb(name)).sql;
}

export async function makeUser(sql: postgres.Sql, email: string): Promise<number> {
  const [u] = await sql<{ id: number }[]>`INSERT INTO users (email, name, password_hash) VALUES (${email}, ${email.split("@")[0]}, 'x') RETURNING id`;
  return Number(u.id);
}
