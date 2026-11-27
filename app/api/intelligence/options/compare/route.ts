import { fail, json, userHandler } from "@/lib/api";
import { metrics, quickView } from "@/lib/intelligence/options/contract";
import { chainFor, underlyingContext } from "@/lib/intelligence/options/server";
import { requireFlag, symbolParam, rateLimit } from "@/lib/intelligence/http";

export const dynamic = "force-dynamic";

/** Side-by-side comparison of contracts: strikes of one expiry and/or the same moneyness in other expiries (EOD). */
export const GET = userHandler(async ({ user, req }) => {
  const limited = rateLimit("contract", user.id);
  if (limited) return limited;
  const off = await requireFlag("RESEARCH");
  if (off) return off;
  const p = new URL(req.url).searchParams;
  const u = symbolParam(p.get("u"));
  const right = p.get("right");
  if (!u || (right !== "CE" && right !== "PE")) return fail("u and right are required");
  const strikes = (p.get("strikes") ?? "").split(",").map(Number).filter(Number.isFinite).slice(0, 8);
  const src = await chainFor(user.id, u, p.get("expiry") ?? undefined);
  if (!src) return fail("No option chain for this underlying.", 404);
  const ctx = await underlyingContext(u);
  const spot = src.chain.spot;
  const pick = strikes.length ? strikes : spot ? src.chain.rows.map((r) => r.strike).sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, 5).sort((a, b) => a - b) : [];
  const same = pick.map((k) => ({ ...metrics(src.chain, k, right), view: quickView(src.chain, k, right, ctx) })).filter((x) => x.strike !== undefined);
  // Other expiries: the strike nearest the same moneyness as the first requested strike (EOD chains).
  const ref = pick[0] && spot ? pick[0] / spot : null;
  const otherExpiries = ref ? src.eodChains.filter((c) => c.expiry !== src.chain.expiry && c.spot).map((c) => {
    const k = c.rows.map((r) => r.strike).reduce((a, b) => (Math.abs(b / c.spot! - ref) < Math.abs(a / c.spot! - ref) ? b : a));
    return { ...metrics(c, k, right), view: quickView(c, k, right, ctx), source: "eod" };
  }) : [];
  return json({ ok: true, source: src.source, provenance: src.chain.provenance, expiry: src.chain.expiry, sameExpiry: same, otherExpiries, note: "Not ranked by cheapest premium or nearest expiry: compare delta, decay, spread, breakeven distance and scores." });
});
