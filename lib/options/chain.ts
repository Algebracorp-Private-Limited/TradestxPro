import "server-only";
import { createHash } from "node:crypto";
import { db } from "../db";
import { getUnderlying } from "../market-data";
import { open } from "../brokers/vault";
import { BROKER_BY_ID, type BrokerId } from "../brokers/catalog";
import { BrokerAuthError, INDEX_IDS, getWithBody, httpJson, type Creds, type Session } from "../brokers/common";
import { getQuotes } from "../brokers/quotes";
import { recordError } from "../brokers/store";
import { atmStrike, bsGreeks, impliedVol, maxPain, pcr, yearsToExpiry } from "./bs";

export const RISK_FREE = 0.065;

export { UNDERLYING_INDEX } from "./underlyings.ts";
import { UNDERLYING_INDEX } from "./underlyings.ts";

export type Leg = {
  token: string;
  ltp: number | null;
  change: number | null;
  changePct: number | null;
  bid: number | null;
  bidQty: number | null;
  ask: number | null;
  askQty: number | null;
  oi: number | null;
  oiChange: number | null;
  volume: number | null;
  iv: number | null; // decimal
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  greeksSource: "broker" | "model" | null;
};

export type ChainResponse = {
  underlying: string;
  name: string;
  exchange: "NFO" | "BFO";
  kind: "index" | "stock";
  expiries: string[];
  expiry: string | null;
  lotSize: number | null;
  spot: number | null;
  spotSource: string;
  broker: string | null;
  rows: { strike: number; ce: Leg | null; pe: Leg | null }[];
  pcr: number | null;
  maxPain: number | null;
  atm: number | null;
  daysToExpiry: number | null;
  error?: string;
  asOf: string;
};

const n = (v: unknown) => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
};
const emptyLeg = (token: string): Leg => ({
  token, ltp: null, change: null, changePct: null, bid: null, bidQty: null, ask: null, askQty: null, oi: null, oiChange: null, volume: null,
  iv: null, delta: null, gamma: null, theta: null, vega: null, rho: null, greeksSource: null,
});

const g = globalThis as unknown as { __chainCache?: Map<string, { at: number; v: Map<string, Partial<Leg>> }> };
const cache = (g.__chainCache ??= new Map());

async function chainBroker(userId: number): Promise<{ broker: BrokerId; session: Session; creds: Creds } | null> {
  const sql = await db();
  const rows = await sql<{ broker: BrokerId; session_enc: string; credentials_enc: string | null }[]>`
    SELECT broker, session_enc, credentials_enc FROM broker_connections
     WHERE user_id = ${userId} AND status = 'connected' AND session_enc IS NOT NULL AND (expires_at IS NULL OR expires_at > now())`;
  for (const b of ["dhan", "icici"] as BrokerId[]) {
    const r = rows.find((x) => x.broker === b);
    if (r) return { broker: b, session: open<Session>(r.session_enc), creds: r.credentials_enc ? open<Creds>(r.credentials_enc) : {} };
  }
  return null;
}

