import type { Metadata } from "next";
import { AiAnalysis } from "@/components/ai-analysis";
import { WatchlistManager } from "@/components/watchlist-manager";
import { WatchSections } from "@/components/watch-sections";

export const metadata: Metadata = { title: "Watchlists" };

export default function Watchlists() {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Watchlists</h1>
        <p className="mt-1 text-sm text-muted">Indices, futures, options and stocks in one place. Use ＋ to add, ✎ to edit and 🗑 to delete. Prices are live when a broker is connected.</p>
      </div>
      <AiAnalysis scope="market" target="NIFTY 50" />
      <WatchSections />
      <section aria-labelledby="ws-stock" className="space-y-3">
        <h2 id="ws-stock" className="font-semibold">Stocks <span className="text-xs font-normal text-muted">up to 10 lists, 250 symbols each</span></h2>
        <WatchlistManager />
      </section>
    </>
  );
}
