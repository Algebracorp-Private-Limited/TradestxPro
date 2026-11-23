import type { Metadata } from "next";
import Link from "next/link";
import { OptionScreener } from "@/components/options/option-screener";
import { AiAnalysis } from "@/components/ai-analysis";

export const metadata: Metadata = { title: "Option Screener" };

export default function OptionScreenerPage() {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Option screener</h1>
          <p className="mt-1 text-sm text-muted">Scan every NSE index and stock option by activity, open interest build-up, price change, moneyness and implied volatility.</p>
        </div>
        <Link href="/options" className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-white/5">← Option chain</Link>
      </div>
      <AiAnalysis scope="options" target="NIFTY" />
      <OptionScreener />
    </>
  );
}
