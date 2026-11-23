import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { StrategyBuilder } from "@/components/options/strategy-builder";

export const metadata: Metadata = { title: "Option strategies" };

export default function StrategiesPage() {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Option strategies</h1>
          <p className="mt-1 text-sm text-muted">Pick a preset, apply it to an index or stock, and see the payoff, investment, breakevens and P&amp;L.</p>
        </div>
        <Link href="/options" className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-white/5">← Option chain</Link>
      </div>
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <StrategyBuilder />
      </Suspense>
    </>
  );
}
