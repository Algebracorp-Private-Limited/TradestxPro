/**
 * Market scan jobs (migration 003). A scan is created once (idempotent per key), then advanced in
 * short, leased chunks by status polls or a background trigger — never one long HTTP request.
 * Results and coverage are persisted after every chunk, so partial results survive interruptions.
 *
 * Stages (Phase 4 §17): 1 universe + deterministic per-symbol scan · 2 regime/technical/liquidity ·
 * 3 derivatives chains (F&O jobs) · 4 candidate setups · 5 capital/liquidity/risk constraints ·
 * 6 ranking (score, at read time) · 7 AI explanations for the top candidates · 8 validation (AI output
 * grounding) and rendering.
 */
import type postgres from "postgres";
import { provenance } from "../core/freshness.ts";
import { analyzeEquity, type EquitySetup } from "../equity/setup.ts";
import { explainEquity } from "../equity/explain.ts";
import type { AIClient } from "../ai-providers/client.ts";
import { resolveUniverse } from "../market-data/data.ts";
import { dedupeUniverse } from "../instruments/master.ts";
import { sanitizeScanConfig, type ScanConfig } from "./config.ts";
import { evaluateFoSymbol, loadFo } from "./fo.ts";
import { applyEquityValidation } from "../validation/plans.ts";
import { UNDERLYING_INDEX } from "../../options/underlyings.ts";

type Sql = postgres.Sql;
export type ScanMode = "comprehensive" | "accelerated";

export type Coverage = {
  mode: ScanMode;
  universes: string[];
  unavailableUniverses: string[];
  selected: number;
  unique: number;
  duplicates: number;
  shortlisted: number | null;
  notDeepEvaluated: number;
  scanned: number;
  excluded: Record<string, number>;
  missingData: number;
  staleData: number;
  opportunities: Record<string, number>;
  instrumentsNotScanned: string[];
  chainsRetrieved: number;
  contractsEvaluated: number;
  contractsExcluded: number;
  aiRequests: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  aiCostUsd: number;
  marketDataRequests: number;
  startedAt: string | null;
  finishedAt: string | null;
};

export class ScanError extends Error {
  readonly status: number;
  constructor(m: string, status = 400) {
    super(m);
    this.status = status;
  }
}

export async function scanTablesAvailable(sql: Sql): Promise<boolean> {
  const [r] = await sql<{ t: string | null }[]>`SELECT to_regclass('public.scan_jobs')::text AS t`;
  return Boolean(r?.t);
}

const emptyCoverage = (mode: ScanMode, cfg: ScanConfig): Coverage => ({
  mode, universes: cfg.universes, unavailableUniverses: [], selected: 0, unique: 0, duplicates: 0, shortlisted: null, notDeepEvaluated: 0, scanned: 0, excluded: {},
  missingData: 0, staleData: 0, opportunities: {}, instrumentsNotScanned: [], chainsRetrieved: 0, contractsEvaluated: 0,
  contractsExcluded: 0, aiRequests: 0, aiInputTokens: 0, aiOutputTokens: 0, aiCostUsd: 0, marketDataRequests: 0, startedAt: null, finishedAt: null,
});

/** Accelerated mode's documented first-stage shortlist rule (EOD snapshot, no bar loading). */
export function shortlistRule(cfg: ScanConfig) {
  return cfg.direction === "bearish"
    ? "close below the 50-day EMA and 20-day return ≤ 0"
    : "close above the 50-day EMA, 20-day return ≥ 0 and relative volume ≥ 0.8 (or ADX ≥ 20)";
}

