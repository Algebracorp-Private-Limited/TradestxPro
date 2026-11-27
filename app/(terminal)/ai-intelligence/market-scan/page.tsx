import type { Metadata } from "next";
import { MarketScanner } from "@/components/intelligence/scanner";

export const metadata: Metadata = { title: "MarketScan AI" };

export default async function MarketScanPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job } = await searchParams;
  const id = job && /^\d{1,12}$/.test(job) ? Number(job) : null;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">MarketScan AI</h1>
        <p className="text-sm text-muted">Staged scan of NSE equities: deterministic screening of every selected symbol, then setups, constraints, ranking and AI explanations for the top candidates.</p>
      </header>
      <MarketScanner initialJob={id} />
    </div>
  );
}
