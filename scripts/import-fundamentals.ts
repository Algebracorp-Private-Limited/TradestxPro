// Imports a txp-fundamentals dataset (licensed provider data or data prepared from company filings).
//   node --experimental-strip-types scripts/import-fundamentals.ts --database-url <url> --file <dataset.json> [--apply]
// Validates first; writes only with --apply. The URL is never read from the environment.
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { parseFundamentals } from "../lib/intelligence/fundamentals/dataset.ts";
import { importFundamentals } from "../lib/intelligence/fundamentals/store.ts";

const a = process.argv.slice(2);
const url = a[a.indexOf("--database-url") + 1];
const file = a[a.indexOf("--file") + 1];
if (!a.includes("--database-url") || !a.includes("--file") || !url || !file) {
  console.error("Usage: scripts/import-fundamentals.ts --database-url <url> --file <dataset.json> [--apply]");
  process.exit(2);
}
const d = parseFundamentals(readFileSync(file, "utf8"));
console.log(`Valid ${d.format} revision ${d.revision} from ${d.provider.name} (${d.provider.source.name}, retrieved ${d.provider.retrievedAt}): ${Object.keys(d.companies).length} companies`);
if (!a.includes("--apply")) {
  console.log("Dry run: re-run with --apply to import.");
  process.exit(0);
}
const sql = postgres(url, { max: 1, ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : "require", prepare: false, onnotice: () => {} });
try {
  console.log(`Imported ${await importFundamentals(sql, d)} companies.`);
} finally {
  await sql.end();
}
