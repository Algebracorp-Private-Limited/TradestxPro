"use client";

import { useState } from "react";
import { BROKER_OPTIONS, CAPITAL_OPTIONS, EXPERIENCE_OPTIONS, INTEREST_OPTIONS } from "@/lib/waitlist";

const input = "mt-1.5 block w-full rounded-lg border border-line bg-ink px-3 py-2.5 text-sm text-white placeholder:text-muted/70 focus:border-accent focus:outline-none";

export function WaitlistForm({ defaultName = "", defaultEmail = "" }: { defaultName?: string; defaultEmail?: string }) {
  const [interests, setInterests] = useState<string[]>([]);
  const [state, setState] = useState<{ status: "idle" | "busy" | "done" | "error"; msg?: string }>({ status: "idle" });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    setState({ status: "busy" });
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, interests, consent: f.consent === "on" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not join the waitlist.");
      setState({ status: "done", msg: d.updated ? "Your details are updated — you're already on the list." : "You're on the list! We'll email you before launch." });
    } catch (err) {
      setState({ status: "error", msg: (err as Error).message });
    }
  }

  if (state.status === "done") {
    return (
      <div role="status" className="rounded-2xl border border-up/40 bg-up/10 p-6 text-center">
        <p className="text-2xl" aria-hidden>✓</p>
        <p className="mt-2 font-semibold">{state.msg}</p>
        <p className="mt-1 text-sm text-soft">Meanwhile, try writing indicators in XScript Lab on the chart page.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-soft">
          Full name
          <input name="name" required minLength={2} maxLength={80} autoComplete="name" defaultValue={defaultName} className={input} />
        </label>
        <label className="block text-sm text-soft">
          Email
          <input name="email" type="email" required autoComplete="email" defaultValue={defaultEmail} className={input} />
        </label>
        <label className="block text-sm text-soft">
          Mobile <span className="text-muted">(optional)</span>
          <input name="phone" type="tel" autoComplete="tel" placeholder="+91" className={input} />
        </label>
        <label className="block text-sm text-soft">
          Your broker
          <select name="broker" className={input} defaultValue="">
            <option value="" disabled>Choose…</option>
            {BROKER_OPTIONS.map((b) => <option key={b}>{b}</option>)}
          </select>
        </label>
        <label className="block text-sm text-soft">
          Experience
          <select name="experience" className={input} defaultValue="">
            <option value="" disabled>Choose…</option>
            {EXPERIENCE_OPTIONS.map((b) => <option key={b}>{b}</option>)}
          </select>
        </label>
        <label className="block text-sm text-soft">
          Capital you might deploy
          <select name="capital" className={input} defaultValue="">
            <option value="" disabled>Choose…</option>
            {CAPITAL_OPTIONS.map((b) => <option key={b}>{b}</option>)}
          </select>
        </label>
      </div>

      <fieldset>
        <legend className="text-sm text-soft">What would you use it for? <span className="text-muted">(pick any)</span></legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {INTEREST_OPTIONS.map((opt) => {
            const on = interests.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={on}
                onClick={() => setInterests((xs) => (on ? xs.filter((x) => x !== opt) : [...xs, opt]))}
                className={`rounded-full border px-3 py-1.5 text-xs ${on ? "border-accent bg-accent/15 text-accent" : "border-line text-soft hover:bg-white/5"}`}
              >
                {on ? "✓ " : ""}{opt}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="block text-sm text-soft">
        Anything you&apos;d like the platform to do? <span className="text-muted">(optional)</span>
        <textarea name="notes" maxLength={500} rows={3} className={input} placeholder="e.g. strategies you run today, features you need" />
      </label>

      {/* Honeypot for bots — hidden from people and screen readers. */}
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />

      <label className="flex items-start gap-2.5 text-sm text-soft">
        <input type="checkbox" name="consent" required className="mt-1 accent-sky-400" />
        <span>I agree to be contacted by TradestXPro about the algo trading launch. I understand joining is free and not a commitment.</span>
      </label>

      {state.status === "error" && (
        <p role="alert" className="rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-sm text-rose-200">{state.msg}</p>
      )}

      <button type="submit" disabled={state.status === "busy"} className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200 disabled:opacity-60">
        {state.status === "busy" ? "Joining…" : "Join the algo trading waitlist"}
      </button>
    </form>
  );
}
