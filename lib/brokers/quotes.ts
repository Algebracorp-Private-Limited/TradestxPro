import "server-only";
import { createHash } from "node:crypto";
import { db } from "../db";
import { open } from "./vault";
import { BROKER_BY_ID, type BrokerId } from "./catalog";
import { BrokerAuthError, INDEX_IDS, brokerMessage, getWithBody, httpJson, type Creds, type Session } from "./common";
import { recordError } from "./store";

export type QuoteReq = { key: string; kind: "index" | "stock"; symbol: string; token?: string | null; breezeCode?: string | null };
export type Quote = { ltp: number; prevClose: number | null; change: number | null; changePct: number | null; open: number | null; high: number | null; low: number | null; volume: number | null; time: string | null };
export type QuoteResult = { broker: BrokerId | null; brokerName: string | null; quotes: Record<string, Quote>; error?: string };

const QUOTE_PREFERENCE: BrokerId[] = ["dhan", "icici"];
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
function mk(ltp: number, prev: number | null, o: Partial<Quote> = {}): Quote {
  const change = prev ? ltp - prev : null;
  return { ltp, prevClose: prev, change, changePct: prev ? (change! / prev) * 100 : null, open: null, high: null, low: null, volume: null, time: null, ...o };
}

// Short per-user cache so dashboards and watchlists can poll without hammering broker rate limits.
const g = globalThis as unknown as { __quoteCache?: Map<string, { at: number; q: Quote }> };
const cache = (g.__quoteCache ??= new Map());
const TTL = 12_000;

// ---------- ICICI Breeze: signed v1 request, one instrument per call ----------
const BREEZE_V1 = "https://api.icicidirect.com/breezeapi/api/v1/";
async function breezeQuote(session: Session, creds: Creds, r: QuoteReq): Promise<Quote | null> {
  const ids = r.kind === "index" ? INDEX_IDS[r.symbol] : null;
  const stock = r.kind === "index" ? ids?.breeze : r.breezeCode;
  if (!stock) return null;
  const body = JSON.stringify({ stock_code: stock, exchange_code: ids?.breezeExch ?? "NSE", expiry_date: "", product_type: "", right: "", strike_price: "" });
  const ts = new Date().toISOString().slice(0, 19) + ".000Z";
  const checksum = createHash("sha256").update(ts + body + creds.secretKey).digest("hex");
  const res = await getWithBody<{ Success?: Record<string, unknown>[] | null; Error?: string | null; Status?: number }>(
    BREEZE_V1 + "quotes",
    { "Content-Type": "application/json", "X-Checksum": "token " + checksum, "X-Timestamp": ts, "X-AppKey": creds.appKey, "X-SessionToken": session.b64 },
    body,
  );
  if (res.Status === 401 || /session/i.test(String(res.Error ?? ""))) throw new BrokerAuthError(`ICICI: ${res.Error ?? "session expired"}`);
  const row = Array.isArray(res.Success) ? res.Success[0] : null;
  if (!row) return null;
  const ltp = num(row.ltp);
  if (!ltp) return null;
  return mk(ltp, num(row.previous_close), { open: num(row.open), high: num(row.high), low: num(row.low), volume: num(row.total_quantity_traded), time: row.ltt ? String(row.ltt) : null });
}