export async function createScan(sql: Sql, userId: number, rawConfig: unknown, mode: ScanMode, idempotencyKey: string | null) {
  const cfg = sanitizeScanConfig(rawConfig);
  if (idempotencyKey !== null && !/^[A-Za-z0-9_-]{8,64}$/.test(idempotencyKey)) throw new ScanError("invalid idempotency key");
  if (idempotencyKey) {
    const [existing] = await sql<{ id: number }[]>`SELECT id FROM scan_jobs WHERE user_id = ${userId} AND idempotency_key = ${idempotencyKey}`;
    if (existing) return { id: Number(existing.id), reused: true };
  }
  const [{ running }] = await sql<{ running: number }[]>`SELECT count(*)::int AS running FROM scan_jobs WHERE user_id = ${userId} AND status IN ('queued', 'running')`;
  if (running >= 2) throw new ScanError("Two scans are already running; wait for one to finish or cancel it.", 429);

  const cov = emptyCoverage(mode, cfg);
  const u = await resolveUniverse(sql, cfg.universes);
  // Watchlists: the user's own lists only.
  const wl = cfg.watchlistIds.length
    ? await sql<{ symbol: string; wid: number }[]>`SELECT i.symbol, w.id AS wid FROM watchlists w JOIN watchlist_items wi ON wi.watchlist_id = w.id JOIN instruments i ON i.id = wi.instrument_id
        WHERE w.user_id = ${userId} AND w.id IN ${sql(cfg.watchlistIds)} AND i.exchange = 'NSE'`
    : [];
  const merged = dedupeUniverse([...cfg.universes.filter((x) => !u.unavailable.includes(x)).map((x) => ({ index: x, symbols: u.symbols.filter((s) => u.membership[s].includes(x)) })), ...(wl.length ? [{ index: "WATCHLIST", symbols: wl.map((w) => w.symbol) }] : [])]);
  cov.unavailableUniverses = u.unavailable;
  cov.selected = merged.selected;
  cov.unique = merged.symbols.length;
  cov.duplicates = merged.duplicates;
  let queue = merged.symbols;
  if (mode === "accelerated" && queue.length) {
    const rows = await sql<{ symbol: string; close: number; ema50: number | null; ret20: number | null; rel_vol: number | null; adx14: number | null }[]>`
      SELECT symbol, close, ema50, ret20, rel_vol, adx14 FROM screener_snapshot WHERE symbol IN ${sql(queue)}`;
    cov.marketDataRequests++;
    const keep = new Set(rows.filter((r) => cfg.direction === "bearish"
      ? r.ema50 !== null && r.close < r.ema50 && (r.ret20 ?? 0) <= 0
      : r.ema50 !== null && r.close > r.ema50 && (r.ret20 ?? -1) >= 0 && ((r.rel_vol ?? 0) >= 0.8 || (r.adx14 ?? 0) >= 20)).map((r) => r.symbol));
    cov.shortlisted = keep.size;
    cov.notDeepEvaluated = queue.length - keep.size;
    queue = queue.filter((s) => keep.has(s));
  }
  // Index F&O underlyings (index-futures / index-options) are queued as "IDX:<underlying>".
  if (cfg.instruments.some((i) => i.startsWith("index-"))) {
    const idx = await sql<{ underlying: string }[]>`SELECT DISTINCT underlying FROM fo_contracts WHERE inst = 'IDO' ORDER BY underlying`;
    const keep = idx.map((r) => r.underlying).filter((x) => UNDERLYING_INDEX[x]);
    queue = [...keep.map((x) => `IDX:${x}`), ...queue];
    cov.unique += keep.length;
  }
  const jobKind = cfg.instruments.includes("equity") ? "equity" : "fo";
  const [job] = await sql<{ id: number }[]>`
    INSERT INTO scan_jobs (user_id, idempotency_key, kind, mode, config, queue, coverage)
    VALUES (${userId}, ${idempotencyKey}, ${jobKind}, ${mode}, ${sql.json(cfg as never)}, ${sql.json(queue)}, ${sql.json(cov as never)}) RETURNING id`;
  return { id: Number(job.id), reused: false };
}

type JobRow = { id: number; user_id: number; status: string; mode: ScanMode; config: ScanConfig; queue: string[]; coverage: Coverage; progress: number; created_at: Date; started_at: Date | null; finished_at: Date | null; error: string | null };

export type JobSummary = { id: number; status: string; mode: ScanMode; progress: number; config: ScanConfig; coverage: Coverage; remaining: number; createdAt: string; error: string | null };
const summary = (j: JobRow): JobSummary => ({ id: Number(j.id), status: j.status, mode: j.mode, progress: j.progress, config: j.config, coverage: j.coverage, remaining: j.queue.length, createdAt: j.created_at.toISOString(), error: j.error });

export async function getScan(sql: Sql, userId: number, jobId: number): Promise<JobSummary | null> {
  const [j] = await sql<JobRow[]>`SELECT * FROM scan_jobs WHERE id = ${jobId} AND user_id = ${userId}`;
  return j ? summary(j) : null;
}

export async function listScans(sql: Sql, userId: number, limit = 20): Promise<JobSummary[]> {
  const rows = await sql<JobRow[]>`SELECT * FROM scan_jobs WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${Math.min(50, Math.max(1, limit))}`;
  return rows.map(summary);
}

