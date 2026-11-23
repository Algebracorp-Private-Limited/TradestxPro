import "server-only";
import { db } from "./db";
import { getQuotes, type Quote, type QuoteReq } from "./brokers/quotes";
import { isVaultConfigured } from "./brokers/vault";
import { BSE_INDICES } from "./index-catalog";

export type Section = "index" | "future" | "option";
export const SECTIONS: Section[] = ["index", "future", "option"];
const MAX_PER_SECTION = 50;

type Meta = { underlying?: string; expiry?: string; strike?: number | null; right?: "CE" | "PE" | null; lot?: number; breezeCode?: string };
export type WatchItem = {
  id: number;
  section: Section;
  exchange: string;
  key: string;
  label: string;
  meta: Meta;
  expired: boolean;
  quote: Quote | null;
  eod: { close: number; changePct: number | null } | null;
  chart: string | null;
};

/** Validates a requested entry and returns what to store, or an error message. */
export async function resolveEntry(section: Section, exchange: string, key: string): Promise<{ exchange: string; key: string; label: string; meta: Meta } | string> {
  const sql = await db();
  if (section === "index") {
    const k = key.toUpperCase().slice(0, 80);
    const bse = BSE_INDICES.find((b) => b.key === k);
    if (bse) return { exchange: "BSE", key: k, label: bse.name, meta: {} };
    const [m] = await sql<{ name: string }[]>`SELECT name FROM market_indices WHERE key = ${k}`;
    return m ? { exchange: "NSE", key: k, label: m.name, meta: {} } : "Unknown index.";
  }
  const ex = exchange === "BFO" ? "BFO" : "NFO";
  const [c] = await sql<{ underlying: string; expiry: Date; strike: string | null; option_type: string | null; lot_size: number; breeze_code: string; instrument_type: string }[]>`
    SELECT underlying, expiry, strike, option_type, lot_size, breeze_code, instrument_type FROM derivative_contracts WHERE exchange = ${ex} AND token = ${String(key).slice(0, 30)}`;
  if (!c) return "That contract was not found (it may have expired).";
  const isFut = c.instrument_type.startsWith("FUT");
  if ((section === "future") !== isFut) return section === "future" ? "That is an option contract, not a future." : "That is a future, not an option contract.";
  const expiry = c.expiry.toISOString().slice(0, 10);
  const mon = new Date(expiry + "T00:00:00Z").toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
  const strike = c.strike === null ? null : Number(c.strike);
  const label = isFut ? `${c.underlying} ${mon} FUT` : `${c.underlying} ${mon} ${strike} ${c.option_type}`;
  return { exchange: ex, key: String(key), label, meta: { underlying: c.underlying, expiry, strike, right: (c.option_type as "CE" | "PE") ?? null, lot: c.lot_size, breezeCode: c.breeze_code } };
}

