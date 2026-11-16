import type { Metadata } from "next";
import Link from "next/link";
import { FeedBanner } from "@/components/feed-banner";
import { InstrumentSearch } from "@/components/instrument-search";

export const metadata: Metadata = { title: "Markets" };

const POPULAR = ["RELIANCE", "HDFCBANK", "TCS", "INFY", "ICICIBANK", "SBIN", "BHARTIARTL", "ITC", "LT", "TATAMOTORS"];

export default function Markets() {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Markets</h1>
        <p className="mt-1 text-sm text-muted">Search every NSE and BSE listed equity.</p>
      </div>
      <FeedBanner compact />
      <section className="max-w-3xl">
        <InstrumentSearch autoFocus limit={20} />
      </section>
      <section aria-labelledby="popular" className="max-w-3xl">
        <h2 id="popular" className="mb-3 text-sm font-medium text-soft">Popular</h2>
        <div className="flex flex-wrap gap-2">
          {POPULAR.map((s) => (
            <Link key={s} href={`/instrument/NSE/${s}`} className="rounded-lg border border-line bg-panel px-3 py-1.5 font-mono text-sm hover:border-white/25">
              {s}
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
