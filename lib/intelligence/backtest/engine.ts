/**
 * Walk-forward backtest of the equity setup engine (pure, no look-ahead).
 *   - At each evaluation date t (every `step` sessions after a warm-up), the engine sees bars[0..t] only,
 *     with an end-of-day provenance dated t;
 *   - a setup with status ENTER IF CONFIRMED or WAIT FOR CONFIRMATION becomes a paper plan (entry zone,
 *     stop, first target, the engine's time exit) and is simulated with the lifecycle rules on bars after t;
 *   - one position per symbol at a time: the next evaluation starts after the plan resolves;
 *   - costs: the estimated round trip (default 0.25% of entry) is subtracted in net R.
 * Limitations (reported with every result): daily bars only, fills by the stated OHLC rules, no
 * slippage model beyond the cost fraction, the symbol list is today's (survivorship), corporate actions
 * are as adjusted in the stored series, and the sample may be small.
 */
import { provenance } from "../core/freshness.ts";
import { analyzeEquity, TIME_EXIT_SESSIONS, type Horizon } from "../equity/setup.ts";
import { advancePlan, initialState, type DayBar, type PlanLevels } from "../monitoring/lifecycle.ts";
import { calibration, tradeStats, type TradeResult } from "./stats.ts";

export type BacktestBar = { t: number; o: number; h: number; l: number; c: number; v: number };
export type BacktestOptions = { horizon?: Horizon; step?: number; warmup?: number; costFraction?: number; entryValidSessions?: number; maxEvaluations?: number };

export const BACKTEST_LIMITATIONS = [
  "Daily bars only: intrabar order is unknown, so a bar that reaches both stop and target counts as a stop.",
  "Fills follow the stated rules (open inside the zone, zone edge, or the open after a gap); no queue or liquidity model.",
  "Costs are a flat round-trip fraction of the entry price.",
  "Today's symbol list is tested (survivorship bias); delisted symbols are not included.",
  "Results describe this historical sample and engine version; they are not a forecast.",
];

const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

export function backtestEquity(symbol: string, bars: BacktestBar[], opts: BacktestOptions = {}) {
  const horizon = opts.horizon ?? "swing";
  const step = Math.max(1, opts.step ?? 5), warmup = Math.max(60, opts.warmup ?? 220);
  const cost = opts.costFraction ?? 0.0025;
  const trades: (TradeResult & { entry: number; stop: number; target: number; exitDate: string })[] = [];
  const skipped: Record<string, number> = {};
  let evaluations = 0;
  const dayBars: DayBar[] = bars.map((b) => ({ d: day(b.t), o: b.o, h: b.h, l: b.l, c: b.c }));
  let t = warmup;
  const cap = opts.maxEvaluations ?? 1500;
  while (t < bars.length - 1 && evaluations < cap) {
    evaluations++;
    const d = day(bars[t].t);
    // Evaluation time: the evening of day t (after the session), so day t's bar counts as the latest EOD.
    const prov = provenance({ source: "backtest", kind: "eod-file", exchangeTime: d, entitlement: "public-eod", now: new Date(`${d}T14:00:00Z`) });
    const setup = analyzeEquity({ symbol, name: symbol, sector: null, bars: bars.slice(0, t + 1), provenance: prov, horizon, today: d,
      constraints: { capital: 1e7, maxRiskPerTrade: 1e5, maxCapitalPerTrade: 1e7, minRewardRisk: 1.2, minLiquidity: 0 } });
    if (!["ENTER IF CONFIRMED", "WAIT FOR CONFIRMATION"].includes(setup.status) || !setup.entry || !setup.stop || !setup.targets[0] || setup.direction === null) {
      const eligible = ["ENTER IF CONFIRMED", "WAIT FOR CONFIRMATION"].includes(setup.status);
      const key = eligible ? `${setup.status} without plan levels (${setup.setup})` : setup.status;
      skipped[key] = (skipped[key] ?? 0) + 1;
      t += step;
      continue;
    }
    const plan: PlanLevels = {
      direction: setup.direction, entry: setup.entry, stop: setup.stop, target: setup.targets[0].price,
      timeExitSessions: Math.max(1, TIME_EXIT_SESSIONS[horizon]), entryValidSessions: opts.entryValidSessions ?? 5, costFraction: cost,
    };
    const { state } = advancePlan(plan, initialState(), dayBars.slice(t + 1));
    if (state.status === "CLOSED") {
      trades.push({ date: state.entryDate!, score: setup.score?.total ?? null, setup: setup.setup, exitReason: state.exitReason!, r: state.r!, netR: state.netR!, sessionsHeld: state.sessionsHeld, entry: state.entryPrice!, stop: plan.stop, target: plan.target, exitDate: state.exitDate! });
      const exitIdx = dayBars.findIndex((b) => b.d === state.exitDate);
      t = Math.max(t + step, exitIdx + 1);
    } else {
      // EXPIRED / INVALIDATED / still open at the end of the data: counted, not traded.
      const key = state.status === "ACTIVE" || state.status === "WATCHING" ? "open at end of data" : state.status.toLowerCase();
      skipped[key] = (skipped[key] ?? 0) + 1;
      t += step;
    }
  }
  const bySetup: Record<string, ReturnType<typeof tradeStats>> = {};
  for (const s of [...new Set(trades.map((x) => x.setup))]) bySetup[s] = tradeStats(trades.filter((x) => x.setup === s));
  return {
    symbol, horizon, from: dayBars[warmup]?.d ?? null, to: dayBars.at(-1)?.d ?? null, evaluations,
    /** True when the evaluation cap stopped the run before the end of the data. */
    truncated: t < bars.length - 1, evaluatedThrough: dayBars[Math.min(t, dayBars.length - 1)]?.d ?? null, signals: trades.length + Object.entries(skipped).filter(([k]) => ["expired", "invalidated", "open at end of data"].includes(k)).reduce((a, [, v]) => a + v, 0),
    trades, skipped, stats: tradeStats(trades), bySetup, calibration: calibration(trades), costFraction: cost, limitations: BACKTEST_LIMITATIONS,
  };
}
