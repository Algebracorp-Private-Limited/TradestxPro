/**
 * F&O stage of the market scanner (stage 3: derivatives). For each F&O underlying in a scan chunk:
 *   - futures (stock-futures / index-futures): Futures AI on the latest-session futures (fo_futures);
 *   - options (stock-options / index-options): Strategy AI over the registry, filtered by the scan's
 *     BUY ONLY / SELL ONLY / defined-risk / single-leg settings, top strategies kept.
 * All F&O data here is the latest NSE bhavcopy (end of day), so no result is an entry: futures follow
 * analyzeFutures' EOD gating and strategies are WATCHLIST (score ≥ 60) or NO TRADE.
 */
import type postgres from "postgres";
import { provenance } from "../core/freshness.ts";
import type { SetupStatus } from "../core/types.ts";
import { analyzeFutures } from "../futures/analyze.ts";
import type { Bar } from "../market-data/data.ts";
import { eodFutures, type EodFutureRow, type EodOptionRow } from "../market-data/data.ts";
import { eodToChains } from "../options/inputs.ts";
import type { UnderlyingContext } from "../options/contract.ts";
import { rankStrategies } from "../strategy/evaluate.ts";
import { filterStrategies } from "../strategy/registry.ts";
import { detectRegime } from "../technical/regime.ts";
import { isInsufficient } from "../core/types.ts";
import * as ta from "../../ta/indicators.ts";
import type { ScanConfig } from "./config.ts";

type Sql = postgres.Sql;
export type FoResult = { key: string; symbol: string; kind: "futures" | "strategy"; status: SetupStatus; score: number | null; payload: Record<string, unknown> };

export function contextFromBars(b: Bar[], withVolume: boolean): UnderlyingContext {
  if (b.length < 60) return { direction: null, regime: null, atr: null };
  const h = b.map((x) => x.h), l = b.map((x) => x.l), c = b.map((x) => x.c);
  const reg = detectRegime({ high: h, low: l, close: c, volume: withVolume ? b.map((x) => x.v) : undefined });
  const atr = ta.atr(h, l, c, 14).at(-1) ?? null;
  return isInsufficient(reg) ? { direction: null, regime: null, atr } : { direction: reg.direction, regime: reg.primary, atr, flags: reg.flags };
}

/** Loads the latest-session option and futures rows for the chunk's underlyings (two queries). */
export async function loadFo(sql: Sql, underlyings: string[]) {
  const opt = underlyings.length ? await sql<Record<string, unknown>[]>`SELECT * FROM fo_contracts WHERE underlying IN ${sql(underlyings)} ORDER BY underlying, expiry, strike, opt` : [];
  const iso = (d: unknown) => (d as Date).toISOString().slice(0, 10);
  const options = new Map<string, EodOptionRow[]>();
  for (const r of opt) {
    const row: EodOptionRow = { underlying: String(r.underlying), inst: String(r.inst), expiry: iso(r.expiry), strike: Number(r.strike), right: r.opt as "CE" | "PE", close: Number(r.close), prevClose: r.prev_close === null ? null : Number(r.prev_close), underlyingPx: r.underlying_px === null ? null : Number(r.underlying_px), oi: Number(r.oi_qty), oiChange: Number(r.oi_chg_qty), contracts: Number(r.contracts), lot: Number(r.lot), d: iso(r.d) };
    (options.get(row.underlying) ?? options.set(row.underlying, []).get(row.underlying)!).push(row);
  }
  const fut = await eodFutures(sql, underlyings.length ? underlyings : ["-"]);
  const futures = new Map<string, EodFutureRow[]>();
  for (const r of fut.value) (futures.get(r.underlying) ?? futures.set(r.underlying, []).get(r.underlying)!).push(r);
  return { options, futures, futuresProvenance: fut.provenance };
}

export function evaluateFoSymbol(
  sym: string, kind: "index" | "stock", bars: Bar[], options: EodOptionRow[], futures: EodFutureRow[], futuresProv: ReturnType<typeof provenance>, cfg: ScanConfig, now: Date,
): { results: FoResult[]; chains: number; contracts: number; missing: string[] } {
  const ctx = contextFromBars(bars, kind === "stock");
  const out: FoResult[] = [];
  const missing: string[] = [];
  const wantFut = cfg.instruments.includes(kind === "index" ? "index-futures" : "stock-futures");
  const wantOpt = cfg.instruments.includes(kind === "index" ? "index-options" : "stock-options");
  const limits = { capital: cfg.capital, maxRiskPerTrade: cfg.maxRiskPerTrade, maxCapitalPerTrade: cfg.maxCapitalPerTrade, minRewardRisk: cfg.minRewardRisk };
  if (wantFut) {
    if (!futures.length) missing.push("futures");
    else {
      const a = analyzeFutures(sym, futures, ctx, futures[0].underlyingPx ?? bars.at(-1)?.c ?? null, limits, futuresProv, now);
      const dirOk = cfg.direction === "any" || (cfg.direction === "bullish" && a.plan.side === "LONG") || (cfg.direction === "bearish" && a.plan.side === "SHORT") || !["bullish", "bearish"].includes(cfg.direction);
      if (dirOk) out.push({ key: `${sym}|FUT`, symbol: sym, kind: "futures", status: a.status, score: a.score, payload: a as unknown as Record<string, unknown> });
    }
  }
  let chains = 0, contracts = 0;
  if (wantOpt) {
    if (!options.length) missing.push("options");
    else {
      const prov = provenance({ source: "nse-fo-bhavcopy", kind: "eod-file", exchangeTime: options[0].d, entitlement: "public-eod", now, missing: ["bid", "ask", "broker IV", "broker Greeks"] });
      const all = eodToChains(options, prov, kind, now).filter((c) => c.expiry >= now.toISOString().slice(0, 10)).sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
      chains = all.length;
      contracts = options.length;
      const near = all[0];
      if (near) {
        const defs = filterStrategies({
          mode: cfg.optionBuyingOnly ? "BUY_ONLY" : cfg.optionSellingOnly ? "SELL_ONLY" : "ALL",
          definedRiskOnly: cfg.definedRiskOnly, singleLegOnly: cfg.singleLegOnly, multiLeg: cfg.multiLeg,
          allowFutures: futures.length > 0,
        });
        const fut = futures.find((f) => f.expiry === near.expiry) ?? futures[0];
        const r = rankStrategies(defs, { near, next: all[1] ?? null, futures: fut ? { price: fut.close, expiry: fut.expiry } : null }, ctx, limits, { top: 3 });
        for (const e of r.ranked) {
          const status: SetupStatus = (e.score ?? 0) >= 60 && (e.sizing === null || e.sizing.lots > 0) ? "WATCHLIST" : "NO TRADE";
          out.push({ key: `${sym}|STRAT|${e.id}`, symbol: sym, kind: "strategy", status, score: e.score, payload: { ...e, underlying: sym, expiry: near.expiry, payoff: e.payoff.filter((_, i) => i % 2 === 0) } as unknown as Record<string, unknown> });
        }
      } else missing.push("unexpired option chain");
    }
  }
  return { results: out, chains, contracts, missing };
}
