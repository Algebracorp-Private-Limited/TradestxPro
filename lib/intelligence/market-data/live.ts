import "server-only";
/**
 * Live data through the requesting user's own broker session (entitlement: that user only).
 * Wraps the existing quote and option-chain integrations and adds provenance. Nothing here is
 * shared across users or cached beyond the existing per-user caches.
 */
import { getQuotes, type QuoteReq } from "../../brokers/quotes";
import { getOptionChain, type ChainResponse } from "../../options/chain";
import { provenance } from "../core/freshness.ts";
import type { Provenance, Sourced } from "../core/types.ts";

export async function liveQuotes(userId: number, reqs: QuoteReq[]): Promise<{ broker: string | null; quotes: Record<string, Sourced<{ ltp: number; prevClose: number | null; volume: number | null; oi: number | null }>> }> {
  const r = await getQuotes(userId, reqs);
  const quotes: Record<string, Sourced<{ ltp: number; prevClose: number | null; volume: number | null; oi: number | null }>> = {};
  for (const [k, q] of Object.entries(r.quotes)) {
    quotes[k] = {
      value: { ltp: q.ltp, prevClose: q.prevClose, volume: q.volume, oi: q.oi ?? null },
      provenance: provenance({ source: `broker:${r.broker ?? "unknown"}`, kind: "broker-quote", exchangeTime: q.time, entitlement: "user-broker-session", missing: q.time ? [] : ["exchange timestamp"] }),
    };
  }
  return { broker: r.brokerName, quotes };
}

/** The user's live option chain, or null when the underlying does not exist. */
export async function liveChain(userId: number, underlying: string, expiry?: string): Promise<{ chain: ChainResponse; provenance: Provenance } | null> {
  const chain = await getOptionChain(userId, underlying, expiry);
  if (!chain) return null;
  const live = Boolean(chain.broker);
  // Broker chain APIs return no exchange timestamp per leg: the fetch time is used and labelled.
  const p = provenance({
    source: live ? `broker:${chain.broker}` : "contract-master (no prices)",
    kind: live ? "broker-quote" : "snapshot",
    exchangeTime: live ? chain.asOf : null,
    entitlement: live ? "user-broker-session" : "none",
    missing: live ? [] : ["premiums", "bid/ask", "OI", "IV", "Greeks"],
  });
  if (live) p.notes = [...(p.notes ?? []), "exchange timestamp not provided by the broker chain API: fetch time used"];
  return { chain, provenance: p };
}
