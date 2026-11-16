"use client";

import Link from "next/link";
import { useState } from "react";
import { ANNUAL_DISCOUNT, PLANS, TRIAL_DAYS, formatInr } from "@/lib/catalog";

export function Pricing() {
  const [annual, setAnnual] = useState(false);

  return (
    <div>
      <div className="mb-10 flex flex-col items-center gap-3">
        <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-xl border border-line bg-panel p-1 text-sm">
          {[false, true].map((isAnnual) => (
            <button
              key={String(isAnnual)}
              role="radio"
              aria-checked={annual === isAnnual}
              onClick={() => setAnnual(isAnnual)}
              className={`rounded-lg px-4 py-2 font-medium transition ${annual === isAnnual ? "bg-white text-slate-950" : "text-soft hover:text-white"}`}
            >
              {isAnnual ? `Annual · save ${ANNUAL_DISCOUNT * 100}%` : "Monthly"}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">Every plan starts with a {TRIAL_DAYS}-day free trial. Prices in INR, taxes extra.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((plan) => {
          const yearly = Math.round(plan.monthlyInr * 12 * (1 - ANNUAL_DISCOUNT));
          return (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-2xl border p-6 ${plan.featured ? "border-accent/60 bg-sky-400/[0.06]" : "border-line bg-panel"}`}
            >
              {plan.featured && (
                <span className="absolute -top-3 left-6 rounded-full bg-accent px-3 py-0.5 text-xs font-semibold text-slate-950">Most popular</span>
              )}
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              <p className="mt-1 min-h-10 text-sm text-muted">{plan.tagline}</p>
              <p className="mt-5 flex items-baseline gap-1">
                <span className="font-mono text-3xl font-semibold tabular-nums">
                  {formatInr(annual ? yearly : plan.monthlyInr)}
                </span>
                <span className="text-sm text-muted">/{annual ? "year" : "month"}</span>
              </p>
              {annual && (
                <p className="mt-1 text-xs text-muted">
                  ≈ {formatInr(Math.round(yearly / 12))}/month billed yearly
                </p>
              )}
              <ul className="mt-6 flex-1 space-y-2.5 text-sm text-soft">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span aria-hidden className="text-up">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={`/signup?plan=${plan.name.toLowerCase()}`}
                className={`mt-6 rounded-xl px-4 py-2.5 text-center text-sm font-semibold ${plan.featured ? "bg-white text-slate-950 hover:bg-slate-200" : "border border-line hover:bg-white/5"}`}
              >
                Start free trial
              </Link>
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-center text-xs text-muted">
        Plan limits and exchange data fees are subject to final commercial validation. Payments open at launch.
      </p>
    </div>
  );
}
