// Pure crypto/validation helpers. No framework imports, so they can be unit tested with node --test.
import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

function scrypt(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export type SignupInput = { name: string; email: string; phone: string | null; password: string };

export function validateSignup(
  body: unknown,
): { ok: true; value: SignupInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? "").trim();
  const email = normalizeEmail(b.email);
  const phoneDigits = String(b.phone ?? "").replace(/\D/g, "");
  const password = String(b.password ?? "");

  if (name.length < 2 || name.length > 80) return { ok: false, error: "Please enter your full name." };
  if (!isEmail(email)) return { ok: false, error: "Please enter a valid email address." };
  if (phoneDigits && (phoneDigits.length < 10 || phoneDigits.length > 13))
    return { ok: false, error: "Please enter a valid mobile number." };
  const pwError = passwordProblem(password);
  if (pwError) return { ok: false, error: pwError };
  return { ok: true, value: { name, email, phone: phoneDigits || null, password } };
}

export function normalizeEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

export function isEmail(v: string): boolean {
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters.";
  if (pw.length > 128) return "Password is too long.";
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return "Password must include letters and numbers.";
  return null;
}
