/**
 * Persistence for AI usage (cost monitoring) and analysis records (migration 002). Analysis rows
 * are immutable; reads are always scoped to the requesting user.
 */
import type postgres from "postgres";
import type { AnalysisVersions } from "../core/types.ts";
import type { UsageRecord } from "../ai-providers/types.ts";

type Sql = postgres.Sql;
const ready = new WeakMap<object, boolean>();

export async function intelligenceTablesAvailable(sql: Sql): Promise<boolean> {
  if (ready.has(sql)) return ready.get(sql)!;
  const [r] = await sql<{ t: string | null }[]>`SELECT to_regclass('public.ai_analyses')::text AS t`;
  const ok = Boolean(r?.t);
  ready.set(sql, ok);
  return ok;
}

export async function recordUsage(sql: Sql, u: UsageRecord): Promise<void> {
  if (!(await intelligenceTablesAvailable(sql))) return;
  await sql`INSERT INTO ai_usage (at, user_id, provider, model, prompt_id, prompt_version, input_tokens, output_tokens, cost_usd, latency_ms, outcome, error)
            VALUES (${u.at}, ${u.userId}, ${u.provider}, ${u.model}, ${u.promptId}, ${u.promptVersion}, ${u.inputTokens}, ${u.outputTokens}, ${u.costUsd}, ${Math.round(u.latencyMs)}, ${u.outcome}, ${u.error?.slice(0, 500) ?? null})`;
}

export type StoredAnalysis = { id: number; kind: string; target: string; versions: AnalysisVersions; input: unknown; output: unknown; supersedes: number | null; createdAt: string };

export async function recordAnalysis(sql: Sql, a: { userId: number | null; kind: string; target: string; versions: AnalysisVersions; input: unknown; output: unknown; supersedes?: number | null }): Promise<number | null> {
  if (!(await intelligenceTablesAvailable(sql))) return null;
  const [r] = await sql<{ id: number }[]>`
    INSERT INTO ai_analyses (user_id, kind, target, versions, input_snapshot, output, supersedes)
    VALUES (${a.userId}, ${a.kind.slice(0, 40)}, ${a.target.slice(0, 120)}, ${sql.json(a.versions as never)}, ${sql.json(a.input as never)}, ${sql.json(a.output as never)}, ${a.supersedes ?? null}) RETURNING id`;
  return Number(r.id);
}

/** A user's own analyses (never another user's). */
export async function listAnalyses(sql: Sql, userId: number, opts: { kind?: string; target?: string; limit?: number } = {}): Promise<StoredAnalysis[]> {
  if (!(await intelligenceTablesAvailable(sql))) return [];
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
  const rows = await sql<{ id: number; kind: string; target: string; versions: AnalysisVersions; input_snapshot: unknown; output: unknown; supersedes: number | null; created_at: Date }[]>`
    SELECT id, kind, target, versions, input_snapshot, output, supersedes, created_at FROM ai_analyses
     WHERE user_id = ${userId} ${opts.kind ? sql`AND kind = ${opts.kind}` : sql``} ${opts.target ? sql`AND target = ${opts.target}` : sql``}
     ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
  return rows.map((r) => ({ id: Number(r.id), kind: r.kind, target: r.target, versions: r.versions, input: r.input_snapshot, output: r.output, supersedes: r.supersedes === null ? null : Number(r.supersedes), createdAt: r.created_at.toISOString() }));
}

/** Cost and volume summary for monitoring (all users; for administrators). */
export async function usageSummary(sql: Sql, days = 30) {
  if (!(await intelligenceTablesAvailable(sql))) return null;
  return sql<{ day: Date; provider: string; model: string | null; requests: number; input_tokens: number; output_tokens: number; cost_usd: number | null; failures: number }[]>`
    SELECT date_trunc('day', at) AS day, provider, model, count(*)::int AS requests, sum(input_tokens)::int AS input_tokens, sum(output_tokens)::int AS output_tokens,
           sum(cost_usd)::float AS cost_usd, count(*) FILTER (WHERE outcome IN ('error', 'invalid-output'))::int AS failures
      FROM ai_usage WHERE at >= now() - make_interval(days => ${Math.min(Math.max(1, days), 400)})
     GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2`;
}