/** Live legs keyed by `${strike}|CE` / `${strike}|PE`. */
async function dhanChain(session: Session, scrip: string, seg: string, expiry: string) {
  type L = { last_price?: number; previous_close_price?: number; top_bid_price?: number; top_bid_quantity?: number; top_ask_price?: number; top_ask_quantity?: number; oi?: number; previous_oi?: number; volume?: number; implied_volatility?: number; greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number } };
  const r = await httpJson<{ data?: { last_price?: number; oc?: Record<string, { ce?: L; pe?: L }> } }>("https://api.dhan.co/v2/optionchain", {
    method: "POST",
    headers: { "access-token": session.accessToken, "client-id": session.clientId, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ UnderlyingScrip: Number(scrip), UnderlyingSeg: seg, Expiry: expiry }),
  });
  const out = new Map<string, Partial<Leg>>();
  for (const [k, v] of Object.entries(r.data?.oc ?? {})) {
    const strike = Number(k);
    for (const [side, l] of [["CE", v.ce], ["PE", v.pe]] as const) {
      if (!l) continue;
      const ltp = n(l.last_price);
      const prev = n(l.previous_close_price);
      let iv = n(l.implied_volatility);
      if (iv !== null && iv > 3) iv /= 100;
      out.set(`${strike}|${side}`, {
        ltp, change: ltp !== null && prev ? ltp - prev : null, changePct: ltp !== null && prev ? ((ltp - prev) / prev) * 100 : null,
        bid: n(l.top_bid_price), bidQty: n(l.top_bid_quantity), ask: n(l.top_ask_price), askQty: n(l.top_ask_quantity),
        oi: n(l.oi), oiChange: l.oi !== undefined && l.previous_oi !== undefined ? Number(l.oi) - Number(l.previous_oi) : null, volume: n(l.volume),
        iv: iv && iv > 0 ? iv : null,
        ...(l.greeks ? { delta: n(l.greeks.delta), gamma: n(l.greeks.gamma), theta: n(l.greeks.theta), vega: n(l.greeks.vega), greeksSource: "broker" as const } : {}),
      });
    }
  }
  return { legs: out, spot: n(r.data?.last_price) };
}

async function breezeChain(session: Session, creds: Creds, stockCode: string, exch: "NFO" | "BFO", expiry: string) {
  const out = new Map<string, Partial<Leg>>();
  let spot: number | null = null;
  for (const right of ["call", "put"] as const) {
    const body = JSON.stringify({ stock_code: stockCode, exchange_code: exch, expiry_date: `${expiry}T06:00:00.000Z`, product_type: "options", right, strike_price: "" });
    const ts = new Date().toISOString().slice(0, 19) + ".000Z";
    const r = await getWithBody<{ Success?: Record<string, unknown>[] | null; Error?: string | null; Status?: number }>(
      "https://api.icicidirect.com/breezeapi/api/v1/optionchain",
      { "Content-Type": "application/json", "X-Checksum": "token " + createHash("sha256").update(ts + body + creds.secretKey).digest("hex"), "X-Timestamp": ts, "X-AppKey": creds.appKey, "X-SessionToken": session.b64 },
      body,
      25_000,
    );
    if (r.Status === 401 || /session/i.test(String(r.Error ?? ""))) throw new BrokerAuthError(`ICICI: ${r.Error ?? "session expired"}`);
    if (!Array.isArray(r.Success)) {
      if (r.Error) throw new Error(`ICICI: ${r.Error}`);
      continue;
    }
    for (const x of r.Success) {
      const strike = n(x.strike_price);
      if (strike === null) continue;
      const ltp = n(x.ltp);
      const prev = n(x.previous_close);
      spot ??= n(x.spot_price);
      out.set(`${strike}|${right === "call" ? "CE" : "PE"}`, {
        ltp, change: ltp !== null && prev ? ltp - prev : null, changePct: n(x.ltp_percent_change) ?? (ltp !== null && prev ? ((ltp - prev) / prev) * 100 : null),
        bid: n(x.best_bid_price), bidQty: n(x.best_bid_quantity), ask: n(x.best_offer_price), askQty: n(x.best_offer_quantity),
        oi: n(x.open_interest), oiChange: n(x.chnge_oi), volume: n(x.total_quantity_traded),
      });
    }
  }
  return { legs: out, spot };
}

async function eodSpot(kind: "index" | "stock", key: string): Promise<number | null> {
  const sql = await db();
  if (kind === "index") {
    const [r] = await sql<{ close: number | null }[]>`SELECT close FROM market_indices WHERE key = ${key}`;
    return r?.close ?? null;
  }
  const [r] = await sql<{ close: number }[]>`SELECT close FROM screener_snapshot WHERE symbol = ${key}`;
  return r?.close ?? null;
}

