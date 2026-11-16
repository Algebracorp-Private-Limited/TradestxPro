"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type Mode = "signup" | "login" | "verify";

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; next?: string; email?: string; notice?: string; message?: string };
  return { status: res.status, ...data };
}

const input =
  "mt-1.5 block w-full rounded-lg border border-line bg-ink px-3 py-2.5 text-sm text-white placeholder:text-muted/70 focus:border-accent focus:outline-none";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(mode === "verify" ? 60 : 0);
  const email = params.get("email") ?? "";

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    const form = Object.fromEntries(new FormData(e.currentTarget));
    const url = mode === "signup" ? "/api/auth/signup" : mode === "login" ? "/api/auth/login" : "/api/auth/verify-otp";
    const body = mode === "verify" ? { email, code: form.code } : form;
    try {
      const r = await post(url, body);
      if (!r.ok) {
        setError(r.error ?? "Something went wrong.");
      } else if (r.next === "verify") {
        router.push(`/verify?email=${encodeURIComponent(r.email ?? String(form.email))}${r.notice ? "&notice=1" : ""}`);
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setInfo(null);
    const r = await post("/api/auth/resend-otp", { email });
    if (r.ok) {
      setInfo("A new code has been sent if your account still needs verification.");
      setCooldown(60);
    } else setError(r.error ?? "Could not resend the code.");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
      {mode === "signup" && (
        <>
          <label className="block text-sm text-soft">
            Full name
            <input name="name" required minLength={2} maxLength={80} autoComplete="name" className={input} />
          </label>
          <label className="block text-sm text-soft">
            Email
            <input name="email" type="email" required autoComplete="email" className={input} />
          </label>
          <label className="block text-sm text-soft">
            Mobile number <span className="text-muted">(optional)</span>
            <input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+91" className={input} />
          </label>
          <label className="block text-sm text-soft">
            Password
            <input name="password" type="password" required minLength={10} autoComplete="new-password" className={input} aria-describedby="pw-hint" />
            <span id="pw-hint" className="mt-1 block text-xs text-muted">At least 10 characters, with letters and numbers.</span>
          </label>
        </>
      )}

      {mode === "login" && (
        <>
          <label className="block text-sm text-soft">
            Email
            <input name="email" type="email" required autoComplete="email" className={input} />
          </label>
          <label className="block text-sm text-soft">
            Password
            <input name="password" type="password" required autoComplete="current-password" className={input} />
          </label>
        </>
      )}

      {mode === "verify" && (
        <>
          <p className="text-sm leading-6 text-soft">
            We sent a 6-digit code to <strong className="text-white">{email || "your email"}</strong>. It expires in 10 minutes.
          </p>
          {params.get("notice") && (
            <p className="text-sm text-gold">A code was sent recently. Use that one, or request another shortly.</p>
          )}
          <label className="block text-sm text-soft">
            Verification code
            <input
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="••••••"
              className={`${input} text-center font-mono text-2xl tracking-[0.5em]`}
            />
          </label>
        </>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}
      {info && (
        <p role="status" className="rounded-lg border border-up/40 bg-up/10 px-3 py-2 text-sm text-emerald-200">
          {info}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-slate-200 disabled:opacity-60"
      >
        {busy ? "Please wait…" : mode === "signup" ? "Create account" : mode === "login" ? "Log in" : "Verify and continue"}
      </button>

      <p className="text-center text-sm text-muted">
        {mode === "signup" && (
          <>Already have an account? <Link href="/login" className="text-accent hover:underline">Log in</Link></>
        )}
        {mode === "login" && (
          <>New to TradestXPro? <Link href="/signup" className="text-accent hover:underline">Start a free trial</Link></>
        )}
        {mode === "verify" && (
          <button type="button" onClick={resend} disabled={cooldown > 0 || !email} className="text-accent hover:underline disabled:text-muted disabled:no-underline">
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </button>
        )}
      </p>
    </form>
  );
}
