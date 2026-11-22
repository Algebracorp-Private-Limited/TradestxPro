import "server-only";
import { request as httpsRequest } from "node:https";
import type { Bar } from "../ta/catalog";

export type Tf = "1m" | "5m" | "15m" | "30m" | "1h" | "1D" | "1W";
export const BROKER_TFS: Tf[] = ["1m", "5m", "15m", "30m", "1h", "1D", "1W"];

export type Instrument = {
  kind: "stock" | "index";
  symbol: string; // NSE symbol (stocks) or index key, e.g. "NIFTY 50"
  token: string | null; // NSE exchange token (stocks)
  isin: string | null;
  breezeCode: string | null;
};

export type Creds = Record<string, string>;
export type Session = Record<string, string>;

export class BrokerAuthError extends Error {}
export class BrokerError extends Error {}

export type LoginResult = { session: Session; label: string; expiresAt: Date | null };

export interface Adapter {
  /** URL to send the user to (redirect flows). */
  loginUrl?(args: { creds: Creds; state: string; redirectUri: string }): string;
  /** Exchange the callback parameters for a session (redirect flows). */
  complete?(args: { params: Record<string, string>; creds: Creds; redirectUri: string }): Promise<LoginResult>;
  /** Direct login with form fields (token / TOTP flows). */
  formLogin?(fields: Creds): Promise<LoginResult>;
  /** Historical candles, oldest first; t in UTC seconds. */
  history?(args: { session: Session; creds: Creds; inst: Instrument; tf: Tf; from: Date; to: Date }): Promise<Bar[]>;
}

/** Next 06:00 IST — most Indian broker sessions expire overnight. */
export function nextMorningIst(now = new Date()): Date {
  const t = new Date(now);
  t.setUTCHours(0, 30, 0, 0); // 06:00 IST
  if (t <= now) t.setUTCDate(t.getUTCDate() + 1);
  return t;
}

export async function httpJson<T = unknown>(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      cache: "no-store",
      signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
    });
  } catch (e) {
    const host = new URL(url).hostname;
    throw new BrokerError((e as Error).name === "TimeoutError" ? `${host} took too long to respond. Please try again.` : `Could not reach ${host}. Please try again.`);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    const said = brokerMessage(data);
    const host = new URL(url).hostname.replace(/^(api|mis|api-t1)\./, "");
    if (res.status === 401 || res.status === 403) {
      throw new BrokerAuthError(said ? `${host} rejected the login: ${said}` : `${host} rejected the login or session. Please check the details and reconnect.`);
    }
    throw new BrokerError(said ? `${host}: ${said}` : `${host} responded with an error (HTTP ${res.status}).`);
  }
  return data as T;
}

/** Pulls a human-readable message out of the error shapes Indian broker APIs use. */
export function brokerMessage(data: unknown): string | null {
  const d = data as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return null;
  const first = Array.isArray(d.error) ? (d.error[0] as Record<string, unknown> | undefined) : undefined;
  const m = d.message ?? d.errorMessage ?? d.Error ?? d.emsg ?? first?.message ?? (typeof d.error === "string" ? d.error : null) ?? d.remarks;
  return typeof m === "string" && m.trim() ? m.trim().slice(0, 200) : null;
}

/** GET with a JSON body (fetch cannot send one; ICICI Breeze requires it). */
export function getWithBody<T = unknown>(url: string, headers: Record<string, string>, body: string, timeoutMs = 20_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequest(
      { method: "GET", hostname: u.hostname, path: u.pathname + u.search, headers: { ...headers, "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let data: unknown;
          try {
            data = JSON.parse(buf);
          } catch {
            return reject(new BrokerError(`Unexpected broker response (HTTP ${res.statusCode})`));
          }
          if (res.statusCode === 401 || res.statusCode === 403) return reject(new BrokerAuthError("Broker rejected the session. Please reconnect."));
          resolve(data as T);
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new BrokerError("Broker request timed out")));
    req.on("error", reject);
    req.end(body);
  });
}

export { pad, istDate, istDateTime, parseIstTime, normaliseDaily, bucketMinutes } from "./time.ts";

/** Reasonable look-back per timeframe so requests stay within broker limits. */
export function lookbackDays(tf: Tf): number {
  return tf === "1m" ? 5 : tf === "5m" || tf === "15m" ? 25 : tf === "30m" || tf === "1h" ? 80 : tf === "1W" ? 1500 : 400;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
export function toBar(t: number, o: unknown, h: unknown, l: unknown, c: unknown, v: unknown): Bar | null {
  const bar = { t, o: num(o), h: num(h), l: num(l), c: num(c), v: num(v) || 0 };
  return [bar.t, bar.o, bar.h, bar.l, bar.c].every(Number.isFinite) && bar.c > 0 ? bar : null;
}
export const sortBars = (bars: (Bar | null)[]): Bar[] =>
  (bars.filter(Boolean) as Bar[]).sort((a, b) => a.t - b.t).filter((b, i, arr) => i === 0 || b.t !== arr[i - 1].t);

// Index identifiers per broker (others fall back to end-of-day data).
export type IndexIds = { dhan?: string; dhanSeg?: string; kite?: number; upstox?: string; fyers?: string; breeze?: string; breezeExch?: string; angel?: string };
export const INDEX_IDS: Record<string, IndexIds> = {
  "NIFTY 50": { dhan: "13", kite: 256265, upstox: "NSE_INDEX|Nifty 50", fyers: "NSE:NIFTY50-INDEX", breeze: "NIFTY", angel: "99926000" },
  "NIFTY BANK": { dhan: "25", kite: 260105, upstox: "NSE_INDEX|Nifty Bank", fyers: "NSE:NIFTYBANK-INDEX", breeze: "CNXBAN", angel: "99926009" },
  "NIFTY FINANCIAL SERVICES": { dhan: "27", kite: 257801, upstox: "NSE_INDEX|Nifty Fin Service", fyers: "NSE:FINNIFTY-INDEX", breeze: "NIFFIN", angel: "99926037" },
  "NIFTY MIDCAP SELECT": { dhan: "442", upstox: "NSE_INDEX|NIFTY MID SELECT", fyers: "NSE:MIDCPNIFTY-INDEX", breeze: "NIFSEL" },
  "INDIA VIX": { dhan: "21", kite: 264969, upstox: "NSE_INDEX|India VIX", fyers: "NSE:INDIAVIX-INDEX", angel: "99926017" },
  SENSEX: { dhan: "51", kite: 265, upstox: "BSE_INDEX|SENSEX", fyers: "BSE:SENSEX-INDEX", breeze: "BSESEN", breezeExch: "BSE", angel: "99919000" },
  BANKEX: { dhan: "69", upstox: "BSE_INDEX|BANKEX", fyers: "BSE:BANKEX-INDEX", breeze: "BANKEX", breezeExch: "BSE" },
};
