// AES-256-GCM encryption for broker credentials and session tokens.
// Key = SHA-256 of BROKER_ENC_KEY (any long random string, set in the environment).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class VaultNotConfigured extends Error {
  constructor() {
    super("Broker connections are not configured yet (BROKER_ENC_KEY missing).");
  }
}

function key(secret = process.env.BROKER_ENC_KEY): Buffer {
  if (!secret || secret.length < 24) throw new VaultNotConfigured();
  return createHash("sha256").update(secret).digest();
}

export function isVaultConfigured(): boolean {
  return Boolean(process.env.BROKER_ENC_KEY && process.env.BROKER_ENC_KEY.length >= 24);
}

export function seal(value: unknown, secret?: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(secret), iv);
  const data = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function open<T = unknown>(sealed: string, secret?: string): T {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised sealed value");
  const d = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  const out = Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  return JSON.parse(out) as T;
}
