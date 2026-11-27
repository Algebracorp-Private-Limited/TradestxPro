/** Converters from the platform's chain sources to the engines' ChainInput (pure). */
import type { Provenance } from "../core/types.ts";
import type { EodOptionRow } from "../market-data/data.ts";
import type { ChainInput, LegIn } from "./contract.ts";

const emptyLeg = (): LegIn => ({ ltp: null, bid: null, ask: null, oi: null, oiChange: null, volume: null, iv: null, delta: null, gamma: null, theta: null, vega: null, rho: null, greeksSource: null });

/** EOD bhavcopy rows of one underlying → one ChainInput per expiry (spot = the bhavcopy's underlying price). */
export function eodToChains(rows: EodOptionRow[], provenance: Provenance, kind: "index" | "stock", now?: Date): ChainInput[] {
  const byExp = new Map<string, EodOptionRow[]>();
  for (const r of rows) (byExp.get(r.expiry) ?? byExp.set(r.expiry, []).get(r.expiry)!).push(r);
  return [...byExp.entries()].map(([expiry, list]) => {
    const strikes = new Map<number, { strike: number; ce: LegIn | null; pe: LegIn | null }>();
    for (const r of list) {
      const s = strikes.get(r.strike) ?? { strike: r.strike, ce: null, pe: null };
      const leg: LegIn = { ...emptyLeg(), ltp: r.close > 0 ? r.close : null, oi: r.oi, oiChange: r.oiChange, volume: r.contracts * r.lot };
      if (r.right === "CE") s.ce = leg;
      else s.pe = leg;
      strikes.set(r.strike, s);
    }
    const px = list.find((r) => r.underlyingPx)?.underlyingPx ?? null;
    return { underlying: list[0].underlying, kind, spot: px, expiry, lotSize: list[0].lot || null, rows: [...strikes.values()].sort((a, b) => a.strike - b.strike), provenance, now };
  });
}

/** Broker chain (lib/options/chain ChainResponse) → ChainInput. */
export function brokerToChain(ch: { underlying: string; kind: "index" | "stock"; spot: number | null; expiry: string | null; lotSize: number | null; rows: { strike: number; ce: (Partial<LegIn> & { greeksSource?: "broker" | "model" | null }) | null; pe: (Partial<LegIn> & { greeksSource?: "broker" | "model" | null }) | null }[] }, provenance: Provenance, now?: Date): ChainInput | null {
  if (!ch.expiry) return null;
  const leg = (l: (Partial<LegIn> & { greeksSource?: "broker" | "model" | null }) | null): LegIn | null => (l ? { ...emptyLeg(), ...l, greeksSource: l.greeksSource ?? null } : null);
  return { underlying: ch.underlying, kind: ch.kind, spot: ch.spot, expiry: ch.expiry, lotSize: ch.lotSize, rows: ch.rows.map((r) => ({ strike: r.strike, ce: leg(r.ce), pe: leg(r.pe) })), provenance, now };
}
