import "server-only";
import { createHash } from "node:crypto";
import type { Bar } from "../ta/catalog";
import { resample } from "../ta/catalog";
import type { BrokerId } from "./catalog";
import {
  BrokerAuthError, BrokerError, INDEX_IDS, bucketMinutes, getWithBody, httpJson, istDate, istDateTime, nextMorningIst,
  normaliseDaily, pad, parseIstTime, sortBars, toBar, type Adapter, type Tf,
} from "./common";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const need = (v: string | undefined, what: string) => {
  if (!v) throw new BrokerError(`${what} is missing.`);
  return v;
};
const finish = (bars: Bar[], tf: Tf, native: Tf): Bar[] => {
  if (tf === native) return tf === "1D" ? normaliseDaily(bars) : bars;
  if (tf === "1W") return resample(normaliseDaily(bars), "W");
  const mins: Record<string, number> = { "15m": 15, "30m": 30, "1h": 60 };
  return mins[tf] ? bucketMinutes(bars, mins[tf]) : bars;
};

// ======================= ICICI Direct — Breeze =======================
// Login: https://api.icicidirect.com/apiuser/login?api_key=<url-encoded key>, redirect carries the API session.
// Session: GET (with JSON body) /breezeapi/api/v1/customerdetails → Success.session_token = base64("<user_id>:<session_key>").
const BREEZE_V1 = "https://api.icicidirect.com/breezeapi/api/v1/";
const BREEZE_V2 = "https://breezeapi.icicidirect.com/api/v2/";

const breeze: Adapter = {
  loginUrl: ({ creds }) => `https://api.icicidirect.com/apiuser/login?api_key=${encodeURIComponent(need(creds.appKey, "App Key"))}`,
  async complete({ params, creds }) {
    const apiSession = params.apisession ?? params.API_Session ?? params.api_session ?? params.session_token ?? params.SessionToken;
    if (!apiSession) throw new BrokerError("ICICI did not return a session. Please try connecting again.");
    const body = JSON.stringify({ SessionToken: apiSession, AppKey: creds.appKey });
    const r = await getWithBody<{ Success?: { session_token?: string; idirect_user_name?: string; idirect_userid?: string }; Error?: string; Status?: number }>(
      BREEZE_V1 + "customerdetails",
      { "Content-Type": "application/json" },
      body,
    );
    const tok = r.Success?.session_token;
    if (!tok) throw new BrokerAuthError(`ICICI login failed${r.Error ? `: ${r.Error}` : "."}`);
    const decoded = Buffer.from(tok, "base64").toString("ascii");
    const [userId, sessionKey] = decoded.split(":");
    if (!userId || !sessionKey) throw new BrokerError("Unexpected ICICI session format.");
    return {
      session: { userId, sessionKey, b64: tok },
      label: r.Success?.idirect_user_name ? `${r.Success.idirect_user_name} (${userId})` : userId,
      expiresAt: nextMorningIst(),
    };
  },
  async history({ session, creds, inst, tf, from, to }) {
    const native: Tf = tf === "1m" ? "1m" : tf === "5m" || tf === "15m" ? "5m" : tf === "30m" || tf === "1h" ? "30m" : "1D";
    const interval = { "1m": "1minute", "5m": "5minute", "30m": "30minute", "1D": "1day" }[native as "1m"];
    const code = inst.kind === "index" ? INDEX_IDS[inst.symbol]?.breeze : inst.breezeCode;
    if (!code) throw new BrokerError("This instrument is not available from ICICI.");
    const q = new URLSearchParams({
      interval: interval!,
      from_date: from.toISOString().slice(0, 19) + ".000Z",
      to_date: to.toISOString().slice(0, 19) + ".000Z",
      stock_code: code,
      exch_code: inst.kind === "index" ? (INDEX_IDS[inst.symbol]?.breezeExch ?? "NSE") : "NSE",
      product_type: "cash",
    });
    const r = await httpJson<{ Success?: Record<string, unknown>[]; Error?: string }>(`${BREEZE_V2}historicalcharts?${q}`, {
      headers: { "Content-Type": "application/json", "X-SessionToken": session.b64, apikey: creds.appKey },
    });
    if (!Array.isArray(r.Success)) throw new BrokerError(`ICICI: ${r.Error ?? "no data"}`);
    const bars = sortBars(r.Success.map((x) => toBar(parseIstTime(String(x.datetime)), x.open, x.high, x.low, x.close, x.volume)));
    return finish(bars, tf, native);
  },
};

