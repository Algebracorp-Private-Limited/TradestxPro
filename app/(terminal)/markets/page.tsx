import type { Metadata } from "next";
import Link from "next/link";
import { InstrumentSearch } from "@/components/instrument-search";
import { IndexChart, IndicesTable } from "@/components/index-chart";
import { listIndices } from "@/lib/chart-data";

export const metadata: Metadata = { title: "Markets" };

const POPULAR = ["RELIANCE", "HDFCBANK", "TCS", "INFY", "ICICIBANK", "SBIN", "BHARTIARTL", "ITC", "LT", "TATAMOTORS"];

export default async function Markets() {
  const indices = await listIndices();
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Markets</h1>
          <p className="mt-1 text-sm text-muted">NSE indices and every NSE/BSE listed equity. Live when a broker is connected, otherwise end of day.</p>
        </div>
        <Link href="/screener" className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-white/5">Open Stock Screener →</Link>
      </div>

      {indices.length ? (
        <IndexChart indices={indices} />
      ) : (
        <p className="rounded-xl border border-dashed border-line p-6 text-sm text-muted">Index history is loading for the first time. Check back in a few minutes.</p>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <section aria-labelledby="find" className="space-y-3">
          <h2 id="find" className="text-sm font-medium text-soft">Find a stock</h2>
          <InstrumentSearch limit={10} />
          <div className="flex flex-wrap gap-2">
            {POPULAR.map((s) => (
              <Link key={s} href={`/charts?symbol=NSE:${s}`} className="rounded-lg border border-line bg-panel px-3 py-1.5 font-mono text-xs hover:border-white/25">{s}</Link>
            ))}
          </div>
        </section>
        {indices.length > 0 && <IndicesTable indices={indices} />}
      </div>
    </>
  );
}
