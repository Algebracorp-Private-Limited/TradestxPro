import type { Metadata } from "next";
import { ChainIntelligence } from "@/components/intelligence/chain-intelligence";

export const metadata: Metadata = { title: "Chain Intelligence" };

export default async function ChainIntelligencePage({ searchParams }: { searchParams: Promise<{ u?: string }> }) {
  const { u } = await searchParams;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Chain Intelligence</h1>
        <p className="text-sm text-muted">Descriptive option-chain analytics: OI, volume, IV smile and term structure, expected move, and contract ranking for buying and selling.</p>
      </header>
      <ChainIntelligence initial={u?.toUpperCase()} />
    </div>
  );
}