export async function cancelScan(sql: Sql, userId: number, jobId: number): Promise<boolean> {
  const r = await sql`UPDATE scan_jobs SET status = 'cancelled', finished_at = now(), lease_until = NULL WHERE id = ${jobId} AND user_id = ${userId} AND status IN ('queued', 'running')`;
  return r.count > 0;
}

type Bars = Map<string, { t: number; o: number; h: number; l: number; c: number; v: number }[]>;
async function loadBars(sql: Sql, symbols: string[]): Promise<{ bars: Bars; last: Map<string, string> }> {
  const r = await loadSeries(sql, symbols.map((s) => "NSE:" + s));
  return { bars: new Map([...r.bars].map(([k, v]) => [k.slice(4), v])), last: new Map([...r.last].map(([k, v]) => [k.slice(4), v])) };
}

async function loadSeries(sql: Sql, series: string[]): Promise<{ bars: Bars; last: Map<string, string> }> {
  const rows = await sql<{ series: string; d: Date; o: number; h: number; l: number; c: number; v: number }[]>`
    SELECT series, d, o, h, l, c, v FROM candles WHERE series IN ${sql(series)} AND d >= (CURRENT_DATE - 600) ORDER BY series, d`;
  const bars: Bars = new Map();
  const last = new Map<string, string>();
  for (const r of rows) {
    const s = r.series;
    if (!bars.has(s)) bars.set(s, []);
    bars.get(s)!.push({ t: Date.parse(r.d.toISOString().slice(0, 10) + "T00:00:00Z") / 1000, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v });
    last.set(s, r.d.toISOString().slice(0, 10));
  }
  return { bars, last };
}

/**
 * Processes one chunk of a scan under a lease. Safe to call concurrently (only one caller gets the
 * lease). `userId` null = background trigger (any user's job); otherwise only the caller's job.
 */
