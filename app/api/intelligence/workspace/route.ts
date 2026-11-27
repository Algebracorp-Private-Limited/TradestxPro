import { db } from "@/lib/db";
import { fail, json, userHandler } from "@/lib/api";
import { getBars } from "@/lib/chart-data";
import { rateLimit, requireFlag, symbolParam } from "@/lib/intelligence/http";
import { analyzeContract } from "@/lib/intelligence/options/contract";
import { chainFor, underlyingContext } from "@/lib/intelligence/options/server";
import { gate, RESTRICTED_NOTICE } from "@/lib/intelligence/present";
import { applyContractValidation } from "@/lib/intelligence/validation/plans";
import { premiumAnalytics } from "@/lib/intelligence/workspace/premium";
import { UNDERLYING_INDEX } from "@/lib/options/underlyings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const TFS = ["5m", "15m", "1h", "1D"];

/**
 * Synchronised underlying + option workspace. Premium history comes only from the user's broker
 * (contract candles); without it the premium panes are empty and say so — nothing is reconstructed.
 * Premium analytics (model IV, intrinsic/extrinsic) are derived bar by bar from that real history.
 */
export const GET = userHandler(async ({ user, req }) => {
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const limited = rateLimit("scenario", user.id);
  if (limited) return limited;
  const p = new URL(req.url).searchParams;
  const u = symbolParam(p.get("u"));
  const expiry = p.get("expiry") ?? "";
  const strike = Number(p.get("strike"));
  const right = p.get("right");
  const tf = TFS.includes(p.get("tf") ?? "") ? p.get("tf")! : "15m";
  if (!u || !/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !(strike > 0) || (right !== "CE" && right !== "PE")) return fail("u, expiry, strike and right (CE/PE) are required");
  const sql = await db();
  const [c] = await sql<{ exchange: "NFO" | "BFO"; token: string; lot_size: number | null }[]>`
    SELECT exchange, token, lot_size FROM derivative_contracts WHERE underlying = ${u} AND expiry = ${expiry} AND strike = ${strike} AND option_type = ${right} AND exchange IN ('NFO', 'BFO') LIMIT 1`;
  if (!c) return fail("This option contract is not in the instrument master.", 404);
  const idx = UNDERLYING_INDEX[u];
  const undSymbol = idx ? `${c.exchange === "BFO" ? "BSEIDX" : "NSEIDX"}:${idx}` : `NSE:${u}`;
  const [und, prem] = await Promise.all([getBars(undSymbol, tf, user.id).catch(() => null), getBars(`${c.exchange}:${c.token}`, tf, user.id).catch(() => null)]);
  const undBars = (und?.bars ?? []).slice(-600);
  const premBars = (prem?.bars ?? []).slice(-600);
  const analytics = premBars.length ? premiumAnalytics(premBars, undBars, strike, right, expiry) : null;

  // Levels from the contract engine (validated; plan levels gated).
  const g = gate();
  const notices: string[] = [];
  let levels: { underlying: { price: number; label: string; kind: string }[]; premium: { price: number; label: string; kind: string }[] } = { underlying: [], premium: [] };
  const src = await chainFor(user.id, u, expiry).catch(() => null);
  if (src && src.chain.expiry === expiry && src.chain.rows.some((r) => r.strike === strike)) {
    const ctx = await underlyingContext(u);
    const a0 = analyzeContract(src.chain, strike, right, ctx, { capital: 1e6, maxRiskPerTrade: 1e4, minRewardRisk: 1.5 });
    if (a0) {
      const a = applyContractValidation(a0, src.chain);
      levels.underlying.push({ price: strike, label: `Strike ${strike}`, kind: "strike" });
      if (a.metrics.breakeven) levels.underlying.push({ price: a.metrics.breakeven, label: `Expiry breakeven ${a.metrics.breakeven}`, kind: "breakeven" });
      if (a.spot && a.expectedMove.ivMove) {
        levels.underlying.push({ price: Math.round((a.spot + a.expectedMove.ivMove) * 100) / 100, label: "+1σ expected move", kind: "range" });
        levels.underlying.push({ price: Math.round((a.spot - a.expectedMove.ivMove) * 100) / 100, label: "−1σ expected move", kind: "range" });
      }
      if (g.actionable) {
        const b = a.buy;
        if (b.underlyingInvalidation) levels.underlying.push({ price: b.underlyingInvalidation, label: "Invalidation (buy plan)", kind: "stop" });
        if (b.entryPremium) levels.premium.push({ price: b.entryPremium.high, label: `Entry ≤ ${b.entryPremium.high}`, kind: "entry" });
        if (b.stopPremium) levels.premium.push({ price: b.stopPremium, label: `Premium stop ${b.stopPremium}`, kind: "stop" });
        if (b.targetPremium) levels.premium.push({ price: b.targetPremium, label: `Premium target ${b.targetPremium}`, kind: "target" });
      } else notices.push(RESTRICTED_NOTICE);
    }
  } else levels = { underlying: [{ price: strike, label: `Strike ${strike}`, kind: "strike" }], premium: [] };

  return json({
    ok: true, underlying: { symbol: undSymbol, source: und?.source ?? "—", notice: und?.notice ?? null, bars: undBars },
    premium: { symbol: `${c.exchange}:${c.token}`, name: prem?.name ?? `${u} ${expiry} ${strike} ${right}`, source: prem?.source ?? "—", notice: prem?.notice ?? (premBars.length ? null : "No premium history: option candles come from your connected broker."), bars: premBars },
    analytics: analytics ? { points: analytics.points, matched: analytics.matched, ivSolved: analytics.ivSolved, note: "Model IV (Black-Scholes, r = 6.5%) solved per bar from the premium and the underlying at the same timestamp; gaps where no underlying bar matches or no IV solution exists." } : null,
    levels, lotSize: c.lot_size, tf, tfs: TFS, notices,
  });
});
