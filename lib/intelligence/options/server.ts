import "server-only";
/**
 * Chain inputs for the option engines: the user's live broker chain when connected, otherwise the
 * latest NSE F&O bhavcopy session (EOD; no bid/ask; IV and Greeks computed and labelled "model").
 * Underlying context (regime direction, ATR) comes from the underlying's daily bars.
 */
import { db } from "../../db";
import { UNDERLYING_INDEX } from "../../options/chain";
import * as ta from "../../ta/indicators.ts";
import { isInsufficient } from "../core/types.ts";
import { dailyBars, eodChain } from "../market-data/data.ts";
import { liveChain } from "../market-data/live.ts";
import { detectRegime } from "../technical/regime.ts";
import type { ChainInput, UnderlyingContext } from "./contract.ts";
import { brokerToChain, eodToChains } from "./inputs.ts";

export async function underlyingContext(underlying: string): Promise<UnderlyingContext> {
  const sql = await db();
  const idx = UNDERLYING_INDEX[underlying];
  const bars = await dailyBars(sql, idx ? `NSEIDX:${idx}` : `NSE:${underlying}`, 400);
  const b = bars.value;
  if (b.length < 60) return { direction: null, regime: null, atr: null };
  const h = b.map((x) => x.h), l = b.map((x) => x.l), c = b.map((x) => x.c);
  const reg = detectRegime({ high: h, low: l, close: c, volume: idx ? undefined : b.map((x) => x.v) });
  const atr = ta.atr(h, l, c, 14).at(-1) ?? null;
  return isInsufficient(reg) ? { direction: null, regime: null, atr } : { direction: reg.direction, regime: reg.primary, atr, flags: reg.flags };
}

export type ChainSource = { chain: ChainInput; source: "broker" | "eod"; eodChains: ChainInput[]; expiries: string[] };

export async function chainFor(userId: number, underlying: string, expiry?: string): Promise<ChainSource | null> {
  const sql = await db();
  const kind = UNDERLYING_INDEX[underlying] ? "index" : "stock";
  const eod = await eodChain(sql, underlying, null);
  const eodChains = eodToChains(eod.value, eod.provenance, kind);
  const live = await liveChain(userId, underlying, expiry).catch(() => null);
  const expiries = live?.chain.expiries?.length ? live.chain.expiries : eodChains.map((c) => c.expiry);
  if (live?.chain.broker) {
    const c = brokerToChain(live.chain, live.provenance);
    if (c) return { chain: c, source: "broker", eodChains, expiries };
  }
  const pick = (expiry && eodChains.find((c) => c.expiry === expiry)) || eodChains.find((c) => c.expiry >= new Date().toISOString().slice(0, 10)) || eodChains[0];
  return pick ? { chain: pick, source: "eod", eodChains, expiries } : null;
}