// ======================= Dhan — DhanHQ v2 =======================
const DHAN = "https://api.dhan.co/v2";
const dhanHeaders = (s: { accessToken: string; clientId: string }) => ({
  "access-token": s.accessToken,
  "client-id": s.clientId,
  dhanClientId: s.clientId,
  "Content-Type": "application/json",
  Accept: "application/json",
});

const dhan: Adapter = {
  async formLogin(f) {
    const clientId = need(f.clientId?.trim(), "Client ID");
    const accessToken = need(f.accessToken?.trim(), "Access token");
    const p = await httpJson<{ dhanClientId?: string; tokenValidity?: string; errorMessage?: string }>(`${DHAN}/profile`, {
      headers: dhanHeaders({ accessToken, clientId }),
    });
    if (p?.dhanClientId && String(p.dhanClientId) !== clientId) throw new BrokerAuthError("That token belongs to a different Dhan client ID.");
    let expiresAt: Date | null = null;
    if (p?.tokenValidity) {
      const t = Date.parse(p.tokenValidity.replace(/^(\d\d)\/(\d\d)\/(\d{4})/, "$3-$2-$1"));
      if (Number.isFinite(t)) expiresAt = new Date(t);
    }
    return { session: { clientId, accessToken }, label: clientId, expiresAt };
  },
  async history({ session, inst, tf, from, to }) {
    const s = { accessToken: session.accessToken, clientId: session.clientId };
    const isIdx = inst.kind === "index";
    const securityId = isIdx ? INDEX_IDS[inst.symbol]?.dhan : inst.token;
    if (!securityId) throw new BrokerError("This instrument is not available from Dhan.");
    const base = { securityId, exchangeSegment: isIdx ? "IDX_I" : "NSE_EQ", instrument: isIdx ? "INDEX" : "EQUITY", oi: false };
    type R = { open: number[]; high: number[]; low: number[]; close: number[]; volume: number[]; timestamp: number[] };
    const toBars = (r: R) => sortBars((r?.timestamp ?? []).map((t, i) => toBar(t, r.open[i], r.high[i], r.low[i], r.close[i], r.volume?.[i])));
    if (tf === "1D" || tf === "1W") {
      const r = await httpJson<R>(`${DHAN}/charts/historical`, {
        method: "POST",
        headers: dhanHeaders(s),
        body: JSON.stringify({ ...base, expiryCode: 0, fromDate: istDate(from), toDate: istDate(new Date(to.getTime() + 86400_000)) }),
      });
      return finish(toBars(r), tf, "1D");
    }
    const native: Tf = tf === "30m" ? "15m" : tf;
    const interval = { "1m": "1", "5m": "5", "15m": "15", "1h": "60" }[native as "1m"];
    const r = await httpJson<R>(`${DHAN}/charts/intraday`, {
      method: "POST",
      headers: dhanHeaders(s),
      body: JSON.stringify({ ...base, interval, fromDate: istDateTime(from), toDate: istDateTime(to) }),
    });
    return finish(toBars(r), tf, native);
  },
};

