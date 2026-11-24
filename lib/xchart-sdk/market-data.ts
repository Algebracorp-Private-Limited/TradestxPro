/**
 * Bridges TradestXPro's existing market-data API to SDK data (no new data sources).
 * `/api/charts/bars` returns bars as { t, o, h, l, c, v } with t in UTC seconds, the SDK's
 * canonical time, from the user's connected broker or NSE end-of-day files.
 */
import type { CandlestickData } from "./types.ts";
import { validateBars } from "./validation.ts";

export type TradestxproBar = { t: number; o: number; h: number; l: number; c: number; v?: number };

/** Converts engine/API bars to SDK candles, dropping malformed rows and duplicate times. */
export function fromTradestxproBars(bars: ReadonlyArray<TradestxproBar>): CandlestickData[] {
  const out: CandlestickData[] = [];
  for (const b of bars) {
    if (![b.t, b.o, b.h, b.l, b.c].every(Number.isFinite)) continue;
    if (out.length && b.t <= out[out.length - 1].time) continue;
    out.push({ time: Math.floor(b.t), open: b.o, high: Math.max(b.h, b.o, b.c), low: Math.min(b.l, b.o, b.c), close: b.c, volume: b.v && b.v > 0 ? b.v : undefined });
  }
  validateBars("candlestick", out);
  return out;
}

/** Loads candles for a TradestXPro symbol (e.g. "NSE:RELIANCE", tf "1D"). Requires a signed-in session. */
export async function loadTradestxproCandles(symbol: string, tf = "1D", baseUrl = ""): Promise<{ candles: CandlestickData[]; source: string; name: string }> {
  const res = await fetch(`${baseUrl}/api/charts/bars?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}`, { credentials: "same-origin" });
  const body = (await res.json().catch(() => ({}))) as { bars?: TradestxproBar[]; source?: string; name?: string; error?: string };
  if (!res.ok || !body.bars) throw new Error(`[XChart] Could not load ${symbol}: ${body.error ?? res.status}`);
  return { candles: fromTradestxproBars(body.bars), source: body.source ?? "", name: body.name ?? symbol };
}
