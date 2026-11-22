import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import { BROKER_BY_ID, CALLBACK_PATH, type BrokerId } from "./catalog";
import { open, seal } from "./vault";
import { ADAPTERS, HISTORY_PREFERENCE } from "./adapters";
import { BrokerAuthError, type Creds, type Instrument, type LoginResult, type Session, type Tf, lookbackDays } from "./common";
import type { Bar } from "../ta/catalog";

export type ConnectionView = {
  broker: BrokerId;
  status: "pending" | "connected" | "expired" | "error";
  label: string | null;
  connectedAt: string | null;
  expiresAt: string | null;
  lastError: string | null;
  hasSavedDetails: boolean;
};

type Row = {
  broker: BrokerId; status: string; account_label: string | null; credentials_enc: string | null; session_enc: string | null;
  oauth_state: string | null; expires_at: Date | null; last_error: string | null; connected_at: Date | null;
};

export function siteOrigin(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "www.tradestxpro.com";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export const redirectUriFor = (req: Request, broker: BrokerId) => siteOrigin(req) + CALLBACK_PATH(broker);

const effectiveStatus = (r: Row): ConnectionView["status"] =>
  r.status === "connected" && r.expires_at && r.expires_at.getTime() < Date.now() ? "expired" : (r.status as ConnectionView["status"]);

export async function listConnections(userId: number): Promise<ConnectionView[]> {
  const sql = await db();
  const rows = await sql<Row[]>`SELECT * FROM broker_connections WHERE user_id = ${userId} ORDER BY broker`;
  return rows.map((r) => ({
    broker: r.broker,
    status: effectiveStatus(r),
    label: r.account_label,
    connectedAt: r.connected_at?.toISOString() ?? null,
    expiresAt: r.expires_at?.toISOString() ?? null,
    lastError: r.last_error,
    hasSavedDetails: Boolean(r.credentials_enc),
  }));
}

async function getRow(userId: number, broker: BrokerId): Promise<Row | null> {
  const sql = await db();
  const [r] = await sql<Row[]>`SELECT * FROM broker_connections WHERE user_id = ${userId} AND broker = ${broker}`;
  return r ?? null;
}

export async function savedCreds(userId: number, broker: BrokerId): Promise<Creds> {
  const r = await getRow(userId, broker);
  return r?.credentials_enc ? open<Creds>(r.credentials_enc) : {};
}

/** Keeps only fields the catalogue marks as storable (never TOTP/MPIN). */
function storable(broker: BrokerId, fields: Creds): Creds {
  const out: Creds = {};
  for (const f of BROKER_BY_ID[broker].fields) if (f.store && fields[f.key]) out[f.key] = String(fields[f.key]).trim();
  return out;
}

export async function beginRedirect(userId: number, broker: BrokerId, fields: Creds, redirectUri: string): Promise<string> {
  const adapter = ADAPTERS[broker];
  if (!adapter.loginUrl) throw new Error("This broker does not use a redirect login.");
  const prev = await savedCreds(userId, broker);
  const creds = { ...prev, ...storable(broker, fields) };
  const state = randomBytes(16).toString("base64url");
  const url = adapter.loginUrl({ creds, state, redirectUri });
  const sql = await db();
  await sql`
    INSERT INTO broker_connections (user_id, broker, status, credentials_enc, oauth_state, updated_at)
    VALUES (${userId}, ${broker}, 'pending', ${Object.keys(creds).length ? seal(creds) : null}, ${state}, now())
    ON CONFLICT (user_id, broker) DO UPDATE SET
      status = CASE WHEN broker_connections.status = 'connected' THEN broker_connections.status ELSE 'pending' END,
      credentials_enc = COALESCE(EXCLUDED.credentials_enc, broker_connections.credentials_enc),
      oauth_state = EXCLUDED.oauth_state, updated_at = now()`;
  return url;
}

async function store(userId: number, broker: BrokerId, res: LoginResult, creds: Creds | null) {
  const sql = await db();
  await sql`
    INSERT INTO broker_connections (user_id, broker, status, account_label, credentials_enc, session_enc, expires_at, connected_at, last_error, oauth_state, updated_at)
    VALUES (${userId}, ${broker}, 'connected', ${res.label}, ${creds && Object.keys(creds).length ? seal(creds) : null}, ${seal(res.session)}, ${res.expiresAt}, now(), NULL, NULL, now())
    ON CONFLICT (user_id, broker) DO UPDATE SET status = 'connected', account_label = EXCLUDED.account_label,
      credentials_enc = COALESCE(EXCLUDED.credentials_enc, broker_connections.credentials_enc),
      session_enc = EXCLUDED.session_enc, expires_at = EXCLUDED.expires_at, connected_at = now(),
      last_error = NULL, oauth_state = NULL, updated_at = now()`;
}

export async function recordError(userId: number, broker: BrokerId, message: string, expired = false) {
  const sql = await db();
  await sql`
    INSERT INTO broker_connections (user_id, broker, status, last_error, updated_at) VALUES (${userId}, ${broker}, ${expired ? "expired" : "error"}, ${message.slice(0, 300)}, now())
    ON CONFLICT (user_id, broker) DO UPDATE SET status = CASE WHEN ${expired} OR broker_connections.status <> 'connected' THEN EXCLUDED.status ELSE broker_connections.status END,
      last_error = EXCLUDED.last_error, updated_at = now()`;
}

export async function completeRedirect(userId: number, broker: BrokerId, params: Record<string, string>, redirectUri: string): Promise<LoginResult> {
  const row = await getRow(userId, broker);
  if (!row) throw new Error("No pending connection. Please start again from Broker Connections.");
  // ICICI does not echo `state`; every other redirect flow must match the one we issued.
  if (broker !== "icici" && (!row.oauth_state || params.state !== row.oauth_state)) {
    throw new Error("This login link has expired or did not start here. Please connect again.");
  }
  const creds = row.credentials_enc ? open<Creds>(row.credentials_enc) : {};
  const res = await ADAPTERS[broker].complete!({ params, creds, redirectUri });
  await store(userId, broker, res, null);
  return res;
}

export async function formConnect(userId: number, broker: BrokerId, fields: Creds): Promise<LoginResult> {
  const adapter = ADAPTERS[broker];
  if (!adapter.formLogin) throw new Error("This broker uses a redirect login.");
  const prev = await savedCreds(userId, broker);
  const merged = { ...prev, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v)) };
  const res = await adapter.formLogin(merged);
  await store(userId, broker, res, storable(broker, merged));
  return res;
}

