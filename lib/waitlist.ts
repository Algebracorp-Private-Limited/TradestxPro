// Algo-trading waitlist: options and validation (shared by the form and the API).
import { isEmail, normalizeEmail } from "./crypto.ts";

export const WAITLIST_GOAL = 1000;

export const BROKER_OPTIONS = ["ICICI Direct", "Kotak Securities", "Dhan", "Zerodha", "Upstox", "Angel One", "Fyers", "Groww", "5paisa", "Other"];
export const EXPERIENCE_OPTIONS = ["New to trading", "Trade manually, new to algos", "Already use algo/API trading", "Professional / prop trader"];
export const INTEREST_OPTIONS = [
  "Equity intraday strategies",
  "Equity swing / positional",
  "Index options (NIFTY, BANKNIFTY, SENSEX)",
  "Stock options",
  "Futures",
  "Backtesting only",
  "Copy ready-made strategies",
  "Write my own strategies (XScript)",
];
export const CAPITAL_OPTIONS = ["Under ₹1 lakh", "₹1–5 lakh", "₹5–25 lakh", "₹25 lakh – ₹1 crore", "Above ₹1 crore", "Prefer not to say"];

export type WaitlistEntry = {
  name: string;
  email: string;
  phone: string | null;
  broker: string | null;
  experience: string | null;
  interests: string[];
  capital: string | null;
  notes: string | null;
};

const pick = (v: unknown, allowed: string[]) => (typeof v === "string" && allowed.includes(v) ? v : null);

export function validateWaitlist(body: unknown): { ok: true; value: WaitlistEntry } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? "").trim();
  const email = normalizeEmail(b.email);
  const phone = String(b.phone ?? "").replace(/\D/g, "");
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Please enter your name." };
  if (!isEmail(email)) return { ok: false, error: "Please enter a valid email address." };
  if (phone && (phone.length < 10 || phone.length > 13)) return { ok: false, error: "Please enter a valid mobile number." };
  if (b.consent !== true) return { ok: false, error: "Please confirm you agree to be contacted about the launch." };
  const interests = Array.isArray(b.interests) ? b.interests.filter((x): x is string => typeof x === "string" && INTEREST_OPTIONS.includes(x)) : [];
  return {
    ok: true,
    value: {
      name,
      email,
      phone: phone || null,
      broker: pick(b.broker, BROKER_OPTIONS),
      experience: pick(b.experience, EXPERIENCE_OPTIONS),
      interests: [...new Set(interests)],
      capital: pick(b.capital, CAPITAL_OPTIONS),
      notes: String(b.notes ?? "").trim().slice(0, 500) || null,
    },
  };
}
