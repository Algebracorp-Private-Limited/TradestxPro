import "server-only";
/**
 * Inputs for Strategy AI: the near-expiry chain (the user's broker chain when connected, otherwise the
 * latest NSE F&O bhavcopy), the next expiry from the bhavcopy (calendars/diagonals), and the near-month
 * futures price from fo_futures (migration 004) when available. Nothing missing is estimated.
 */
import { db } from "../../db";
import { eodFutures } from "../market-data/data.ts";
import { chainFor } from "../options/server.ts";
import type { StrategyInputs } from "./evaluate.ts";

export async function strategyInputs(userId: number, underlying: string, expiry?: string): Promise<{ inputs: StrategyInputs; source: "broker" | "eod"; expiries: string[]; futuresNote: string | null } | null> {
  const src = await chainFor(userId, underlying, expiry);
  if (!src) return null;
  const near = src.chain;
  const next = src.eodChains.filter((c) => c.expiry > near.expiry).sort((a, b) => (a.expiry < b.expiry ? -1 : 1))[0] ?? null;
  const fut = await eodFutures(await db(), [underlying]);
  const f = fut.value.find((r) => r.expiry === near.expiry) ?? fut.value.find((r) => r.expiry >= near.expiry) ?? null;
  const futuresNote = fut.value.length ? (f && f.expiry !== near.expiry ? `Futures leg uses the ${f.expiry} contract (no future for ${near.expiry}).` : null) : fut.provenance.missing[0] ?? "no futures data";
  return { inputs: { near, next, futures: f ? { price: f.close, expiry: f.expiry } : null }, source: src.source, expiries: src.expiries, futuresNote };
}