export async function addEntry(userId: number, section: Section, exchange: string, key: string, replaceId?: number): Promise<string | null> {
  const r = await resolveEntry(section, exchange, key);
  if (typeof r === "string") return r;
  const sql = await db();
  if (replaceId) {
    const res = await sql`UPDATE watch_items SET exchange = ${r.exchange}, key = ${r.key}, label = ${r.label}, meta = ${sql.json(r.meta)}
                           WHERE id = ${replaceId} AND user_id = ${userId} AND section = ${section}
                             AND NOT EXISTS (SELECT 1 FROM watch_items w WHERE w.user_id = ${userId} AND w.section = ${section} AND w.exchange = ${r.exchange} AND w.key = ${r.key} AND w.id <> ${replaceId})`;
    return res.count ? null : "Already in this list, or the item no longer exists.";
  }
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM watch_items WHERE user_id = ${userId} AND section = ${section}`;
  if (n >= MAX_PER_SECTION) return `Up to ${MAX_PER_SECTION} items per section.`;
  const res = await sql`INSERT INTO watch_items (user_id, section, exchange, key, label, meta, position)
                        VALUES (${userId}, ${section}, ${r.exchange}, ${r.key}, ${r.label}, ${sql.json(r.meta)}, ${n})
                        ON CONFLICT (user_id, section, exchange, key) DO NOTHING`;
  return res.count ? null : "Already in this list.";
}

export async function listWatch(userId: number): Promise<{ items: WatchItem[]; broker: string | null; error?: string }> {
  const sql = await db();
  const rows = await sql<{ id: string; section: Section; exchange: string; key: string; label: string; meta: Meta; live: boolean }[]>`
    SELECT w.id, w.section, w.exchange, w.key, w.label, w.meta,
           (w.section = 'index' OR EXISTS (SELECT 1 FROM derivative_contracts d WHERE d.exchange = w.exchange AND d.token = w.key)) AS live
      FROM watch_items w WHERE w.user_id = ${userId} ORDER BY w.section, w.position, w.id`;
  const idxKeys = rows.filter((r) => r.section === "index").map((r) => r.key);
  const eodRows = idxKeys.length ? await sql<{ key: string; close: number | null; change_pct: number | null }[]>`SELECT key, close, change_pct FROM market_indices WHERE key IN ${sql(idxKeys)}` : [];
  const eod = new Map(eodRows.map((r) => [r.key, r]));

  const reqs: QuoteReq[] = [];
  for (const r of rows) {
    if (!r.live) continue;
    const k = `${r.section}:${r.exchange}:${r.key}`;
    const ex = r.exchange as "NFO" | "BFO";
    if (r.section === "index") reqs.push({ key: k, kind: "index", symbol: r.key });
    else if (r.section === "future") reqs.push({ key: k, kind: "future", symbol: r.meta.underlying ?? "", token: r.key, breezeCode: r.meta.breezeCode, fut: { exchange: ex, expiry: r.meta.expiry ?? "" } });
    else reqs.push({ key: k, kind: "option", symbol: r.meta.underlying ?? "", token: r.key, breezeCode: r.meta.breezeCode, opt: { exchange: ex, expiry: r.meta.expiry ?? "", strike: r.meta.strike ?? 0, right: r.meta.right ?? "CE" } });
  }
  // End-of-day fallback for options from the last F&O bhavcopy.
  const opts = rows.filter((r) => r.section === "option" && r.meta.underlying && r.meta.expiry && r.meta.strike != null && r.meta.right);
  const optEod = new Map<string, { close: number; prev: number | null; oi: number; contracts: number }>();
  if (opts.length) {
    const e = await sql<{ underlying: string; expiry: Date; strike: number; opt: string; close: number; prev_close: number | null; oi_qty: number; contracts: number }[]>`
      SELECT underlying, expiry, strike, opt, close, prev_close, oi_qty, contracts FROM fo_contracts
       WHERE underlying IN ${sql([...new Set(opts.map((r) => r.meta.underlying!))])} AND expiry IN ${sql([...new Set(opts.map((r) => r.meta.expiry!))])}`.catch(() => []);
    for (const x of e) optEod.set(`${x.underlying}|${x.expiry.toISOString().slice(0, 10)}|${Number(x.strike)}|${x.opt}`, { close: x.close, prev: x.prev_close, oi: x.oi_qty, contracts: x.contracts });
  }
  const q = reqs.length && isVaultConfigured() ? await getQuotes(userId, reqs, { maxCalls: 60, concurrency: 4 }).catch(() => null) : null;

  const items: WatchItem[] = rows.map((r) => {
    const e = r.section === "index" ? eod.get(r.key) : undefined;
    const oe = r.section === "option" ? optEod.get(`${r.meta.underlying}|${r.meta.expiry}|${Number(r.meta.strike)}|${r.meta.right}`) : undefined;
    return {
      id: Number(r.id), section: r.section, exchange: r.exchange, key: r.key, label: r.label, meta: r.meta, expired: !r.live,
      quote: q?.quotes[`${r.section}:${r.exchange}:${r.key}`] ?? null,
      eod: e && e.close !== null ? { close: e.close, changePct: e.change_pct } : oe ? { close: oe.close, changePct: oe.prev ? (oe.close / oe.prev - 1) * 100 : null } : null,
      chart: r.section === "index" ? `${r.exchange === "BSE" ? "BSEIDX" : "NSEIDX"}:${r.key}` : r.live ? `${r.exchange}:${r.key}` : null,
    };
  });
  return { items, broker: q?.brokerName ?? null, error: q?.error };
}

const today = () => new Date(Date.now() + 19800_000).toISOString().slice(0, 10);

/** Strikes and expiries to pick a futures or options contract from. */
export async function contractChoices(underlying: string, type: "future" | "option", expiry?: string) {
  const sql = await db();
  const u = underlying.toUpperCase().slice(0, 40);
  const fut = type === "future";
  const exps = await sql<{ exchange: string; expiry: Date }[]>`
    SELECT DISTINCT exchange, expiry FROM derivative_contracts
     WHERE underlying = ${u} AND instrument_type ${fut ? sql`LIKE 'FUT%'` : sql`LIKE 'OPT%'`} AND expiry >= ${today()} ORDER BY expiry LIMIT 40`;
  const expiries = exps.map((e) => ({ exchange: e.exchange, expiry: e.expiry.toISOString().slice(0, 10) }));
  if (fut) {
    const rows = await sql<{ exchange: string; token: string; expiry: Date; lot_size: number }[]>`
      SELECT exchange, token, expiry, lot_size FROM derivative_contracts WHERE underlying = ${u} AND instrument_type LIKE 'FUT%' AND expiry >= ${today()} ORDER BY expiry`;
    return { expiries, contracts: rows.map((r) => ({ exchange: r.exchange, token: r.token, expiry: r.expiry.toISOString().slice(0, 10), strike: null, right: null, lot: r.lot_size })) };
  }
  const ex = expiry && expiries.some((e) => e.expiry === expiry) ? expiry : expiries[0]?.expiry;
  if (!ex) return { expiries, contracts: [] };
  const rows = await sql<{ exchange: string; token: string; strike: string; option_type: "CE" | "PE"; lot_size: number }[]>`
    SELECT exchange, token, strike, option_type, lot_size FROM derivative_contracts
     WHERE underlying = ${u} AND instrument_type LIKE 'OPT%' AND expiry = ${ex} ORDER BY strike, option_type`;
  return { expiries, expiry: ex, contracts: rows.map((r) => ({ exchange: r.exchange, token: r.token, expiry: ex, strike: Number(r.strike), right: r.option_type, lot: r.lot_size })) };
}
