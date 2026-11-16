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
