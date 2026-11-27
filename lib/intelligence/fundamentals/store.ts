/** Imported fundamentals (migration 003). Imports are explicit operator actions (scripts/import-fundamentals.ts). */
import type postgres from "postgres";
import type { Company, FundamentalsDataset } from "./dataset.ts";

type Sql = postgres.Sql;

export async function importFundamentals(sql: Sql, d: FundamentalsDataset): Promise<number> {
  let n = 0;
  await sql.begin(async (tx) => {
    for (const [symbol, company] of Object.entries(d.companies)) {
      await tx`INSERT INTO fundamentals_companies (symbol, provider_id, revision, provider, company)
               VALUES (${symbol}, ${d.provider.id}, ${d.revision}, ${tx.json(d.provider as never)}, ${tx.json(company as never)})
               ON CONFLICT (symbol, provider_id) DO UPDATE SET revision = EXCLUDED.revision, provider = EXCLUDED.provider, company = EXCLUDED.company, imported_at = now()`;
      n++;
    }
  });
  return n;
}

export type StoredCompany = { symbol: string; company: Company; provider: FundamentalsDataset["provider"]; revision: string; importedAt: string };

export async function getCompany(sql: Sql, symbol: string): Promise<StoredCompany | null> {
  const [r] = await sql<{ symbol: string; company: Company; provider: FundamentalsDataset["provider"]; revision: string; imported_at: Date }[]>`
    SELECT symbol, company, provider, revision, imported_at FROM fundamentals_companies WHERE symbol = ${symbol} ORDER BY imported_at DESC LIMIT 1`;
  return r ? { symbol: r.symbol, company: r.company, provider: r.provider, revision: r.revision, importedAt: r.imported_at.toISOString() } : null;
}

export async function peersOf(sql: Sql, symbol: string, industry: string, limit = 12): Promise<StoredCompany[]> {
  const rows = await sql<{ symbol: string; company: Company; provider: FundamentalsDataset["provider"]; revision: string; imported_at: Date }[]>`
    SELECT DISTINCT ON (symbol) symbol, company, provider, revision, imported_at FROM fundamentals_companies
     WHERE company->>'industry' = ${industry} AND symbol <> ${symbol} ORDER BY symbol, imported_at DESC LIMIT ${limit}`;
  return rows.map((r) => ({ symbol: r.symbol, company: r.company, provider: r.provider, revision: r.revision, importedAt: r.imported_at.toISOString() }));
}

export async function fundamentalsCoverage(sql: Sql): Promise<{ companies: number; providers: string[] }> {
  const [r] = await sql<{ companies: number; providers: string[] | null }[]>`SELECT count(DISTINCT symbol)::int AS companies, array_agg(DISTINCT provider_id) AS providers FROM fundamentals_companies`;
  return { companies: r?.companies ?? 0, providers: r?.providers?.filter(Boolean) ?? [] };
}