export async function disconnect(userId: number, broker: BrokerId, forget: boolean) {
  const sql = await db();
  if (forget) await sql`DELETE FROM broker_connections WHERE user_id = ${userId} AND broker = ${broker}`;
  else await sql`UPDATE broker_connections SET status = 'expired', session_enc = NULL, expires_at = NULL, updated_at = now() WHERE user_id = ${userId} AND broker = ${broker}`;
}

/** First connected broker (by preference) that can serve historical candles. */
export async function historyBroker(userId: number): Promise<{ broker: BrokerId; session: Session; creds: Creds } | null> {
  const sql = await db();
  const rows = await sql<Row[]>`
    SELECT * FROM broker_connections WHERE user_id = ${userId} AND status = 'connected' AND session_enc IS NOT NULL
       AND (expires_at IS NULL OR expires_at > now())`;
  for (const b of HISTORY_PREFERENCE) {
    const r = rows.find((x) => x.broker === b);
    if (r && ADAPTERS[b].history) {
      return { broker: b, session: open<Session>(r.session_enc!), creds: r.credentials_enc ? open<Creds>(r.credentials_enc) : {} };
    }
  }
  return null;
}

export async function brokerHistory(userId: number, inst: Instrument, tf: Tf): Promise<{ broker: BrokerId; bars: Bar[] } | null> {
  const hb = await historyBroker(userId);
  if (!hb) return null;
  const to = new Date();
  const from = new Date(to.getTime() - lookbackDays(tf) * 86400_000);
  try {
    const bars = await ADAPTERS[hb.broker].history!({ session: hb.session, creds: hb.creds, inst, tf, from, to });
    return { broker: hb.broker, bars };
  } catch (e) {
    await recordError(userId, hb.broker, (e as Error).message, e instanceof BrokerAuthError);
    throw e;
  }
}
