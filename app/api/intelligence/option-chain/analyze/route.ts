import { db } from "@/lib/db";
import { fail, json, userHandler } from "@/lib/api";
import { isEnabled } from "@/lib/flags";
import { chainAnalytics, termStructure } from "@/lib/intelligence/options/chain-analytics";
import { quickView } from "@/lib/intelligence/options/contract";
import { chainFor, underlyingContext } from "@/lib/intelligence/options/server";
import { symbolParam, rateLimit } from "@/lib/intelligence/http";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Chain Intelligence for one underlying/expiry: descriptive analytics (market analytics flag) and the
 * per-contract AI View cells (research flag). One request per chain refresh: hover cards read these
 * cached views, so no language model is called per hover.
 */
export const GET = userHandler(async ({ user, req }) => {
  const limited = rateLimit("chain", user.id);
  if (limited) return limited;
  if (!isEnabled("MARKET_ANALYTICS")) return fail("Market analytics are not activated.", 403);
  const p = new URL(req.url).searchParams;
  const u = symbolParam(p.get("u"));
  if (!u) return fail("u (underlying) is required");
  const expiry = p.get("expiry") ?? undefined;
  if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return fail("invalid expiry");
  const src = await chainFor(user.id, u, expiry);
  if (!src) return fail("No option chain for this underlying.", 404);
  const ctx = await underlyingContext(u);
  const analytics = chainAnalytics(src.chain, ctx);
  const views = isEnabled("RESEARCH") ? Object.fromEntries(src.chain.rows.flatMap((r) => (["CE", "PE"] as const).filter((x) => (x === "CE" ? r.ce : r.pe)).map((x) => [`${r.strike}|${x}`, quickView(src.chain, r.strike, x, ctx)]))) : null;
  const sql = await db();
  const oiHistory = await sql<{ d: Date; ce: number; pe: number }[]>`SELECT d, sum(ce_oi_qty)::float AS ce, sum(pe_oi_qty)::float AS pe FROM fo_activity WHERE underlying = ${u} GROUP BY d ORDER BY d DESC LIMIT 60`;
  return json({
    ok: true, source: src.source, provenance: src.chain.provenance, expiries: src.expiries, expiry: src.chain.expiry, lotSize: src.chain.lotSize, context: ctx,
    analytics, views, viewsRestricted: views === null,
    termStructure: termStructure(src.eodChains), termStructureSource: "NSE F&O bhavcopy (latest session); IV computed by TradestXPro (Black-Scholes)",
    history: { oi: oiHistory.reverse().map((x) => ({ d: x.d.toISOString().slice(0, 10), ce: x.ce, pe: x.pe })), iv: null, ivNote: "No implied-volatility history is stored: historical IV is not shown." },
  });
});