// ---------- Dhan: one bulk OHLC call for everything ----------
async function dhanQuotes(session: Session, reqs: QuoteReq[]): Promise<Record<string, Quote>> {
  const bySeg: Record<string, Set<number>> = {};
  const lookup: { seg: string; id: string; key: string }[] = [];
  for (const r of reqs) {
    const ids = r.kind === "index" ? INDEX_IDS[r.symbol] : null;
    const id = r.kind === "index" ? ids?.dhan : r.token;
    if (!id) continue;
    const seg = r.kind === "index" ? ids?.dhanSeg ?? "IDX_I" : "NSE_EQ";
    (bySeg[seg] ??= new Set()).add(Number(id));
    lookup.push({ seg, id, key: r.key });
  }
  if (!lookup.length) return {};
  const body = Object.fromEntries(Object.entries(bySeg).map(([k, v]) => [k, [...v]]));
  const res = await httpJson<{ data?: Record<string, Record<string, { last_price?: number; ohlc?: { open: number; close: number; high: number; low: number } }>>; status?: string }>(
    "https://api.dhan.co/v2/marketfeed/ohlc",
    {
      method: "POST",
      headers: { "access-token": session.accessToken, "client-id": session.clientId, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    },
  );
  const out: Record<string, Quote> = {};
  for (const l of lookup) {
    const q = res.data?.[l.seg]?.[l.id];
    const ltp = num(q?.last_price);
    if (!ltp) continue;
    out[l.key] = mk(ltp, num(q?.ohlc?.close), { open: num(q?.ohlc?.open), high: num(q?.ohlc?.high), low: num(q?.ohlc?.low) });
  }
  return out;
}

async function quoteBroker(userId: number) {
  const sql = await db();
  const rows = await sql<{ broker: BrokerId; session_enc: string; credentials_enc: string | null }[]>`
    SELECT broker, session_enc, credentials_enc FROM broker_connections
     WHERE user_id = ${userId} AND status = 'connected' AND session_enc IS NOT NULL AND (expires_at IS NULL OR expires_at > now())`;
  for (const b of QUOTE_PREFERENCE) {
    const r = rows.find((x) => x.broker === b);
    if (r) return { broker: b, session: open<Session>(r.session_enc), creds: r.credentials_enc ? open<Creds>(r.credentials_enc) : {} };
  }
  return null;
}

/** Live quotes from the user's connected broker. Missing keys mean "no live quote available". */
export async function getQuotes(userId: number, reqs: QuoteReq[], opts: { maxCalls?: number } = {}): Promise<QuoteResult> {
  const qb = await quoteBroker(userId).catch(() => null);
  if (!qb) return { broker: null, brokerName: null, quotes: {} };
  const name = BROKER_BY_ID[qb.broker].name;
  const quotes: Record<string, Quote> = {};
  const todo: QuoteReq[] = [];
  const now = Date.now();
  for (const r of reqs) {
    const hit = cache.get(`${userId}:${qb.broker}:${r.key}`);
    if (hit && now - hit.at < TTL) quotes[r.key] = hit.q;
    else todo.push(r);
  }
  let error: string | undefined;
  try {
    if (qb.broker === "dhan") Object.assign(quotes, await dhanQuotes(qb.session, todo));
    else {
      // ICICI: one request per instrument; keep within its per-minute limit.
      const limit = opts.maxCalls ?? 25;
      const batch = todo.slice(0, limit);
      for (let i = 0; i < batch.length; i += 5) {
        const part = batch.slice(i, i + 5);
        const res = await Promise.allSettled(part.map((r) => breezeQuote(qb.session, qb.creds, r)));
        res.forEach((x, k) => {
          if (x.status === "fulfilled" && x.value) quotes[part[k].key] = x.value;
          else if (x.status === "rejected" && x.reason instanceof BrokerAuthError) throw x.reason;
          else if (x.status === "rejected" && !error) error = (x.reason as Error).message;
        });
      }
      if (todo.length > limit) error = `${name} limits quote requests; showing live prices for the first ${limit} symbols.`;
    }
  } catch (e) {
    error = (e as Error).message || brokerMessage(e) || "Quote request failed.";
    if (e instanceof BrokerAuthError) await recordError(userId, qb.broker, error, true).catch(() => {});
  }
  for (const r of todo) if (quotes[r.key]) cache.set(`${userId}:${qb.broker}:${r.key}`, { at: now, q: quotes[r.key] });
  if (cache.size > 5000) cache.clear();
  return { broker: qb.broker, brokerName: name, quotes, error };
}