// ======================= Kotak Neo — Trade API v2 =======================
// TOTP login → MPIN validate (per Kotak's official neo_api_client). No historical candles API.
const KOTAK = "https://mis.kotaksecurities.com";
const kotak: Adapter = {
  async formLogin(f) {
    const consumerKey = need(f.consumerKey?.trim(), "API token");
    const ucc = need(f.ucc?.trim(), "Client code (UCC)");
    let mobile = need(f.mobile?.replace(/[^\d+]/g, ""), "Mobile number");
    if (!mobile.startsWith("+")) mobile = "+91" + mobile.replace(/^91(?=\d{10}$)/, "");
    const totp = need(f.totp?.replace(/\D/g, ""), "TOTP");
    const mpin = need(f.mpin?.replace(/\D/g, ""), "MPIN");
    type R = { data?: { token?: string; sid?: string; hsServerId?: string; baseUrl?: string; rid?: string; ucc?: string }; message?: string; error?: unknown };
    const a = await httpJson<R>(`${KOTAK}/login/1.0/tradeApiLogin`, {
      method: "POST",
      headers: { Authorization: consumerKey, "neo-fin-key": "neotradeapi", "Content-Type": "application/json" },
      body: JSON.stringify({ mobileNumber: mobile, ucc, totp }),
    });
    if (!a.data?.token || !a.data.sid) throw new BrokerAuthError(`Kotak TOTP login failed${a.message ? `: ${a.message}` : ". Check the TOTP, UCC and mobile."}`);
    const b = await httpJson<R>(`${KOTAK}/login/1.0/tradeApiValidate`, {
      method: "POST",
      headers: { Authorization: consumerKey, sid: a.data.sid, Auth: a.data.token, "neo-fin-key": "neotradeapi", "Content-Type": "application/json" },
      body: JSON.stringify({ mpin }),
    });
    if (!b.data?.token || !b.data.sid) throw new BrokerAuthError(`Kotak MPIN validation failed${b.message ? `: ${b.message}` : "."}`);
    return {
      session: { token: b.data.token, sid: b.data.sid, serverId: b.data.hsServerId ?? "", baseUrl: b.data.baseUrl ?? "" },
      label: ucc,
      expiresAt: nextMorningIst(),
    };
  },
};

// ======================= Zerodha — Kite Connect (beta) =======================
const KITE = "https://api.kite.trade";
const kite: Adapter = {
  loginUrl: () => `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(need(process.env.KITE_API_KEY, "KITE_API_KEY"))}`,
  async complete({ params }) {
    const apiKey = need(process.env.KITE_API_KEY, "KITE_API_KEY");
    const secret = need(process.env.KITE_API_SECRET, "KITE_API_SECRET");
    const requestToken = need(params.request_token, "request_token");
    const r = await httpJson<{ data?: { access_token: string; user_id: string; user_name?: string } }>(`${KITE}/session/token`, {
      method: "POST",
      headers: { "X-Kite-Version": "3", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ api_key: apiKey, request_token: requestToken, checksum: sha256(apiKey + requestToken + secret) }).toString(),
    });
    if (!r.data?.access_token) throw new BrokerAuthError("Zerodha login failed.");
    return { session: { accessToken: r.data.access_token }, label: r.data.user_name ? `${r.data.user_name} (${r.data.user_id})` : r.data.user_id, expiresAt: nextMorningIst() };
  },
  async history({ session, inst, tf, from, to }) {
    const apiKey = need(process.env.KITE_API_KEY, "KITE_API_KEY");
    // NSE equity instrument_token = exchange_token × 256 + 1 (NSE segment id).
    const token = inst.kind === "index" ? INDEX_IDS[inst.symbol]?.kite : inst.token ? Number(inst.token) * 256 + 1 : undefined;
    if (!token) throw new BrokerError("This instrument is not available from Zerodha.");
    const native: Tf = tf === "30m" ? "15m" : tf === "1W" ? "1D" : tf;
    const interval = { "1m": "minute", "5m": "5minute", "15m": "15minute", "1h": "60minute", "1D": "day" }[native as "1m"];
    const q = new URLSearchParams({ from: istDateTime(from), to: istDateTime(to) });
    const r = await httpJson<{ data?: { candles: [string, number, number, number, number, number][] } }>(`${KITE}/instruments/historical/${token}/${interval}?${q}`, {
      headers: { "X-Kite-Version": "3", Authorization: `token ${apiKey}:${session.accessToken}` },
    });
    return finish(sortBars((r.data?.candles ?? []).map((c) => toBar(parseIstTime(c[0]), c[1], c[2], c[3], c[4], c[5]))), tf, native);
  },
};