export async function advanceScan(sql: Sql, jobId: number, userId: number | null, opts: { chunk?: number; ai?: AIClient | null; explainTop?: number; now?: Date } = {}): Promise<JobSummary | null> {
  const now = opts.now ?? new Date();
  const [j] = await sql<JobRow[]>`
    UPDATE scan_jobs SET lease_until = now() + interval '45 seconds', status = CASE WHEN status = 'queued' THEN 'running' ELSE status END,
           started_at = COALESCE(started_at, now())
     WHERE id = ${jobId} AND (${userId}::bigint IS NULL OR user_id = ${userId}) AND status IN ('queued', 'running') AND (lease_until IS NULL OR lease_until < now())
     RETURNING *`;
  if (!j) {
    const [cur] = await sql<JobRow[]>`SELECT * FROM scan_jobs WHERE id = ${jobId} AND (${userId}::bigint IS NULL OR user_id = ${userId})`;
    return cur ? summary(cur) : null;
  }
  const cfg = j.config, cov = j.coverage;
  cov.startedAt ??= now.toISOString();
  const chunk = j.queue.slice(0, opts.chunk ?? 40);
  let rest = j.queue.slice(chunk.length);
  try {
    if (chunk.length) {
      const stockSyms = chunk.filter((x) => !x.startsWith("IDX:"));
      const idxSyms = chunk.filter((x) => x.startsWith("IDX:")).map((x) => x.slice(4));
      const { bars, last } = await loadBars(sql, stockSyms.length ? stockSyms : ["-"]);
      if (idxSyms.length) {
        const ib = await loadSeries(sql, idxSyms.map((x) => `NSEIDX:${UNDERLYING_INDEX[x]}`));
        for (const x of idxSyms) {
          const b = ib.bars.get(`NSEIDX:${UNDERLYING_INDEX[x]}`);
          if (b) { bars.set(`IDX:${x}`, b); last.set(`IDX:${x}`, ib.last.get(`NSEIDX:${UNDERLYING_INDEX[x]}`)!); }
        }
      }
      const wantEquity = cfg.instruments.includes("equity");
      const wantFo = cfg.instruments.some((i) => i !== "equity");
      const fo = wantFo ? await loadFo(sql, [...stockSyms, ...idxSyms]) : null;
      if (fo) cov.marketDataRequests += 2;
      const names = await sql<{ symbol: string; name: string | null }[]>`SELECT symbol, name FROM screener_snapshot WHERE symbol IN ${sql(chunk)}`;
      const inds = await sql<{ symbol: string; industry: string | null }[]>`SELECT DISTINCT ON (symbol) symbol, industry FROM index_constituents WHERE symbol IN ${sql(chunk)} AND industry IS NOT NULL`;
      cov.marketDataRequests += 3;
      let processed = 0;
      for (const sym of chunk) {
        // Cancellation is checked every 10 symbols.
        if (processed++ % 10 === 9) {
          const [s] = await sql<{ status: string }[]>`SELECT status FROM scan_jobs WHERE id = ${jobId}`;
          if (s.status === "cancelled") return getScan(sql, j.user_id, jobId);
        }
        cov.scanned++;
        const b = bars.get(sym) ?? [];
        const prov = provenance({ source: "nse-equity-bhavcopy", kind: "eod-file", exchangeTime: last.get(sym) ?? null, entitlement: "public-eod", now, missing: b.length ? [] : ["daily bars"] });
        if (!b.length) {
          cov.missingData++;
          cov.excluded["no price history"] = (cov.excluded["no price history"] ?? 0) + 1;
          continue;
        }
        if (prov.freshness === "stale") cov.staleData++;
        const isIdx = sym.startsWith("IDX:"), und = isIdx ? sym.slice(4) : sym;
        if (fo) {
          const r = evaluateFoSymbol(und, isIdx ? "index" : "stock", b, fo.options.get(und) ?? [], fo.futures.get(und) ?? [], fo.futuresProvenance, cfg, now);
          cov.chainsRetrieved += r.chains;
          cov.contractsEvaluated += r.contracts;
          if (!r.results.length && r.missing.length) cov.excluded[`no F&O data (${r.missing.join(", ")})`] = (cov.excluded[`no F&O data (${r.missing.join(", ")})`] ?? 0) + 1;
          for (const x of r.results) {
            cov.opportunities[x.status] = (cov.opportunities[x.status] ?? 0) + 1;
            await sql`INSERT INTO scan_results (job_id, key, symbol, kind, status, score, payload) VALUES (${jobId}, ${x.key}, ${x.symbol}, ${x.kind}, ${x.status}, ${x.score}, ${sql.json(x.payload as never)})
                      ON CONFLICT (job_id, key) DO UPDATE SET status = EXCLUDED.status, score = EXCLUDED.score, payload = EXCLUDED.payload`;
          }
        }
        if (!wantEquity || isIdx) continue;
        const setup: EquitySetup = applyEquityValidation(analyzeEquity({
          symbol: sym, name: names.find((n) => n.symbol === sym)?.name ?? sym, sector: inds.find((n) => n.symbol === sym)?.industry ?? null, bars: b, provenance: prov,
          horizon: cfg.horizon, direction: cfg.direction === "bearish" ? "bearish" : cfg.direction === "bullish" ? "bullish" : "any",
          constraints: { capital: cfg.capital, maxRiskPerTrade: cfg.maxRiskPerTrade, maxCapitalPerTrade: cfg.maxCapitalPerTrade, minRewardRisk: cfg.minRewardRisk, minLiquidity: cfg.minLiquidity },
          today: now.toISOString().slice(0, 10),
        }), prov);
        if (setup.status === "INSUFFICIENT DATA") cov.missingData++;
        cov.opportunities[setup.status] = (cov.opportunities[setup.status] ?? 0) + 1;
        await sql`INSERT INTO scan_results (job_id, key, symbol, kind, status, score, payload) VALUES (${jobId}, ${sym}, ${sym}, 'equity', ${setup.status}, ${setup.score?.total ?? null}, ${sql.json(setup as never)})
                  ON CONFLICT (job_id, key) DO UPDATE SET status = EXCLUDED.status, score = EXCLUDED.score, payload = EXCLUDED.payload`;
      }
    }
    rest = j.queue.slice(chunk.length);
    const total = cov.scanned + rest.length;
    const done = rest.length === 0;
    if (done) {
      // Stage 7: AI explanations for the top eligible candidates (grounded; deterministic fallback).
      if (opts.ai) {
        const top = await sql<{ key: string; payload: EquitySetup }[]>`
          SELECT key, payload FROM scan_results WHERE job_id = ${jobId} AND status IN ('ENTER IF CONFIRMED', 'WAIT FOR CONFIRMATION') ORDER BY score DESC NULLS LAST LIMIT ${opts.explainTop ?? 5}`;
        for (const t of top) {
          const r = await explainEquity(opts.ai, t.payload, j.user_id);
          if (r.source === "ai") {
            cov.aiRequests++;
            cov.aiInputTokens += r.inputTokens;
            cov.aiOutputTokens += r.outputTokens;
            cov.aiCostUsd = Math.round((cov.aiCostUsd + (r.costUsd ?? 0)) * 1e6) / 1e6;
          }
          await sql`UPDATE scan_results SET payload = payload || ${sql.json({ explanation: { ...r.value, source: r.source, model: r.model, promptVersion: `${r.promptId}@${r.promptVersion}`, fallbackReason: r.fallbackReason ?? null } } as never)} WHERE job_id = ${jobId} AND key = ${t.key}`;
        }
      }
      cov.finishedAt = new Date().toISOString();
    }
    const [u] = await sql<JobRow[]>`
      UPDATE scan_jobs SET queue = ${sql.json(rest)}, coverage = ${sql.json(cov as never)}, progress = ${total ? cov.scanned / total : 1},
             status = ${done ? "completed" : "running"}, finished_at = ${done ? new Date() : null}, lease_until = NULL, data_version = COALESCE(data_version, ${now.toISOString().slice(0, 10)})
       WHERE id = ${jobId} AND status <> 'cancelled' RETURNING *`;
    return u ? summary(u) : getScan(sql, j.user_id, jobId);
  } catch (e) {
    await sql`UPDATE scan_jobs SET status = 'failed', error = ${(e as Error).message.slice(0, 300)}, lease_until = NULL, coverage = ${sql.json(cov as never)} WHERE id = ${jobId}`;
    throw e;
  }
}

