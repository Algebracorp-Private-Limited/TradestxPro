import type { Metadata } from "next";
import Link from "next/link";
import { listUnderlyings } from "@/lib/market-data";
import { AiAnalysis } from "@/components/ai-analysis";
import { UnderlyingFilter } from "@/components/underlying-filter";

export const metadata: Metadata = { title: "F&O Contracts" };

export default async function Derivatives() {
  const all = await listUnderlyings();
  const indices = all.filter((u) => u.kind === "index");
  const stocks = all.filter((u) => u.kind === "stock");

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">F&amp;O Contracts</h1>
        <p className="mt-1 text-sm text-muted">
          Every index and stock with listed futures &amp; options. Pick one for its futures (live prices, OI, basis) and its option chain.
        </p>
      </div>

      <AiAnalysis scope="options" target="NIFTY" />

      <section aria-labelledby="idx">
        <h2 id="idx" className="mb-3 text-sm font-medium text-soft">Index derivatives</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {indices.map((u) => (
            <Link
              key={u.exchange + u.underlying}
              href={`/derivatives/${u.underlying}?exchange=${u.exchange}`}
              className="rounded-xl border border-line bg-panel p-4 hover:border-white/20"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold">{u.underlying}</span>
                <span className="text-[10px] text-muted">{u.exchange}</span>
              </span>
              <span className="mt-1 block truncate text-xs text-muted">{u.name}</span>
              <span className="mt-2 block text-xs text-soft">{u.expiries} expiries · {u.contracts.toLocaleString("en-IN")} contracts</span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="stk">
        <h2 id="stk" className="mb-3 text-sm font-medium text-soft">Stock derivatives ({stocks.length})</h2>
        <UnderlyingFilter items={stocks.map((s) => ({ underlying: s.underlying, name: s.name, exchange: s.exchange, expiries: s.expiries }))} />
      </section>
    </>
  );
}
