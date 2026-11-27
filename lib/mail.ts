import "server-only";
import { NotConfiguredError } from "./db";

export function isMailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/** Throws before any account is created if codes could not be delivered. */
export function assertMailAvailable(): void {
  if (!isMailConfigured() && process.env.NODE_ENV === "production") throw new NotConfiguredError("email service");
}

/**
 * Sends the verification code by email. The code is never returned in an API response.
 * Outside production, when no mail provider is configured, it is written to the server log
 * so a developer can complete the flow locally.
 */
export async function sendOtpEmail(to: string, name: string, code: string): Promise<void> {
  if (!isMailConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[dev-mail] OTP for ${to}: ${code}`);
      return;
    }
    throw new NotConfiguredError("email service");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [to],
      subject: `${code} is your TradestXPro verification code`,
      text: `Hi ${name},\n\nYour TradestXPro verification code is ${code}. It expires in 10 minutes.\n\nIf you did not request this, you can ignore this email.`,
    }),
  });
  if (!res.ok) throw new Error(`Email provider responded ${res.status}`);
}

/**
 * Notification digest (alerts, plan events, watchlist changes) for users who opted in under
 * Monitor → Notifications. Plain text; links only to this site. Not sent when mail is not configured.
 */
export async function sendNotificationDigest(to: string, name: string, items: { title: string; body: string; d: string }[]): Promise<void> {
  if (!isMailConfigured()) {
    if (process.env.NODE_ENV !== "production") console.info(`[dev-mail] digest for ${to}: ${items.length} item(s)`);
    return;
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.tradestxpro.com";
  const lines = items.map((i) => `• ${i.d} — ${i.title}\n  ${i.body}`).join("\n\n");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [to],
      subject: `TradestXPro: ${items.length} new alert${items.length === 1 ? "" : "s"}`,
      text: `Hi ${name},\n\n${lines}\n\nAll alerts are evaluated on end-of-day data and are not trading advice. Scores rank setups; they are not probabilities.\n\nManage notifications: ${site}/ai-intelligence/monitor?tab=notifications\nTo stop these e-mails, turn off "E-mail me" on that page.`,
    }),
  });
  if (!res.ok) throw new Error(`Email provider responded ${res.status}`);
}
