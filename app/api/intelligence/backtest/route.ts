import { db } from "@/lib/db";
import { fail, json, userHandler } from "@/lib/api";
import { backtestEquity } from "@/lib/intelligence/backtest/engine";
import type { Horizon } from "@/lib/intelligence/equity/setup";
import { requireFlag, symbolParam } from "@/lib/intelligence/http";
import { dailyBars } from "@/lib/intelligence/market-data/data";
import { HORIZONS } from "@/lib/intelligence/market-scan/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Walk-forward backtest of the equity setup engine on one stock's stored daily history. */
export const GET = userHandler(async ({ req }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const p = new URL(req.url).searchParams;
  const symbol = symbolParam(p.get("symbol"));
  if (!symbol) return fail("symbol is required");
  const horizon = (HORIZONS as string[]).includes(p.get("horizon") ?? "") ? (p.get("horizon") as Horizon) : "swing";
  if (["intraday", "scalping", "btst", "stbt"].includes(horizon)) return fail("Intraday horizons cannot be backtested: no intraday bars are stored.", 400);
  const bars = await dailyBars(await db(), `NSE:${symbol}`, 1500);
  if (bars.value.length < 300) return json({ ok: true, status: "INSUFFICIENT DATA", missing: [`at least 300 daily bars (have ${bars.value.length})`] });
  const step = Math.min(20, Math.max(1, Number(p.get("step")) || 5));
  const started = Date.now();
  const r = backtestEquity(symbol, bars.value, { horizon, step, costFraction: Math.min(0.02, Math.max(0, Number(p.get("cost")) || 0.0025)) });
  return json({ ok: true, status: "OK", ...r, trades: r.trades.slice(-200), durationMs: Date.now() - started, engineVersion: "equity.setup@1" });
});
