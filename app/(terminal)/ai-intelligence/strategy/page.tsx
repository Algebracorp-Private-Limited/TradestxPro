import type { Metadata } from "next";
import { StrategyAI } from "@/components/intelligence/strategy-ai";

export const metadata: Metadata = { title: "Strategy AI" };

export default async function StrategyAIPage({ searchParams }: { searchParams: Promise<{ u?: string }> }) {
  const { u } = await searchParams;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Strategy AI</h1>
        <p className="text-sm text-muted">Option and futures strategies built at real strikes, with payoff, Greeks, liquidity and fit to the underlying. Choose BUY ONLY or SELL ONLY to restrict the strategy registry.</p>
      </header>
      <StrategyAI initial={u?.toUpperCase()} />
    </div>
  );
}
