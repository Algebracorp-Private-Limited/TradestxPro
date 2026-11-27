// Applies Phase 4 migrations (lib/migrations) to a database chosen explicitly by the operator.
//
//   node --experimental-strip-types scripts/migrate.ts --database-url <url>            dry run: lists pending migrations
//   node --experimental-strip-types scripts/migrate.ts --database-url <url> --apply    applies them in one transaction each
//
// The URL is never read from the environment, so the production DATABASE_URL cannot be migrated
// by accident. Applied migrations are recorded with a checksum; an edited applied migration aborts.
import postgres from "postgres";
import { createHash } from "node:crypto";
import { MIGRATIONS, MIGRATIONS_TABLE_SQL } from "../lib/migrations/index.ts";

const args = process.argv.slice(2);
const urlIdx = args.indexOf("--database-url");
const url = urlIdx >= 0 ? args[urlIdx + 1] : undefined;
const apply = args.includes("--apply");
if (!url) {
  console.error("Usage: scripts/migrate.ts --database-url <postgres-url> [--apply]");
  process.exit(2);
}
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const sql = postgres(url, { max: 1, ssl: local ? false : "require", prepare: false, onnotice: () => {} });
const sum = (s: string) => createHash("sha256").update(s).digest("hex");

try {
  await sql.unsafe(MIGRATIONS_TABLE_SQL);
  const applied = new Map((await sql<{ id: string; checksum: string }[]>`SELECT id, checksum FROM schema_migrations`).map((r) => [r.id, r.checksum]));
  for (const m of MIGRATIONS) {
    const c = sum(m.sql);
    if (applied.has(m.id)) {
      if (applied.get(m.id) !== c) throw new Error(`Migration ${m.id} was changed after it was applied (checksum mismatch)`);
      console.log(`= ${m.id} (applied)`);
      continue;
    }
    if (!apply) {
      console.log(`+ ${m.id} — ${m.description} (pending; re-run with --apply)`);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(m.sql);
      await tx`INSERT INTO schema_migrations (id, description, checksum) VALUES (${m.id}, ${m.description}, ${c})`;
    });
    console.log(`✔ ${m.id} applied`);
  }
} finally {
  await sql.end();
}
