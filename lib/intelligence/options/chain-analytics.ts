/**
 * Chain Intelligence analytics (descriptive). OI and volume distributions, put-call ratios, IV smile
 * and skew, ATM straddle and expected move, Greek distributions, liquidity, contract ranking, and
 * term structure across expiries (when several expiries are supplied).
 * Positioning is described, never attributed: OI alone does not reveal who is long or short, so no
 * institutional or dealer positioning is inferred. Max pain is descriptive, not a price forecast.
 */
import { maxPain } from "../../options/bs.ts";
import { expectedMove, metrics, quickView, type ChainInput, type UnderlyingContext } from "./contract.ts";

const r2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

export type StrikeRow = {
  strike: number;
  ce: { oi: number | null; oiChange: number | null; volume: number | null; iv: number | null; delta: number | null; gamma: number | null; theta: number | null; vega: number | null; mid: number | null; spreadPct: number | null } | null;
  pe: StrikeRow["ce"];
};

export function chainAnalytics(c: ChainInput, ctx: UnderlyingContext) {
  const rows: StrikeRow[] = c.rows.map((r) => {
    const side = (right: "CE" | "PE") => {
      const m = metrics(c, r.strike, right);
      return m ? { oi: m.oi, oiChange: m.oiChange, volume: m.volume, iv: m.iv, delta: m.delta, gamma: m.gamma, theta: m.theta, vega: m.vega, mid: m.mid, spreadPct: m.spreadPct } : null;
    };
    return { strike: r.strike, ce: side("CE"), pe: side("PE") };
  });
  const sum = (f: (r: StrikeRow) => number | null | undefined) => rows.reduce((a, r) => a + (f(r) ?? 0), 0);
  const ceOi = sum((r) => r.ce?.oi), peOi = sum((r) => r.pe?.oi), ceVol = sum((r) => r.ce?.volume), peVol = sum((r) => r.pe?.volume);
  const ceOiChg = sum((r) => r.ce?.oiChange), peOiChg = sum((r) => r.pe?.oiChange);
  const top = (side: "ce" | "pe") => [...rows].filter((r) => r[side]?.oi).sort((a, b) => (b[side]!.oi ?? 0) - (a[side]!.oi ?? 0)).slice(0, 3).map((r) => ({ strike: r.strike, oi: r[side]!.oi, share: r2(((r[side]!.oi ?? 0) / Math.max(1, side === "ce" ? ceOi : peOi)) * 100) }));
  const em = expectedMove(c);
  const spot = c.spot;
  // Skew: OTM put IV vs OTM call IV at about ±5% from spot (nearest strikes).
  const near = (target: number) => rows.reduce<StrikeRow | null>((a, b) => (!a || Math.abs(b.strike - target) < Math.abs(a.strike - target) ? b : a), null);
  const putWing = spot ? near(spot * 0.95) : null, callWing = spot ? near(spot * 1.05) : null;
  const skew = putWing?.pe?.iv && callWing?.ce?.iv ? r2((putWing.pe.iv - callWing.ce.iv) * 100) : null;
  const gammaBy = rows.map((r) => ({ strike: r.strike, gammaOi: r2(((r.ce?.gamma ?? 0) * (r.ce?.oi ?? 0) + (r.pe?.gamma ?? 0) * (r.pe?.oi ?? 0)) * (spot ?? 0)) }));
  const ranking = rows.flatMap((r) => (["CE", "PE"] as const).map((right) => ({ strike: r.strike, right, view: quickView(c, r.strike, right, ctx) })))
    .filter((x) => x.view.buyScore !== null).sort((a, b) => Math.max(b.view.buyScore ?? 0, b.view.sellScore ?? 0) - Math.max(a.view.buyScore ?? 0, a.view.sellScore ?? 0)).slice(0, 10);
  const mp = maxPain(c.rows.map((r) => ({ strike: r.strike, ce: { oi: r.ce?.oi ?? 0 }, pe: { oi: r.pe?.oi ?? 0 } })));
  const net = ceOiChg !== 0 || peOiChg !== 0 ? `Call OI ${ceOiChg >= 0 ? "added" : "reduced"} ${Math.abs(ceOiChg).toLocaleString("en-IN")}, put OI ${peOiChg >= 0 ? "added" : "reduced"} ${Math.abs(peOiChg).toLocaleString("en-IN")} in the session.` : "No OI change data.";
  return {
    underlying: c.underlying, expiry: c.expiry, spot, provenance: c.provenance,
    totals: { ceOi, peOi, ceVol, peVol, ceOiChange: ceOiChg, peOiChange: peOiChg, pcrOi: ceOi ? r2(peOi / ceOi) : null, pcrVolume: ceVol ? r2(peVol / ceVol) : null },
    concentration: { calls: top("ce"), puts: top("pe") },
    expectedMove: em,
    skew: { putIv95: putWing?.pe?.iv ?? null, callIv105: callWing?.ce?.iv ?? null, skewPts: skew, note: "OTM put IV minus OTM call IV at the strikes nearest ±5% from spot (percentage points)" },
    gammaByStrike: gammaBy,
    maxPain: { strike: mp, note: "Descriptive statistic of open interest; not a reliable price prediction." },
    rows, ranking,
    outlook: {
      underlyingRegime: ctx.regime, direction: ctx.direction,
      positioning: `${net} Put-call OI ratio ${ceOi ? r2(peOi / ceOi) : "—"}. Open interest does not reveal who holds long or short positions, so no institutional or dealer positioning is inferred.`,
    },
  };
}

/** ATM IV per expiry (term structure) and expiry comparison from chains of several expiries. */
export function termStructure(chains: ChainInput[]) {
  return chains.map((c) => {
    const em = expectedMove(c);
    return { expiry: c.expiry, atmStrike: em.atmStrike, atmIv: em.atmIv, straddle: em.straddle, expectedMove: em.ivMove, totalOi: c.rows.reduce((a, r) => a + (r.ce?.oi ?? 0) + (r.pe?.oi ?? 0), 0) };
  }).sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
}