export async function getOptionChain(userId: number, underlying: string, expiry?: string, exchange?: string): Promise<ChainResponse | null> {
  const meta = await getUnderlying(underlying, expiry, exchange);
  if (!meta) return null;
  const u = meta.underlying;
  const idxKey = UNDERLYING_INDEX[u];
  const kind: "index" | "stock" = idxKey ? "index" : "stock";
  const sql = await db();

  // Spot price: broker quote, then end-of-day close.
  let spot: number | null = null;
  let spotSource = "—";
  let stockToken: string | null = null;
  let breezeStock: string | null = null;
  if (kind === "stock") {
    const [i] = await sql<{ token: string; breeze_code: string }[]>`SELECT token, breeze_code FROM instruments WHERE exchange = 'NSE' AND symbol = ${u} AND active LIMIT 1`;
    stockToken = i?.token ?? null;
    breezeStock = i?.breeze_code ?? null;
  }
  const qKey = kind === "index" ? idxKey : u;
  const q = await getQuotes(userId, [{ key: qKey, kind, symbol: qKey, token: stockToken, breezeCode: breezeStock }]).catch(() => null);
  if (q?.quotes[qKey]) {
    spot = q.quotes[qKey].ltp;
    spotSource = `${q.brokerName} live`;
  }

  // Live chain from the user's broker.
  let legs = new Map<string, Partial<Leg>>();
  let broker: string | null = null;
  let error: string | undefined;
  const expiryIso = meta.selectedExpiry;
  if (expiryIso) {
    const cb = await chainBroker(userId).catch(() => null);
    if (cb) {
      broker = BROKER_BY_ID[cb.broker].name;
      const ck = `${userId}:${cb.broker}:${u}:${expiryIso}`;
      const hit = cache.get(ck);
      if (hit && Date.now() - hit.at < 10_000) legs = hit.v;
      else {
        try {
          if (cb.broker === "dhan") {
            const scrip = kind === "index" ? INDEX_IDS[idxKey]?.dhan : stockToken;
            if (!scrip) throw new Error("Dhan option chain is not available for this underlying.");
            const seg = kind === "index" ? INDEX_IDS[idxKey]?.dhanSeg ?? "IDX_I" : "NSE_EQ";
            const r = await dhanChain(cb.session, scrip, seg, expiryIso);
            legs = r.legs;
            if (r.spot && !spot) {
              spot = r.spot;
              spotSource = "Dhan live";
            }
          } else {
            const r = await breezeChain(cb.session, cb.creds, meta.breezeCode, meta.exchange, expiryIso);
            legs = r.legs;
            if (r.spot && !spot) {
              spot = r.spot;
              spotSource = "ICICI live";
            }
          }
          cache.set(ck, { at: Date.now(), v: legs });
          if (cache.size > 300) cache.clear();
        } catch (e) {
          error = (e as Error).message;
          if (e instanceof BrokerAuthError) await recordError(userId, cb.broker, error, true).catch(() => {});
        }
      }
    }
  }
  if (spot === null) {
    spot = await eodSpot(kind, kind === "index" ? idxKey : u);
    if (spot !== null) spotSource = "End of day";
  }

  const T = expiryIso ? yearsToExpiry(expiryIso) : 0;
  const rows = meta.chain.map((r) => {
    const build = (side: "CE" | "PE", c: typeof r.ce): Leg | null => {
      if (!c) return null;
      const live = legs.get(`${r.strike}|${side}`) ?? {};
      const leg: Leg = { ...emptyLeg(c.token), ...live, token: c.token };
      // Model IV/Greeks when the broker does not supply them.
      const px = leg.ltp ?? (leg.bid && leg.ask ? (leg.bid + leg.ask) / 2 : null);
      if (spot && T > 0) {
        if (leg.iv === null && px) {
          const iv = impliedVol(px, { S: spot, K: r.strike, T, r: RISK_FREE, right: side });
          leg.iv = Number.isFinite(iv) ? iv : null;
        }
        if (leg.greeksSource !== "broker" && leg.iv) {
          Object.assign(leg, bsGreeks({ S: spot, K: r.strike, T, r: RISK_FREE, sigma: leg.iv, right: side }), { greeksSource: "model" as const });
        }
      }
      return leg;
    };
    return { strike: r.strike, ce: build("CE", r.ce), pe: build("PE", r.pe) };
  });

  const strikes = rows.map((r) => r.strike);
  return {
    underlying: u,
    name: meta.name,
    exchange: meta.exchange,
    kind,
    expiries: meta.optionExpiries,
    expiry: expiryIso,
    lotSize: meta.chain[0]?.ce?.lotSize ?? meta.chain[0]?.pe?.lotSize ?? null,
    spot,
    spotSource,
    broker,
    rows,
    pcr: pcr(rows),
    maxPain: maxPain(rows),
    atm: spot !== null ? atmStrike(strikes, spot) : null,
    daysToExpiry: expiryIso ? Math.round(T * 365 * 10) / 10 : null,
    error,
    asOf: new Date().toISOString(),
  };
}