// ======================= Upstox — API v2 (beta) =======================
const UPSTOX = "https://api.upstox.com/v2";
const upstox: Adapter = {
  loginUrl: ({ state, redirectUri }) =>
    `${UPSTOX}/login/authorization/dialog?${new URLSearchParams({ response_type: "code", client_id: need(process.env.UPSTOX_CLIENT_ID, "UPSTOX_CLIENT_ID"), redirect_uri: redirectUri, state })}`,
  async complete({ params, redirectUri }) {
    const r = await httpJson<{ access_token?: string; user_id?: string; user_name?: string }>(`${UPSTOX}/login/authorization/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        code: need(params.code, "code"),
        client_id: need(process.env.UPSTOX_CLIENT_ID, "UPSTOX_CLIENT_ID"),
        client_secret: need(process.env.UPSTOX_CLIENT_SECRET, "UPSTOX_CLIENT_SECRET"),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
    if (!r.access_token) throw new BrokerAuthError("Upstox login failed.");
    return { session: { accessToken: r.access_token }, label: r.user_name ? `${r.user_name} (${r.user_id})` : String(r.user_id), expiresAt: nextMorningIst() };
  },
  async history({ session, inst, tf, from, to }) {
    const key = inst.kind === "index" ? INDEX_IDS[inst.symbol]?.upstox : inst.isin ? `NSE_EQ|${inst.isin}` : undefined;
    if (!key) throw new BrokerError("This instrument is not available from Upstox.");
    const native: Tf = tf === "1m" || tf === "30m" ? tf : tf === "5m" || tf === "15m" ? "1m" : tf === "1h" ? "30m" : "1D";
    const interval = { "1m": "1minute", "30m": "30minute", "1D": "day" }[native as "1m"];
    const url = `${UPSTOX}/historical-candle/${encodeURIComponent(key)}/${interval}/${istDate(to)}/${istDate(from)}`;
    const r = await httpJson<{ data?: { candles: [string, number, number, number, number, number][] } }>(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${session.accessToken}` },
    });
    const bars = sortBars((r.data?.candles ?? []).map((c) => toBar(parseIstTime(c[0]), c[1], c[2], c[3], c[4], c[5])));
    if (tf === "5m") return bucketMinutes(bars, 5);
    return finish(bars, tf, native);
  },
};

