import type { Metadata } from "next";
import Link from "next/link";
import { IndexComponents } from "@/components/index-components";
import { AiAnalysis } from "@/components/ai-analysis";

export const metadata: Metadata = { title: "Index Components" };

export default async function IndicesPage({ searchParams }: { searchParams: Promise<{ index?: string }> }) {
  const { index } = await searchParams;
  const key = (index ?? "NIFTY 50").toUpperCase().slice(0, 80);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/markets" className="text-xs text-muted hover:text-white">← Markets</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Index components</h1>
          <p className="mt-1 text-sm text-muted">Pick an index to see every member with price, OHLC, change, volume, beta and how it is moving against the index.</p>
        </div>
      </div>
      <AiAnalysis scope="index" target={key} />
      <IndexComponents initial={key} />
    </>
  );
}