export type Depth = { bids: { price: number; qty: number; orders?: number }[]; asks: { price: number; qty: number; orders?: number }[]; source: string };

/** Top-5 market depth for an option contract (Dhan supplies 5 levels; ICICI supplies best bid/offer). */
export async function contractDepth(userId: number, token: string, exchange: "NFO" | "BFO"): Promise<Depth | null> {
  const cb = await chainBroker(userId).catch(() => null);
  if (!cb) return null;
  const sql = await db();
  const [c] = await sql<{ breeze_code: string; expiry: Date; strike: string; option_type: string }[]>`
    SELECT breeze_code, expiry, strike, option_type FROM derivative_contracts WHERE exchange = ${exchange} AND token = ${token}`;
  if (!c) return null;
  if (cb.broker === "dhan") {
    const seg = exchange === "NFO" ? "NSE_FNO" : "BSE_FNO";
    type Lvl = { price: number; quantity: number; orders?: number };
    const r = await httpJson<{ data?: Record<string, Record<string, { depth?: { buy?: Lvl[]; sell?: Lvl[] } }>> }>("https://api.dhan.co/v2/marketfeed/quote", {
      method: "POST",
      headers: { "access-token": cb.session.accessToken, "client-id": cb.session.clientId, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ [seg]: [Number(token)] }),
    });
    const d = r.data?.[seg]?.[token]?.depth;
    if (!d) return null;
    const map = (x: Lvl[] = []) => x.filter((l) => l.price > 0).map((l) => ({ price: l.price, qty: l.quantity, orders: l.orders }));
    return { bids: map(d.buy), asks: map(d.sell), source: "Dhan · 5 levels" };
  }
  const body = JSON.stringify({
    stock_code: c.breeze_code, exchange_code: exchange, expiry_date: `${c.expiry.toISOString().slice(0, 10)}T06:00:00.000Z`,
    product_type: "options", right: c.option_type === "CE" ? "call" : "put", strike_price: String(Number(c.strike)),
  });
  const ts = new Date().toISOString().slice(0, 19) + ".000Z";
  const r = await getWithBody<{ Success?: Record<string, unknown>[] | null }>(
    "https://api.icicidirect.com/breezeapi/api/v1/quotes",
    { "Content-Type": "application/json", "X-Checksum": "token " + createHash("sha256").update(ts + body + cb.creds.secretKey).digest("hex"), "X-Timestamp": ts, "X-AppKey": cb.creds.appKey, "X-SessionToken": cb.session.b64 },
    body,
  );
  const x = r.Success?.[0];
  if (!x) return null;
  const bid = n(x.best_bid_price);
  const ask = n(x.best_offer_price);
  return {
    bids: bid ? [{ price: bid, qty: n(x.best_bid_quantity) ?? 0 }] : [],
    asks: ask ? [{ price: ask, qty: n(x.best_offer_quantity) ?? 0 }] : [],
    source: "ICICI · best bid/offer only",
  };
}
