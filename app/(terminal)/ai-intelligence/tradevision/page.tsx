import type { Metadata } from "next";
import { TradeVision } from "@/components/intelligence/tradevision";

export const metadata: Metadata = { title: "TradeVision AI" };

export default async function TradeVisionPage({ searchParams }: { searchParams: Promise<{ symbol?: string }> }) {
  const { symbol } = await searchParams;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">TradeVision AI</h1>
        <p className="text-sm text-muted">Analytical charts on the XChart engine: computed support/resistance, demand/supply zones, volatility range and trade-plan levels with evidence; scenario and stress analysis for strategies.</p>
      </header>
      <TradeVision initial={symbol?.toUpperCase()} />
    </div>
  );
}