// ======================= Fyers — API v3 (beta) =======================
const FYERS = "https://api-t1.fyers.in";
const fyers: Adapter = {
  loginUrl: ({ state, redirectUri }) =>
    `${FYERS}/api/v3/generate-authcode?${new URLSearchParams({ client_id: need(process.env.FYERS_APP_ID, "FYERS_APP_ID"), redirect_uri: redirectUri, response_type: "code", state })}`,
  async complete({ params }) {
    const appId = need(process.env.FYERS_APP_ID, "FYERS_APP_ID");
    const r = await httpJson<{ access_token?: string; s?: string; message?: string }>(`${FYERS}/api/v3/validate-authcode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", appIdHash: sha256(`${appId}:${need(process.env.FYERS_SECRET, "FYERS_SECRET")}`), code: need(params.auth_code, "auth_code") }),
    });
    if (!r.access_token) throw new BrokerAuthError(`Fyers login failed${r.message ? `: ${r.message}` : "."}`);
    const p = await httpJson<{ data?: { fy_id?: string; name?: string } }>(`${FYERS}/api/v3/profile`, { headers: { Authorization: `${appId}:${r.access_token}` } }).catch(() => null);
    return { session: { accessToken: r.access_token }, label: p?.data?.name ? `${p.data.name} (${p.data.fy_id})` : "Fyers account", expiresAt: nextMorningIst() };
  },
  async history({ session, inst, tf, from, to }) {
    const appId = need(process.env.FYERS_APP_ID, "FYERS_APP_ID");
    const symbol = inst.kind === "index" ? INDEX_IDS[inst.symbol]?.fyers : `NSE:${inst.symbol}-EQ`;
    if (!symbol) throw new BrokerError("This instrument is not available from Fyers.");
    const native: Tf = tf === "1W" ? "1D" : tf;
    const resolution = { "1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "1D": "D" }[native as "1m"];
    const q = new URLSearchParams({ symbol, resolution: resolution!, date_format: "0", range_from: String(Math.floor(from.getTime() / 1000)), range_to: String(Math.floor(to.getTime() / 1000)), cont_flag: "1" });
    const r = await httpJson<{ candles?: number[][]; s?: string; message?: string }>(`${FYERS}/data/history?${q}`, { headers: { Authorization: `${appId}:${session.accessToken}` } });
    if (r.s && r.s !== "ok" && !r.candles) throw new BrokerError(`Fyers: ${r.message ?? r.s}`);
    return finish(sortBars((r.candles ?? []).map((c) => toBar(c[0], c[1], c[2], c[3], c[4], c[5]))), tf, native);
  },
};

// ======================= Angel One — SmartAPI publisher login (beta) =======================
const ANGEL = "https://apiconnect.angelone.in";
const angelHeaders = (jwt: string) => ({
  Authorization: `Bearer ${jwt}`,
  "Content-Type": "application/json",
  Accept: "application/json",
  "X-UserType": "USER",
  "X-SourceID": "WEB",
  "X-ClientLocalIP": "127.0.0.1",
  "X-ClientPublicIP": "127.0.0.1",
  "X-MACAddress": "00:00:00:00:00:00",
  "X-PrivateKey": need(process.env.ANGEL_API_KEY, "ANGEL_API_KEY"),
});
const angel: Adapter = {
  loginUrl: ({ state }) => `https://smartapi.angelone.in/publisher-login?${new URLSearchParams({ api_key: need(process.env.ANGEL_API_KEY, "ANGEL_API_KEY"), state })}`,
  async complete({ params }) {
    const jwt = need(params.auth_token, "auth_token");
    const p = await httpJson<{ data?: { clientcode?: string; name?: string } }>(`${ANGEL}/rest/secure/angelbroking/user/v1/getProfile`, { headers: angelHeaders(jwt) });
    if (!p.data) throw new BrokerAuthError("Angel One login failed.");
    return { session: { jwt, feedToken: params.feed_token ?? "" }, label: p.data.name ? `${p.data.name} (${p.data.clientcode})` : String(p.data.clientcode), expiresAt: nextMorningIst() };
  },
  async history({ session, inst, tf, from, to }) {
    const token = inst.kind === "index" ? INDEX_IDS[inst.symbol]?.angel : inst.token;
    if (!token) throw new BrokerError("This instrument is not available from Angel One.");
    const native: Tf = tf === "1W" ? "1D" : tf;
    const interval = { "1m": "ONE_MINUTE", "5m": "FIVE_MINUTE", "15m": "FIFTEEN_MINUTE", "30m": "THIRTY_MINUTE", "1h": "ONE_HOUR", "1D": "ONE_DAY" }[native as "1m"];
    const fmt = (d: Date) => istDateTime(d).slice(0, 16);
    const r = await httpJson<{ data?: [string, number, number, number, number, number][]; message?: string }>(`${ANGEL}/rest/secure/angelbroking/historical/v1/getCandleData`, {
      method: "POST",
      headers: angelHeaders(session.jwt),
      body: JSON.stringify({ exchange: "NSE", symboltoken: token, interval, fromdate: fmt(from), todate: fmt(to) }),
    });
    return finish(sortBars((r.data ?? []).map((c) => toBar(parseIstTime(c[0]), c[1], c[2], c[3], c[4], c[5]))), tf, native);
  },
};

export const ADAPTERS: Record<BrokerId, Adapter> = { icici: breeze, dhan, kotak, zerodha: kite, upstox, fyers, angel };

/** Brokers whose history we prefer for charts, in order. */
export const HISTORY_PREFERENCE: BrokerId[] = ["dhan", "icici", "zerodha", "upstox", "fyers", "angel"];

export { pad };