export type ResultQuery = { page?: number; pageSize?: number; status?: string | null; sort?: "score" | "symbol" | "rr" };
export async function scanResults(sql: Sql, userId: number, jobId: number, q: ResultQuery = {}) {
  const [own] = await sql<{ id: number }[]>`SELECT id FROM scan_jobs WHERE id = ${jobId} AND user_id = ${userId}`;
  if (!own) throw new ScanError("Scan not found", 404);
  const size = Math.min(100, Math.max(1, q.pageSize ?? 25));
  const page = Math.max(1, q.page ?? 1);
  const order = q.sort === "symbol" ? sql`symbol ASC` : q.sort === "rr" ? sql`COALESCE((payload->>'rewardRisk')::float, (payload->'plan'->>'rewardRisk')::float) DESC NULLS LAST` : sql`score DESC NULLS LAST, symbol`;
  const rows = await sql<{ key: string; symbol: string; kind: string; status: string; score: number | null; payload: unknown }[]>`
    SELECT key, symbol, kind, status, score, payload FROM scan_results WHERE job_id = ${jobId} ${q.status ? sql`AND status = ${q.status}` : sql``}
     ORDER BY ${order} LIMIT ${size} OFFSET ${(page - 1) * size}`;
  const [{ total }] = await sql<{ total: number }[]>`SELECT count(*)::int AS total FROM scan_results WHERE job_id = ${jobId} ${q.status ? sql`AND status = ${q.status}` : sql``}`;
  return { page, pageSize: size, total, results: rows };
}

export async function pendingScans(sql: Sql, limit = 5): Promise<number[]> {
  const rows = await sql<{ id: number }[]>`SELECT id FROM scan_jobs WHERE status IN ('queued', 'running') AND (lease_until IS NULL OR lease_until < now()) ORDER BY created_at LIMIT ${limit}`;
  return rows.map((r) => Number(r.id));
}

export async function pruneScans(sql: Sql) {
  return (await sql`DELETE FROM scan_jobs WHERE created_at < now() - interval '30 days'`).count;
}

export async function saveScanConfig(sql: Sql, userId: number, name: unknown, config: unknown) {
  const n = typeof name === "string" ? name.trim().slice(0, 60) : "";
  if (!n) throw new ScanError("A name is required");
  const [{ c }] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM scan_configs WHERE user_id = ${userId}`;
  if (c >= 25) throw new ScanError("At most 25 saved scans", 409);
  const [r] = await sql<{ id: number }[]>`INSERT INTO scan_configs (user_id, name, kind, config) VALUES (${userId}, ${n}, 'equity', ${sql.json(sanitizeScanConfig(config) as never)}) RETURNING id`;
  return { id: Number(r.id) };
}
export async function listScanConfigs(sql: Sql, userId: number) {
  return (await sql<{ id: number; name: string; config: ScanConfig; updated_at: Date }[]>`SELECT id, name, config, updated_at FROM scan_configs WHERE user_id = ${userId} ORDER BY updated_at DESC`).map((r) => ({ id: Number(r.id), name: r.name, config: r.config, updatedAt: r.updated_at.toISOString() }));
}
export async function deleteScanConfig(sql: Sql, userId: number, id: number) {
  return (await sql`DELETE FROM scan_configs WHERE id = ${id} AND user_id = ${userId}`).count > 0;
}
